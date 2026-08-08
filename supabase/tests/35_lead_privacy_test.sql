-- Tests pgTAP — PRIVACIDAD DEL LEAD (PRD §19.1/§19.2), subtarea 75.3.
-- Ejecutar con: supabase test db (CLI global de brew, NUNCA npx supabase)
-- ⚠️ GOTCHA operativo: `supabase test db` NO reaplica migraciones nuevas por sí solo —
-- si agregas la migración GREEN, corre `supabase db reset` antes.
-- Corre como superusuario dentro de una transacción revertida (no persiste). Los
-- fixtures se insertan directo (el superusuario bypassa RLS); las aserciones
-- impersonan con pg_temp.act_as(uid, role) (mismo patrón que 02/08/.../33_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- LA REGLA DEL PRD (§19.1, último bullet; §19.2, primeros dos bullets)
--   · "Las interacciones de un usuario que nunca contactó al agente NO generan
--      registro accesible al agente."
--   · "Mientras el usuario no haya tocado Contactar agente en alguna publicación
--      del agente, el agente NO puede ver NINGÚN dato personal del usuario."
--   · Solo DESPUÉS de crear el lead el agente obtiene "acceso retroactivo al
--      historial completo de interacciones de ese usuario con TODAS las
--      publicaciones del agente".
--
-- Es decir: el evento se REGISTRA SIEMPRE (events_raw, #112) pero se EXPONE solo
-- si existe un lead ACTIVO entre ese usuario y ese agente. Registrar ≠ exponer.
--
-- ════════════════════════════════════════════════════════════════════════════
-- CONTEXTO MEDIDO EN PRODUCCIÓN (2026-08-08, NO supuesto)
--   La policy vigente es:
--       events_raw_select using (user_id = auth.uid()
--                                OR private.can_manage_property(property_id))
--   …que NO menciona al lead. Verificado por impersonación con un JWT real: el
--   agente Ramos leyó filas `video_view` de OTRO usuario sobre propiedades suyas
--   sin que ese usuario lo hubiera contactado nunca. La fuga es REAL y está VIVA;
--   la introdujo la migración 20260808000001 (#112) al abrir la puerta de lectura
--   sin la condición del lead que §19.2 exige.
--
--   `private.can_view_user_as_lead_searcher(uuid)` YA EXISTE (20260702000001,
--   extendida en 20260807000005) y compone exactamente la condición que falta:
--   lead ACTIVO (deleted_at is null) del usuario, con el agente dueño o con
--   owner/admin de la agencia de ese lead. Se REUSA — no se escribe un helper nuevo.
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: la policy SELECT de public.events_raw, ejercitada con SELECT
-- reales bajo `act_as` (comportamiento observable, no internals).
-- SUT (GREEN, fuera de esta fase RED): migración que reemplaza events_raw_select
-- por `using (user_id = auth.uid() OR private.is_admin() OR
-- (private.can_manage_property(property_id) AND
--  private.can_view_user_as_lead_searcher(user_id)))`.
-- La rama `private.is_admin()` se conserva EXPLÍCITA: hoy el admin de plataforma
-- ya lee todo (via can_manage_property) y §19.2 legisla sobre AGENTES, no sobre
-- moderación. Quitársela sería un cambio de alcance no pedido.
--
-- ── Convención DELTA vs INVARIANTE (heredada de 21/25/.../33) ────────────────
-- DELTA      = falla HOY, pasa tras el GREEN. Es la fuga que se cierra.
-- INVARIANTE = ya pasa hoy y DEBE seguir pasando: son las capacidades que el
--              cierre NO puede romper (el CRM tiene que seguir funcionando).
--
-- ── Edge cases enumerados ───────────────────────────────────────────────────
--  1. Usuario sin lead, propiedad del agente        → el agente NO ve nada  [DELTA]
--  2. Usuario CON lead, propiedad del agente        → sí ve                [INV]
--  3. Usuario CON lead, TODAS las publicaciones     → §19.2 retroactivo    [INV]
--  4. Usuario CON lead de OTRO agente               → no ve                [INV]
--  5. Agente sin lead con ese usuario               → no ve                [DELTA]
--  6/7. El propio usuario siempre lee sus eventos   → no se rompe          [INV]
--  8/9. Owner de la agencia hereda la MISMA regla   → ve con lead, no sin   [INV/DELTA]
-- 10. Admin de la agencia idem                      → ve con lead          [INV]
-- 11. Lead borrado (deleted_at) revoca el acceso    → el permiso caduca    [DELTA]
-- 12. anon nunca lee                                → invariante de siempre [INV]
-- 13/14. La otra mitad de §19.2 (datos personales)  → users_select          [INV]
-- 15. La escritura de #112 sigue viva               → no se rompe la captura[INV]
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(15);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '...0000000753XX' (subtarea 75.3; sin colisión con
-- 07/075101-075299/075501-075642/075801-075882/1121XX de archivos previos).
--   U1  buscador que SÍ contactó a GA (tiene lead activo) : ...075301
--   U2  buscador que NUNCA contactó a nadie               : ...075302
--   GA  agente, dueño de PA y PA2                         : ...075303
--   GB  agente de otra agencia, dueño de PB               : ...075304
--   OA  owner ACTIVO de la agencia de GA                  : ...075305
--   AD  admin ACTIVO de la agencia de GA                  : ...075306
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000075301', 'u1.753@test.local'),
  ('00000000-0000-0000-0000-000000075302', 'u2.753@test.local'),
  ('00000000-0000-0000-0000-000000075303', 'ga.753@test.local'),
  ('00000000-0000-0000-0000-000000075304', 'gb.753@test.local'),
  ('00000000-0000-0000-0000-000000075305', 'oa.753@test.local'),
  ('00000000-0000-0000-0000-000000075306', 'ad.753@test.local');

-- Identidad del buscador U1 — para las aserciones §19.4 (USR1/USR2).
update public.users set first_name = 'Uno', last_name = 'Buscador', phone = '+521111111111'
  where id = '00000000-0000-0000-0000-000000075301';
update public.users set first_name = 'Dos', last_name = 'Anonimo', phone = '+522222222222'
  where id = '00000000-0000-0000-0000-000000075302';

update public.users set role = 'agent', is_verified_agent = true
  where id in ('00000000-0000-0000-0000-000000075303',   -- GA
               '00000000-0000-0000-0000-000000075304');  -- GB

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000075310', 'Inmobiliaria Privacidad 753', 'inmo-priv-753', 'active',
   '00000000-0000-0000-0000-000000075305');

insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000075351', '00000000-0000-0000-0000-000000075310', '00000000-0000-0000-0000-000000075305', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000075352', '00000000-0000-0000-0000-000000075310', '00000000-0000-0000-0000-000000075306', 'admin', 'active'),
  ('00000000-0000-0000-0000-000000075353', '00000000-0000-0000-0000-000000075310', '00000000-0000-0000-0000-000000075303', 'agent', 'active');
-- GB NO pertenece a esta agencia — imprescindible para el aislamiento cruzado.

-- PA y PA2 son AMBAS de GA: §19.2 habla del historial con **TODAS** las
-- publicaciones del agente, no solo con la que originó el contacto.
insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000075321', '00000000-0000-0000-0000-000000075303',
   '00000000-0000-0000-0000-000000075310', 'departamento', 'rent', 'Fixture 753 — PA (de GA)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-000000075322', '00000000-0000-0000-0000-000000075303',
   '00000000-0000-0000-0000-000000075310', 'casa', 'sale', 'Fixture 753 — PA2 (tambien de GA)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.34, 20.66), 4326)::extensions.geography, 3000000, 'active'),
  ('00000000-0000-0000-0000-000000075323', '00000000-0000-0000-0000-000000075304',
   null, 'casa', 'sale', 'Fixture 753 — PB (de GB, otra agencia)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography, 2500000, 'active');

-- El lead que DESBLOQUEA el acceso: U1 contactó a GA. U2 no contactó a nadie.
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000075331', '00000000-0000-0000-0000-000000075303',
   '00000000-0000-0000-0000-000000075301', 'whatsapp_opened');

-- Eventos crudos sembrados directo (bypass RLS como superusuario). Representan
-- interacciones ANTERIORES al contacto — justo el "historial retroactivo".
--   E1: U1 sobre PA  (de GA)
--   E2: U1 sobre PA2 (de GA)  → cubre "TODAS las publicaciones del agente"
--   E3: U2 sobre PA  (de GA)  → el usuario que NUNCA contactó: LA FUGA
--   E4: U1 sobre PB  (de GB)  → aislamiento cruzado por agente
insert into public.events_raw (event_type, user_id, property_id, payload) values
  ('video_view',      '00000000-0000-0000-0000-000000075301', '00000000-0000-0000-0000-000000075321', '{}'::jsonb),
  ('video_completed', '00000000-0000-0000-0000-000000075301', '00000000-0000-0000-0000-000000075322', '{}'::jsonb),
  ('video_view',      '00000000-0000-0000-0000-000000075302', '00000000-0000-0000-0000-000000075321', '{}'::jsonb),
  ('video_view',      '00000000-0000-0000-0000-000000075301', '00000000-0000-0000-0000-000000075323', '{}'::jsonb);

-- Helper de impersonación inline (mismo patrón que 02/08/.../33_*).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- Conteo envuelto: si el conteo no coincide, `raise exception` y lives_ok lo
-- reporta como FAIL sin abortar la transacción (mismo patrón que 28/.../33_*).
create or replace function pg_temp.count_is(p_sql text, p_expected bigint)
returns void language plpgsql as $$
declare v bigint;
begin
  execute p_sql into v;
  if v is distinct from p_expected then
    raise exception 'esperaba % filas, obtuve %', p_expected, v;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) LA FUGA — el agente NO ve las interacciones de quien nunca lo contactó.
-- ════════════════════════════════════════════════════════════════════════════

-- PRIV1 [DELTA] — el corazón de §19.1. HOY DEVUELVE 1 (fuga viva): la propiedad
-- es de GA, así que can_manage_property basta y el lead nunca se consulta.
select pg_temp.act_as('00000000-0000-0000-0000-000000075303'); -- GA
select lives_ok(
  $$ select pg_temp.count_is(
       'select count(*) from public.events_raw where user_id = ''00000000-0000-0000-0000-000000075302''', 0) $$,
  'PRIV1_agente_NO_ve_interacciones_de_usuario_que_nunca_lo_contacto'
);
reset role;

-- PRIV5 [DELTA] — simétrico por el otro lado: GB es dueño de PB y U1 interactuó
-- con PB, pero U1 nunca contactó a GB. Sin lead, no hay acceso.
select pg_temp.act_as('00000000-0000-0000-0000-000000075304'); -- GB
select lives_ok(
  $$ select pg_temp.count_is(
       'select count(*) from public.events_raw where user_id = ''00000000-0000-0000-0000-000000075301''', 0) $$,
  'PRIV5_agente_sin_lead_con_ese_usuario_NO_ve_sus_interacciones'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) LO QUE EL CIERRE NO PUEDE ROMPER — el acceso legítimo tras el contacto.
-- ════════════════════════════════════════════════════════════════════════════

-- PRIV2 [INVARIANTE] — happy path: U1 es lead de GA, PA es de GA.
select pg_temp.act_as('00000000-0000-0000-0000-000000075303'); -- GA
select lives_ok(
  $$ select pg_temp.count_is(
       'select count(*) from public.events_raw where user_id = ''00000000-0000-0000-0000-000000075301''
          and property_id = ''00000000-0000-0000-0000-000000075321''', 1) $$,
  'PRIV2_agente_SI_ve_interacciones_de_su_lead_en_su_propiedad'
);

-- PRIV3 [INVARIANTE] — §19.2 literal: el historial cubre TODAS las publicaciones
-- del agente (PA + PA2), no solo la que originó el contacto. Si alguien "cierra"
-- la fuga acotando por lead_origin_properties, este assert lo caza.
select lives_ok(
  $$ select pg_temp.count_is(
       'select count(*) from public.events_raw where user_id = ''00000000-0000-0000-0000-000000075301''', 2) $$,
  'PRIV3_historial_retroactivo_cubre_TODAS_las_publicaciones_del_agente'
);

-- PRIV4 [INVARIANTE] — pero NO se extiende a propiedades de otros agentes: el
-- conteo de PRIV3 es 2 (PA + PA2), nunca 3 (E4 sobre PB queda fuera).
select lives_ok(
  $$ select pg_temp.count_is(
       'select count(*) from public.events_raw where property_id = ''00000000-0000-0000-0000-000000075323''', 0) $$,
  'PRIV4_el_historial_NO_alcanza_publicaciones_de_otro_agente'
);
reset role;

-- PRIV8 [INVARIANTE] — el owner de la agencia hereda la vista del equipo.
select pg_temp.act_as('00000000-0000-0000-0000-000000075305'); -- OA
select lives_ok(
  $$ select pg_temp.count_is(
       'select count(*) from public.events_raw where user_id = ''00000000-0000-0000-0000-000000075301''', 2) $$,
  'PRIV8_owner_de_la_agencia_ve_el_historial_del_lead_de_su_equipo'
);

-- PRIV9 [DELTA] — …pero hereda también el LÍMITE: sin lead, tampoco ve.
select lives_ok(
  $$ select pg_temp.count_is(
       'select count(*) from public.events_raw where user_id = ''00000000-0000-0000-0000-000000075302''', 0) $$,
  'PRIV9_owner_de_la_agencia_NO_ve_a_quien_nunca_contacto_al_equipo'
);
reset role;

-- PRIV10 [INVARIANTE] — el admin de inmobiliaria (75.5) queda igual que el owner.
select pg_temp.act_as('00000000-0000-0000-0000-000000075306'); -- AD
select lives_ok(
  $$ select pg_temp.count_is(
       'select count(*) from public.events_raw where user_id = ''00000000-0000-0000-0000-000000075301''', 2) $$,
  'PRIV10_admin_de_la_agencia_ve_el_historial_del_lead_de_su_equipo'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) EL DUEÑO DE SUS DATOS — el usuario siempre lee lo suyo.
-- ════════════════════════════════════════════════════════════════════════════

-- PRIV6 [INVARIANTE] — U1 ve sus 3 eventos (PA, PA2 y PB): la restricción es
-- sobre lo que ve el AGENTE, nunca sobre lo que ve el propio usuario.
select pg_temp.act_as('00000000-0000-0000-0000-000000075301'); -- U1
select lives_ok(
  $$ select pg_temp.count_is('select count(*) from public.events_raw', 3) $$,
  'PRIV6_el_usuario_lee_TODOS_sus_propios_eventos'
);

-- INS1 [INVARIANTE] — la captura de #112 sigue viva tras el cierre.
select lives_ok(
  $$
  insert into public.events_raw (event_type, user_id, property_id, payload)
  values ('app_open', '00000000-0000-0000-0000-000000075301', null, '{}'::jsonb)
  $$,
  'INS1_el_usuario_sigue_pudiendo_escribir_sus_propios_eventos'
);
reset role;

-- PRIV7 [INVARIANTE] — U2, que nunca contactó a nadie, sigue viendo lo suyo.
select pg_temp.act_as('00000000-0000-0000-0000-000000075302'); -- U2
select lives_ok(
  $$ select pg_temp.count_is('select count(*) from public.events_raw', 1) $$,
  'PRIV7_el_usuario_sin_lead_lee_sus_propios_eventos'
);
reset role;

-- ANON1 [INVARIANTE] — anon jamás.
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select 1 from public.events_raw $$,
  null,
  null,
  'ANON1_anon_no_lee_events_raw'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) LA OTRA MITAD DE §19.2 — datos personales del usuario (users_select).
--    Ya la cubre 08_rls_lead_searcher_test.sql; aquí van dos pines locales para
--    que el GREEN de events_raw no pueda romperla sin que este archivo lo grite.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000075303'); -- GA

-- USR1 [INVARIANTE] — antes del contacto no hay dato personal que valga.
select lives_ok(
  $$ select pg_temp.count_is(
       'select count(*) from public.users where id = ''00000000-0000-0000-0000-000000075302''', 0) $$,
  'USR1_agente_NO_lee_la_fila_users_de_quien_nunca_lo_contacto'
);

-- USR2 [INVARIANTE] — tras el contacto sí: nombre y teléfono (§19.4).
select lives_ok(
  $$ select pg_temp.count_is(
       'select count(*) from public.users where id = ''00000000-0000-0000-0000-000000075301''
          and first_name = ''Uno'' and phone = ''+521111111111''', 1) $$,
  'USR2_agente_SI_lee_nombre_y_telefono_de_su_lead'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) EL PERMISO CADUCA — borrar el lead revoca el acceso retroactivo.
--    Va al FINAL: muta el fixture del lead y todo lo anterior depende de él.
-- ════════════════════════════════════════════════════════════════════════════

update public.leads set deleted_at = now()
  where id = '00000000-0000-0000-0000-000000075331';

-- PRIV11 [DELTA] — sin lead ACTIVO el agente vuelve a no ver nada. Hoy falla
-- porque la policy nunca miró el lead: borrarlo no cambia nada.
select pg_temp.act_as('00000000-0000-0000-0000-000000075303'); -- GA
select lives_ok(
  $$ select pg_temp.count_is(
       'select count(*) from public.events_raw where user_id = ''00000000-0000-0000-0000-000000075301''', 0) $$,
  'PRIV11_borrar_el_lead_revoca_el_acceso_al_historial'
);
reset role;

select * from finish();
rollback;
