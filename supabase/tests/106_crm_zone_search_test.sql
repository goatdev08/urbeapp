-- Tests pgTAP — private.crm_temperature emparejando zone_search espacialmente
-- (subtarea 268.3, tarea 268 "CRM — señales nuevas"). Ejecutar con:
--   supabase test db supabase/tests/106_crm_zone_search_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de una
-- transacción revertida (no persiste). Impersonamos con pg_temp.act_as(uid, role) SOLO
-- para el assert de ACL (patrón 02/08/.../35/62/100_*); todo lo demás corre en contexto
-- superusuario (bypassa RLS Y privilegios).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba — el contrato PÚBLICO YA EXISTENTE de una función helper interna:
--
--   private.crm_temperature(p_agent_id uuid, p_user_id uuid, p_at timestamptz) returns int
--
-- Firma, security definer, search_path y ACL NO cambian (subtarea 266.2, migración
-- 20260906100001_crm_temperature.sql, tests en 100_crm_temperature_test.sql). Lo que
-- cambia en 268.3 es SOLO el CTE interno `other_events`: hoy suma events_raw.zone_search
-- vía `join properties p on p.id = er.property_id` → owner (igual que contact_repeat) y
-- por eso pesa 0 SIEMPRE, porque el evento zone_search de 268.2 NUNCA trae property_id
-- (contrato: event_type='zone_search', user_id, session_id, payload =
-- {kind:'neighborhood', neighborhood_id} | {kind:'municipality', municipality_id} |
-- {kind:'area', center:{lat,lng}, radius_m}). El GREEN reescribe SOLO esa rama para
-- emparejar por ZONA GEOGRÁFICA contra la propiedad de ORIGEN del lead ACTIVO
-- (lead_origin_properties del lead activo del agente↔usuario consultado), vía
-- ST_Intersects (neighborhood/municipality) o ST_DWithin (area). contact_repeat NO se
-- toca (sigue por property_id → owner).
--
-- SUT AÚN NO REESCRITO (RED 2026-09-06): el GREEN de esta subtarea reemplaza (create or
-- replace) el CTE other_events de private.crm_temperature en
-- supabase/migrations/20260906100001_crm_temperature.sql. Hoy la función existe con la
-- firma correcta (por eso los asserts de catálogo/ACL/contact_repeat pasan YA) pero el
-- emparejamiento espacial de zone_search no existe (por eso los asserts de match dan 0 en
-- vez del literal esperado — RED por ASERCIÓN, no por función inexistente).
--
-- ── Estrategia RED (mismo patrón que 100_crm_temperature_test.sql) ──────────────────────
-- El wrapper pg_temp.crm_temp_safe atrapa cualquier excepción y devuelve NULL — cada
-- assert de comportamiento compara ese resultado contra un LITERAL numérico calculado a
-- mano (nunca is(NULL,NULL), que pasa "ok" en pgTAP). El caso anon-invoca-la-función va
-- ANTES de cualquier fixture o invocación real de la propia función (gotcha 203.1: el
-- EXECUTE se comprueba al planificar y el plan se cachea).
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────────────────
-- Happy path:
--   ZONE1  neighborhood match — propiedad de origen DENTRO del polígono → +8.
--   MUNI1  municipality match — propiedad de origen dentro de UNA colonia del municipio → +8.
--   AREA1  area match — ST_DWithin(centro, radius_m grande) → +8.
-- Edge cases del PRD / contrato 268.2 (§ contrato zone_search sin property_id):
--   ZONE2  neighborhood sin match — origen FUERA del polígono → solo contacto.
--   MUNI2  municipality sin match — origen fuera de TODAS las colonias del municipio.
--   AREA2  area fuera — MISMO centro, radius_m pequeño (misma distancia real ~2000m: el
--          único factor que cambia es radius_m, no la geometría).
-- Ramas de reglas no obvias (§0.5 producción viva: el GREEN es aditivo, esto es lo que
-- el CTE reescrito debe decidir):
--   OLDJOIN1     mutante "dejar el join viejo por property_id→owner": evento con
--                property_id = propiedad DEL AGENTE (el join viejo la contaría, +8) pero
--                el payload de zona NO matchea espacialmente esa propiedad → debe dar 0.
--   NOLEAD1      lead BORRADO (deleted_at) con origen dentro de la zona → zone_search 0
--                (no hay a quién contactar); un like independiente prueba que el resto de
--                la fórmula sigue viva (no es un 0 por fixture vacío).
--   OTHERAGENT1  la propiedad de origen de OTRO agente dentro de la misma zona NO debe
--                filtrarse al resultado de p_agent_id (mata el mutante que olvida acotar
--                por agent_id/user_id el join a lead_origin_properties).
--   OTHERUSER1   el evento de OTRO usuario (mismo agente, misma zona) no cuenta para el
--                usuario consultado — er.user_id = p_user_id se mantiene intacto.
--   ZONEFUTURE1  evento con created_at > p_at no cuenta ("no ver el futuro").
--   MALFORMED1-4 payload malformado ({}, {"kind":"neighborhood"} sin id, neighborhood_id
--                no numérico, kind desconocido) → 0 SIN lanzar excepción (lives_ok sobre
--                la llamada REAL, no el wrapper, que atraparía cualquier excepción y
--                enmascararía un "SI lanza").
--   CONTACTREPEAT1  events_raw.contact_repeat SIGUE por property_id → owner, sin lead
--                   activo siquiera — no cambia con este GREEN.
--   MULTIZONE1   dos zone_search (neighborhood + area) que matchean la MISMA propiedad de
--                origen suman aditivamente (+8 +8).
-- Boundary / error:
--   DECAY_ZONE1  el peso de zone_search decae igual que el resto (+24h, factor 0.92).
--   CONFIG_ZONE1 crm_weight_zone_search recalibrado en app_config cambia el número sin
--                publicar app (precedente CONFIG1/CONFIG2 de 100_crm_temperature_test).
--   SIG1-5 / ACL1-3  la firma pública, security definer, search_path y el revoke de
--                    anon/authenticated de private.crm_temperature NO cambian con este
--                    GREEN (regresión de 266.2).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(31);

-- ── Helper de impersonación (mismo patrón que 02/08/.../35/62/100_*) ────────────────────
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── Wrapper RED: atrapa cualquier excepción sin abortar la transacción ──────────────────
create or replace function pg_temp.crm_temp_safe(p_agent_id uuid, p_user_id uuid, p_at timestamptz)
returns int language plpgsql as $$
declare v_result int;
begin
  select private.crm_temperature(p_agent_id, p_user_id, p_at) into v_result;
  return v_result;
exception when others then
  return null;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Firma pública / ACL — regresión de 266.2 (NO debe cambiar con este GREEN).
-- ════════════════════════════════════════════════════════════════════════════

select has_function('private', 'crm_temperature', array['uuid', 'uuid', 'timestamptz'],
  'SIG1_private_crm_temperature_sigue_existiendo_con_la_misma_firma');

select function_returns('private', 'crm_temperature', array['uuid', 'uuid', 'timestamptz'], 'int',
  'SIG2_crm_temperature_sigue_retornando_int');

select is(
  (select pg_get_function_arguments(to_regprocedure('private.crm_temperature(uuid,uuid,timestamptz)'))),
  'p_agent_id uuid, p_user_id uuid, p_at timestamp with time zone',
  'SIG3_argumentos_EXACTOS_sin_cambio_mata_el_renombre'
);

select is(
  (select prosecdef from pg_proc where proname = 'crm_temperature' and pronamespace = 'private'::regnamespace),
  true,
  'SIG4_sigue_siendo_security_definer'
);

select is(
  (select proconfig from pg_proc where proname = 'crm_temperature' and pronamespace = 'private'::regnamespace),
  array['search_path=""']::text[],
  'SIG5_search_path_vacio_fijo_sin_cambio'
);

select function_privs_are('private', 'crm_temperature', array['uuid', 'uuid', 'timestamptz'],
  'anon', array[]::name[],
  'ACL1_anon_SIGUE_sin_execute');
select function_privs_are('private', 'crm_temperature', array['uuid', 'uuid', 'timestamptz'],
  'authenticated', array[]::name[],
  'ACL2_authenticated_SIGUE_sin_execute');

-- Invocación real bajo anon — PRIMERA llamada real a la función en todo el archivo
-- (gotcha 203.1: el plan se cachea; si una llamada exitosa se cacheara antes, anon la
-- heredaría en falso).
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select private.crm_temperature('00000000-0000-0000-0000-000000268001'::uuid,
                                     '00000000-0000-0000-0000-000000268002'::uuid, now()) $$,
  '42501', null,
  'ACL3_anon_no_puede_ejecutar_crm_temperature_42501_primera_llamada_real'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Fixtures — prefijo '00000000-0000-0000-0000-000000268XXX' (subtarea 268.3, fuera de
--    los rangos usados por otras subtareas). Ancla T0 con offset UTC explícito; deltas en
--    HORAS (nunca 'interval N days': bomba de fecha calendárica, precedente 100_*).
-- ════════════════════════════════════════════════════════════════════════════

create temp table t268_anchor as
select '2026-09-06T12:00:00+00'::timestamptz as t0;

-- ── Colonias sintéticas (municipio real '14039' = Guadalajara, ya sembrado por el
--    catálogo INEGI de 20260727000001; NO se cargan colonias reales de GDL en el stack
--    de pruebas — el dataset real entra por script de import aparte — así que estos
--    cuadrados oceánicos son las ÚNICAS colonias de esa municipalidad en esta tx) ───────
insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('test-268-zone-a', '14039', 'Colonia 268 — Zona A (match neighborhood/multizone)',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-115.00, 22.00, -114.96, 22.04, 4326))::extensions.geography),
  ('test-268-zone-b', '14039', 'Colonia 268 — Zona B (match municipality)',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-115.10, 22.00, -115.06, 22.04, 4326))::extensions.geography);

-- Punto DENTRO de zona A (centro del cuadrado) — reusado como centro del área en MULTIZONE.
-- Punto DENTRO de zona B. Punto FUERA de ambas (lejos, mismo océano).
-- extensions.ST_SetSRID(extensions.ST_MakePoint(lng, lat), 4326) — convención del repo.

insert into auth.users (id, email) values
  -- ZONE1 (match neighborhood) + DECAY_ZONE1 + CONFIG_ZONE1 (mismo fixture, reutilizado)
  ('00000000-0000-0000-0000-000000268001', 'agent-zone1.268@test.local'),
  ('00000000-0000-0000-0000-000000268002', 'user-zone1.268@test.local'),
  -- ZONE2 (sin match neighborhood)
  ('00000000-0000-0000-0000-000000268011', 'agent-zone2.268@test.local'),
  ('00000000-0000-0000-0000-000000268012', 'user-zone2.268@test.local'),
  -- MUNI1 (match municipality)
  ('00000000-0000-0000-0000-000000268021', 'agent-muni1.268@test.local'),
  ('00000000-0000-0000-0000-000000268022', 'user-muni1.268@test.local'),
  -- MUNI2 (sin match municipality)
  ('00000000-0000-0000-0000-000000268031', 'agent-muni2.268@test.local'),
  ('00000000-0000-0000-0000-000000268032', 'user-muni2.268@test.local'),
  -- AREA1 (match area, radius grande)
  ('00000000-0000-0000-0000-000000268041', 'agent-area1.268@test.local'),
  ('00000000-0000-0000-0000-000000268042', 'user-area1.268@test.local'),
  -- AREA2 (sin match area, mismo centro, radius pequeño)
  ('00000000-0000-0000-0000-000000268051', 'agent-area2.268@test.local'),
  ('00000000-0000-0000-0000-000000268052', 'user-area2.268@test.local'),
  -- OLDJOIN1 (mata el mutante del join viejo por property_id->owner)
  ('00000000-0000-0000-0000-000000268061', 'agent-oldjoin1.268@test.local'),
  ('00000000-0000-0000-0000-000000268062', 'user-oldjoin1.268@test.local'),
  -- NOLEAD1 (lead borrado, origen dentro de la zona, pero no cuenta)
  ('00000000-0000-0000-0000-000000268071', 'agent-nolead1.268@test.local'),
  ('00000000-0000-0000-0000-000000268072', 'user-nolead1.268@test.local'),
  -- OTHERAGENT1 (agente X consultado; agente Y con origen dentro de la zona no debe filtrarse)
  ('00000000-0000-0000-0000-000000268081', 'agent-x-otheragent1.268@test.local'),
  ('00000000-0000-0000-0000-000000268082', 'user-x-otheragent1.268@test.local'),
  ('00000000-0000-0000-0000-000000268085', 'agent-y-otheragent1.268@test.local'),
  ('00000000-0000-0000-0000-000000268086', 'user-y-otheragent1.268@test.local'),
  -- OTHERUSER1 (evento de un usuario distinto al consultado no cuenta)
  ('00000000-0000-0000-0000-000000268091', 'agent-otheruser1.268@test.local'),
  ('00000000-0000-0000-0000-000000268092', 'user-otheruser1.268@test.local'),
  ('00000000-0000-0000-0000-000000268095', 'stranger-otheruser1.268@test.local'),
  -- ZONEFUTURE1 (evento con created_at > p_at no cuenta)
  ('00000000-0000-0000-0000-000000268101', 'agent-zonefuture1.268@test.local'),
  ('00000000-0000-0000-0000-000000268102', 'user-zonefuture1.268@test.local'),
  -- MALFORMED1-4 (payload malformado, 0 sin excepción)
  ('00000000-0000-0000-0000-000000268111', 'agent-malformed1.268@test.local'),
  ('00000000-0000-0000-0000-000000268112', 'user-malformed1.268@test.local'),
  ('00000000-0000-0000-0000-000000268121', 'agent-malformed2.268@test.local'),
  ('00000000-0000-0000-0000-000000268122', 'user-malformed2.268@test.local'),
  ('00000000-0000-0000-0000-000000268131', 'agent-malformed3.268@test.local'),
  ('00000000-0000-0000-0000-000000268132', 'user-malformed3.268@test.local'),
  ('00000000-0000-0000-0000-000000268141', 'agent-malformed4.268@test.local'),
  ('00000000-0000-0000-0000-000000268142', 'user-malformed4.268@test.local'),
  -- CONTACTREPEAT1 (contact_repeat sigue por property_id->owner, sin lead siquiera)
  ('00000000-0000-0000-0000-000000268151', 'agent-contactrepeat1.268@test.local'),
  ('00000000-0000-0000-0000-000000268152', 'user-contactrepeat1.268@test.local'),
  -- MULTIZONE1 (neighborhood + area matchean la misma propiedad, suman)
  ('00000000-0000-0000-0000-000000268161', 'agent-multizone1.268@test.local'),
  ('00000000-0000-0000-0000-000000268162', 'user-multizone1.268@test.local');

update public.users set role = 'agent', is_verified_agent = true
  where id in (
    '00000000-0000-0000-0000-000000268001', '00000000-0000-0000-0000-000000268011',
    '00000000-0000-0000-0000-000000268021', '00000000-0000-0000-0000-000000268031',
    '00000000-0000-0000-0000-000000268041', '00000000-0000-0000-0000-000000268051',
    '00000000-0000-0000-0000-000000268061', '00000000-0000-0000-0000-000000268071',
    '00000000-0000-0000-0000-000000268081', '00000000-0000-0000-0000-000000268085',
    '00000000-0000-0000-0000-000000268091', '00000000-0000-0000-0000-000000268101',
    '00000000-0000-0000-0000-000000268111', '00000000-0000-0000-0000-000000268121',
    '00000000-0000-0000-0000-000000268131', '00000000-0000-0000-0000-000000268141',
    '00000000-0000-0000-0000-000000268151', '00000000-0000-0000-0000-000000268161'
  );

-- ── Propiedades de origen (una por grupo; ubicaciones dentro/fuera de las zonas) ───────
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  -- ZONE1: dentro de la zona A (centro del cuadrado, -114.98/22.02)
  ('00000000-0000-0000-0000-000000268003', '00000000-0000-0000-0000-000000268001',
   'departamento', 'rent', 'Fixture 268 — ZONE1 origen dentro de zona A',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-114.98, 22.02), 4326)::extensions.geography, 12000, 'active'),
  -- ZONE2: fuera de ambas zonas
  ('00000000-0000-0000-0000-000000268013', '00000000-0000-0000-0000-000000268011',
   'departamento', 'rent', 'Fixture 268 — ZONE2 origen fuera de toda zona',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-116.00, 22.02), 4326)::extensions.geography, 12000, 'active'),
  -- MUNI1: dentro de la zona B (municipio 14039)
  ('00000000-0000-0000-0000-000000268023', '00000000-0000-0000-0000-000000268021',
   'departamento', 'rent', 'Fixture 268 — MUNI1 origen dentro de zona B',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-115.08, 22.02), 4326)::extensions.geography, 12000, 'active'),
  -- MUNI2: fuera de A y B, mismo municipio en el payload
  ('00000000-0000-0000-0000-000000268033', '00000000-0000-0000-0000-000000268031',
   'departamento', 'rent', 'Fixture 268 — MUNI2 origen fuera de toda colonia del municipio',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-116.00, 22.02), 4326)::extensions.geography, 12000, 'active'),
  -- AREA1/AREA2: MISMO punto (~2003m al norte del centro del área), solo cambia radius_m
  ('00000000-0000-0000-0000-000000268043', '00000000-0000-0000-0000-000000268041',
   'departamento', 'rent', 'Fixture 268 — AREA1 origen a ~2000m del centro (radius grande)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-115.300, 22.118), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-000000268053', '00000000-0000-0000-0000-000000268051',
   'departamento', 'rent', 'Fixture 268 — AREA2 origen a ~2000m del centro (radius chico)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-115.300, 22.118), 4326)::extensions.geography, 12000, 'active'),
  -- OLDJOIN1: origen FUERA de zona A (el evento referenciará property_id = esta misma
  -- propiedad, propiedad del agente, para tentar al join viejo)
  ('00000000-0000-0000-0000-000000268063', '00000000-0000-0000-0000-000000268061',
   'departamento', 'rent', 'Fixture 268 — OLDJOIN1 origen fuera de zona A pero property_id apunta aqui',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-116.00, 22.02), 4326)::extensions.geography, 12000, 'active'),
  -- NOLEAD1: origen DENTRO de zona A, pero el lead estará borrado
  ('00000000-0000-0000-0000-000000268073', '00000000-0000-0000-0000-000000268071',
   'departamento', 'rent', 'Fixture 268 — NOLEAD1 origen dentro de zona A con lead borrado',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-114.98, 22.02), 4326)::extensions.geography, 12000, 'active'),
  -- OTHERAGENT1: agente X origen FUERA de zona A; agente Y origen DENTRO de zona A
  ('00000000-0000-0000-0000-000000268084', '00000000-0000-0000-0000-000000268081',
   'departamento', 'rent', 'Fixture 268 — OTHERAGENT1 origen de X fuera de zona A',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-116.00, 22.02), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-000000268088', '00000000-0000-0000-0000-000000268085',
   'departamento', 'rent', 'Fixture 268 — OTHERAGENT1 origen de Y dentro de zona A',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-114.98, 22.02), 4326)::extensions.geography, 12000, 'active'),
  -- OTHERUSER1: origen DENTRO de zona A (el evento del extraño matchearía si contara)
  ('00000000-0000-0000-0000-000000268094', '00000000-0000-0000-0000-000000268091',
   'departamento', 'rent', 'Fixture 268 — OTHERUSER1 origen dentro de zona A',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-114.98, 22.02), 4326)::extensions.geography, 12000, 'active'),
  -- ZONEFUTURE1: origen DENTRO de zona A (el evento futuro matchearía si contara)
  ('00000000-0000-0000-0000-000000268104', '00000000-0000-0000-0000-000000268101',
   'departamento', 'rent', 'Fixture 268 — ZONEFUTURE1 origen dentro de zona A',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-114.98, 22.02), 4326)::extensions.geography, 12000, 'active'),
  -- MALFORMED1-4: ubicación irrelevante (fuera de toda zona)
  ('00000000-0000-0000-0000-000000268114', '00000000-0000-0000-0000-000000268111',
   'departamento', 'rent', 'Fixture 268 — MALFORMED1 origen',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-116.00, 22.02), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-000000268124', '00000000-0000-0000-0000-000000268121',
   'departamento', 'rent', 'Fixture 268 — MALFORMED2 origen',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-116.00, 22.02), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-000000268134', '00000000-0000-0000-0000-000000268131',
   'departamento', 'rent', 'Fixture 268 — MALFORMED3 origen',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-116.00, 22.02), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-000000268144', '00000000-0000-0000-0000-000000268141',
   'departamento', 'rent', 'Fixture 268 — MALFORMED4 origen',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-116.00, 22.02), 4326)::extensions.geography, 12000, 'active'),
  -- CONTACTREPEAT1: propiedad del agente, ubicación irrelevante (sin lead)
  ('00000000-0000-0000-0000-000000268153', '00000000-0000-0000-0000-000000268151',
   'departamento', 'rent', 'Fixture 268 — CONTACTREPEAT1 propiedad del agente',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-116.00, 22.02), 4326)::extensions.geography, 12000, 'active'),
  -- MULTIZONE1: EXACTAMENTE en el centro de zona A (también centro del área del payload)
  ('00000000-0000-0000-0000-000000268164', '00000000-0000-0000-0000-000000268161',
   'departamento', 'rent', 'Fixture 268 — MULTIZONE1 origen en el centro de zona A y del area',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-114.98, 22.02), 4326)::extensions.geography, 12000, 'active');

-- ── Leads activos (uno por grupo, salvo NOLEAD1 que se borra y CONTACTREPEAT1 que no
--    tiene lead alguno) ──────────────────────────────────────────────────────────────
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000268004', '00000000-0000-0000-0000-000000268001',
   '00000000-0000-0000-0000-000000268002', 'whatsapp_opened'),
  ('00000000-0000-0000-0000-000000268014', '00000000-0000-0000-0000-000000268011',
   '00000000-0000-0000-0000-000000268012', 'whatsapp_opened'),
  ('00000000-0000-0000-0000-000000268024', '00000000-0000-0000-0000-000000268021',
   '00000000-0000-0000-0000-000000268022', 'whatsapp_opened'),
  ('00000000-0000-0000-0000-000000268034', '00000000-0000-0000-0000-000000268031',
   '00000000-0000-0000-0000-000000268032', 'whatsapp_opened'),
  ('00000000-0000-0000-0000-000000268044', '00000000-0000-0000-0000-000000268041',
   '00000000-0000-0000-0000-000000268042', 'whatsapp_opened'),
  ('00000000-0000-0000-0000-000000268054', '00000000-0000-0000-0000-000000268051',
   '00000000-0000-0000-0000-000000268052', 'whatsapp_opened'),
  ('00000000-0000-0000-0000-000000268064', '00000000-0000-0000-0000-000000268061',
   '00000000-0000-0000-0000-000000268062', 'whatsapp_opened'),
  ('00000000-0000-0000-0000-000000268074', '00000000-0000-0000-0000-000000268071',
   '00000000-0000-0000-0000-000000268072', 'discarded'),  -- se borra abajo
  ('00000000-0000-0000-0000-000000268083', '00000000-0000-0000-0000-000000268081',
   '00000000-0000-0000-0000-000000268082', 'whatsapp_opened'),
  ('00000000-0000-0000-0000-000000268087', '00000000-0000-0000-0000-000000268085',
   '00000000-0000-0000-0000-000000268086', 'whatsapp_opened'),
  ('00000000-0000-0000-0000-000000268093', '00000000-0000-0000-0000-000000268091',
   '00000000-0000-0000-0000-000000268092', 'whatsapp_opened'),
  ('00000000-0000-0000-0000-000000268103', '00000000-0000-0000-0000-000000268101',
   '00000000-0000-0000-0000-000000268102', 'whatsapp_opened'),
  ('00000000-0000-0000-0000-000000268113', '00000000-0000-0000-0000-000000268111',
   '00000000-0000-0000-0000-000000268112', 'whatsapp_opened'),
  ('00000000-0000-0000-0000-000000268123', '00000000-0000-0000-0000-000000268121',
   '00000000-0000-0000-0000-000000268122', 'whatsapp_opened'),
  ('00000000-0000-0000-0000-000000268133', '00000000-0000-0000-0000-000000268131',
   '00000000-0000-0000-0000-000000268132', 'whatsapp_opened'),
  ('00000000-0000-0000-0000-000000268143', '00000000-0000-0000-0000-000000268141',
   '00000000-0000-0000-0000-000000268142', 'whatsapp_opened'),
  ('00000000-0000-0000-0000-000000268163', '00000000-0000-0000-0000-000000268161',
   '00000000-0000-0000-0000-000000268162', 'whatsapp_opened');

update public.leads set deleted_at = (select t0 from t268_anchor)
  where id = '00000000-0000-0000-0000-000000268074';

insert into public.lead_origin_properties (lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000268004', '00000000-0000-0000-0000-000000268003', (select t0 from t268_anchor)),
  ('00000000-0000-0000-0000-000000268014', '00000000-0000-0000-0000-000000268013', (select t0 from t268_anchor)),
  ('00000000-0000-0000-0000-000000268024', '00000000-0000-0000-0000-000000268023', (select t0 from t268_anchor)),
  ('00000000-0000-0000-0000-000000268034', '00000000-0000-0000-0000-000000268033', (select t0 from t268_anchor)),
  ('00000000-0000-0000-0000-000000268044', '00000000-0000-0000-0000-000000268043', (select t0 from t268_anchor)),
  ('00000000-0000-0000-0000-000000268054', '00000000-0000-0000-0000-000000268053', (select t0 from t268_anchor)),
  ('00000000-0000-0000-0000-000000268064', '00000000-0000-0000-0000-000000268063', (select t0 from t268_anchor)),
  ('00000000-0000-0000-0000-000000268074', '00000000-0000-0000-0000-000000268073', (select t0 from t268_anchor)),
  ('00000000-0000-0000-0000-000000268083', '00000000-0000-0000-0000-000000268084', (select t0 from t268_anchor)),
  ('00000000-0000-0000-0000-000000268087', '00000000-0000-0000-0000-000000268088', (select t0 from t268_anchor)),
  ('00000000-0000-0000-0000-000000268093', '00000000-0000-0000-0000-000000268094', (select t0 from t268_anchor)),
  ('00000000-0000-0000-0000-000000268103', '00000000-0000-0000-0000-000000268104', (select t0 from t268_anchor)),
  ('00000000-0000-0000-0000-000000268113', '00000000-0000-0000-0000-000000268114', (select t0 from t268_anchor)),
  ('00000000-0000-0000-0000-000000268123', '00000000-0000-0000-0000-000000268124', (select t0 from t268_anchor)),
  ('00000000-0000-0000-0000-000000268133', '00000000-0000-0000-0000-000000268134', (select t0 from t268_anchor)),
  ('00000000-0000-0000-0000-000000268143', '00000000-0000-0000-0000-000000268144', (select t0 from t268_anchor)),
  ('00000000-0000-0000-0000-000000268163', '00000000-0000-0000-0000-000000268164', (select t0 from t268_anchor));

-- ── NOLEAD1: like independiente (weight 5) para probar que el 0 de zone_search NO es
--    un fixture vacío — el resto de la fórmula sigue viva ──────────────────────────────
insert into public.property_videos (id, property_id, status, position, cloudflare_uid) values
  ('00000000-0000-0000-0000-000000268075', '00000000-0000-0000-0000-000000268073', 'ready', 1, 'cf-268075');
insert into public.likes (user_id, property_video_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000268072', '00000000-0000-0000-0000-000000268075',
   '00000000-0000-0000-0000-000000268073', (select t0 from t268_anchor));

-- ── events_raw.zone_search — property_id SIEMPRE NULL (contrato 268.2), salvo OLDJOIN1
--    que lo pone a propósito para tentar al join viejo ──────────────────────────────────
insert into public.events_raw (event_type, user_id, property_id, payload, created_at) values
  ('zone_search', '00000000-0000-0000-0000-000000268002', null,
   json_build_object('kind', 'neighborhood', 'neighborhood_id',
     (select n.id::text from public.mx_neighborhoods n where n.source_key = 'test-268-zone-a'))::jsonb,
   (select t0 from t268_anchor)),
  ('zone_search', '00000000-0000-0000-0000-000000268012', null,
   json_build_object('kind', 'neighborhood', 'neighborhood_id',
     (select n.id::text from public.mx_neighborhoods n where n.source_key = 'test-268-zone-a'))::jsonb,
   (select t0 from t268_anchor)),
  ('zone_search', '00000000-0000-0000-0000-000000268022', null,
   '{"kind":"municipality","municipality_id":"14039"}'::jsonb,
   (select t0 from t268_anchor)),
  ('zone_search', '00000000-0000-0000-0000-000000268032', null,
   '{"kind":"municipality","municipality_id":"14039"}'::jsonb,
   (select t0 from t268_anchor)),
  ('zone_search', '00000000-0000-0000-0000-000000268042', null,
   '{"kind":"area","center":{"lat":22.100,"lng":-115.300},"radius_m":5000}'::jsonb,
   (select t0 from t268_anchor)),
  ('zone_search', '00000000-0000-0000-0000-000000268052', null,
   '{"kind":"area","center":{"lat":22.100,"lng":-115.300},"radius_m":500}'::jsonb,
   (select t0 from t268_anchor)),
  -- OLDJOIN1: property_id apunta a una propiedad DEL AGENTE (el join viejo la contaría),
  -- pero el payload referencia zona A, que esa propiedad NO toca.
  ('zone_search', '00000000-0000-0000-0000-000000268062', '00000000-0000-0000-0000-000000268063',
   json_build_object('kind', 'neighborhood', 'neighborhood_id',
     (select n.id::text from public.mx_neighborhoods n where n.source_key = 'test-268-zone-a'))::jsonb,
   (select t0 from t268_anchor)),
  ('zone_search', '00000000-0000-0000-0000-000000268072', null,
   json_build_object('kind', 'neighborhood', 'neighborhood_id',
     (select n.id::text from public.mx_neighborhoods n where n.source_key = 'test-268-zone-a'))::jsonb,
   (select t0 from t268_anchor)),
  -- OTHERAGENT1: evento del usuario X (buscador de X), zona A, matchea el origen de Y
  -- (agente distinto) — NO debe filtrarse al resultado de X.
  ('zone_search', '00000000-0000-0000-0000-000000268082', null,
   json_build_object('kind', 'neighborhood', 'neighborhood_id',
     (select n.id::text from public.mx_neighborhoods n where n.source_key = 'test-268-zone-a'))::jsonb,
   (select t0 from t268_anchor)),
  -- OTHERUSER1: evento creado por el EXTRAÑO (user 095), no por el usuario consultado (092).
  ('zone_search', '00000000-0000-0000-0000-000000268095', null,
   json_build_object('kind', 'neighborhood', 'neighborhood_id',
     (select n.id::text from public.mx_neighborhoods n where n.source_key = 'test-268-zone-a'))::jsonb,
   (select t0 from t268_anchor)),
  -- ZONEFUTURE1: created_at 1 hora DESPUÉS de p_at (t0).
  ('zone_search', '00000000-0000-0000-0000-000000268102', null,
   json_build_object('kind', 'neighborhood', 'neighborhood_id',
     (select n.id::text from public.mx_neighborhoods n where n.source_key = 'test-268-zone-a'))::jsonb,
   (select t0 from t268_anchor) + interval '1 hour'),
  -- MALFORMED1: payload vacío.
  ('zone_search', '00000000-0000-0000-0000-000000268112', null, '{}'::jsonb, (select t0 from t268_anchor)),
  -- MALFORMED2: kind neighborhood sin neighborhood_id.
  ('zone_search', '00000000-0000-0000-0000-000000268122', null,
   '{"kind":"neighborhood"}'::jsonb, (select t0 from t268_anchor)),
  -- MALFORMED3: neighborhood_id no numérico.
  ('zone_search', '00000000-0000-0000-0000-000000268132', null,
   '{"kind":"neighborhood","neighborhood_id":"abc"}'::jsonb, (select t0 from t268_anchor)),
  -- MALFORMED4: kind desconocido.
  ('zone_search', '00000000-0000-0000-0000-000000268142', null,
   '{"kind":"unknown_kind_xyz"}'::jsonb, (select t0 from t268_anchor)),
  -- MULTIZONE1: DOS eventos, neighborhood (zona A) + area (mismo centro que zona A) —
  -- ambos matchean la MISMA propiedad de origen.
  ('zone_search', '00000000-0000-0000-0000-000000268162', null,
   json_build_object('kind', 'neighborhood', 'neighborhood_id',
     (select n.id::text from public.mx_neighborhoods n where n.source_key = 'test-268-zone-a'))::jsonb,
   (select t0 from t268_anchor)),
  ('zone_search', '00000000-0000-0000-0000-000000268162', null,
   '{"kind":"area","center":{"lat":22.020,"lng":-114.980},"radius_m":5000}'::jsonb,
   (select t0 from t268_anchor));

-- ── CONTACTREPEAT1: contact_repeat sigue por property_id -> owner, SIN lead alguno ─────
insert into public.events_raw (event_type, user_id, property_id, created_at) values
  ('contact_repeat', '00000000-0000-0000-0000-000000268152', '00000000-0000-0000-0000-000000268153',
   (select t0 from t268_anchor));

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Happy path — neighborhood / municipality / area, con match.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000268001'::uuid,
                         '00000000-0000-0000-0000-000000268002'::uuid, (select t0 from t268_anchor)),
  38,
  'ZONE1_neighborhood_match_contacto_30_mas_zone_search_8_38'
);

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000268021'::uuid,
                         '00000000-0000-0000-0000-000000268022'::uuid, (select t0 from t268_anchor)),
  38,
  'MUNI1_municipality_match_via_una_colonia_del_municipio_38'
);

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000268041'::uuid,
                         '00000000-0000-0000-0000-000000268042'::uuid, (select t0 from t268_anchor)),
  38,
  'AREA1_area_match_ST_DWithin_radius_grande_38'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Edge cases del contrato 268.2 — sin match.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000268011'::uuid,
                         '00000000-0000-0000-0000-000000268012'::uuid, (select t0 from t268_anchor)),
  30,
  'ZONE2_neighborhood_sin_match_origen_fuera_del_poligono_solo_contacto_30'
);

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000268031'::uuid,
                         '00000000-0000-0000-0000-000000268032'::uuid, (select t0 from t268_anchor)),
  30,
  'MUNI2_municipality_sin_match_origen_fuera_de_toda_colonia_del_municipio_30'
);

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000268051'::uuid,
                         '00000000-0000-0000-0000-000000268052'::uuid, (select t0 from t268_anchor)),
  30,
  'AREA2_area_fuera_mismo_centro_radius_pequeno_30'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Ramas de reglas no obvias.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000268061'::uuid,
                         '00000000-0000-0000-0000-000000268062'::uuid, (select t0 from t268_anchor)),
  30,
  'OLDJOIN1_property_id_de_una_propiedad_del_agente_sin_match_espacial_no_cuenta_30'
);

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000268071'::uuid,
                         '00000000-0000-0000-0000-000000268072'::uuid, (select t0 from t268_anchor)),
  5,
  'NOLEAD1_lead_borrado_zone_search_0_pese_al_match_espacial_solo_el_like_5'
);

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000268081'::uuid,
                         '00000000-0000-0000-0000-000000268082'::uuid, (select t0 from t268_anchor)),
  30,
  'OTHERAGENT1_origen_de_otro_agente_dentro_de_la_zona_no_se_filtra_a_p_agent_id_30'
);

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000268091'::uuid,
                         '00000000-0000-0000-0000-000000268092'::uuid, (select t0 from t268_anchor)),
  30,
  'OTHERUSER1_evento_de_otro_usuario_no_cuenta_para_el_usuario_consultado_30'
);

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000268101'::uuid,
                         '00000000-0000-0000-0000-000000268102'::uuid, (select t0 from t268_anchor)),
  30,
  'ZONEFUTURE1_evento_con_created_at_mayor_a_p_at_no_cuenta_30'
);

select lives_ok(
  $$ select private.crm_temperature('00000000-0000-0000-0000-000000268111'::uuid,
                                     '00000000-0000-0000-0000-000000268112'::uuid,
                                     '2026-09-06T12:00:00+00'::timestamptz) $$,
  'MALFORMED1_payload_vacio_no_lanza_excepcion'
);
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000268111'::uuid,
                         '00000000-0000-0000-0000-000000268112'::uuid, (select t0 from t268_anchor)),
  30,
  'MALFORMED1b_payload_vacio_aporta_0_solo_contacto_30'
);

select lives_ok(
  $$ select private.crm_temperature('00000000-0000-0000-0000-000000268121'::uuid,
                                     '00000000-0000-0000-0000-000000268122'::uuid,
                                     '2026-09-06T12:00:00+00'::timestamptz) $$,
  'MALFORMED2_kind_neighborhood_sin_id_no_lanza_excepcion'
);
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000268121'::uuid,
                         '00000000-0000-0000-0000-000000268122'::uuid, (select t0 from t268_anchor)),
  30,
  'MALFORMED2b_kind_neighborhood_sin_id_aporta_0_solo_contacto_30'
);

select lives_ok(
  $$ select private.crm_temperature('00000000-0000-0000-0000-000000268131'::uuid,
                                     '00000000-0000-0000-0000-000000268132'::uuid,
                                     '2026-09-06T12:00:00+00'::timestamptz) $$,
  'MALFORMED3_neighborhood_id_no_numerico_no_lanza_excepcion'
);
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000268131'::uuid,
                         '00000000-0000-0000-0000-000000268132'::uuid, (select t0 from t268_anchor)),
  30,
  'MALFORMED3b_neighborhood_id_no_numerico_aporta_0_solo_contacto_30'
);

select lives_ok(
  $$ select private.crm_temperature('00000000-0000-0000-0000-000000268141'::uuid,
                                     '00000000-0000-0000-0000-000000268142'::uuid,
                                     '2026-09-06T12:00:00+00'::timestamptz) $$,
  'MALFORMED4_kind_desconocido_no_lanza_excepcion'
);
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000268141'::uuid,
                         '00000000-0000-0000-0000-000000268142'::uuid, (select t0 from t268_anchor)),
  30,
  'MALFORMED4b_kind_desconocido_aporta_0_solo_contacto_30'
);

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000268151'::uuid,
                         '00000000-0000-0000-0000-000000268152'::uuid, (select t0 from t268_anchor)),
  30,
  'CONTACTREPEAT1_contact_repeat_sigue_por_property_id_owner_sin_lead_30'
);

select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000268161'::uuid,
                         '00000000-0000-0000-0000-000000268162'::uuid, (select t0 from t268_anchor)),
  46,
  'MULTIZONE1_neighborhood_mas_area_matchean_la_misma_propiedad_suman_30_mas_8_mas_8_46'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Boundary / error — decaimiento y recalibración sin deploy.
-- ════════════════════════════════════════════════════════════════════════════

-- round(30·0.92 + 8·0.92) = round(27.6 + 7.36) = round(34.96) = 35.
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000268001'::uuid,
    '00000000-0000-0000-0000-000000268002'::uuid, (select t0 from t268_anchor) + interval '24 hours'),
  35,
  'DECAY_ZONE1_el_peso_de_zone_search_decae_igual_que_el_resto_35'
);

insert into public.app_config (key, value) values ('crm_weight_zone_search', '20'::jsonb);
select is(
  pg_temp.crm_temp_safe('00000000-0000-0000-0000-000000268001'::uuid,
                         '00000000-0000-0000-0000-000000268002'::uuid, (select t0 from t268_anchor)),
  50,
  'CONFIG_ZONE1_recalibrar_crm_weight_zone_search_en_app_config_cambia_el_numero_sin_publicar_app_50'
);
delete from public.app_config where key = 'crm_weight_zone_search';

select * from finish();
rollback;
