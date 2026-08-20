-- Tests pgTAP — ad_creatives.failure_reason (tarea #189).
-- Ejecutar con:
--   supabase test db supabase/tests/57_ad_creatives_failure_reason_test.sql --local
--
-- ════════════════════════════════════════════════════════════════════════════
-- POR QUÉ EXISTE ESTA COLUMNA. `ad_creatives` no guardaba por qué falló un
-- creativo: el adapter make_ad_creative_status_updater RECIBÍA un reason_code
-- y escribía solo `{ status: 'failed' }` — lo tiraba a la basura. Su hermano
-- de property_videos sí persiste `failure_reason` desde siempre.
--
-- Esa pérdida es lo que forzó al cliente a ADIVINAR: useAdUpload infería "por
-- eliminación, este failed es un fallo de transcodificación" y mostraba ese
-- mensaje SIEMPRE. La inferencia solo se sostenía mientras el pre-flight
-- fuera fail-closed ante duración ausente — es decir, el mensaje equivocado y
-- el bloqueo del anunciante con picker viejo eran el MISMO defecto.
--
-- Con la columna, el cliente lee la razón real y deja de adivinar; sin ella,
-- abrir el fail-open habría convertido un mensaje equivocado-pero-inmediato en
-- uno equivocado-y-caro (minutos de Cloudflare Stream quemados para decirle a
-- la persona "error de transcodificación" cuando su video dura 40 s).
--
-- ── Edge cases ──────────────────────────────────────────────────────────────
--  EC-1 La columna existe y es text.
--  EC-2 Es NULLABLE — los creativos ya escritos (producción viva) no tienen
--       razón y deben seguir siendo válidos. Una columna NOT NULL habría
--       exigido backfill sobre datos reales.
--  EC-3 Sin default: NULL significa "no sabemos", no un literal inventado.
--  EC-4 Round-trip: se puede escribir y leer un reason_code.
--  EC-5 No hay CHECK que restrinja el vocabulario — el servidor emite
--       AD_DURATION_INVALID y también los errorReasonCode de Cloudflare, que
--       no controlamos.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(6);

select has_column('public', 'ad_creatives', 'failure_reason',
  'EC-1 ad_creatives tiene la columna failure_reason');

select col_type_is('public', 'ad_creatives', 'failure_reason', 'text',
  'EC-1b failure_reason es text');

select col_is_null('public', 'ad_creatives', 'failure_reason',
  'EC-2 failure_reason es NULLABLE — los creativos ya escritos no tienen razon');

select col_hasnt_default('public', 'ad_creatives', 'failure_reason',
  'EC-3 sin default: NULL significa "no sabemos"');

-- EC-4/EC-5: round-trip con dos vocabularios distintos (el nuestro y uno de
-- Cloudflare) para probar que no hay CHECK restringiendo el conjunto.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000570001', 'owner_failreason57@urbea.mx');

insert into public.agencies (id, name, slug, contact_phone, contact_email, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000570101', 'Agencia Failure Reason 57', 'agencia-failreason-57',
   '3312345757', 'contacto-failreason57@urbea.mx', 'active', '00000000-0000-0000-0000-000000570001');

insert into public.ad_creatives (id, agency_id, cloudflare_uid, status, failure_reason) values
  ('00000000-0000-0000-0000-000000570201', '00000000-0000-0000-0000-000000570101',
   'cf-uid-failreason57-a', 'failed', 'AD_DURATION_INVALID'),
  ('00000000-0000-0000-0000-000000570202', '00000000-0000-0000-0000-000000570101',
   'cf-uid-failreason57-b', 'failed', 'ERR_NON_VIDEO_FILE');

select is(
  (select failure_reason from public.ad_creatives where id = '00000000-0000-0000-0000-000000570201'),
  'AD_DURATION_INVALID',
  'EC-4 round-trip del reason_code propio'
);

select is(
  (select failure_reason from public.ad_creatives where id = '00000000-0000-0000-0000-000000570202'),
  'ERR_NON_VIDEO_FILE',
  'EC-5 tambien admite un errorReasonCode de Cloudflare (sin CHECK de vocabulario)'
);

select * from finish();
rollback;
