-- Tests pgTAP — Corrección de la policy RLS SELECT de storage.objects (property-videos)
-- Ejecutar con: supabase test db
-- Patrón: igual que 01_constraints_test.sql / 02_rls_test.sql / 03_storage_test.sql.
--   begin / plan(N) / asserts / finish() / rollback
--
-- Subtarea 52.5 — la policy `property_videos_storage_select` (migración 20260604000011,
-- líneas ~53-59) tiene una rama pública muerta que espera property_id en el 2º segmento
-- del path ((storage.foldername(name))[2]::uuid), pero la convención real de subida
-- (mobile/src/features/publish/hooks/useVideoUpload.ts) es `{user_id}/{video_id}.mp4`
-- (SOLO 2 segmentos) → foldername(name)[2] siempre es NULL → private.property_is_public(NULL)
-- siempre es false → la rama pública NUNCA se activa en producción: es dead code.
--
-- Decisión aprobada: ELIMINAR esa rama. El acceso público a videos va exclusivamente por
-- la Edge Function mint-video-url (service_role, bypassa RLS, URLs firmadas). La policy
-- SELECT nueva conserva SOLO "dueño lee sus propios objetos". Se verificó la migración
-- original completa (20260604000011): NO existe ninguna rama admin en la policy SELECT de
-- storage.objects para este bucket (a diferencia de INSERT, que sí exige rol agent/admin
-- sobre el propio path) — por lo tanto no hay semántica de admin que preservar aquí.
--
-- Además de la eliminación de dead code, esta migración cierra un hueco de seguridad real:
-- bajo la policy VIEJA, un path FABRICADO de 3 segmentos `{owner}/{property_id_activo}/x.mp4`
-- (que la app nunca genera, pero que la policy no impide insertar) permite que CUALQUIER
-- usuario (incluido anon) lea el objeto vía la rama `property_is_public`, sin importar que
-- el primer segmento no coincida con su propio uid. Los tests 5 y 6 (RED) documentan y
-- cierran ese hueco.

begin;
select plan(7);

-- UUIDs propios de este archivo (prefijo b1f, no usado en otros archivos de tests) para no
-- colisionar con fixtures de 02_rls_test.sql / 03_storage_test.sql (transacciones independientes).
--   A1 (dueño legítimo)        : 00000000-0000-0000-0000-0000000b1fa1
--   A2 (NO dueño, autenticado) : 00000000-0000-0000-0000-0000000b1fa2
--   P1 (propiedad ACTIVA de A1): 00000000-0000-0000-0000-0000000b1f01

-- ── Fixtures ──────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000b1fa1', 'dueno.b1f@test.local'),
  ('00000000-0000-0000-0000-0000000b1fa2', 'no.dueno.b1f@test.local');

update public.users set role = 'agent', is_verified_agent = true
  where id in ('00000000-0000-0000-0000-0000000b1fa1', '00000000-0000-0000-0000-0000000b1fa2');

-- Propiedad ACTIVA de A1: alimenta el escenario del "hueco" de la rama pública fabricada.
insert into public.properties
  (id, owner_user_id, property_type, operation_type, address, location, price, status)
values (
  '00000000-0000-0000-0000-0000000b1f01',
  '00000000-0000-0000-0000-0000000b1fa1',
  'departamento', 'rent',
  'Av. Prueba 52.5 RLS Select 300',
  extensions.ST_SetSRID(extensions.ST_MakePoint(-103.37, 20.69), 4326)::extensions.geography,
  1650000,
  'active'
);

-- Objeto con path REAL (2 segmentos, convención real de la app): {user_id}/{video_id}.mp4
insert into storage.objects (bucket_id, name, owner, metadata)
values (
  'property-videos',
  '00000000-0000-0000-0000-0000000b1fa1/00000000-0000-0000-0000-0000000b1fd1.mp4',
  '00000000-0000-0000-0000-0000000b1fa1'::uuid,
  '{}'::jsonb
);

-- Objeto con path FABRICADO (3 segmentos, NUNCA generado por la app) que explota la rama
-- pública muerta: {owner}/{property_id_activo}/x.mp4 — segmento[2] coincide con P1 (activa).
insert into storage.objects (bucket_id, name, owner, metadata)
values (
  'property-videos',
  '00000000-0000-0000-0000-0000000b1fa1/00000000-0000-0000-0000-0000000b1f01/vid-fabricado.mp4',
  '00000000-0000-0000-0000-0000000b1fa1'::uuid,
  '{}'::jsonb
);

-- Helper de impersonación (mismo patrón que 02_rls_test.sql / 03_storage_test.sql)
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── Asserts ─────────────────────────────────────────────────────────────────
-- Keyword única en cada mensaje para que el guardian pueda hacer match.

-- 1) Estructural — el qual de la policy SELECT ya NO referencia el 2º segmento del path.
-- RED: falla hoy porque el qual actual SÍ contiene "[2]" (rama pública muerta viva en el SQL).
select ok(
  (
    select qual !~ '\[2\]'
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'property_videos_storage_select'
  ),
  'policy_select_ya_no_referencia_segmento_2_del_path'
);

-- 2) Estructural — el qual de la policy SELECT ya NO invoca private.property_is_public.
-- RED: falla hoy porque el qual actual SÍ invoca property_is_public.
select ok(
  (
    select qual !~ 'property_is_public'
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'property_videos_storage_select'
  ),
  'policy_select_ya_no_invoca_property_is_public'
);

-- 3) Happy path — el DUEÑO A1 puede leer su propio objeto (path real de 2 segmentos).
-- Ya funciona hoy (la rama dueño nunca fue el dead code) y debe seguir funcionando tras el fix.
select pg_temp.act_as('00000000-0000-0000-0000-0000000b1fa1');
select is(
  (select count(*)::int from storage.objects
   where name = '00000000-0000-0000-0000-0000000b1fa1/00000000-0000-0000-0000-0000000b1fd1.mp4'),
  1,
  'dueno_puede_leer_su_propio_video_path_real_2_segmentos'
);
reset role;

-- 4) No-dueño autenticado A2 NO puede leer el objeto de A1 (path real de 2 segmentos, sin
--    ninguna propiedad pública involucrada en el path).
select pg_temp.act_as('00000000-0000-0000-0000-0000000b1fa2');
select is(
  (select count(*)::int from storage.objects
   where name = '00000000-0000-0000-0000-0000000b1fa1/00000000-0000-0000-0000-0000000b1fd1.mp4'),
  0,
  'no_dueno_no_puede_leer_video_ajeno_path_real_2_segmentos'
);
reset role;

-- 5) No-dueño autenticado A2 NO puede leer el objeto de A1 vía el path FABRICADO cuyo 2º
--    segmento coincide con una propiedad ACTIVA (la rama pública ya no existe).
-- RED: falla hoy — bajo la policy vieja, property_is_public(P1 activa) = true habilita la
--      lectura sin importar que el 1er segmento no sea A2 → count=1 (hueco de seguridad).
select pg_temp.act_as('00000000-0000-0000-0000-0000000b1fa2');
select is(
  (select count(*)::int from storage.objects
   where name = '00000000-0000-0000-0000-0000000b1fa1/00000000-0000-0000-0000-0000000b1f01/vid-fabricado.mp4'),
  0,
  'no_dueno_no_puede_leer_video_ajeno_via_path_fabricado_de_propiedad_publica'
);
reset role;

-- 6) anon NO puede leer el objeto vía el mismo path FABRICADO de propiedad pública.
-- RED: falla hoy por la misma razón que el caso 5 (rama pública muerta aún activa para anon).
select pg_temp.act_as(null, 'anon');
select is(
  (select count(*)::int from storage.objects
   where name = '00000000-0000-0000-0000-0000000b1fa1/00000000-0000-0000-0000-0000000b1f01/vid-fabricado.mp4'),
  0,
  'anon_no_puede_leer_video_via_path_fabricado_de_propiedad_publica'
);
reset role;

-- 7) anon NO puede leer el objeto con path real de 2 segmentos (ya sin rama pública).
select pg_temp.act_as(null, 'anon');
select is(
  (select count(*)::int from storage.objects
   where name = '00000000-0000-0000-0000-0000000b1fa1/00000000-0000-0000-0000-0000000b1fd1.mp4'),
  0,
  'anon_no_puede_leer_video_con_path_real_2_segmentos'
);
reset role;

select * from finish();
rollback;
