-- Migración 20260815000003 — 3 columnas nuevas para el wizard de publicación
-- (quick fixes del paso 3, sesión 2026-08-15, sin tarea de Taskmaster —
-- documentado en wiki/, ver wiki/log.md).
--
-- Aditiva pura (§0.5): 3 columnas NULLABLE (o con default) sobre `properties`,
-- cero backfill, cero riesgo para filas reales.
--
--   - built_square_meters: superficie CONSTRUIDA (m²), separada de la
--     `square_meters` existente que pasa a significar superficie de TERRENO
--     (el wizard ahora captura ambas, lado a lado). Mismo CHECK que
--     square_meters (20260604000005).
--   - half_bathrooms: "medios baños", captura opcional a lado de `bathrooms`.
--   - currency: moneda en la que está expresado `price` — SOLO una etiqueta
--     (ponytail: sin conversión de tipo de cambio, sin tabla de tasas). CHECK
--     en vez de un enum nuevo — 2 valores, sin expansión prevista; evita el
--     gotcha de ALTER TYPE ADD VALUE para futuras monedas si algún día se
--     necesitan (se migraría a enum entonces).
--
-- Idempotente: add column if not exists.
-- Rollback: supabase/migrations/rollbacks/20260815000003_wizard_step3_columns.sql
-- Tests: supabase/tests/06_publish_property_rpc_test.sql (asserts 39-40),
--   supabase/tests/39_moderate_property_atomic_test.sql (asserts 9-11).

alter table public.properties
  add column if not exists built_square_meters numeric
    check (built_square_meters is null or built_square_meters >= 0),
  add column if not exists half_bathrooms int
    check (half_bathrooms is null or half_bathrooms >= 0),
  add column if not exists currency text not null default 'MXN'
    check (currency in ('MXN', 'USD'));

comment on column public.properties.built_square_meters is
  'Superficie construida (m²) — separada de square_meters (superficie de terreno) desde 2026-08-15.';
comment on column public.properties.half_bathrooms is
  'Medios baños, opcional, captado a lado de bathrooms en el wizard.';
comment on column public.properties.currency is
  'Moneda de price — MXN|USD. Solo etiqueta: sin conversión de tipo de cambio.';
