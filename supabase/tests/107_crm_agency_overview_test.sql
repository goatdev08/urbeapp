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
-- D-UNMANAGED: kind='unmanaged' por cada lead (deleted_at is null, status NOT IN closed set)
--   cuyo agent_id sea un agency_member con status='suspended' EN p_agency_id (mecanismo #203,
--   20260904200001) — filtro por agency_members.status, NUNCA por leads.agency_id (ese campo
--   puede arrastrar el mismo fallback a la membresía suspendida, es circular usarlo aquí).
--   temperature = private.crm_temperature(suspended_agent_id, lead.user_id, now()).
--   first_contact_at = leads.first_contact_at (columna existente, sin cómputo).
--   lead_display_name = trim(first_name || ' ' || last_name) del BUSCADOR (users del
--   lead.user_id) — mismo patrón que full_name de crm_leads_page.
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
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(62);

-- ── Helper de impersonación (mismo patrón que 02/.../100/101/102/103/104/106) ───────────────
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '00000000-0000-0000-0000-000000269XXX' (subtarea 269.1).
--   USERS 001-012 (roles fijos) + 101-119 (buscadores del pipeline) + 201-203 (buscadores
--   sin gestor). AGENCIES 301-302. AGENCY_MEMBERS 311-321. PROPERTIES 401 (única, FK de
--   lead_origin_properties). LEADS 501-519 (pipeline) + 601-603 (sin gestor).
--
--   001 OWNER            — owner  ACTIVO agencia A, 0 leads → NO sale como agent row.
--   002 ADMIN             — admin  ACTIVO agencia A, 1 lead → boundary response_hours=24 exacto.
--   003 AGENT_PIERDE      — agent  ACTIVO agencia A, 3 new + 5 in_progress stale → pierde_leads
--                            (untouched Y stale a la vez — prueba que pierde_leads MANDA).
--   005 AGENT_ACUM        — agent  ACTIVO agencia A, 5 contacted stale, 0 untouched → acumula.
--   006 AGENT_ZERO        — agent  ACTIVO agencia A, 0 leads reales (+1 BORRADO, decoy) → todo
--                            NULL/0, prueba deleted_at is null.
--   007 VIEWER            — viewer ACTIVO agencia A → NUNCA sale como agent row.
--   008 AGENT_SUSP        — agent  SUSPENDIDO agencia A → sus leads pasan a 'unmanaged'.
--   009 AGENT_NOFLAG      — agent  ACTIVO agencia A, 2 new + 1 contacted (resp=8h, avgtemp=10)
--                            → baseline sin flag.
--   010 OWNER_SUSPENDED   — owner  SUSPENDIDO agencia A → ACL: 0 filas.
--   011 OWNER_OTHER       — owner  ACTIVO agencia B (ajena) → ACL: 0 filas sobre agencia A.
--   012 AGENT_SLOW        — agent  ACTIVO agencia A, 1 lead resp=30h (>24) → pierde_leads solo
--                            por respuesta (untouched=0, stale=0).
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
  ('00000000-0000-0000-0000-000000269012', 'slow.269e1@test.local');

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-000000269' || i)::uuid, 'u' || i || '.269e1@test.local'
from generate_series(101, 119) as i;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000269201', 'hot.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269202', 'cold.269e1@test.local'),
  ('00000000-0000-0000-0000-000000269203', 'closed.269e1@test.local');

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
  ('00000000-0000-0000-0000-000000269321', '00000000-0000-0000-0000-000000269301', '00000000-0000-0000-0000-000000269012', 'agent',  'active');    -- AGENT_SLOW

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

-- ── AGENT_SUSP (008, suspendido): 2 leads ABIERTOS (HOT con señal → temp=30, COLD sin señal
--    → temp=0) + 1 lead CERRADO (closed_won_rent) que NO debe aparecer en 'unmanaged'. ────────
insert into public.leads (id, agent_id, user_id, status, first_contact_at) values
  ('00000000-0000-0000-0000-000000269601', '00000000-0000-0000-0000-000000269008', '00000000-0000-0000-0000-000000269201', 'new', '2026-03-01 09:00:00+00'),
  ('00000000-0000-0000-0000-000000269602', '00000000-0000-0000-0000-000000269008', '00000000-0000-0000-0000-000000269202', 'new', '2026-03-02 09:00:00+00'),
  ('00000000-0000-0000-0000-000000269603', '00000000-0000-0000-0000-000000269008', '00000000-0000-0000-0000-000000269203', 'closed_won_rent', now());
insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000269801', '00000000-0000-0000-0000-000000269601', '00000000-0000-0000-0000-000000269401', now() - interval '1 hour');

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
-- 4) HAPPY PATH — OWNER y ADMIN ven el mismo universo: 6 agent rows + 2 unmanaged.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000269001'); -- OWNER
select is(
  jsonb_array_length(pg_temp.overview_json('00000000-0000-0000-0000-000000269301')),
  8, 'HAPPY1_owner_ve_8_filas_totales'
);
select is(
  pg_temp.count_kind(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent'),
  6, 'HAPPY2_owner_ve_6_agent_rows_OWNER_sin_leads_excluido'
);
select is(
  pg_temp.count_kind(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged'),
  2, 'HAPPY3_owner_ve_2_unmanaged_rows_el_cerrado_excluido'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000269002'); -- ADMIN
select is(
  jsonb_array_length(pg_temp.overview_json('00000000-0000-0000-0000-000000269301')),
  8, 'HAPPY4_admin_ve_las_mismas_8_filas'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) ORDEN — D-ORDER: agent rows por agent_name ASC (orden NO es por id de inserción, prueba
--    que ordena por nombre real); unmanaged por temperature DESC, lead_id ASC.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000269001'); -- OWNER
select is(
  pg_temp.seq_field(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'agent', 'agent_name'),
  '["Alfa Pierde", "Beta Zero", "Meso Acum", "Nu Noflag", "Yara Slow", "Zeta Admin"]'::jsonb,
  'ORDER1_agent_rows_por_agent_name_ASC'
);
select is(
  pg_temp.seq_field(pg_temp.overview_json('00000000-0000-0000-0000-000000269301'), 'unmanaged', 'lead_display_name'),
  '["Gonzalo Buscador1", "Hilda Buscador2"]'::jsonb,
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

select * from finish();
rollback;
