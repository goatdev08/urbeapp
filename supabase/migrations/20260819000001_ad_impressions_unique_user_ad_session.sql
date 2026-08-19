-- Migración 20260819000001 — unique(user_id, ad_id, session_id) sobre
-- public.ad_impressions (subtarea #170.6, cierra #193: "el id de cliente sin
-- atar a user_id, vector de fraude de facturación").
--
-- Contrato fijado por supabase/tests/54_ad_impressions_unique_user_ad_session_test.sql
-- (RED, test-author 2026-08-18): ejecutar con
--   supabase test db supabase/tests/54_ad_impressions_unique_user_ad_session_test.sql --local
--
-- Por qué esta constraint NO es redundante con la PK: #193 cambió cómo se
-- deriva `id` — ya no lo manda el cliente, lo deriva la EF
-- (derive_impression_id = uuid_v5(namespace, "user_id:ad_id:session_id")).
-- Si esa derivación regresara a un uuid aleatorio (bug de regresión), la PK
-- (que solo mira `id`) NO vería el duplicado del mismo trío y la
-- facturación se inflaría. Esta constraint es la garantía a NIVEL DE BASE
-- que sobrevive a esa regresión — espeja exactamente el dedupe que 170.7
-- hace del lado cliente.
--
-- NO requiere `nulls not distinct`: user_id/ad_id/session_id son las 3
-- NOT NULL desde 170.5 (20260817000002_ad_impressions.sql).
--
-- Idempotente: patrón "drop constraint if exists + add" (equivalente a
-- "add constraint if not exists", que Postgres no soporta nativamente) —
-- mismo patrón que el fix guardián de 170.5 sobre ad_impressions_monthly.
-- Rollback: supabase/migrations/rollbacks/20260819000001_ad_impressions_unique_user_ad_session.sql

alter table public.ad_impressions
  drop constraint if exists ad_impressions_user_ad_session_key;
alter table public.ad_impressions
  add constraint ad_impressions_user_ad_session_key
  unique (user_id, ad_id, session_id);

comment on constraint ad_impressions_user_ad_session_key on public.ad_impressions is
  'Cierra #193: garantía a nivel de base de que un (user_id, ad_id, session_id) '
  'produce a lo más 1 fila, incluso si la derivación del id de la EF '
  'regresara a un uuid aleatorio. No es redundante con la PK (id).';
