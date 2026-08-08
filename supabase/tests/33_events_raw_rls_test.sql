-- Tests pgTAP — RLS de events_raw: el usuario escribe sus propios eventos; el
-- agente (y el owner/admin de su inmobiliaria) lee los eventos de SUS propiedades
-- (subtarea 112.1, origen: producto(75.2) "estadísticas tangibles del lead").
-- Ejecutar con: supabase test db (CLI global de brew, NUNCA npx supabase)
-- ⚠️ GOTCHA operativo: `supabase test db` NO reaplica migraciones nuevas por sí solo — si
-- agregas la migración GREEN, corre `supabase db reset` antes.
-- Corre como superusuario dentro de una transacción revertida (no persiste). Los
-- fixtures se insertan directo (el superusuario bypassa RLS); las aserciones
-- impersonan con pg_temp.act_as(uid, role) (mismo patrón que 02/08/18/21/25/27/28/
-- 29/30/31_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- CONTEXTO (verificado en esta sesión, NO supuesto):
--   · public.events_raw YA EXISTE (20260604000007) con el shape correcto
--     (event_type, user_id, property_id, property_video_id, agent_id, payload,
--     device, session_id, created_at) — no hace falta ninguna migración de shape.
--   · RLS está ACTIVO y tiene **0 policies** — confirmado en el stack local:
--       pg_class.relrowsecurity = true, pg_policies (tablename='events_raw') = 0 filas.
--   · El rol `authenticated` NO tiene NINGÚN grant de tabla sobre events_raw
--     (\dp public.events_raw → solo postgres y service_role) — confirmado en el
--     stack local. Por eso HOY *cualquier* SELECT/INSERT bajo impersonación truena
--     con "permission denied for table events_raw" (42501), no con "0 filas" — es
--     un bloqueo total, no un filtro. Todas las aserciones de este archivo son por
--     lo tanto DELTA (hoy truenan; tras el GREEN deben "vivir" con el resultado
--     correcto), salvo las de suplantación/anon, que son INVARIANTE (hoy truenan
--     por falta de grant; tras el GREEN deben seguir truenando, pero por el
--     with_check/ausencia de policy — mismo efecto observable, razón distinta).
--   · likes/saves ya escriben DIRECTO desde el cliente con RLS de este mismo
--     patrón (`user_id = auth.uid()`) — events_raw sigue ese precedente, no una EF.
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba (comportamiento observable vía impersonación JWT, NO
-- internals): las policies RLS INSERT/SELECT de public.events_raw + sus grants de
-- tabla a `authenticated`, ejercitadas con INSERT/SELECT reales bajo `act_as`.
-- SUT (AÚN NO EXISTE — GREEN, fuera de esta fase RED): una migración nueva que
-- agrega (a) `grant insert, select on public.events_raw to authenticated`,
-- (b) policy `events_raw_insert` (`with check (user_id = (select auth.uid()))`),
-- (c) policy `events_raw_select` (`using (user_id = (select auth.uid()) or
-- private.can_manage_property(property_id))` — REUSA el helper existente
-- `private.can_manage_property` (20260604000010), que ya compone dueño de la
-- propiedad + owner de su agencia (`private.is_agency_owner_of`) + admin global;
-- NO se reescribe), y (d) 2 índices nuevos: `events_raw_user_property_idx
-- (user_id, property_id)` y `events_raw_property_event_type_idx (property_id,
-- event_type)` para las agregaciones futuras del CRM (112.3).
-- ⚠️ NO se toca `leads_select`/`leads.score`/`leads.level` — la fórmula de
-- scoring sigue viva (deuda #108); esta subtarea es SOLO la puerta de datos
-- crudos de events_raw, el consumo agregado es 112.3.
-- ⚠️ BREADCRUMB para el GREEN/guardian: `02_rls_test.sql:144` tiene HOY
-- `throws_ok($$ select 1 from public.events_raw $$, null, 'authenticated no puede
-- leer events_raw')` — una vez exista la policy SELECT ese assert queda MAL
-- (un authenticated SÍ puede leer sus propios eventos) y debe acotarse a "no lee
-- eventos AJENOS" o eliminarse a favor de este archivo (más preciso). No se toca
-- en este RED porque hoy sigue siendo verdadero (ni policy ni grant existen) —
-- es trabajo del GREEN, no de esta fase.
--
-- ── Estrategia RED sin abortar la transacción ────────────────────────────────
-- Como HOY no hay grant de tabla, un SELECT/INSERT crudo bajo impersonación NO
-- devuelve "0 filas" silenciosamente — TRUENA (permission denied). Un `select
-- is((select count(*) from events_raw ...))` sin envolver abortaría la
-- transacción completa y tumbaría el resto de los asserts. Por eso TODA
-- verificación de conteo va envuelta en `lives_ok($$ do $do$ ... raise exception
-- si no matchea ... $do$; $$, msg)` (mismo patrón que 28/29/30/31_*): `lives_ok`
-- atrapa la excepción (venga de la falta de grant HOY, o de una cuenta
-- incorrecta tras el GREEN) y la reporta como FAIL, sin abortar el archivo.
--
-- ── Convención DELTA vs INVARIANTE (heredada de 21/25/27/28/29/30/31) ────────
-- DELTA      = falla hoy (por permission denied o por conteo en 0), pasa tras GREEN.
-- INVARIANTE = ya "falla" hoy con el mismo resultado observable (excepción) que
--              debe seguir dando tras el GREEN, aunque cambie el mecanismo interno.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ─────────────────
-- Happy path:
--   · INSERT propio (user_id = auth.uid()) → vive.
--   · SELECT propio (el usuario ve sus propios eventos, incluso sobre una
--     propiedad que no es suya).
--   · SELECT del agente dueño de la propiedad (ve los eventos de TODOS los
--     usuarios sobre su propiedad).
-- Ramas no obvias (derivadas de reusar private.can_manage_property):
--   · El OWNER de la agencia del agente también ve los eventos de esa propiedad
--     (can_manage_property compone is_agency_owner_of, no solo el dueño directo).
-- Aislamiento (la clase de fuga de #100 / review de #75):
--   · Un agente NO ve eventos de la propiedad de OTRO agente (misma o distinta
--     inmobiliaria).
--   · El owner de la agencia A NO ve eventos de una propiedad de un agente que
--     NO pertenece a su agencia (cross-agencia, el mutante clásico de #100).
--   · Un tercero sin relación (ni dueño del evento, ni dueño/owner de la
--     propiedad) no ve nada — can_manage_property(property_id) debe devolver
--     false de forma segura, no truene.
-- Boundary / error:
--   · INSERT suplantando a otro usuario (user_id ≠ auth.uid()) → falla siempre.
--   · INSERT con user_id NULL bajo `authenticated` → falla siempre (NULL no es un
--     escape hatch del with_check; NULL = auth.uid() nunca es true).
--   · anon no puede INSERTAR eventos (requiere autenticación, PRD-CRM no define
--     telemetría anónima en el alcance de esta subtarea).
--   · anon no puede LEER events_raw (fail-closed, mismo criterio que el resto de
--     tablas con datos de comportamiento).
-- Shape:
--   · Índices nuevos para las agregaciones (user_id, property_id) y
--     (property_id, event_type) existen.
-- Append-only [INVARIANTE, pin de regresión — agregado en subtarea 112.3, deuda
-- detectada por el guardian de 112.1]:
--   · authenticated NO puede UPDATE su propio evento (hoy solo se sostiene por
--     ausencia de grant, no por un assert explícito — un grant de más a futuro
--     dejaría al usuario alterar la evidencia de su propio comportamiento).
--   · authenticated NO puede DELETE su propio evento (mismo razonamiento — el dato
--     que el agente necesita poder creer).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(18);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '...0000001121XX' (subtarea 112.1, sin colisión con
-- los rangos de 07/075101-075299/075501-075542/075801-075882/0000000000XX de
-- archivos previos).
--   U1  buscador plano                              : ...112101
--   GA  agente, dueño de la propiedad PA             : ...112102
--   GB  agente B, dueño de la propiedad PB (aislado) : ...112103
--   OA  owner ACTIVO de la agencia de GA             : ...112104
--   U2  otro buscador (para insert-suplantando + aislamiento entre usuarios) : ...112105
--   TZ  tercero sin relación con nada de lo anterior : ...112106
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000112101', 'u1.1121@test.local'),
  ('00000000-0000-0000-0000-000000112102', 'ga.1121@test.local'),
  ('00000000-0000-0000-0000-000000112103', 'gb.1121@test.local'),
  ('00000000-0000-0000-0000-000000112104', 'oa.1121@test.local'),
  ('00000000-0000-0000-0000-000000112105', 'u2.1121@test.local'),
  ('00000000-0000-0000-0000-000000112106', 'tz.1121@test.local');

update public.users set role = 'agent', is_verified_agent = true
  where id in (
    '00000000-0000-0000-0000-000000112102', -- GA
    '00000000-0000-0000-0000-000000112103'  -- GB
  );

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000112110', 'Inmobiliaria Events 1121', 'inmo-events-1121', 'active', '00000000-0000-0000-0000-000000112104');

insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000112110', '00000000-0000-0000-0000-000000112104', 'owner', 'active'), -- OA
  ('00000000-0000-0000-0000-000000112110', '00000000-0000-0000-0000-000000112102', 'agent', 'active'); -- GA
-- GB NO pertenece a AG1 (independiente) — imprescindible para el aislamiento cross-agencia.

insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000112121', '00000000-0000-0000-0000-000000112102',
   '00000000-0000-0000-0000-000000112110',
   'departamento', 'rent', 'Fixture events_raw 1121 — PA (de GA)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-000000112122', '00000000-0000-0000-0000-000000112103',
   null,
   'casa', 'sale', 'Fixture events_raw 1121 — PB (de GB, independiente)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography, 2500000, 'active');

-- Eventos crudos sembrados directo (bypass RLS, como superusuario) — la escritura
-- vía RLS se prueba aparte en la sección INSERT.
--   E1: U1 sobre PA (de GA)
--   E2: U2 sobre PA (de GA) — para que "GA ve los eventos de SU propiedad" cubra
--       más de un usuario, no solo el propio agente.
--   E3: U1 sobre PB (de GB) — usado en el aislamiento cross-agente/cross-agencia.
insert into public.events_raw (event_type, user_id, property_id, payload) values
  ('video_view', '00000000-0000-0000-0000-000000112101', '00000000-0000-0000-0000-000000112121', '{}'::jsonb),
  ('video_view', '00000000-0000-0000-0000-000000112105', '00000000-0000-0000-0000-000000112121', '{}'::jsonb),
  ('video_view', '00000000-0000-0000-0000-000000112101', '00000000-0000-0000-0000-000000112122', '{}'::jsonb);

-- Helper de impersonación inline (mismo patrón que 02/08/18/21/25/27/28/29/30/31_*).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) SHAPE [DELTA] — índices nuevos para las agregaciones del CRM (112.3).
-- ════════════════════════════════════════════════════════════════════════════

select has_index('public', 'events_raw', 'events_raw_user_property_idx',
  'SH1_existe_indice_user_property_para_agregaciones_por_usuario_y_propiedad');

select has_index('public', 'events_raw', 'events_raw_property_event_type_idx',
  'SH2_existe_indice_property_event_type_para_agregaciones_por_propiedad_y_tipo');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) INSERT — el usuario escribe SUS PROPIOS eventos, nunca a nombre de otro.
-- ════════════════════════════════════════════════════════════════════════════

-- INS1 [DELTA] happy path: U1 inserta un evento propio (property_id NULL a
-- propósito — un evento no atado a propiedad, p.ej. app_open — para no
-- contaminar los conteos por propiedad de las secciones 3/4 más abajo).
select pg_temp.act_as('00000000-0000-0000-0000-000000112101'); -- U1
select lives_ok(
  $$
  insert into public.events_raw (event_type, user_id, property_id, payload)
  values ('app_open', '00000000-0000-0000-0000-000000112101', null, '{}'::jsonb)
  $$,
  'INS1_usuario_inserta_su_propio_evento_ok'
);
reset role;

-- INS2 [INVARIANTE] U1 intenta insertar un evento A NOMBRE DE U2 (suplantación) → falla.
select pg_temp.act_as('00000000-0000-0000-0000-000000112101'); -- U1
select throws_ok(
  $$
  insert into public.events_raw (event_type, user_id, property_id, payload)
  values ('video_view', '00000000-0000-0000-0000-000000112105', '00000000-0000-0000-0000-000000112121', '{}'::jsonb)
  $$,
  null,
  'INS2_usuario_no_puede_insertar_evento_a_nombre_de_otro_usuario_suplantacion'
);
reset role;

-- INS3 [INVARIANTE, boundary] U1 autenticado intenta insertar con user_id NULL →
-- falla (NULL no es un escape hatch: NULL = auth.uid() nunca evalúa a true).
select pg_temp.act_as('00000000-0000-0000-0000-000000112101'); -- U1
select throws_ok(
  $$
  insert into public.events_raw (event_type, user_id, property_id, payload)
  values ('video_view', null, '00000000-0000-0000-0000-000000112121', '{}'::jsonb)
  $$,
  null,
  'INS3_insert_con_user_id_null_falla_no_es_escape_hatch_del_with_check'
);
reset role;

-- INS4 [INVARIANTE] anon (sin autenticar) no puede insertar eventos.
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$
  insert into public.events_raw (event_type, user_id, property_id, payload)
  values ('video_view', '00000000-0000-0000-0000-000000112101', '00000000-0000-0000-0000-000000112121', '{}'::jsonb)
  $$,
  null,
  'INS4_anon_no_puede_insertar_eventos'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) SELECT propio — el usuario ve sus propios eventos, no los de otro.
-- ════════════════════════════════════════════════════════════════════════════

-- SEL1 [DELTA] U1 ve su propio evento sobre PA (E1).
select pg_temp.act_as('00000000-0000-0000-0000-000000112101'); -- U1
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    select count(*) into v_count from public.events_raw
      where user_id = '00000000-0000-0000-0000-000000112101'
        and property_id = '00000000-0000-0000-0000-000000112121';
    if v_count is distinct from 1 then
      raise exception 'esperaba 1 evento propio de U1 sobre PA, fueron %', v_count;
    end if;
  end
  $do$;
  $$,
  'SEL1_usuario_ve_su_propio_evento_sobre_una_propiedad_que_no_es_suya'
);
reset role;

-- SEL2 [DELTA] U2 ve su propio evento sobre PA (E2).
select pg_temp.act_as('00000000-0000-0000-0000-000000112105'); -- U2
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    select count(*) into v_count from public.events_raw
      where user_id = '00000000-0000-0000-0000-000000112105';
    if v_count is distinct from 1 then
      raise exception 'esperaba 1 evento propio de U2, fueron %', v_count;
    end if;
  end
  $do$;
  $$,
  'SEL2_usuario_ve_su_propio_evento'
);
reset role;

-- SEL3 [DELTA] U2 NO ve el evento de U1, aunque sea sobre la MISMA propiedad PA
-- (aislamiento entre buscadores — ninguno de los dos es dueño de PA).
select pg_temp.act_as('00000000-0000-0000-0000-000000112105'); -- U2
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    select count(*) into v_count from public.events_raw
      where user_id = '00000000-0000-0000-0000-000000112101';
    if v_count is distinct from 0 then
      raise exception 'U2 NO debe ver eventos de U1 (ninguno es dueño de la propiedad); vio %', v_count;
    end if;
  end
  $do$;
  $$,
  'SEL3_usuario_no_ve_eventos_de_otro_usuario_sobre_la_misma_propiedad_ajena_a_ambos'
);
reset role;

-- SEL4 [INVARIANTE] anon no puede leer events_raw en absoluto (fail-closed).
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select 1 from public.events_raw $$,
  null,
  'SEL4_anon_no_puede_leer_events_raw'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) SELECT del agente dueño (y del owner de su agencia) — reusa
--    private.can_manage_property, no se reescribe.
-- ════════════════════════════════════════════════════════════════════════════

-- OWN1 [DELTA] GA (dueño de PA) ve los eventos de TODOS los usuarios sobre PA (E1+E2 = 2).
select pg_temp.act_as('00000000-0000-0000-0000-000000112102'); -- GA
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    select count(*) into v_count from public.events_raw
      where property_id = '00000000-0000-0000-0000-000000112121';
    if v_count is distinct from 2 then
      raise exception 'esperaba 2 eventos sobre PA (de U1 y U2) vistos por su agente dueño GA, fueron %', v_count;
    end if;
  end
  $do$;
  $$,
  'OWN1_agente_dueno_de_la_propiedad_ve_los_eventos_de_todos_los_usuarios_sobre_ella'
);
reset role;

-- OWN2 [DELTA, rama no obvia] OA (owner de la agencia de GA) TAMBIÉN ve los
-- eventos de PA — private.can_manage_property compone is_agency_owner_of, no
-- solo el dueño directo de la fila.
select pg_temp.act_as('00000000-0000-0000-0000-000000112104'); -- OA
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    select count(*) into v_count from public.events_raw
      where property_id = '00000000-0000-0000-0000-000000112121';
    if v_count is distinct from 2 then
      raise exception 'esperaba 2 eventos sobre PA vistos por el owner de la agencia de GA, fueron %', v_count;
    end if;
  end
  $do$;
  $$,
  'OWN2_owner_de_la_agencia_del_agente_tambien_ve_los_eventos_de_la_propiedad_de_su_agente'
);
reset role;

-- OWN3 [DELTA] GB (dueño de PB, independiente) ve el evento sobre su propia
-- propiedad (E3 = 1) — sanity recíproco, sin depender de ninguna agencia.
select pg_temp.act_as('00000000-0000-0000-0000-000000112103'); -- GB
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    select count(*) into v_count from public.events_raw
      where property_id = '00000000-0000-0000-0000-000000112122';
    if v_count is distinct from 1 then
      raise exception 'esperaba 1 evento sobre PB visto por su agente dueño GB (independiente, sin agencia), fueron %', v_count;
    end if;
  end
  $do$;
  $$,
  'OWN3_agente_independiente_ve_los_eventos_de_su_propia_propiedad_sin_agencia'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) [DELTA — mutante clásico #100/#75.5] Aislamiento cross-agente y
--    cross-agencia: un agente NUNCA ve eventos de la propiedad de OTRO agente,
--    ni siquiera el owner de su propia agencia si esa propiedad es de un agente
--    AJENO a la agencia.
-- ════════════════════════════════════════════════════════════════════════════

-- ISO1 [DELTA] GA (dueño de PA) NO ve los eventos de PB (propiedad de GB, otro agente).
select pg_temp.act_as('00000000-0000-0000-0000-000000112102'); -- GA
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    select count(*) into v_count from public.events_raw
      where property_id = '00000000-0000-0000-0000-000000112122';
    if v_count is distinct from 0 then
      raise exception 'GA NO debe ver eventos de PB (propiedad de OTRO agente); vio %', v_count;
    end if;
  end
  $do$;
  $$,
  'ISO1_agente_no_ve_eventos_de_la_propiedad_de_otro_agente_aislamiento'
);
reset role;

-- ISO2 [DELTA] OA (owner de la agencia de GA) NO ve los eventos de PB, porque
-- GB NO pertenece a su agencia (mismo defecto que #100: membresía compartida
-- laxa vs. dueño real de la fila).
select pg_temp.act_as('00000000-0000-0000-0000-000000112104'); -- OA
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    select count(*) into v_count from public.events_raw
      where property_id = '00000000-0000-0000-0000-000000112122';
    if v_count is distinct from 0 then
      raise exception 'el owner de la agencia de GA NO debe ver eventos de la propiedad de un agente AJENO a su agencia; vio %', v_count;
    end if;
  end
  $do$;
  $$,
  'ISO2_owner_de_agencia_no_ve_eventos_de_propiedad_de_agente_de_otra_agencia_cross_agencia'
);
reset role;

-- ISO3 [DELTA] TZ, un tercero sin relación (ni dueño de ningún evento, ni dueño
-- ni owner de agencia de PA/PB), no ve NADA de los eventos de ninguna propiedad
-- — can_manage_property(property_id) debe devolver false de forma segura.
select pg_temp.act_as('00000000-0000-0000-0000-000000112106'); -- TZ
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    select count(*) into v_count from public.events_raw
      where property_id in (
        '00000000-0000-0000-0000-000000112121',
        '00000000-0000-0000-0000-000000112122'
      );
    if v_count is distinct from 0 then
      raise exception 'un tercero sin relación con PA ni PB no debe ver ningún evento; vio %', v_count;
    end if;
  end
  $do$;
  $$,
  'ISO3_tercero_sin_relacion_no_ve_eventos_de_ninguna_propiedad'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) APPEND-ONLY [INVARIANTE, pin de regresión] — authenticated NO puede UPDATE ni
--    DELETE sobre events_raw, ni siquiera SUS PROPIAS filas. events_raw está
--    documentada como append-only (20260604000007:19-20), pero hoy eso se sostiene
--    SOLO por ausencia de grant (20260808000001 concede insert, select — nunca
--    update/delete). Estos 2 asserts fijan esa garantía como PIN: deben pasar DE
--    INMEDIATO con la migración actual (no son un RED) — si algún día un grant de
--    más habilita update/delete, este archivo lo caza antes de que un usuario pueda
--    borrar la evidencia de su propio comportamiento (deuda detectada por el
--    guardian de 112.1, cerrada en la subtarea 112.3).
-- ════════════════════════════════════════════════════════════════════════════

-- APPEND1 [INVARIANTE] U1 no puede UPDATE su propio evento (E1, sobre PA).
select pg_temp.act_as('00000000-0000-0000-0000-000000112101'); -- U1
select throws_ok(
  $$
  update public.events_raw
     set payload = '{"tampered": true}'::jsonb
   where user_id = '00000000-0000-0000-0000-000000112101'
     and property_id = '00000000-0000-0000-0000-000000112121'
  $$,
  null,
  'APPEND1_authenticated_no_puede_actualizar_ni_su_propio_evento'
);
reset role;

-- APPEND2 [INVARIANTE] U1 no puede DELETE su propio evento (E1, sobre PA).
select pg_temp.act_as('00000000-0000-0000-0000-000000112101'); -- U1
select throws_ok(
  $$
  delete from public.events_raw
   where user_id = '00000000-0000-0000-0000-000000112101'
     and property_id = '00000000-0000-0000-0000-000000112121'
  $$,
  null,
  'APPEND2_authenticated_no_puede_borrar_ni_su_propio_evento'
);
reset role;

select * from finish();
rollback;
