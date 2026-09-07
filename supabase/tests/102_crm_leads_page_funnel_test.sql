-- Tests pgTAP — public.crm_leads_page + public.crm_funnel (subtarea 266.4, exploración 045
-- §7.4/§12/§14 T-A). Ejecutar con:
--   supabase test db supabase/tests/102_crm_leads_page_funnel_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de una transacción
-- revertida (no persiste). El rol `postgres` de este proyecto NO es superuser real (ver
-- 20260904300001) pero SÍ es dueño de las funciones/tablas — bypassa RLS por ownership y
-- retiene EXECUTE implícito pese al REVOKE FROM public/anon/authenticated, así que las
-- llamadas "autorizadas" de este archivo solo necesitan fijar el claim JWT
-- (`request.jwt.claims`) vía pg_temp.act_as(uid,'authenticated') — el mismo patrón de
-- 02/35/51/62/68/92/100/101 — y SÍ importa para los casos ACL reales (anon) donde además se
-- cambia de rol para que el REVOKE se aplique de verdad.
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAMS bajo prueba (contrato PÚBLICO, comportamiento observable, NUNCA internals):
--   1) public.crm_leads_page(p_agent_id uuid, p_band text, p_cursor jsonb, p_limit int,
--      p_query text, p_status text[], p_follow_up boolean) — firma exacta (7 parámetros,
--      subtarea 271.1: p_status/p_follow_up NUEVOS, ambos DEFAULT NULL), security definer,
--      stable, search_path='', ACL (revoke public/anon, grant authenticated), autorización
--      fail-closed en el cuerpo, cursor keyset INTACTO con as_of congelado (el ORDER BY y la
--      forma del cursor NO cambian, Abraham descartó el selector de orden), filtro p_band,
--      búsqueda p_query en SQL, status_projected 8→4, sparkline int[14], remaining por banda
--      Y por los filtros nuevos (D-REMAINING-FILTRO, punto delicado 1 de la subtarea:
--      p_status/p_follow_up viven en la CTE `matched`, el mismo universo base de
--      `remaining`), p_status filtra por los 4 estados PROYECTADOS (nunca por el enum crudo
--      de 11 valores — punto delicado 2: status_projected sube a la CTE `banded` para poder
--      filtrar por él en `matched` sin duplicar el CASE 8→4 del SELECT final).
--   2) public.crm_funnel(p_agent_id uuid, p_days int) — firma exacta, mismos atributos y
--      ACL, autorización fail-closed idéntica, los 5 KPIs como CONTEOS agregados (nunca
--      filas de no-leads). SIN CAMBIO en esta subtarea (271.1 solo toca crm_leads_page).
-- SUT (crm_leads_page/crm_funnel YA EXISTEN, 20260906100003): esta subtarea 271.1 ensancha
-- SOLO crm_leads_page vía DROP+CREATE en supabase/migrations/_crm_leads_page_filtros.sql
-- (RED 2026-09-07) — stub que declara los 2 parámetros nuevos pero los IGNORA (marcado
-- `-- STUB RED`), para que el RED falle por aserción de filtrado, nunca por firma ausente.
--
-- ── D-STATUSARRAY (subtarea 271.1, decisión del test-author, fija el contrato) ────────────
-- p_status text[] filtra por los 4 valores PROYECTADOS ('nuevo'/'contactado'/'visita'/
-- 'cerrado'), nunca por el enum crudo de 11 valores — el cliente nunca conoce closed_won_*
-- ni los legacy. NULL = sin filtro (D-DEFAULTS ya establecido). Array vacío '{}'::text[] SE
-- DISTINGUE de NULL: significa "cero estados seleccionados" y se resuelve como 0 FILAS (NO
-- como "sin filtro") — semántica SQL natural de `x = ANY('{}')` (siempre falso) y evita que
-- una hoja de filtros con las 4 casillas desmarcadas muestre por error el pipeline completo;
-- quien quiera "sin filtro" pasa NULL explícito, nunca '{}'. Ver STATUSARR6.
-- D-FOLLOWUP (decisión del test-author): p_follow_up boolean filtra por leads.is_follow_up
-- EXACTO (true → solo marcados, false → solo NO marcados); NULL = sin filtro. Ambos filtros
-- (p_status, p_follow_up) entran en la CTE `matched` (mismo punto delicado 1 que p_band) y se
-- combinan por AND entre sí y con p_band/p_query (nunca OR) — ver COMBO1/COMBO2.
--
-- ── Estrategia RED sin depender de "function does not exist" (patrón 100/101, adaptado a
--    funciones SETOF) ───────────────────────────────────────────────────────────────────────
-- TODA llamada real a crm_leads_page/crm_funnel en contexto "autorizado" pasa por un wrapper
-- pg_temp.leads_page_json(...)/pg_temp.funnel_json(...) que agrega las filas a jsonb
-- (jsonb_agg) y atrapa CUALQUIER excepción devolviendo el sentinel
-- '[{"__error__": true}, {"__error__": true}]'::jsonb — un ARRAY de 2 elementos (NUNCA un
-- rompería jsonb_array_elements/jsonb_array_length con "cannot extract/get ... of a
-- jsonb escalar: eso rompería jsonb_array_elements/jsonb_array_length con "cannot
-- extract/get ... of a scalar", abortando la transacción en vez de fallar por aserción; y
-- NUNCA de longitud 1: un jsonb_array_length(...) comparado contra el literal esperado 1
-- (p.ej. AUTZ1/AUTZ3/AUTZ4/QUERY1) pasaría en falso por coincidencia de longitud — verificado
-- empíricamente antes de fijar el sentinel en 2 elementos) — DISTINTO de
-- '[]'::jsonb (resultado legítimo vacío) y de un array con filas reales: cualquier lookup
-- por lead_id/campo no encuentra nada en el marcador (NULL), así que un "function does not
-- exist" se distingue de "0 filas por autorización" en cada assert sin abortar nunca. Los
-- 2 casos ACL de
-- `anon` (ACLREAL) van SIN wrapper, con throws_ok(...,'42501',...) directo — necesitan el
-- error REAL, no el sentinel — y son la PRIMERA invocación real de cada función en el
-- archivo (gotcha 203.1: el EXECUTE se comprueba al planificar y el plan se cachea).
--
-- ── Decisiones de diseño del test-author (el contrato no las fijaba; se deciden aquí y el
--    GREEN debe cumplirlas exactamente — están en la bitácora de la subtarea) ───────────────
-- D-DEFAULTS: crm_leads_page(p_agent_id uuid, p_band text DEFAULT NULL, p_cursor jsonb
--   DEFAULT NULL, p_limit int DEFAULT 20, p_query text DEFAULT NULL) — p_band NULL = todas
--   las bandas. crm_funnel(p_agent_id uuid, p_days int DEFAULT 30) — "el embudo de 30 días"
--   (exploración 045 §6.2). Ancla catalogal: SIG3/SIG3B (pg_get_function_arguments exacto).
-- D-AUTZ: fail-closed en el cuerpo, NUNCA una excepción que distinga "no existe" de "no es
--   tuyo" (anti-IDOR, molde ad_metrics_for_agency/get_lead_stats): autorizado ⟺
--   p_agent_id = auth.uid() ∨ (private.agency_role_of(agencia ACTIVA del AGENTE objetivo vía
--   agency_members) IN ('owner','admin')). "Agencia ACTIVA del agente objetivo" se resuelve
--   por agency_members.status='active' del PROPIO p_agent_id — NUNCA por leads.agency_id
--   (ese campo puede tener el fallback a la membresía suspendida de #203.1, que es una regla
--   de OTRA policy, no de esta RPC). Sin autorización: 0 filas / 0 conteos, nunca excepción.
-- D-TIEBREAK: ORDER BY temperature DESC, lead_id ASC. Predicado del cursor keyset:
--   (temperature < cursor.temperature) OR (temperature = cursor.temperature AND
--   lead_id > cursor.lead_id).
-- D-NEXTCURSOR: mismo valor {as_of, temperature, lead_id} repetido en CADA fila de la
--   página (la llave de la ÚLTIMA fila devuelta + el as_of congelado); NULL en todas las
--   filas cuando la página es la ÚLTIMA (no quedan filas después del keyset de la última
--   fila devuelta).
-- D-REMAINING: total de leads que matchean (banda + p_query) para el agente, MENOS los ya
--   consumidos hasta el final de ESTA página (incluida). 0 en la última página.
-- D-ASOF: as_of = coalesce((p_cursor->>'as_of')::timestamptz, now()) — se congela dentro de
--   next_cursor; si se pasa un p_cursor con as_of explícito, la temperatura de ESA página se
--   calcula con ese as_of, nunca con now() real (permite reproducibilidad entre páginas
--   aunque el reloj avance). Probado con un as_of manual muy alejado del "ahora" real de la
--   corrida (ASOF1) — si el SUT ignorara el as_of congelado y usara now(), el resultado sería
--   drásticamente distinto (decaimiento de ~234 días vs. 1 día), literal verificado
--   independiente (Decimal, no la misma expresión SQL — ver DECAY1 en 100_, mismos defaults
--   crm_weight_contact_first=30/crm_decay_daily=0.08: 30·0.92¹=27.60→28).
-- D-STATUSPROJ: los 4 tokens de salida son 'nuevo'/'contactado'/'visita'/'cerrado' (ASCII,
--   minúsculas, sin acentos) — mapeo exacto exploración 045 §7.4 sobre los 11 valores del
--   enum lead_status (incluidos los 3 legacy: new, in_progress, closed_won).
-- D-FUNNEL-WINDOW: ventana = campo_de_tiempo >= now() - (p_days || ' days')::interval,
--   frontera INFERIOR INCLUSIVA (molde purge_ad_impressions/ad_metrics), sin límite
--   superior (= ahora). Aplica a events_raw.created_at (vieron/volvieron), saves.created_at
--   (guardaron), leads.created_at (contactaron) y lead_status_history.changed_at
--   (agendaron).
-- D-VOLVIERON: distinct user_id con >= 2 session_id DISTINTOS en video_view dentro de la
--   ventana (2 eventos en la MISMA sesión no cuentan como "volvió").
-- D-AGENDARON: distinct lead_id (no count(*)) con una fila en lead_status_history cuyo
--   new_status='visit_scheduled' y changed_at dentro de la ventana — reprogramar 2 veces el
--   MISMO lead no infla el KPI.
-- D-QUERY: ilike sobre first_name || ' ' || last_name (users del lead), case-insensitive,
--   parcial; NULL o '' = sin filtro (ambos deben comportarse IGUAL, EDGE del testStrategy).
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ─────────────────────────────────
-- Happy path: firma+ACL de catálogo de AMBAS funciones (SIG/ACL), invocación real de anon
--   denegada en su PRIMERA llamada (ACLREAL, 203.1), autorización básica agente-dueño
--   (AUTZ1/FUNAUTZ1).
-- Edge cases del PRD/exploración 045 (§7.4/§12/§14): status_projected 8→4 con los 11 valores
--   reales incluidos los 3 legacy (STATUS1-11), sparkline int[14] con huecos NULL
--   (SPARK1), cursor keyset recorre 25 leads sin repetir ni omitir con desempate por lead_id
--   (PAG1-11), remaining por banda (embebido en PAG*), p_band filtra (BAND1-3), p_query
--   filtra por nombre case-insensitive/parcial y NULL/''=sin filtro (QUERY1-4), funnel con un
--   caso por KPI + frontera de ventana inclusiva (FUN1-5).
-- Ramas de reglas no obvias: as_of congelado sobrevive aunque el reloj real avance
--   (ASOF1-2), "mis X" filtra EXPLÍCITO por p_agent_id — un agente ajeno o un admin de
--   plataforma NUNCA ven el pipeline de otro por relajación de RLS (AUTZ2-6, #226/77).
-- Boundary/error: p_agent_id que NO EXISTE en absoluto (ni en users ni en agency_members) →
--   0 filas/0 conteos, nunca excepción (BOUNDARY1-2); anon denegado con 42501 real
--   (ACLREAL1-2).
-- Fuera de alcance de este archivo (documentado, NO asumido): EXPLAIN sin Seq Scan y timing
--   < 300 ms con el seed de 266.1 — con el fixture pequeño de un pgTAP el planner elige Seq
--   Scan de todas formas (tablas de pocas filas); un assert pgTAP sobre el plan sería frágil
--   por construcción. Queda para medición MANUAL con el seed de volumen de 266.1 y se pega
--   en la bitácora del GREEN, no aquí (instrucción explícita del orquestador).
--
-- ── Extensión subtarea 271.1 (RED 2026-09-07): p_status/p_follow_up ─────────────────────────
-- Happy path: p_status NULL no filtra (STATUSARR0, reusa sta_all — mismo total 19 que sin el
--   parámetro). Edge cases del PRD/exploración 045 §19 (tarea G, "hoja completa de filtros"):
--   cada uno de los 4 proyectados devuelve EXACTAMENTE sus leads (STATUSARR1-4, incluidos los
--   tramos ambiguos contactado=contacted∪interested∪in_progress y cerrado=4 vigentes+legacy),
--   array con 2 estados sin duplicados (STATUSARR5), array vacío=0 filas por D-STATUSARRAY
--   (STATUSARR6), p_follow_up true/false/null (FOLLOW1-3, agente aislado AGFOLLOW). Ramas no
--   obvias: combinación p_status+p_band+p_query simultánea por AND, nunca OR (COMBO1-2);
--   remaining/next_cursor correctos CON filtro aplicado — universo de `matched` YA filtrado
--   por p_status, paginado hasta agotar (FILTPAG1-8, agente aislado AGFILT, punto delicado 1);
--   autorización fail-closed NO se salta por traer filtros nuevos (AUTZFILT1, agente ajeno).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(94);

-- ── Helper de impersonación (mismo patrón que 02/08/.../35/62/100/101_*) ────────────────────
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── Wrappers RED: jsonb_agg + sentinel de error (ver cabecera) ──────────────────────────────
-- p_status/p_follow_up (subtarea 271.1) con DEFAULT NULL al final: las llamadas existentes de
-- 5 argumentos posicionales (secciones 4-11, ya escritas) siguen compilando sin tocarlas.
create or replace function pg_temp.leads_page_json(
  p_agent_id uuid, p_band text, p_cursor jsonb, p_limit int, p_query text,
  p_status text[] default null, p_follow_up boolean default null
) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v
  from public.crm_leads_page(p_agent_id, p_band, p_cursor, p_limit, p_query, p_status, p_follow_up) t;
  return v;
exception when others then
  return '[{"__error__": true}, {"__error__": true}]'::jsonb;
end $$;

create or replace function pg_temp.funnel_json(p_agent_id uuid, p_days int)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v
  from public.crm_funnel(p_agent_id, p_days) t;
  return v;
exception when others then
  return '[{"__error__": true}, {"__error__": true}]'::jsonb;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '00000000-0000-0000-0000-000000266XXX' (subtarea 266.4).
--   USERS   001-030 (roles fijos, incluye AGP=028, AGSUSP=029, USUSP=030) + 101-125 (PAG,
--           paginación) + 201-211 (STA, status_projected)
--   AGENCIES 301-302 · AGENCY_MEMBERS 311-316 (316=AGSUSP, suspended) · PROPERTIES 401-402
--   LEADS   501 (L1) + 600-624 (LPAG, agente AGP) + 650-660 (LSTA) +
--           571-577 (ASOF/BAND/QUERY/SPARK) + 581-585 (funnel: contactaron/agendaron) +
--           591 (LSUSP, agente AGSUSP)
--   LEAD_ORIGIN_PROPERTIES 701-785 (una por lead) + 791 (LSUSP)
--
-- 🟡 D-FIXTURE-AISLAMIENTO (corrección post-GREEN, árbitro): la sección §6 (cursor keyset)
-- necesita que el universo SIN FILTRO (p_band=null, p_query=null) de su agente sean
-- EXACTAMENTE los 25 LPAG. Reusar AG1 para eso rompía la aislación: AG1 acumula, en OTRAS
-- secciones de este MISMO archivo, más leads activos (L1, LSTA01-11, LASOF/LBANDHOT/
-- LBANDSIL/LQ_*/LSPARK) cuyas temperaturas (vía private.crm_temperature, ya validada por
-- 100_crm_temperature_test.sql) caen LEGÍTIMAMENTE dentro del mismo rango [0,31] que las 25
-- LPAG — confirmado con un dump propio `ORDER BY temperature DESC, lead_id ASC` contra el
-- GREEN aplicado: 44 filas para AG1 sin filtro, no 25 (p.ej. LSTA01-11 y LPAG i=2 empatan en
-- 25). Por eso §6 usa un agente AISLADO, AGP (...266028, SIN otros leads en el archivo), y
-- LPAG01-25 pasan a ser SUYOS (agent_id=AGP) — la propiedad de origen (P1, de AG1) no cambia:
-- el CTE de "contacts" de private.crm_temperature no filtra por dueño de la propiedad, solo
-- por el lead ACTIVO, así que las 25 temperaturas literales (D-ASOF) quedan IDÉNTICAS.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266001', 'ag1.266p4@test.local'),   -- AG1
  ('00000000-0000-0000-0000-000000266002', 'u1.266p4@test.local'),    -- U1 (Ana Martinez, L1)
  ('00000000-0000-0000-0000-000000266003', 'ag2.266p4@test.local'),   -- AG2 (ajeno)
  ('00000000-0000-0000-0000-000000266004', 'own.266p4@test.local'),   -- OWN (agencia1)
  ('00000000-0000-0000-0000-000000266005', 'adm.266p4@test.local'),   -- ADM (agencia1)
  ('00000000-0000-0000-0000-000000266006', 'padmin.266p4@test.local'),-- PADMIN (plataforma)
  ('00000000-0000-0000-0000-000000266007', 'own2.266p4@test.local'),  -- OWN2 (agencia2, ajena)
  ('00000000-0000-0000-0000-000000266008', 'maria.266p4@test.local'), -- MARIA (query)
  ('00000000-0000-0000-0000-000000266009', 'mario.266p4@test.local'), -- MARIO (query)
  ('00000000-0000-0000-0000-000000266010', 'carlos.266p4@test.local'),-- CARLOS (query)
  ('00000000-0000-0000-0000-000000266011', 'asofu.266p4@test.local'), -- ASOFU
  ('00000000-0000-0000-0000-000000266012', 'bandhot.266p4@test.local'), -- BANDHOTU
  ('00000000-0000-0000-0000-000000266013', 'bandsil.266p4@test.local'),-- BANDSILU
  ('00000000-0000-0000-0000-000000266014', 'sparku.266p4@test.local'),-- SPARKU
  ('00000000-0000-0000-0000-000000266015', 'agf.266p4@test.local'),   -- AGF (agente del funnel)
  ('00000000-0000-0000-0000-000000266016', 'fun01.266p4@test.local'), -- FUN01 (vieron+volvieron)
  ('00000000-0000-0000-0000-000000266017', 'fun02.266p4@test.local'), -- FUN02 (vieron, 1 sesión)
  ('00000000-0000-0000-0000-000000266018', 'fun03.266p4@test.local'), -- FUN03 (vieron, 1 evento)
  ('00000000-0000-0000-0000-000000266019', 'fun04.266p4@test.local'), -- FUN04 (fuera de ventana)
  ('00000000-0000-0000-0000-000000266020', 'fun05.266p4@test.local'), -- FUN05 (guardaron)
  ('00000000-0000-0000-0000-000000266021', 'fun06.266p4@test.local'), -- FUN06 (guardaron)
  ('00000000-0000-0000-0000-000000266022', 'fun07.266p4@test.local'), -- FUN07 (guardó, fuera ventana)
  ('00000000-0000-0000-0000-000000266023', 'funcin.266p4@test.local'),-- FUNCONTACT_IN_U
  ('00000000-0000-0000-0000-000000266024', 'funcb.266p4@test.local'), -- FUNCONTACT_BOUNDARY_U
  ('00000000-0000-0000-0000-000000266025', 'funco.266p4@test.local'), -- FUNCONTACT_OUT_U
  ('00000000-0000-0000-0000-000000266026', 'funain.266p4@test.local'),-- FUNAGENDA_IN_U
  ('00000000-0000-0000-0000-000000266027', 'funao.266p4@test.local'), -- FUNAGENDA_OUT_U
  ('00000000-0000-0000-0000-000000266028', 'agp.266p4@test.local');   -- AGP (agente AISLADO, solo paginación)

-- PAG01..PAG25 (paginación) y STA01..STA11 (status_projected), generados.
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-000000266' || i)::uuid, 'pag' || i || '.266p4@test.local'
from generate_series(101, 125) as i;

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-000000266' || i)::uuid, 'sta' || i || '.266p4@test.local'
from generate_series(201, 211) as i;

update public.users set role = 'agent', is_verified_agent = true
  where id in ('00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266003',
               '00000000-0000-0000-0000-000000266015', '00000000-0000-0000-0000-000000266028');
update public.users set role = 'admin'
  where id = '00000000-0000-0000-0000-000000266006'; -- PADMIN

update public.users set first_name = 'Ana', last_name = 'Martinez'
  where id = '00000000-0000-0000-0000-000000266002'; -- U1
update public.users set first_name = 'Maria', last_name = 'Lopez'
  where id = '00000000-0000-0000-0000-000000266008'; -- MARIA
update public.users set first_name = 'Mario', last_name = 'Gomez'
  where id = '00000000-0000-0000-0000-000000266009'; -- MARIO
update public.users set first_name = 'Carlos', last_name = 'Ruiz'
  where id = '00000000-0000-0000-0000-000000266010'; -- CARLOS

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000266301', 'Inmobiliaria CRM Page 266', 'inmo-crm-page-266',
   'active', '00000000-0000-0000-0000-000000266004'),
  ('00000000-0000-0000-0000-000000266302', 'Inmobiliaria CRM Page Ajena 266', 'inmo-crm-page-ajena-266',
   'active', '00000000-0000-0000-0000-000000266007');

insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000266311', '00000000-0000-0000-0000-000000266301', '00000000-0000-0000-0000-000000266004', 'owner', 'active'), -- OWN
  ('00000000-0000-0000-0000-000000266312', '00000000-0000-0000-0000-000000266301', '00000000-0000-0000-0000-000000266005', 'admin', 'active'), -- ADM
  ('00000000-0000-0000-0000-000000266313', '00000000-0000-0000-0000-000000266301', '00000000-0000-0000-0000-000000266001', 'agent', 'active'), -- AG1
  ('00000000-0000-0000-0000-000000266314', '00000000-0000-0000-0000-000000266302', '00000000-0000-0000-0000-000000266007', 'owner', 'active'), -- OWN2
  ('00000000-0000-0000-0000-000000266315', '00000000-0000-0000-0000-000000266301', '00000000-0000-0000-0000-000000266015', 'agent', 'active'); -- AGF

insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000266401', '00000000-0000-0000-0000-000000266001',
   '00000000-0000-0000-0000-000000266301', 'departamento', 'rent', 'Fixture 266.4 — P1 (de AG1)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-000000266402', '00000000-0000-0000-0000-000000266015',
   '00000000-0000-0000-0000-000000266301', 'departamento', 'rent', 'Fixture 266.4 — PF (de AGF, funnel)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography, 9000, 'active');

-- ── L1 (autorización) ───────────────────────────────────────────────────────────────────────
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000266501', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266002', 'contacted');
insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000266701', '00000000-0000-0000-0000-000000266501', '00000000-0000-0000-0000-000000266401', now() - interval '3 days');

-- ── LPAG01..LPAG25 (cursor keyset) — agente AISLADO AGP (D-FIXTURE-AISLAMIENTO, cabecera de
--    Fixtures), contacted_at = now() - i días (i=0..24), un signal "piso de entrada" cada
--    uno; temperaturas literales (Decimal, independiente de la SQL):
--    [30,28,25,23,21,20,18,17,15,14,13,12,11,10,9,9,8,7,7,6,6,5,5,4,4] (ver cabecera D-ASOF).
insert into public.leads (id, agent_id, user_id, status)
select ('00000000-0000-0000-0000-000000266' || (600 + (u - 101)))::uuid,
       '00000000-0000-0000-0000-000000266028',
       ('00000000-0000-0000-0000-000000266' || u)::uuid,
       'new'
from generate_series(101, 125) as u;

insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at)
select ('00000000-0000-0000-0000-000000266' || (800 + (u - 101)))::uuid,
       ('00000000-0000-0000-0000-000000266' || (600 + (u - 101)))::uuid,
       '00000000-0000-0000-0000-000000266401',
       now() - ((u - 101) || ' days')::interval
from generate_series(101, 125) as u;

-- ── LSTA01..LSTA11 (status_projected 8→4, exploración 045 §7.4) ─────────────────────────────
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000266650', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266201', 'new'),
  ('00000000-0000-0000-0000-000000266651', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266202', 'whatsapp_opened'),
  ('00000000-0000-0000-0000-000000266652', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266203', 'contacted'),
  ('00000000-0000-0000-0000-000000266653', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266204', 'interested'),
  ('00000000-0000-0000-0000-000000266654', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266205', 'in_progress'),
  ('00000000-0000-0000-0000-000000266655', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266206', 'visit_scheduled'),
  ('00000000-0000-0000-0000-000000266656', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266207', 'closed_won_rent'),
  ('00000000-0000-0000-0000-000000266657', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266208', 'closed_won_sale'),
  ('00000000-0000-0000-0000-000000266658', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266209', 'closed_lost'),
  ('00000000-0000-0000-0000-000000266659', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266210', 'discarded'),
  ('00000000-0000-0000-0000-000000266660', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266211', 'closed_won');

insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at)
select ('00000000-0000-0000-0000-000000266' || (750 + (l - 650)))::uuid,
       ('00000000-0000-0000-0000-000000266' || l)::uuid,
       '00000000-0000-0000-0000-000000266401',
       now() - interval '2 days'
from generate_series(650, 660) as l;

-- ── LASOF (as_of congelado), LBANDHOT/LBANDSIL (banda), LQ_* (búsqueda), LSPARK (sparkline)
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000266571', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266011', 'new'),   -- LASOF
  ('00000000-0000-0000-0000-000000266572', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266012', 'new'),   -- LBANDHOT
  ('00000000-0000-0000-0000-000000266573', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266013', 'new'),   -- LBANDSIL
  ('00000000-0000-0000-0000-000000266574', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266008', 'new'),   -- LQ_MARIA
  ('00000000-0000-0000-0000-000000266575', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266009', 'new'),   -- LQ_MARIO
  ('00000000-0000-0000-0000-000000266576', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266010', 'new'),   -- LQ_CARLOS
  ('00000000-0000-0000-0000-000000266577', '00000000-0000-0000-0000-000000266001', '00000000-0000-0000-0000-000000266014', 'new');   -- LSPARK

insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000266771', '00000000-0000-0000-0000-000000266571', '00000000-0000-0000-0000-000000266401', '2026-01-14 12:00:00+00'), -- LASOF: 1 día antes del as_of congelado
  ('00000000-0000-0000-0000-000000266772', '00000000-0000-0000-0000-000000266572', '00000000-0000-0000-0000-000000266401', now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000266773', '00000000-0000-0000-0000-000000266573', '00000000-0000-0000-0000-000000266401', now() - interval '10 days'),
  ('00000000-0000-0000-0000-000000266774', '00000000-0000-0000-0000-000000266574', '00000000-0000-0000-0000-000000266401', now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000266775', '00000000-0000-0000-0000-000000266575', '00000000-0000-0000-0000-000000266401', now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000266776', '00000000-0000-0000-0000-000000266576', '00000000-0000-0000-0000-000000266401', now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000266777', '00000000-0000-0000-0000-000000266577', '00000000-0000-0000-0000-000000266401', now() - interval '10 days');

-- LBANDHOT: señal fuerte reciente (save, hace 1 hora) — sube temp Y cae dentro de
-- crm_band_strong_signal_hours (default 24h), sin cambio de estado posterior (nunca se
-- actualiza el status tras crearse) => 'hot'. LBANDSIL: solo el contacto viejo, sin señal
-- nueva, nunca superó el umbral de 80 => 'silent'.
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266012', '00000000-0000-0000-0000-000000266401', now() - interval '1 hour');

-- ── LSPARK — lead_temperature_daily con huecos NULL, as_of congelado '2026-01-15T12:00Z' =>
--    ventana [2026-01-02 .. 2026-01-15]. Filas sembradas: 01-02=10, 01-05=20, 01-15=45; el
--    resto de los 14 días queda SIN fila (NULL). Sembrado directo como dueño de tabla
--    (fixture, no pasa por snapshot_lead_temperature — esa función es de 266.3).
insert into public.lead_temperature_daily (lead_id, day, temperature, signals) values
  ('00000000-0000-0000-0000-000000266577', '2026-01-02'::date, 10, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000266577', '2026-01-05'::date, 20, '{}'::jsonb),
  ('00000000-0000-0000-0000-000000266577', '2026-01-15'::date, 45, '{}'::jsonb);

-- ── Fixture del funnel — agente AISLADO (AGF/PF), para que sus KPIs no se contaminen con
--    los eventos/leads de AG1 usados en el resto del archivo. ───────────────────────────────
-- vieron: FUN01/02/03 con actividad DENTRO de la ventana (30 días); FUN04 FUERA (40 días) no
-- cuenta. volvieron: SOLO FUN01 tiene 2 session_id DISTINTOS (D-VOLVIERON); FUN02 repite la
-- MISMA sesión (no cuenta); FUN03 solo 1 evento (no cuenta).
insert into public.events_raw (event_type, user_id, property_id, session_id, created_at, payload) values
  ('video_view', '00000000-0000-0000-0000-000000266016', '00000000-0000-0000-0000-000000266402', '00000000-0000-0000-0000-000000266901', now() - interval '2 days', '{}'::jsonb),
  ('video_view', '00000000-0000-0000-0000-000000266016', '00000000-0000-0000-0000-000000266402', '00000000-0000-0000-0000-000000266902', now() - interval '1 days', '{}'::jsonb),
  ('video_view', '00000000-0000-0000-0000-000000266017', '00000000-0000-0000-0000-000000266402', '00000000-0000-0000-0000-000000266903', now() - interval '2 days', '{}'::jsonb),
  ('video_view', '00000000-0000-0000-0000-000000266017', '00000000-0000-0000-0000-000000266402', '00000000-0000-0000-0000-000000266903', now() - interval '1 days', '{}'::jsonb),
  ('video_view', '00000000-0000-0000-0000-000000266018', '00000000-0000-0000-0000-000000266402', '00000000-0000-0000-0000-000000266904', now() - interval '2 days', '{}'::jsonb),
  ('video_view', '00000000-0000-0000-0000-000000266019', '00000000-0000-0000-0000-000000266402', '00000000-0000-0000-0000-000000266905', now() - interval '40 days', '{}'::jsonb);

-- guardaron: FUN05/06 dentro de la ventana; FUN07 fuera (41 días).
insert into public.saves (user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266020', '00000000-0000-0000-0000-000000266402', now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000266021', '00000000-0000-0000-0000-000000266402', now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000266022', '00000000-0000-0000-0000-000000266402', now() - interval '41 days');

-- contactaron: creado dentro (5 días), justo en la frontera (30 días, INCLUSIVA) y fuera
-- (40 días).
insert into public.leads (id, agent_id, user_id, status, created_at) values
  ('00000000-0000-0000-0000-000000266581', '00000000-0000-0000-0000-000000266015', '00000000-0000-0000-0000-000000266023', 'new', now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000266582', '00000000-0000-0000-0000-000000266015', '00000000-0000-0000-0000-000000266024', 'new', now() - interval '30 days'),
  ('00000000-0000-0000-0000-000000266583', '00000000-0000-0000-0000-000000266015', '00000000-0000-0000-0000-000000266025', 'new', now() - interval '40 days');
insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000266781', '00000000-0000-0000-0000-000000266581', '00000000-0000-0000-0000-000000266402', now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000266782', '00000000-0000-0000-0000-000000266582', '00000000-0000-0000-0000-000000266402', now() - interval '30 days'),
  ('00000000-0000-0000-0000-000000266783', '00000000-0000-0000-0000-000000266583', '00000000-0000-0000-0000-000000266402', now() - interval '40 days');

-- agendaron: LFUN_AGENDA_IN transicionó a visit_scheduled hace 2 días (dentro); LFUN_AGENDA_OUT
-- hace 40 días (fuera). Se inserta DIRECTO en lead_status_history (fixture, no vía trigger)
-- para controlar changed_at con precisión — el trigger de creación del lead deja además su
-- propia fila new_status='new' (irrelevante para este KPI, se ignora por el filtro).
-- 🟡 created_at EXPLÍCITO en 40 días (corrección post-GREEN, árbitro): sin esto, el default
-- now() cae DENTRO de la ventana de 30 días de "contactaron" (D-FUNNEL-WINDOW usa
-- leads.created_at, no lead_origin_properties.contacted_at) y ambos leads se sumarían
-- también a contactaron (4 en vez de 2) — confirmado con un dump propio de
-- public.leads/lead_status_history contra el GREEN aplicado. contacted_at (independiente,
-- en lead_origin_properties abajo) NO cambia.
insert into public.leads (id, agent_id, user_id, status, created_at) values
  ('00000000-0000-0000-0000-000000266584', '00000000-0000-0000-0000-000000266015', '00000000-0000-0000-0000-000000266026', 'new', now() - interval '40 days'),
  ('00000000-0000-0000-0000-000000266585', '00000000-0000-0000-0000-000000266015', '00000000-0000-0000-0000-000000266027', 'new', now() - interval '40 days');
insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000266784', '00000000-0000-0000-0000-000000266584', '00000000-0000-0000-0000-000000266402', now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000266785', '00000000-0000-0000-0000-000000266585', '00000000-0000-0000-0000-000000266402', now() - interval '5 days');
insert into public.lead_status_history (lead_id, old_status, new_status, changed_by, changed_at) values
  ('00000000-0000-0000-0000-000000266584', 'new', 'visit_scheduled', '00000000-0000-0000-0000-000000266015', now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000266585', 'new', 'visit_scheduled', '00000000-0000-0000-0000-000000266015', now() - interval '40 days');

-- 🟡 M10 (endurecimiento post-guardian, mutante `count(distinct lead_id)`→`count(*)`
-- superviviente): SEGUNDA fila `visit_scheduled` para el MISMO lead (584, ya cuenta arriba
-- dentro de la ventana), simulando "se reprogramó 2 veces la misma cita" — D-AGENDARON dice
-- explícito que esto NO debe inflar el KPI. Con `count(distinct lead_id)` agendaron sigue en
-- 1 (FUN5/FUN6 abajo); con el mutante `count(*)` subiría a 2.
insert into public.lead_status_history (lead_id, old_status, new_status, changed_by, changed_at) values
  ('00000000-0000-0000-0000-000000266584', 'visit_scheduled', 'visit_scheduled', '00000000-0000-0000-0000-000000266015', now() - interval '1 days');

-- 🟡 M22 (endurecimiento post-guardian, mutante que quita `am.status = 'active'` del helper
-- `private.can_manage_agent_pipeline` superviviente — gotcha 203.1, fallback a membresía
-- SUSPENDIDA vía leads.agency_id de #203.1/20260904200001 NO aplica aquí: esta RPC resuelve
-- la agencia del AGENTE OBJETIVO por agency_members, nunca por leads.agency_id). AGSUSP es
-- agente en AGENCY1 (misma agencia de OWN) pero su ÚNICA fila de membresía está
-- `suspended` — sin fila `active`. Con el helper CORRECTO, `agency_role_of(NULL)` (la
-- subquery no matchea nada) da NULL → coalesce a false → OWN NO ve el pipeline de AGSUSP.
-- Con el mutante (sin el filtro de status), la subquery SÍ devolvería AGENCY1 aunque la fila
-- sea `suspended`, y OWN (owner ACTIVO real de AGENCY1) quedaría autorizado por error.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266029', 'agsusp.266p4@test.local'), -- AGSUSP (agente, membresía SUSPENDIDA)
  ('00000000-0000-0000-0000-000000266030', 'ususp.266p4@test.local');  -- USUSP (buscador de LSUSP)
update public.users set role = 'agent' where id = '00000000-0000-0000-0000-000000266029';
insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000266316', '00000000-0000-0000-0000-000000266301', '00000000-0000-0000-0000-000000266029', 'agent', 'suspended');
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000266591', '00000000-0000-0000-0000-000000266029', '00000000-0000-0000-0000-000000266030', 'new');
insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000266791', '00000000-0000-0000-0000-000000266591', '00000000-0000-0000-0000-000000266401', now() - interval '3 days');

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — subtarea 271.1 (p_status/p_follow_up). Agentes AISLADOS (mismo criterio
-- D-FIXTURE-AISLAMIENTO de arriba: sus universos SIN filtro deben ser un conteo exacto y
-- conocido, sin contaminarse con los leads de AG1 usados en el resto del archivo).
--
-- AGFOLLOW (...266031) — 2 leads, is_follow_up true/false EXPLÍCITO (columna boolean not
-- null default false, migración 20260807000003).
-- AGFILT (...266034) — 12 leads FILT00..FILT11, agente aislado para D-REMAINING-FILTRO
-- (punto delicado 1): contacted_at = now() - i días (i=0..11), MISMO patrón que LPAG (mismo
-- tipo de señal única de "contacto"), reusando la progresión de temperatura YA verificada en
-- la cabecera de la sección 6 (LPAG): i=0..11 -> temp [30,28,25,23,21,20,18,17,15,14,13,12].
-- Estado alternado: i PAR (0,2,4,6,8,10) = 'new' (nuevo); i IMPAR (1,3,5,7,9,11) =
-- 'visit_scheduled' (visita) — el subconjunto 'nuevo' filtrado (6 leads) queda YA ordenado
-- descendente por temperatura sin empates (30,25,21,18,15,13), así FILTPAG* no depende de
-- desempate por lead_id.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266031', 'agfollow.266p4@test.local'), -- AGFOLLOW (agente aislado)
  ('00000000-0000-0000-0000-000000266032', 'followtrue.266p4@test.local'), -- FOLLOWU_TRUE
  ('00000000-0000-0000-0000-000000266033', 'followfalse.266p4@test.local'), -- FOLLOWU_FALSE
  ('00000000-0000-0000-0000-000000266034', 'agfilt.266p4@test.local'); -- AGFILT (agente aislado)
update public.users set role = 'agent', is_verified_agent = true
  where id in ('00000000-0000-0000-0000-000000266031', '00000000-0000-0000-0000-000000266034');

insert into public.leads (id, agent_id, user_id, status, is_follow_up) values
  ('00000000-0000-0000-0000-000000266578', '00000000-0000-0000-0000-000000266031', '00000000-0000-0000-0000-000000266032', 'new', true),  -- LFOLLOW_TRUE
  ('00000000-0000-0000-0000-000000266579', '00000000-0000-0000-0000-000000266031', '00000000-0000-0000-0000-000000266033', 'new', false); -- LFOLLOW_FALSE (explícito, aunque coincide con el default)
insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000266786', '00000000-0000-0000-0000-000000266578', '00000000-0000-0000-0000-000000266401', now() - interval '4 days'),
  ('00000000-0000-0000-0000-000000266787', '00000000-0000-0000-0000-000000266579', '00000000-0000-0000-0000-000000266401', now() - interval '4 days');

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-000000266' || (126 + i))::uuid, 'filt' || i || '.266p4@test.local'
from generate_series(0, 11) as i;

insert into public.leads (id, agent_id, user_id, status)
select ('00000000-0000-0000-0000-000000266' || (625 + i))::uuid,
       '00000000-0000-0000-0000-000000266034',
       ('00000000-0000-0000-0000-000000266' || (126 + i))::uuid,
       (case when i % 2 = 0 then 'new' else 'visit_scheduled' end)::lead_status
from generate_series(0, 11) as i;

insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at)
select ('00000000-0000-0000-0000-000000266' || (825 + i))::uuid,
       ('00000000-0000-0000-0000-000000266' || (625 + i))::uuid,
       '00000000-0000-0000-0000-000000266401',
       now() - (i || ' days')::interval
from generate_series(0, 11) as i;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) CATÁLOGO — public.crm_leads_page (firma, atributos, ACL). Seguro aunque no exista:
--    has_function/pg_get_function_*/function_privs_are resuelven "not ok" sin lanzar.
-- ════════════════════════════════════════════════════════════════════════════

-- SIG1/2/3/ACL1/2 actualizados a la firma de 7 parámetros (subtarea 271.1: p_status/
-- p_follow_up NUEVOS, ambos al final con DEFAULT NULL — D-DEFAULTS). DROP+CREATE cambia la
-- identidad de la función en pg_proc (el tipo de argumentos es parte de esa identidad), así
-- que el ancla de 5 parámetros de 266.4 YA NO resuelve — se reemplaza por la firma vigente,
-- no se duplica.
select has_function('public', 'crm_leads_page',
  array['uuid','text','jsonb','int','text','text[]','boolean'],
  'SIG1_crm_leads_page_existe_con_la_firma_declarada');

select is(
  (select pg_get_function_result(to_regprocedure('public.crm_leads_page(uuid,text,jsonb,int,text,text[],boolean)'))),
  'TABLE(lead_id uuid, user_id uuid, full_name text, avatar_url text, temperature integer, delta integer, band text, signals jsonb, sparkline integer[], last_activity_at timestamp with time zone, origin_property jsonb, status_projected text, next_cursor jsonb, remaining integer)',
  'SIG2_crm_leads_page_returns_table_EXACTA'
);

select is(
  (select pg_get_function_arguments(to_regprocedure('public.crm_leads_page(uuid,text,jsonb,int,text,text[],boolean)'))),
  'p_agent_id uuid, p_band text DEFAULT NULL::text, p_cursor jsonb DEFAULT NULL::jsonb, p_limit integer DEFAULT 20, p_query text DEFAULT NULL::text, p_status text[] DEFAULT NULL::text[], p_follow_up boolean DEFAULT NULL::boolean',
  'SIG3_crm_leads_page_argumentos_EXACTOS_con_defaults_D_DEFAULTS'
);

select is(
  (select prosecdef from pg_proc where proname = 'crm_leads_page' and pronamespace = 'public'::regnamespace),
  true, 'SIG4_crm_leads_page_es_security_definer'
);

select is(
  (select provolatile from pg_proc where proname = 'crm_leads_page' and pronamespace = 'public'::regnamespace),
  's', 'SIG5_crm_leads_page_es_stable'
);

select is(
  (select proconfig from pg_proc where proname = 'crm_leads_page' and pronamespace = 'public'::regnamespace),
  array['search_path=""']::text[],
  'SIG6_crm_leads_page_search_path_vacio'
);

select function_privs_are('public', 'crm_leads_page',
  array['uuid','text','jsonb','int','text','text[]','boolean'], 'anon', array[]::name[],
  'ACL1_crm_leads_page_anon_SIN_execute');
select function_privs_are('public', 'crm_leads_page',
  array['uuid','text','jsonb','int','text','text[]','boolean'], 'authenticated', array['EXECUTE']::name[],
  'ACL2_crm_leads_page_authenticated_CON_execute');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) CATÁLOGO — public.crm_funnel (firma, atributos, ACL).
-- ════════════════════════════════════════════════════════════════════════════

select has_function('public', 'crm_funnel', array['uuid','int'],
  'SIG1B_crm_funnel_existe_con_la_firma_declarada');

select is(
  (select pg_get_function_result(to_regprocedure('public.crm_funnel(uuid,int)'))),
  'TABLE(vieron integer, volvieron integer, guardaron integer, contactaron integer, agendaron integer)',
  'SIG2B_crm_funnel_returns_table_EXACTA'
);

select is(
  (select pg_get_function_arguments(to_regprocedure('public.crm_funnel(uuid,int)'))),
  'p_agent_id uuid, p_days integer DEFAULT 30',
  'SIG3B_crm_funnel_argumentos_EXACTOS_default_30_dias_D_DEFAULTS'
);

select is(
  (select prosecdef from pg_proc where proname = 'crm_funnel' and pronamespace = 'public'::regnamespace),
  true, 'SIG4B_crm_funnel_es_security_definer'
);

select is(
  (select provolatile from pg_proc where proname = 'crm_funnel' and pronamespace = 'public'::regnamespace),
  's', 'SIG5B_crm_funnel_es_stable'
);

select is(
  (select proconfig from pg_proc where proname = 'crm_funnel' and pronamespace = 'public'::regnamespace),
  array['search_path=""']::text[],
  'SIG6B_crm_funnel_search_path_vacio'
);

select function_privs_are('public', 'crm_funnel', array['uuid','int'], 'anon', array[]::name[],
  'ACL1B_crm_funnel_anon_SIN_execute');
select function_privs_are('public', 'crm_funnel', array['uuid','int'], 'authenticated', array['EXECUTE']::name[],
  'ACL2B_crm_funnel_authenticated_CON_execute');

-- ════════════════════════════════════════════════════════════════════════════
-- 3) ACL REAL — anon denegado en su PRIMERA invocación real de CADA función (gotcha 203.1:
--    el EXECUTE se comprueba al planificar y el plan se cachea). SIN wrapper: throws_ok
--    directo, necesita el 42501 real, no el sentinel del wrapper.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select * from public.crm_leads_page('00000000-0000-0000-0000-000000266001'::uuid, null, null, 20, null) $$,
  '42501', null, 'ACLREAL1_anon_no_puede_ejecutar_crm_leads_page'
);
reset role;

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select * from public.crm_funnel('00000000-0000-0000-0000-000000266015'::uuid, 30) $$,
  '42501', null, 'ACLREAL2_anon_no_puede_ejecutar_crm_funnel'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) AUTORIZACIÓN — crm_leads_page. p_query='Ana Martinez' aísla L1 entre TODOS los leads
--    del archivo (nadie más se llama así) — un solo query por rol prueba "ve/no ve" sin
--    depender de contar leads de otras secciones. "mis X" filtra EXPLÍCITO por p_agent_id
--    (#226/#77): AG2 y PADMIN son usuarios REALES, no inventados, y aun así 0 filas.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000266001'); -- AG1, dueño
select is(
  jsonb_array_length(pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 50, 'Ana Martinez')),
  1, 'AUTZ1_AG1_dueno_ve_su_propio_lead_L1'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266003'); -- AG2, ajeno (sin agencia)
select is(
  jsonb_array_length(pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 50, 'Ana Martinez')),
  0, 'AUTZ2_AG2_agente_ajeno_0_filas'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266004'); -- OWN, owner ACTIVO de la agencia de AG1
select is(
  jsonb_array_length(pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 50, 'Ana Martinez')),
  1, 'AUTZ3_owner_de_la_agencia_ve_el_lead'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266005'); -- ADM, admin ACTIVO de la agencia de AG1
select is(
  jsonb_array_length(pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 50, 'Ana Martinez')),
  1, 'AUTZ4_admin_de_la_agencia_ve_el_lead'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266006'); -- PADMIN, admin de PLATAFORMA sin relación
select is(
  jsonb_array_length(pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 50, 'Ana Martinez')),
  0, 'AUTZ5_admin_de_plataforma_sin_relacion_0_filas_226'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266007'); -- OWN2, owner de OTRA agencia (ajena)
select is(
  jsonb_array_length(pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 50, 'Ana Martinez')),
  0, 'AUTZ6_owner_de_otra_agencia_0_filas'
);
reset role;

-- 🟡 M23 (endurecimiento post-guardian): AGF y AG1 son ambos 'agent' ACTIVOS de la MISMA
-- agencia (AGENCY1) — un PAR, no un owner/admin. `private.can_manage_agent_pipeline` exige
-- IN ('owner','admin'); un mutante que aceptara también 'agent' dejaría a cualquier
-- compañero de equipo ver el pipeline de otro agente raso.
select pg_temp.act_as('00000000-0000-0000-0000-000000266015'); -- AGF, agente PAR de AG1 en AGENCY1
select is(
  jsonb_array_length(pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 50, 'Ana Martinez')),
  0, 'AUTZ7_agente_PAR_de_la_misma_agencia_0_filas_no_hereda_de_un_companero'
);
reset role;

-- 🟡 M22 (endurecimiento post-guardian): AGSUSP es agente de AGENCY1 pero su ÚNICA membresía
-- ahí está `suspended` (sin fila `active`) — ver fixture arriba. OWN es owner ACTIVO REAL de
-- AGENCY1: si el helper resolviera la agencia del agente objetivo SIN el filtro
-- `status='active'`, OWN quedaría autorizado por error sobre un agente que ya no está
-- activo en su equipo.
select pg_temp.act_as('00000000-0000-0000-0000-000000266004'); -- OWN, owner ACTIVO de AGENCY1
select is(
  jsonb_array_length(pg_temp.leads_page_json('00000000-0000-0000-0000-000000266029', null, null, 50, null)),
  0, 'AUTZ8_membresia_del_agente_objetivo_suspendida_0_filas_no_active_status_203_1'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) BOUNDARY — p_agent_id que NO EXISTE (ni como users ni como agency_members): 0 filas /
--    0 conteos, NUNCA una excepción (anti-IDOR, mismo criterio que el resto de la sección).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000266006'); -- PADMIN
select is(
  pg_temp.leads_page_json('00000000-0000-0000-0000-0000002660ff', null, null, 20, null),
  '[]'::jsonb, 'BOUNDARY1_crm_leads_page_agente_inexistente_0_filas_sin_excepcion'
);
select is(
  pg_temp.funnel_json('00000000-0000-0000-0000-0000002660ff', 30),
  '[]'::jsonb, 'BOUNDARY2_crm_funnel_agente_inexistente_0_filas_sin_excepcion'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) CURSOR KEYSET — 25 leads (LPAG01-25), p_limit=10, orden temperature DESC/lead_id ASC
--    (D-TIEBREAK). Unión de las 3 páginas = las 25 lead_id, sin repetir ni omitir. remaining
--    decreciente (D-REMAINING); next_cursor NULL solo en la última página (D-NEXTCURSOR).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000266028'); -- AGP (aislado)

create temp table pag_page1 (v jsonb);
insert into pag_page1 select pg_temp.leads_page_json('00000000-0000-0000-0000-000000266028', null, null, 10, null);

-- Página 1 esperada: i=0..9 (días 0..9) -> LPAG suffix 600+i para i=0..9 -> 600-609.
select is(
  (select array_agg(elem->>'lead_id') from jsonb_array_elements((select v from pag_page1)) elem),
  (select array_agg('00000000-0000-0000-0000-000000266' || (600 + i)) from generate_series(0, 9) as i),
  'PAG1_pagina1_orden_exacto_10_primeros_leads_por_temperatura_desc'
);
select is(
  ((select v from pag_page1) -> 0 ->> 'remaining')::int,
  15, 'PAG2_pagina1_remaining_15_25_menos_10_devueltos'
);
select ok(
  ((select v from pag_page1) -> 0 -> 'next_cursor') is not null,
  'PAG3_pagina1_next_cursor_no_es_null_quedan_paginas'
);

create temp table pag_page2 (v jsonb);
insert into pag_page2 select pg_temp.leads_page_json('00000000-0000-0000-0000-000000266028', null,
  (select v from pag_page1) -> 0 -> 'next_cursor', 10, null);

-- Página 2 esperada: i=10..19 -> suffix 610-619.
select is(
  (select array_agg(elem->>'lead_id') from jsonb_array_elements((select v from pag_page2)) elem),
  (select array_agg('00000000-0000-0000-0000-000000266' || (600 + i)) from generate_series(10, 19) as i),
  'PAG4_pagina2_orden_exacto_incluye_el_desempate_por_lead_id_en_temperaturas_repetidas'
);
select is(
  ((select v from pag_page2) -> 0 ->> 'remaining')::int,
  5, 'PAG5_pagina2_remaining_5_25_menos_20_devueltos'
);
select ok(
  ((select v from pag_page2) -> 0 -> 'next_cursor') is not null,
  'PAG6_pagina2_next_cursor_no_es_null_queda_la_ultima_pagina'
);

create temp table pag_page3 (v jsonb);
insert into pag_page3 select pg_temp.leads_page_json('00000000-0000-0000-0000-000000266028', null,
  (select v from pag_page2) -> 0 -> 'next_cursor', 10, null);

-- Página 3 esperada: i=20..24 -> suffix 620-624 (5 filas, última página).
select is(
  (select array_agg(elem->>'lead_id') from jsonb_array_elements((select v from pag_page3)) elem),
  (select array_agg('00000000-0000-0000-0000-000000266' || (600 + i)) from generate_series(20, 24) as i),
  'PAG7_pagina3_orden_exacto_ultimos_5_leads'
);
select is(
  ((select v from pag_page3) -> 0 ->> 'remaining')::int,
  0, 'PAG8_pagina3_remaining_0_no_queda_nada_por_paginar'
);
select ok(
  ((select v from pag_page3) -> 0 -> 'next_cursor') = 'null'::jsonb,
  'PAG9_pagina3_next_cursor_NULL_es_la_ultima_pagina'
);

select is(
  (select count(*)::int from (
    select elem->>'lead_id' as lid from jsonb_array_elements((select v from pag_page1)) elem
    union all
    select elem->>'lead_id' from jsonb_array_elements((select v from pag_page2)) elem
    union all
    select elem->>'lead_id' from jsonb_array_elements((select v from pag_page3)) elem
  ) u),
  25, 'PAG10_union_de_las_3_paginas_tiene_exactamente_25_filas'
);
select is(
  (select count(distinct elem->>'lead_id')::int from (
    select elem from jsonb_array_elements((select v from pag_page1)) elem
    union all
    select elem from jsonb_array_elements((select v from pag_page2)) elem
    union all
    select elem from jsonb_array_elements((select v from pag_page3)) elem
  ) u),
  25, 'PAG11_union_de_las_3_paginas_sin_ningun_lead_repetido'
);

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) AS-OF CONGELADO — cursor manual con as_of='2026-01-14T12:00:00+00' + LASOF
--    (contacted_at = as_of - 1 día). Si el SUT ignorara el as_of congelado y usara now()
--    real, la temperatura sería drásticamente distinta (~234 días de decaimiento ≈ 0, no 28).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000266001');

select is(
  (
    select elem->>'temperature'
    from jsonb_array_elements(
      pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null,
        jsonb_build_object('as_of', '2026-01-15T12:00:00+00', 'temperature', 1000,
          'lead_id', '00000000-0000-0000-0000-000000000000'),
        1000, null)
    ) elem
    where elem->>'lead_id' = '00000000-0000-0000-0000-000000266571'
  ),
  '28', 'ASOF1_temperatura_con_as_of_congelado_28_un_dia_de_decaimiento_no_now_real'
);

select ok(
  (pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 1, null) -> 0 -> 'next_cursor' ->> 'as_of') is not null,
  'ASOF2_next_cursor_de_una_llamada_real_sin_cursor_manual_trae_as_of'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8) SPARKLINE — int[14], NULL donde no hay fila, ordenado por día ascendente. Mismo
--    cursor as_of congelado de la sección 7 (ventana [2026-01-02 .. 2026-01-15]).
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (
    select elem->'sparkline'
    from jsonb_array_elements(
      pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null,
        jsonb_build_object('as_of', '2026-01-15T12:00:00+00', 'temperature', 1000,
          'lead_id', '00000000-0000-0000-0000-000000000000'),
        1000, null)
    ) elem
    where elem->>'lead_id' = '00000000-0000-0000-0000-000000266577'
  ),
  '[10,null,null,20,null,null,null,null,null,null,null,null,null,45]'::jsonb,
  'SPARK1_sparkline_14_dias_con_huecos_NULL_en_orden_ascendente'
);

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 9) p_query — ilike sobre first_name||' '||last_name, case-insensitive, parcial;
--    NULL/'' = sin filtro (D-QUERY).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000266001');

select is(
  jsonb_array_length(pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 50, 'maria')),
  1, 'QUERY1_minuscula_parcial_matchea_Maria_Lopez_case_insensitive'
);

select is(
  (select count(*)::int from jsonb_array_elements(
    pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 50, 'MAR')
  ) elem where elem->>'lead_id' in (
    '00000000-0000-0000-0000-000000266574', '00000000-0000-0000-0000-000000266575'
  )),
  2, 'QUERY2_MAR_mayusculas_matchea_Maria_Y_Mario_parcial'
);

select ok(
  (select count(*) from jsonb_array_elements(
    pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 1000, null)
  ) elem where elem->>'lead_id' = '00000000-0000-0000-0000-000000266576') = 1,
  'QUERY3_p_query_NULL_no_filtra_incluye_a_Carlos'
);

select ok(
  (select count(*) from jsonb_array_elements(
    pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 1000, '')
  ) elem where elem->>'lead_id' = '00000000-0000-0000-0000-000000266576') = 1,
  'QUERY4_p_query_cadena_vacia_se_comporta_igual_que_NULL'
);

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 10) status_projected — 8→4 (exploración 045 §7.4), los 11 valores del enum, incluidos
--     los 3 legacy (new, in_progress, closed_won). D-STATUSPROJ.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000266001');

create temp table sta_all (v jsonb);
insert into sta_all select pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 1000, null);

select is(
  (select elem->>'status_projected' from jsonb_array_elements((select v from sta_all)) elem where elem->>'lead_id' = '00000000-0000-0000-0000-000000266650'),
  'nuevo', 'STATUS1_new_legacy_proyecta_nuevo'
);
select is(
  (select elem->>'status_projected' from jsonb_array_elements((select v from sta_all)) elem where elem->>'lead_id' = '00000000-0000-0000-0000-000000266651'),
  'nuevo', 'STATUS2_whatsapp_opened_proyecta_nuevo'
);
select is(
  (select elem->>'status_projected' from jsonb_array_elements((select v from sta_all)) elem where elem->>'lead_id' = '00000000-0000-0000-0000-000000266652'),
  'contactado', 'STATUS3_contacted_proyecta_contactado'
);
select is(
  (select elem->>'status_projected' from jsonb_array_elements((select v from sta_all)) elem where elem->>'lead_id' = '00000000-0000-0000-0000-000000266653'),
  'contactado', 'STATUS4_interested_proyecta_contactado'
);
select is(
  (select elem->>'status_projected' from jsonb_array_elements((select v from sta_all)) elem where elem->>'lead_id' = '00000000-0000-0000-0000-000000266654'),
  'contactado', 'STATUS5_in_progress_legacy_proyecta_contactado'
);
select is(
  (select elem->>'status_projected' from jsonb_array_elements((select v from sta_all)) elem where elem->>'lead_id' = '00000000-0000-0000-0000-000000266655'),
  'visita', 'STATUS6_visit_scheduled_proyecta_visita'
);
select is(
  (select elem->>'status_projected' from jsonb_array_elements((select v from sta_all)) elem where elem->>'lead_id' = '00000000-0000-0000-0000-000000266656'),
  'cerrado', 'STATUS7_closed_won_rent_proyecta_cerrado'
);
select is(
  (select elem->>'status_projected' from jsonb_array_elements((select v from sta_all)) elem where elem->>'lead_id' = '00000000-0000-0000-0000-000000266657'),
  'cerrado', 'STATUS8_closed_won_sale_proyecta_cerrado'
);
select is(
  (select elem->>'status_projected' from jsonb_array_elements((select v from sta_all)) elem where elem->>'lead_id' = '00000000-0000-0000-0000-000000266658'),
  'cerrado', 'STATUS9_closed_lost_proyecta_cerrado'
);
select is(
  (select elem->>'status_projected' from jsonb_array_elements((select v from sta_all)) elem where elem->>'lead_id' = '00000000-0000-0000-0000-000000266659'),
  'cerrado', 'STATUS10_discarded_proyecta_cerrado'
);
select is(
  (select elem->>'status_projected' from jsonb_array_elements((select v from sta_all)) elem where elem->>'lead_id' = '00000000-0000-0000-0000-000000266660'),
  'cerrado', 'STATUS11_closed_won_legacy_proyecta_cerrado'
);

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 11) p_band — filtra por la banda calculada (§7.3, ya validada exhaustivamente por
--     private.crm_band en 100_crm_temperature_test.sql; aquí solo se prueba el CABLEADO:
--     que crm_leads_page usa esa banda para filtrar). LBANDHOT = única 'hot' del archivo
--     (señal fuerte hace 1h); LBANDSIL = 'silent' (solo un contacto viejo, sin más señales).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000266001');

select is(
  (select array_agg(elem->>'lead_id') from jsonb_array_elements(
    pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', 'hot', null, 1000, null)
  ) elem),
  array['00000000-0000-0000-0000-000000266572'],
  'BAND1_p_band_hot_devuelve_EXACTAMENTE_LBANDHOT'
);

select ok(
  (select count(*) from jsonb_array_elements(
    pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', 'silent', null, 1000, null)
  ) elem where elem->>'lead_id' = '00000000-0000-0000-0000-000000266573') = 1,
  'BAND2_p_band_silent_INCLUYE_a_LBANDSIL'
);

select ok(
  (select count(*) from jsonb_array_elements(
    pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', 'silent', null, 1000, null)
  ) elem where elem->>'lead_id' = '00000000-0000-0000-0000-000000266572') = 0,
  'BAND3_p_band_silent_EXCLUYE_a_LBANDHOT'
);

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 12) crm_funnel — un caso por KPI (agente AISLADO AGF/PF) + autorización fail-closed
--     idéntica a crm_leads_page (mismo D-AUTZ). Ventana p_days=30, frontera INFERIOR
--     inclusiva (D-FUNNEL-WINDOW).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000266015'); -- AGF, dueño

create temp table fun_self (v jsonb);
insert into fun_self select pg_temp.funnel_json('00000000-0000-0000-0000-000000266015', 30);

select is(((select v from fun_self) -> 0 ->> 'vieron')::int, 3,
  'FUN1_vieron_3_distintos_dentro_de_la_ventana_FUN04_fuera_no_cuenta');
select is(((select v from fun_self) -> 0 ->> 'volvieron')::int, 1,
  'FUN2_volvieron_1_solo_FUN01_con_2_sesiones_DISTINTAS');
select is(((select v from fun_self) -> 0 ->> 'guardaron')::int, 2,
  'FUN3_guardaron_2_dentro_de_la_ventana_FUN07_fuera_no_cuenta');
select is(((select v from fun_self) -> 0 ->> 'contactaron')::int, 2,
  'FUN4_contactaron_2_incluye_la_frontera_de_30_dias_INCLUSIVA_out_40d_excluido');
select is(((select v from fun_self) -> 0 ->> 'agendaron')::int, 1,
  'FUN5_agendaron_1_distinct_lead_id_la_reprogramacion_de_hace_40d_no_cuenta');
-- 🟡 M10 (endurecimiento post-guardian): fixture arriba agrega una SEGUNDA fila
-- visit_scheduled para el MISMO lead 584, dentro de la ventana (ver D-AGENDARON, "reprogramar
-- 2 veces el MISMO lead no infla el KPI"). agendaron sigue en 1 (count(distinct lead_id));
-- un mutante count(*) lo subiría a 2.
select is(((select v from fun_self) -> 0 ->> 'agendaron')::int, 1,
  'FUN6_agendaron_reprogramar_2_veces_el_MISMO_lead_no_infla_count_distinct_lead_id');

reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266003'); -- AG2, ajeno
select is(
  pg_temp.funnel_json('00000000-0000-0000-0000-000000266015', 30),
  '[]'::jsonb, 'FUNAUTZ1_agente_ajeno_0_conteos_nunca_excepcion'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266006'); -- PADMIN, plataforma sin relación
select is(
  pg_temp.funnel_json('00000000-0000-0000-0000-000000266015', 30),
  '[]'::jsonb, 'FUNAUTZ2_admin_de_plataforma_sin_relacion_0_conteos_226'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266004'); -- OWN, owner de la MISMA agencia que AGF
select is(
  (pg_temp.funnel_json('00000000-0000-0000-0000-000000266015', 30) -> 0 ->> 'vieron')::int,
  3, 'FUNAUTZ3_owner_de_la_agencia_de_AGF_ve_los_conteos_reales'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266007'); -- OWN2, owner de OTRA agencia
select is(
  pg_temp.funnel_json('00000000-0000-0000-0000-000000266015', 30),
  '[]'::jsonb, 'FUNAUTZ4_owner_de_otra_agencia_0_conteos'
);
reset role;

-- 🟡 M23 (endurecimiento post-guardian) — misma pareja AGF/AG1 de AUTZ7, ahora contra
-- crm_funnel: AGF (agente PAR de AG1 en AGENCY1) no puede ver el embudo de AG1.
select pg_temp.act_as('00000000-0000-0000-0000-000000266015'); -- AGF, agente PAR de AG1
select is(
  pg_temp.funnel_json('00000000-0000-0000-0000-000000266001', 30),
  '[]'::jsonb, 'FUNAUTZ5_agente_PAR_de_la_misma_agencia_0_conteos_no_hereda_de_un_companero'
);
reset role;

-- 🟡 M22 (endurecimiento post-guardian) — misma pareja OWN/AGSUSP de AUTZ8, ahora contra
-- crm_funnel: OWN (owner ACTIVO de AGENCY1) no ve el embudo de AGSUSP, cuya ÚNICA membresía
-- ahí está `suspended`. AGSUSP no posee properties, pero SÍ tiene un lead reciente
-- (LSUSP, creado "hoy") — si el helper autorizara por error, `contactaron` saldría 1 (no
-- vacío): el assert distingue "autorizado por error" de "0 conteos legítimos".
select pg_temp.act_as('00000000-0000-0000-0000-000000266004'); -- OWN, owner ACTIVO de AGENCY1
select is(
  pg_temp.funnel_json('00000000-0000-0000-0000-000000266029', 30),
  '[]'::jsonb, 'FUNAUTZ6_membresia_del_agente_objetivo_suspendida_0_conteos_203_1'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 13) p_status — filtro por los 4 estados PROYECTADOS (subtarea 271.1). D-STATUSARRAY.
--     Reusa AG1/LSTA (sección 10, ya validado que status_projected es correcto por lead) —
--     aquí solo se prueba el CABLEADO: que crm_leads_page usa status_projected para filtrar
--     en la CTE `matched` (puntos delicados 1 y 2 de la subtarea).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000266001'); -- AG1

select is(
  jsonb_array_length((select v from sta_all)),
  19, 'STATUSARR0_p_status_NULL_no_filtra_mismo_total_19_que_sin_el_parametro'
);

select is(
  (select array_agg(elem->>'lead_id' order by elem->>'lead_id')
   from jsonb_array_elements(
     pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 1000, null, array['nuevo'], null)
   ) elem),
  array[
    '00000000-0000-0000-0000-000000266571',
    '00000000-0000-0000-0000-000000266572',
    '00000000-0000-0000-0000-000000266573',
    '00000000-0000-0000-0000-000000266574',
    '00000000-0000-0000-0000-000000266575',
    '00000000-0000-0000-0000-000000266576',
    '00000000-0000-0000-0000-000000266577',
    '00000000-0000-0000-0000-000000266650',
    '00000000-0000-0000-0000-000000266651'
  ],
  'STATUSARR1_p_status_nuevo_devuelve_EXACTAMENTE_new_y_whatsapp_opened_9_leads'
);

select is(
  (select array_agg(elem->>'lead_id' order by elem->>'lead_id')
   from jsonb_array_elements(
     pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 1000, null, array['contactado'], null)
   ) elem),
  array[
    '00000000-0000-0000-0000-000000266501',
    '00000000-0000-0000-0000-000000266652',
    '00000000-0000-0000-0000-000000266653',
    '00000000-0000-0000-0000-000000266654'
  ],
  'STATUSARR2_p_status_contactado_trae_contacted_Y_interested_Y_in_progress_tramo_ambiguo'
);

select is(
  (select array_agg(elem->>'lead_id' order by elem->>'lead_id')
   from jsonb_array_elements(
     pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 1000, null, array['visita'], null)
   ) elem),
  array['00000000-0000-0000-0000-000000266655'],
  'STATUSARR3_p_status_visita_devuelve_EXACTAMENTE_visit_scheduled'
);

select is(
  (select array_agg(elem->>'lead_id' order by elem->>'lead_id')
   from jsonb_array_elements(
     pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 1000, null, array['cerrado'], null)
   ) elem),
  array[
    '00000000-0000-0000-0000-000000266656',
    '00000000-0000-0000-0000-000000266657',
    '00000000-0000-0000-0000-000000266658',
    '00000000-0000-0000-0000-000000266659',
    '00000000-0000-0000-0000-000000266660'
  ],
  'STATUSARR4_p_status_cerrado_trae_los_4_vigentes_MAS_el_legacy_closed_won_tramo_ambiguo'
);

select is(
  (select array_agg(elem->>'lead_id' order by elem->>'lead_id')
   from jsonb_array_elements(
     pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 1000, null, array['visita','cerrado'], null)
   ) elem),
  array[
    '00000000-0000-0000-0000-000000266655',
    '00000000-0000-0000-0000-000000266656',
    '00000000-0000-0000-0000-000000266657',
    '00000000-0000-0000-0000-000000266658',
    '00000000-0000-0000-0000-000000266659',
    '00000000-0000-0000-0000-000000266660'
  ],
  'STATUSARR5_array_con_2_estados_union_sin_duplicados_visita_y_cerrado'
);

select is(
  jsonb_array_length(
    pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 1000, null, '{}'::text[], null)
  ),
  0, 'STATUSARR6_array_vacio_es_0_filas_NUNCA_sin_filtro_D_STATUSARRAY'
);

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 14) p_follow_up — filtro EXACTO sobre leads.is_follow_up (agente aislado AGFOLLOW).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000266031'); -- AGFOLLOW, dueño

select is(
  (select array_agg(elem->>'lead_id')
   from jsonb_array_elements(
     pg_temp.leads_page_json('00000000-0000-0000-0000-000000266031', null, null, 50, null, null, true)
   ) elem),
  array['00000000-0000-0000-0000-000000266578'],
  'FOLLOW1_p_follow_up_true_devuelve_SOLO_el_marcado'
);

select is(
  (select array_agg(elem->>'lead_id')
   from jsonb_array_elements(
     pg_temp.leads_page_json('00000000-0000-0000-0000-000000266031', null, null, 50, null, null, false)
   ) elem),
  array['00000000-0000-0000-0000-000000266579'],
  'FOLLOW2_p_follow_up_false_devuelve_SOLO_el_NO_marcado'
);

select is(
  jsonb_array_length(
    pg_temp.leads_page_json('00000000-0000-0000-0000-000000266031', null, null, 50, null, null, null)
  ),
  2, 'FOLLOW3_p_follow_up_NULL_no_filtra_trae_AMBOS'
);

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 15) Combinación p_status + p_band + p_query SIMULTÁNEOS — deben combinarse por AND, nunca
--     por OR (si el punto delicado 1 se resolviera mal — filtros aplicados en momentos
--     distintos, o alguno ignorado — esta sección lo cazaría). MARIA (574, status
--     'new'→'nuevo') es la única lead de AG1 cuyo nombre matchea 'maria' Y cuya banda es
--     'silent' (mismo perfil que LBANDSIL: un solo contacto viejo, sin señal adicional —
--     ambos flags.signal_recent y flags.status_recent quedan en false, y temp < temp_prev
--     por el decaimiento simple, así que private.crm_band cae en el 'else' -> 'silent').
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000266001'); -- AG1

select is(
  (select array_agg(elem->>'lead_id')
   from jsonb_array_elements(
     pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', 'silent', null, 50, 'maria', array['nuevo'], null)
   ) elem),
  array['00000000-0000-0000-0000-000000266574'],
  'COMBO1_p_status_p_band_p_query_A_LA_VEZ_aislan_a_MARIA_por_AND'
);

select is(
  jsonb_array_length(
    pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', 'silent', null, 50, 'maria', array['visita'], null)
  ),
  0, 'COMBO2_mismo_band_y_query_pero_status_equivocado_0_filas_prueba_AND_no_OR'
);

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 16) remaining/next_cursor CON p_status APLICADO — agente aislado AGFILT, 12 leads (6
--     'nuevo' + 6 'visita' intercalados por temperatura, ver cabecera del fixture).
--     p_status=['nuevo'] debe reducir el universo de `matched` a 6 ANTES de paginar (punto
--     delicado 1): si el filtro se aplicara DESPUÉS del cursor/remaining, la página o el
--     remaining incluirían las 'visita' o contarían sobre las 12, no sobre las 6.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000266034'); -- AGFILT (aislado)

create temp table filt_page1 (v jsonb);
insert into filt_page1 select pg_temp.leads_page_json('00000000-0000-0000-0000-000000266034', null, null, 4, null, array['nuevo'], null);

-- Página 1 esperada: las 4 temperaturas más altas del subconjunto 'nuevo' -> i=0,2,4,6 ->
-- suffix 625,627,629,631 (temps 30,25,21,18 — sin empates, misma progresión que LPAG §6).
select is(
  (select array_agg(elem->>'lead_id') from jsonb_array_elements((select v from filt_page1)) elem),
  array[
    '00000000-0000-0000-0000-000000266625',
    '00000000-0000-0000-0000-000000266627',
    '00000000-0000-0000-0000-000000266629',
    '00000000-0000-0000-0000-000000266631'
  ],
  'FILTPAG1_pagina1_los_4_nuevo_de_mayor_temperatura_las_visita_intercaladas_NO_aparecen'
);
select is(
  ((select v from filt_page1) -> 0 ->> 'remaining')::int,
  2, 'FILTPAG2_remaining_2_6_nuevo_totales_menos_4_devueltos_NO_12_menos_4'
);
select ok(
  ((select v from filt_page1) -> 0 -> 'next_cursor') is not null,
  'FILTPAG3_pagina1_next_cursor_no_es_null_quedan_2_nuevo_por_paginar'
);

create temp table filt_page2 (v jsonb);
insert into filt_page2 select pg_temp.leads_page_json('00000000-0000-0000-0000-000000266034', null,
  (select v from filt_page1) -> 0 -> 'next_cursor', 4, null, array['nuevo'], null);

-- Página 2 esperada: los 2 'nuevo' restantes -> i=8,10 -> suffix 633,635 (temps 15,13).
select is(
  (select array_agg(elem->>'lead_id') from jsonb_array_elements((select v from filt_page2)) elem),
  array[
    '00000000-0000-0000-0000-000000266633',
    '00000000-0000-0000-0000-000000266635'
  ],
  'FILTPAG4_pagina2_los_2_nuevo_restantes_exactos'
);
select is(
  ((select v from filt_page2) -> 0 ->> 'remaining')::int,
  0, 'FILTPAG5_pagina2_remaining_0_no_queda_ningun_nuevo_por_paginar'
);
select ok(
  ((select v from filt_page2) -> 0 -> 'next_cursor') = 'null'::jsonb,
  'FILTPAG6_pagina2_next_cursor_NULL_es_la_ultima_pagina_del_subconjunto_filtrado'
);

select is(
  (select count(distinct elem->>'lead_id')::int from (
    select elem from jsonb_array_elements((select v from filt_page1)) elem
    union all
    select elem from jsonb_array_elements((select v from filt_page2)) elem
  ) u),
  6, 'FILTPAG7_union_de_las_2_paginas_filtradas_tiene_EXACTAMENTE_6_leads_sin_repetir'
);
select is(
  (select count(*)::int from public.leads
   where agent_id = '00000000-0000-0000-0000-000000266034' and status = 'new' and deleted_at is null),
  6, 'FILTPAG8_el_total_paginado_coincide_con_el_conteo_directo_en_la_tabla_leads'
);

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 17) Autorización fail-closed NO se salta por traer filtros nuevos — mismo D-AUTZ de la
--     sección 4, ahora con p_status/p_follow_up en la llamada.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000266003'); -- AG2, ajeno (sin agencia)
select is(
  jsonb_array_length(
    pg_temp.leads_page_json('00000000-0000-0000-0000-000000266001', null, null, 50, null, array['nuevo'], true)
  ),
  0, 'AUTZFILT1_agente_ajeno_0_filas_aunque_traiga_p_status_y_p_follow_up'
);
reset role;

-- ── 18. Guarda de esquema: el CASE de la proyección 8→4 no tiene ELSE ──────────
-- 🔴 Hallazgo del guardian (271.1): si el enum lead_status gana un valor 12 y nadie
-- actualiza el CASE de `banded`, ese brazo cae a NULL. Y como `NULL = any(p_status)`
-- es NULL, esos leads DESAPARECEN de toda consulta filtrada mientras siguen saliendo
-- sin filtro — falla silenciosa que ningún assert de comportamiento caza (no se puede
-- sembrar un valor del enum que todavía no existe). Este assert de catálogo revienta
-- en cuanto el enum crece, y obliga a tocar la proyección en el mismo cambio.
select is(
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'lead_status'),
  'new,contacted,in_progress,visit_scheduled,closed_won,closed_lost,discarded,whatsapp_opened,interested,closed_won_rent,closed_won_sale',
  'ENUMGUARD1_lead_status_sigue_teniendo_los_11_valores_que_cubre_el_CASE_de_status_projected'
);

select * from finish();
rollback;
