-- =====================================================================
--  Karaya — CORRECTIF « temps réel » (à exécuter UNE FOIS)
--  Supabase → SQL Editor → New query → coller → RUN
--  Idempotent : peut être réexécuté sans risque.
-- =====================================================================
--  POURQUOI CE FICHIER
--  karaya-store.js s'abonne à :
--      postgres_changes { event:'*', schema:'public',
--                         table:'karaya_docs', filter:'doc_id=eq.main' }
--  Sans les deux ordres ci-dessous, l'abonnement est accepté mais AUCUN
--  événement n'arrive : la deuxième caisse ne voit pas les changements
--  de la première, et il faut cliquer « مزامنة الآن » (symptôme : « le
--  temps réel ne marche pas »).
-- =====================================================================

-- 1) La table doit publier ses changements vers le moteur Realtime
do $$
begin
  begin
    alter publication supabase_realtime add table public.karaya_docs;
  exception
    when duplicate_object then null;   -- déjà publiée : on ne fait rien
    when undefined_object then null;   -- publication absente (vieux projet)
  end;
end $$;

-- 2) « full » : l'événement UPDATE transporte l'ANCIENNE et la NOUVELLE
--    ligne (utile pour ignorer l'écho de son propre appareil).
alter table public.karaya_docs replica identity full;

-- 3) Vérification (doit renvoyer une ligne)
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename = 'karaya_docs';

-- =====================================================================
--  ⚠️ SÉCURITÉ — à lire, décision à prendre (voir la note qui
--     accompagne ces fichiers).
--
--  La règle actuelle rend la table lisible et écrivable par QUICONQUE
--  possède la clé anon, et cette clé est publiée dans le code du site :
--
--      using      (auth.uid() is null or owner is null or owner = auth.uid())
--
--  Conséquence : toute personne qui connaît l'URL du site peut lire et
--  écraser les données de tous les magasins qui partagent le projet.
--
--  Le seul correctif réellement sûr exige la connexion (auth.uid() non
--  nul). Il est fourni plus bas, DÉSACTIVÉ par défaut : décommentez-le
--  seulement quand chaque poste se connecte avec son compte Supabase.
-- ---------------------------------------------------------------------
-- alter table public.karaya_docs enable row level security;
--
-- drop policy if exists karaya_rw on public.karaya_docs;
--
-- create policy karaya_rw on public.karaya_docs
--   for all
--   to authenticated
--   using (owner = auth.uid())
--   with check (owner = auth.uid());
--
-- -- (la clé anon sans session n'a alors plus AUCUN accès : le poste doit
-- --  se connecter au moins une fois, puis la session est conservée par
-- --  persistSession / autoRefreshToken)
