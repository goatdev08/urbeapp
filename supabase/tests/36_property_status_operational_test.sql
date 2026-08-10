-- Tests pgTAP — property_status: extensión aditiva con los estados operativos del PRD §15.4 (subtarea 73.1)
-- Ejecutar con: supabase test db
-- Cubre: los 10 valores nuevos existen en el enum; los 7 originales (incluido 'closed') se
--   conservan intactos; el enum tiene EXACTAMENTE 17 valores (caza typos/valores de más);
--   y la constraint property_closed_requires_reason (migración 20260604000005) sigue
--   comportándose igual tras la extensión aditiva del tipo — solo dispara para 'closed',
--   nunca para los estados operativos nuevos.
--
-- DECISIÓN (usuario 2026-08-09, ver subtarea 73.1): aditivo puro. 'closed' se MANTIENE vivo
-- en el enum (filas históricas); NO se toca ni se deprecia. Sin backfill.

begin;
select plan(17);

-- ── 1-10) Cada uno de los 10 valores nuevos del PRD §15.4 existe en el enum ──────────────
select ok(
  'uploading_media' = any(enum_range(null::property_status)::text[]),
  'enum property_status incluye uploading_media'
);
select ok(
  'media_failed' = any(enum_range(null::property_status)::text[]),
  'enum property_status incluye media_failed'
);
select ok(
  'pending_payment' = any(enum_range(null::property_status)::text[]),
  'enum property_status incluye pending_payment'
);
select ok(
  'approved' = any(enum_range(null::property_status)::text[]),
  'enum property_status incluye approved'
);
select ok(
  'expired' = any(enum_range(null::property_status)::text[]),
  'enum property_status incluye expired'
);
select ok(
  'rented' = any(enum_range(null::property_status)::text[]),
  'enum property_status incluye rented'
);
select ok(
  'sold' = any(enum_range(null::property_status)::text[]),
  'enum property_status incluye sold'
);
select ok(
  'rejected' = any(enum_range(null::property_status)::text[]),
  'enum property_status incluye rejected'
);
select ok(
  'deleted_soft' = any(enum_range(null::property_status)::text[]),
  'enum property_status incluye deleted_soft'
);
select ok(
  'deleted_hard' = any(enum_range(null::property_status)::text[]),
  'enum property_status incluye deleted_hard'
);

-- ── 11) No-regresión: los 7 valores originales siguen intactos (incluido 'closed', que
--        NO se deprecia -- sigue siendo válido para filas históricas) ──────────────────
select ok(
  (array['draft','pending_review','needs_changes','active','paused','closed','suspended']
     <@ enum_range(null::property_status)::text[]),
  'enum property_status conserva los 7 valores originales (incluido closed)'
);

-- ── 12) El enum tiene EXACTAMENTE 17 valores (7 originales + 10 nuevos, ni uno más) ─────
select is(
  (select count(*)::int from unnest(enum_range(null::property_status)::text[])),
  17,
  'enum property_status tiene exactamente 17 valores'
);

-- ── Fixtures para las asserts de regresión de la constraint (13-17) ─────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000cf301', 'owner-cf301@test.local');
-- El trigger handle_new_user crea la fila espejo en public.users con role por defecto.

insert into public.properties
  (id, owner_user_id, property_type, operation_type, address, location, price, status, closed_reason) values
  ('00000000-0000-0000-0000-0000000cf3f1', '00000000-0000-0000-0000-0000000cf301',
   'departamento', 'rent', 'Av. Prueba 36', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography,
   9000, 'draft', null);

-- ── 13) No-regresión: status='closed' SIGUE exigiendo closed_reason tras la extensión ───
select throws_ok(
  $$ update public.properties set status = 'closed', closed_reason = null
     where id = '00000000-0000-0000-0000-0000000cf3f1' $$,
  null, 'properties: cerrar sigue exigiendo closed_reason tras la extensión del enum');

-- ── 14-17) Los estados operativos nuevos NO disparan la constraint de closed_reason ──────
select lives_ok(
  $$ update public.properties set status = 'pending_payment', closed_reason = null
     where id = '00000000-0000-0000-0000-0000000cf3f1' $$,
  'properties: pending_payment no exige closed_reason');
select lives_ok(
  $$ update public.properties set status = 'approved', closed_reason = null
     where id = '00000000-0000-0000-0000-0000000cf3f1' $$,
  'properties: approved no exige closed_reason');
select lives_ok(
  $$ update public.properties set status = 'rented', closed_reason = null
     where id = '00000000-0000-0000-0000-0000000cf3f1' $$,
  'properties: rented (estado operativo nuevo, no closed_reason) no exige closed_reason');
select lives_ok(
  $$ update public.properties set status = 'deleted_soft', closed_reason = null
     where id = '00000000-0000-0000-0000-0000000cf3f1' $$,
  'properties: deleted_soft no exige closed_reason');

select * from finish();
rollback;
