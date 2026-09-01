-- Tests pgTAP — El admin de PLATAFORMA no lee pipeline comercial ajeno (#226)
-- Ejecutar con: supabase test db (CLI global de brew, NUNCA npx supabase)
-- Corre como superusuario dentro de una transacción revertida (no persiste).
--
-- ════════════════════════════════════════════════════════════════════════════
-- CONTEXTO — evidencia real (2026-08-31, impersonación JWT contra producción):
-- la cuenta admin de Abraham (0 propiedades, organización sin publicaciones)
-- veía los 3 leads de "Tu Casa con Vlad", incluido el teléfono del buscador.
-- CAUSA: `or private.is_admin()` en leads_select desde la PRIMERA policy
-- (20260604000008:330, molde "el admin lo ve todo"), arrastrado sin decisión
-- por 20260807000005/6. La capa de IDENTIDAD (can_view_user_as_lead_searcher)
-- NUNCA tuvo is_admin() — misma invariante, anclada en una sola capa: el
-- patrón de #220 y #100.
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba (comportamiento observable vía impersonación, NO internals):
--   1) leads_select                    (última def: 20260807000006:129-134)
--   2) private.can_view_lead           (usada por lead_status_history_select,
--      lead_origin_select y el RPC get_lead_stats — la fuga se PROPAGA ahí)
-- SUT del GREEN: migración nueva que quita `or private.is_admin()` de ambos.
-- leads_update/leads_delete CONSERVAN is_admin() (decisión anotada en #226:
-- el borrado por petición del titular es legítimo; moverlo a EF+service_role
-- es trabajo aparte) — este archivo NO los toca.
--
-- ── Convención DELTA vs INVARIANTE (heredada de 08/21/25/27/28/29/30) ────────
-- DELTA      = falla hoy, pasa tras el GREEN (discrimina la implementación).
-- INVARIANTE = ya se cumple hoy (ancla de no-regresión de 75.5/75.5-bis).
-- La I-serie es la red de seguridad: quitar is_admin() NO debe tumbar la
-- visibilidad del owner/admin de INMOBILIARIA ni la del agente dueño — y el
-- caso PAO (admin de plataforma que ADEMÁS es owner, el caso real de Abraham
-- tras #225) debe seguir viendo los leads DE SU organización por la rama
-- agency_role_of, ya sin el atajo is_admin().
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(9);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '...0000000226XX' (#226, sin colisión con 0755XX).
--   PA   admin de PLATAFORMA (users.role='admin'), SIN relación con agencias : ...022601
--   PAO  admin de plataforma QUE ES owner activo de la agencia X            : ...022602
--   OX   owner ACTIVO de agencia X                                          : ...022603
--   MX   admin (member_role) ACTIVO de agencia X                            : ...022604
--   GX   agente de X, DUEÑO del lead                                        : ...022605
--   BX   buscador del lead de GX                                            : ...022606
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000022601', 'pa.226@test.local'),
  ('00000000-0000-0000-0000-000000022602', 'pao.226@test.local'),
  ('00000000-0000-0000-0000-000000022603', 'ox.226@test.local'),
  ('00000000-0000-0000-0000-000000022604', 'mx.226@test.local'),
  ('00000000-0000-0000-0000-000000022605', 'gx.226@test.local'),
  ('00000000-0000-0000-0000-000000022606', 'bx.226@test.local');

-- PA y PAO son admins de PLATAFORMA (users.role) — la dimensión ortogonal a
-- agency_members.member_role (dos ejes de permisos, wiki/conceptos).
update public.users set role = 'admin'
  where id in ('00000000-0000-0000-0000-000000022601', '00000000-0000-0000-0000-000000022602');
update public.users set role = 'agent', is_verified_agent = true
  where id = '00000000-0000-0000-0000-000000022605';

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000022610', 'Inmobiliaria Fuga 226', 'inmo-fuga-226', 'active', '00000000-0000-0000-0000-000000022603');

insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000022651', '00000000-0000-0000-0000-000000022610', '00000000-0000-0000-0000-000000022603', 'owner', 'active'),  -- OX
  ('00000000-0000-0000-0000-000000022652', '00000000-0000-0000-0000-000000022610', '00000000-0000-0000-0000-000000022604', 'admin', 'active'),  -- MX
  ('00000000-0000-0000-0000-000000022653', '00000000-0000-0000-0000-000000022610', '00000000-0000-0000-0000-000000022605', 'agent', 'active'),  -- GX
  ('00000000-0000-0000-0000-000000022654', '00000000-0000-0000-0000-000000022610', '00000000-0000-0000-0000-000000022602', 'owner', 'active');  -- PAO (owner ADEMÁS de admin plataforma; el índice one_active_per_user permite 1 por usuario)

-- Lead bajo prueba: GX (agencia X) contactado por BX. El trigger
-- trg_set_lead_agency_id denormaliza agency_id=X al insertar.
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000022660', '00000000-0000-0000-0000-000000022605', '00000000-0000-0000-0000-000000022606', 'contacted');

insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000022670', '00000000-0000-0000-0000-000000022605', 'departamento', 'rent',
   'Fixture fuga admin 226 — X1', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 15000, 'active');
insert into public.lead_origin_properties (id, lead_id, property_id) values
  ('00000000-0000-0000-0000-000000022680', '00000000-0000-0000-0000-000000022660', '00000000-0000-0000-0000-000000022670');

-- Gate (b) de get_lead_stats (20260808000002): el lead solo aparece en los
-- stats si el buscador dio LIKE a la propiedad de origen — sin estas filas,
-- D4/I5 no discriminan nada (0 filas para todos, trivialmente). likes exige
-- property_video_id NOT NULL (like a nivel video), así que primero un video.
insert into public.property_videos (id, property_id, agent_id, status, position, cloudflare_uid) values
  ('00000000-0000-0000-0000-000000022690', '00000000-0000-0000-0000-000000022670', '00000000-0000-0000-0000-000000022605', 'ready', 1, 'fixture-226-uid');
insert into public.likes (user_id, property_id, property_video_id) values
  ('00000000-0000-0000-0000-000000022606', '00000000-0000-0000-0000-000000022670', '00000000-0000-0000-0000-000000022690');

-- Helper de impersonación inline (mismo patrón que 02/08/18/21/25/27/28/30_*).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) [DELTA] El admin de PLATAFORMA sin relación con la agencia NO ve nada del
--    pipeline ajeno: ni el lead, ni su historial, ni su origen, ni sus stats.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000022601'); -- PA
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000022660'),
  0,
  'D1_admin_de_plataforma_sin_relacion_ve_0_leads_ajenos'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000022601'); -- PA
select is(
  (select count(*)::int from public.lead_status_history where lead_id = '00000000-0000-0000-0000-000000022660'),
  0,
  'D2_admin_de_plataforma_ve_0_historial_de_leads_ajenos'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000022601'); -- PA
select is(
  (select count(*)::int from public.lead_origin_properties where lead_id = '00000000-0000-0000-0000-000000022660'),
  0,
  'D3_admin_de_plataforma_ve_0_lead_origin_properties_ajenos'
);
reset role;

-- get_lead_stats hereda de can_view_lead (20260808000002:88) — la fuga se
-- propaga por ahí; tras el GREEN debe devolver 0 filas para el mismo array.
select pg_temp.act_as('00000000-0000-0000-0000-000000022601'); -- PA
select is(
  (select count(*)::int from public.get_lead_stats(array['00000000-0000-0000-0000-000000022660']::uuid[])),
  0,
  'D4_get_lead_stats_devuelve_0_filas_al_admin_de_plataforma_sin_relacion'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) [INVARIANTE] La visibilidad legítima de 75.5/75.5-bis NO se degrada.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000022603'); -- OX
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000022660'),
  1,
  'I1_owner_de_la_agencia_sigue_viendo_el_lead_de_su_equipo'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000022604'); -- MX
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000022660'),
  1,
  'I2_admin_de_inmobiliaria_sigue_viendo_el_lead_de_su_equipo'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000022605'); -- GX
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000022660'),
  1,
  'I3_agente_dueno_sigue_viendo_su_propio_lead'
);
reset role;

-- El caso real de Abraham tras #225: admin de plataforma que ADEMÁS es owner.
-- Debe seguir viendo los leads DE SU organización — por la rama
-- agency_role_of(agency_id), nunca por el atajo is_admin().
select pg_temp.act_as('00000000-0000-0000-0000-000000022602'); -- PAO
select is(
  (select count(*)::int from public.leads where id = '00000000-0000-0000-0000-000000022660'),
  1,
  'I4_admin_de_plataforma_que_es_owner_sigue_viendo_los_leads_de_SU_organizacion'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000022602'); -- PAO
select is(
  (select count(*)::int from public.get_lead_stats(array['00000000-0000-0000-0000-000000022660']::uuid[])),
  1,
  'I5_get_lead_stats_sigue_respondiendo_al_owner_por_la_rama_de_agencia'
);
reset role;

select * from finish();
rollback;
