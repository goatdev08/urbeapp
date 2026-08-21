-- Tests pgTAP — public.notify_ads_expiring_soon() (subtarea #171.4, panel del
-- anunciante, tarea 171). Ejecutar con:
--   supabase test db supabase/tests/63_notify_ads_expiring_soon_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de
-- una transacción revertida (no persiste). Impersonamos con
-- pg_temp.act_as(uid, role) (mismo patrón que 02/16/25/37/43/44/46/47/48/51/
-- 52/53/62_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: el contrato PÚBLICO de la función — firma de catálogo,
-- autorización por GRANT/REVOKE ejercitada con impersonación JWT real, y las
-- FILAS que deja en public.notifications tras invocarla con datos reales
-- sembrados a mano. NUNCA internals (no se valida el cuerpo del plpgsql).
--
-- SUT (AÚN NO EXISTE — RED 2026-08-21): una migración GREEN debe crear
--
--   public.notify_ads_expiring_soon() returns integer
--   security definer, set search_path = '' (cuerpo entero calificado por
--   schema), patrón EXACTO de public.purge_ad_impressions (20260817000002).
--   revoke execute from public, anon, authenticated; grant execute to
--   service_role. Devuelve cuántas filas insertó (testeable, nunca NULL).
--   Programada vía pg_cron (extensión YA instalada por 170.5, se REUSA):
--   jobname='notify_ads_expiring_soon_daily', schedule='0 15 * * *'
--   (9:00 CDMX = 15:00 UTC, servidor en UTC — mismo gotcha de zona pagado por
--   el guardián de 170.5, horario distinto de la purga '0 9 * * *' para no
--   competir en la misma ventana), command='select
--   public.notify_ads_expiring_soon();'.
--
-- ── Por qué SOLO status='active' (documentado a propósito, no un olvido) ────
-- La exploración 039 dejó abierta la pregunta "¿la vigencia pagada se pausa o
-- se pierde cuando se suspende el negocio?" — D2 (169.2) ya resuelve el reloj
-- de un ad pausado por suspensión de la organización (paused_by_suspension),
-- pero NO resuelve si ese ad pausado debería seguir avisando a su dueño que
-- "está por expirar" mientras está paused. Un job de notificaciones no puede
-- decidir en silencio una regla de negocio que ni el propio dueño del dominio
-- ha fijado — así que este contrato avisa del caso INDISCUTIBLE ('active',
-- vigente, corriendo) y dejamos 'paused' fuera hasta que Abraham lo resuelva
-- (ver EDGE_STATUS_paused abajo: se prueba explícitamente que NO avisa hoy).
--
-- ── D-KEY (decisión de diseño del test-author, 2026-08-21, NO estaba fijada
--    por el orquestador) — el nombre de la llave del título dentro de `data`.
--    El contrato solo exige "el título del anuncio" en `data`, sin fijar la
--    llave. Se fija aquí `data->>'ad_title'` (snake_case, sin colisionar con
--    `title` de la fila de notifications, que es el título DEL AVISO, no del
--    anuncio) — el GREEN debe usar exactamente esta llave.
--
-- ── D-BORDE (decisión de diseño del test-author) — ends_at = now() EXACTO.
--    La ventana del contrato es [now(), now()+7d] (ambos corchetes cerrados,
--    contrato literal del orquestador) — se decide INCLUSIVO en el extremo
--    inferior: un anuncio que expira EN ESTE INSTANTE es el caso MÁS urgente
--    de avisar, no el más discutible de excluir por un `>` estricto.
--
-- ── Estrategia RED sin depender de "function does not exist" ────────────────
-- Se SIGUE el patrón ya establecido en 51/53/62_*: NUNCA se crea una
-- migración-stub (ese archivo lo escribe el GREEN). (a) los asserts de
-- catálogo puro (pg_proc/pg_get_function_*) son seguros aunque la función no
-- exista — resuelven NULL/false sin lanzar; (b) TODA llamada real
-- (`select public.notify_ads_expiring_soon()`) va dentro de un bloque
-- `do $$ ... exception when others then ... $$` AUTO-PROTEGIDO que escribe su
-- resultado en una tabla temporal — así el archivo entero corre sin abortar
-- pese al 42883 ("function does not exist") de HOY, y las aserciones de
-- valores fallan limpio contra tablas temporales vacías/NULL en vez del real
-- 3/7/0 esperado. DELTA total: ninguna aserción de este archivo puede pasar
-- hoy por la razón correcta.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────
-- Firma pública: catálogo EXACTO (sin argumentos, returns integer, security
--   definer, search_path='').
-- Autorización: authenticated NO ejecuta (42501, mismo patrón GRANT3 de
--   51_ad_impressions_test.sql); anon tampoco.
-- pg_cron: existe 1 fila en cron.job con jobname/schedule/command exactos.
-- HAPPY PATH + IDEMPOTENCIA (#1): correr el job dos veces seguidas produce
--   EXACTAMENTE las mismas filas — cero filas nuevas en la segunda corrida —
--   y el valor de retorno de la 2ª corrida es 0.
-- Fronteras de la ventana (#2), las 4: ends_at a 7 días exactos -> avisa;
--   a 8 días -> no avisa; ya vencido (ends_at<now()) -> no avisa; ends_at=now()
--   exacto -> avisa (D-BORDE arriba).
-- Matriz de membresía (#3): 2 owners + 1 admin + 1 agent + 1 viewer + 1
--   suspended en la misma organización -> EXACTAMENTE 3 filas, y son
--   PRECISAMENTE los 2 owners + el admin (comparación de array_agg ordenado,
--   no solo un conteo — un mutante que avisara a agent/viewer en vez de a un
--   owner pasaría un conteo=3 pero fallaría el array exacto).
-- Aislamiento multi-tenant (#4): un ad de OTRA organización no genera fila
--   para los miembros de esta, en ninguna dirección (A no ve avisos de B,
--   B no ve avisos de A).
-- Cada ad_status que NO es active (#5), las 5 ramas del enum completo:
--   draft, pending_review, paused (con paused_at, CHECK real), rejected (con
--   rejection_reason, CHECK real), expired -> 0 filas cada una, con ends_at
--   DENTRO de la ventana para probar que es el STATUS el que excluye, no la
--   fecha.
-- Extender ends_at (#6): un ad fuera de ventana (8 días) se actualiza a 5
--   días -> SÍ aparece un aviso nuevo en la 3ª corrida (el ancla incluye
--   ends_at) — y los avisos YA anclados de otros ads NO se duplican en esa
--   misma 3ª corrida.
-- Retorno == filas insertadas (#7): la 1ª corrida retorna literal 7 (3 de
--   ad_7d + 3 de ad_now + 1 de ORG_B), calculado A MANO desde el fixture,
--   nunca re-derivado con la misma expresión SQL que usará el SUT; la 2ª
--   corrida retorna 0; la 3ª retorna 3.
-- Contrato de la fila (#10): type, deep_link, related_entity_type/_id,
--   data->>'ends_at' (formato UTC determinista, literal independiente vía
--   to_char — mismo criterio que el literal exacto de CRON3 en
--   51_ad_impressions_test.sql), data->>'ad_title' (D-KEY arriba), title en
--   español mencionando "expira".
-- 🔒 Privacidad (#11): `data` no trae ninguna llave fuera de {ends_at,
--   ad_title} (ni email/phone/name/user_id/session_id), y ni title ni body
--   contienen el correo del destinatario.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(45);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) Fixtures — self-contained, prefijo '630XXX' (fuera del rango de otros
--    archivos: 51 usa '510XXX', 62 usa '620XXX', 53 usa '530XXX').
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000630001', 'owner1_a_notify63@urbea.mx'),
  ('00000000-0000-0000-0000-000000630002', 'owner2_a_notify63@urbea.mx'),
  ('00000000-0000-0000-0000-000000630003', 'admin_a_notify63@urbea.mx'),
  ('00000000-0000-0000-0000-000000630004', 'agent_a_notify63@urbea.mx'),
  ('00000000-0000-0000-0000-000000630005', 'viewer_a_notify63@urbea.mx'),
  ('00000000-0000-0000-0000-000000630006', 'suspended_a_notify63@urbea.mx'),
  ('00000000-0000-0000-0000-000000630007', 'owner_b_notify63@urbea.mx'),
  ('00000000-0000-0000-0000-000000630008', 'owner_suspendido_a_notify63@urbea.mx');

-- ORG_A: sujeto principal (membresía completa + todos los edge de ventana y
--   de status). ORG_B: aislamiento multi-tenant (#4), un solo owner.
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000630101', 'Agencia Notify A 63', 'agencia-notify-a-63',
   'active', '00000000-0000-0000-0000-000000630001'),
  ('00000000-0000-0000-0000-000000630102', 'Agencia Notify B 63', 'agencia-notify-b-63',
   'active', '00000000-0000-0000-0000-000000630007');

insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000630101', '00000000-0000-0000-0000-000000630001', 'owner', 'active'),      -- OWNER1_A
  ('00000000-0000-0000-0000-000000630101', '00000000-0000-0000-0000-000000630002', 'owner', 'active'),      -- OWNER2_A
  ('00000000-0000-0000-0000-000000630101', '00000000-0000-0000-0000-000000630003', 'admin', 'active'),      -- ADMIN_A
  ('00000000-0000-0000-0000-000000630101', '00000000-0000-0000-0000-000000630004', 'agent', 'active'),      -- AGENT_A (no gestiona -- no avisa)
  ('00000000-0000-0000-0000-000000630101', '00000000-0000-0000-0000-000000630005', 'viewer', 'active'),     -- VIEWER_A (no gestiona -- no avisa)
  ('00000000-0000-0000-0000-000000630101', '00000000-0000-0000-0000-000000630006', 'agent', 'suspended'),   -- SUSPENDED_A (suspendido -- no avisa)
  ('00000000-0000-0000-0000-000000630102', '00000000-0000-0000-0000-000000630007', 'owner', 'active'),      -- OWNER_B
  -- 🔴 OWNER_SUSPENDIDO_A -- hallazgo del guardián de 171.4 (violación 1). El único
  -- miembro suspendido del fixture original era un `agent`, así que el filtro de ROL
  -- (member_role in ('owner','admin')) ya lo excluía y el filtro de ESTADO
  -- (am.status = 'active') NUNCA se ejercitaba: quitarlo del SUT dejaba los 42 asserts
  -- en verde. Este miembro es owner Y suspendido, la única combinación que distingue
  -- las dos defensas. MEMBERS1 sigue exigiendo EXACTAMENTE 3 destinatarios.
  ('00000000-0000-0000-0000-000000630101', '00000000-0000-0000-0000-000000630008', 'owner', 'suspended');   -- OWNER_SUSPENDIDO_A

insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000630201', '00000000-0000-0000-0000-000000630101', 'ready'),
  ('00000000-0000-0000-0000-000000630202', '00000000-0000-0000-0000-000000630102', 'ready');

-- ── Ads de ORG_A: ventana + status, todos con starts_at ya corrido ──────────
-- ad_7d       (7d exactos, active)   -> AVISA (frontera superior inclusiva)
-- ad_now      (now() exacto, active) -> AVISA (D-BORDE)
-- ad_8d       (8d, active)           -> NO avisa (fuera de ventana) hasta #6
-- ad_expired  (-1d, active)          -> NO avisa (ya vencido)
-- ad_draft/ad_pending/ad_expired_status (3d, status != active) -> NO avisan
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000630301', '00000000-0000-0000-0000-000000630101', '00000000-0000-0000-0000-000000630201',
   'Anuncio Notify 63 Siete Dias', 'phone', '+5213300006301', 'active', now() - interval '1 day', now() + interval '7 days'),
  ('00000000-0000-0000-0000-000000630304', '00000000-0000-0000-0000-000000630101', '00000000-0000-0000-0000-000000630201',
   'Anuncio Notify 63 Ahora Mismo', 'phone', '+5213300006304', 'active', now() - interval '1 day', now()),
  ('00000000-0000-0000-0000-000000630302', '00000000-0000-0000-0000-000000630101', '00000000-0000-0000-0000-000000630201',
   'Anuncio Notify 63 Ocho Dias', 'phone', '+5213300006302', 'active', now() - interval '1 day', now() + interval '8 days'),
  ('00000000-0000-0000-0000-000000630303', '00000000-0000-0000-0000-000000630101', '00000000-0000-0000-0000-000000630201',
   'Anuncio Notify 63 Ya Vencido', 'phone', '+5213300006303', 'active', now() - interval '10 days', now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000630305', '00000000-0000-0000-0000-000000630101', '00000000-0000-0000-0000-000000630201',
   'Anuncio Notify 63 Draft', 'phone', '+5213300006305', 'draft', now() - interval '1 day', now() + interval '3 days'),
  ('00000000-0000-0000-0000-000000630307', '00000000-0000-0000-0000-000000630101', '00000000-0000-0000-0000-000000630201',
   'Anuncio Notify 63 Pending Review', 'phone', '+5213300006307', 'pending_review', now() - interval '1 day', now() + interval '3 days'),
  ('00000000-0000-0000-0000-000000630309', '00000000-0000-0000-0000-000000630101', '00000000-0000-0000-0000-000000630201',
   'Anuncio Notify 63 Expired Status', 'phone', '+5213300006309', 'expired', now() - interval '1 day', now() + interval '3 days'),
  ('00000000-0000-0000-0000-000000630310', '00000000-0000-0000-0000-000000630102', '00000000-0000-0000-0000-000000630202',
   'Anuncio Notify 63 Org B', 'phone', '+5213300006310', 'active', now() - interval '1 day', now() + interval '2 days');

-- 'paused' exige paused_at (CHECK ads_paused_at_matches_status real).
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at, paused_at) values
  ('00000000-0000-0000-0000-000000630306', '00000000-0000-0000-0000-000000630101', '00000000-0000-0000-0000-000000630201',
   'Anuncio Notify 63 Paused', 'phone', '+5213300006306', 'paused', now() - interval '1 day', now() + interval '3 days', now());

-- 'rejected' exige rejection_reason (CHECK ads_rejection_reason_matches_status real).
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at, rejection_reason) values
  ('00000000-0000-0000-0000-000000630308', '00000000-0000-0000-0000-000000630101', '00000000-0000-0000-0000-000000630201',
   'Anuncio Notify 63 Rejected', 'phone', '+5213300006308', 'rejected', now() - interval '1 day', now() + interval '3 days', 'motivo prueba 63');

select is((select count(*)::int from public.ads where agency_id = '00000000-0000-0000-0000-000000630101'),
  9, 'FIXTURE_ANCHOR1_org_A_tiene_exactamente_9_ads_sembrados');
select is((select count(*)::int from public.agency_members where agency_id = '00000000-0000-0000-0000-000000630101'),
  7, 'FIXTURE_ANCHOR2_org_A_tiene_exactamente_7_miembros_sembrados');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Firma pública — catálogo EXACTO, nunca reescrito a mano.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_sig_63 (ok boolean, result_sig text, args_sig text);
do $$
declare
  v_oid oid;
begin
  v_oid := to_regprocedure('public.notify_ads_expiring_soon()');
  if v_oid is null then
    insert into result_sig_63 values (false, null, null);
  else
    insert into result_sig_63
    select true, pg_get_function_result(v_oid), pg_get_function_arguments(v_oid);
  end if;
exception when others then
  insert into result_sig_63 values (false, null, null);
end $$;

select is((select ok from result_sig_63), true,
  'SIG1_la_funcion_resuelve_por_catalogo_sin_argumentos');
select is((select result_sig from result_sig_63), 'integer',
  'SIG2_retorna_integer_las_filas_realmente_insertadas');
select is(coalesce((select args_sig from result_sig_63), 'ERR'), '',
  'SIG3_no_recibe_ningun_argumento');
select is(
  (select prosecdef from pg_proc where proname = 'notify_ads_expiring_soon' and pronamespace = 'public'::regnamespace),
  true, 'SIG4_es_security_definer');
select is(
  (select proconfig from pg_proc where proname = 'notify_ads_expiring_soon' and pronamespace = 'public'::regnamespace),
  array['search_path=""']::text[], 'SIG5_search_path_vacio_fijo_patron_purge_ad_impressions');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Autorización — GRANT/REVOKE ejercitado con impersonación real.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000630001', 'authenticated'); -- OWNER1_A, dueño legítimo
select throws_ok(
  $$ select public.notify_ads_expiring_soon() $$,
  '42501', null,
  'AUTH1_authenticated_no_puede_ejecutar_ni_siendo_el_dueno_legitimo_del_anuncio_sin_grant_de_execute'
);
reset role;

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select public.notify_ads_expiring_soon() $$,
  '42501', null,
  'AUTH2_anon_no_puede_ejecutar_el_job'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) pg_cron — jobname/schedule/command exactos, extensión REUSADA de 170.5.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_cron_job_63 (jobname text, schedule text, command text);
do $$
begin
  insert into result_cron_job_63
    select jobname, schedule, command from cron.job where jobname = 'notify_ads_expiring_soon_daily';
exception when others then
  null; -- si el schema cron no existiera -- no debería pasar, 170.5 ya lo instaló.
end $$;

select is((select count(*)::int from result_cron_job_63), 1,
  'CRON1_existe_exactamente_1_fila_en_cron_job_para_notify_ads_expiring_soon_daily');
select is(coalesce((select schedule from result_cron_job_63), 'NONE'), '0 15 * * *',
  'CRON2_schedule_0_15_UTC_equivalente_a_las_9am_hora_Ciudad_de_Mexico_horario_habil');
select is(coalesce((select command from result_cron_job_63), 'NONE'), 'select public.notify_ads_expiring_soon();',
  'CRON3_command_exacto_select_public_notify_ads_expiring_soon');

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Corrida 1 — happy path + ventana + status + retorno == 7.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_run1_63 (ok boolean, val int);
do $$
declare v_ret int;
begin
  v_ret := public.notify_ads_expiring_soon();
  insert into result_run1_63 values (true, v_ret);
exception when others then
  insert into result_run1_63 values (false, null);
end $$;

select is((select ok from result_run1_63), true, 'RUN1_no_lanza_excepcion');
select is(coalesce((select val::text from result_run1_63), 'ERR'), '7',
  'RUN1_retorno_literal_7_3_de_ad_7d_mas_3_de_ad_now_mas_1_de_org_B_calculado_a_mano_del_fixture');

-- ── Ventana (#2) — las 4 fronteras ──────────────────────────────────────────
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000630301' and type = 'ad_expiring_soon'),
  3, 'WINDOW1_ends_at_a_7_dias_exactos_AVISA_frontera_superior_inclusiva');
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000630304' and type = 'ad_expiring_soon'),
  3, 'WINDOW2_ends_at_now_exacto_AVISA_D_BORDE_frontera_inferior_inclusiva');
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000630302' and type = 'ad_expiring_soon'),
  0, 'WINDOW3_ends_at_a_8_dias_NO_avisa_fuera_de_la_ventana');
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000630303' and type = 'ad_expiring_soon'),
  0, 'WINDOW4_ends_at_ya_vencido_NO_avisa');

-- ── Status (#5) — las 5 ramas del enum que no son active ────────────────────
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000630305' and type = 'ad_expiring_soon'),
  0, 'STATUS1_draft_NO_avisa_pese_a_ends_at_dentro_de_la_ventana');
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000630307' and type = 'ad_expiring_soon'),
  0, 'STATUS2_pending_review_NO_avisa');
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000630306' and type = 'ad_expiring_soon'),
  0, 'STATUS3_paused_NO_avisa_pregunta_abierta_exploracion_039_sin_resolver');
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000630308' and type = 'ad_expiring_soon'),
  0, 'STATUS4_rejected_NO_avisa');
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000630309' and type = 'ad_expiring_soon'),
  0, 'STATUS5_expired_NO_avisa');

-- ── Aislamiento multi-tenant (#4) ────────────────────────────────────────────
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000630310' and type = 'ad_expiring_soon'),
  1, 'TENANT1_ad_de_org_B_genera_exactamente_1_fila_para_su_unico_owner');
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000630001' -- OWNER1_A
      and related_entity_id = '00000000-0000-0000-0000-000000630310'), -- ad de ORG_B
  0, 'TENANT2_miembro_de_org_A_NO_recibe_aviso_del_ad_de_org_B');
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000630007' -- OWNER_B
      and related_entity_id = '00000000-0000-0000-0000-000000630301'), -- ad de ORG_A
  0, 'TENANT3_owner_de_org_B_NO_recibe_aviso_del_ad_de_org_A');

-- ── Matriz de membresía (#3) — EXACTAMENTE owners+admin, ni uno mas ─────────
select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000630301' and type = 'ad_expiring_soon'),
  array[
    '00000000-0000-0000-0000-000000630001'::uuid, -- OWNER1_A
    '00000000-0000-0000-0000-000000630002'::uuid, -- OWNER2_A
    '00000000-0000-0000-0000-000000630003'::uuid  -- ADMIN_A
  ],
  'MEMBERS1_los_destinatarios_son_EXACTAMENTE_los_2_owners_y_el_admin_ni_agent_ni_viewer_ni_suspended'
);

-- ── Contrato de la fila (#10) + privacidad (#11) — sobre una fila real ──────
create temp table result_row_63 (
  n_type text, n_deep_link text, n_rel_type text, n_rel_id uuid,
  n_ends_at text, n_ad_title text, n_title text, n_body text, n_extra_keys jsonb
);
insert into result_row_63
  select type, deep_link, related_entity_type, related_entity_id,
    data->>'ends_at', data->>'ad_title', title, body, (data - 'ends_at' - 'ad_title')
  from public.notifications
  where user_id = '00000000-0000-0000-0000-000000630001'
    and related_entity_id = '00000000-0000-0000-0000-000000630301'
    and type = 'ad_expiring_soon';

select is((select n_type from result_row_63), 'ad_expiring_soon', 'FIELD1_type_ad_expiring_soon');
select is((select n_deep_link from result_row_63), '/ads', 'FIELD2_deep_link_ads');
select is((select n_rel_type from result_row_63), 'ad', 'FIELD3_related_entity_type_ad');
select is((select n_rel_id from result_row_63), '00000000-0000-0000-0000-000000630301'::uuid,
  'FIELD4_related_entity_id_es_el_id_del_ad');
select is(
  (select n_ends_at from result_row_63),
  (select to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
     from public.ads where id = '00000000-0000-0000-0000-000000630301'),
  'FIELD5_data_ends_at_formato_UTC_deterministico_YYYY_MM_DDTHH24_MI_SSZ'
);
select is((select n_ad_title from result_row_63), 'Anuncio Notify 63 Siete Dias',
  'FIELD6_data_ad_title_D_KEY_es_el_titulo_real_del_anuncio');
select ok((select n_title from result_row_63) ilike '%expira%',
  'FIELD7_title_en_espanol_menciona_expira');
select ok((select n_body from result_row_63) ilike '%Anuncio Notify 63 Siete Dias%',
  'FIELD8_body_menciona_el_titulo_del_anuncio');
select is((select n_extra_keys from result_row_63), '{}'::jsonb,
  'PRIVACY1_data_no_trae_ninguna_llave_fuera_de_ends_at_y_ad_title');
select ok(
  (select n_title from result_row_63) not ilike '%owner1_a_notify63@urbea.mx%'
  and (select n_body from result_row_63) not ilike '%owner1_a_notify63@urbea.mx%',
  'PRIVACY2_ni_title_ni_body_contienen_el_correo_del_destinatario'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Corrida 2 (inmediatamente después) — IDEMPOTENCIA (#1): 0 filas nuevas.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_run2_63 (ok boolean, val int);
do $$
declare v_ret int;
begin
  v_ret := public.notify_ads_expiring_soon();
  insert into result_run2_63 values (true, v_ret);
exception when others then
  insert into result_run2_63 values (false, null);
end $$;

select is(coalesce((select val::text from result_run2_63), 'ERR'), '0',
  'RUN2_retorno_0_correr_el_job_dos_veces_seguidas_no_genera_filas_nuevas');
select is(
  coalesce((select count(*)::int from public.notifications
     where related_entity_id in (
       '00000000-0000-0000-0000-000000630301', '00000000-0000-0000-0000-000000630304',
       '00000000-0000-0000-0000-000000630310') and type = 'ad_expiring_soon')::text, 'ERR'),
  '7',
  'RUN2_total_de_filas_sigue_siendo_7_tras_la_2a_corrida_una_sola_fila_por_anuncio_y_persona'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Extender ends_at (#6) — un ad FUERA de ventana entra al rango; los ya
--    anclados NO se duplican en la misma corrida.
-- ════════════════════════════════════════════════════════════════════════════

update public.ads set ends_at = now() + interval '5 days'
  where id = '00000000-0000-0000-0000-000000630302'; -- ad_8d -> ahora a 5 dias

create temp table result_run3_63 (ok boolean, val int);
do $$
declare v_ret int;
begin
  v_ret := public.notify_ads_expiring_soon();
  insert into result_run3_63 values (true, v_ret);
exception when others then
  insert into result_run3_63 values (false, null);
end $$;

select is(coalesce((select val::text from result_run3_63), 'ERR'), '3',
  'RUN3_retorno_3_solo_el_ad_extendido_genera_avisos_nuevos_owners_y_admin'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000630302' and type = 'ad_expiring_soon'),
  3, 'RUN3_ad_extendido_ahora_tiene_3_avisos_el_ancla_incluye_ends_at_asi_que_la_ventana_nueva_si_avisa'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000630301' and type = 'ad_expiring_soon'),
  3, 'RUN3_ad_7d_sigue_en_3_no_se_duplico_en_la_3a_corrida'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) 🔴 RENOVACIÓN de un anuncio YA ANCLADO — violación 2 del guardián de 171.4.
--    RUN3 extendía `ad_8d`, que estaba FUERA de la ventana y por tanto NUNCA
--    había recibido aviso: sin fila previa no hay conflicto que resolver, así
--    que el ancla dejaba pasar el insert CON o SIN el ends_at dentro de la
--    llave. Lo que RUN3 probaba era "un anuncio entra a la ventana por primera
--    vez", no "un anuncio ya anclado renueva su vigencia" — que es la razón
--    literal por la que el ends_at está en el índice único.
--    Aquí se extiende `ad_7d`, que YA tiene sus 3 avisos de la 1ª corrida.
--    Sonda del guardián sobre este escenario: con el ends_at en el ancla el
--    anunciante recibe el aviso nuevo; sin él, queda MUDO para siempre.
-- ════════════════════════════════════════════════════════════════════════════

update public.ads set ends_at = now() + interval '6 days'
  where id = '00000000-0000-0000-0000-000000630301'; -- ad_7d: renovado, sigue en ventana

create temp table result_run4_63 (ok boolean, val int);
do $$
declare v_ret int;
begin
  v_ret := public.notify_ads_expiring_soon();
  insert into result_run4_63 values (true, v_ret);
exception when others then
  insert into result_run4_63 values (false, null);
end $$;

select is(coalesce((select val::text from result_run4_63), 'ERR'), '3',
  'RUN4_retorno_3_renovar_un_anuncio_YA_AVISADO_genera_avisos_nuevos_para_sus_3_gestores'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000630301' and type = 'ad_expiring_soon'),
  6, 'RUN4_ad_7d_renovado_acumula_6_avisos_3_de_la_vigencia_vieja_y_3_de_la_nueva_sin_el_ends_at_en_el_ancla_serian_3_y_el_anunciante_quedaria_mudo'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8) 🔴 Un aviso BORRADO por la persona sigue anclando — decisión de producto
--    del orquestador (171.4), a raíz de la obs. 4 del guardián: el índice único
--    es parcial solo por `type`, así que una notificación con deleted_at NO NULO
--    sigue ocupando la llave y bloquea un aviso nuevo con el MISMO ends_at.
--    Eso es lo QUERIDO, no un accidente: "ya te avisé, tú lo borraste".
--    Reinsertar un aviso que alguien descartó a propósito es spam, y el job
--    corre a DIARIO — sin este comportamiento, borrar el aviso lo haría volver
--    al día siguiente, todos los días, hasta que el anuncio expirara.
--    Queda como assert para que sea contrato y no comportamiento accidental;
--    #77 (UI de notificaciones) hereda esta decisión.
-- ════════════════════════════════════════════════════════════════════════════

update public.notifications set deleted_at = now()
  where related_entity_id = '00000000-0000-0000-0000-000000630301'
    and type = 'ad_expiring_soon';

create temp table result_run5_63 (ok boolean, val int);
do $$
declare v_ret int;
begin
  v_ret := public.notify_ads_expiring_soon();
  insert into result_run5_63 values (true, v_ret);
exception when others then
  insert into result_run5_63 values (false, null);
end $$;

select is(coalesce((select val::text from result_run5_63), 'ERR'), '0',
  'RUN5_borrar_el_aviso_no_lo_hace_volver_al_dia_siguiente_el_ancla_ignora_deleted_at_a_proposito'
);

select * from finish();
rollback;
