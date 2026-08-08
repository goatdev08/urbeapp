-- Tests pgTAP — RLS: el agente debe poder leer su propia fila de property_videos EN VUELO
-- Ejecutar con: supabase test db
-- Patrón: igual que 02_rls_test.sql / 11_property_videos_select_policy_test.sql / 25_admin_approvals_test.sql
--   begin / plan(N) / asserts / finish() / rollback — impersonación por
--   pg_temp.act_as(uid, role) + set local role + request.jwt.claims.
--
-- Subtarea 103.1 (parte A) — bug #103: el wizard sube el video a Cloudflare Stream ANTES de
-- que exista la propiedad (mint-upload-url inserta property_videos con agent_id=<caller>,
-- property_id=NULL, status='uploading'; el webhook lo pasa a 'ready' sin que property_id se
-- setee, eso pasa después al publicar). El fix (103.2, mobile) necesita que el cliente pueda
-- VERIFICAR el estado real de SU PROPIO video antes de decidir si falló — pero la policy
-- `videos_select` vigente (20260604000010_security_perf_hardening.sql:284) es:
--
--   using (
--     (status = 'ready' and deleted_at is null and private.property_is_public(property_id))
--     or private.can_manage_property(property_id)
--   )
--
-- Ambas ramas dependen de property_id. Con property_id IS NULL:
--   - private.property_is_public(NULL) = false (busca `properties.id = NULL`, nunca matchea)
--   - private.can_manage_property(NULL) = false (mismo motivo: `pr.id = NULL`)
-- → NINGUNA rama matchea → el agente dueño del upload en vuelo NO puede leer su propia fila.
-- Ese es el hueco (SEAM: comportamiento observable de la policy SELECT vía impersonación JWT).
--
-- SEAM bajo test: SOLO el SELECT de public.property_videos vía impersonación de rol/JWT
-- (pg_temp.act_as). No se inspecciona el texto del `qual` de la policy (eso sería probar el
-- CÓMO); se observa el resultado — qué filas ve cada actor — que es lo que sobrevive un
-- refactor de la policy (p.ej. si el fix se implementa como rama nueva `agent_id = auth.uid()`
-- o como una función helper distinta, el test sigue siendo válido).
--
-- DELTA vs INVARIANTE (convención heredada de 21_agency_member_role_matrix / 25_admin_approvals):
--   DELTA (1, 2)      = falla HOY (0 filas), debe pasar tras el fix.
--   INVARIANTE (3-6)  = ya se cumple HOY, documentado para que el fix no lo regresione.
--   Caso 7 es una DECISIÓN explícita (fail-closed) que el fix debe cumplir desde el día 1,
--   no solo "no romper" — se ancla aquí para que el GREEN no la pase por alto.

begin;
select plan(8);

-- UUIDs propios de este archivo (prefijo 1031, subtarea 103.1) para no colisionar con
-- fixtures de otros archivos (transacciones independientes, pero por claridad igual).
--   A1 (dueño del upload en vuelo)     : 00000000-0000-0000-0000-000000103101
--   A2 (otro agente activo, tercero)   : 00000000-0000-0000-0000-000000103102
--   OWNER_PUB (dueño de prop pública)  : 00000000-0000-0000-0000-000000103103
--   OWNER_PRIV (dueño de prop privada) : 00000000-0000-0000-0000-000000103104
--   P_PUB  (propiedad status=active)   : 00000000-0000-0000-0000-000000103201
--   P_PRIV (propiedad status=draft)    : 00000000-0000-0000-0000-000000103202

-- ── Fixtures: usuarios ──────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000103101', 'a1.inflight.1031@test.local'),
  ('00000000-0000-0000-0000-000000103102', 'a2.tercero.1031@test.local'),
  ('00000000-0000-0000-0000-000000103103', 'owner.pub.1031@test.local'),
  ('00000000-0000-0000-0000-000000103104', 'owner.priv.1031@test.local');

update public.users set role = 'agent', is_verified_agent = true
  where id in (
    '00000000-0000-0000-0000-000000103101',
    '00000000-0000-0000-0000-000000103102',
    '00000000-0000-0000-0000-000000103103',
    '00000000-0000-0000-0000-000000103104'
  );

-- ── Fixtures: propiedades (regresión, casos 5/6) ─────────────────────────────────
insert into public.properties
  (id, owner_user_id, property_type, operation_type, address, location, price, status)
values (
  '00000000-0000-0000-0000-000000103201',
  '00000000-0000-0000-0000-000000103103',
  'departamento', 'rent',
  'Av. Prueba 103.1 Pública 400',
  extensions.ST_SetSRID(extensions.ST_MakePoint(-103.38, 20.70), 4326)::extensions.geography,
  1650000,
  'active'
);

insert into public.properties
  (id, owner_user_id, property_type, operation_type, address, location, price, status)
values (
  '00000000-0000-0000-0000-000000103202',
  '00000000-0000-0000-0000-000000103104',
  'casa', 'sale',
  'Av. Prueba 103.1 Privada 401',
  extensions.ST_SetSRID(extensions.ST_MakePoint(-103.39, 20.71), 4326)::extensions.geography,
  2100000,
  'draft'
);

-- ── Fixtures: videos ──────────────────────────────────────────────────────────
-- V1: upload en vuelo de A1, aún 'uploading', property_id NULL (el caso central del bug).
insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
values (
  '00000000-0000-0000-0000-000000103301',
  null, '00000000-0000-0000-0000-000000103101',
  'uploading', 1, 'cfuid-1031-v1', 'https://upload.example/1031-v1'
);

-- V2: mismo upload en vuelo de A1, pero el webhook YA lo marcó 'ready' (property_id sigue
-- NULL — el usuario todavía no llega al paso de asociar propiedad en el wizard).
insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
values (
  '00000000-0000-0000-0000-000000103302',
  null, '00000000-0000-0000-0000-000000103101',
  'ready', 2, 'cfuid-1031-v2', 'https://upload.example/1031-v2'
);

-- V3: video 'ready' de la propiedad PÚBLICA (P_PUB) — regresión de la rama pública existente.
insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
values (
  '00000000-0000-0000-0000-000000103303',
  '00000000-0000-0000-0000-000000103201', null,
  'ready', 1, 'cfuid-1031-v3', 'https://upload.example/1031-v3'
);

-- V4: video 'ready' de la propiedad NO pública (P_PRIV, status=draft) — regresión de que
-- un tercero autenticado sigue sin poder verlo.
insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
values (
  '00000000-0000-0000-0000-000000103304',
  '00000000-0000-0000-0000-000000103202', null,
  'ready', 1, 'cfuid-1031-v4', 'https://upload.example/1031-v4'
);

-- V5: upload en vuelo de A1, SOFT-DELETED (deleted_at set) — decisión fail-closed: ni
-- siquiera el propio dueño debe verlo (mismo criterio que la rama 'ready' existente, que
-- exige deleted_at is null; el repo es fail-closed por defecto en RLS, ver 03_storage_test.sql
-- y la rama 'ready' de esta misma policy).
insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url, deleted_at)
values (
  '00000000-0000-0000-0000-000000103305',
  null, '00000000-0000-0000-0000-000000103101',
  'uploading', 3, 'cfuid-1031-v5', 'https://upload.example/1031-v5', now()
);

-- Helper de impersonación (mismo patrón que 02/11/13/25_*).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── Asserts ─────────────────────────────────────────────────────────────────
-- Keyword única en cada mensaje para que el guardian pueda hacer match.

-- 1) [DELTA] A1 ve su propia fila en vuelo 'uploading' (property_id null).
-- RED: falla hoy — 0 filas (ninguna rama de la policy matchea con property_id NULL).
select pg_temp.act_as('00000000-0000-0000-0000-000000103101');
select is(
  (select count(*)::int from public.property_videos
   where id = '00000000-0000-0000-0000-000000103301'),
  1,
  'agente_ve_su_propio_video_en_vuelo_uploading_property_id_null'
);
reset role;

-- 2) [DELTA] A1 ve su propia fila ya 'ready' pero AÚN sin property_id (webhook corrió antes
--    de que el wizard asocie la propiedad).
-- RED: falla hoy por el mismo hueco (la rama 'ready' exige property_is_public(property_id),
--      que con NULL también es false).
select pg_temp.act_as('00000000-0000-0000-0000-000000103101');
select is(
  (select count(*)::int from public.property_videos
   where id = '00000000-0000-0000-0000-000000103302'),
  1,
  'agente_ve_su_propio_video_en_vuelo_ready_property_id_aun_null'
);
reset role;

-- 3) [INVARIANTE-anclaje] A2 (otro agente activo, sin relación con la propiedad ni el
--    upload) NO ve el upload en vuelo de A1 — el fix no debe abrir la fila a cualquier
--    agente, solo al dueño (agent_id = auth.uid()).
select pg_temp.act_as('00000000-0000-0000-0000-000000103102');
select is(
  (select count(*)::int from public.property_videos
   where id = '00000000-0000-0000-0000-000000103301'),
  0,
  'otro_agente_no_ve_video_en_vuelo_ajeno'
);
reset role;

-- 4) [INVARIANTE, ya cubierto también por 13_property_videos_upload_first_test.sql §7]
--    anon NO ve el upload en vuelo de A1.
select pg_temp.act_as(null, 'anon');
select is(
  (select count(*)::int from public.property_videos
   where id = '00000000-0000-0000-0000-000000103301'),
  0,
  'anon_no_ve_video_en_vuelo_ajeno'
);
reset role;

-- 5a) [INVARIANTE, no-regresión] anon SIGUE viendo el video 'ready' de la propiedad pública.
select pg_temp.act_as(null, 'anon');
select is(
  (select count(*)::int from public.property_videos
   where id = '00000000-0000-0000-0000-000000103303'),
  1,
  'anon_sigue_viendo_video_ready_de_propiedad_publica'
);
reset role;

-- 5b) [INVARIANTE, no-regresión] un tercero autenticado (A2, sin relación con la propiedad)
--     SIGUE viendo el video 'ready' de la propiedad pública.
select pg_temp.act_as('00000000-0000-0000-0000-000000103102');
select is(
  (select count(*)::int from public.property_videos
   where id = '00000000-0000-0000-0000-000000103303'),
  1,
  'tercero_autenticado_sigue_viendo_video_ready_de_propiedad_publica'
);
reset role;

-- 6) [INVARIANTE, no-regresión] un tercero autenticado (A2) SIGUE sin ver el video 'ready'
--    de una propiedad NO pública (draft) de la que no es dueño ni admin.
select pg_temp.act_as('00000000-0000-0000-0000-000000103102');
select is(
  (select count(*)::int from public.property_videos
   where id = '00000000-0000-0000-0000-000000103304'),
  0,
  'tercero_autenticado_no_ve_video_de_propiedad_no_publica'
);
reset role;

-- 7) [DECISIÓN fail-closed, ancla del criterio del repo] A1 NO ve su propio upload en
--    vuelo si está soft-deleted, aunque sea el dueño. Mata el mutante de un fix ingenuo
--    "agent_id = auth.uid()" SIN el AND deleted_at is null (que colaría también las filas
--    borradas del propio agente).
select pg_temp.act_as('00000000-0000-0000-0000-000000103101');
select is(
  (select count(*)::int from public.property_videos
   where id = '00000000-0000-0000-0000-000000103305'),
  0,
  'dueno_no_ve_su_propio_video_en_vuelo_soft_deleted'
);
reset role;

select * from finish();
rollback;
