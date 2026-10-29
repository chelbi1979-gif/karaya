-- =====================================================================
--  Karaya — schéma Supabase (version 2 : RLS corrigée)
--  Supabase → SQL Editor → New query → coller → RUN
--  Idempotent : peut être réexécuté sans risque.
-- =====================================================================

create table if not exists public.karaya_docs (
  doc_id      text primary key,
  owner       uuid,
  payload     jsonb not null default '{}'::jsonb,
  rev         integer not null default 0,
  device      text,
  updated_at  timestamptz not null default now()
);

create index if not exists ix_karaya_docs_owner on public.karaya_docs(owner);

-- ---------------------------------------------------------------------
--  RLS — CORRECTIF IMPORTANT
--  L'application utilise la clé « anon » SANS session Supabase.
--  sync.py calcule owner = uuid5("karaya:" + email), une valeur NON NULLE,
--  alors que auth.uid() vaut NULL sans session.
--  ⇒ l'ancienne règle  (owner is null or owner = auth.uid())
--     refusait 100 % des écritures (erreur 42501 / new row violates RLS).
--  Règle corrigée : owner = auth.uid() pour un utilisateur connecté,
--  et accès libre quand il n'y a AUCUNE session (modèle : un projet
--  Supabase par client, la clé anon n'est distribuée qu'à lui).
--  Si vous voulez verrouiller : activez « Email/Password » dans Supabase,
--  connectez-vous depuis la fenêtre ☜☁ et supprimez le « or auth.uid() is null ».
-- ---------------------------------------------------------------------
alter table public.karaya_docs enable row level security;

drop policy if exists karaya_rw on public.karaya_docs;
create policy karaya_rw on public.karaya_docs
  for all
  to anon, authenticated
  using      (auth.uid() is null or owner is null or owner = auth.uid())
  with check (auth.uid() is null or owner is null or owner = auth.uid());

-- ---------------------------------------------------------------------
--  Realtime
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'karaya_docs'
  ) then
    alter publication supabase_realtime add table public.karaya_docs;
  end if;
end $$;
