-- Tests pgTAP — public.crm_agency_overview (subtarea 269.1, exploración 045 §6.6/§14 T-E).
-- Ejecutar con:
--   docker exec -i supabase_db_urbea-app psql -U postgres -d postgres -v ON_ERROR_STOP=0 \
--     -tAq -f /dev/stdin < supabase/tests/107_crm_agency_overview_test.sql
-- Corre como superusuario dentro de una transacción revertida (no persiste). Impersonamos con
-- pg_temp.act_as(uid, role) — mismo patrón de 02/35/62/100/101/102/103/104/106.
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba (contrato PÚBLICO, comportamiento observable, NUNCA internals):
--   public.crm_agency_overview(p_agency_id uuid)
--   → TABLE(kind text, agent_id uuid, agent_name text, lead_id uuid, untouched_count integer,
--           response_hours numeric, avg_temperature integer, flag text, temperature integer,
--           first_contact_at timestamptz, lead_display_name text)
--   SECURITY DEFINER, STABLE, search_path='', REVOKE de public/anon, GRANT solo a
--   authenticated. 0 filas salvo owner/admin ACTIVO de p_agency_id (private.agency_role_of).
-- SUT AÚN NO EXISTE (RED 2026-09-06): lo crea
--   supabase/migrations/2026090640000X_crm_agency_overview.sql (fuera de esta fase).
--
-- ── Estrategia RED sin depender de "function does not exist" (mismo patrón que
--    100/101/102/103/104/106) ─────────────────────────────────────────────────────────────────
-- (a) Catálogo puro (has_function/pg_get_function_*/pg_proc/function_privs_are) es seguro
--     aunque la función no exista: resuelve "not ok" sin lanzar.
-- (b) TODA llamada real en contexto "autorizado" pasa por el wrapper pg_temp.overview_json(...)
--     que agrega las filas a jsonb (jsonb_agg) y atrapa CUALQUIER excepción devolviendo el
--     sentinel '[{"__error__": true}, {"__error__": true}]'::jsonb — un ARRAY de 2 elementos,
--     ninguno con kind='agent'/'unmanaged', así que cualquier lookup por kind+llave no
--     encuentra nada (mismo criterio que 102/103, verificado por construcción).
-- (c) Anti-vacuo (hallazgo propio, mismo criterio que 103_crm_lead_detail_activity_test.sql):
--     pg_temp.field_of(...) exige EXACTAMENTE 1 fila que matchee kind+llave antes de leer el
--     campo; si no, devuelve el literal TEXTO '__WRONG_ROW_COUNT__' — NUNCA NULL — así un
--     assert que espera NULL (p.ej. response_hours de un agente que nunca contactó) no puede
--     pasar "ok" por casualidad si la fila no existe (is('__WRONG_ROW_COUNT__', null) reporta
--     "not ok"). Los campos numéricos se leen con pg_temp.safe_numeric(...), que atrapa el
--     error de cast del sentinel de texto y lo vuelve -999999 (nunca coincide con un literal
--     real de este fixture) en vez de abortar la transacción entera.
-- (d) Gotcha 203.1 (el EXECUTE se comprueba al planificar y el plan se cachea): el caso `anon`
--     (ACLREAL) va SIN wrapper, con throws_ok directo, y es la PRIMERA invocación real de
--     public.crm_agency_overview en todo el archivo — antes de cualquier llamada del wrapper.
--
-- ── Decisiones de diseño del test-author (el contrato no las fijaba; se deciden aquí y el
--    GREEN debe cumplirlas exactamente — quedan en la bitácora de la subtarea) ────────────────
-- D-SHAPE: TABLE(kind, agent_id, agent_name, lead_id, untouched_count, response_hours,
--   avg_temperature, flag, temperature, first_contact_at, lead_display_name). kind='agent'
--   llena {agent_id, agent_name, untouched_count, response_hours, avg_temperature, flag} y dela
--   NULL {lead_id, temperature, first_contact_at, lead_display_name}; kind='unmanaged' es el
--   espejo exacto (llena {lead_id, temperature, first_contact_at, lead_display_name}, NULL el
--   resto).
-- D-CLOCK: SIN parámetro p_at — usa now() internamente (mismo criterio que public.crm_funnel,
--   266.4: `v_since := now() - interval`). now() es CONSTANTE dentro de la transacción
--   begin;...rollback; de este archivo (transaction timestamp, no wall-clock real), así que
--   TODO timestamp del fixture expresado como `now() - interval 'N horas/días'` produce deltas
--   EXACTOS, deterministas, sin importar cuánto tarde en correr la suite (mismo principio que
--   private.crm_temperature/crm_band, 266.2, aplicado aquí sin necesidad de parametrizar el
--   reloj: no hay paginación ni cursor que congelar entre llamadas, a diferencia de
--   crm_leads_page).
-- D-AGENTROWS: kind='agent' por cada agency_member ACTIVO con member_role IN
--   ('agent','admin','owner') que además (member_role='agent') O (tiene ≥1 lead no borrado
--   como agent_id) — un owner/admin SIN ningún lead propio no aparece (probado: OWNER con 0
--   leads no sale; ADMIN con 1 lead sí). `viewer` NUNCA aparece (no es dueño de pipeline
--   comercial, mismo criterio que notify_lead_unmanaged excluyendo viewer). Suspendido NUNCA
--   aparece como kind='agent' (sus leads pasan a kind='unmanaged').
-- D-UNTOUCHED: untouched_count = count(*) leads del agente, deleted_at is null, status='new'
--   (texto explícito de la subtarea — "sin_tocar" ⟺ status='new').
-- D-RESPONSE: response_hours = mediana en HORAS de (primera fila de lead_status_history con
--   old_status IS NOT NULL AND new_status='contacted', por changed_at ASC, MENOS
--   leads.created_at) sobre TODOS los leads no borrados del agente (abiertos o cerrados — mide
--   velocidad de respuesta histórica, no solo del pipeline abierto). NULL si NINGÚN lead del
--   agente transicionó jamás a 'contacted' vía una fila con old_status IS NOT NULL (la fila de
--   creación, con old_status NULL, NUNCA cuenta como transición — mismo criterio que
--   crm_leads_page:290-296 para `last_status_change_at`). Etiqueta honesta (exploración 045
--   §16.7): mide cuándo el agente MARCA el lead como contactado, no cuándo responde de facto.
-- D-AVGTEMP: avg_temperature = round(avg(private.crm_temperature(agent_id, lead.user_id,
--   now()))) sobre los leads ABIERTOS (status NOT IN closed set) no borrados del agente; NULL
--   si 0 leads abiertos. La semántica nativa de avg()/count() sobre conjunto vacío (NULL/0) ya
--   satisface "0 leads → flag NULL" sin caso especial en el cuerpo (ponytail: se apoya en la
--   aritmética de SQL en vez de un IF adicional).
-- D-STALE (insumo de 'acumula'): un lead ABIERTO cuenta como stale si NUNCA tuvo una fila de
--   lead_status_history con old_status IS NOT NULL (nunca transicionó de verdad) Y
--   now() - leads.created_at >= crm_agent_flag_stale_days. Un lead que SÍ transicionó alguna
--   vez nunca es stale, sin importar su edad (D-RESPONSE usa el mismo criterio de "transición
--   real").
-- D-FLAG: 'pierde_leads' si (untouched_count >= crm_agent_flag_untouched_min) OR
--   (response_hours IS NOT NULL AND response_hours > crm_agent_flag_response_hours) — 'pierde_
--   leads' MANDA sobre 'acumula' cuando ambas condiciones aplican (agente con leads sin_tocar Y
--   leads stale a la vez). 'acumula' si ninguna condición de pierde_leads aplica y count(leads
--   stale) >= crm_agent_flag_stale_leads_min. NULL en cualquier otro caso (incluido 0 leads).
--   Todos los umbrales por COALESCE(app_config, default) — nunca hardcoded (CONFIG1 lo prueba
--   cambiando crm_agent_flag_stale_leads_min en vivo).
-- D-UNMANAGED (🔴 CORREGIDO tras hallazgo del guardian, §0.5.4 — frontera de agencia):
--   kind='unmanaged' por cada lead con `leads.agency_id = p_agency_id` (deleted_at is null,
--   status NOT IN closed set) cuyo agent_id sea un agency_member con status='suspended' EN
--   ESA MISMA p_agency_id (mecanismo #203, 20260904200001). El filtro por agency_members.status
--   por sí solo NO basta — la RPC es SECURITY DEFINER y salta RLS, así que debe replicar la
--   MISMA frontera que la policy `leads_select` (20260807000006: `agent_id = auth.uid() OR
--   private.agency_role_of(agency_id) in ('owner','admin')`) exigiría si corriera con RLS. NO
--   es circular usar leads.agency_id aquí: private.set_lead_agency_id (#203,
--   20260904200001:64-105) resuelve PRIMERO a la membresía ACTIVA del agente al momento de
--   CAPTAR el lead, y solo cae a la SUSPENDIDA más reciente si no hay ninguna activa — es
--   exactamente la semántica "el lead pertenece a la agencia donde el agente lo captó", la
--   MISMA fuente de verdad que leads_select ya usa. Sin este filtro, un agente suspendido EN
--   la agencia A pero ACTIVO en la agencia B (su lead nuevo se captura correctamente con
--   agency_id=B vía el trigger) aparecería IGUAL como "sin gestor" en A — fuga de un lead que
--   ni siquiera es de A (ver FRONTERA_AGENCIA más abajo).
--   temperature = private.crm_temperature(suspended_agent_id, lead.user_id, now()).
-- D-UNMANAGED-REMOVED (#278 hardening(269.1), decisión de Abraham 2026-09-07: retirado =
--   suspendido para la banda): el agente cuenta como "sin gestor" si HOY tiene una membresía
--   status IN ('suspended','removed') EN p_agency_id Y NINGUNA status='active' en p_agency_id.
--   Semi-join (exists / not exists), NO join: agency_members_agency_user_active solo es única
--   para 'active' y redeem-invitation INSERTA una fila nueva al readmitir
--   (20260905200003:193), así que un retirado readmitido acumula removed + active en la misma
--   agencia (con join saldría sin gestor teniendo gestor: READMIT1) y un retirado dos veces
--   acumula 2 removed (con join el lead saldría duplicado: REMOVED2). Solo entran los leads
--   captados MIENTRAS era miembro (leads.agency_id ya fijado): private.set_lead_agency_id no
--   cambia — un lead NUEVO de un ex-miembro sigue con agency_id NULL (regla PII #203.1), y por
--   eso el fixture de AGENT_REMOVED fija agency_id=A explícito. reassign_lead_atomic no valida
--   el status del agente origen: ASIGNAR ya sirve para estos leads.
--   first_contact_at = leads.first_contact_at (columna existente, sin cómputo).
--   lead_display_name = trim(first_name || ' ' || last_name) del BUSCADOR (users del
--   lead.user_id) — mismo patrón que full_name de crm_leads_page.
-- D-METRICS-SCOPE (🔴 NUEVO tras hallazgo del guardian, §0.5.4): las métricas por agente
--   (untouched_count, response_hours, avg_temperature, stale/flag) de un agent row SOLO cuentan
--   `leads.agency_id = p_agency_id` — un agente puede trabajar en varias agencias a lo largo
--   del tiempo (una activa a la vez, `agency_members_one_active_per_user`, pero puede acumular
--   leads de agencias PREVIAS con agency_id distinto); ver overview de la agencia A NUNCA debe
--   mezclar leads que le pertenecen a la agencia B. Ver FRONTERA_AGENCIA (CROSS).
-- D-ORDER: kind='agent' PRIMERO (ORDER BY kind ASC ya los separa: 'agent' < 'unmanaged'
--   alfabéticamente), ordenados por agent_name ASC; luego kind='unmanaged', ordenados por
--   temperature DESC, lead_id ASC.
-- D-CLOSED (enum lead_status, post-reconcile 20260807000002): cerrados = closed_won_rent,
--   closed_won_sale, closed_lost, discarded, closed_won. Abiertos = el resto (new,
--   whatsapp_opened, contacted, interested, in_progress, visit_scheduled) — mismo mapeo 8→4
--   que public.crm_leads_page (266.4, §7.4).
-- Fuera de alcance de este RED (documentado, no fixture de más): boundary EXACTO de
-- crm_agent_flag_untouched_min/stale_leads_min "un valor abajo no dispara" más allá del caso
-- ya cubierto por AGENT_NOFLAG (untouched=2 < 3, no dispara); el boundary EXACTO de
-- response_hours (24, no dispara) SÍ se ancla (ADMIN). CONFIG1 (mutante sin COALESCE) prueba
-- el mecanismo general sobre crm_agent_flag_stale_leads_min; se asume el mismo patrón de
-- COALESCE para las otras 3 claves (mismo molde literal que private.crm_temperature, ya
-- custodiado por 100_crm_temperature_test.sql).
--
-- 🔴 AMPLIACIÓN post-guardian (269.1, FAIL por cobertura — la migración GREEN 20260906400001 es
-- correcta en lo que cubría, incompleta en cobertura): V1 (mutante M6 "incluye viewers"), V2
-- (mutante M23 "stale ignora transición" + M16 "stale sin edad"), M13 ("avg_temperature incluye
-- cerrados") y FRONTERA_AGENCIA (§0.5.4, hallazgo NUEVO de privacidad: la RPC no acotaba por
-- leads.agency_id, ver D-UNMANAGED/D-METRICS-SCOPE arriba). Los 3 primeros documentan
-- comportamiento YA CORRECTO en el GREEN actual (asserts nuevos en verde); FRONTERA_AGENCIA
-- expone una brecha REAL — sus asserts nuevos van en rojo contra la migración actual, y
-- HAPPY1/HAPPY3/HAPPY4/ORDER2 (preexistentes) TAMBIÉN se vuelven rojo como consecuencia
-- esperada del MISMO hueco (el lead de XAGENCY se cuela en unmanaged de A bajo el código
-- actual, y su nombre NULL se intercala en la secuencia ordenada de ORDER2) — sus literales ya
-- reflejan el valor OBJETIVO (post-fix), no el actual; no es una regresión nueva, es la MISMA
-- brecha propagándose a asserts que ya existían. Verificado en vivo (docker exec, ver bitácora):
-- 7 not ok de 70 — HAPPY1/HAPPY3/HAPPY4/ORDER2 + FRONTERA1/2/3; los otros 63 (incluidos V1, V2,
-- M13, XAGENCY_SETUP) en ok.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(77);

-- ── Helper de impersonación (mismo patrón que 02/.../100/101/102/103/104/106) ───────────────
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '00000000-0000-0000-0000-000000269XXX' (subtarea 269.1).
--   USERS 001-014,021-022 (roles fijos) + 101-142 (buscadores del pipeline) + 201-203
--   (buscadores sin gestor). AGENCIES 301-302. AGENCY_MEMBERS 311-327. PROPERTIES 401 (única,
--   FK de lead_origin_properties). LEADS 501-534 (pipeline) + 601-603 (sin gestor).
--
--   001 OWNER            — owner  ACTIVO agencia A, 0 leads → NO sale como agent row.
--   002 ADMIN             — admin  ACTIVO agencia A, 1 lead → boundary response_hours=24 exacto.
--   003 AGENT_PIERDE      — agent  ACTIVO agencia A, 3 new + 5 in_progress stale → pierde_leads
--                            (untouched Y stale a la vez — prueba que pierde_leads MANDA).
--   005 AGENT_ACUM        — agent  ACTIVO agencia A, 5 contacted stale, 0 untouched → acumula.
--   006 AGENT_ZERO        — agent  ACTIVO agencia A, 0 leads reales (+1 BORRADO, decoy) → todo
--                            NULL/0, prueba deleted_at is null.
--   007 VIEWER            — viewer ACTIVO agencia A, +1 lead (decoy, V1) → NUNCA sale como
--                            agent row pese a tener lead.
--   008 AGENT_SUSP        — agent  SUSPENDIDO agencia A → sus leads pasan a 'unmanaged'.
--   009 AGENT_NOFLAG      — agent  ACTIVO agencia A, 2 new + 1 contacted (resp=8h, avgtemp=10)
--                            + 1 CERRADO con señal caliente (decoy, M13, no debe contar) →
--                            baseline sin flag.
--   010 OWNER_SUSPENDED   — owner  SUSPENDIDO agencia A → ACL: 0 filas.
--   011 OWNER_OTHER       — owner  ACTIVO agencia B (ajena) → ACL: 0 filas sobre agencia A.
--   012 AGENT_SLOW        — agent  ACTIVO agencia A, 1 lead resp=30h (>24) → pierde_leads solo
--                            por respuesta (untouched=0, stale=0).
--   013 AGENT_STALE_TRANS — agent  ACTIVO agencia A, 5 leads viejos (10d) que SÍ transicionaron
--                            a contacted (V2/M23) → NO deben contar como stale → flag NULL.
--   014 AGENT_STALE_YOUNG — agent  ACTIVO agencia A, 5 leads SIN transición pero JÓVENES (2d,
--                            V2/M16) → NO deben contar como stale (edad < umbral) → flag NULL.
--   021 AGENT_CROSS       — agent  ACTIVO agencia A (+ SUSPENDIDO histórico en B,
--                            FRONTERA_AGENCIA): 1 lead de A + 1 lead de B (agency_id explícito)
--                            → untouched_count/avg_temperature de A deben contar SOLO el de A.
--   022 AGENT_XAGENCY     — agent  SUSPENDIDO en A, ACTIVO en B (FRONTERA_AGENCIA): su lead
--                            nuevo resuelve agency_id=B (vía trigger) → NO debe aparecer como
--                            'unmanaged' de A aunque esté suspendido EN A.
--   023 AGENT_REMOVED     — agent  RETIRADO DOS VECES en A (2 filas removed, #278): 1 lead
--                            abierto captado cuando era miembro (agency_id=A explícito) →
--                            'unmanaged' de A, EXACTAMENTE 1 vez.
--   024 AGENT_READMIT     — agent  RETIRADO y READMITIDO en A (removed + active, #278): 1 lead
--                            → agent row «Zulema Readmit», NUNCA 'unmanaged'.
--   025 AGENT_REMOVED_X   — agent  RETIRADO en A, ACTIVO en B (#278, frontera): su lead nuevo
--                            resuelve agency_id=B (vía trigger) → NO es 'unmanaged' de A; y su
--                            lead VIEJO captado en A (agency_id=A explícito) SÍ es 'unmanaged'
--                            de A — nadie en A lo gestiona aunque el agente siga activo en B
--                            (mutante e del guardian: el not-exists debe acotarse a p_agency_id).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000269001', 'owner.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269002', 'admin.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269003', 'pierde.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269005', 'acum.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269006', 'zero.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269007', 'viewer.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269008', 'susp.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269009', 'noflag.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269010', 'ownersusp.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269011', 'ownerother.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269012', 'slow.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269013', 'staletrans.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269014', 'staleyoung.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269021', 'cross.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269022', 'xagency.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269023', 'removed.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269024', 'readmit.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269025', 'removedx.269e1@test.local');

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-000000269' || i)::uuid, 'u' || i || '.269e1@test.local'
from generate_series(101, 142) as i;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000269201', 'hot.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269202', 'cold.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269203', 'closed.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269204', 'buscador3.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269205', 'buscador4.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269206', 'buscador5.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269207', 'buscador6.269e1@test.local');

update public.users set first_name = 'Zeta', last_name = 'Admin'
  where id = '00000000-0000-0000-0000-000000269002';
update public.users set first_name = 'Alfa', last_name = 'Pierde'
  where id = '00000000-0000-0000-0000-000000269003';
update public.users set first_name = 'Meso', last_name = 'Acum'
  where id = '00000000-0000-0000-0000-000000269005';
update public.users set first_name = 'Beta', last_name = 'Zero'
  where id = '00000000-0000-0000-0000-000000269006';
update public.users set first_name = 'Nu', last_name = 'Noflag'
  where id = '00000000-0000-0000-0000-000000269009';
update public.users set first_name = 'Yara', last_name = 'Slow'
  where id = '00000000-0000-0000-0000-000000269012';
update public.users set first_name = 'Ceci', last_name = 'Transitioned'
  where id = '00000000-0000-0000-0000-000000269013';
update public.users set first_name = 'Delta', last_name = 'Young'
  where id = '00000000-0000-0000-0000-000000269014';
update public.users set first_name = 'Xavier', last_name = 'Cross'
  where id = '00000000-0000-0000-0000-000000269021';
update public.users set first_name = 'Zulema', last_name = 'Readmit'
  where id = '00000000-0000-0000-0000-000000269024';
update public.users set first_name = 'Iker', last_name = 'Buscador3'
  where id = '00000000-0000-0000-0000-000000269204';
update public.users set first_name = 'Julia', last_name = 'Buscador6'
  where id = '00000000-0000-0000-0000-000000269207';
update public.users set first_name = 'Gonzalo', last_name = 'Buscador1'
  where id = '00000000-0000-0000-0000-000000269201';
update public.users set first_name = 'Hilda', last_name = 'Buscador2'
  where id = '00000000-0000-0000-0000-000000269202';

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000269301', 'Inmobiliaria Overview 269', 'inmo-overview-269',
   'active', '00000000-0000-0000-0000-000000269001'),
  ('00000000-0000-0000-0000-000000269302', 'Inmobiliaria Overview Ajena 269', 'inmo-overview-ajena-269',
   'active', '00000000-0000-0000-0000-000000269011');

insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000269311', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269001', 'owner',  'active'),    -- OWNER
  ('00000000-0000-0000-0000-000000269312', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269002', 'admin',  'active'),    -- ADMIN
  ('00000000-0000-0000-0000-000000269313', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269003', 'agent',  'active'),    -- AGENT_PIERDE
  ('00000000-0000-0000-0000-000000269314', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269005', 'agent',  'active'),    -- AGENT_ACUM
  ('00000000-0000-0000-0000-000000269315', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269006', 'agent',  'active'),    -- AGENT_ZERO
  ('00000000-0000-0000-0000-000000269316', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269007', 'viewer', 'active'),    -- VIEWER
  ('00000000-0000-0000-0000-000000269317', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269008', 'agent',  'suspended'), -- AGENT_SUSP
  ('00000000-0000-0000-0000-000000269318', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269009', 'agent',  'active'),    -- AGENT_NOFLAG
  ('00000000-0000-0000-0000-000000269319', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269010', 'owner',  'suspended'), -- OWNER_SUSPENDED
  ('00000000-0000-0000-0000-000000269320', '00000000-0000-0000-0000-000000269302', '00000000-0000-0000-0000-000000269011', 'owner',  'active'),    -- OWNER_OTHER (agencia B)
  ('00000000-0000-0000-0000-000000269321', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269012', 'agent',  'active'),    -- AGENT_SLOW
  ('00000000-0000-0000-0000-000000269326', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269013', 'agent',  'active'),    -- AGENT_STALE_TRANS
  ('00000000-0000-0000-0000-000000269327', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269014', 'agent',  'active'),    -- AGENT_STALE_YOUNG
  ('00000000-0000-0000-0000-000000269322', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269021', 'agent',  'active'),    -- AGENT_CROSS, ACTIVO en A
  ('00000000-0000-0000-0000-000000269323', '00000000-0000-0000-0000-000000269302', '00000000-0000-0000-0000-000000269021', 'agent',  'suspended'), -- AGENT_CROSS, histórico SUSPENDIDO en B
  ('00000000-0000-0000-0000-000000269324', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269022', 'agent',  'suspended'), -- AGENT_XAGENCY, SUSPENDIDO en A
  ('00000000-0000-0000-0000-000000269325', '00000000-0000-0000-0000-000000269302', '00000000-0000-0000-0000-000000269022', 'agent',  'active'),    -- AGENT_XAGENCY, ACTIVO en B
  ('00000000-0000-0000-0000-000000269328', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269023', 'agent',  'removed'),   -- AGENT_REMOVED, 1ª estancia en A (#278)
  ('00000000-0000-0000-0000-000000269329', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269023', 'agent',  'removed'),   -- AGENT_REMOVED, 2ª estancia en A (#278)
  ('00000000-0000-0000-0000-000000269330', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269024', 'agent',  'removed'),   -- AGENT_READMIT, estancia vieja en A (#278)
  ('00000000-0000-0000-0000-000000269331', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269024', 'agent',  'active'),    -- AGENT_READMIT, READMITIDO en A (#278)
  ('00000000-0000-0000-0000-000000269332', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269025', 'agent',  'removed'),   -- AGENT_REMOVED_X, RETIRADO de A (#278)
  ('00000000-0000-0000-0000-000000269333', '00000000-0000-0000-0000-000000269302', '00000000-0000-0000-0000-000000269025', 'agent',  'active');    -- AGENT_REMOVED_X, ACTIVO en B (#278)

insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000269401', '00000000-0000-0000-0000-000000269001',
   '00000000-0000-0000-0000-000000269301', 'departamento', 'rent', 'Fixture 269.1 — P1',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active');

-- ── AGENT_PIERDE (003): 3 'new' (untouched) + 5 'in_progress' stale (creados hace 10 días,
--    nunca transicionaron) — untouched=3 (dispara pierde_leads) Y stale=5 (dispara acumula) A
--    LA VEZ, para probar que pierde_leads MANDA (D-FLAG). ──────────────────────────────────────
insert into public.leads (id, agent_id, user_id, status, created_at) values
  ('00000000-0000-0000-0000-000000269501', '00000000-0000-0000-0000-000000269003', '00000000-0000-0000-0000-000000269101', 'new', now()),
  ('00000000-0000-0000-0000-000000269502', '00000000-0000-0000-0000-000000269003', '00000000-0000-0000-0000-000000269102', 'new', now()),
  ('00000000-0000-0000-0000-000000269503', '00000000-0000-0000-0000-000000269003', '00000000-0000-0000-0000-000000269103', 'new', now());
insert into public.leads (id, agent_id, user_id, status, created_at) values
  ('00000000-0000-0000-0000-000000269504', '00000000-0000-0000-0000-000000269003', '00000000-0000-0000-0000-000000269104', 'in_progress', now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000269505', '00000000-0000-0000-0000-000000269003', '00000000-0000-0000-0000-000000269105', 'in_progress', now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000269506', '00000000-0000-0000-0000-000000269003', '00000000-0000-0000-0000-000000269106', 'in_progress', now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000269507', '00000000-0000-0000-0000-000000269003', '00000000-0000-0000-0000-000000269107', 'in_progress', now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000269508', '00000000-0000-0000-0000-000000269003', '00000000-0000-0000-0000-000000269108', 'in_progress', now() - interval '10 days');

-- ── AGENT_ACUM (005): 5 'contacted' directo (sin transición real), creados hace 10 días →
--    untouched=0, response=NULL (ninguna transición real), stale=5 → acumula puro. ────────────
insert into public.leads (id, agent_id, user_id, status, created_at) values
  ('00000000-0000-0000-0000-000000269509', '00000000-0000-0000-0000-000000269005', '00000000-0000-0000-0000-000000269109', 'contacted', now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000269510', '00000000-0000-0000-0000-000000269005', '00000000-0000-0000-0000-000000269110', 'contacted', now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000269511', '00000000-0000-0000-0000-000000269005', '00000000-0000-0000-0000-000000269111', 'contacted', now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000269512', '00000000-0000-0000-0000-000000269005', '00000000-0000-0000-0000-000000269112', 'contacted', now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000269513', '00000000-0000-0000-0000-000000269005', '00000000-0000-0000-0000-000000269113', 'contacted', now() - interval '10 days');

-- ── AGENT_ZERO (006): 0 leads reales + 1 lead BORRADO (decoy deleted_at) — prueba que el
--    filtro deleted_at is null es real (sin él, untouched pasaría a 1 y avg_temperature a 0
--    en vez de NULL). ─────────────────────────────────────────────────────────────────────────
insert into public.leads (id, agent_id, user_id, status, created_at, deleted_at) values
  ('00000000-0000-0000-0000-000000269519', '00000000-0000-0000-0000-000000269006', '00000000-0000-0000-0000-000000269114', 'new', now(), now());

-- ── AGENT_NOFLAG (009): 2 'new' (untouched=2, bajo el umbral 3) + 1 lead contactado con
--    response=8h exacto y una señal de origen (contacted_at=now()-1h → temperatura=30) →
--    avg_temperature=(0+0+30)/3=10. ───────────────────────────────────────────────────────────
insert into public.leads (id, agent_id, user_id, status, created_at) values
  ('00000000-0000-0000-0000-000000269514', '00000000-0000-0000-0000-000000269009', '00000000-0000-0000-0000-000000269115', 'new', now()),
  ('00000000-0000-0000-0000-000000269515', '00000000-0000-0000-0000-000000269009', '00000000-0000-0000-0000-000000269116', 'new', now());
insert into public.leads (id, agent_id, user_id, status, created_at) values
  ('00000000-0000-0000-0000-000000269516', '00000000-0000-0000-0000-000000269009', '00000000-0000-0000-0000-000000269117', 'new', now() - interval '8 hours');
update public.leads set status = 'contacted' where id = '00000000-0000-0000-0000-000000269516';
insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000269716', '00000000-0000-0000-0000-000000269516', '00000000-0000-0000-0000-000000269401', now() - interval '1 hour');

-- ── M13 decoy — AGENT_NOFLAG (009) recibe además 1 lead CERRADO con una señal CALIENTE
--    (contact_first hace 1h → temperatura=30 si se incluyera). avg_temperature debe SEGUIR en
--    10 ((0+0+30)/3, solo los 3 leads ABIERTOS) — si el mutante M13 incluyera cerrados, sería
--    (0+0+30+30)/4=15. ─────────────────────────────────────────────────────────────────────────
insert into public.leads (id, agent_id, user_id, status, created_at) values
  ('00000000-0000-0000-0000-000000269521', '00000000-0000-0000-0000-000000269009', '00000000-0000-0000-0000-000000269120', 'closed_won_rent', now());
insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000269721', '00000000-0000-0000-0000-000000269521', '00000000-0000-0000-0000-000000269401', now() - interval '1 hour');

-- ── ADMIN (002): 1 lead, response_hours=24 EXACTO (boundary, NO dispara — la condición es
--    ESTRICTAMENTE mayor). Prueba también que un admin CON lead sí sale como agent row. ───────
insert into public.leads (id, agent_id, user_id, status, created_at) values
  ('00000000-0000-0000-0000-000000269517', '00000000-0000-0000-0000-000000269002', '00000000-0000-0000-0000-000000269118', 'new', now() - interval '24 hours');
update public.leads set status = 'contacted' where id = '00000000-0000-0000-0000-000000269517';

-- ── AGENT_SLOW (012): 1 lead, response_hours=30 (> 24) → pierde_leads SOLO por respuesta
--    (untouched=0, stale=0 porque SÍ transicionó). ──────────────────────────────────────────────
insert into public.leads (id, agent_id, user_id, status, created_at) values
  ('00000000-0000-0000-0000-000000269518', '00000000-0000-0000-0000-000000269012', '00000000-0000-0000-0000-000000269119', 'new', now() - interval '30 hours');
update public.leads set status = 'contacted' where id = '00000000-0000-0000-0000-000000269518';

-- ── V1 decoy — VIEWER (007) recibe 1 lead ABIERTO. VIEWER NUNCA debe salir como agent row
--    (mutante M6 "incluye viewers"). ─────────────────────────────────────────────────────────────
insert into public.leads (id, agent_id, user_id, status, created_at) values
  ('00000000-0000-0000-0000-000000269520', '00000000-0000-0000-0000-000000269007', '00000000-0000-0000-0000-000000269121', 'new', now());

-- ── AGENT_STALE_TRANS (013): 5 leads 'contacted' directo, creados hace 10 días, CADA UNO con
--    una fila de transición REAL (old_status='new'→new_status='contacted') insertada DIRECTO en
--    lead_status_history (bypass del trigger, mismo patrón que 102_crm_leads_page_funnel_test.sql
--    "agendaron") a solo 2h de created_at — response_hours=2 (bajo el umbral) y, sobre todo,
--    SÍ transicionaron de verdad: aunque tengan 10 días de antigüedad, NUNCA deben contar como
--    stale (mutante M23 "stale ignora transición" sí los contaría, dando acumula). ─────────────
insert into public.leads (id, agent_id, user_id, status, created_at) values
  ('00000000-0000-0000-0000-000000269522', '00000000-0000-0000-0000-000000269013', '00000000-0000-0000-0000-000000269130', 'contacted', now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000269523', '00000000-0000-0000-0000-000000269013', '00000000-0000-0000-0000-000000269131', 'contacted', now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000269524', '00000000-0000-0000-0000-000000269013', '00000000-0000-0000-0000-000000269132', 'contacted', now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000269525', '00000000-0000-0000-0000-000000269013', '00000000-0000-0000-0000-000000269133', 'contacted', now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000269526', '00000000-0000-0000-0000-000000269013', '00000000-0000-0000-0000-000000269134', 'contacted', now() - interval '10 days');
insert into public.lead_status_history (lead_id, old_status, new_status, changed_by, changed_at) values
  ('00000000-0000-0000-0000-000000269522', 'new', 'contacted', '00000000-0000-0000-0000-000000269013', now() - interval '10 days' + interval '2 hours'),
  ('00000000-0000-0000-0000-000000269523', 'new', 'contacted', '00000000-0000-0000-0000-000000269013', now() - interval '10 days' + interval '2 hours'),
  ('00000000-0000-0000-0000-000000269524', 'new', 'contacted', '00000000-0000-0000-0000-000000269013', now() - interval '10 days' + interval '2 hours'),
  ('00000000-0000-0000-0000-000000269525', 'new', 'contacted', '00000000-0000-0000-0000-000000269013', now() - interval '10 days' + interval '2 hours'),
  ('00000000-0000-0000-0000-000000269526', 'new', 'contacted', '00000000-0000-0000-0000-000000269013', now() - interval '10 days' + interval '2 hours');

-- ── AGENT_STALE_YOUNG (014): 5 leads 'in_progress' directo (NUNCA transicionaron de verdad —
--    solo la fila de creación con old_status NULL), pero JÓVENES (2 días, bajo
--    crm_agent_flag_stale_days=7) — no deben contar como stale por EDAD (mutante M16 "stale sin
--    edad" sí los contaría). ──────────────────────────────────────────────────────────────────
insert into public.leads (id, agent_id, user_id, status, created_at) values
  ('00000000-0000-0000-0000-000000269527', '00000000-0000-0000-0000-000000269014', '00000000-0000-0000-0000-000000269135', 'in_progress', now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000269528', '00000000-0000-0000-0000-000000269014', '00000000-0000-0000-0000-000000269136', 'in_progress', now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000269529', '00000000-0000-0000-0000-000000269014', '00000000-0000-0000-0000-000000269137', 'in_progress', now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000269530', '00000000-0000-0000-0000-000000269014', '00000000-0000-0000-0000-000000269138', 'in_progress', now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000269531', '00000000-0000-0000-0000-000000269014', '00000000-0000-0000-0000-000000269139', 'in_progress', now() - interval '2 days');

-- ── FRONTERA_AGENCIA (§0.5.4, hallazgo del guardian) — AGENT_CROSS (021, ACTIVO en A, histórico
--    SUSPENDIDO en B): 1 lead de A (agency_id resuelto por el trigger, sin señal) + 1 lead
--    EXPLÍCITO de B (agency_id=B a propósito, con señal caliente contact_first hace 1h →
--    temp=30) — el overview de A debe contar SOLO el de A: untouched_count=1 (no 2),
--    avg_temperature=0 (no 15=(0+30)/2). ────────────────────────────────────────────────────────
insert into public.leads (id, agent_id, user_id, status, created_at, agency_id) values
  ('00000000-0000-0000-0000-000000269532', '00000000-0000-0000-0000-000000269021', '00000000-0000-0000-0000-000000269140', 'new', now(), null),
  ('00000000-0000-0000-0000-000000269533', '00000000-0000-0000-0000-000000269021', '00000000-0000-0000-0000-000000269141', 'new', now(), '00000000-0000-0000-0000-000000269302');
insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000269733', '00000000-0000-0000-0000-000000269533', '00000000-0000-0000-0000-000000269401', now() - interval '1 hour');

-- ── FRONTERA_AGENCIA — AGENT_XAGENCY (022, SUSPENDIDO en A, ACTIVO en B): su lead nuevo entra
--    con agency_id=NULL y el trigger private.set_lead_agency_id (#203) lo resuelve a la
--    membresía ACTIVA (B), NUNCA a la suspendida de A — verificado abajo (XAGENCY_SETUP). El
--    overview de A NO debe mostrarlo como 'unmanaged' (D-UNMANAGED corregido: filtro por
--    leads.agency_id = p_agency_id, no solo por agency_members.status). ───────────────────────
insert into public.leads (id, agent_id, user_id, status, created_at) values
  ('00000000-0000-0000-0000-000000269534', '00000000-0000-0000-0000-000000269022', '00000000-0000-0000-0000-000000269142', 'new', now());

-- ── AGENT_SUSP (008, suspendido): 2 leads ABIERTOS (HOT con señal → temp=30, COLD sin señal
--    → temp=0) + 1 lead CERRADO (closed_won_rent) que NO debe aparecer en 'unmanaged'. ────────
insert into public.leads (id, agent_id, user_id, status, first_contact_at) values
  ('00000000-0000-0000-0000-000000269601', '00000000-0000-0000-0000-000000269008', '00000000-0000-0000-0000-000000269201', 'new', '2026-03-01 09:00:00+00'),
  ('00000000-0000-0000-0000-000000269602', '00000000-0000-0000-0000-000000269008', '00000000-0000-0000-0000-000000269202', 'new', '2026-03-02 09:00:00+00'),
  ('00000000-0000-0000-0000-000000269603', '00000000-0000-0000-0000-000000269008', '00000000-0000-0000-0000-000000269203', 'closed_won_rent', now());
insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000269801', '00000000-0000-0000-0000-000000269601', '00000000-0000-0000-0000-000000269401', now() - interval '1 hour');

-- ── #278 SIN_GESTOR_RETIRADO — AGENT_REMOVED (023): lead captado cuando aún era miembro de A;
--    agency_id=A EXPLÍCITO porque el trigger #203 ya no lo resolvería (removed → NULL, regla
--    PII). AGENT_READMIT (024): removed + active en A → su lead resuelve A vía trigger.
--    AGENT_REMOVED_X (025): removed en A, active en B → su lead resuelve B vía trigger. ──────
insert into public.leads (id, agent_id, user_id, agency_id, status, first_contact_at) values
  ('00000000-0000-0000-0000-000000269604', '00000000-0000-0000-0000-000000269023', '00000000-0000-0000-0000-000000269204', '00000000-0000-0000-0000-000000269301', 'new', '2026-03-03 09:00:00+00'),
  -- AGENT_REMOVED_X: lead VIEJO captado en A antes de irse a B (agency_id=A explícito).
  ('00000000-0000-0000-0000-000000269607', '00000000-0000-0000-0000-000000269025', '00000000-0000-0000-0000-000000269207', '00000000-0000-0000-0000-000000269301', 'new', '2026-03-04 09:00:00+00');
insert into public.leads (id, agent_id, user_id, status, created_at) values
  ('00000000-0000-0000-0000-000000269605', '00000000-0000-0000-0000-000000269024', '00000000-0000-0000-0000-000000269205', 'new', now()),
  ('00000000-0000-0000-0000-000000269606', '00000000-0000-0000-0000-000000269025', '00000000-0000-0000-0000-000000269206', 'new', now());

-- ── Wrapper RED: jsonb_agg + sentinel de error (ver cabecera) — DESPUÉS de los fixtures pero
--    ANTES de cualquier invocación autorizada; el bloque ACLREAL (más abajo) es la PRIMERA
--    invocación real de la función completa (gotcha 203.1). ─────────────────────────────────────
create or replace function pg_temp.overview_json(p_agency_id uuid)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v
  from public.crm_agency_overview(p_agency_id) t;
  return v;
exception when others then
  return '[{"__error__": true}, {"__error__": true}]'::jsonb;
end $$;

-- pg_temp.field_of: EXACTAMENTE 1 fila que matchee kind+llave, si no '__WRONG_ROW_COUNT__'
-- (texto, NUNCA null) — ver "Anti-vacuo" en la cabecera.
create or replace function pg_temp.field_of(
  p_arr jsonb, p_kind text, p_match_key text, p_match_val text, p_field text
) returns text language sql as $$
  select case when (
      select count(*) from jsonb_array_elements(p_arr) e
      where e ->> 'kind' = p_kind and e ->> p_match_key = p_match_val
    ) = 1
    then (select e ->> p_field from jsonb_array_elements(p_arr) e
          where e ->> 'kind' = p_kind and e ->> p_match_key = p_match_val)
    else '__WRONG_ROW_COUNT__'
  end;
$$;

-- pg_temp.safe_numeric: cast defensivo — el sentinel de texto NO es un numeric válido; en vez
-- de abortar la transacción (lo que 'field_of'::numeric directo haría), devuelve -999999, un
-- valor que NUNCA coincide con un literal real de este fixture.
create or replace function pg_temp.safe_numeric(p_text text)
returns numeric language plpgsql as $$
begin
  return p_text::numeric;
exception when others then
  return -999999::numeric;
end $$;

create or replace function pg_temp.count_kind(p_arr jsonb, p_kind text)
returns int language sql as $$
  select count(*)::int from jsonb_array_elements(p_arr) e where e ->> 'kind' = p_kind;
$$;

create or replace function pg_temp.kind_has_match(p_arr jsonb, p_kind text, p_match_key text, p_match_val text)
returns boolean language sql as $$
  select exists (
    select 1 from jsonb_array_elements(p_arr) e
    where e ->> 'kind' = p_kind and e ->> p_match_key = p_match_val
  );
$$;

-- Cuántas veces aparece una llave dentro de un kind — kind_has_match es ciego a los duplicados
-- (#278 REMOVED2: un join contra 2 filas removed del mismo agente duplicaría el lead).
create or replace function pg_temp.count_match(p_arr jsonb, p_kind text, p_match_key text, p_match_val text)
returns int language sql as $$
  select count(*)::int from jsonb_array_elements(p_arr) e
  where e ->> 'kind' = p_kind and e ->> p_match_key = p_match_val;
$$;

-- Secuencia ORDENADA de un campo, filtrada por kind — usa WITH ORDINALITY + ORDER BY explícito
-- para no depender de que jsonb_agg preserve el orden por casualidad (mismo patrón kind_seq de
-- 103_crm_lead_detail_activity_test.sql): el orden que importa es el que el SUT metió en el
-- array.
create or replace function pg_temp.seq_field(p_arr jsonb, p_kind text, p_field text)
returns jsonb language sql as $$
  select jsonb_agg(elem ->> p_field order by ord)
  from jsonb_array_elements(p_arr) with ordinality as t(elem, ord)
  where elem ->> 'kind' = p_kind;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) CATÁLOGO — firma, atributos, ACL. Seguro aunque no exista.
-- ════════════════════════════════════════════════════════════════════════════

select has_function('public', 'crm_agency_overview', array['uuid'],
  'SIG1_crm_agency_overview_existe_con_la_firma_declarada');

select is(
  (select pg_get_function_result(to_regprocedure('public.crm_agency_overview(uuid)'))),
  'TABLE(kind text, agent_id uuid, agent_name text, lead_id uuid, untouched_count integer, response_hours numeric, avg_temperature integer, flag text, temperature integer, first_contact_at timestamp with time zone, lead_display_name text)',
  'SIG2_crm_agency_overview_returns_table_EXACTA'
);

select is(
  (select pg_get_function_arguments(to_regprocedure('public.crm_agency_overview(uuid)'))),
  'p_agency_id uuid',
  'SIG3_crm_agency_overview_argumentos_EXACTOS'
);

select is(
  (select prosecdef from pg_proc where proname = 'crm_agency_overview' and pronamespace = 'public'::regnamespace),
  true, 'SIG4_crm_agency_overview_es_security_definer'
);

select is(
  (select provolatile from pg_proc where proname = 'crm_agency_overview' and pronamespace = 'public'::regnamespace),
  's', 'SIG5_crm_agency_overview_es_stable'
);

select is(
  (select proconfig from pg_proc where proname = 'crm_agency_overview' and pronamespace = 'public'::regnamespace),
  array['search_path=""']::text[],
  'SIG6_crm_agency_overview_search_path_vacio'
);

select function_privs_are('public', 'crm_agency_overview', array['uuid'], 'anon', array[]::name[],
  'ACL1_crm_agency_overview_anon_SIN_execute');
select function_privs_are('public', 'crm_agency_overview', array['uuid'], 'authenticated', array['EXECUTE']::name[],
  'ACL2_crm_agency_overview_authenticated_CON_execute');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) ACL REAL — anon denegado en su PRIMERA invocación real (gotcha 203.1). SIN wrapper.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select * from public.crm_agency_overview('00000000-0000-0000-0000-000000269301'::uuid) $$,
  '42501', null, 'ACLREAL1_anon_no_puede_ejecutar_crm_agency_overview'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) AUTORIZACIÓN — 0 filas para quien NO es owner/admin ACTIVO de la agencia.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000269003'); -- AGENT_PIERDE, agente raso ACTIVO
select is(
  jsonb_array_length(pg_temp.overview_json('00000000-0000-0000-0000-000000269301')),
  0, 'AUTZ1_agente_raso_0_filas'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000269007'); -- VIEWER ACTIVO
select is(
  jsonb_array_length(pg_temp.overview_json('00000000-0000-0000-0000-000000269301')),
  0, 'AUTZ2_viewer_0_filas'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000269010'); -- OWNER_SUSPENDED
select is(
  jsonb_array_length(pg_temp.overview_json('00000000-0000-0000-0000-000000269301')),
  0, 'AUTZ3_owner_suspendido_0_filas'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000269011'); -- OWNER_OTHER (agencia B)
select is(
  jsonb_array_length(pg_temp.overview_json('00000000-0000-0000-0000-000000269301')),
  0, 'AUTZ4_owner_de_otra_agencia_0_filas'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) HAPPY PATH — OWNER y ADMIN ven el mismo universo: 10 agent rows + 4 unmanaged = 14
--    (#278: +1 agent row READMIT, +2 unmanaged: REMOVED y el lead viejo de REMOVED_X en A).
--    🔴 HAPPY1/HAPPY3/HAPPY4 llevan el literal OBJETIVO (post-fix de FRONTERA_AGENCIA, §13):
--    contra la migración actual (20260906400001, sin el filtro leads.agency_id=p_agency_id) el
--    lead de AGENT_XAGENCY se cuela como unmanaged de más (actual=12/3/12) — mismo hueco que
--    FRONTERA1-3, NO una regresión nueva. HAPPY2 (conteo de agent rows) es inmune al hueco
--    (D-AGENTROWS nunca dependió de leads.agency_id) y sigue en verde. ORDER2 (más abajo, §5)
--    también flipea: el nombre NULL de XAGENCY se intercala entre HOT y COLD.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000269001'); -- OWNER
select is(
  jsonb_array_length(pg_temp.overview_json('00000000-0000-0000-0000-000000269301')),
  14, 'HAPPY1_owner_ve_14_filas_totales'
);
select is(
  pg_temp.count_kind(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent'),
  10, 'HAPPY2_owner_ve_10_agent_rows_OWNER_sin_leads_y_VIEWER_excluidos'
);
select is(
  pg_temp.count_kind(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged'),
  4, 'HAPPY3_owner_ve_4_unmanaged_rows_cerrado_XAGENCY_READMIT_y_lead_B_de_REMOVED_X_excluidos'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000269002'); -- ADMIN
select is(
  jsonb_array_length(pg_temp.overview_json('00000000-0000-0000-0000-000000269301')),
  14, 'HAPPY4_admin_ve_las_mismas_14_filas'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) ORDEN — D-ORDER: agent rows por agent_name ASC (orden NO es por id de inserción, prueba
--    que ordena por nombre real); unmanaged por temperature DESC, lead_id ASC.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000269001'); -- OWNER
select is(
  pg_temp.seq_field(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_name'),
  '["Alfa Pierde", "Beta Zero", "Ceci Transitioned", "Delta Young", "Meso Acum", "Nu Noflag", "Xavier Cross", "Yara Slow", "Zeta Admin", "Zulema Readmit"]'::jsonb,
  'ORDER1_agent_rows_por_agent_name_ASC'
);
select is(
  pg_temp.seq_field(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_display_name'),
  '["Gonzalo Buscador1", "Hilda Buscador2", "Iker Buscador3", "Julia Buscador6"]'::jsonb,
  'ORDER2_unmanaged_por_temperature_DESC_lead_id_ASC'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) FORMA — D-SHAPE: cada kind deja NULL los campos del otro (usa AGENT_NOFLAG y HOT).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000269001'); -- OWNER

select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269009', 'lead_id'),
  null, 'SHAPE1_agent_row_lead_id_NULL'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269009', 'temperature'),
  null, 'SHAPE2_agent_row_temperature_NULL'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269009', 'first_contact_at'),
  null, 'SHAPE3_agent_row_first_contact_at_NULL'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269009', 'lead_display_name'),
  null, 'SHAPE4_agent_row_lead_display_name_NULL'
);

select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_id', '00000000-0000-0000-0000-000000269601', 'agent_id'),
  null, 'SHAPE5_unmanaged_row_agent_id_NULL'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_id', '00000000-0000-0000-0000-000000269601', 'agent_name'),
  null, 'SHAPE6_unmanaged_row_agent_name_NULL'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_id', '00000000-0000-0000-0000-000000269601', 'untouched_count'),
  null, 'SHAPE7_unmanaged_row_untouched_count_NULL'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_id', '00000000-0000-0000-0000-000000269601', 'response_hours'),
  null, 'SHAPE8_unmanaged_row_response_hours_NULL'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_id', '00000000-0000-0000-0000-000000269601', 'avg_temperature'),
  null, 'SHAPE9_unmanaged_row_avg_temperature_NULL'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_id', '00000000-0000-0000-0000-000000269601', 'flag'),
  null, 'SHAPE10_unmanaged_row_flag_NULL'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) MÉTRICAS POR AGENTE (D-UNTOUCHED/D-RESPONSE/D-AVGTEMP/D-FLAG).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000269001'); -- OWNER

-- ADMIN (002): boundary response=24 EXACTO → NO dispara.
select is(
  pg_temp.safe_numeric(pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269002', 'untouched_count')),
  0::numeric, 'ADMIN1_untouched_count_0'
);
select is(
  pg_temp.safe_numeric(pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269002', 'response_hours')),
  24::numeric, 'ADMIN2_response_hours_24_EXACTO_boundary'
);
select is(
  pg_temp.safe_numeric(pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269002', 'avg_temperature')),
  0::numeric, 'ADMIN3_avg_temperature_0_sin_senal'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269002', 'flag'),
  null, 'ADMIN4_flag_NULL_boundary_no_dispara'
);

-- AGENT_PIERDE (003): untouched=3 (dispara) Y stale=5 (también dispara acumula) → pierde_leads
-- MANDA (D-FLAG).
select is(
  pg_temp.safe_numeric(pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269003', 'untouched_count')),
  3::numeric, 'PIERDE1_untouched_count_3_umbral_exacto'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269003', 'response_hours'),
  null, 'PIERDE2_response_hours_NULL_nunca_transiciono_a_contacted'
);
select is(
  pg_temp.safe_numeric(pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269003', 'avg_temperature')),
  0::numeric, 'PIERDE3_avg_temperature_0_sin_senal_en_8_leads'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269003', 'flag'),
  'pierde_leads', 'PIERDE4_flag_pierde_leads_MANDA_sobre_acumula'
);

-- AGENT_ACUM (005): acumula puro (untouched=0, response=NULL, stale=5).
select is(
  pg_temp.safe_numeric(pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269005', 'untouched_count')),
  0::numeric, 'ACUM1_untouched_count_0'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269005', 'response_hours'),
  null, 'ACUM2_response_hours_NULL'
);
select is(
  pg_temp.safe_numeric(pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269005', 'avg_temperature')),
  0::numeric, 'ACUM3_avg_temperature_0'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269005', 'flag'),
  'acumula', 'ACUM4_flag_acumula'
);

-- AGENT_ZERO (006): 0 leads REALES (el borrado no cuenta) → todo NULL/0.
select is(
  pg_temp.safe_numeric(pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269006', 'untouched_count')),
  0::numeric, 'ZERO1_untouched_count_0_el_borrado_no_cuenta'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269006', 'response_hours'),
  null, 'ZERO2_response_hours_NULL'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269006', 'avg_temperature'),
  null, 'ZERO3_avg_temperature_NULL_no_0_leads_es_null_no_0'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269006', 'flag'),
  null, 'ZERO4_flag_NULL_0_leads'
);

-- AGENT_NOFLAG (009): baseline sin flag — untouched=2 (bajo umbral), response=8 (bajo umbral),
-- avg_temperature=10 ((0+0+30)/3).
select is(
  pg_temp.safe_numeric(pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269009', 'untouched_count')),
  2::numeric, 'NOFLAG1_untouched_count_2_bajo_el_umbral'
);
select is(
  pg_temp.safe_numeric(pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269009', 'response_hours')),
  8::numeric, 'NOFLAG2_response_hours_8_bajo_el_umbral'
);
select is(
  pg_temp.safe_numeric(pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269009', 'avg_temperature')),
  10::numeric, 'NOFLAG3_avg_temperature_10_promedio_de_0_0_30'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269009', 'flag'),
  null, 'NOFLAG4_flag_NULL'
);

-- AGENT_SLOW (012): pierde_leads SOLO por respuesta (30h > 24h), untouched=0, sin stale.
select is(
  pg_temp.safe_numeric(pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269012', 'untouched_count')),
  0::numeric, 'SLOW1_untouched_count_0'
);
select is(
  pg_temp.safe_numeric(pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269012', 'response_hours')),
  30::numeric, 'SLOW2_response_hours_30_arriba_del_umbral'
);
select is(
  pg_temp.safe_numeric(pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269012', 'avg_temperature')),
  0::numeric, 'SLOW3_avg_temperature_0'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269012', 'flag'),
  'pierde_leads', 'SLOW4_flag_pierde_leads_solo_por_respuesta'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 8) SIN GESTOR — D-UNMANAGED: mecanismo #203 (agency_members.status='suspended'), leads
--    cerrados excluidos.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000269001'); -- OWNER

select is(
  pg_temp.safe_numeric(pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_id', '00000000-0000-0000-0000-000000269601', 'temperature')),
  30::numeric, 'UNMANAGED_HOT1_temperature_30_con_senal_de_contacto'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_id', '00000000-0000-0000-0000-000000269601', 'first_contact_at'),
  '2026-03-01T09:00:00+00:00', 'UNMANAGED_HOT2_first_contact_at_literal'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_id', '00000000-0000-0000-0000-000000269601', 'lead_display_name'),
  'Gonzalo Buscador1', 'UNMANAGED_HOT3_lead_display_name_del_buscador'
);

select is(
  pg_temp.safe_numeric(pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_id', '00000000-0000-0000-0000-000000269602', 'temperature')),
  0::numeric, 'UNMANAGED_COLD1_temperature_0_sin_senal'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_id', '00000000-0000-0000-0000-000000269602', 'first_contact_at'),
  '2026-03-02T09:00:00+00:00', 'UNMANAGED_COLD2_first_contact_at_literal'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_id', '00000000-0000-0000-0000-000000269602', 'lead_display_name'),
  'Hilda Buscador2', 'UNMANAGED_COLD3_lead_display_name_del_buscador'
);

select is(
  pg_temp.kind_has_match(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_id', '00000000-0000-0000-0000-000000269603'),
  false, 'UNMANAGED_CLOSED1_lead_cerrado_NUNCA_aparece_en_sin_gestor'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 9) CONFIG1 — mutante "sin COALESCE / umbral hardcodeado": cambiar
--    crm_agent_flag_stale_leads_min en vivo cambia el flag de AGENT_ACUM (5 stale < 10 → deja
--    de disparar acumula) sin publicar app.
-- ════════════════════════════════════════════════════════════════════════════

-- app_config solo admite escritura de admin/service_role (RLS) — el INSERT/DELETE corre como
-- superusuario (rol por defecto de este archivo), NUNCA impersonando OWNER (authenticated
-- rasca "permission denied for table app_config" si se intenta, verificado en el RED).
insert into public.app_config (key, value) values ('crm_agent_flag_stale_leads_min', '10'::jsonb);
select pg_temp.act_as('00000000-0000-0000-0000-000000269001'); -- OWNER
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269005', 'flag'),
  null, 'CONFIG1_subir_stale_leads_min_a_10_apaga_acumula_de_AGENT_ACUM'
);
reset role;
delete from public.app_config where key = 'crm_agent_flag_stale_leads_min';
select pg_temp.act_as('00000000-0000-0000-0000-000000269001'); -- OWNER
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269005', 'flag'),
  'acumula', 'CONFIG2_borrar_la_override_regresa_al_default_5_acumula_de_vuelta'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 10) V1 — mutante M6 "incluye viewers": VIEWER (007) tiene 1 lead ABIERTO y AUN ASÍ nunca
--     sale como agent row; HAPPY2 (agent rows) no se infla por él.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000269001'); -- OWNER
select is(
  pg_temp.kind_has_match(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269007'),
  false, 'V1_viewer_con_lead_NUNCA_sale_como_agent_row'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 11) V2 — mutante M23 "stale ignora transición real" + M16 "stale sin edad": ambos casos
--     deben dar flag NULL (ninguno cuenta como stale).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000269001'); -- OWNER
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269013', 'flag'),
  null, 'V2_TRANS_flag_NULL_5_leads_viejos_que_SI_transicionaron_no_son_stale_M23'
);
select is(
  pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269014', 'flag'),
  null, 'V2_YOUNG_flag_NULL_5_leads_sin_transicion_pero_jovenes_no_son_stale_M16'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 12) M13 — mutante "avg_temperature incluye cerrados": AGENT_NOFLAG (009) sigue en 10 pese al
--     lead cerrado con señal caliente (literal calculado a mano, NO recomputado: (0+0+30)/3).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000269001'); -- OWNER
select is(
  pg_temp.safe_numeric(pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269009', 'avg_temperature')),
  10::numeric, 'M13_avg_temperature_excluye_lead_cerrado_con_senal_caliente'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 13) FRONTERA_AGENCIA (§0.5.4, hallazgo del guardian) — D-UNMANAGED/D-METRICS-SCOPE: la RPC
--     debe acotar por leads.agency_id = p_agency_id, replicando la frontera de leads_select.
--     🔴 Esperado EN ROJO contra la migración actual (20260906400001) — es la brecha real.
-- ════════════════════════════════════════════════════════════════════════════

-- Sanity check de la fixture (independiente del SUT — verifica el trigger #203 ya vigente):
-- el lead de AGENT_XAGENCY resuelve agency_id=B (su membresía ACTIVA), NUNCA a la suspendida
-- de A.
select is(
  (select agency_id::text from public.leads where id = '00000000-0000-0000-0000-000000269534'),
  '00000000-0000-0000-0000-000000269302',
  'XAGENCY_SETUP_lead_resuelve_a_agencia_B_via_trigger_203'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000269001'); -- OWNER
select is(
  pg_temp.kind_has_match(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_id', '00000000-0000-0000-0000-000000269534'),
  false, 'FRONTERA1_lead_de_agente_suspendido_en_A_pero_ACTIVO_en_B_NO_es_unmanaged_de_A'
);
select is(
  pg_temp.safe_numeric(pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269021', 'untouched_count')),
  1::numeric, 'FRONTERA2_untouched_count_de_CROSS_cuenta_SOLO_el_lead_de_A'
);
select is(
  pg_temp.safe_numeric(pg_temp.field_of(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269021', 'avg_temperature')),
  0::numeric, 'FRONTERA3_avg_temperature_de_CROSS_cuenta_SOLO_el_lead_de_A_sin_senal'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 14) SIN_GESTOR_RETIRADO (#278 hardening(269.1)) — D-UNMANAGED-REMOVED: un miembro RETIRADO
--     cuenta como suspendido para la banda (decisión de Abraham); semi-join, sin duplicados ni
--     readmitidos. 🔴 REMOVED1 (y HAPPY1/3/4, ORDER2) en rojo contra 20260906400001;
--     REMOVED2/READMIT1 pasan hoy y cazan el fix INGENUO (`am.status in (...)` en el join).
-- ════════════════════════════════════════════════════════════════════════════

-- Sanity check de la fixture (trigger #203 vigente): el lead de AGENT_REMOVED_X resuelve a B
-- (su membresía ACTIVA), nunca a la retirada de A.
select is(
  (select agency_id::text from public.leads where id = '00000000-0000-0000-0000-000000269606'),
  '00000000-0000-0000-0000-000000269302',
  'REMOVED_X_SETUP_lead_de_retirado_en_A_activo_en_B_resuelve_a_B_via_trigger_203'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000269001'); -- OWNER
select is(
  pg_temp.kind_has_match(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_id', '00000000-0000-0000-0000-000000269604'),
  true, 'REMOVED1_lead_abierto_de_agente_RETIRADO_de_A_ES_unmanaged_de_A'
);
select is(
  pg_temp.count_match(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_id', '00000000-0000-0000-0000-000000269604'),
  1, 'REMOVED2_con_2_filas_removed_del_mismo_agente_el_lead_aparece_EXACTAMENTE_1_vez'
);
select is(
  pg_temp.kind_has_match(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_id', '00000000-0000-0000-0000-000000269605'),
  false, 'READMIT1_retirado_y_READMITIDO_en_A_tiene_gestor_su_lead_NO_es_unmanaged'
);
select is(
  pg_temp.kind_has_match(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_id', '00000000-0000-0000-0000-000000269024'),
  true, 'READMIT2_el_readmitido_aparece_como_agent_row'
);
select is(
  pg_temp.kind_has_match(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_id', '00000000-0000-0000-0000-000000269606'),
  false, 'FRONTERA4_lead_de_retirado_en_A_pero_ACTIVO_en_B_NO_es_unmanaged_de_A'
);
-- Mutante e del guardian: si el not-exists mirara 'active' en CUALQUIER agencia, el lead viejo
-- de A de un agente que hoy trabaja en B quedaría huérfano en silencio.
select is(
  pg_temp.kind_has_match(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_id', '00000000-0000-0000-0000-000000269607'),
  true, 'REMOVED_X1_lead_VIEJO_en_A_de_retirado_de_A_activo_en_B_SI_es_unmanaged_de_A'
);
reset role;

select * from finish();
rollback;
