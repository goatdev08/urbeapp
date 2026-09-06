-- Tests pgTAP — public.crm_radar_anon (subtarea 266.6, exploración 045 "Rediseño CRM"
-- §7.5/§12/§14 T-A). LA PIEZA DE MAYOR RIESGO DE PRIVACIDAD DE LA ÉPICA: es la forma EXACTA
-- de la fuga 75.3 (events_raw de personas SIN lead, servido con security definer). Ejecutar
-- con:
--   supabase test db supabase/tests/104_crm_radar_anon_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de una transacción
-- revertida (no persiste). El rol `postgres` de este proyecto NO es superuser real
-- (20260904300001) pero SÍ es dueño de las funciones/tablas — bypassa RLS por ownership y
-- retiene EXECUTE implícito pese al REVOKE FROM public/anon/authenticated, así que las
-- llamadas "autorizadas" solo necesitan fijar el claim JWT (pg_temp.act_as, patrón
-- 02/35/62/100/101/102/103).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba (contrato PÚBLICO, comportamiento observable, NUNCA internals):
--   public.crm_radar_anon(p_agent_id uuid, p_limit int)
--   → TABLE(row_n int, property_label text, temperature int, delta int, sparkline int[],
--           signals jsonb, last_activity_at timestamptz)
--   — EXACTAMENTE esas 7 columnas y ninguna más, ninguna capaz de portar identidad; security
--   definer + stable + search_path=''; ACL (revoke public/anon, grant authenticated);
--   autorización fail-closed en el cuerpo (private.can_manage_agent_pipeline, YA EXISTE —
--   subtarea 266.4, reusar, NO reescribir); pipeline de 6 pasos de §7.5/plan (propiedades del
--   agente → usuarios con actividad en la ventana SIN lead activo → k-anonimato POR PROPIEDAD
--   con count(distinct user_id) → temperatura/delta por private.crm_temperature (266.2), solo
--   Δ>0 → sparkline desde events_raw → row_n con orden NO estable por persona).
-- SUT (AÚN NO EXISTE — RED 2026-09-06): supabase/migrations/2026MMDDNNNNNN_crm_radar_anon.sql
-- debe crear esta función. Sin stub en supabase/migrations/ (regla del protocolo): el RED se
-- sostiene en catálogo (pg_proc/pg_get_function_*, seguros aunque la función no exista) y en
-- un wrapper que atrapa CUALQUIER excepción real.
--
-- ── Estrategia RED sin depender de "function does not exist" (mismo patrón que 100/101/
--    102/103, adaptado a UNA función SETOF de UN solo argumento agente) ─────────────────────
-- (a) Los asserts de catálogo puro (has_function/pg_get_function_*/pg_proc/
--     function_privs_are) son seguros aunque la función no exista.
-- (b) TODA llamada real pasa por pg_temp.radar_json(p_agent_id, p_limit), que agrega las
--     filas a jsonb (jsonb_agg) y atrapa CUALQUIER excepción devolviendo el sentinel
--     '[{"__error__": true}, {"__error__": true}]'::jsonb.
-- (c) 🔴 MEJORA sobre 102/103 (necesaria en ESTE archivo): en vez de medir con
--     jsonb_array_length(...) crudo, TODA medición de "cuántas filas reales" pasa por
--     pg_temp.real_count(v) — cuenta SOLO los elementos que tienen la clave 'property_label'
--     (presente en CUALQUIER fila real, AUSENTE en el sentinel). Motivo: este archivo tiene
--     escenarios con conteos esperados de 0/1/2/3/4/5 — si se comparara jsonb_array_length
--     crudo contra un esperado de exactamente 2, el sentinel (longitud 2 a propósito, para no
--     colisionar con los conteos de 102/103) colisionaría por casualidad AQUÍ y daría un falso
--     verde en RED. pg_temp.real_count nunca colisiona: el sentinel jamás tiene
--     'property_label', así que su real_count es SIEMPRE 0, sin importar su longitud cruda.
-- (d) Gotcha 203.1 (el EXECUTE se comprueba al planificar y el plan se cachea): el caso ACL de
--     `anon` va SIN wrapper, con throws_ok directo, y es la PRIMERA invocación real de la
--     función en el archivo.
--
-- ── Decisiones de diseño del test-author (el contrato no las fijaba; se deciden aquí y el
--    GREEN debe cumplirlas exactamente — están en la bitácora de la subtarea) ───────────────
-- D-DEFAULTS-RADAR: crm_radar_anon(p_agent_id uuid, p_limit int DEFAULT 20) — mismo default 20
--   que crm_leads_page/lead_activity (266.4/266.5); NULL explícito debe comportarse como el
--   default (D-LIMIT-RADAR abajo), no como "sin límite".
-- D-AUTZ-REUSE: autorización IDÉNTICA a crm_leads_page/crm_funnel (266.4): fail-closed,
--   p_agent_id=auth.uid() ∨ private.can_manage_agent_pipeline(p_agent_id) (owner/admin de la
--   agencia ACTIVA del agente objetivo, YA EXISTE — 20260906100003 — se REUSA, no se
--   reescribe). Sin autorización: 0 filas, nunca excepción (anti-IDOR).
-- D-ELIGIBILIDAD: "actividad en la ventana" (paso 2 del pipeline) = CUALQUIERA de
--   {video_view, video_completed} en events_raw, o una fila en likes, o una fila en saves,
--   sobre una propiedad con owner_user_id = p_agent_id, con created_at dentro de
--   [now() − crm_radar_window_days, now()] — INDEPENDIENTE de si ese tipo de señal contribuye
--   o no a private.crm_temperature (p.ej. video_view no pesa en T1, pero SÍ cuenta para
--   decidir si alguien "tuvo actividad" y para el conteo de k-anonimato).
-- D-KANON-SCOPE: el k-anonimato (paso 3) se computa con count(distinct user_id) SOLO sobre el
--   conjunto de usuarios YA FILTRADO por "sin lead activo" (paso 2 antes que paso 3, orden del
--   plan) — NUNCA sobre el tráfico total de la propiedad. Motivo de privacidad (no solo de
--   fidelidad al plan): si el conteo incluyera a los leads conocidos, un agente que sepa
--   "esta propiedad tuvo 3 visitas y 2 son mis leads" deduciría por sustracción la identidad
--   del anónimo restante — exactamente el modo de deducción que §7.5/75.3 buscan cerrar.
-- D-PROPERTY-ATTRIBUTION: cuando una persona anónima interactuó con MÁS DE UNA propiedad del
--   agente, property_label es la de su actividad MÁS RECIENTE (misma fuente que
--   last_activity_at) — NO cubierto por un assert dedicado en este archivo (ningún fixture
--   cruza 2 propiedades por persona); documentado para que el GREEN no improvise.
-- D-SIGNALS-ANON: signals = {"views": int, "completed": bool, "saved": bool, "liked": bool} —
--   'views' = conteo de video_view; 'completed'/'saved'/'liked' = existe ≥1 video_completed /
--   save / like respectivamente. Calca el ejemplo literal de §7.5 ("views:4, completed:true,
--   saved:true").
-- D-SPARK-ANON: sparkline es un conteo DIARIO de actividad cruda (NO temperatura, no hay
--   snapshot por persona anónima — decisión 266.3 ya citada en el plan), longitud
--   crm_radar_window_days (14 por default), 0 (no NULL) en los días sin ningún evento —a
--   diferencia de crm_leads_page, donde NULL marca snapshot ausente; aquí no hay snapshot,
--   "sin eventos ese día" es un 0 legítimo, no un hueco. Bucketing por día CALENDARIO
--   ((created_at)::date) en la timezone de la sesión — dentro de una misma transacción
--   pgTAP, now() es CONSTANTE (transaction time), así que la aritmética de días es
--   reproducible sin fijar el reloj explícitamente (no aplica el patrón de "bomba de fecha"
--   de 266.2/100_: ese cubre el DECAIMIENTO con reloj fijado en 4 TZ; aquí solo se cuenta,
--   no se decae).
-- D-ROWN: la forma que discrimina inestabilidad es la EMPÍRICA, no solo la estructural: 4
--   personas con temperatura/delta EXACTAMENTE empatados (mismo evento, mismo timestamp) pero
--   con una huella distinguible NO usada en el ORDER BY (conteo de video_view, que no pesa en
--   T1) — se llama 20 veces y se compara la SECUENCIA de huellas en el orden de row_n; con
--   empate total, random() debe producir al menos 2 secuencias distintas en 20 intentos. Se
--   complementa con un assert estructural barato (row_n = 1..n denso, sin huecos).
-- D-LIMIT-RADAR: p_limit ≤ 0 o NULL se acota a ≥1 (mismo criterio que 266.5, hallazgo del
--   guardian): 0 NO abre el pool completo; NULL usa el default (20).
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ─────────────────────────────────
-- Happy path: firma+ACL de catálogo (SIG/ACL), invocación real de anon denegada en su PRIMERA
--   llamada (ACLREAL, 203.1), autorización básica agente-dueño con un radar reconocible
--   (AUTZ1).
-- 🔒 Los 4 invariantes de §7.5 (el corazón de esta suite):
--   (1) INV1 — estructural: 0 columnas de identidad, guardado contra el vacuo (total_out=7).
--   (2) ROWN1/2 — row_n no estable + ordinal denso.
--   (3) KANON1-3/WINDOW1-2/WINDOW3-4 — k-anonimato por propiedad, incluida la ventana
--       (crm_radar_window_days leído de app_config, no solo hardcode) y el mata-count(*).
--   (4) LEADACT1-3 — lead activo excluido, lead borrado puede salir, lead de OTRO agente sale.
-- Ramas de reglas no obvias: D-AUTZ-REUSE (AUTZ2-8, mismo criterio 226/77/203.1 que
--   crm_leads_page), D-KANON-SCOPE — 🟡 endurecimiento post-guardian (V1, bloqueante): tiene su
--   PROPIO assert dedicado (KANONSCOPE1, sección 14) — ya NO es "implícito en LEADACT1": ese
--   fixture (4 espectadores/1 lead → 3 elegibles) pasaba igual contando sobre el total (4) que
--   sobre lo elegible (3), así que un mutante que moviera el conteo a `activity_typed` (tráfico
--   total) sobrevivía 42/42; KANONSCOPE1 monta el caso que SÍ discrimina (2 de 3 son leads: el
--   total pasa el umbral, lo elegible no) — solo Δ>0 (DELTA1/DELTAZERO1 —🟡 la frontera Δ=0
--   con solo video_view, endurecimiento post-guardian V2, bloqueante—, DELTAVAL1-2, LASTACT1
--   con valor Python independiente).
-- Boundary/error: p_agent_id inexistente → 0 filas sin excepción (BOUNDARY1); p_limit
--   degenerado (LIMIT1-3, LIMIT1 pinea el clamp EXACTO a 1 — 🟡 endurecimiento post-guardian
--   O-6); anon con 42501 real (ACLREAL1).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(46);

-- ── Helper de impersonación (mismo patrón que 02/08/.../100/101/102/103) ────────────────────
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── Wrapper RED: jsonb_agg + sentinel de error (ver cabecera) ───────────────────────────────
create or replace function pg_temp.radar_json(p_agent_id uuid, p_limit int)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v
  from public.crm_radar_anon(p_agent_id, p_limit) t;
  return v;
exception when others then
  return '[{"__error__": true}, {"__error__": true}]'::jsonb;
end $$;

-- ── Medición anti-vacuo universal (ver cabecera, punto c): cuenta SOLO filas reales ─────────
create or replace function pg_temp.real_count(v jsonb) returns int language sql as $$
  select count(*)::int from jsonb_array_elements(v) e where e ? 'property_label';
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) CATÁLOGO — firma, tipo de retorno, atributos, ACL. Seguro aunque no exista.
-- ════════════════════════════════════════════════════════════════════════════

select has_function('public', 'crm_radar_anon', array['uuid', 'int'],
  'SIG1_crm_radar_anon_existe_con_la_firma_declarada');

select is(
  (select pg_get_function_result(to_regprocedure('public.crm_radar_anon(uuid,int)'))),
  'TABLE(row_n integer, property_label text, temperature integer, delta integer, sparkline integer[], signals jsonb, last_activity_at timestamp with time zone)',
  'SIG2_crm_radar_anon_returns_table_EXACTA_7_columnas_ninguna_de_identidad'
);

select is(
  (select pg_get_function_arguments(to_regprocedure('public.crm_radar_anon(uuid,int)'))),
  'p_agent_id uuid, p_limit integer DEFAULT 20',
  'SIG3_crm_radar_anon_argumentos_EXACTOS_D_DEFAULTS_RADAR'
);

select is(
  (select prosecdef from pg_proc where proname = 'crm_radar_anon' and pronamespace = 'public'::regnamespace),
  true, 'SIG4_crm_radar_anon_es_security_definer'
);

select is(
  (select provolatile from pg_proc where proname = 'crm_radar_anon' and pronamespace = 'public'::regnamespace),
  's', 'SIG5_crm_radar_anon_es_stable'
);

select is(
  (select proconfig from pg_proc where proname = 'crm_radar_anon' and pronamespace = 'public'::regnamespace),
  array['search_path=""']::text[],
  'SIG6_crm_radar_anon_search_path_vacio'
);

select function_privs_are('public', 'crm_radar_anon', array['uuid', 'int'], 'anon', array[]::name[],
  'ACL1_crm_radar_anon_anon_SIN_execute');
select function_privs_are('public', 'crm_radar_anon', array['uuid', 'int'], 'authenticated', array['EXECUTE']::name[],
  'ACL2_crm_radar_anon_authenticated_CON_execute');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) INV1 [INVARIANTE ESTRUCTURAL, §7.5] — NINGUNA columna de salida puede portar identidad.
--    Guardado contra el vacuo: se compara {total_out, forbidden} en UN jsonb — si la función
--    no existe, total_out=0 (≠7 esperado) y el assert falla por la razón correcta, no pasa por
--    casualidad con forbidden=0.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (
    with cols as (
      select unnest(coalesce(p.proargnames, '{}'::text[])) as argname,
             unnest(coalesce(p.proargmodes, '{}'::"char"[])) as argmode
      from pg_proc p
      where p.proname = 'crm_radar_anon' and p.pronamespace = 'public'::regnamespace
    )
    select jsonb_build_object(
      'total_out', (select count(*) from cols where argmode = 't'),
      'forbidden', (select count(*) from cols where argmode = 't' and (
        argname ~* 'user' or argname ~* '(^|_)id($|_)' or argname ~* 'name'
        or argname ~* 'avatar' or argname ~* 'email' or argname ~* 'phone' or argname ~* 'hash'
      ))
    )
  ),
  jsonb_build_object('total_out', 7, 'forbidden', 0),
  'INV1_ninguna_columna_de_identidad_guard_anti_vacuo_total_7_forbidden_0'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) ACL REAL — anon denegado en su PRIMERA invocación real (gotcha 203.1). SIN wrapper.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select * from public.crm_radar_anon('00000000-0000-0000-0000-000000266900'::uuid, 20) $$,
  '42501', null, 'ACLREAL1_anon_no_puede_ejecutar_crm_radar_anon_primera_invocacion_203_1'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) BOUNDARY — p_agent_id que NO EXISTE: 0 filas, NUNCA una excepción (anti-IDOR).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000266900'); -- cualquier caller autenticado
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-0000002669ff', 20)),
  0, 'BOUNDARY1_agente_inexistente_0_filas_sin_excepcion'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) AUTORIZACIÓN — D-AUTZ-REUSE, mismo criterio EXACTO que crm_leads_page (266.4). PROP_A
--    (owner AGR1, 900) tiene 4 espectadores elegibles con señal reciente (delta>0) — un radar
--    real y reconocible, para que "0 filas" en los casos negativos no sea vacuo.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266900', 'agr1.266p6@test.local'),   -- AGR1 (dueño)
  ('00000000-0000-0000-0000-000000266901', 'ownr.266p6@test.local'),   -- OWNR (owner activo AGENCY_R1)
  ('00000000-0000-0000-0000-000000266902', 'admr.266p6@test.local'),   -- ADMR (admin activo AGENCY_R1)
  ('00000000-0000-0000-0000-000000266903', 'agfr.266p6@test.local'),   -- AGFR (agente PAR, activo AGENCY_R1)
  ('00000000-0000-0000-0000-000000266904', 'agsuspr.266p6@test.local'),-- AGSUSPR (membresía suspendida)
  ('00000000-0000-0000-0000-000000266905', 'ownr2.266p6@test.local'),  -- OWNR2 (owner de OTRA agencia)
  ('00000000-0000-0000-0000-000000266906', 'padminr.266p6@test.local'),-- PADMINR (admin de plataforma)
  ('00000000-0000-0000-0000-000000266907', 'agr2.266p6@test.local'),   -- AGR2 (ajeno, sin agencia)
  ('00000000-0000-0000-0000-000000266908', 'va1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266909', 'va2.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266910', 'va3.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266911', 'va4.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266912', 'vs1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266913', 'vs2.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266914', 'vs3.266p6@test.local');

update public.users set role = 'agent', is_verified_agent = true
  where id in ('00000000-0000-0000-0000-000000266900', '00000000-0000-0000-0000-000000266903',
               '00000000-0000-0000-0000-000000266904', '00000000-0000-0000-0000-000000266907');
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000266906'; -- PADMINR

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000266900', 'Inmobiliaria Radar 266', 'inmo-radar-266', 'active', '00000000-0000-0000-0000-000000266901'),
  ('00000000-0000-0000-0000-000000266901', 'Inmobiliaria Radar Ajena 266', 'inmo-radar-ajena-266', 'active', '00000000-0000-0000-0000-000000266905');

insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000266900', '00000000-0000-0000-0000-000000266900', '00000000-0000-0000-0000-000000266900', 'agent', 'active'),  -- AGR1
  ('00000000-0000-0000-0000-000000266901', '00000000-0000-0000-0000-000000266900', '00000000-0000-0000-0000-000000266901', 'owner', 'active'),  -- OWNR
  ('00000000-0000-0000-0000-000000266902', '00000000-0000-0000-0000-000000266900', '00000000-0000-0000-0000-000000266902', 'admin', 'active'),  -- ADMR
  ('00000000-0000-0000-0000-000000266903', '00000000-0000-0000-0000-000000266900', '00000000-0000-0000-0000-000000266903', 'agent', 'active'),  -- AGFR (par)
  ('00000000-0000-0000-0000-000000266904', '00000000-0000-0000-0000-000000266900', '00000000-0000-0000-0000-000000266904', 'agent', 'suspended'), -- AGSUSPR
  ('00000000-0000-0000-0000-000000266905', '00000000-0000-0000-0000-000000266901', '00000000-0000-0000-0000-000000266905', 'owner', 'active');  -- OWNR2

insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266900', '00000000-0000-0000-0000-000000266900', '00000000-0000-0000-0000-000000266900',
   'departamento', 'rent', 'Fixture 266.6 — PROP_A (AGR1, 4 espectadores)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-000000266901', '00000000-0000-0000-0000-000000266904', '00000000-0000-0000-0000-000000266900',
   'departamento', 'rent', 'Fixture 266.6 — PROP_SUSP (AGSUSPR, membresía suspendida)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography, 9000, 'active');

insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266908', '00000000-0000-0000-0000-000000266900', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266909', '00000000-0000-0000-0000-000000266900', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266910', '00000000-0000-0000-0000-000000266900', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266911', '00000000-0000-0000-0000-000000266900', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266912', '00000000-0000-0000-0000-000000266901', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266913', '00000000-0000-0000-0000-000000266901', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266914', '00000000-0000-0000-0000-000000266901', now() - interval '1 hour');

select pg_temp.act_as('00000000-0000-0000-0000-000000266900'); -- AGR1, dueño
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266900', 50)),
  4, 'AUTZ1_dueno_ve_las_4_filas_de_su_propiedad'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266907'); -- AGR2, ajeno (sin agencia)
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266900', 50)),
  0, 'AUTZ2_agente_ajeno_0_filas'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266901'); -- OWNR, owner ACTIVO de AGR1
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266900', 50)),
  4, 'AUTZ3_owner_de_la_agencia_ve_las_4_filas'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266902'); -- ADMR, admin ACTIVO de AGR1
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266900', 50)),
  4, 'AUTZ4_admin_de_la_agencia_ve_las_4_filas'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266906'); -- PADMINR, admin de PLATAFORMA sin relación
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266900', 50)),
  0, 'AUTZ5_admin_de_plataforma_sin_relacion_0_filas_226'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266905'); -- OWNR2, owner de OTRA agencia (ajena)
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266900', 50)),
  0, 'AUTZ6_owner_de_otra_agencia_0_filas'
);
reset role;

-- AGFR y AGR1 son AMBOS 'agent' ACTIVOS de la MISMA agencia — un PAR, no un owner/admin.
select pg_temp.act_as('00000000-0000-0000-0000-000000266903'); -- AGFR, agente PAR
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266900', 50)),
  0, 'AUTZ7_agente_par_de_la_misma_agencia_0_filas_no_hereda_de_un_companero'
);
reset role;

-- AGSUSPR tiene su ÚNICA membresía en AGENCY_R1 `suspended` (sin fila `active`), pero SÍ es
-- dueño de PROP_SUSP con 3 espectadores elegibles (VS1-3, señal reciente) — un radar real y
-- reconocible que OWNR (owner ACTIVO REAL de la misma agencia) no debe poder ver.
select pg_temp.act_as('00000000-0000-0000-0000-000000266901'); -- OWNR
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266904', 50)),
  0, 'AUTZ8_membresia_del_agente_objetivo_suspendida_0_filas_no_active_status_203_1'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) K-ANONIMATO POR PROPIEDAD [INVARIANTE 3, §7.5] — cada escenario en su propio agente
--    aislado (D-FIXTURE-AISLAMIENTO) para medir con comparaciones directas, sin arrastrar
--    conteos de otras secciones.
-- ════════════════════════════════════════════════════════════════════════════

-- KANON1: PROP_B, 2 espectadores elegibles (< 3 default) → 0 filas.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266915', 'agkanon1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266916', 'vb1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266917', 'vb2.266p6@test.local');
update public.users set role = 'agent', is_verified_agent = true where id = '00000000-0000-0000-0000-000000266915';
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266902', '00000000-0000-0000-0000-000000266915', 'departamento', 'rent',
   'Fixture 266.6 — PROP_B (2 espectadores, k-anon FALLA)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.37, 20.69), 4326)::extensions.geography, 9500, 'active');
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266916', '00000000-0000-0000-0000-000000266902', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266917', '00000000-0000-0000-0000-000000266902', now() - interval '1 hour');

select pg_temp.act_as('00000000-0000-0000-0000-000000266915');
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266915', 20)),
  0, 'KANON1_dos_espectadores_elegibles_0_filas'
);
reset role;

-- KANON2: PROP_C, 3 espectadores elegibles (= 3 default) → aparecen.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266918', 'agkanon2.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266919', 'vc1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266920', 'vc2.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266921', 'vc3.266p6@test.local');
update public.users set role = 'agent', is_verified_agent = true where id = '00000000-0000-0000-0000-000000266918';
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266903', '00000000-0000-0000-0000-000000266918', 'departamento', 'rent',
   'Fixture 266.6 — PROP_C (3 espectadores, k-anon PASA)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.38, 20.70), 4326)::extensions.geography, 9800, 'active');
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266919', '00000000-0000-0000-0000-000000266903', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266920', '00000000-0000-0000-0000-000000266903', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266921', '00000000-0000-0000-0000-000000266903', now() - interval '1 hour');

select pg_temp.act_as('00000000-0000-0000-0000-000000266918');
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266918', 20)),
  3, 'KANON2_tres_espectadores_elegibles_aparecen_3_filas'
);
reset role;

-- KANON3 — mata count(*): PROP_D, 1 usuario con 10 eventos (video_completed, todos elegibles
-- y todos con señal reciente por sí solos) + 1 usuario con 1 evento = 11 eventos crudos pero
-- SOLO 2 usuarios DISTINTOS (< 3). Si el SUT usara count(*) en vez de count(distinct user_id),
-- 11 ≥ 3 pasaría el umbral por error y la propiedad (y sus 2 usuarios, ambos con delta>0
-- genuino) se mostraría — el assert exige 0.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266922', 'agkanon3.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266923', 'vd1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266924', 'vd2.266p6@test.local');
update public.users set role = 'agent', is_verified_agent = true where id = '00000000-0000-0000-0000-000000266922';
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266904', '00000000-0000-0000-0000-000000266922', 'departamento', 'rent',
   'Fixture 266.6 — PROP_D (2 distintos, 11 eventos crudos, mata count estrella)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.39, 20.71), 4326)::extensions.geography, 9900, 'active');
insert into public.events_raw (event_type, user_id, property_id, created_at)
select 'video_completed', '00000000-0000-0000-0000-000000266923', '00000000-0000-0000-0000-000000266904',
       now() - interval '1 hour' + (i || ' minutes')::interval
from generate_series(1, 10) as i;
insert into public.events_raw (event_type, user_id, property_id, created_at) values
  ('video_completed', '00000000-0000-0000-0000-000000266924', '00000000-0000-0000-0000-000000266904', now() - interval '1 hour');

select pg_temp.act_as('00000000-0000-0000-0000-000000266922');
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266922', 20)),
  0, 'KANON3_mismo_usuario_10_eventos_cuenta_1_mata_count_estrella_0_filas'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) VENTANA crm_radar_window_days [parte del INVARIANTE 3] — frontera INCLUSIVA a 14 días.
-- ════════════════════════════════════════════════════════════════════════════

-- WINDOW1: PROP_E, VE1/VE2 con señal reciente (delta>0) + VE3 cuya ÚNICA señal es de hace 13
-- días — DENTRO de la ventana de 14: cuenta para el k-anonimato (3 elegibles ≥ 3), aunque VE3
-- mismo no aparezca como fila (una señal única y vieja, sin nada nuevo, da delta<0 — ver
-- DELTA1/D-ELIGIBILIDAD). Resultado esperado: 2 filas (VE1, VE2), NO 0.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266925', 'agwindow1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266926', 've1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266927', 've2.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266928', 've3.266p6@test.local');
update public.users set role = 'agent', is_verified_agent = true where id = '00000000-0000-0000-0000-000000266925';
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266905', '00000000-0000-0000-0000-000000266925', 'departamento', 'rent',
   'Fixture 266.6 — PROP_E (ventana: 13 días SÍ cuenta)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.40, 20.72), 4326)::extensions.geography, 10100, 'active');
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266926', '00000000-0000-0000-0000-000000266905', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266927', '00000000-0000-0000-0000-000000266905', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266928', '00000000-0000-0000-0000-000000266905', now() - interval '13 days');

select pg_temp.act_as('00000000-0000-0000-0000-000000266925');
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266925', 20)),
  2, 'WINDOW1_actividad_hace_13_dias_cuenta_para_k_anonimato_2_filas'
);
reset role;

-- WINDOW2: mismo montaje, pero la 3ª señal es de hace 15 días — FUERA de la ventana de 14: NO
-- cuenta, quedan solo 2 elegibles (< 3), la propiedad ENTERA queda oculta (0 filas, ni
-- siquiera VF1/VF2 que sí tienen delta>0 genuino).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266929', 'agwindow2.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266930', 'vf1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266931', 'vf2.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266932', 'vf3.266p6@test.local');
update public.users set role = 'agent', is_verified_agent = true where id = '00000000-0000-0000-0000-000000266929';
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266906', '00000000-0000-0000-0000-000000266929', 'departamento', 'rent',
   'Fixture 266.6 — PROP_F (ventana: 15 días NO cuenta)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.41, 20.73), 4326)::extensions.geography, 10200, 'active');
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266930', '00000000-0000-0000-0000-000000266906', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266931', '00000000-0000-0000-0000-000000266906', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266932', '00000000-0000-0000-0000-000000266906', now() - interval '15 days');

select pg_temp.act_as('00000000-0000-0000-0000-000000266929');
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266929', 20)),
  0, 'WINDOW2_actividad_hace_15_dias_no_cuenta_propiedad_oculta_0_filas'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 8) LEAD ACTIVO [INVARIANTE 4, §7.5] — "quien ya es lead NO aparece en el radar" y sus 2
--    matices (D-ACTIVE-LEAD: activo = deleted_at is null, mismo criterio EXACTO que
--    private.crm_temperature/20260906100001; lead con OTRO agente no cuenta para ESTE).
-- ════════════════════════════════════════════════════════════════════════════

-- LEADACT1: PROP_G, 3 no-leads con señal reciente + VG_LEAD con lead ACTIVO con AGR_LEADACT1
-- (y TAMBIÉN señal reciente propia, para probar que se excluye por el lead, no por falta de
-- actividad). Esperado: 3 filas, NO 4.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266933', 'agleadact1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266934', 'vg1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266935', 'vg2.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266936', 'vg3.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266937', 'vglead.266p6@test.local');
update public.users set role = 'agent', is_verified_agent = true where id = '00000000-0000-0000-0000-000000266933';
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266907', '00000000-0000-0000-0000-000000266933', 'departamento', 'rent',
   'Fixture 266.6 — PROP_G (lead activo excluido)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.42, 20.74), 4326)::extensions.geography, 10300, 'active');
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266934', '00000000-0000-0000-0000-000000266907', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266935', '00000000-0000-0000-0000-000000266907', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266936', '00000000-0000-0000-0000-000000266907', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266937', '00000000-0000-0000-0000-000000266907', now() - interval '1 hour');
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000266900', '00000000-0000-0000-0000-000000266933', '00000000-0000-0000-0000-000000266937', 'new');

select pg_temp.act_as('00000000-0000-0000-0000-000000266933');
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266933', 20)),
  3, 'LEADACT1_lead_activo_excluido_3_filas_no_4'
);
reset role;

-- LEADACT2: PROP_H, 2 no-leads + VH_DELETEDLEAD, cuyo lead con AGR_LEADACT2 tiene deleted_at
-- puesto (D-ACTIVE-LEAD: "activo" = deleted_at is null, igual que private.crm_temperature) —
-- deja de bloquear, VH_DELETEDLEAD puede volver a salir como anónimo. Esperado: 3 filas.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266938', 'agleadact2.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266939', 'vh1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266940', 'vh2.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266941', 'vhdeleted.266p6@test.local');
update public.users set role = 'agent', is_verified_agent = true where id = '00000000-0000-0000-0000-000000266938';
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266908', '00000000-0000-0000-0000-000000266938', 'departamento', 'rent',
   'Fixture 266.6 — PROP_H (lead con deleted_at SÍ puede salir)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.43, 20.75), 4326)::extensions.geography, 10400, 'active');
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266939', '00000000-0000-0000-0000-000000266908', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266940', '00000000-0000-0000-0000-000000266908', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266941', '00000000-0000-0000-0000-000000266908', now() - interval '1 hour');
insert into public.leads (id, agent_id, user_id, status, deleted_at) values
  ('00000000-0000-0000-0000-000000266901', '00000000-0000-0000-0000-000000266938', '00000000-0000-0000-0000-000000266941', 'new', now() - interval '1 day');

select pg_temp.act_as('00000000-0000-0000-0000-000000266938');
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266938', 20)),
  3, 'LEADACT2_lead_con_deleted_at_puede_salir_como_anonimo_3_filas'
);
reset role;

-- LEADACT3: PROP_I (de AGR_LEADACT3), 2 no-leads + VI_OTHERLEAD, cuyo lead ACTIVO es con
-- AGR_OTHER (un agente distinto) — no es lead de AGR_LEADACT3, así que SÍ sale en SU radar.
-- Esperado: 3 filas.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266942', 'agleadact3.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266943', 'agotro.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266944', 'vi1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266945', 'vi2.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266946', 'viotherlead.266p6@test.local');
update public.users set role = 'agent', is_verified_agent = true
  where id in ('00000000-0000-0000-0000-000000266942', '00000000-0000-0000-0000-000000266943');
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266909', '00000000-0000-0000-0000-000000266942', 'departamento', 'rent',
   'Fixture 266.6 — PROP_I (lead de OTRO agente SÍ sale)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.44, 20.76), 4326)::extensions.geography, 10500, 'active');
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266944', '00000000-0000-0000-0000-000000266909', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266945', '00000000-0000-0000-0000-000000266909', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266946', '00000000-0000-0000-0000-000000266909', now() - interval '1 hour');
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000266902', '00000000-0000-0000-0000-000000266943', '00000000-0000-0000-0000-000000266946', 'new');

select pg_temp.act_as('00000000-0000-0000-0000-000000266942');
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266942', 20)),
  3, 'LEADACT3_lead_de_otro_agente_si_sale_3_filas'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 9) SOLO Δ>0 — PROP_DELTA (AGR_DELTA aislado): VDA/VDB/VDC con señal reciente (baseline, k-
--    anon pasa con 3) + VTVAL (1 señal única de hace 1 día — SIN nada más nuevo: por
--    construcción de la fórmula T1, un único evento sin repetición SIEMPRE da delta>0 al
--    evaluarlo por primera vez desde 0, ver D-ELIGIBILIDAD/cabecera) + VOLD (1 señal única de
--    hace 10 días — sin nada nuevo entre (now-3d) y now: delta<0, EXCLUIDO). Total esperado:
--    4 filas (no 5): VDA, VDB, VDC, VTVAL — nunca VOLD.
--
-- Valores LITERALES de temperature/delta para VTVAL, calculados con Python (Decimal,
-- independiente de la SQL — mismo criterio que 100_crm_temperature_test.sql), con los DEFAULTS
-- de app_config vigentes desde 266.2 (crm_weight_save=18, crm_decay_daily=0.08,
-- crm_trend_window_days=3):
--   temp(now)     = round(18 · 0.92^1)               = round(16.56) = 17
--   temp(now-3d)  = 0 (el evento, de hace 1 día, es POSTERIOR a now-3d → no cuenta ahí)
--   delta         = 17 − 0 = 17
-- (VDA/VDB/VDC dan temperature=18 con la MISMA fórmula sobre "hace 1 hora" — sirven de
-- distractor para localizar la fila de VTVAL sin ambigüedad por temperature=17, único valor
-- de ese grupo).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266947', 'agdelta.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266948', 'vda.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266949', 'vdb.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266950', 'vdc.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266951', 'vtval.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266952', 'vold.266p6@test.local');
update public.users set role = 'agent', is_verified_agent = true where id = '00000000-0000-0000-0000-000000266947';
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266911', '00000000-0000-0000-0000-000000266947', 'departamento', 'rent',
   'Fixture 266.6 — PROP_DELTA (solo Δ>0)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.45, 20.77), 4326)::extensions.geography, 10600, 'active');
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266948', '00000000-0000-0000-0000-000000266911', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266949', '00000000-0000-0000-0000-000000266911', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266950', '00000000-0000-0000-0000-000000266911', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266951', '00000000-0000-0000-0000-000000266911', now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000266952', '00000000-0000-0000-0000-000000266911', now() - interval '10 days');

select pg_temp.act_as('00000000-0000-0000-0000-000000266947');

select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266947', 20)),
  4, 'DELTA1_actividad_vieja_sin_senal_nueva_no_incrementa_las_filas_sigue_en_4'
);

select is(
  (
    select elem->>'temperature'
    from jsonb_array_elements(pg_temp.radar_json('00000000-0000-0000-0000-000000266947', 20)) elem
    where elem->>'temperature' = '17'
  ),
  '17', 'DELTAVAL1_temperature_literal_17_python_independiente'
);

select is(
  (
    select elem->>'delta'
    from jsonb_array_elements(pg_temp.radar_json('00000000-0000-0000-0000-000000266947', 20)) elem
    where elem->>'temperature' = '17'
  ),
  '17', 'DELTAVAL2_delta_literal_17_python_independiente'
);

select is(
  (
    select elem->>'last_activity_at'
    from jsonb_array_elements(pg_temp.radar_json('00000000-0000-0000-0000-000000266947', 20)) elem
    where elem->>'temperature' = '17'
  ),
  (to_jsonb(now() - interval '1 day') #>> '{}'),
  'LASTACT1_last_activity_at_es_el_timestamp_exacto_de_la_unica_senal'
);

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 10) SIGNALS — {views, completed, saved, liked}, D-SIGNALS-ANON. PROP_SIG (AGR_SIGNALS
--     aislado): VSIG (4 video_view + 1 video_completed + 1 save, todo reciente) + 2 rellenos
--     (VSIGF1/2, solo save reciente) para pasar k-anon (3). Guardado anti-vacuo: se localiza
--     la fila de VSIG por 'views'=4 (único valor de ese campo en el grupo — los rellenos dan
--     views=0) y se compara el objeto COMPLETO, no solo una clave.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266953', 'agsignals.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266954', 'vsig.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266955', 'vsigf1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266956', 'vsigf2.266p6@test.local');
update public.users set role = 'agent', is_verified_agent = true where id = '00000000-0000-0000-0000-000000266953';
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266912', '00000000-0000-0000-0000-000000266953', 'departamento', 'rent',
   'Fixture 266.6 — PROP_SIG (contenido exacto de signals)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.46, 20.78), 4326)::extensions.geography, 10700, 'active');
insert into public.events_raw (event_type, user_id, property_id, created_at) values
  ('video_view', '00000000-0000-0000-0000-000000266954', '00000000-0000-0000-0000-000000266912', now() - interval '1 hour'),
  ('video_view', '00000000-0000-0000-0000-000000266954', '00000000-0000-0000-0000-000000266912', now() - interval '59 minutes'),
  ('video_view', '00000000-0000-0000-0000-000000266954', '00000000-0000-0000-0000-000000266912', now() - interval '58 minutes'),
  ('video_view', '00000000-0000-0000-0000-000000266954', '00000000-0000-0000-0000-000000266912', now() - interval '57 minutes'),
  ('video_completed', '00000000-0000-0000-0000-000000266954', '00000000-0000-0000-0000-000000266912', now() - interval '56 minutes');
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266954', '00000000-0000-0000-0000-000000266912', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266955', '00000000-0000-0000-0000-000000266912', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266956', '00000000-0000-0000-0000-000000266912', now() - interval '1 hour');

select pg_temp.act_as('00000000-0000-0000-0000-000000266953');

select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266953', 20)),
  3, 'SIGNALS1_guard_total_3_filas_en_la_propiedad'
);

select is(
  (
    select elem->'signals'
    from jsonb_array_elements(pg_temp.radar_json('00000000-0000-0000-0000-000000266953', 20)) elem
    where (elem->'signals'->>'views')::int = 4
  ),
  jsonb_build_object('views', 4, 'completed', true, 'saved', true, 'liked', false),
  'SIGNALS2_contenido_exacto_views4_completed_true_saved_true_liked_false'
);

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 11) SPARKLINE — D-SPARK-ANON, int[crm_radar_window_days] con conteo diario, 0 (no NULL) en
--     los días sin evento. PROP_SPARK (AGR_SPARK aislado): VSPK con 3 video_view + 1
--     video_completed HOY + 1 save hace 6 días (delta>0 garantizado por el video_completed de
--     hoy, ver cabecera D-ELIGIBILIDAD) + 2 rellenos (solo save reciente, para k-anon=3). El
--     array esperado es un LITERAL calculado A MANO desde las filas sembradas (mismo criterio
--     que 100_/101_) — NUNCA una query contra events_raw/saves (ver corrección post-GREEN más
--     abajo, junto al assert: una query ahí corre bajo el rol impersonado y RLS la bloquea).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266957', 'agspark.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266958', 'vspk.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266959', 'vspkf1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266960', 'vspkf2.266p6@test.local');
update public.users set role = 'agent', is_verified_agent = true where id = '00000000-0000-0000-0000-000000266957';
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266913', '00000000-0000-0000-0000-000000266957', 'departamento', 'rent',
   'Fixture 266.6 — PROP_SPARK (forma exacta del sparkline)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.47, 20.79), 4326)::extensions.geography, 10800, 'active');
insert into public.events_raw (event_type, user_id, property_id, created_at) values
  ('video_view', '00000000-0000-0000-0000-000000266958', '00000000-0000-0000-0000-000000266913', now() - interval '5 minutes'),
  ('video_view', '00000000-0000-0000-0000-000000266958', '00000000-0000-0000-0000-000000266913', now() - interval '4 minutes'),
  ('video_view', '00000000-0000-0000-0000-000000266958', '00000000-0000-0000-0000-000000266913', now() - interval '3 minutes'),
  ('video_completed', '00000000-0000-0000-0000-000000266958', '00000000-0000-0000-0000-000000266913', now() - interval '2 minutes');
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266958', '00000000-0000-0000-0000-000000266913', now() - interval '6 days'),
  ('00000000-0000-0000-0000-000000266959', '00000000-0000-0000-0000-000000266913', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266960', '00000000-0000-0000-0000-000000266913', now() - interval '1 hour');

select pg_temp.act_as('00000000-0000-0000-0000-000000266957');

-- SPARK1: localizado por temperature≠18 (el valor de los 2 rellenos con solo "hace 1 hora");
-- VSPK combina video_completed de hoy + save de hace 6 días, dando una temperatura distinta.
select ok(
  (
    select jsonb_array_length(elem->'sparkline') = 14
    from jsonb_array_elements(pg_temp.radar_json('00000000-0000-0000-0000-000000266957', 20)) elem
    where elem->>'temperature' <> '18'
  ),
  'SPARK1_longitud_14_ventana_completa'
);

-- 🟡 Corrección post-GREEN (árbitro, hallazgo del agente `supabase`, confirmado con repro
-- propio): la versión anterior de "want" era una query directa a events_raw/saves DESPUÉS de
-- pg_temp.act_as (rol authenticated impersonando al agente 957). events_raw_select exige
-- `user_id = auth.uid() OR private.can_view_user_events(...)` y saves_select exige
-- `user_id = auth.uid()` — el agente 957 no es auth.uid() de VSPK (958) ni tiene lead con él,
-- así que RLS bloqueaba esa lectura de canal lateral y "want" daba 14 ceros SIEMPRE,
-- independientemente de los datos reales (verificado: como authenticated/957 el count da 0;
-- como postgres, que bypassa RLS por ownership, el mismo count da 2 (events_raw) y 1 (saves)).
-- Fix: literal calculado A MANO (mismo criterio que 100_/101_) desde las filas sembradas
-- arriba, SIN pasar por ninguna tabla ni por la SQL del SUT — solo aritmética de posiciones:
-- ventana ascendente de 14 días [hoy−13 .. hoy], posición 1-based = 14 − días_de_antigüedad.
-- "hoy" (video_view×3 + video_completed×1, todos "hace unos minutos") → posición 14 → 4.
-- "hace 6 días" (el save) → posición 14−6 = 8 → 1. Los 12 días restantes, sin fixture → 0.
select is(
  (
    select elem->'sparkline'
    from jsonb_array_elements(pg_temp.radar_json('00000000-0000-0000-0000-000000266957', 20)) elem
    where elem->>'temperature' <> '18'
  ),
  '[0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 4]'::jsonb,
  'SPARK2_array_exacto_por_dia_con_huecos_en_cero'
);

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 12) ROW_N [INVARIANTE 2, §7.5] — D-ROWN. PROP_ROWN (AGR_ROWN aislado): 4 personas con
--     EXACTA la misma señal (1 save, mismo now()-interval '1 hour' — now() es CONSTANTE por
--     transacción, así que las 4 inserts comparten el MISMO instante) → temperature/delta EMPATADOS
--     TOTALMENTE. Se distinguen por una huella que NO participa del ORDER BY (conteo de
--     video_view, que no pesa en T1): VR1=1, VR2=2, VR3=3, VR4=4. Con empate total, el orden
--     solo lo decide random() — se llama 20 veces y se compara la SECUENCIA de huellas en el
--     orden de row_n.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266961', 'agrown.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266962', 'vr1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266963', 'vr2.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266964', 'vr3.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266965', 'vr4.266p6@test.local');
update public.users set role = 'agent', is_verified_agent = true where id = '00000000-0000-0000-0000-000000266961';
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266914', '00000000-0000-0000-0000-000000266961', 'departamento', 'rent',
   'Fixture 266.6 — PROP_ROWN (4 empatados totales)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.48, 20.80), 4326)::extensions.geography, 10900, 'active');
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266962', '00000000-0000-0000-0000-000000266914', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266963', '00000000-0000-0000-0000-000000266914', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266964', '00000000-0000-0000-0000-000000266914', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266965', '00000000-0000-0000-0000-000000266914', now() - interval '1 hour');
insert into public.events_raw (event_type, user_id, property_id, created_at)
select 'video_view', u.uid, '00000000-0000-0000-0000-000000266914', now() - interval '1 hour'
from (values
  ('00000000-0000-0000-0000-000000266962'::uuid, 1),
  ('00000000-0000-0000-0000-000000266963'::uuid, 2),
  ('00000000-0000-0000-0000-000000266964'::uuid, 3),
  ('00000000-0000-0000-0000-000000266965'::uuid, 4)
) as u(uid, n_views)
cross join lateral generate_series(1, u.n_views);

select pg_temp.act_as('00000000-0000-0000-0000-000000266961');

create temp table rown_sequences (call_n int, seq text);
do $$
declare
  i int;
  v jsonb;
  s text;
begin
  for i in 1..20 loop
    v := pg_temp.radar_json('00000000-0000-0000-0000-000000266961', 10);
    select string_agg((elem -> 'signals' ->> 'views'), ',' order by (elem ->> 'row_n')::int)
      into s
      from jsonb_array_elements(v) elem;
    insert into rown_sequences values (i, s);
  end loop;
end $$;

select ok(
  (select count(distinct seq) from rown_sequences) > 1,
  'ROWN1_row_n_no_es_estable_entre_llamadas_20_intentos_con_empate_total'
);

select is(
  (
    select array_agg((elem ->> 'row_n')::int order by (elem ->> 'row_n')::int)
    from jsonb_array_elements(pg_temp.radar_json('00000000-0000-0000-0000-000000266961', 10)) elem
  ),
  array[1, 2, 3, 4],
  'ROWN2_row_n_ordinal_denso_1_a_n_sin_huecos'
);

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 13) p_limit [BOUNDARY] — D-LIMIT-RADAR, precedente 266.5. PROP_LIMIT (AGR_LIMIT aislado): 5
--     espectadores elegibles, todos con delta>0 (pool total = 5).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266966', 'aglimit.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266967', 'vl1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266968', 'vl2.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266969', 'vl3.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266970', 'vl4.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266971', 'vl5.266p6@test.local');
update public.users set role = 'agent', is_verified_agent = true where id = '00000000-0000-0000-0000-000000266966';
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266915', '00000000-0000-0000-0000-000000266966', 'departamento', 'rent',
   'Fixture 266.6 — PROP_LIMIT (pool de 5)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.49, 20.81), 4326)::extensions.geography, 11000, 'active');
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266967', '00000000-0000-0000-0000-000000266915', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266968', '00000000-0000-0000-0000-000000266915', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266969', '00000000-0000-0000-0000-000000266915', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266970', '00000000-0000-0000-0000-000000266915', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266971', '00000000-0000-0000-0000-000000266915', now() - interval '1 hour');

select pg_temp.act_as('00000000-0000-0000-0000-000000266966');

-- 🟡 Endurecimiento post-guardian (O-6): el `cmp_ok(..., '<', 5)` original pasaba igual con el
-- clamp real (1 fila) que con un SUT sin clamp que simplemente devolviera 0 filas por error —
-- ambos son "< 5". D-LIMIT-RADAR fija el clamp en EXACTAMENTE 1
-- (`greatest(coalesce(p_limit,20),1)`, 20260906100005 línea ~99); se pinea con `is(...,1)`.
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266966', 0)),
  1, 'LIMIT1_p_limit_0_acotado_EXACTAMENTE_a_1_D_LIMIT_RADAR'
);
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266966', null)),
  5, 'LIMIT2_p_limit_NULL_usa_default_devuelve_el_total_elegible'
);
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266966', 2)),
  2, 'LIMIT3_p_limit_explicito_respeta_la_cota'
);

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 14) D-KANON-SCOPE [INVARIANTE 3, endurecimiento post-guardian V1, bloqueante] — hasta aquí
--     ningún assert distinguía "k-anonimato sobre el conjunto YA SIN LEAD" (correcto) de
--     "k-anonimato sobre el tráfico TOTAL de la propiedad" (fuga: permite deducción por
--     sustracción, el modo exacto de 75.3). Mutante M3b (mover `property_kanon` de
--     `eligible_activity` a `activity_typed`, 20260906100005) sobrevivía 42/42 porque
--     LEADACT1 usa 4 espectadores/1 lead — 3 elegibles YA pasa el umbral por sí solo, así que
--     contar sobre el total (4) o sobre lo elegible (3) daba el MISMO resultado (ambos ≥ 3).
--     PROP_V1 (AGR_V1 aislado): 3 espectadores, de los cuales 2 tienen lead ACTIVO con
--     AGR_V1 y 1 es genuinamente anónimo (V1_NONLEAD, con señal reciente propia, delta>0).
--     Con el conteo CORRECTO (solo lo elegible): elegibles = 1 (< 3) → la propiedad NO pasa
--     k-anon → 0 filas. Con el mutante M3b (conteo sobre el total): distinct_viewers = 3
--     (≥ 3) → la propiedad SÍ pasaría → V1_NONLEAD (el único elegible que sigue en
--     `eligible_activity`/`attributed`) se mostraría solo — exactamente la deducción por
--     sustracción que D-KANON-SCOPE cierra.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266976', 'agv1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266977', 'v1leada.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266978', 'v1leadb.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266979', 'v1nonlead.266p6@test.local');
update public.users set role = 'agent', is_verified_agent = true where id = '00000000-0000-0000-0000-000000266976';
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266917', '00000000-0000-0000-0000-000000266976', 'departamento', 'rent',
   'Fixture 266.6 — PROP_V1 (D-KANON-SCOPE: 2 de 3 son leads)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.51, 20.83), 4326)::extensions.geography, 11200, 'active');
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266977', '00000000-0000-0000-0000-000000266917', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266978', '00000000-0000-0000-0000-000000266917', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266979', '00000000-0000-0000-0000-000000266917', now() - interval '1 hour');
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000266903', '00000000-0000-0000-0000-000000266976', '00000000-0000-0000-0000-000000266977', 'new'),
  ('00000000-0000-0000-0000-000000266904', '00000000-0000-0000-0000-000000266976', '00000000-0000-0000-0000-000000266978', 'new');

select pg_temp.act_as('00000000-0000-0000-0000-000000266976');
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266976', 20)),
  0, 'KANONSCOPE1_dos_de_tres_son_leads_activos_1_elegible_bajo_el_umbral_0_filas_D_KANON_SCOPE'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 15) Frontera Δ=0 [endurecimiento post-guardian V2, bloqueante] — DELTA1 (sección 9) solo
--     ejercita Δ<0 (VOLD). Una persona cuya ÚNICA actividad en la ventana es `video_view`
--     cuenta para elegibilidad/k-anon (D-ELIGIBILIDAD) pero NO pesa en `private.crm_temperature`
--     (solo video_completed/likes/saves/contacto pesan, 266.2) — su temperature es SIEMPRE 0 y
--     su temp_prev también 0, así que delta = 0 − 0 = 0, exactamente en la frontera. El
--     mutante `delta_filtered` con `>= 0` en vez de `> 0` la mete al radar sin señal real.
--     PROP_V2 (AGR_V2 aislado): 3 espectadores con save reciente (delta>0, visibles) + 1
--     espectador (V2_VIEWONLY) con SOLO un video_view reciente (delta=0, NO debe aparecer).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266980', 'agv2.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266981', 'v2a.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266982', 'v2b.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266983', 'v2c.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266984', 'v2viewonly.266p6@test.local');
update public.users set role = 'agent', is_verified_agent = true where id = '00000000-0000-0000-0000-000000266980';
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266918', '00000000-0000-0000-0000-000000266980', 'departamento', 'rent',
   'Fixture 266.6 — PROP_V2 (frontera Δ=0, solo video_view)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.52, 20.84), 4326)::extensions.geography, 11300, 'active');
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266981', '00000000-0000-0000-0000-000000266918', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266982', '00000000-0000-0000-0000-000000266918', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266983', '00000000-0000-0000-0000-000000266918', now() - interval '1 hour');
insert into public.events_raw (event_type, user_id, property_id, created_at) values
  ('video_view', '00000000-0000-0000-0000-000000266984', '00000000-0000-0000-0000-000000266918', now() - interval '1 hour');

select pg_temp.act_as('00000000-0000-0000-0000-000000266980');
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266980', 20)),
  3, 'DELTAZERO1_solo_video_view_delta_igual_a_0_no_aparece_sigue_en_3'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 16) crm_radar_window_days [endurecimiento post-guardian O-8] — WINDOW1/2 (sección 7) fijan
--     la ventana en el DEFAULT hardcodeado (14); ningún assert leía la clave desde
--     `app_config`, gemelo de THRESH1/2 pero para `crm_radar_window_days`. PROP_WIN34
--     (AGR_WIN34 aislado): 2 espectadores con save reciente (delta>0) + 1 (VW3) cuya ÚNICA
--     señal es de hace 10 días — dentro del default 14 (cuenta, eleva elegibles a 3, pasa
--     k-anon) pero delta<0 por sí sola (no aparece como fila, igual que WINDOW1/VE3). Con el
--     default: 2 filas visibles. Al bajar `crm_radar_window_days` a 7 DENTRO de la misma
--     transacción, la señal de VW3 (hace 10 días) deja de contar → elegibles caen a 2 (< 3) →
--     la propiedad ENTERA queda oculta (0 filas, ni los 2 con delta>0 genuino) — SIN publicar
--     app. Va junto a THRESH (antes de él): ambos mutan `app_config` GLOBAL dentro de la
--     transacción y no deben contaminar los conteos con default de las secciones anteriores.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266985', 'agwin34.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266986', 'vw1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266987', 'vw2.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266988', 'vw3.266p6@test.local');
update public.users set role = 'agent', is_verified_agent = true where id = '00000000-0000-0000-0000-000000266985';
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266919', '00000000-0000-0000-0000-000000266985', 'departamento', 'rent',
   'Fixture 266.6 — PROP_WIN34 (crm_radar_window_days subible a la baja)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.53, 20.85), 4326)::extensions.geography, 11400, 'active');
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266986', '00000000-0000-0000-0000-000000266919', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266987', '00000000-0000-0000-0000-000000266919', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266988', '00000000-0000-0000-0000-000000266919', now() - interval '10 days');

select pg_temp.act_as('00000000-0000-0000-0000-000000266985');
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266985', 20)),
  2, 'WINDOW3_con_default_14_la_senal_de_hace_10_dias_cuenta_para_kanon_2_filas'
);
reset role;

insert into public.app_config (key, value) values ('crm_radar_window_days', '7'::jsonb);

select pg_temp.act_as('00000000-0000-0000-0000-000000266985');
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266985', 20)),
  0, 'WINDOW4_bajar_crm_radar_window_days_a_7_oculta_la_senal_de_hace_10_dias_propiedad_oculta_0_filas'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 17) crm_anon_min_viewers — subible SIN publicar app (§7.5/exploración 045 tabla de claves).
--     PROP_THRESH (AGR_THRESH aislado): 3 espectadores, visible con el default (3); al subir
--     la clave a 4 DENTRO de la misma transacción, la propiedad queda oculta. Va AL FINAL del
--     archivo a propósito: la clave override es GLOBAL de app_config y no debe afectar los
--     conteos con default=3 de las secciones anteriores.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266972', 'agthresh.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266973', 'vt1.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266974', 'vt2.266p6@test.local'),
  ('00000000-0000-0000-0000-000000266975', 'vt3.266p6@test.local');
update public.users set role = 'agent', is_verified_agent = true where id = '00000000-0000-0000-0000-000000266972';
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266916', '00000000-0000-0000-0000-000000266972', 'departamento', 'rent',
   'Fixture 266.6 — PROP_THRESH (crm_anon_min_viewers subible)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.50, 20.82), 4326)::extensions.geography, 11100, 'active');
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266973', '00000000-0000-0000-0000-000000266916', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266974', '00000000-0000-0000-0000-000000266916', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000266975', '00000000-0000-0000-0000-000000266916', now() - interval '1 hour');

select pg_temp.act_as('00000000-0000-0000-0000-000000266972');
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266972', 20)),
  3, 'THRESH1_con_default_3_la_propiedad_aparece_3_filas'
);
reset role;

insert into public.app_config (key, value) values ('crm_anon_min_viewers', '4'::jsonb);

select pg_temp.act_as('00000000-0000-0000-0000-000000266972');
select is(
  pg_temp.real_count(pg_temp.radar_json('00000000-0000-0000-0000-000000266972', 20)),
  0, 'THRESH2_subir_crm_anon_min_viewers_a_4_oculta_la_propiedad_sin_publicar_app_0_filas'
);
reset role;

select * from finish();
rollback;
