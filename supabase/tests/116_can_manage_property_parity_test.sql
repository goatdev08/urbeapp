-- Tests pgTAP — private.can_manage_property alineado a la forma VIVA de properties_update
-- (#202) / private.is_property_comment_manager (subtarea 292.1, tarea #292,
-- hardening(289.2)).
-- Ejecutar con:
--   supabase test db supabase/tests/116_can_manage_property_parity_test.sql --local
-- (CLI GLOBAL de brew, NUNCA npx supabase). Corre como superusuario (rol `postgres`, dueño
-- de las tablas -> bypassa RLS por ownership, NO es superuser real) dentro de una
-- transacción revertida (no persiste). Los fixtures se insertan directo (bypass RLS); las
-- aserciones impersonan con pg_temp.act_as(uid,role) (mismo patrón que 02/.../109/112).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba (comportamiento observable, NUNCA internals):
--   1) private.can_manage_property(p_property_id uuid) — llamada directa, SECURITY DEFINER,
--      bajo impersonación JWT por rol (dueño activo/suspendido/removed/independiente, owner
--      de agencia, admin de agencia, admin de plataforma, tercero, NULL).
--   2) paridad con private.is_property_comment_manager(p_property_id uuid) — MISMA regla,
--      un solo lugar de verdad (EC-11).
--   3) el comportamiento OBSERVABLE de las 2 policies que hoy lo consumen en producción
--      (pg_policies verificado empíricamente, 2026-09-13): property_videos.videos_select y
--      property_videos.videos_update — NUNCA una query directa a la tabla que rodee RLS.
--   4) candado de forma (EC-15): sigue SECURITY DEFINER con search_path fijo tras el GREEN.
--
-- ESTADO ANTERIOR (verificado, 20260604000010:66-75): can_manage_property es HOY
--   pr.owner_user_id = auth.uid() OR private.is_agency_owner_of(pr.owner_user_id) OR private.is_admin()
-- — el dueño cortocircuita por `owner_user_id = auth.uid()` SIN mirar si su membresía en la
-- agencia de la fila sigue vigente (suspendida/removed lo conservan como gestor, al revés de
-- #202), y no contempla al ADMIN de agencia (solo al owner, vía is_agency_owner_of). El GREEN
-- (migración nueva, fuera de esta subtarea) la reemplaza por la forma VIVA de properties_update
-- (20260904100001_suspension_congela_escritura.sql:58-63), idéntica a
-- private.is_property_comment_manager (20260910100001_comments.sql:164-172):
--   (p.owner_user_id = auth.uid() AND (p.agency_id IS NULL OR private.agency_role_of(p.agency_id) IS NOT NULL))
--   OR private.agency_role_of(p.agency_id) IN ('owner','admin')
--   OR private.is_admin()
--
-- Consumidores VIVOS confirmados por pg_policies (2026-09-13): SOLO
-- property_videos.videos_select y property_videos.videos_update. events_raw_select ya NO usa
-- can_manage_property (sustituido por private.can_view_user_events en 20260809000001); no se
-- testea aquí por estar fuera del footprint de esta subtarea.
--
-- ── Anti-cheat: por qué EC-12/13/14 no caen en la trampa "policy dominada por *_select" ─────
-- (memoria pgtap_policy_dominada_por_select): videos_update comparte la MISMA expresión
-- (can_manage_property) con la 2ª rama de videos_select, así que un UPDATE...RETURNING (que
-- también exige SELECT sobre la fila devuelta) no se ve bloqueado por una rama de SELECT más
-- laxa que la de UPDATE — ambas policies dependen del mismo helper, sin discrepancia. La 1ª
-- rama de videos_select (`status='ready' AND property_is_public`) y la 3ª (`property_id is
-- null`) se anulan a propósito con status='uploading' y property_id NOT NULL en el fixture,
-- así que las 3 secciones (EC-12/13/14) ejercitan EXCLUSIVAMENTE la rama can_manage_property.
-- EC-1..EC-10 llaman a la función SECURITY DEFINER directo (bypassa RLS de properties), no una
-- query a la tabla — evita cualquier ruido de policies ajenas.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(25);

-- Helper de impersonación (mismo patrón que 02/.../109/112).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '00000000-0000-0000-0000-000000292XXX' (subtarea 292.1, tarea
-- #292 — sin colisión con prefijos previos: 0202XX/0226XX/269XXX/1093XX/2761XX/28920X).
--   USERS (201-208):
--     201 RA   agente ACTIVO en A, DUEÑO de P_ra — gestor por self+membresía activa
--     202 SA   agente SUSPENDIDO en A, DUEÑO de P_sa — pierde el poder de gestor (#202)
--     203 MA   agente REMOVED en A, DUEÑO de P_ma — pierde el poder de gestor (#202)
--     204 IU   agente INDEPENDIENTE (sin agencia), DUEÑO de P_indep — gestor por self, agency_id NULL
--     205 OA   owner  ACTIVO de A — gestor de TODO lo de A
--     206 AA   admin  ACTIVO de A — gestor de TODO lo de A (HOY false, GREEN true — EC-6)
--     207 PA   admin de PLATAFORMA (users.role='admin'), sin relación con A
--     208 TU   authenticated sin ninguna relación con propiedades/agencia del fixture
--   AGENCY: 230 = A
--   AGENCY_MEMBERS (240-244): 240=A/RA(agent,active) 241=A/SA(agent,suspended)
--     242=A/MA(agent,removed) 243=A/OA(owner,active) 244=A/AA(admin,active)
--   PROPERTIES (250-253): 250=P_ra(RA/A) 251=P_sa(SA/A) 252=P_ma(MA/A) 253=P_indep(IU/null)
--   PROPERTY_VIDEOS (260-263): uno por propiedad, status='uploading' (NO 'ready') a
--     propósito — así videos_select depende SOLO de can_manage_property (ver nota anti-cheat).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000292201', 'ra.292@test.local'),
  ('00000000-0000-0000-0000-000000292202', 'sa.292@test.local'),
  ('00000000-0000-0000-0000-000000292203', 'ma.292@test.local'),
  ('00000000-0000-0000-0000-000000292204', 'iu.292@test.local'),
  ('00000000-0000-0000-0000-000000292205', 'oa.292@test.local'),
  ('00000000-0000-0000-0000-000000292206', 'aa.292@test.local'),
  ('00000000-0000-0000-0000-000000292207', 'pa.292@test.local'),
  ('00000000-0000-0000-0000-000000292208', 'tu.292@test.local');

update public.users set role = 'agent', is_verified_agent = true
  where id in ('00000000-0000-0000-0000-000000292201', '00000000-0000-0000-0000-000000292202',
               '00000000-0000-0000-0000-000000292203', '00000000-0000-0000-0000-000000292204',
               '00000000-0000-0000-0000-000000292205', '00000000-0000-0000-0000-000000292206');
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000292207';

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000292230', 'Inmobiliaria Parity 292', 'inmo-parity-292',
   'active', '00000000-0000-0000-0000-000000292205');

insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000292240', '00000000-0000-0000-0000-000000292230', '00000000-0000-0000-0000-000000292201', 'agent', 'active'),
  ('00000000-0000-0000-0000-000000292241', '00000000-0000-0000-0000-000000292230', '00000000-0000-0000-0000-000000292202', 'agent', 'suspended'),
  ('00000000-0000-0000-0000-000000292242', '00000000-0000-0000-0000-000000292230', '00000000-0000-0000-0000-000000292203', 'agent', 'removed'),
  ('00000000-0000-0000-0000-000000292243', '00000000-0000-0000-0000-000000292230', '00000000-0000-0000-0000-000000292205', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000292244', '00000000-0000-0000-0000-000000292230', '00000000-0000-0000-0000-000000292206', 'admin', 'active');

insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000292250', '00000000-0000-0000-0000-000000292201', '00000000-0000-0000-0000-000000292230',
   'departamento', 'rent', 'Fixture 292 — P_ra (dueño RA, activo)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-000000292251', '00000000-0000-0000-0000-000000292202', '00000000-0000-0000-0000-000000292230',
   'departamento', 'rent', 'Fixture 292 — P_sa (dueño SA, suspendido)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography, 13000, 'active'),
  ('00000000-0000-0000-0000-000000292252', '00000000-0000-0000-0000-000000292203', '00000000-0000-0000-0000-000000292230',
   'departamento', 'rent', 'Fixture 292 — P_ma (dueño MA, removed)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.37, 20.69), 4326)::extensions.geography, 14000, 'active'),
  ('00000000-0000-0000-0000-000000292253', '00000000-0000-0000-0000-000000292204', null,
   'casa', 'sale', 'Fixture 292 — P_indep (dueño IU, independiente)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.38, 20.70), 4326)::extensions.geography, 2500000, 'active');

insert into public.property_videos (id, property_id, status, position) values
  ('00000000-0000-0000-0000-000000292260', '00000000-0000-0000-0000-000000292250', 'uploading', 1),
  ('00000000-0000-0000-0000-000000292261', '00000000-0000-0000-0000-000000292251', 'uploading', 1),
  ('00000000-0000-0000-0000-000000292262', '00000000-0000-0000-0000-000000292252', 'uploading', 1),
  ('00000000-0000-0000-0000-000000292263', '00000000-0000-0000-0000-000000292253', 'uploading', 1);

-- ════════════════════════════════════════════════════════════════════════════
-- 1) private.can_manage_property — llamada directa bajo impersonación (EC-1..EC-10)
-- ════════════════════════════════════════════════════════════════════════════

-- EC-1: dueño ACTIVO con agencia (RA sobre P_ra) — true hoy y tras el GREEN.
select pg_temp.act_as('00000000-0000-0000-0000-000000292201');
select is(private.can_manage_property('00000000-0000-0000-0000-000000292250'), true,
  'EC1_dueno_activo_con_agencia_RA_sobre_P_ra_es_gestor');
reset role;

-- EC-2: dueño INDEPENDIENTE (IU sobre P_indep, agency_id null) — true hoy y tras el GREEN.
select pg_temp.act_as('00000000-0000-0000-0000-000000292204');
select is(private.can_manage_property('00000000-0000-0000-0000-000000292253'), true,
  'EC2_dueno_independiente_IU_sobre_P_indep_es_gestor');
reset role;

-- EC-3: dueño SUSPENDIDO (SA sobre su propia P_sa) — FALSE tras el GREEN (HOY true: el
-- cortocircuito owner_user_id=auth.uid() ignora la suspensión → RED debe fallar).
select pg_temp.act_as('00000000-0000-0000-0000-000000292202');
select is(private.can_manage_property('00000000-0000-0000-0000-000000292251'), false,
  'EC3_dueno_suspendido_SA_sobre_P_sa_pierde_el_poder_de_gestor');
reset role;

-- EC-4: dueño REMOVED (MA sobre su propia P_ma) — FALSE tras el GREEN (HOY true, mismo
-- cortocircuito que EC-3 → RED debe fallar).
select pg_temp.act_as('00000000-0000-0000-0000-000000292203');
select is(private.can_manage_property('00000000-0000-0000-0000-000000292252'), false,
  'EC4_dueno_removed_MA_sobre_P_ma_pierde_el_poder_de_gestor');
reset role;

-- EC-5: owner de agencia (OA sobre P_ra, ajena a su propiedad directa) — true hoy (vía
-- is_agency_owner_of) y tras el GREEN (vía agency_role_of='owner').
select pg_temp.act_as('00000000-0000-0000-0000-000000292205');
select is(private.can_manage_property('00000000-0000-0000-0000-000000292250'), true,
  'EC5_owner_de_agencia_OA_sobre_P_ra_es_gestor');
reset role;

-- EC-6: admin de agencia (AA sobre P_ra) — TRUE tras el GREEN (HOY false: el helper actual
-- solo compone owner de agencia, nunca admin → RED debe fallar).
select pg_temp.act_as('00000000-0000-0000-0000-000000292206');
select is(private.can_manage_property('00000000-0000-0000-0000-000000292250'), true,
  'EC6_admin_de_agencia_AA_sobre_P_ra_es_gestor');
reset role;

-- EC-7: agente raso ajeno (RA, dueño de P_ra, sobre la P_sa de otro agente de la MISMA
-- agencia) — false hoy y tras el GREEN: RA no es owner/admin de A ni dueño de P_sa.
select pg_temp.act_as('00000000-0000-0000-0000-000000292201');
select is(private.can_manage_property('00000000-0000-0000-0000-000000292251'), false,
  'EC7_agente_raso_ajeno_RA_sobre_P_sa_NO_es_gestor');
reset role;

-- EC-8: tercero (TU, sin ninguna relación) sobre P_ra — false hoy y tras el GREEN.
select pg_temp.act_as('00000000-0000-0000-0000-000000292208');
select is(private.can_manage_property('00000000-0000-0000-0000-000000292250'), false,
  'EC8_tercero_TU_sobre_P_ra_NO_es_gestor');
reset role;

-- EC-9: admin de PLATAFORMA (PA) sobre P_indep (sin agencia) — true hoy y tras el GREEN.
select pg_temp.act_as('00000000-0000-0000-0000-000000292207');
select is(private.can_manage_property('00000000-0000-0000-0000-000000292253'), true,
  'EC9_admin_de_plataforma_PA_sobre_P_indep_es_gestor');
reset role;

-- EC-10: property_id NULL — false SIN lanzar excepción (guardia de boundary), hoy y tras
-- el GREEN (ambas formas filtran `properties.id = p_property_id`, que nunca matchea NULL).
select pg_temp.act_as('00000000-0000-0000-0000-000000292201');
select is(private.can_manage_property(null), false,
  'EC10_property_id_NULL_retorna_false_sin_lanzar_excepcion');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) EC-11 — Paridad: can_manage_property(p) = is_property_comment_manager(p), MISMO actor
--    y MISMA propiedad, para cada rol representativo del fixture (una sola verdad tras el
--    GREEN). Diverge HOY en dueño-suspendido / dueño-removed / admin-de-agencia — RED debe
--    fallar en esos 3; los demás (ya alineados) sirven de guardia de no-regresión.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000292201'); -- RA
select is(
  private.can_manage_property('00000000-0000-0000-0000-000000292250'),
  private.is_property_comment_manager('00000000-0000-0000-0000-000000292250'),
  'EC11a_paridad_dueno_activo_RA_sobre_P_ra'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000292204'); -- IU
select is(
  private.can_manage_property('00000000-0000-0000-0000-000000292253'),
  private.is_property_comment_manager('00000000-0000-0000-0000-000000292253'),
  'EC11b_paridad_dueno_independiente_IU_sobre_P_indep'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000292202'); -- SA
select is(
  private.can_manage_property('00000000-0000-0000-0000-000000292251'),
  private.is_property_comment_manager('00000000-0000-0000-0000-000000292251'),
  'EC11c_paridad_dueno_suspendido_SA_sobre_P_sa (diverge HOY: can_manage=true, comment_manager=false)'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000292203'); -- MA
select is(
  private.can_manage_property('00000000-0000-0000-0000-000000292252'),
  private.is_property_comment_manager('00000000-0000-0000-0000-000000292252'),
  'EC11d_paridad_dueno_removed_MA_sobre_P_ma (diverge HOY: can_manage=true, comment_manager=false)'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000292205'); -- OA
select is(
  private.can_manage_property('00000000-0000-0000-0000-000000292250'),
  private.is_property_comment_manager('00000000-0000-0000-0000-000000292250'),
  'EC11e_paridad_owner_de_agencia_OA_sobre_P_ra'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000292206'); -- AA
select is(
  private.can_manage_property('00000000-0000-0000-0000-000000292250'),
  private.is_property_comment_manager('00000000-0000-0000-0000-000000292250'),
  'EC11f_paridad_admin_de_agencia_AA_sobre_P_ra (diverge HOY: can_manage=false, comment_manager=true)'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000292201'); -- RA sobre propiedad ajena
select is(
  private.can_manage_property('00000000-0000-0000-0000-000000292251'),
  private.is_property_comment_manager('00000000-0000-0000-0000-000000292251'),
  'EC11g_paridad_agente_raso_ajeno_RA_sobre_P_sa'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000292208'); -- TU
select is(
  private.can_manage_property('00000000-0000-0000-0000-000000292250'),
  private.is_property_comment_manager('00000000-0000-0000-0000-000000292250'),
  'EC11h_paridad_tercero_TU_sobre_P_ra'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000292207'); -- PA
select is(
  private.can_manage_property('00000000-0000-0000-0000-000000292253'),
  private.is_property_comment_manager('00000000-0000-0000-0000-000000292253'),
  'EC11i_paridad_admin_de_plataforma_PA_sobre_P_indep'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) EC-12/13/14 — comportamiento OBSERVABLE de las policies VIVAS que consumen el helper
--    (property_videos.videos_select / videos_update), NUNCA una query que rodee RLS.
-- ════════════════════════════════════════════════════════════════════════════

-- EC-12: admin de agencia AA puede UPDATE el video de P_ra — 1 fila tras el GREEN
-- (HOY 0: videos_update usa can_manage_property, que hoy no contempla admin de agencia).
select pg_temp.act_as('00000000-0000-0000-0000-000000292206');
with u as (
  update public.property_videos set duration_seconds = 30
   where id = '00000000-0000-0000-0000-000000292260' returning id
)
select is((select count(*)::int from u), 1,
  'EC12_admin_de_agencia_AA_puede_UPDATE_el_video_de_P_ra');
reset role;

-- EC-13: dueño SUSPENDIDO SA NO ve su propio video (no público, status='uploading') de
-- P_sa vía videos_select — 0 filas tras el GREEN (HOY 1: el cortocircuito de dueño lo
-- sigue dejando ver su propia fila pese a la suspensión).
select pg_temp.act_as('00000000-0000-0000-0000-000000292202');
select is(
  (select count(*)::int from public.property_videos where id = '00000000-0000-0000-0000-000000292261'),
  0,
  'EC13_dueno_suspendido_SA_NO_ve_su_video_no_publico_de_P_sa'
);
reset role;

-- EC-14: NO REGRESIÓN — el owner de agencia OA sigue viendo y pudiendo actualizar el video
-- de P_ra (hoy vía is_agency_owner_of, tras el GREEN vía agency_role_of='owner'): 1 fila en
-- ambos casos, antes y después del GREEN.
select pg_temp.act_as('00000000-0000-0000-0000-000000292205');
select is(
  (select count(*)::int from public.property_videos where id = '00000000-0000-0000-0000-000000292260'),
  1,
  'EC14a_no_regresion_owner_OA_SIGUE_viendo_el_video_de_P_ra'
);
with u as (
  update public.property_videos set duration_seconds = 45
   where id = '00000000-0000-0000-0000-000000292260' returning id
)
select is((select count(*)::int from u), 1,
  'EC14b_no_regresion_owner_OA_SIGUE_pudiendo_actualizar_el_video_de_P_ra');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) EC-15 — Candado de forma: private.can_manage_property sigue SECURITY DEFINER con
--    search_path fijo tras el GREEN (catálogo puro, pasa HOY — guardia contra el GREEN, no
--    un caso RED). Mismo patrón que SIG4/SIG5 de 100_crm_temperature_test.sql.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select prosecdef from pg_proc where proname = 'can_manage_property' and pronamespace = 'private'::regnamespace),
  true,
  'EC15a_can_manage_property_sigue_siendo_security_definer'
);
select is(
  (select proconfig from pg_proc where proname = 'can_manage_property' and pronamespace = 'private'::regnamespace),
  array['search_path=public']::text[],
  'EC15b_can_manage_property_conserva_search_path_fijo'
);

select * from finish();
rollback;
