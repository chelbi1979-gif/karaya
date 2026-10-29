-- =====================================================================
--  Karaya — CORRECTIF RLS pour un projet Supabase déjà installé
--  (si vous avez déjà exécuté l'ancien supabase_karaya.sql)
--  Supabase → SQL Editor → New query → coller → RUN
-- =====================================================================
alter table public.karaya_docs enable row level security;

drop policy if exists karaya_rw on public.karaya_docs;
create policy karaya_rw on public.karaya_docs
  for all
  to anon, authenticated
  using      (auth.uid() is null or owner is null or owner = auth.uid())
  with check (auth.uid() is null or owner is null or owner = auth.uid());
