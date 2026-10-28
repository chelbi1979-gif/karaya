-- =====================================================================
--  Karaya — schéma Supabase pour la synchronisation (Une seule fois)
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

-- index utile pour les recherches par propriétaire
create index if not exists ix_karaya_docs_owner on public.karaya_docs(owner);

-- ---------------------------------------------------------------------
--  RLS
--  L'application utilise la clé « anon » + un compte (e-mail / mot de
--  passe). L'identifiant du propriétaire est auth.uid() dès qu'une
--  session existe ; sinon on retombe sur « owner is null » pour ne pas
--  perdre la synchronisation d'un poste non authentifié.
-- ---------------------------------------------------------------------
alter table public.karaya_docs enable row level security;

drop policy if exists karaya_rw on public.karaya_docs;
create policy karaya_rw on public.karaya_docs
  for all
  to anon, authenticated
  using      (owner is null or owner = auth.uid())
  with check (owner is null or owner = auth.uid());

-- ---------------------------------------------------------------------
--  Realtime (propagation instantanée vers les autres postes)
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

-- ---------------------------------------------------------------------
--  Vérification (doit renvoyer une ligne)
-- ---------------------------------------------------------------------
-- select doc_id, rev, updated_at, device from public.karaya_docs;
