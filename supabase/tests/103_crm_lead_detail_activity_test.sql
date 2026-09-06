-- Tests pgTAP — public.crm_lead_detail + public.lead_activity (subtarea 266.5, exploración
-- 045 §7.4/§12/§14 T-A). Ejecutar con:
--   supabase test db supabase/tests/103_crm_lead_detail_activity_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de una transacción
-- revertida (no persiste). El rol `postgres` de este proyecto NO es superuser real
-- (20260904300001) pero SÍ es dueño de las funciones/tablas — bypassa RLS por ownership y
-- retiene EXECUTE implícito pese al REVOKE FROM public/anon/authenticated, así que las
-- llamadas "autorizadas" solo necesitan fijar el claim JWT (pg_temp.act_as, patrón
-- 02/35/62/100/101/102).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAMS bajo prueba (contrato PÚBLICO, comportamiento observable, NUNCA internals):
--   1) public.crm_lead_detail(p_lead_id uuid)
--      → TABLE(origin_property jsonb, other_properties integer, suggested_next_status text)
--      firma exacta, security definer, stable, search_path='', ACL (revoke public/anon,
--      grant authenticated), autorización fail-closed en el cuerpo vía private.can_view_lead
--      + deleted_at explícito.
--   2) public.lead_activity(p_lead_id uuid, p_limit int, p_cursor timestamptz)
--      → TABLE(occurred_at timestamptz, kind text, detail jsonb)
--      mismos atributos y ACL; union all de events_raw ∪ likes ∪ saves ∪
--      lead_status_history, autorización idéntica, cursor keyset por timestamp con
--      desempate por kind.
-- SUT (AÚN NO EXISTE — RED 2026-09-06): supabase/migrations/2026MMDDNNNNNN_
-- crm_lead_detail_activity.sql debe crear ambas funciones.
--
-- ── Estrategia RED sin depender de "function does not exist" (mismo patrón que
--    100/101/102, adaptado a 2 funciones SETOF) ──────────────────────────────────────────────
-- (a) Los asserts de catálogo puro (has_function/pg_get_function_*/pg_proc/
--     function_privs_are) son seguros aunque la función no exista: resuelven "not ok" sin
--     lanzar.
-- (b) TODA llamada real en contexto "autorizado" pasa por un wrapper
--     pg_temp.lead_detail_json(...)/pg_temp.activity_json(...) que agrega las filas a jsonb
--     (jsonb_agg) y atrapa CUALQUIER excepción devolviendo el sentinel
--     '[{"__error__": true}, {"__error__": true}]'::jsonb — un ARRAY de 2 elementos, DISTINTO
--     de '[]'::jsonb (0 filas legítimo), de un array de 1 fila (crm_lead_detail happy path) y
--     de cualquier longitud real de lead_activity (13/6/5/2/0) — verificado por construcción,
--     mismo criterio que 102 (102:20-31). Ningún jsonb_agg lleva ORDER BY propio: el orden
--     observado en el array es el que el SUT decide, no uno que el wrapper le imponga — así
--     los asserts de orden/cursor prueban al SUT, no al wrapper.
-- (c) Gotcha 203.1 (el EXECUTE se comprueba al planificar y el plan se cachea): los 2 casos
--     ACL de `anon` (ACLREAL) van SIN wrapper, con throws_ok directo, y son la PRIMERA
--     invocación real de CADA función en el archivo.
--
-- ── Decisiones de diseño del test-author (el contrato no las fijaba; se deciden aquí y el
--    GREEN debe cumplirlas exactamente — están en la bitácora de la subtarea) ───────────────
-- D-DEFAULTS: lead_activity(p_lead_id uuid, p_limit int DEFAULT 20, p_cursor timestamptz
--   DEFAULT NULL) — mismo default 20 que crm_leads_page (266.4). crm_lead_detail(p_lead_id
--   uuid) sin defaults (un solo argumento obligatorio).
-- D-ORIGIN-KEYS: origin_property jsonb = {property_id, address, price, thumbnail_url} de la
--   fila de lead_origin_properties con MENOR contacted_at (el primer contacto, mismo criterio
--   que get_lead_stats/crm_leads_page). `thumbnail_url` = property_videos.thumbnail_url de la
--   MENOR "position" activa (deleted_at is null) de esa propiedad — la "portada".
-- D-PRICE: `price` es el precio REAL de la propiedad (properties.price) SIN filtrar por
--   price_visible — esa bandera protege al BUSCADOR en el feed público, no al DUEÑO viendo su
--   propio CRM (exploración 045 §6.4: "es propiedad del propio agente, así que price_visible
--   no aplica — verificarlo, no asumirlo"; precedente de fuga inversa: PRD §19.3, un precio
--   oculto se filtró por armar mal un template).
-- D-OTHERPROPS: other_properties = count(lead_origin_properties del lead) − 1 (0 si solo hay
--   una fila; nunca negativo).
-- D-STATUSPROJ: mismo mapeo 8→4 que public.crm_leads_page (subtarea 266.4, §7.4) sobre los 11
--   valores reales del enum lead_status (incluidos los 3 legacy: new, in_progress,
--   closed_won), con la regla del botón aplicada AL PROYECTADO: Nuevo→'contacted',
--   Contactado→'visit_scheduled', Visita→NULL (abre desplegable), Cerrado→NULL (Reabrir abre
--   desplegable). NULL se verifica con `is(x, null)` explícito (nunca `ok(x is null)`).
-- D-DELETED: private.can_view_lead NO filtra `deleted_at` (verificado en el catálogo real,
--   20260901000001 — ninguna versión de la función lo hizo nunca). Este RED exige que el
--   CUERPO de AMBAS RPC nuevas agregue el filtro explícito `l.deleted_at is null` ADEMÁS de
--   can_view_lead — es una extensión CONCEPTUAL de 35_lead_privacy_test.sql (que NO se edita:
--   instrucción explícita) a un seam nuevo.
-- D-KIND/D-DETAIL: kind/detail por fuente de lead_activity —
--   events_raw      → kind = event_type,     detail = {property_id, payload}
--   likes           → kind = 'like',         detail = {property_id}
--   saves           → kind = 'save',         detail = {property_id}
--   lead_status_history → kind = 'status_change', detail = {old_status, new_status}
-- D-SCOPE: eventos/likes/saves de lead_activity son SOLO los del usuario DE ESE LEAD sobre
--   propiedades del AGENTE DE ESE LEAD (misma frase que private.can_view_user_events, §19.2:
--   "todas las publicaciones del agente") — probado con 2 decoys: (1) el mismo usuario sobre
--   una propiedad de OTRO agente, (2) OTRO usuario sobre una propiedad del MISMO agente.
--   Ninguno de los dos debe aparecer.
-- D-CURSOR: orden `occurred_at DESC, kind ASC` (tiebreak alfabético). p_cursor es el
--   `occurred_at` de la ÚLTIMA fila devuelta en la página anterior; la página siguiente exige
--   `occurred_at < p_cursor` (estricto). Cuando el corte de p_limit cae EXACTO sobre un empate
--   de `occurred_at`, la página se EXPANDE para devolver el grupo empatado COMPLETO (nunca lo
--   parte) — así ninguna fila que comparte ese timestamp con la última fila devuelta queda
--   huérfana entre 2 páginas (p_cursor no alcanza a distinguirlas por `kind`, solo por
--   tiempo). `p_cursor` NULL = primera página.
-- D-AUTZ-SHARED: ambas RPC comparten `private.can_view_lead` + el filtro `deleted_at`
--   (D-DELETED). La MATRIZ COMPLETA de roles (dueño/owner/admin/agente par/agente
--   ajeno/admin de plataforma/inexistente/borrado) se ancla en crm_lead_detail (9 casos:
--   AUTZ1-9); lead_activity confirma 4 representativos (dueño/ajeno/inexistente/borrado) — no
--   se duplica el mismo helper 9 veces más sin agregar señal.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ─────────────────────────────────
-- Happy path: catálogo (firma+ACL) de AMBAS funciones (SIG/ACL), invocación real de anon
--   denegada en su PRIMERA llamada (ACLREAL, 203.1), agente dueño ve su propio lead/actividad
--   (AUTZ1/ACTAUTZ2).
-- Edge cases del PRD/exploración 045 (§7.4/§12): origin_property = la más antigua por
--   contacted_at con dirección/precio real/portada (ORIGIN1-2), other_properties = extra − 1
--   (OTHER1-2), suggested_next_status por los 11 valores reales incluidos los 3 legacy
--   (STATUS1-11), cada `kind` de lead_activity con su `detail` (KIND1-5), orden global
--   occurred_at desc (ORDER1), cursor recorre 13 filas sembradas en 3 páginas sin repetir ni
--   omitir, incluido un EMPATE exacto de occurred_at entre 2 fuentes distintas que ejercita el
--   desempate por kind (CURSOR1-5).
-- Ramas de reglas no obvias: private.can_view_lead NO filtra deleted_at por sí solo — un lead
--   borrado debe caer 0 filas para el agente dueño Y para el owner de la agencia por igual
--   (AUTZ8-9/ACTAUTZ1); eventos de OTRO agente (mismo usuario) y de OTRO usuario (misma
--   propiedad) no aparecen en el timeline (PRIV_EVENT1-2); price_visible NO oculta el precio
--   al propio dueño (parte de ORIGIN2).
-- Boundary/error: lead inexistente → 0 filas sin excepción (AUTZ7/ACTAUTZ4); anon denegado
--   con 42501 real en su primera invocación (ACLREAL1-2); página después de la última → 0
--   filas (CURSOR4).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(61);

-- ── Helper de impersonación (mismo patrón que 02/08/.../35/62/100/101/102_*) ─────────────────
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── Wrappers RED: jsonb_agg + sentinel de error (ver cabecera (b)) ───────────────────────────
create or replace function pg_temp.lead_detail_json(p_lead_id uuid)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v
  from public.crm_lead_detail(p_lead_id) t;
  return v;
exception when others then
  return '[{"__error__": true}, {"__error__": true}]'::jsonb;
end $$;

create or replace function pg_temp.activity_json(p_lead_id uuid, p_limit int, p_cursor timestamptz)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v
  from public.lead_activity(p_lead_id, p_limit, p_cursor) t;
  return v;
exception when others then
  return '[{"__error__": true}, {"__error__": true}]'::jsonb;
end $$;

-- Extrae la secuencia ORDENADA de `kind` de un array jsonb devuelto por activity_json — usa
-- WITH ORDINALITY + ORDER BY explícito para no depender de que jsonb_agg preserve el orden
-- por casualidad (el orden que importa es el que el SUT metió en el array, no uno que este
-- helper reintroduzca).
create or replace function pg_temp.kind_seq(p_arr jsonb)
returns jsonb language sql as $$
  select jsonb_agg(elem ->> 'kind' order by ord)
  from jsonb_array_elements(p_arr) with ordinality as t(elem, ord);
$$;

-- 🟡 Guardia anti-vacuo (hallazgo propio antes de correr el RED): comparar
-- `sentinel->0->>'clave'` contra un NULL esperado (STATUS6-11) o filtrar por una clave
-- ausente en el sentinel (PRIV_EVENT1-2) da "not ok" ⇒ NULL = NULL/0 filas por CASUALIDAD —
-- pasaría en verde AUNQUE la función no exista. Este helper exige EXACTAMENTE 1 fila real
-- antes de leer el campo; si no, devuelve un centinela de texto que NUNCA es igual a un valor
-- real ni a NULL (is('__WRONG_ROW_COUNT__', null) también reporta "not ok").
create or replace function pg_temp.detail_field(p_arr jsonb, p_key text)
returns text language sql as $$
  select case when jsonb_array_length(p_arr) = 1 then p_arr -> 0 ->> p_key
         else '__WRONG_ROW_COUNT__' end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '00000000-0000-0000-0000-000000266XXX', rango 700+ (subtarea
-- 266.5; 100/101/102 ya usan 001-699 y 701-791 para OTRAS tablas, rango nuevo por archivo
-- para no confundir la lectura aunque cada archivo corre en su propia transacción revertida).
--   USERS      700-720
--   AGENCIES   730-731 · AGENCY_MEMBERS 740-744
--   PROPERTIES 750-752 · PROPERTY_VIDEOS 760-761
--   LEADS      770-783 · LEAD_ORIGIN_PROPERTIES 784-787
--   L_ACT (772): timeline de 13 filas + 2 decoys, reloj FIJO T0 = 2026-01-01 12:00 UTC (nunca
--   now()) — evita cualquier dependencia del reloj real de la corrida.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000266700', 'ag1.2665@test.local'),    -- AG1
  ('00000000-0000-0000-0000-000000266701', 'u1.2665@test.local'),     -- U1
  ('00000000-0000-0000-0000-000000266702', 'ag2.2665@test.local'),    -- AG2 (ajeno)
  ('00000000-0000-0000-0000-000000266703', 'own.2665@test.local'),    -- OWN
  ('00000000-0000-0000-0000-000000266704', 'adm.2665@test.local'),    -- ADM
  ('00000000-0000-0000-0000-000000266705', 'padmin.2665@test.local'), -- PADMIN
  ('00000000-0000-0000-0000-000000266706', 'agpar.2665@test.local'),  -- AGPAR
  ('00000000-0000-0000-0000-000000266707', 'own2.2665@test.local'),   -- OWN2
  ('00000000-0000-0000-0000-000000266708', 'udel.2665@test.local'),   -- U_DEL
  ('00000000-0000-0000-0000-000000266709', 'uact.2665@test.local'),   -- U_ACT
  ('00000000-0000-0000-0000-000000266710', 'usingle.2665@test.local');-- U_SINGLE (L_STA01)

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-000000266' || i)::uuid, 'usta' || i || '.2665@test.local'
from generate_series(711, 720) as i; -- U_STA02..U_STA11

update public.users set role = 'agent', is_verified_agent = true
  where id in ('00000000-0000-0000-0000-000000266700', -- AG1
               '00000000-0000-0000-0000-000000266702', -- AG2
               '00000000-0000-0000-0000-000000266706'); -- AGPAR
update public.users set role = 'admin'
  where id = '00000000-0000-0000-0000-000000266705'; -- PADMIN

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000266730', 'Inmobiliaria CRM Detail 266.5', 'inmo-crm-detail-2665',
   'active', '00000000-0000-0000-0000-000000266703'),
  ('00000000-0000-0000-0000-000000266731', 'Inmobiliaria CRM Detail Ajena 266.5', 'inmo-crm-detail-ajena-2665',
   'active', '00000000-0000-0000-0000-000000266707');

insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000266740', '00000000-0000-0000-0000-000000266730', '00000000-0000-0000-0000-000000266703', 'owner', 'active'), -- OWN
  ('00000000-0000-0000-0000-000000266741', '00000000-0000-0000-0000-000000266730', '00000000-0000-0000-0000-000000266704', 'admin', 'active'), -- ADM
  ('00000000-0000-0000-0000-000000266742', '00000000-0000-0000-0000-000000266730', '00000000-0000-0000-0000-000000266700', 'agent', 'active'), -- AG1
  ('00000000-0000-0000-0000-000000266743', '00000000-0000-0000-0000-000000266730', '00000000-0000-0000-0000-000000266706', 'agent', 'active'), -- AGPAR
  ('00000000-0000-0000-0000-000000266744', '00000000-0000-0000-0000-000000266731', '00000000-0000-0000-0000-000000266707', 'owner', 'active'); -- OWN2
-- AG2 NO pertenece a ninguna agencia — agente ajeno independiente (mismo patrón que 102).

insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, price_visible, status) values
  ('00000000-0000-0000-0000-000000266750', '00000000-0000-0000-0000-000000266700',
   '00000000-0000-0000-0000-000000266730', 'departamento', 'rent',
   'Fixture 266.5 — P1 (origen, mas antigua, price_visible=false)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography,
   15000, false, 'active'),
  ('00000000-0000-0000-0000-000000266751', '00000000-0000-0000-0000-000000266700',
   '00000000-0000-0000-0000-000000266730', 'casa', 'sale',
   'Fixture 266.5 — P2 (segunda propiedad, mas reciente)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.34, 20.66), 4326)::extensions.geography,
   3000000, true, 'active'),
  ('00000000-0000-0000-0000-000000266752', '00000000-0000-0000-0000-000000266702',
   null, 'casa', 'sale', 'Fixture 266.5 — P_OTHER (de AG2, ajena)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography,
   2500000, true, 'active');

insert into public.property_videos (id, property_id, "position", thumbnail_url) values
  ('00000000-0000-0000-0000-000000266760', '00000000-0000-0000-0000-000000266750', 1,
   'https://cdn.test.local/266.5/p1-portada.jpg'),
  ('00000000-0000-0000-0000-000000266761', '00000000-0000-0000-0000-000000266750', 2,
   'https://cdn.test.local/266.5/p1-decoy.jpg');

-- ── Leads ────────────────────────────────────────────────────────────────────────────────────
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-000000266770', '00000000-0000-0000-0000-000000266700', '00000000-0000-0000-0000-000000266701', 'contacted'),        -- L1
  ('00000000-0000-0000-0000-000000266771', '00000000-0000-0000-0000-000000266700', '00000000-0000-0000-0000-000000266708', 'new'),               -- L_DEL
  ('00000000-0000-0000-0000-000000266772', '00000000-0000-0000-0000-000000266700', '00000000-0000-0000-0000-000000266709', 'visit_scheduled'),   -- L_ACT
  ('00000000-0000-0000-0000-000000266773', '00000000-0000-0000-0000-000000266700', '00000000-0000-0000-0000-000000266710', 'whatsapp_opened'),   -- L_STA01
  ('00000000-0000-0000-0000-000000266774', '00000000-0000-0000-0000-000000266700', '00000000-0000-0000-0000-000000266711', 'new'),               -- L_STA02
  ('00000000-0000-0000-0000-000000266775', '00000000-0000-0000-0000-000000266700', '00000000-0000-0000-0000-000000266712', 'contacted'),         -- L_STA03
  ('00000000-0000-0000-0000-000000266776', '00000000-0000-0000-0000-000000266700', '00000000-0000-0000-0000-000000266713', 'interested'),        -- L_STA04
  ('00000000-0000-0000-0000-000000266777', '00000000-0000-0000-0000-000000266700', '00000000-0000-0000-0000-000000266714', 'in_progress'),       -- L_STA05
  ('00000000-0000-0000-0000-000000266778', '00000000-0000-0000-0000-000000266700', '00000000-0000-0000-0000-000000266715', 'visit_scheduled'),   -- L_STA06
  ('00000000-0000-0000-0000-000000266779', '00000000-0000-0000-0000-000000266700', '00000000-0000-0000-0000-000000266716', 'closed_won_rent'),   -- L_STA07
  ('00000000-0000-0000-0000-000000266780', '00000000-0000-0000-0000-000000266700', '00000000-0000-0000-0000-000000266717', 'closed_won_sale'),   -- L_STA08
  ('00000000-0000-0000-0000-000000266781', '00000000-0000-0000-0000-000000266700', '00000000-0000-0000-0000-000000266718', 'closed_lost'),       -- L_STA09
  ('00000000-0000-0000-0000-000000266782', '00000000-0000-0000-0000-000000266700', '00000000-0000-0000-0000-000000266719', 'discarded'),         -- L_STA10
  ('00000000-0000-0000-0000-000000266783', '00000000-0000-0000-0000-000000266700', '00000000-0000-0000-0000-000000266720', 'closed_won');        -- L_STA11

insert into public.lead_origin_properties (id, lead_id, property_id, contacted_at) values
  ('00000000-0000-0000-0000-000000266784', '00000000-0000-0000-0000-000000266770', '00000000-0000-0000-0000-000000266750', now() - interval '3 days'), -- L1 -> P1 (mas antigua = origen)
  ('00000000-0000-0000-0000-000000266785', '00000000-0000-0000-0000-000000266770', '00000000-0000-0000-0000-000000266751', now() - interval '1 days'), -- L1 -> P2 (mas reciente = "extra")
  ('00000000-0000-0000-0000-000000266786', '00000000-0000-0000-0000-000000266771', '00000000-0000-0000-0000-000000266750', now() - interval '2 days'), -- L_DEL -> P1
  ('00000000-0000-0000-0000-000000266787', '00000000-0000-0000-0000-000000266773', '00000000-0000-0000-0000-000000266750', now() - interval '1 days'); -- L_STA01 -> P1 (una sola)

-- L_DEL se borra YA (nada más la referencia mientras está activa) — deja el fixture en el
-- estado final que usan AUTZ8/AUTZ9/ACTAUTZ1.
update public.leads set deleted_at = now() where id = '00000000-0000-0000-0000-000000266771';

-- ── L_ACT: timeline de 13 filas (reloj FIJO T0, nunca now()) ─────────────────────────────────
-- idx0 video_view(t-0) · idx1 video_completed(t-10) · idx2 video_view(t-20) ·
-- idx3 status_change(t-30, reusa el row AUTOGENERADO por el trigger de INSERT del lead) ·
-- idx4 like(t-40, EMPATE con idx5) · idx5 video_view(t-40, EMPATE con idx4) ·
-- idx6 save(t-50) · idx7 video_view(t-60) · idx8 video_completed(t-70) ·
-- idx9..idx12 video_view(t-80/-90/-100/-110).
insert into public.events_raw (event_type, user_id, property_id, payload, created_at) values
  ('video_view',      '00000000-0000-0000-0000-000000266709', '00000000-0000-0000-0000-000000266750', '{"progress": 50}'::jsonb, timestamptz '2026-01-01 12:00:00+00'),                     -- idx0
  ('video_completed', '00000000-0000-0000-0000-000000266709', '00000000-0000-0000-0000-000000266750', '{}'::jsonb,                timestamptz '2026-01-01 12:00:00+00' - interval '10 minutes'), -- idx1
  ('video_view',      '00000000-0000-0000-0000-000000266709', '00000000-0000-0000-0000-000000266750', '{}'::jsonb,                timestamptz '2026-01-01 12:00:00+00' - interval '20 minutes'), -- idx2
  ('video_view',      '00000000-0000-0000-0000-000000266709', '00000000-0000-0000-0000-000000266750', '{}'::jsonb,                timestamptz '2026-01-01 12:00:00+00' - interval '40 minutes'), -- idx5 (EMPATE con el like idx4)
  ('video_view',      '00000000-0000-0000-0000-000000266709', '00000000-0000-0000-0000-000000266750', '{}'::jsonb,                timestamptz '2026-01-01 12:00:00+00' - interval '60 minutes'), -- idx7
  ('video_completed', '00000000-0000-0000-0000-000000266709', '00000000-0000-0000-0000-000000266750', '{}'::jsonb,                timestamptz '2026-01-01 12:00:00+00' - interval '70 minutes'), -- idx8
  ('video_view',      '00000000-0000-0000-0000-000000266709', '00000000-0000-0000-0000-000000266750', '{}'::jsonb,                timestamptz '2026-01-01 12:00:00+00' - interval '80 minutes'), -- idx9
  ('video_view',      '00000000-0000-0000-0000-000000266709', '00000000-0000-0000-0000-000000266750', '{}'::jsonb,                timestamptz '2026-01-01 12:00:00+00' - interval '90 minutes'), -- idx10
  ('video_view',      '00000000-0000-0000-0000-000000266709', '00000000-0000-0000-0000-000000266750', '{}'::jsonb,                timestamptz '2026-01-01 12:00:00+00' - interval '100 minutes'), -- idx11
  ('video_view',      '00000000-0000-0000-0000-000000266709', '00000000-0000-0000-0000-000000266750', '{}'::jsonb,                timestamptz '2026-01-01 12:00:00+00' - interval '110 minutes'); -- idx12

insert into public.likes (id, user_id, property_video_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266790', '00000000-0000-0000-0000-000000266709', '00000000-0000-0000-0000-000000266760',
   '00000000-0000-0000-0000-000000266750', timestamptz '2026-01-01 12:00:00+00' - interval '40 minutes'); -- idx4 (EMPATE con idx5)

insert into public.saves (id, user_id, property_id, created_at) values
  ('00000000-0000-0000-0000-000000266791', '00000000-0000-0000-0000-000000266709', '00000000-0000-0000-0000-000000266750',
   timestamptz '2026-01-01 12:00:00+00' - interval '50 minutes'); -- idx6

-- idx3 (status_change): reusa la fila que el trigger `trg_lead_status_history` YA insertó al
-- crear L_ACT (old_status=null, new_status='visit_scheduled') — no se inserta una fila extra
-- (evitaría un 14º evento fuera de control); se le fija el reloj a t-30 para su posición.
update public.lead_status_history
  set changed_at = timestamptz '2026-01-01 12:00:00+00' - interval '30 minutes'
  where lead_id = '00000000-0000-0000-0000-000000266772';

-- ── Decoys (D-SCOPE): NO deben aparecer en lead_activity(L_ACT) ─────────────────────────────
insert into public.events_raw (event_type, user_id, property_id, payload, created_at) values
  -- DECOY1: el MISMO usuario (U_ACT) sobre una propiedad de OTRO agente (AG2/P_OTHER).
  ('video_view', '00000000-0000-0000-0000-000000266709', '00000000-0000-0000-0000-000000266752', '{}'::jsonb,
   timestamptz '2026-01-01 12:00:00+00' - interval '500 minutes'),
  -- DECOY2: OTRO usuario (U1, el de L1) sobre la MISMA propiedad del agente (P1) — pero U1 no
  -- es el usuario de L_ACT.
  ('video_view', '00000000-0000-0000-0000-000000266701', '00000000-0000-0000-0000-000000266750', '{}'::jsonb,
   timestamptz '2026-01-01 12:00:00+00' - interval '600 minutes');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) CATÁLOGO — public.crm_lead_detail. Seguro aunque no exista: has_function/
--    pg_get_function_*/function_privs_are resuelven "not ok" sin lanzar.
-- ════════════════════════════════════════════════════════════════════════════

select has_function('public', 'crm_lead_detail', array['uuid'],
  'SIG1_crm_lead_detail_existe_con_la_firma_p_lead_id');

select is(
  (select pg_get_function_result(to_regprocedure('public.crm_lead_detail(uuid)'))),
  'TABLE(origin_property jsonb, other_properties integer, suggested_next_status text)',
  'SIG2_crm_lead_detail_returns_table_EXACTA'
);

select is(
  (select pg_get_function_arguments(to_regprocedure('public.crm_lead_detail(uuid)'))),
  'p_lead_id uuid',
  'SIG3_crm_lead_detail_argumentos_EXACTOS'
);

select is(
  (select prosecdef from pg_proc where proname = 'crm_lead_detail' and pronamespace = 'public'::regnamespace),
  true, 'SIG4_crm_lead_detail_es_security_definer'
);

select is(
  (select provolatile from pg_proc where proname = 'crm_lead_detail' and pronamespace = 'public'::regnamespace),
  's', 'SIG5_crm_lead_detail_es_stable'
);

select is(
  (select proconfig from pg_proc where proname = 'crm_lead_detail' and pronamespace = 'public'::regnamespace),
  array['search_path=""']::text[],
  'SIG6_crm_lead_detail_search_path_vacio'
);

select function_privs_are('public', 'crm_lead_detail', array['uuid'], 'anon', array[]::name[],
  'ACL1_crm_lead_detail_anon_SIN_execute');
select function_privs_are('public', 'crm_lead_detail', array['uuid'], 'authenticated', array['EXECUTE']::name[],
  'ACL2_crm_lead_detail_authenticated_CON_execute');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) CATÁLOGO — public.lead_activity.
-- ════════════════════════════════════════════════════════════════════════════

select has_function('public', 'lead_activity', array['uuid', 'int', 'timestamptz'],
  'SIG1B_lead_activity_existe_con_la_firma_declarada');

select is(
  (select pg_get_function_result(to_regprocedure('public.lead_activity(uuid,int,timestamptz)'))),
  'TABLE(occurred_at timestamp with time zone, kind text, detail jsonb)',
  'SIG2B_lead_activity_returns_table_EXACTA'
);

select is(
  (select pg_get_function_arguments(to_regprocedure('public.lead_activity(uuid,int,timestamptz)'))),
  'p_lead_id uuid, p_limit integer DEFAULT 20, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone',
  'SIG3B_lead_activity_argumentos_EXACTOS_con_defaults_D_DEFAULTS'
);

select is(
  (select prosecdef from pg_proc where proname = 'lead_activity' and pronamespace = 'public'::regnamespace),
  true, 'SIG4B_lead_activity_es_security_definer'
);

select is(
  (select provolatile from pg_proc where proname = 'lead_activity' and pronamespace = 'public'::regnamespace),
  's', 'SIG5B_lead_activity_es_stable'
);

select is(
  (select proconfig from pg_proc where proname = 'lead_activity' and pronamespace = 'public'::regnamespace),
  array['search_path=""']::text[],
  'SIG6B_lead_activity_search_path_vacio'
);

select function_privs_are('public', 'lead_activity', array['uuid', 'int', 'timestamptz'], 'anon', array[]::name[],
  'ACL1B_lead_activity_anon_SIN_execute');
select function_privs_are('public', 'lead_activity', array['uuid', 'int', 'timestamptz'], 'authenticated', array['EXECUTE']::name[],
  'ACL2B_lead_activity_authenticated_CON_execute');

-- ════════════════════════════════════════════════════════════════════════════
-- 3) ACL REAL — anon denegado en su PRIMERA invocación real de CADA función (gotcha 203.1).
--    SIN wrapper: throws_ok directo, necesita el 42501 real, no el sentinel.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select * from public.crm_lead_detail('00000000-0000-0000-0000-000000266770'::uuid) $$,
  '42501', null, 'ACLREAL1_anon_no_puede_ejecutar_crm_lead_detail'
);
reset role;

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select * from public.lead_activity('00000000-0000-0000-0000-000000266772'::uuid, 20, null) $$,
  '42501', null, 'ACLREAL2_anon_no_puede_ejecutar_lead_activity'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) AUTORIZACIÓN — crm_lead_detail (D-AUTZ-SHARED: matriz completa aquí).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000266700'); -- AG1, dueño
select is(
  jsonb_array_length(pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266770')),
  1, 'AUTZ1_agente_dueno_ve_su_lead'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266703'); -- OWN, owner ACTIVO de la agencia de AG1
select is(
  jsonb_array_length(pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266770')),
  1, 'AUTZ2_owner_de_la_agencia_ve_el_lead'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266704'); -- ADM, admin ACTIVO de la agencia de AG1
select is(
  jsonb_array_length(pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266770')),
  1, 'AUTZ3_admin_de_la_agencia_ve_el_lead'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266706'); -- AGPAR, agente PAR de AG1 en la MISMA agencia
select is(
  jsonb_array_length(pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266770')),
  0, 'AUTZ4_agente_par_de_la_misma_agencia_0_filas'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266702'); -- AG2, agente de OTRA agencia (ajeno)
select is(
  jsonb_array_length(pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266770')),
  0, 'AUTZ5_agente_de_otra_agencia_0_filas'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266705'); -- PADMIN, admin de PLATAFORMA sin relación
select is(
  jsonb_array_length(pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266770')),
  0, 'AUTZ6_admin_de_plataforma_sin_relacion_0_filas_226'
);

-- AUTZ7 en el mismo rol (PADMIN, no importa quién pregunte: nunca hay excepción).
select is(
  pg_temp.lead_detail_json('00000000-0000-0000-0000-0000002669ff'),
  '[]'::jsonb, 'AUTZ7_lead_inexistente_0_filas_sin_excepcion'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) DELETED_AT — D-DELETED: can_view_lead NO filtra deleted_at; el CUERPO de la RPC debe
--    hacerlo explícito. L_DEL ya quedó borrado en los fixtures (arriba).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000266700'); -- AG1, agente dueño de L_DEL
select is(
  jsonb_array_length(pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266771')),
  0, 'AUTZ8_lead_borrado_agente_dueno_0_filas'
);
select is(
  jsonb_array_length(pg_temp.activity_json('00000000-0000-0000-0000-000000266771', 20, null)),
  0, 'ACTAUTZ1_lead_activity_lead_borrado_0_filas'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000266703'); -- OWN, owner de la agencia — "para TODOS"
select is(
  jsonb_array_length(pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266771')),
  0, 'AUTZ9_lead_borrado_owner_agencia_0_filas_para_todos'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) COMPORTAMIENTO — public.crm_lead_detail (origin_property/other_properties/
--    suggested_next_status). Contexto AG1 (dueño) en todo lo que sigue.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000266700'); -- AG1

select is(
  ((pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266770')) -> 0 -> 'origin_property' ->> 'property_id'),
  '00000000-0000-0000-0000-000000266750',
  'ORIGIN1_origin_property_es_la_fila_con_menor_contacted_at_P1_no_P2'
);

select is(
  ((pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266770')) -> 0 -> 'origin_property'),
  jsonb_build_object(
    'property_id', '00000000-0000-0000-0000-000000266750',
    'address', 'Fixture 266.5 — P1 (origen, mas antigua, price_visible=false)',
    'price', 15000,
    'thumbnail_url', 'https://cdn.test.local/266.5/p1-portada.jpg'
  ),
  'ORIGIN2_origin_property_jsonb_EXACTO_incluye_precio_real_pese_a_price_visible_false_D_PRICE'
);

select is(
  ((pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266770')) -> 0 ->> 'other_properties')::int,
  1, 'OTHER1_other_properties_cuenta_extra_menos_uno_dos_origenes'
);

select is(
  ((pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266773')) -> 0 ->> 'other_properties')::int,
  0, 'OTHER2_other_properties_cero_con_una_sola_propiedad_de_origen'
);

-- STATUS1-11: los 11 valores reales del enum lead_status (D-STATUSPROJ), NULL con is(x,null)
-- explícito para Visita y los 5 estados cerrados. pg_temp.detail_field exige 1 fila real antes
-- de leer el campo (guardia anti-vacuo, ver su comentario).
select is(
  pg_temp.detail_field(pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266773'), 'suggested_next_status'),
  'contacted', 'STATUS1_whatsapp_opened_sugiere_contacted'
);
select is(
  pg_temp.detail_field(pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266774'), 'suggested_next_status'),
  'contacted', 'STATUS2_new_legacy_sugiere_contacted'
);
select is(
  pg_temp.detail_field(pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266775'), 'suggested_next_status'),
  'visit_scheduled', 'STATUS3_contacted_sugiere_visit_scheduled'
);
select is(
  pg_temp.detail_field(pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266776'), 'suggested_next_status'),
  'visit_scheduled', 'STATUS4_interested_sugiere_visit_scheduled'
);
select is(
  pg_temp.detail_field(pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266777'), 'suggested_next_status'),
  'visit_scheduled', 'STATUS5_in_progress_legacy_sugiere_visit_scheduled'
);
select is(
  pg_temp.detail_field(pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266778'), 'suggested_next_status'),
  null, 'STATUS6_visit_scheduled_sugiere_null_abre_desplegable'
);
select is(
  pg_temp.detail_field(pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266779'), 'suggested_next_status'),
  null, 'STATUS7_closed_won_rent_sugiere_null'
);
select is(
  pg_temp.detail_field(pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266780'), 'suggested_next_status'),
  null, 'STATUS8_closed_won_sale_sugiere_null'
);
select is(
  pg_temp.detail_field(pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266781'), 'suggested_next_status'),
  null, 'STATUS9_closed_lost_sugiere_null'
);
select is(
  pg_temp.detail_field(pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266782'), 'suggested_next_status'),
  null, 'STATUS10_discarded_sugiere_null'
);
select is(
  pg_temp.detail_field(pg_temp.lead_detail_json('00000000-0000-0000-0000-000000266783'), 'suggested_next_status'),
  null, 'STATUS11_closed_won_legacy_sugiere_null'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) COMPORTAMIENTO — public.lead_activity (kinds/detail, privacidad, orden, cursor).
--    Contexto AG1 (dueño de L_ACT) salvo donde se indique otro rol.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000266700'); -- AG1, dueño de L_ACT

select is(
  jsonb_array_length(pg_temp.activity_json('00000000-0000-0000-0000-000000266772', 50, null)),
  13, 'ACTAUTZ2_agente_dueno_ve_las_13_filas_de_su_lead_sin_los_2_decoys'
);

-- KIND1-5: un caso por fuente, con su `detail` EXACTO (D-KIND/D-DETAIL). Índices sobre el
-- array de 50 filas (orden global, sin paginar) — ver D-CURSOR para el mapa idx0..idx12.
select is(
  ((pg_temp.activity_json('00000000-0000-0000-0000-000000266772', 50, null)) -> 0),
  jsonb_build_object(
    'occurred_at', '2026-01-01T12:00:00+00:00',
    'kind', 'video_view',
    'detail', jsonb_build_object('property_id', '00000000-0000-0000-0000-000000266750', 'payload', '{"progress": 50}'::jsonb)
  ),
  'KIND1_video_view_con_su_detail_property_id_y_payload'
);
select is(
  ((pg_temp.activity_json('00000000-0000-0000-0000-000000266772', 50, null)) -> 1 ->> 'kind'),
  'video_completed', 'KIND2_video_completed_aparece_como_su_propio_kind'
);
select is(
  ((pg_temp.activity_json('00000000-0000-0000-0000-000000266772', 50, null)) -> 4),
  jsonb_build_object(
    'occurred_at', '2026-01-01T11:20:00+00:00',
    'kind', 'like',
    'detail', jsonb_build_object('property_id', '00000000-0000-0000-0000-000000266750')
  ),
  'KIND3_like_con_su_detail_property_id'
);
select is(
  ((pg_temp.activity_json('00000000-0000-0000-0000-000000266772', 50, null)) -> 6),
  jsonb_build_object(
    'occurred_at', '2026-01-01T11:10:00+00:00',
    'kind', 'save',
    'detail', jsonb_build_object('property_id', '00000000-0000-0000-0000-000000266750')
  ),
  'KIND4_save_con_su_detail_property_id'
);
select is(
  ((pg_temp.activity_json('00000000-0000-0000-0000-000000266772', 50, null)) -> 3),
  jsonb_build_object(
    'occurred_at', '2026-01-01T11:30:00+00:00',
    'kind', 'status_change',
    'detail', jsonb_build_object('old_status', null, 'new_status', 'visit_scheduled')
  ),
  'KIND5_status_change_con_su_detail_old_status_y_new_status'
);

-- PRIV_EVENT1-2 (D-SCOPE): los 2 decoys nunca aparecen. Guardia anti-vacuo: se compara
-- {total, matching} en UN solo jsonb — así un array sentinel (total=2, no 13) NUNCA coincide
-- con el esperado {13,0}, aunque "matching" solo por casualidad diera 0 (el sentinel no tiene
-- 'detail'/'occurred_at' con esas claves).
select is(
  (select jsonb_build_object(
     'total', jsonb_array_length(v),
     'matching', (select count(*) from jsonb_array_elements(v) e
                   where e -> 'detail' ->> 'property_id' = '00000000-0000-0000-0000-000000266752')
   ) from (select pg_temp.activity_json('00000000-0000-0000-0000-000000266772', 50, null) as v) s),
  jsonb_build_object('total', 13, 'matching', 0),
  'PRIV_EVENT1_evento_de_propiedad_de_otro_agente_no_aparece_aunque_mismo_usuario'
);
select is(
  (select jsonb_build_object(
     'total', jsonb_array_length(v),
     -- t-600min = DECOY2 (otro usuario, misma propiedad P1).
     'matching', (select count(*) from jsonb_array_elements(v) e
                   where e ->> 'occurred_at' = '2026-01-01T02:00:00+00:00')
   ) from (select pg_temp.activity_json('00000000-0000-0000-0000-000000266772', 50, null) as v) s),
  jsonb_build_object('total', 13, 'matching', 0),
  'PRIV_EVENT2_evento_de_otro_usuario_en_la_misma_propiedad_no_aparece'
);

-- ORDER1: la secuencia COMPLETA de 13 kinds en el orden EXACTO (occurred_at desc, kind asc en
-- el empate idx4/idx5) — literal independiente, no recalculado de la misma consulta del SUT.
select is(
  pg_temp.kind_seq(pg_temp.activity_json('00000000-0000-0000-0000-000000266772', 50, null)),
  '["video_view","video_completed","video_view","status_change","like","video_view","save","video_view","video_completed","video_view","video_view","video_view","video_view"]'::jsonb,
  'ORDER1_orden_global_occurred_at_desc_con_desempate_por_kind_en_el_empate'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8) CURSOR — 3 páginas (p_limit=5) sobre las 13 filas de L_ACT. La 1a página CRUZA el
--    empate idx4/idx5 (mismo occurred_at) y lo devuelve COMPLETO (D-CURSOR: nunca lo parte),
--    por eso trae 6 filas en vez de 5.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  pg_temp.kind_seq(pg_temp.activity_json('00000000-0000-0000-0000-000000266772', 5, null)),
  '["video_view","video_completed","video_view","status_change","like","video_view"]'::jsonb,
  'CURSOR1_primera_pagina_null_EXPANDE_el_empate_de_frontera_devuelve_6_no_5'
);

select is(
  pg_temp.kind_seq(pg_temp.activity_json(
    '00000000-0000-0000-0000-000000266772', 5, timestamptz '2026-01-01 12:00:00+00' - interval '40 minutes'
  )),
  '["save","video_view","video_completed","video_view","video_view"]'::jsonb,
  'CURSOR2_segunda_pagina_continua_estrictamente_DESPUES_del_empate_sin_repetirlo'
);

select is(
  pg_temp.kind_seq(pg_temp.activity_json(
    '00000000-0000-0000-0000-000000266772', 5, timestamptz '2026-01-01 12:00:00+00' - interval '90 minutes'
  )),
  '["video_view","video_view"]'::jsonb,
  'CURSOR3_tercera_pagina_es_la_ULTIMA_con_las_2_filas_restantes'
);

select is(
  jsonb_array_length(pg_temp.activity_json(
    '00000000-0000-0000-0000-000000266772', 5, timestamptz '2026-01-01 12:00:00+00' - interval '110 minutes'
  )),
  0, 'CURSOR4_pagina_despues_de_la_ultima_fila_0_filas_sin_mas_paginas'
);

-- LIMIT1/2 (hallazgo del guardian, 266.5): p_limit degenerado NO abre la página completa.
-- 0 (o negativo) se acota a 1 → estrictamente menos que las 13 filas del lead; NULL = default 20 → las 13.
select cmp_ok(
  jsonb_array_length(pg_temp.activity_json('00000000-0000-0000-0000-000000266772', 0, null)),
  '<', 13,
  'LIMIT1_p_limit_0_no_devuelve_el_timeline_completo'
);
select is(
  jsonb_array_length(pg_temp.activity_json('00000000-0000-0000-0000-000000266772', null, null)),
  13,
  'LIMIT2_p_limit_NULL_usa_el_default_20_y_devuelve_las_13_filas'
);

-- CURSOR5: la concatenación de las 3 páginas REALES (no recalculada) = el literal completo de
-- 13 kinds de ORDER1 — ninguna fila repetida ni omitida a través de las páginas.
select is(
  (pg_temp.kind_seq(pg_temp.activity_json('00000000-0000-0000-0000-000000266772', 5, null)))
  || (pg_temp.kind_seq(pg_temp.activity_json(
       '00000000-0000-0000-0000-000000266772', 5, timestamptz '2026-01-01 12:00:00+00' - interval '40 minutes'
     )))
  || (pg_temp.kind_seq(pg_temp.activity_json(
       '00000000-0000-0000-0000-000000266772', 5, timestamptz '2026-01-01 12:00:00+00' - interval '90 minutes'
     ))),
  '["video_view","video_completed","video_view","status_change","like","video_view","save","video_view","video_completed","video_view","video_view","video_view","video_view"]'::jsonb,
  'CURSOR5_union_de_las_3_paginas_reales_13_filas_exactas_sin_duplicar_ni_omitir'
);
reset role;

-- ACTAUTZ3-4: agente ajeno y lead inexistente, mismo criterio fail-closed que crm_lead_detail
-- (D-AUTZ-SHARED).
select pg_temp.act_as('00000000-0000-0000-0000-000000266702'); -- AG2, ajeno
select is(
  jsonb_array_length(pg_temp.activity_json('00000000-0000-0000-0000-000000266772', 50, null)),
  0, 'ACTAUTZ3_agente_ajeno_0_filas'
);
select is(
  pg_temp.activity_json('00000000-0000-0000-0000-0000002669ff', 50, null),
  '[]'::jsonb, 'ACTAUTZ4_lead_inexistente_0_filas_sin_excepcion'
);
reset role;

select * from finish();
rollback;
