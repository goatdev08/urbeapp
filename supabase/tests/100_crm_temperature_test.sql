-- Tests pgTAP — private.crm_temperature + private.crm_band (subtarea 266.2, exploración 045
-- §7.1/§7.2/§7.3). Ejecutar con:
--   supabase test db supabase/tests/100_crm_temperature_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de una transacción
-- revertida (no persiste). Impersonamos con pg_temp.act_as(uid, role) SOLO para los 2 asserts
-- de ACL (patrón 02/35/62/…); todo lo demás corre en contexto superusuario (bypassa RLS Y
-- privilegios — es justo lo que necesitamos para poder llamar las funciones aunque
-- anon/authenticated tengan el EXECUTE revocado).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba — el contrato PÚBLICO de 2 funciones nuevas en el schema `private`
-- (no expuesto por PostgREST; las consumirán las RPC de 266.4/266.5/266.6):
--
--   private.crm_temperature(p_agent_id uuid, p_user_id uuid, p_at timestamptz) returns int
--     min(100, round(greatest(piso, Σ w_i·(1−decay)^dias_desde(ts_i, p_at))))
--     señales: events_raw.video_completed (tope crm_max_video_completed, los MÁS RECIENTES),
--     likes, saves, 1ª fila de lead_origin_properties del lead ACTIVO (agent,user) = piso de
--     entrada, filas extra = re-contacto, events_raw.contact_repeat y .zone_search (aditivo,
--     nadie los escribe hoy). Reloj SIEMPRE por p_at (nunca now()). Claves de app_config vía
--     COALESCE(…, default); NO sembradas (rompería 12_stream_schema_test y el RED de 29).
--
--   private.crm_band(p_is_lead boolean, p_temp int, p_temp_prev int, p_max14 int,
--                     p_strong_signal_at timestamptz, p_last_status_change_at timestamptz,
--                     p_at timestamptz) returns text → 'hot'|'cooling'|'warming'|'silent',
--     evaluación ORDENADA (§7.3): hot > cooling > warming > silent. hot/cooling exigen
--     p_is_lead=true; warming admite anónimos.
--
-- SUT AÚN NO EXISTE (RED 2026-09-06): lo crea supabase/migrations/20260906100001_
-- crm_temperature.sql (GREEN, fuera de esta fase).
--
-- ── Estrategia RED sin depender de "function does not exist" (mismo patrón que
--    62_ad_metrics_for_agency_test.sql, adaptado a funciones ESCALARES) ─────────────────────
-- (a) Los asserts de catálogo puro (has_function/function_returns/pg_proc/
--     pg_get_function_*/function_privs_are) son seguros aunque la función no exista —
--     resuelven a NULL/"not ok" y comparan limpio, sin lanzar.
-- (b) TODA llamada real a private.crm_temperature/private.crm_band pasa por un wrapper
--     pg_temp.crm_temp_safe(...)/pg_temp.crm_band_safe(...) — plpgsql que atrapa la excepción
--     "function does not exist" (42883 hoy) y devuelve NULL en vez de abortar la transacción.
--     Cada assert de comportamiento compara ese NULL contra un LITERAL numérico esperado
--     (nunca NULL contra NULL — is(NULL,NULL) pasa "ok" en pgTAP, sería un RED falso-verde;
--     verificado empíricamente antes de escribir este archivo) — así el archivo entero falla
--     por ASERCIÓN (NULL ≠ 30, NULL ≠ 'hot', …), nunca por abortar.
-- (c) Gotcha 203.1 (el EXECUTE se comprueba al planificar y el plan se cachea): el caso
--     anon-invoca-la-función va ANTES de cualquier otra invocación de esa misma función en
--     el archivo (incluida la del propio superusuario) — es la PRIMERA llamada real a
--     private.crm_temperature y a private.crm_band. Los privilegios de authenticated se
--     verifican por catálogo (function_privs_are, no invoca nada — cero riesgo de plan
--     cacheado) para no depender del orden.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────────────────────
-- Firma pública (SIG1-10): has_function + function_returns + pg_get_function_arguments EXACTO
--   (nombres de parámetro, mata el mutante del renombre) + security definer + search_path=''.
-- ACL (ACL1-6): anon/authenticated SIN execute en AMBAS funciones (catálogo,
--   function_privs_are) + invocación real de anon contra AMBAS (42501, primera llamada real).
-- Reproducibilidad (REPRO1-3): 2 llamadas con el mismo fixture = mismo valor — Y el valor es
--   el literal esperado (nunca NULL vs NULL).
-- Piso de entrada (ENTRY1): lead recién nacido con solo su contacto → 30.
-- Decaimiento (DECAY1-4 + DECAY_MONO): mismo fixture, p_at +24h/+72h/+336h (1/3/14 días en
--   HORAS EXACTAS, nunca 'interval N days' — evita la bomba de fecha de la aritmética
--   calendárica de Postgres con DST bajo timestamptz) → round(30·0.92^n) literal
--   (28/23/9, calculado independiente con Decimal, no con la misma expresión SQL) y
--   decrece monótono (cruza el piso de 30 una sola vez, nunca rebota).
-- Bomba de fecha (TZ1-12): los 3 asserts de DECAY se repiten bajo `set local timezone to`
--   UTC / America/Mexico_City / Pacific/Kiritimati / Pacific/Niue — la construcción del
--   fixture usa SIEMPRE horas exactas sobre un timestamptz con offset explícito, así que el
--   resultado tiene que ser IDÉNTICO en las 4 zonas.
-- Tope de video (VIDEOCAP1): 7 video_completed, tope=5 cuenta los MÁS RECIENTES → 43 (si un
--   mutante contara los 7, o los 5 más VIEJOS, el literal (55 / otro) lo cazaría).
-- Señales futuras (FUTURE1): un signal con ts > p_at NO cuenta.
-- Re-contacto (RECONTACT1): 2ª fila de lead_origin_properties usa crm_weight_contact_repeat
--   (temporalmente recalibrado a un valor DISTINTO de crm_weight_contact_first para que un
--   mutante que trate todas las filas como "primer contacto" cambie el literal esperado).
-- Lead inactivo (INACTIVE1): el mismo piso de entrada NO cuenta si el lead está borrado
--   (deleted_at) — derivado literal de "del lead ACTIVO" en la firma de la subtarea.
-- Señales aditivas de fase C (EVENTSADD1): events_raw.zone_search + .contact_repeat suman
--   junto con un like — "la fórmula los suma aunque hoy nadie los escriba".
-- Recalibración sin deploy (CONFIG1-2): cambiar crm_weight_save en app_config cambia el
--   número sin publicar app (precedente lead_score_threshold_*, 20260807000004).
-- Techo (CAP100): min(100) con una combinación de señales que suma 103 en crudo.
-- Bandas (BAND1-8): un caso por banda de §7.3 + el orden hot>cooling (ambas condiciones
--   numéricas ciertas a la vez → gana hot) + hot/cooling rechazan p_is_lead=false (caen a
--   warming/silent, nunca hot/cooling) + un cambio de estado POSTERIOR a la señal fuerte
--   bloquea tanto hot como warming (literal de "ningún cambio de estado posterior a esa
--   señal").
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(51);

-- ── Helper de impersonación (mismo patrón que 02/08/.../35/62_*) ────────────────────────────
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── Wrappers RED (b): atrapan "function does not exist" sin abortar la transacción ──────────
create or replace function pg_temp.crm_temp_safe(p_agent_id uuid, p_user_id uuid, p_at timestamptz)
returns int language plpgsql as $$
declare v_result int;
begin
  select private.crm_temperature(p_agent_id, p_user_id, p_at) into v_result;
  return v_result;
exception when others then
  return null;
end $$;

create or replace function pg_temp.crm_band_safe(
  p_is_lead boolean, p_temp int, p_temp_prev int, p_max14 int,
  p_strong_signal_at timestamptz, p_last_status_change_at timestamptz, p_at timestamptz
) returns text language plpgsql as $$
declare v_result text;
begin
  select private.crm_band(p_is_lead, p_temp, p_temp_prev, p_max14, p_strong_signal_at,
                           p_last_status_change_at, p_at) into v_result;
  return v_result;
exception when others then
  return null;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Firma pública — catálogo EXACTO, leído del catálogo real (nunca reescrito a mano).
-- ════════════════════════════════════════════════════════════════════════════

select has_function('private', 'crm_temperature', array['uuid', 'uuid', 'timestamptz'],
  'SIG1_private_crm_temperature_existe_con_la_firma_p_agent_id_p_user_id_p_at');

select function_returns('private', 'crm_temperature', array['uuid', 'uuid', 'timestamptz'], 'int',
  'SIG2_private_crm_temperature_retorna_int');

select is(
  (select pg_get_function_arguments(to_regprocedure('private.crm_temperature(uuid,uuid,timestamptz)'))),
  'p_agent_id uuid, p_user_id uuid, p_at timestamp with time zone',
  'SIG3_crm_temperature_argumentos_EXACTOS_nombres_y_tipos_mata_el_renombre'
);

select is(
  (select prosecdef from pg_proc where proname = 'crm_temperature' and pronamespace = 'private'::regnamespace),
  true,
  'SIG4_crm_temperature_es_security_definer'
);

select is(
  (select proconfig from pg_proc where proname = 'crm_temperature' and pronamespace = 'private'::regnamespace),
  array['search_path=""']::text[],
  'SIG5_crm_temperature_search_path_vacio_fijo'
);

select has_function('private', 'crm_band',
  array['boolean', 'int', 'int', 'int', 'timestamptz', 'timestamptz', 'timestamptz'],
  'SIG6_private_crm_band_existe_con_los_7_argumentos_de_la_firma_acordada');

select function_returns('private', 'crm_band',
  array['boolean', 'int', 'int', 'int', 'timestamptz', 'timestamptz', 'timestamptz'], 'text',
  'SIG7_private_crm_band_retorna_text');

select is(
  (select pg_get_function_arguments(to_regprocedure(
    'private.crm_band(boolean,int,int,int,timestamptz,timestamptz,timestamptz)'))),
  'p_is_lead boolean, p_temp integer, p_temp_prev integer, p_max14 integer, '
  || 'p_strong_signal_at timestamp with time zone, p_last_status_change_at timestamp with time zone, '
  || 'p_at timestamp with time zone',
  'SIG8_crm_band_argumentos_EXACTOS_nombres_y_tipos_mata_el_renombre'
);

select is(
  (select prosecdef from pg_proc where proname = 'crm_band' and pronamespace = 'private'::regnamespace),
  true,
  'SIG9_crm_band_es_security_definer'
);

select is(
  (select proconfig from pg_proc where proname = 'crm_band' and pronamespace = 'private'::regnamespace),
  array['search_path=""']::text[],
  'SIG10_crm_band_search_path_vacio_fijo'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) ACL — anon/authenticated NO tienen execute en NINGUNA de las 2 funciones nuevas.
--    Catálogo primero (function_privs_are: no invoca nada, cero riesgo de plan cacheado,
--    seguro aunque la función no exista — 62_ad_metrics_for_agency_test.sql lo demuestra).
-- ════════════════════════════════════════════════════════════════════════════

select function_privs_are('private', 'crm_temperature', array['uuid', 'uuid', 'timestamptz'],
  'anon', array[]::name[],
  'ACL1_crm_temperature_anon_SIN_execute');
select function_privs_are('private', 'crm_temperature', array['uuid', 'uuid', 'timestamptz'],
  'authenticated', array[]::name[],
  'ACL2_crm_temperature_authenticated_SIN_execute');
select function_privs_are('private', 'crm_band',
  array['boolean', 'int', 'int', 'int', 'timestamptz', 'timestamptz', 'timestamptz'],
  'anon', array[]::name[],
  'ACL3_crm_band_anon_SIN_execute');
select function_privs_are('private', 'crm_band',
  array['boolean', 'int', 'int', 'int', 'timestamptz', 'timestamptz', 'timestamptz'],
  'authenticated', array[]::name[],
  'ACL4_crm_band_authenticated_SIN_execute');

-- ── Invocación real bajo anon — PRIMERA llamada real a cada función en todo el archivo
--    (gotcha 203.1: si una llamada exitosa se cacheara antes, anon la heredaría en falso) ──
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select private.crm_temperature('00000000-0000-0000-0000-000000100001'::uuid,
                                     '00000000-0000-0000-0000-000000100002'::uuid, now()) $$,
  '42501', null,
  'ACL5_anon_no_puede_ejecutar_crm_temperature_42501_primera_llamada_real'
);
select throws_ok(
  $$ select private.crm_band(true, 50, 40, 50, now(), null, now()) $$,
  '42501', null,
  'ACL6_anon_no_puede_ejecutar_crm_band_42501_primera_llamada_real'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Fixtures — prefijo '...0000001000XX' (subtarea 266.2; fuera del rango 0753XX/6200XX de
--    75.3/171.1 y del seed de volumen a1/a2/a3000000-… de 266.1). Ancla T0 con offset UTC
--    explícito; TODOS los deltas se expresan en HORAS (nunca 'interval N days': Postgres
--    aplica aritmética calendárica con DST a los días sobre timestamptz — las horas son
--    tiempo transcurrido exacto, TZ-agnóstico de verdad).
-- ════════════════════════════════════════════════════════════════════════════

create temp table t100_anchor as
select '2026-09-06T12:00:00+00'::timestamptz as t0;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000100001', 'ga1.100@test.local'),  -- ENTRY/REPRO/DECAY/TZ
  ('00000000-0000-0000-0000-000000100002', 'u1.100@test.local'),
  ('00000000-0000-0000-0000-000000100011', 'ga2.100@test.local'),  -- VIDEOCAP
  ('00000000-0000-0000-0000-000000100012', 'u2.100@test.local'),
  ('00000000-0000-0000-0000-000000100021', 'ga3.100@test.local'),  -- CONFIG (crm_weight_save)
  ('00000000-0000-0000-0000-000000100022', 'u3.100@test.local'),
  ('00000000-0000-0000-0000-000000100031', 'ga4.100@test.local'),  -- FUTURE
  ('00000000-0000-0000-0000-000000100032', 'u4.100@test.local'),
  ('00000000-0000-0000-0000-000000100041', 'ga5.100@test.local'),  -- RECONTACT
  ('00000000-0000-0000-0000-000000100042', 'u5.100@test.local'),
  ('00000000-0000-0000-0000-000000100051', 'ga6.100@test.local'),  -- INACTIVE (lead borrado)
  ('00000000-0000-0000-0000-000000100052', 'u6.100@test.local'),
  ('00000000-0000-0000-0000-000000100061', 'ga7.100@test.local'),  -- CAP100
  ('00000000-0000-0000-0000-000000100062', 'u7.100@test.local'),
  ('00000000-0000-0000-0000-000000100071', 'ga8.100@test.local'),  -- EVENTSADD
  ('00000000-0000-0000-0000-000000100072', 'u8.100@test.local');

update public.users set role = 'agent', is_verified_agent = true
  where id in (
    '00000000-0000-0000-0000-000000100001', '00000000-0000-0000-0000-000000100011',
    '00000000-0000-0000-0000-000000100021', '00000000-0000-0000-0000-000000100031',
    '00000000-0000-0000-0000-000000100041', '00000000-0000-0000-0000-000000100051',
    '00000000-0000-0000-0000-000000100061', '00000000-0000-0000-0000-000000100071'
  );

insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000100003', '00000000-0000-0000-0000-000000100001',
   'departamento', 'rent', 'Fixture 100 — PA1 (contacto/repro/decay/tz)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-000000100013', '00000000-0000-0000-0000-000000100011',
   'casa', 'sale', 'Fixture 100 — PA2 (tope de video)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.34, 20.66), 4326)::extensions.geography, 2500000, 'active'),
  ('00000000-0000-0000-0000-000000100023', '00000000-0000-0000-0000-000000100021',
   'departamento', 'rent', 'Fixture 100 — PA3 (recalibrar crm_weight_save)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.33, 20.65), 4326)::extensions.geography, 9000, 'active'),
  ('00000000-0000-0000-0000-000000100033', '00000000-0000-0000-0000-000000100031',
   'departamento', 'rent', 'Fixture 100 — PA4 (senal futura no cuenta)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.32, 20.64), 4326)::extensions.geography, 8500, 'active'),
  ('00000000-0000-0000-0000-000000100043', '00000000-0000-0000-0000-000000100041',
   'casa', 'rent', 'Fixture 100 — PA5a (primer contacto)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.31, 20.63), 4326)::extensions.geography, 15000, 'active'),
  ('00000000-0000-0000-0000-000000100044', '00000000-0000-0000-0000-000000100041',
   'casa', 'rent', 'Fixture 100 — PA5b (re-contacto)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.30, 20.62), 4326)::extensions.geography, 16000, 'active'),
  ('00000000-0000-0000-0000-000000100053', '00000000-0000-0000-0000-000000100051',
   'departamento', 'rent', 'Fixture 100 — PA6 (lead inactivo)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.29, 20.61), 4326)::extensions.geography, 7000, 'active'),
  ('00000000-0000-0000-0000-000000100063', '00000000-0000-0000-0000-000000100061',
   'departamento', 'sale', 'Fixture 100 — PA7 (techo min 100)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.28, 20.60), 4326)::extensions.geography, 3200000, 'active'),
  ('00000000-0000-0000-0000-000000100073', '00000000-0000-0000-0000-000000100071',
   'departamento', 'rent', 'Fixture 100 — PA8 (senales aditivas fase C)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.27, 20.59), 4326)::extensions.geography, 11000, 'active');

insert into public.property_videos (id, property_id, status, position, cloudflare_uid) values
  ('00000000-0000-0000-0000-000000100064', '00000000-0000-0000-0000-000000100063', 'ready', 1, 'cf-100064'),
  ('00000000-0000-0000-0000-000000100074', '00000000-0000-0000-0000-000000100073', 'ready', 1, 'cf-100074');

-- ── ENTRY/REPRO/DECAY/TZ: lead con SOLO su primer contacto en T0 ─────────────────────────────
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000100004', '00000000-0000-0000-0000-000000100001',
   '00000000-0000-0000-0000-000000100002', 'whatsapp_opened');
insert into public.lead_origin_properties (lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000100004', '00000000-0000-0000-0000-000000100003',
   (select t0 from t100_anchor));

-- ── VIDEOCAP: 7 video_completed, días 0..6 antes de T0 (HORAS exactas) ───────────────────────
insert into public.events_raw (event_type, user_id, property_id, created_at)
select 'video_completed', '00000000-0000-0000-0000-000000100012', '00000000-0000-0000-0000-000000100013',
       (select t0 from t100_anchor) - (k * 24 || ' hours')::interval
from generate_series(0, 6) as k;

-- ── CONFIG: un solo save en T0 (peso por defecto 18) ─────────────────────────────────────────
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000100022', '00000000-0000-0000-0000-000000100023',
   (select t0 from t100_anchor));

-- ── FUTURE: un like en T0 (cuenta) + un save 48h DESPUÉS de T0 (NO cuenta) ───────────────────
insert into public.property_videos (id, property_id, status, position, cloudflare_uid) values
  ('00000000-0000-0000-0000-000000100034', '00000000-0000-0000-0000-000000100033', 'ready', 1, 'cf-100034');
insert into public.likes (user_id, property_video_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000100032', '00000000-0000-0000-0000-000000100034',
   '00000000-0000-0000-0000-000000100033', (select t0 from t100_anchor));
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000100032', '00000000-0000-0000-0000-000000100033',
   (select t0 from t100_anchor) + interval '48 hours');

-- ── RECONTACT: lead con 2 filas en lead_origin_properties (1ª contacted_at = T0-48h sobre
--    PA5a = piso de entrada; 2ª = T0-24h sobre PA5b = re-contacto) ───────────────────────────
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000100045', '00000000-0000-0000-0000-000000100041',
   '00000000-0000-0000-0000-000000100042', 'contacted');
insert into public.lead_origin_properties (lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000100045', '00000000-0000-0000-0000-000000100043',
   (select t0 from t100_anchor) - interval '48 hours'),
  ('00000000-0000-0000-0000-000000100045', '00000000-0000-0000-0000-000000100044',
   (select t0 from t100_anchor) - interval '24 hours');

-- ── INACTIVE: mismo piso de entrada (contacto en T0) pero el lead está BORRADO ───────────────
insert into public.leads (id, agent_id, user_id, status, deleted_at) values
  ('00000000-0000-0000-0000-000000100054', '00000000-0000-0000-0000-000000100051',
   '00000000-0000-0000-0000-000000100052', 'discarded', (select t0 from t100_anchor));
insert into public.lead_origin_properties (lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000100054', '00000000-0000-0000-0000-000000100053',
   (select t0 from t100_anchor));

-- ── CAP100: 5 video_completed (10 c/u) + 1 save (18) + 1 like (5) + 1 contacto (30) = 103,
--    todo en T0 (sin decaimiento) → min(100) debe recortar a 100 ──────────────────────────────
insert into public.events_raw (event_type, user_id, property_id, created_at)
select 'video_completed', '00000000-0000-0000-0000-000000100062', '00000000-0000-0000-0000-000000100063',
       (select t0 from t100_anchor)
from generate_series(1, 5);
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000100062', '00000000-0000-0000-0000-000000100063',
   (select t0 from t100_anchor));
insert into public.likes (user_id, property_video_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000100062', '00000000-0000-0000-0000-000000100064',
   '00000000-0000-0000-0000-000000100063', (select t0 from t100_anchor));
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000100065', '00000000-0000-0000-0000-000000100061',
   '00000000-0000-0000-0000-000000100062', 'whatsapp_opened');
insert into public.lead_origin_properties (lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000100065', '00000000-0000-0000-0000-000000100063',
   (select t0 from t100_anchor));

-- ── EVENTSADD: like (5) + events_raw.zone_search (8) + events_raw.contact_repeat (30), todo
--    en T0 — nadie escribe estos 2 eventos hoy (fase C), pero la fórmula ya debe sumarlos ──────
insert into public.likes (user_id, property_video_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000100072', '00000000-0000-0000-0000-000000100074',
   '00000000-0000-0000-0000-000000100073', (select t0 from t100_anchor));
insert into public.events_raw (event_type, user_id, property_id, created_at) values
  ('zone_search', '00000000-0000-0000-0000-000000100072', '00000000-0000-0000-0000-000000100073',
   (select t0 from t100_anchor)),
  ('contact_repeat', '00000000-0000-0000-0000-000000100072', '00000000-0000-0000-0000-000000100073',
   (select t0 from t100_anchor));

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Reproducibilidad + piso de entrada (ENTRY1, REPRO1-3)
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
                         '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor)),
  30,
  'ENTRY1_lead_recien_nacido_con_solo_su_contacto_es_30'
);
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
                         '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor)),
  30,
  'REPRO1_segunda_llamada_identica_sigue_dando_30'
);
-- ok() en vez de is(): is(NULL,NULL) pasa "ok" en pgTAP (verificado empíricamente antes de
-- escribir este archivo) — sería un RED falso-verde si el SUT no existe. Anclamos con
-- "is not null" para que la ausencia del SUT SIGA fallando por aserción.
select ok(
  (select pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
                                 '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor))) is not null
  and
  (select pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
                                 '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor)))
  =
  (select pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
                                 '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor))),
  'REPRO2_dos_llamadas_con_el_mismo_fixture_son_identicas_entre_si_y_no_null'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Decaimiento — mismo fixture, p_at +24h/+72h/+336h. Literales calculados independiente
--    con Decimal (round(30·0.92^n), NUNCA con la misma expresión SQL del GREEN):
--      +24h (1 día)  → 28
--      +72h (3 días) → 23
--      +336h (14 días) → 9
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
    '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '24 hours'),
  28,
  'DECAY1_un_dia_despues_del_contacto_28'
);
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
    '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '72 hours'),
  23,
  'DECAY2_tres_dias_despues_del_contacto_23'
);
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
    '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '336 hours'),
  9,
  'DECAY3_catorce_dias_despues_del_contacto_9'
);
select ok(
  (pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
     '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '24 hours') < 30)
  and
  (pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
     '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '72 hours')
   < pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
     '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '24 hours'))
  and
  (pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
     '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '336 hours')
   < pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
     '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '72 hours')),
  'DECAY4_MONOTONO_cruza_el_piso_de_30_una_sola_vez_y_sigue_bajando_sin_rebotar'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Bomba de fecha — los 3 literales de DECAY1-3 se repiten bajo 4 zonas horarias. El
--    fixture usa timestamptz con offset explícito + deltas en HORAS: el resultado tiene que
--    ser IDÉNTICO en las 4, porque extract(epoch from p_at−ts) es TZ-agnóstico por diseño.
-- ════════════════════════════════════════════════════════════════════════════

set local timezone to 'UTC';
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
    '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '24 hours'),
  28, 'TZ1_UTC_un_dia_28');
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
    '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '72 hours'),
  23, 'TZ2_UTC_tres_dias_23');
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
    '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '336 hours'),
  9, 'TZ3_UTC_catorce_dias_9');

set local timezone to 'America/Mexico_City';
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
    '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '24 hours'),
  28, 'TZ4_MexicoCity_un_dia_28');
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
    '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '72 hours'),
  23, 'TZ5_MexicoCity_tres_dias_23');
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
    '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '336 hours'),
  9, 'TZ6_MexicoCity_catorce_dias_9');

set local timezone to 'Pacific/Kiritimati';
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
    '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '24 hours'),
  28, 'TZ7_Kiritimati_un_dia_28');
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
    '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '72 hours'),
  23, 'TZ8_Kiritimati_tres_dias_23');
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
    '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '336 hours'),
  9, 'TZ9_Kiritimati_catorce_dias_9');

set local timezone to 'Pacific/Niue';
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
    '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '24 hours'),
  28, 'TZ10_Niue_un_dia_28');
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
    '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '72 hours'),
  23, 'TZ11_Niue_tres_dias_23');
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100001'::uuid,
    '00000000-0000-0000-0000-000000100002'::uuid, (select t0 from t100_anchor) + interval '336 hours'),
  9, 'TZ12_Niue_catorce_dias_9');

reset timezone;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) Tope de video completado — 7 eventos, tope=5, cuentan los 5 MÁS RECIENTES.
--    round(Σ 10·0.92^d, d=0..4) = 43 (si contara los 7, o los 5 más viejos, el literal
--    esperado sería otro: 55 con los 7, 42 con los 5 más viejos — ambos DISTINTOS de 43).
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100011'::uuid,
                         '00000000-0000-0000-0000-000000100012'::uuid, (select t0 from t100_anchor)),
  43,
  'VIDEOCAP1_7_completados_solo_cuentan_los_5_mas_recientes_43'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8) Señales futuras (ts > p_at) no cuentan.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100031'::uuid,
                         '00000000-0000-0000-0000-000000100032'::uuid, (select t0 from t100_anchor)),
  5,
  'FUTURE1_el_save_fechado_48h_despues_de_p_at_no_cuenta_solo_el_like_5'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 9) Re-contacto — 1ª fila (por contacted_at) = crm_weight_contact_first (30, sin recalibrar);
--    fila extra = crm_weight_contact_repeat, recalibrado a 50 SOLO para este caso (si un
--    mutante tratara ambas filas como "primer contacto" el literal cambiaría de 71 a otro
--    valor). round(30·0.92^2 + 50·0.92^1) = 71.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.app_config (key, value) values ('crm_weight_contact_repeat', '50'::jsonb);
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100041'::uuid,
                         '00000000-0000-0000-0000-000000100042'::uuid, (select t0 from t100_anchor)),
  71,
  'RECONTACT1_primer_contacto_30_mas_recontacto_recalibrado_a_50_decaidos_71'
);
delete from public.app_config where key = 'crm_weight_contact_repeat';

-- ════════════════════════════════════════════════════════════════════════════
-- 10) Lead inactivo — el mismo piso de entrada NO cuenta si el lead está borrado.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100051'::uuid,
                         '00000000-0000-0000-0000-000000100052'::uuid, (select t0 from t100_anchor)),
  0,
  'INACTIVE1_el_contacto_de_un_lead_borrado_no_cuenta_para_la_temperatura'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 11) Techo — min(100). Crudo = 5×10 (video) + 18 (save) + 5 (like) + 30 (contacto) = 103.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100061'::uuid,
                         '00000000-0000-0000-0000-000000100062'::uuid, (select t0 from t100_anchor)),
  100,
  'CAP100_la_suma_cruda_103_se_recorta_a_100'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 12) Señales aditivas de fase C — zone_search (8) + contact_repeat de events_raw (30) suman
--     junto con un like (5), aunque hoy nadie los escriba. round(5+8+30)=43.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100071'::uuid,
                         '00000000-0000-0000-0000-000000100072'::uuid, (select t0 from t100_anchor)),
  43,
  'EVENTSADD1_like_mas_zone_search_mas_contact_repeat_de_events_raw_suman_43'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 13) Recalibración sin deploy — cambiar crm_weight_save en app_config cambia el número
--     de un fixture que SOLO tiene un save, sin tocar nada más (precedente
--     lead_score_threshold_*, 20260807000004).
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100021'::uuid,
                         '00000000-0000-0000-0000-000000100022'::uuid, (select t0 from t100_anchor)),
  18,
  'CONFIG1_un_solo_save_con_el_peso_default_18'
);
insert into public.app_config (key, value) values ('crm_weight_save', '25'::jsonb);
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000100021'::uuid,
                         '00000000-0000-0000-0000-000000100022'::uuid, (select t0 from t100_anchor)),
  25,
  'CONFIG2_recalibrar_crm_weight_save_en_app_config_cambia_el_numero_sin_publicar_app'
);
delete from public.app_config where key = 'crm_weight_save';

-- ════════════════════════════════════════════════════════════════════════════
-- 14) Bandas (§7.3) — evaluación ORDENADA hot > cooling > warming > silent. Funciones
--     puras: no requieren fixtures de tablas, solo argumentos literales.
-- ════════════════════════════════════════════════════════════════════════════

-- BAND1 [hot puro] — es lead, señal fuerte hace 1h (<24h), sin cambio de estado posterior,
-- max14 bajo (50 < 80): NO califica para cooling, así que si el resultado es 'hot' es
-- exclusivamente por la rama 1.
select is(
  pg_temp.crm_band_safe(true, 50, 40, 50,
    (select t0 from t100_anchor) - interval '1 hour', null, (select t0 from t100_anchor)),
  'hot',
  'BAND1_hot_puro_lead_con_senal_fuerte_reciente_y_sin_cambio_de_estado_posterior'
);

-- BAND2 [cooling puro] — es lead, max14=85 (>=80), temp(60) < temp_prev(90), señal fuerte
-- hace 100h (fuera de las 24h): descarta hot, así que si el resultado es 'cooling' es
-- exclusivamente por la rama 2.
select is(
  pg_temp.crm_band_safe(true, 60, 90, 85,
    (select t0 from t100_anchor) - interval '100 hours', null, (select t0 from t100_anchor)),
  'cooling',
  'BAND2_cooling_puro_es_lead_estuvo_caliente_en_14d_y_va_a_la_baja'
);

-- BAND3 [warming, ADMITE ANÓNIMOS] — p_is_lead=false, temp(40) > temp_prev(20), sin señal
-- fuerte ni cambio de estado reciente.
select is(
  pg_temp.crm_band_safe(false, 40, 20, 40, null, null, (select t0 from t100_anchor)),
  'warming',
  'BAND3_warming_admite_anonimos_temp_sube_y_sin_contacto_reciente'
);

-- BAND4 [silencio, default] — nada sube, nada baja de 80, sin señal fuerte.
select is(
  pg_temp.crm_band_safe(false, 30, 30, 30, null, null, (select t0 from t100_anchor)),
  'silent',
  'BAND4_silencio_es_el_resto_cuando_ninguna_otra_condicion_aplica'
);

-- BAND5 [ORDEN — hot le gana a cooling] — con estos MISMOS argumentos, la condición numérica
-- de cooling también es cierta (max14=85>=80, temp 60<90), pero hay señal fuerte hace 2h y
-- ningún cambio de estado posterior: hot se evalúa PRIMERO y gana.
select is(
  pg_temp.crm_band_safe(true, 60, 90, 85,
    (select t0 from t100_anchor) - interval '2 hours', null, (select t0 from t100_anchor)),
  'hot',
  'BAND5_ORDEN_hot_y_cooling_ciertas_a_la_vez_gana_hot_por_ir_primero_en_la_evaluacion'
);

-- BAND6 [hot rechaza anónimos] — MISMOS argumentos que BAND1 pero p_is_lead=false: no puede
-- ser 'hot' (🔒 solo leads); cae a 'warming' porque temp(50) > temp_prev(40) y no hay cambio
-- de estado reciente.
select is(
  pg_temp.crm_band_safe(false, 50, 40, 50,
    (select t0 from t100_anchor) - interval '1 hour', null, (select t0 from t100_anchor)),
  'warming',
  'BAND6_hot_rechaza_p_is_lead_false_cae_a_warming_nunca_hot_ni_cooling'
);

-- BAND7 [cooling rechaza anónimos] — MISMOS argumentos que BAND2 pero p_is_lead=false: no
-- puede ser 'cooling' (🔒 solo leads); tampoco 'warming' (temp 60 no es > temp_prev 90) →
-- 'silent'.
select is(
  pg_temp.crm_band_safe(false, 60, 90, 85,
    (select t0 from t100_anchor) - interval '100 hours', null, (select t0 from t100_anchor)),
  'silent',
  'BAND7_cooling_rechaza_p_is_lead_false_cae_a_silent_nunca_hot_ni_cooling'
);

-- BAND8 [un cambio de estado POSTERIOR a la señal fuerte bloquea hot Y warming] — señal
-- fuerte hace 1h, pero el estado cambió hace 30min (DESPUÉS de la señal, ambos dentro de las
-- 24h): "ningún cambio de estado posterior a esa señal" se rompe → no es 'hot'; y como el
-- cambio de estado también cayó dentro de las últimas 24h, warming tampoco aplica pese a que
-- temp(50) > temp_prev(40) → 'silent'.
select is(
  pg_temp.crm_band_safe(true, 50, 40, 50,
    (select t0 from t100_anchor) - interval '1 hour',
    (select t0 from t100_anchor) - interval '30 minutes',
    (select t0 from t100_anchor)),
  'silent',
  'BAND8_cambio_de_estado_posterior_a_la_senal_fuerte_bloquea_hot_y_warming'
);

select * from finish();
rollback;
