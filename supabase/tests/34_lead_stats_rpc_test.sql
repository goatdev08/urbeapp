-- Tests pgTAP — Estadísticas tangibles del lead, con el LIKE como filtro de entrada
-- (subtarea 112.3, origen: producto(75.2) "estadísticas tangibles del lead" -> tarea 112).
-- Ejecutar con: supabase test db (CLI global de brew, NUNCA npx supabase)
-- 🔴 GOTCHA operativo: `supabase db reset` ANTES de `supabase test db` SIEMPRE en esta rama
-- (hay migraciones nuevas: 20260808000001_events_raw_rls.sql) — si no, rojos falsos por
-- "relation does not exist" en vez de los rojos reales de este archivo.
-- Corre como superusuario dentro de una transacción revertida (no persiste). Los fixtures
-- se insertan directo (el superusuario bypassa RLS); las aserciones impersonan con
-- pg_temp.act_as(uid, role) (mismo patrón que 02/08/18/21/25/27/28/29/30/31/33_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba (comportamiento observable vía impersonación JWT, NO internals): el
-- contrato de una función RPC pública SECURITY DEFINER, `public.get_lead_stats(p_lead_ids
-- uuid[])`, ejercitada con SELECT reales bajo `act_as`. Devuelve, POR CADA lead_id que (a)
-- el caller puede ver (`private.can_view_lead`, REUSADO tal cual — 20260807000006, NO se
-- escribe un helper nuevo) Y (b) el usuario del lead dio like a la propiedad de origen del
-- lead: {lead_id, vio_completo, veces_visto, guardo, ultima_actividad}. Si (a) o (b) no se
-- cumplen, ESE lead_id simplemente NO aparece en el resultset (ni una fila parcial) — el
-- 🔴 gate central del producto: los datos se REGISTRAN siempre (events_raw/saves), pero
-- solo se MUESTRAN tras el like.
--
-- SUT (AÚN NO EXISTE — GREEN, fuera de esta fase RED): una migración nueva en
-- supabase/migrations/ que cree `public.get_lead_stats(p_lead_ids uuid[])` (security
-- definer, `set search_path = ''`, esquema calificado en todo el cuerpo, mismo criterio que
-- el resto del repo).
--
-- ── DECISIÓN — batch vía arreglo, NO N+1 (diseño obligado por la subtarea) ───────────────
-- La función acepta `p_lead_ids uuid[]` y hace `returns setof` una fila por lead calificado
-- — el CRM pinta una lista completa con UNA sola llamada RPC (ver HP2 abajo), en vez de un
-- round-trip por lead. Se prueba explícito con un batch mixto (3 califican, 2 no) en una
-- sola invocación.
--
-- ── DECISIÓN — "la propiedad de origen del lead" cuando hay ambigüedad ───────────────────
-- `public.leads` NO tiene columna `origin_property_id` propia; el origen vive en
-- `lead_origin_properties` (0..N filas por lead — un usuario puede contactar al mismo
-- agente sobre MÁS de una propiedad). Para esta subtarea se usa la fila con MENOR
-- `contacted_at` (el primer contacto, el más natural para "qué video disparó el interés").
-- Los fixtures de este archivo dan como mucho 1 fila de origen por lead (o 0, ver EDGE4) —
-- no se prueba el caso de múltiples orígenes por lead aquí (fuera del alcance enumerado de
-- 112.3); queda documentado como decisión de diseño para el GREEN, no como comportamiento
-- verificado por este RED.
--
-- ── DECISIÓN — el gate del like es POR LA PROPIEDAD DE ORIGEN, no "cualquier like" ───────
-- `public.likes` ya trae `property_id` denormalizado (migración 0006) — el gate consulta
-- `likes.user_id = lead.user_id AND likes.property_id = <origen>`, nunca "algún like en
-- cualquier propiedad del agente".
--
-- ── Estrategia RED sin depender de "function does not exist" ─────────────────────────────
-- El SUT es una función NUEVA que hoy no existe en ninguna migración. Para que los asserts
-- fallen POR ASERCIÓN (no por "function does not exist", que aborta cada bloque con un
-- mensaje genérico de Postgres en vez de uno diagnóstico) este archivo crea un STUB
-- transaccional de `public.get_lead_stats` (sección 0 abajo) que SIEMPRE lanza
-- 'not_implemented'. Vive DENTRO de esta transacción (`begin; ... rollback;`, igual que
-- `pg_temp.act_as`) — nunca persiste ni toca supabase/migrations/; la migración GREEN real
-- crea su propia versión persistente que reemplaza a esta por completo. Envolviendo cada
-- aserción en `lives_ok($$ do $do$ ... $do$; $$, msg)` (mismo patrón que 28/29/30/31/33_*),
-- el stub garantiza que las 9 aserciones de este archivo fallan HOY de forma UNIFORME (el
-- stub lanza sin importar el caller ni el lead_id) — es decir, DELTA en su totalidad; tras
-- el GREEN cada una debe pasar por la razón correcta (el comportamiento real descrito
-- arriba), no por casualidad.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ─────────────────────────────
-- Happy path:
--   HP1: lead CON like -> el agente dueño obtiene las 4 estadísticas correctas
--        (vio_completo, veces_visto, guardo, ultima_actividad).
--   HP2: batch -- una sola llamada con varios lead_ids devuelve EXACTAMENTE el subconjunto
--        que califica (evita N+1, diseño obligado por la subtarea).
-- Edge cases del spec 112.3 (enumerados por el usuario en la subtarea):
--   EDGE1 [assert estrella]: lead SIN like -> NO devuelve estadísticas, ni siquiera
--        parciales, aunque el usuario tenga eventos/guardado REGISTRADOS de verdad.
--   EDGE2: veces_visto cuenta 0 -- usuario con like pero SIN ningún evento de video ->
--        estadísticas con ceros/false (fila presente, no vacía ni error).
--   EDGE3: veces_visto cuenta 1 -- y ultima_actividad toma el evento (más reciente que el
--        like), no el like -- prueba que el máximo es real entre fuentes, no solo el like.
--   EDGE4: lead cuyo origen (`lead_origin_properties`) es NULL/vacío -> NO truena y no
--        devuelve fila (nada que gatear sin propiedad de origen).
-- Ramas de reglas no obvias (derivadas de reusar private.can_view_lead):
--   RAMA1: el owner ACTIVO de la MISMA agencia del agente dueño del lead TAMBIÉN obtiene
--        las estadísticas (can_view_lead ya compone esto; la función nueva debe heredarlo,
--        no reimplementar visibilidad por su cuenta).
-- Boundary / error (aislamiento — la clase de fuga de #100 y del review de #75):
--   AISLA1: un agente SIN relación con el lead (ni dueño, ni agencia) no obtiene nada.
--   AISLA2: el owner de OTRA agencia (no la del agente dueño del lead) no obtiene nada --
--        el mutante clásico de #100 (membresía compartida vs. agencia REAL del lead).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(9);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '...0000001123XX' (subtarea 112.3, sin colisión con
-- 1121XX de 112.1/33_events_raw_rls_test.sql).
--   OA  owner ACTIVO de AG1 (agencia del agente dueño de los leads)      : ...112301
--   GA  agente ACTIVO en AG1, dueño de TODOS los leads de este archivo   : ...112302
--   GY  agente INDEPENDIENTE, sin relación con AG1 (aislamiento simple)  : ...112303
--   OZ  owner ACTIVO de AG2 (OTRA agencia -- aislamiento cross-agencia)  : ...112304
--   U1  buscador: like + 2 video_view + 1 video_completed + save sobre P1 (-> L1)
--   U2  buscador: like SIN ningún evento de video, SIN save sobre P2     (-> L2)
--   U3  buscador: like + 1 video_view sobre P3                          (-> L3)
--   U4  buscador: 2 video_view + save sobre P4, SIN like                (-> L4, EDGE1)
--   U5  buscador: SIN lead_origin_properties (lead sin origen)          (-> L5, EDGE4)
--   P1..P4 propiedades de GA (agencia AG1); V1..V4 su primer video.
--   L1..L5 leads de GA (agent_id=GA), uno por buscador U1..U5.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000112301', 'oa.1123@test.local'),
  ('00000000-0000-0000-0000-000000112302', 'ga.1123@test.local'),
  ('00000000-0000-0000-0000-000000112303', 'gy.1123@test.local'),
  ('00000000-0000-0000-0000-000000112304', 'oz.1123@test.local'),
  ('00000000-0000-0000-0000-000000112311', 'u1.1123@test.local'),
  ('00000000-0000-0000-0000-000000112312', 'u2.1123@test.local'),
  ('00000000-0000-0000-0000-000000112313', 'u3.1123@test.local'),
  ('00000000-0000-0000-0000-000000112314', 'u4.1123@test.local'),
  ('00000000-0000-0000-0000-000000112315', 'u5.1123@test.local');

update public.users set role = 'agent', is_verified_agent = true
  where id in (
    '00000000-0000-0000-0000-000000112302', -- GA
    '00000000-0000-0000-0000-000000112303'  -- GY
  );

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000112341', 'Inmobiliaria Lead Stats AG1 1123', 'inmo-lead-stats-ag1-1123', 'active', '00000000-0000-0000-0000-000000112301'),
  ('00000000-0000-0000-0000-000000112342', 'Inmobiliaria Lead Stats AG2 1123', 'inmo-lead-stats-ag2-1123', 'active', '00000000-0000-0000-0000-000000112304');

insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000112341', '00000000-0000-0000-0000-000000112301', 'owner', 'active'), -- OA en AG1
  ('00000000-0000-0000-0000-000000112341', '00000000-0000-0000-0000-000000112302', 'agent', 'active'), -- GA en AG1
  ('00000000-0000-0000-0000-000000112342', '00000000-0000-0000-0000-000000112304', 'owner', 'active'); -- OZ en AG2 (independiente de AG1)
-- GY NO pertenece a ninguna agencia -- agente independiente, imprescindible para AISLA1.

insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000112321', '00000000-0000-0000-0000-000000112302', '00000000-0000-0000-0000-000000112341', 'departamento', 'rent', 'Fixture 1123 -- P1 (origen L1)', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-000000112322', '00000000-0000-0000-0000-000000112302', '00000000-0000-0000-0000-000000112341', 'departamento', 'rent', 'Fixture 1123 -- P2 (origen L2)', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography, 12500, 'active'),
  ('00000000-0000-0000-0000-000000112323', '00000000-0000-0000-0000-000000112302', '00000000-0000-0000-0000-000000112341', 'casa', 'sale', 'Fixture 1123 -- P3 (origen L3)', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.37, 20.69), 4326)::extensions.geography, 2600000, 'active'),
  ('00000000-0000-0000-0000-000000112324', '00000000-0000-0000-0000-000000112302', '00000000-0000-0000-0000-000000112341', 'casa', 'sale', 'Fixture 1123 -- P4 (origen L4, EDGE1)', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.38, 20.70), 4326)::extensions.geography, 2700000, 'active');

-- status='uploading' (no requiere storage_path/cloudflare_uid -- constraint
-- property_videos_ready_requires_storage, 20260604000012 -- solo exige status='ready');
-- el contenido del video es irrelevante para este RED, solo necesitamos un
-- property_video_id válido para likes.
insert into public.property_videos (id, property_id, status, position) values
  ('00000000-0000-0000-0000-000000112331', '00000000-0000-0000-0000-000000112321', 'uploading', 1), -- V1 de P1
  ('00000000-0000-0000-0000-000000112332', '00000000-0000-0000-0000-000000112322', 'uploading', 1), -- V2 de P2
  ('00000000-0000-0000-0000-000000112333', '00000000-0000-0000-0000-000000112323', 'uploading', 1); -- V3 de P3
-- P4 no necesita video para EDGE1 (U4 nunca da like, así que likes.property_video_id nunca se usa para P4).

insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000112351', '00000000-0000-0000-0000-000000112302', '00000000-0000-0000-0000-000000112311', 'contacted'), -- L1 (GA, U1)
  ('00000000-0000-0000-0000-000000112352', '00000000-0000-0000-0000-000000112302', '00000000-0000-0000-0000-000000112312', 'contacted'), -- L2 (GA, U2)
  ('00000000-0000-0000-0000-000000112353', '00000000-0000-0000-0000-000000112302', '00000000-0000-0000-0000-000000112313', 'contacted'), -- L3 (GA, U3)
  ('00000000-0000-0000-0000-000000112354', '00000000-0000-0000-0000-000000112302', '00000000-0000-0000-0000-000000112314', 'contacted'), -- L4 (GA, U4) -- EDGE1
  ('00000000-0000-0000-0000-000000112355', '00000000-0000-0000-0000-000000112302', '00000000-0000-0000-0000-000000112315', 'contacted'); -- L5 (GA, U5) -- EDGE4

insert into public.lead_origin_properties (lead_id, property_id) values
  ('00000000-0000-0000-0000-000000112351', '00000000-0000-0000-0000-000000112321'), -- L1 -> P1
  ('00000000-0000-0000-0000-000000112352', '00000000-0000-0000-0000-000000112322'), -- L2 -> P2
  ('00000000-0000-0000-0000-000000112353', '00000000-0000-0000-0000-000000112323'), -- L3 -> P3
  ('00000000-0000-0000-0000-000000112354', '00000000-0000-0000-0000-000000112324'); -- L4 -> P4
-- L5 NO recibe fila en lead_origin_properties a propósito -- EDGE4 (origen NULL).

-- ── U1: like + 2 video_view + 1 video_completed + save sobre P1 (HP1) ────────────────────
insert into public.likes (user_id, property_video_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000112311', '00000000-0000-0000-0000-000000112331', '00000000-0000-0000-0000-000000112321', '2026-08-01 08:00:00+00');
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000112311', '00000000-0000-0000-0000-000000112321', '2026-08-03 08:00:00+00');
insert into public.events_raw (event_type, user_id, property_id, payload, created_at) values
  ('video_view', '00000000-0000-0000-0000-000000112311', '00000000-0000-0000-0000-000000112321', '{}'::jsonb, '2026-08-02 08:00:00+00'),
  ('video_view', '00000000-0000-0000-0000-000000112311', '00000000-0000-0000-0000-000000112321', '{}'::jsonb, '2026-08-04 08:00:00+00'),
  ('video_completed', '00000000-0000-0000-0000-000000112311', '00000000-0000-0000-0000-000000112321', '{}'::jsonb, '2026-08-05 08:00:00+00'); -- el más reciente de TODOS -> ultima_actividad esperada

-- ── U2: like SIN ningún evento de video, SIN save sobre P2 (EDGE2) ───────────────────────
insert into public.likes (user_id, property_video_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000112312', '00000000-0000-0000-0000-000000112332', '00000000-0000-0000-0000-000000112322', '2026-08-01 09:00:00+00'); -- única fuente -> ultima_actividad esperada

-- ── U3: like + 1 video_view (posterior al like) sobre P3 (EDGE3) ─────────────────────────
insert into public.likes (user_id, property_video_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000112313', '00000000-0000-0000-0000-000000112333', '00000000-0000-0000-0000-000000112323', '2026-08-01 10:00:00+00');
insert into public.events_raw (event_type, user_id, property_id, payload, created_at) values
  ('video_view', '00000000-0000-0000-0000-000000112313', '00000000-0000-0000-0000-000000112323', '{}'::jsonb, '2026-08-06 10:00:00+00'); -- posterior al like -> ultima_actividad esperada

-- ── U4: 2 video_view + save sobre P4, SIN like (EDGE1 -- assert estrella) ────────────────
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000112314', '00000000-0000-0000-0000-000000112324', '2026-08-02 09:00:00+00');
insert into public.events_raw (event_type, user_id, property_id, payload, created_at) values
  ('video_view', '00000000-0000-0000-0000-000000112314', '00000000-0000-0000-0000-000000112324', '{}'::jsonb, '2026-08-02 08:00:00+00'),
  ('video_view', '00000000-0000-0000-0000-000000112314', '00000000-0000-0000-0000-000000112324', '{}'::jsonb, '2026-08-04 08:00:00+00');
-- U5 no necesita ningún dato -- EDGE4 es sobre la AUSENCIA de lead_origin_properties, nada más.

-- ════════════════════════════════════════════════════════════════════════════
-- 0) STUB transaccional del SUT (RED) -- ver "Estrategia RED" arriba. Nunca persiste.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.get_lead_stats(p_lead_ids uuid[])
returns table (
  lead_id          uuid,
  vio_completo     boolean,
  veces_visto      integer,
  guardo           boolean,
  ultima_actividad timestamptz
)
language plpgsql
as $$
begin
  raise exception 'not_implemented: public.get_lead_stats es un STUB de la fase RED (subtarea 112.3) -- la fase GREEN debe reemplazarlo con la migracion real en supabase/migrations/';
end;
$$;

-- Helper de impersonación inline (mismo patrón que 02/08/18/21/25/27/28/29/30/31/33_*).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) HP1 [DELTA] -- lead CON like: el agente dueño obtiene las 4 estadísticas correctas.
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.act_as('00000000-0000-0000-0000-000000112302'); -- GA
select lives_ok(
  $$
  do $do$
  declare
    v_vio_completo    boolean;
    v_veces_visto     integer;
    v_guardo          boolean;
    v_ultima          timestamptz;
  begin
    select vio_completo, veces_visto, guardo, ultima_actividad
      into v_vio_completo, v_veces_visto, v_guardo, v_ultima
      from public.get_lead_stats(array['00000000-0000-0000-0000-000000112351']::uuid[])
      where lead_id = '00000000-0000-0000-0000-000000112351';
    if v_vio_completo is distinct from true
       or v_veces_visto is distinct from 2
       or v_guardo is distinct from true
       or v_ultima is distinct from '2026-08-05 08:00:00+00'::timestamptz then
      raise exception 'esperaba vio_completo=true veces_visto=2 guardo=true ultima_actividad=2026-08-05T08:00:00+00 (el video_completed, el más reciente de todas las fuentes); fue vio_completo=% veces_visto=% guardo=% ultima_actividad=%',
        v_vio_completo, v_veces_visto, v_guardo, v_ultima;
    end if;
  end
  $do$;
  $$,
  'HP1_lead_con_like_agente_dueno_obtiene_las_4_estadisticas_correctas'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) HP2 [DELTA] -- batch: una sola llamada con varios lead_ids devuelve EXACTAMENTE el
--    subconjunto que califica (3 de 5), sin N+1.
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.act_as('00000000-0000-0000-0000-000000112302'); -- GA
select lives_ok(
  $$
  do $do$
  declare
    v_ids uuid[];
    v_expected uuid[] := array[
      '00000000-0000-0000-0000-000000112351', -- L1 (con like)
      '00000000-0000-0000-0000-000000112352', -- L2 (con like)
      '00000000-0000-0000-0000-000000112353'  -- L3 (con like)
    ]::uuid[];
  begin
    select array_agg(lead_id order by lead_id) into v_ids
      from public.get_lead_stats(array[
        '00000000-0000-0000-0000-000000112351', -- L1 califica
        '00000000-0000-0000-0000-000000112352', -- L2 califica
        '00000000-0000-0000-0000-000000112353', -- L3 califica
        '00000000-0000-0000-0000-000000112354', -- L4 NO califica (sin like)
        '00000000-0000-0000-0000-000000112355'  -- L5 NO califica (sin origen)
      ]::uuid[]);
    if v_ids is distinct from v_expected then
      raise exception 'una llamada batch con 5 lead_ids (3 califican, 2 no) debía devolver EXACTAMENTE {L1,L2,L3} en una sola invocación (evita N+1); devolvió %', v_ids;
    end if;
  end
  $do$;
  $$,
  'HP2_batch_una_sola_llamada_con_varios_lead_ids_devuelve_solo_el_subconjunto_que_califica'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) EDGE1 [DELTA, assert estrella] -- lead SIN like: NO devuelve estadísticas, ni
--    siquiera parciales, aunque haya eventos/guardado REGISTRADOS de verdad.
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.act_as('00000000-0000-0000-0000-000000112302'); -- GA
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    select count(*) into v_count from public.get_lead_stats(array['00000000-0000-0000-0000-000000112354']::uuid[]);
    if v_count is distinct from 0 then
      raise exception 'un lead SIN like a la propiedad de origen NO debe devolver estadísticas (ni parciales) aunque el usuario tenga 2 video_view y 1 save REGISTRADOS -- el like es el filtro de entrada; devolvió % filas', v_count;
    end if;
  end
  $do$;
  $$,
  'EDGE1_lead_sin_like_no_devuelve_estadisticas_ni_siquiera_parciales_assert_estrella'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) EDGE2 [DELTA] -- veces_visto cuenta 0: like presente, CERO eventos de video ->
--    fila con ceros/false, ni vacía ni error.
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.act_as('00000000-0000-0000-0000-000000112302'); -- GA
select lives_ok(
  $$
  do $do$
  declare
    v_count           int;
    v_vio_completo    boolean;
    v_veces_visto     integer;
    v_guardo          boolean;
    v_ultima          timestamptz;
  begin
    select count(*) into v_count from public.get_lead_stats(array['00000000-0000-0000-0000-000000112352']::uuid[]);
    if v_count is distinct from 1 then
      raise exception 'un lead con like pero SIN ningún evento de video debe devolver EXACTAMENTE 1 fila (con ceros/false), no 0; devolvió %', v_count;
    end if;
    select vio_completo, veces_visto, guardo, ultima_actividad
      into v_vio_completo, v_veces_visto, v_guardo, v_ultima
      from public.get_lead_stats(array['00000000-0000-0000-0000-000000112352']::uuid[])
      where lead_id = '00000000-0000-0000-0000-000000112352';
    if v_vio_completo is distinct from false
       or v_veces_visto is distinct from 0
       or v_guardo is distinct from false
       or v_ultima is distinct from '2026-08-01 09:00:00+00'::timestamptz then
      raise exception 'esperaba vio_completo=false veces_visto=0 guardo=false ultima_actividad=2026-08-01T09:00:00+00 (el like, única fuente); fue vio_completo=% veces_visto=% guardo=% ultima_actividad=%',
        v_vio_completo, v_veces_visto, v_guardo, v_ultima;
    end if;
  end
  $do$;
  $$,
  'EDGE2_like_sin_ningun_evento_de_video_devuelve_estadisticas_en_cero_no_vacio_ni_error'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) EDGE3 [DELTA] -- veces_visto cuenta 1, y ultima_actividad toma el evento (posterior
--    al like), no el like -- el máximo es real entre fuentes.
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.act_as('00000000-0000-0000-0000-000000112302'); -- GA
select lives_ok(
  $$
  do $do$
  declare
    v_vio_completo    boolean;
    v_veces_visto     integer;
    v_guardo          boolean;
    v_ultima          timestamptz;
  begin
    select vio_completo, veces_visto, guardo, ultima_actividad
      into v_vio_completo, v_veces_visto, v_guardo, v_ultima
      from public.get_lead_stats(array['00000000-0000-0000-0000-000000112353']::uuid[])
      where lead_id = '00000000-0000-0000-0000-000000112353';
    if v_vio_completo is distinct from false
       or v_veces_visto is distinct from 1
       or v_guardo is distinct from false
       or v_ultima is distinct from '2026-08-06 10:00:00+00'::timestamptz then
      raise exception 'esperaba vio_completo=false veces_visto=1 guardo=false ultima_actividad=2026-08-06T10:00:00+00 (el video_view, POSTERIOR al like -- el máximo real entre fuentes, no el like); fue vio_completo=% veces_visto=% guardo=% ultima_actividad=%',
        v_vio_completo, v_veces_visto, v_guardo, v_ultima;
    end if;
  end
  $do$;
  $$,
  'EDGE3_veces_visto_uno_y_ultima_actividad_toma_el_evento_mas_reciente_no_el_like'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) EDGE4 [DELTA] -- lead sin propiedad de origen (lead_origin_properties vacío): NO
--    truena y NO devuelve fila.
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.act_as('00000000-0000-0000-0000-000000112302'); -- GA
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    select count(*) into v_count from public.get_lead_stats(array['00000000-0000-0000-0000-000000112355']::uuid[]);
    if v_count is distinct from 0 then
      raise exception 'un lead SIN propiedad de origen (lead_origin_properties vacío) no debe tronar y no debe devolver fila; devolvió % filas', v_count;
    end if;
  end
  $do$;
  $$,
  'EDGE4_lead_sin_propiedad_de_origen_no_truena_y_no_devuelve_fila'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) RAMA1 [DELTA] -- el owner ACTIVO de la MISMA agencia del agente dueño del lead
--    TAMBIÉN obtiene las estadísticas (hereda de reusar private.can_view_lead).
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.act_as('00000000-0000-0000-0000-000000112301'); -- OA (owner de AG1)
select lives_ok(
  $$
  do $do$
  declare v_count int; declare v_vio boolean;
  begin
    select count(*), bool_or(vio_completo) into v_count, v_vio
      from public.get_lead_stats(array['00000000-0000-0000-0000-000000112351']::uuid[]);
    if v_count is distinct from 1 or v_vio is distinct from true then
      raise exception 'el owner ACTIVO de la agencia del agente dueño del lead debe ver las MISMAS estadísticas que el agente (can_view_lead ya compone esto); filas=% vio_completo=%', v_count, v_vio;
    end if;
  end
  $do$;
  $$,
  'RAMA1_owner_de_la_misma_agencia_del_agente_tambien_obtiene_estadisticas_del_lead'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 8) AISLA1 [DELTA] -- un agente SIN relación con el lead (ni dueño, ni agencia
--    compartida) no obtiene nada.
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.act_as('00000000-0000-0000-0000-000000112303'); -- GY (agente independiente)
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    select count(*) into v_count from public.get_lead_stats(array['00000000-0000-0000-0000-000000112351']::uuid[]);
    if v_count is distinct from 0 then
      raise exception 'un agente SIN relación con el lead (ni agent_id, ni owner/admin de su agencia) NO debe obtener ninguna estadística; devolvió % filas', v_count;
    end if;
  end
  $do$;
  $$,
  'AISLA1_agente_sin_relacion_con_el_lead_no_obtiene_nada'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 9) AISLA2 [DELTA, mutante clásico #100] -- el owner de OTRA agencia (no la del agente
--    dueño del lead) no obtiene nada -- cross-agencia.
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.act_as('00000000-0000-0000-0000-000000112304'); -- OZ (owner de AG2, otra agencia)
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    select count(*) into v_count from public.get_lead_stats(array['00000000-0000-0000-0000-000000112351']::uuid[]);
    if v_count is distinct from 0 then
      raise exception 'el owner de una agencia DISTINTA a la del agente dueño del lead NO debe obtener nada (mutante clásico #100: membresía compartida vs. agencia REAL del lead); devolvió % filas', v_count;
    end if;
  end
  $do$;
  $$,
  'AISLA2_owner_de_otra_agencia_no_obtiene_nada_cross_agencia'
);
reset role;

select * from finish();
rollback;
