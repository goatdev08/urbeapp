-- Tests pgTAP — Máquina de estados de public.ads por TRIGGER + auditoría
-- obligatoria en admin_actions (subtarea #169.2, exploración 039 "Tarea B").
-- Ejecutar con: supabase test db supabase/tests/48_ads_state_machine_test.sql --local
-- Corre como superusuario dentro de una transacción revertida (no persiste).
-- Impersonamos con pg_temp.act_as(uid, role) (mismo patrón que 02/16/25/37/46/47_*).
--
-- ⚠️ ARCHIVO PROPIO (no agregar asserts a 47_ads_schema_test.sql) — precedente
-- del repo: 39_moderate_property_atomic_test.sql vive separado de 37/38 porque
-- mezclar CHECKs de shape con fault-injection de trigger da un archivo grande
-- e ilegible (corrección del analista aplicada en el plan de 169.2).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: el comportamiento OBSERVABLE de un UPDATE sobre
-- public.ads.status (y sus efectos colaterales en public.admin_actions) —
-- NUNCA internals. No se valida la existencia de una función/trigger por
-- nombre; se ejercita el UPDATE real y se observa el resultado, igual que
-- 25_admin_approvals_test.sql hace con agencies/agent_applications.
--
-- SUT (AÚN NO EXISTE — RED 2026-08-16): una migración GREEN debe agregar:
--   (a) columna public.ads.paused_at timestamptz null (contrato de este RED,
--       D2 de 169.2 — "pausar el reloj" en vez de perder vigencia).
--   (b) un trigger BEFORE UPDATE ON public.ads FOR EACH ROW WHEN (old.status
--       IS DISTINCT FROM new.status) que sea la ÚNICA autoridad de la máquina
--       de estados (mismo patrón que public.handle_agency_status_change,
--       20260805000007/20260805000010):
--       — Matriz de transiciones válidas: draft→pending_review,
--         pending_review→active, active→{paused,expired,rejected},
--         paused→active. Cualquier otra combinación (incluida
--         draft→active DIRECTO) lanza P0001 'INVALID_AD_STATUS_TRANSITION'.
--       — rejected/expired son TERMINALES: ninguna transición de salida.
--       — El CHECK ads_rejection_reason_matches_status (169.1) sigue vivo sin
--         que el trigger lo enmascare (23514 si status=rejected sin
--         rejection_reason, incluso llegando por una transición VÁLIDA de la
--         matriz).
--       — Exige un admin identificado (reuso de private.resolve_admin_actor(),
--         20260805000007:52-89 — mismo P0001 'STATUS_CHANGE_REQUIRES_ADMIN')
--         ANTES de aplicar cualquier efecto — defensa en profundidad: aunque
--         el caller tenga GRANT de UPDATE (service_role), sin admin
--         identificado la transición igual falla.
--       — pending_review→active FALLA con P0001 'ORGANIZATION_SUSPENDED' si
--         la agencia dueña del ad tiene status='suspended' en ese momento.
--       — SIEMPRE inserta EXACTAMENTE una fila en public.admin_actions
--         (entity_type='ad', entity_id=ads.id) en la MISMA transacción — si
--         ese INSERT falla, TODA la transición se revierte (fault-injection).
--       — Al entrar a 'paused': paused_at := now(). Al salir de 'paused' hacia
--         'active': ends_at := ends_at + (now() - paused_at); paused_at := null
--         (D2: "pausar el reloj", conserva los días restantes).
--       — Un UPDATE que reescribe el mismo status (old = new) es un no-op
--         benigno: el WHEN clause ni siquiera dispara el trigger (ni exige
--         admin ni audita) — mismo criterio que 71.5.
--   authenticated NO tiene GRANT de UPDATE sobre ads desde 169.1
--   (20260816000005:233-235) — el owner NUNCA puede mover su propio ad,
--   ni siquiera a través de una futura RPC/EF, porque cualquier camino
--   termina en el mismo UPDATE de tabla sin privilegio.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────
-- Happy path (matriz de transiciones válidas, con auditoría):
--   · draft→pending_review, pending_review→active, active→paused,
--     paused→active, active→expired, active→rejected(con reason) — las 6
--     transiciones válidas suceden sin excepción y cada una escribe
--     EXACTAMENTE 1 fila nueva en admin_actions (entity_type='ad').
-- Edge cases del PRD / D2 (criterio "jamás se sirve sin moderación"):
--   · draft→active DIRECTO falla (el criterio central).
--   · draft→paused, pending_review→paused fallan (no están en la matriz).
--   · rejected y expired son terminales: ninguna transición de salida.
--   · rejected sin rejection_reason falla con 23514 aun llegando por una
--     transición válida (active→rejected) con admin identificado.
-- Ramas no obvias (invariantes 🔒):
--   · Fault-injection: si el INSERT de auditoría falla, la transición entera
--     se revierte (trigger veneno, DROPEADO inmediatamente después).
--   · pending_review→active bajo organización YA suspendida (status en el
--     momento de la transición, no reactivo a futuro) falla explícito.
--   · Impersonación: el OWNER no puede mover su propio ad ni por PostgREST
--     directo (42501, sin GRANT) ni un caller con GRANT de tabla pero sin
--     admin identificado (P0001, defensa en profundidad del propio trigger).
--   · No-op benigno (old.status = new.status) no exige admin ni audita.
--   · D2 "pausar el reloj": active→paused estampa paused_at=now() y NO toca
--     ends_at; paused→active recalcula ends_at sumando lo no consumido
--     (paused_at fijado a un valor conocido, NUNCA el reloj real) y limpia
--     paused_at.
--
-- ── Nota técnica: la columna paused_at (y su recálculo) AÚN NO EXISTEN ──────
-- Cualquier referencia cruda a ads.paused_at aborta la transacción completa
-- (42703 column does not exist) y todo lo que sigue se reporta en cascada
-- (mismo fenómeno documentado en 47_ads_schema_test.sql, cabecera). Por eso
-- la Sección 8 (la única que toca paused_at) va AL FINAL del archivo y cada
-- verificación positiva vive en un bloque `do $$ ... exception when others
-- ... $$` AUTO-PROTEGIDO que escribe su resultado en una tabla temporal
-- (técnica ya usada en 47_ads_schema_test.sql, cabecera) — así el resto del
-- archivo (Secciones 1-7, que NO tocan paused_at) reporta not-ok limpio uno
-- por uno, sin cascada.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(75);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- Captura ÚNICA de "ahora" para todo el archivo — dentro de UNA transacción
-- pgTAP, now()/current_timestamp devuelven SIEMPRE el mismo valor
-- (transaction_timestamp()), así que lo que el trigger calcule con now() será
-- IDÉNTICO a lo capturado aquí. Determinismo real, no un reloj que se mueve.
create temp table test_now_48 as select now() as v_now;

-- Admin actor único, reusado vía GUC en cada sección que lo necesita
-- (private.resolve_admin_actor, patrón 71.5 — Studio path, sin JWT).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000480001', 'admin_ads_48@urbea.mx');
update public.users set role = 'admin'
 where id = '00000000-0000-0000-0000-000000480001';

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Matriz de transiciones VÁLIDAS — cada una en su propio ad (aislado),
--    sembrado directo en el status de partida (el INSERT no dispara el
--    trigger BEFORE UPDATE). Cada transición: status cambia + admin_actions
--    recibe EXACTAMENTE 1 fila nueva para ese ad.
-- ════════════════════════════════════════════════════════════════════════════

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000480001', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000481002', 'owner_matriz_48@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000481001', 'Inmobiliaria Matriz 48', 'inmo-matriz-48', 'active',
   '00000000-0000-0000-0000-000000481002');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000481003', '00000000-0000-0000-0000-000000481001', 'ready');

-- ── 1.1) draft → pending_review ─────────────────────────────────────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000481011', '00000000-0000-0000-0000-000000481001',
   '00000000-0000-0000-0000-000000481003', 'Ad Matriz 1.1', 'external_url', 'https://ejemplo.mx/1',
   'draft', (select v_now from test_now_48), (select v_now + interval '30 days' from test_now_48));
update public.ads set status = 'pending_review' where id = '00000000-0000-0000-0000-000000481011';

select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000481011'),
  'pending_review',
  'MATRIZ1_draft_a_pending_review_transicion_valida_cambia_el_status'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'ad' and entity_id = '00000000-0000-0000-0000-000000481011'),
  1,
  'MATRIZ2_draft_a_pending_review_escribe_EXACTAMENTE_una_fila_en_admin_actions'
);

-- ── 1.2) pending_review → active ────────────────────────────────────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000481012', '00000000-0000-0000-0000-000000481001',
   '00000000-0000-0000-0000-000000481003', 'Ad Matriz 1.2', 'external_url', 'https://ejemplo.mx/2',
   'pending_review', (select v_now from test_now_48), (select v_now + interval '30 days' from test_now_48));
update public.ads set status = 'active' where id = '00000000-0000-0000-0000-000000481012';

select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000481012'),
  'active',
  'MATRIZ3_pending_review_a_active_transicion_valida_cambia_el_status'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'ad' and entity_id = '00000000-0000-0000-0000-000000481012'),
  1,
  'MATRIZ4_pending_review_a_active_escribe_EXACTAMENTE_una_fila_en_admin_actions'
);

-- ── 1.3) active → paused ────────────────────────────────────────────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000481013', '00000000-0000-0000-0000-000000481001',
   '00000000-0000-0000-0000-000000481003', 'Ad Matriz 1.3', 'external_url', 'https://ejemplo.mx/3',
   'active', (select v_now from test_now_48), (select v_now + interval '30 days' from test_now_48));
update public.ads set status = 'paused' where id = '00000000-0000-0000-0000-000000481013';

select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000481013'),
  'paused',
  'MATRIZ5_active_a_paused_transicion_valida_cambia_el_status'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'ad' and entity_id = '00000000-0000-0000-0000-000000481013'),
  1,
  'MATRIZ6_active_a_paused_escribe_EXACTAMENTE_una_fila_en_admin_actions'
);

-- ── 1.4) paused → active ────────────────────────────────────────────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000481014', '00000000-0000-0000-0000-000000481001',
   '00000000-0000-0000-0000-000000481003', 'Ad Matriz 1.4', 'external_url', 'https://ejemplo.mx/4',
   'paused', (select v_now from test_now_48), (select v_now + interval '30 days' from test_now_48));
update public.ads set status = 'active' where id = '00000000-0000-0000-0000-000000481014';

select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000481014'),
  'active',
  'MATRIZ7_paused_a_active_transicion_valida_cambia_el_status'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'ad' and entity_id = '00000000-0000-0000-0000-000000481014'),
  1,
  'MATRIZ8_paused_a_active_escribe_EXACTAMENTE_una_fila_en_admin_actions'
);

-- ── 1.5) active → expired ───────────────────────────────────────────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000481015', '00000000-0000-0000-0000-000000481001',
   '00000000-0000-0000-0000-000000481003', 'Ad Matriz 1.5', 'external_url', 'https://ejemplo.mx/5',
   'active', (select v_now from test_now_48), (select v_now + interval '30 days' from test_now_48));
update public.ads set status = 'expired' where id = '00000000-0000-0000-0000-000000481015';

select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000481015'),
  'expired',
  'MATRIZ9_active_a_expired_transicion_valida_cambia_el_status'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'ad' and entity_id = '00000000-0000-0000-0000-000000481015'),
  1,
  'MATRIZ10_active_a_expired_escribe_EXACTAMENTE_una_fila_en_admin_actions'
);

-- ── 1.6) active → rejected (CON rejection_reason) ───────────────────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000481016', '00000000-0000-0000-0000-000000481001',
   '00000000-0000-0000-0000-000000481003', 'Ad Matriz 1.6', 'external_url', 'https://ejemplo.mx/6',
   'active', (select v_now from test_now_48), (select v_now + interval '30 days' from test_now_48));
update public.ads set status = 'rejected', rejection_reason = 'contenido no cumple lineamientos'
 where id = '00000000-0000-0000-0000-000000481016';

select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000481016'),
  'rejected',
  'MATRIZ11_active_a_rejected_con_reason_transicion_valida_cambia_el_status'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'ad' and entity_id = '00000000-0000-0000-0000-000000481016'),
  1,
  'MATRIZ12_active_a_rejected_con_reason_escribe_EXACTAMENTE_una_fila_en_admin_actions'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Matriz de transiciones INVÁLIDAS — draft→active DIRECTO (el criterio
--    central de "jamás se sirve sin moderación"), draft→paused,
--    pending_review→paused, y terminalidad de rejected/expired. Fixture
--    aislado de la Sección 1 (agencia/owner/creative propios).
-- ════════════════════════════════════════════════════════════════════════════

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000480001', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000482002', 'owner_invalidas_48@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000482001', 'Inmobiliaria Invalidas 48', 'inmo-invalidas-48', 'active',
   '00000000-0000-0000-0000-000000482002');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000482003', '00000000-0000-0000-0000-000000482001', 'ready');

-- ── 2.1) draft → active DIRECTO ─────────────────────────────────────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000482011', '00000000-0000-0000-0000-000000482001',
   '00000000-0000-0000-0000-000000482003', 'Ad Invalida 2.1', 'external_url', 'https://ejemplo.mx/2-1',
   'draft', (select v_now from test_now_48), (select v_now + interval '30 days' from test_now_48));

select throws_ok(
  $$ update public.ads set status = 'active' where id = '00000000-0000-0000-0000-000000482011' $$,
  'P0001', 'INVALID_AD_STATUS_TRANSITION',
  'INVALIDA1_draft_a_active_DIRECTO_falla_el_criterio_central_jamas_se_sirve_sin_moderacion'
);
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000482011'),
  'draft',
  'INVALIDA2_tras_el_intento_bloqueado_el_ad_sigue_en_draft'
);

-- ── 2.2) draft → paused ─────────────────────────────────────────────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000482012', '00000000-0000-0000-0000-000000482001',
   '00000000-0000-0000-0000-000000482003', 'Ad Invalida 2.2', 'external_url', 'https://ejemplo.mx/2-2',
   'draft', (select v_now from test_now_48), (select v_now + interval '30 days' from test_now_48));

select throws_ok(
  $$ update public.ads set status = 'paused' where id = '00000000-0000-0000-0000-000000482012' $$,
  'P0001', 'INVALID_AD_STATUS_TRANSITION',
  'INVALIDA3_draft_a_paused_no_esta_en_la_matriz_falla'
);
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000482012'),
  'draft',
  'INVALIDA4_tras_el_intento_bloqueado_el_ad_sigue_en_draft'
);

-- ── 2.3) pending_review → paused ────────────────────────────────────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000482013', '00000000-0000-0000-0000-000000482001',
   '00000000-0000-0000-0000-000000482003', 'Ad Invalida 2.3', 'external_url', 'https://ejemplo.mx/2-3',
   'pending_review', (select v_now from test_now_48), (select v_now + interval '30 days' from test_now_48));

select throws_ok(
  $$ update public.ads set status = 'paused' where id = '00000000-0000-0000-0000-000000482013' $$,
  'P0001', 'INVALID_AD_STATUS_TRANSITION',
  'INVALIDA5_pending_review_a_paused_no_esta_en_la_matriz_falla'
);
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000482013'),
  'pending_review',
  'INVALIDA6_tras_el_intento_bloqueado_el_ad_sigue_en_pending_review'
);

-- ── 2.4) rejected es TERMINAL: rejected → pending_review falla ─────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, rejection_reason, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000482014', '00000000-0000-0000-0000-000000482001',
   '00000000-0000-0000-0000-000000482003', 'Ad Invalida 2.4', 'external_url', 'https://ejemplo.mx/2-4',
   'rejected', 'motivo original de rechazo',
   (select v_now from test_now_48), (select v_now + interval '30 days' from test_now_48));

select throws_ok(
  $$ update public.ads set status = 'pending_review' where id = '00000000-0000-0000-0000-000000482014' $$,
  'P0001', 'INVALID_AD_STATUS_TRANSITION',
  'INVALIDA7_rejected_es_terminal_no_se_reabre_hacia_pending_review'
);
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000482014'),
  'rejected',
  'INVALIDA8_tras_el_intento_bloqueado_el_ad_sigue_en_rejected'
);

-- ── 2.5) expired es TERMINAL: expired → active falla ────────────────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000482015', '00000000-0000-0000-0000-000000482001',
   '00000000-0000-0000-0000-000000482003', 'Ad Invalida 2.5', 'external_url', 'https://ejemplo.mx/2-5',
   'expired', (select v_now - interval '60 days' from test_now_48), (select v_now - interval '30 days' from test_now_48));

select throws_ok(
  $$ update public.ads set status = 'active' where id = '00000000-0000-0000-0000-000000482015' $$,
  'P0001', 'INVALID_AD_STATUS_TRANSITION',
  'INVALIDA9_expired_es_terminal_no_se_reabre_hacia_active'
);
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000482015'),
  'expired',
  'INVALIDA10_tras_el_intento_bloqueado_el_ad_sigue_en_expired'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) rejected exige rejection_reason POR LA VÍA DEL TRIGGER — la transición
--    activo→rejected es VÁLIDA en la matriz (Sección 1.6 ya la probó con
--    reason); aquí se confirma que el CHECK ads_rejection_reason_matches_status
--    (169.1) sigue vivo y NO lo enmascara el trigger nuevo. Con admin
--    identificado a propósito, para aislar el 23514 de cualquier fallo de
--    identificación de admin.
-- ════════════════════════════════════════════════════════════════════════════

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000480001', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000483002', 'owner_reason_48@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000483001', 'Inmobiliaria Reason 48', 'inmo-reason-48', 'active',
   '00000000-0000-0000-0000-000000483002');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000483003', '00000000-0000-0000-0000-000000483001', 'ready');
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000483011', '00000000-0000-0000-0000-000000483001',
   '00000000-0000-0000-0000-000000483003', 'Ad Reason 3', 'external_url', 'https://ejemplo.mx/3-1',
   'active', (select v_now from test_now_48), (select v_now + interval '30 days' from test_now_48));

select throws_ok(
  $$ update public.ads set status = 'rejected' where id = '00000000-0000-0000-0000-000000483011' $$,
  '23514', null,
  'REASON1_active_a_rejected_SIN_rejection_reason_falla_23514_via_el_trigger_admin_identificado'
);
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000483011'),
  'active',
  'REASON2_tras_el_intento_bloqueado_el_ad_sigue_en_active'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) 🔒 Fault-injection — el INSERT de auditoría falla ⇒ ROLLBACK TOTAL de la
--    transición (patrón moderate_property_atomic, 20260809000007). Trigger
--    "veneno" DROPEADO INMEDIATAMENTE tras los 3 asserts que lo necesitan
--    (aprendizaje de la derivada #176, NO dejarlo vivo hasta el final del
--    archivo).
-- ════════════════════════════════════════════════════════════════════════════

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000480001', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000484002', 'owner_faultinj_48@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000484001', 'Inmobiliaria Fault Injection 48', 'inmo-faultinj-48', 'active',
   '00000000-0000-0000-0000-000000484002');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000484003', '00000000-0000-0000-0000-000000484001', 'ready');
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000484011', '00000000-0000-0000-0000-000000484001',
   '00000000-0000-0000-0000-000000484003', 'Ad Fault Injection 4', 'external_url', 'https://ejemplo.mx/4-1',
   'draft', (select v_now from test_now_48), (select v_now + interval '30 days' from test_now_48));

create or replace function pg_temp.poison_admin_actions_insert_48()
returns trigger language plpgsql as $poison$
begin
  raise exception 'poison: fault injection forzada (pgTAP 48_ads_state_machine_test) para probar el rollback total de la transición de ads'
    using errcode = '23505';
end
$poison$;
create trigger poison_admin_actions_before_insert_48
  before insert on public.admin_actions
  for each row execute function pg_temp.poison_admin_actions_insert_48();

select throws_ok(
  $$ update public.ads set status = 'pending_review' where id = '00000000-0000-0000-0000-000000484011' $$,
  '23505', null,
  'FAULT1_fault_injection_el_insert_de_auditoria_falla_y_la_transicion_debe_lanzar_excepcion'
);

drop trigger if exists poison_admin_actions_before_insert_48 on public.admin_actions;

select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000484011'),
  'draft',
  'FAULT2_atomicidad_rollback_total_el_ad_NO_quedo_movido_pese_al_fallo_posterior_del_audit'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'ad' and entity_id = '00000000-0000-0000-0000-000000484011'),
  0,
  'FAULT3_atomicidad_no_quedo_ninguna_fila_huerfana_en_admin_actions_para_este_ad'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Bloquear activación bajo organización YA suspendida — pending_review→
--    active debe FALLAR si agencies.status='suspended' EN EL MOMENTO de la
--    transición (no reactivo a una suspensión futura). Fixture sembrado
--    DIRECTO con status='suspended' (el INSERT no pasa por el trigger de
--    agencies, así que no depende de si esa máquina de estados admite o no
--    la transición active→suspended -- ver AMBIGÜEDAD en el reporte).
-- ════════════════════════════════════════════════════════════════════════════

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000480001', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000485002', 'owner_orgsuspend_48@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000485001', 'Inmobiliaria Org Suspendida 48', 'inmo-orgsuspend-48', 'suspended',
   '00000000-0000-0000-0000-000000485002');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000485003', '00000000-0000-0000-0000-000000485001', 'ready');
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000485011', '00000000-0000-0000-0000-000000485001',
   '00000000-0000-0000-0000-000000485003', 'Ad Org Suspendida 5', 'external_url', 'https://ejemplo.mx/5-1',
   'pending_review', (select v_now from test_now_48), (select v_now + interval '30 days' from test_now_48));

select throws_ok(
  $$ update public.ads set status = 'active' where id = '00000000-0000-0000-0000-000000485011' $$,
  'P0001', 'ORGANIZATION_SUSPENDED',
  'ORGSUSP1_pending_review_a_active_falla_si_la_agencia_ya_esta_suspendida_en_el_momento_de_la_transicion'
);
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000485011'),
  'pending_review',
  'ORGSUSP2_tras_el_intento_bloqueado_el_ad_sigue_en_pending_review'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Impersonación — el OWNER no puede activar su propio anuncio ni por
--    PostgREST directo (42501, sin GRANT de UPDATE desde 169.1) ni un caller
--    con GRANT de tabla pero SIN admin identificado (P0001, defensa en
--    profundidad del propio trigger — mismo criterio que 71.5).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 6.1) Owner legítimo vía JWT real (authenticated, membresía owner activa) ─
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000486002', 'owner_impersona_48@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000486001', 'Inmobiliaria Impersona Owner 48', 'inmo-impersona-owner-48', 'active',
   '00000000-0000-0000-0000-000000486002');
insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000486001', '00000000-0000-0000-0000-000000486002', 'owner', 'active');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000486003', '00000000-0000-0000-0000-000000486001', 'ready');
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000486011', '00000000-0000-0000-0000-000000486001',
   '00000000-0000-0000-0000-000000486003', 'Ad Impersona Owner 6.1', 'external_url', 'https://ejemplo.mx/6-1',
   'pending_review', (select v_now from test_now_48), (select v_now + interval '30 days' from test_now_48));

select pg_temp.act_as('00000000-0000-0000-0000-000000486002', 'authenticated');
select throws_ok(
  $$ update public.ads set status = 'active' where id = '00000000-0000-0000-0000-000000486011' $$,
  '42501', null,
  'IMPERSONA1_el_owner_legitimo_NO_puede_poner_su_propio_ad_en_active_via_postgrest_bloqueado_por_el_grant'
);
reset role;

select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000486011'),
  'pending_review',
  'IMPERSONA2_tras_el_intento_bloqueado_del_owner_el_ad_sigue_en_pending_review'
);

-- ── 6.2) service_role CON grant de tabla pero SIN admin identificado ────────
-- (JWT sin sub que resuelva a admin + GUC urbea.admin_actor_id limpio):
-- defensa en profundidad del propio trigger, no basta con tener GRANT.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000486102', 'owner_impersona_sr_48@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000486101', 'Inmobiliaria Impersona SR 48', 'inmo-impersona-sr-48', 'active',
   '00000000-0000-0000-0000-000000486102');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000486103', '00000000-0000-0000-0000-000000486101', 'ready');
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000486111', '00000000-0000-0000-0000-000000486101',
   '00000000-0000-0000-0000-000000486103', 'Ad Impersona SR 6.2', 'external_url', 'https://ejemplo.mx/6-2',
   'pending_review', (select v_now from test_now_48), (select v_now + interval '30 days' from test_now_48));

select set_config('urbea.admin_actor_id', '', true);
select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ update public.ads set status = 'active' where id = '00000000-0000-0000-0000-000000486111' $$,
  'P0001', 'STATUS_CHANGE_REQUIRES_ADMIN',
  'IMPERSONA3_service_role_con_grant_de_tabla_pero_SIN_admin_identificado_igual_falla_defensa_en_profundidad'
);
reset role;

select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000486111'),
  'pending_review',
  'IMPERSONA4_tras_el_intento_bloqueado_sin_admin_el_ad_sigue_en_pending_review'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) No-op benigno — un UPDATE que reescribe el MISMO status (old = new) no
--    dispara el trigger (WHEN old.status IS DISTINCT FROM new.status): no
--    exige admin identificado (GUC sigue limpio de la Sección 6.2 a propósito)
--    ni escribe auditoría nueva.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000487002', 'owner_noop_48@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000487001', 'Inmobiliaria No Op 48', 'inmo-noop-48', 'active',
   '00000000-0000-0000-0000-000000487002');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000487003', '00000000-0000-0000-0000-000000487001', 'ready');
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000487011', '00000000-0000-0000-0000-000000487001',
   '00000000-0000-0000-0000-000000487003', 'Ad No Op 7', 'external_url', 'https://ejemplo.mx/7-1',
   'active', (select v_now from test_now_48), (select v_now + interval '30 days' from test_now_48));

select lives_ok(
  $$ update public.ads set status = 'active' where id = '00000000-0000-0000-0000-000000487011' $$,
  'NOOP1_reescribir_el_mismo_status_no_exige_admin_identificado_no_dispara_el_trigger'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'ad' and entity_id = '00000000-0000-0000-0000-000000487011'),
  0,
  'NOOP2_el_no_op_no_escribe_ninguna_fila_nueva_de_auditoria'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8) D2 "pausar el reloj" — public.ads.paused_at (AÚN NO EXISTE, ver nota de
--    cabecera). Toda verificación positiva va en un bloque
--    `do $$ ... exception when others ... $$` AUTO-PROTEGIDO: si la columna
--    no existe, cae en la rama exception, escribe ok=false en la tabla
--    temporal y el resto del archivo NO se ve afectado (sin cascada).
-- ════════════════════════════════════════════════════════════════════════════

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000480001', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000488002', 'owner_pausarreloj_48@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000488001', 'Inmobiliaria Pausar Reloj 48', 'inmo-pausarreloj-48', 'active',
   '00000000-0000-0000-0000-000000488002');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000488003', '00000000-0000-0000-0000-000000488001', 'ready');

-- ── 8.1) active → paused: paused_at := now() (capturado), ends_at NO cambia ─
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000488011', '00000000-0000-0000-0000-000000488001',
   '00000000-0000-0000-0000-000000488003', 'Ad Pausar Reloj 8.1', 'external_url', 'https://ejemplo.mx/8-1',
   'active', (select v_now - interval '1 day' from test_now_48), (select v_now + interval '20 days' from test_now_48));

create temp table result_pause_48 (
  ok boolean, new_paused_at timestamptz, new_ends_at timestamptz, err_sqlstate text
);
do $$
declare
  v_paused_at timestamptz;
  v_ends_at   timestamptz;
begin
  update public.ads set status = 'paused' where id = '00000000-0000-0000-0000-000000488011';
  select paused_at, ends_at into v_paused_at, v_ends_at
    from public.ads where id = '00000000-0000-0000-0000-000000488011';
  insert into result_pause_48 values (true, v_paused_at, v_ends_at, null);
exception when others then
  insert into result_pause_48 values (false, null, null, sqlstate);
end $$;

select is(
  (select ok from result_pause_48), true,
  'PAUSA1_active_a_paused_no_lanza_excepcion_columna_paused_at_utilizable'
);
select is(
  (select new_paused_at from result_pause_48),
  (select v_now from test_now_48),
  'PAUSA2_al_entrar_a_paused_paused_at_queda_estampado_exactamente_en_now'
);
select is(
  (select new_ends_at from result_pause_48),
  (select v_now + interval '20 days' from test_now_48),
  'PAUSA3_al_entrar_a_paused_ends_at_NO_cambia_se_conservan_los_dias_restantes'
);

-- ── 8.2) paused → active: recalcula ends_at sumando lo no consumido ────────
-- paused_at fijado a un valor CONOCIDO (v_now - 5 días, simulando que la
-- organización estuvo suspendida/el ad pausado 5 días) -- determinista, NUNCA
-- depende del reloj real transcurriendo durante el test.
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000488012', '00000000-0000-0000-0000-000000488001',
   '00000000-0000-0000-0000-000000488003', 'Ad Pausar Reloj 8.2', 'external_url', 'https://ejemplo.mx/8-2',
   'active', (select v_now - interval '10 days' from test_now_48), (select v_now + interval '20 days' from test_now_48));

create temp table result_reactivate_48 (
  ok boolean, new_status text, new_ends_at timestamptz, new_paused_at timestamptz, err_sqlstate text
);
do $$
declare
  v_status    text;
  v_ends_at   timestamptz;
  v_paused_at timestamptz;
begin
  update public.ads set status = 'paused' where id = '00000000-0000-0000-0000-000000488012';
  update public.ads
     set paused_at = (select v_now - interval '5 days' from test_now_48)
   where id = '00000000-0000-0000-0000-000000488012';

  perform set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000480001', true);
  update public.ads set status = 'active' where id = '00000000-0000-0000-0000-000000488012';

  select status::text, ends_at, paused_at into v_status, v_ends_at, v_paused_at
    from public.ads where id = '00000000-0000-0000-0000-000000488012';
  insert into result_reactivate_48 values (true, v_status, v_ends_at, v_paused_at, null);
exception when others then
  insert into result_reactivate_48 values (false, null, null, null, sqlstate);
end $$;

select is(
  (select ok from result_reactivate_48), true,
  'REACTIVA1_paused_a_active_no_lanza_excepcion_recalculo_de_ends_at_utilizable'
);
select is(
  (select new_status from result_reactivate_48), 'active',
  'REACTIVA2_paused_a_active_deja_el_status_en_active'
);
select is(
  (select new_ends_at from result_reactivate_48),
  (select v_now + interval '25 days' from test_now_48),
  'REACTIVA3_ends_at_se_recalcula_sumando_EXACTAMENTE_los_5_dias_no_consumidos_ends_at_mas_now_menos_paused_at'
);
select is(
  (select new_paused_at from result_reactivate_48), null::timestamptz,
  'REACTIVA4_al_reactivar_paused_at_vuelve_a_null'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 9) EXTENSIÓN AL VIVO (2026-08-16, decisión de Abraham vía el orquestador):
--    la suspensión de organizaciones se construye AHORA, dentro de 169.2 —
--    ver ambigüedad #1 del reporte original de este RED. public.agencies gana
--    dos transiciones nuevas en la MISMA máquina de estados de 71.5
--    (public.handle_agency_status_change, hoy en
--    supabase/migrations/20260805000010_admin_approval_fixes.sql:30-102):
--      active → suspended   (exige admin, audita 'agency')
--      suspended → active   (exige admin, audita 'agency', SIN re-disparar
--        los efectos de aprobación de D5 — ver Sección 12)
--    pending_approval → {active,rejected} sigue exactamente igual.
--    pending_approval → suspended DEBE SEGUIR FALLANDO (asertado también en
--    supabase/tests/25_admin_approvals_test.sql:319-323 — esa suite NO se
--    toca, se corre aparte para confirmar que sigue verde). rejected↔suspended
--    NO se agregan (fuera de alcance): deben seguir fallando.
--
-- SUT (AÚN NO EXISTE): create or replace function
--   public.handle_agency_status_change() debe aceptar, además de la matriz
--   vigente, (old.status='active' and new.status='suspended') y
--   (old.status='suspended' and new.status='active'); cualquier otra
--   combinación sigue lanzando P0001 'INVALID_STATUS_TRANSITION' (SIN
--   "AD_" -- código YA vigente de 71.5, no se inventa uno nuevo).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 9.1) active → suspended: válida, exige admin, audita 'agency' ──────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000489012', 'owner_agsuspend_48@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000489011', 'Inmobiliaria Ag Suspend 48', 'inmo-agsuspend-48', 'active',
   '00000000-0000-0000-0000-000000489012');

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000480001', true);
select lives_ok(
  $$ update public.agencies set status = 'suspended' where id = '00000000-0000-0000-0000-000000489011' $$,
  'AGMATRIZ1_active_a_suspended_es_ahora_una_transicion_valida_exige_admin_no_lanza_excepcion'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'agency' and entity_id = '00000000-0000-0000-0000-000000489011'),
  1,
  'AGMATRIZ2_active_a_suspended_escribe_EXACTAMENTE_una_fila_en_admin_actions'
);

-- ── 9.2) suspended → active: válida, exige admin, audita 'agency' ──────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000489022', 'owner_agreactivate_48@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000489021', 'Inmobiliaria Ag Reactivate 48', 'inmo-agreactivate-48', 'suspended',
   '00000000-0000-0000-0000-000000489022');

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000480001', true);
select lives_ok(
  $$ update public.agencies set status = 'active' where id = '00000000-0000-0000-0000-000000489021' $$,
  'AGMATRIZ3_suspended_a_active_es_ahora_una_transicion_valida_exige_admin_no_lanza_excepcion'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'agency' and entity_id = '00000000-0000-0000-0000-000000489021'),
  1,
  'AGMATRIZ4_suspended_a_active_escribe_EXACTAMENTE_una_fila_en_admin_actions'
);

-- ── 9.3) pending_approval → suspended SIGUE fallando (no se amplía a esta) ─
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000489032', 'owner_agpendsuspend_48@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000489031', 'Inmobiliaria Ag PendSuspend 48', 'inmo-agpendsuspend-48', 'pending_approval',
   '00000000-0000-0000-0000-000000489032');

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000480001', true);
select throws_ok(
  $$ update public.agencies set status = 'suspended' where id = '00000000-0000-0000-0000-000000489031' $$,
  'P0001', 'INVALID_STATUS_TRANSITION',
  'AGMATRIZ5_pending_approval_a_suspended_SIGUE_fallando_no_se_amplia_la_matriz_a_esta_combinacion'
);
select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000489031'),
  'pending_approval',
  'AGMATRIZ6_tras_el_intento_bloqueado_la_agencia_sigue_en_pending_approval'
);

-- ── 9.4) rejected → suspended falla (no se agrega) ──────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000489042', 'owner_agrejsuspend_48@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000489041', 'Inmobiliaria Ag RejSuspend 48', 'inmo-agrejsuspend-48', 'rejected',
   '00000000-0000-0000-0000-000000489042');

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000480001', true);
select throws_ok(
  $$ update public.agencies set status = 'suspended' where id = '00000000-0000-0000-0000-000000489041' $$,
  'P0001', 'INVALID_STATUS_TRANSITION',
  'AGMATRIZ7_rejected_a_suspended_falla_no_se_agrego_a_la_matriz'
);
select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000489041'),
  'rejected',
  'AGMATRIZ8_tras_el_intento_bloqueado_la_agencia_sigue_en_rejected'
);

-- ── 9.5) suspended → rejected falla (no se agrega) ──────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000489052', 'owner_agsusprej_48@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000489051', 'Inmobiliaria Ag SuspRej 48', 'inmo-agsusprej-48', 'suspended',
   '00000000-0000-0000-0000-000000489052');

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000480001', true);
select throws_ok(
  $$ update public.agencies set status = 'rejected' where id = '00000000-0000-0000-0000-000000489051' $$,
  'P0001', 'INVALID_STATUS_TRANSITION',
  'AGMATRIZ9_suspended_a_rejected_falla_no_se_agrego_a_la_matriz'
);
select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000489051'),
  'suspended',
  'AGMATRIZ10_tras_el_intento_bloqueado_la_agencia_sigue_en_suspended'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 10) Cascada de SUSPENSIÓN → ads (el corazón de D2, primera mitad): al
--     suspender la organización, sus ads EN 'active' pasan a 'paused' en la
--     MISMA transacción, estampando paused_at y paused_by_suspension=true.
--     ends_at NO se toca. Ads que no están 'active' (draft/pending_review/
--     rejected/expired) NO los toca la cascada. Ads de OTRA organización NO
--     se tocan (aislamiento por agency_id -- atrapa un UPDATE sin WHERE).
--
-- SUT (AÚN NO EXISTE): además de lo de la Sección 9, el UPDATE que mueve
-- agencies.status a 'suspended' debe, en la MISMA transacción, ejecutar algo
-- equivalente a:
--   update public.ads set status = 'paused', paused_by_suspension = true
--    where agency_id = new.id and status = 'active';
-- (la columna public.ads.paused_by_suspension boolean not null default false
-- AÚN NO EXISTE -- técnica protegida donde haga falta, ver nota de cabecera).
-- ════════════════════════════════════════════════════════════════════════════

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000480001', true);

-- Agencia X: la que se suspende, con 5 ads en 5 estados distintos.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000048a012', 'owner_cascadapausa_48@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-00000048a011', 'Inmobiliaria Cascada Pausa 48', 'inmo-cascadapausa-48', 'active',
   '00000000-0000-0000-0000-00000048a012');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-00000048a013', '00000000-0000-0000-0000-00000048a011', 'ready');

insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-00000048a021', '00000000-0000-0000-0000-00000048a011',
   '00000000-0000-0000-0000-00000048a013', 'Ad Cascada Active', 'external_url', 'https://ejemplo.mx/a-21',
   'active', (select v_now - interval '1 day' from test_now_48), (select v_now + interval '18 days' from test_now_48)),
  ('00000000-0000-0000-0000-00000048a022', '00000000-0000-0000-0000-00000048a011',
   '00000000-0000-0000-0000-00000048a013', 'Ad Cascada Draft', 'external_url', 'https://ejemplo.mx/a-22',
   'draft', (select v_now from test_now_48), (select v_now + interval '30 days' from test_now_48)),
  ('00000000-0000-0000-0000-00000048a023', '00000000-0000-0000-0000-00000048a011',
   '00000000-0000-0000-0000-00000048a013', 'Ad Cascada Pending', 'external_url', 'https://ejemplo.mx/a-23',
   'pending_review', (select v_now from test_now_48), (select v_now + interval '30 days' from test_now_48));
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, rejection_reason, starts_at, ends_at) values
  ('00000000-0000-0000-0000-00000048a024', '00000000-0000-0000-0000-00000048a011',
   '00000000-0000-0000-0000-00000048a013', 'Ad Cascada Rejected', 'external_url', 'https://ejemplo.mx/a-24',
   'rejected', 'motivo cascada rejected', (select v_now from test_now_48), (select v_now + interval '30 days' from test_now_48));
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-00000048a025', '00000000-0000-0000-0000-00000048a011',
   '00000000-0000-0000-0000-00000048a013', 'Ad Cascada Expired', 'external_url', 'https://ejemplo.mx/a-25',
   'expired', (select v_now - interval '60 days' from test_now_48), (select v_now - interval '30 days' from test_now_48));

-- Agencia Y: NO se toca -- prueba de aislamiento por agency_id.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000048a032', 'owner_cascadaajena_48@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-00000048a031', 'Inmobiliaria Cascada Ajena 48', 'inmo-cascadaajena-48', 'active',
   '00000000-0000-0000-0000-00000048a032');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-00000048a033', '00000000-0000-0000-0000-00000048a031', 'ready');
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-00000048a041', '00000000-0000-0000-0000-00000048a031',
   '00000000-0000-0000-0000-00000048a033', 'Ad Cascada Ajena Active', 'external_url', 'https://ejemplo.mx/a-41',
   'active', (select v_now - interval '1 day' from test_now_48), (select v_now + interval '18 days' from test_now_48));

select lives_ok(
  $$ update public.agencies set status = 'suspended' where id = '00000000-0000-0000-0000-00000048a011' $$,
  'CASCADAPAUSA1_suspender_la_organizacion_no_lanza_excepcion'
);

-- Los 4 ads que NO estaban 'active' quedan intactos (lecturas seguras: solo
-- tocan la columna status, preexistente).
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-00000048a022'),
  'draft',
  'CASCADAPAUSA2_un_ad_en_draft_NO_lo_toca_la_cascada_sigue_en_draft'
);
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-00000048a023'),
  'pending_review',
  'CASCADAPAUSA3_un_ad_en_pending_review_NO_lo_toca_la_cascada_sigue_en_pending_review'
);
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-00000048a024'),
  'rejected',
  'CASCADAPAUSA4_un_ad_en_rejected_NO_lo_toca_la_cascada_sigue_en_rejected'
);
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-00000048a025'),
  'expired',
  'CASCADAPAUSA5_un_ad_en_expired_NO_lo_toca_la_cascada_sigue_en_expired'
);
-- El ad de la OTRA organización sigue 'active' -- aislamiento por agency_id.
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-00000048a041'),
  'active',
  'CASCADAPAUSA6_un_ad_de_OTRA_organizacion_NO_se_toca_aislamiento_por_agency_id_atrapa_update_sin_where'
);
-- Auditoría: 1 fila para la agencia (la suspensión) + 1 fila para el ad
-- movido por la cascada (mismo contrato de auditoría por transición de ad
-- que la Sección 1) -- ambas lecturas son seguras (admin_actions no cambió
-- de shape).
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'agency' and entity_id = '00000000-0000-0000-0000-00000048a011'),
  1,
  'CASCADAPAUSA7_la_suspension_de_la_organizacion_audita_EXACTAMENTE_una_fila_agency'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'ad' and entity_id = '00000000-0000-0000-0000-00000048a021'),
  1,
  'CASCADAPAUSA8_el_ad_movido_por_la_cascada_audita_EXACTAMENTE_una_fila_ad_mismo_contrato_que_la_seccion_1'
);

-- El ad que SÍ estaba 'active' -- lectura protegida (paused_at/
-- paused_by_suspension aún no existen).
create temp table result_cascadapausa_48 (
  ok boolean, new_status text, new_paused_at timestamptz,
  new_paused_by_suspension boolean, new_ends_at timestamptz, err_sqlstate text
);
do $$
declare
  v_status                  text;
  v_paused_at                timestamptz;
  v_paused_by_suspension     boolean;
  v_ends_at                  timestamptz;
begin
  select status::text, paused_at, paused_by_suspension, ends_at
    into v_status, v_paused_at, v_paused_by_suspension, v_ends_at
    from public.ads where id = '00000000-0000-0000-0000-00000048a021';
  insert into result_cascadapausa_48 values (true, v_status, v_paused_at, v_paused_by_suspension, v_ends_at, null);
exception when others then
  insert into result_cascadapausa_48 values (false, null, null, null, null, sqlstate);
end $$;

select is(
  (select new_status from result_cascadapausa_48), 'paused',
  'CASCADAPAUSA9_el_ad_que_estaba_active_pasa_a_paused_por_la_cascada'
);
select is(
  (select new_paused_at from result_cascadapausa_48), (select v_now from test_now_48),
  'CASCADAPAUSA10_el_ad_movido_por_la_cascada_queda_con_paused_at_estampado_exactamente_en_now'
);
select is(
  (select new_paused_by_suspension from result_cascadapausa_48), true,
  'CASCADAPAUSA11_el_ad_movido_por_la_cascada_queda_con_paused_by_suspension_true_el_discriminador'
);
select is(
  (select new_ends_at from result_cascadapausa_48), (select v_now + interval '18 days' from test_now_48),
  'CASCADAPAUSA12_al_pausar_por_la_cascada_ends_at_NO_cambia_el_reloj_se_congela_no_se_recorta'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 11) Cascada de REACTIVACIÓN → ads (B segunda mitad) + discriminador
--     paused_by_suspension (C): al reactivar la organización, SOLO los ads
--     que la cascada de suspensión pausó (paused_by_suspension=true) vuelven
--     a 'active' con ends_at recalculado. Un ad que un admin pausó A MANO
--     por causa (paused_by_suspension=false) NO revive -- sigue 'paused' y
--     su ends_at NO se toca (el invariante 🔒 que justifica la columna).
--     Determinismo: paused_at fijado a un valor conocido (nunca el reloj
--     real), mismo patrón que la Sección 8.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000048b012', 'owner_cascadareact_48@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-00000048b011', 'Inmobiliaria Cascada Reactiva 48', 'inmo-cascadareact-48', 'suspended',
   '00000000-0000-0000-0000-00000048b012');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-00000048b013', '00000000-0000-0000-0000-00000048b011', 'ready');

-- ad_cascade: simula que la cascada de suspensión (Sección 10) ya lo pausó.
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-00000048b021', '00000000-0000-0000-0000-00000048b011',
   '00000000-0000-0000-0000-00000048b013', 'Ad Cascada Reactiva Cascade', 'external_url', 'https://ejemplo.mx/b-21',
   'active', (select v_now - interval '20 days' from test_now_48), (select v_now + interval '15 days' from test_now_48));

-- ad_manual: un admin lo pausó A MANO (moderación), SIN relación con la
-- suspensión de la organización -- paused_by_suspension se queda en su
-- default (false).
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-00000048b022', '00000000-0000-0000-0000-00000048b011',
   '00000000-0000-0000-0000-00000048b013', 'Ad Cascada Reactiva Manual', 'external_url', 'https://ejemplo.mx/b-22',
   'active', (select v_now - interval '20 days' from test_now_48), (select v_now + interval '12 days' from test_now_48));

create temp table result_cascadareact_48 (
  ok boolean,
  cascade_status text, cascade_ends_at timestamptz, cascade_paused_at timestamptz, cascade_pbs boolean,
  manual_status text, manual_ends_at timestamptz, manual_pbs boolean,
  err_sqlstate text
);
do $$
declare
  v_cascade_status text; v_cascade_ends_at timestamptz; v_cascade_paused_at timestamptz; v_cascade_pbs boolean;
  v_manual_status  text; v_manual_ends_at  timestamptz; v_manual_pbs boolean;
begin
  -- Deja ambos ads en 'paused' (dispara el trigger de ads, paused_at := now()).
  update public.ads set status = 'paused', paused_by_suspension = true
   where id = '00000000-0000-0000-0000-00000048b021';
  update public.ads set status = 'paused'
   where id = '00000000-0000-0000-0000-00000048b022';

  -- Backdatea paused_at del ad de la cascada a un valor CONOCIDO (5 días
  -- atrás) -- UPDATE que NO cambia status, el WHEN clause no dispara el
  -- trigger, así que el valor queda EXACTAMENTE el que se asigna aquí (mismo
  -- truco ya usado y verificado en la Sección 8.2).
  update public.ads set paused_at = (select v_now - interval '5 days' from test_now_48)
   where id = '00000000-0000-0000-0000-00000048b021';

  -- Reactiva la ORGANIZACIÓN -- debe cascadear SOLO al ad con
  -- paused_by_suspension=true.
  perform set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000480001'::text, true);
  update public.agencies set status = 'active' where id = '00000000-0000-0000-0000-00000048b011';

  select status::text, ends_at, paused_at, paused_by_suspension
    into v_cascade_status, v_cascade_ends_at, v_cascade_paused_at, v_cascade_pbs
    from public.ads where id = '00000000-0000-0000-0000-00000048b021';
  select status::text, ends_at, paused_by_suspension
    into v_manual_status, v_manual_ends_at, v_manual_pbs
    from public.ads where id = '00000000-0000-0000-0000-00000048b022';

  insert into result_cascadareact_48 values (
    true, v_cascade_status, v_cascade_ends_at, v_cascade_paused_at, v_cascade_pbs,
    v_manual_status, v_manual_ends_at, v_manual_pbs, null
  );
exception when others then
  insert into result_cascadareact_48 values (false, null, null, null, null, null, null, null, sqlstate);
end $$;

select is((select ok from result_cascadareact_48), true,
  'CASCADAREACT1_el_flujo_completo_backdatear_mas_reactivar_no_lanza_excepcion'
);
select is((select cascade_status from result_cascadareact_48), 'active',
  'CASCADAREACT2_el_ad_pausado_por_la_cascada_vuelve_a_active_al_reactivar_la_organizacion'
);
select is((select cascade_ends_at from result_cascadareact_48), (select v_now + interval '20 days' from test_now_48),
  'CASCADAREACT3_ends_at_se_recalcula_sumando_EXACTAMENTE_los_5_dias_no_consumidos_15_mas_5'
);
select is((select cascade_paused_at from result_cascadareact_48), null::timestamptz,
  'CASCADAREACT4_al_reactivar_paused_at_del_ad_cascada_vuelve_a_null'
);
select is((select cascade_pbs from result_cascadareact_48), false,
  'CASCADAREACT5_al_reactivar_paused_by_suspension_del_ad_cascada_vuelve_a_false'
);
-- 🔒 El discriminador: el ad pausado A MANO NO revive con la organización.
select is((select manual_status from result_cascadareact_48), 'paused',
  'DISCRIMINADOR1_un_ad_pausado_a_mano_paused_by_suspension_false_NO_revive_al_reactivar_la_organizacion_sigue_paused'
);
select is((select manual_ends_at from result_cascadareact_48), (select v_now + interval '12 days' from test_now_48),
  'DISCRIMINADOR2_el_ends_at_del_ad_pausado_a_mano_NO_se_recalcula_permanece_intacto'
);
select is((select manual_pbs from result_cascadareact_48), false,
  'DISCRIMINADOR3_paused_by_suspension_del_ad_pausado_a_mano_sigue_false_nunca_lo_toco_la_cascada'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 12) Reactivación NO re-dispara los efectos de aprobación (D) — la trampa:
--     el `if new.status = 'active'` vigente de handle_agency_status_change
--     (20260805000010:45+) crea agency_members(owner,active) y promueve al
--     usuario. En suspended→active eso NO debe volver a correr (o ser
--     demostrablemente idempotente): la membresía sigue en EXACTAMENTE una
--     fila y el rol del owner no cambia. Sin este assert, un GREEN ingenuo
--     que reusa el mismo branch revienta con ALREADY_ACTIVE_MEMBER/
--     MEMBER_OF_OTHER_AGENCY (o, peor, duplica la membresía).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000048c012', 'owner_noreaprove_48@urbea.mx');
update public.users set role = 'agent' where id = '00000000-0000-0000-0000-00000048c012';
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-00000048c011', 'Inmobiliaria No Reaprove 48', 'inmo-noreaprove-48', 'suspended',
   '00000000-0000-0000-0000-00000048c012');
-- La membresía owner/active YA existe (la organización estaba activa antes
-- de suspenderse -- esto NO pasa por el trigger de aprobación, se siembra
-- directo, tal como el resto de este archivo siembra estados de partida).
insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-00000048c011', '00000000-0000-0000-0000-00000048c012', 'owner', 'active');

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000480001', true);
select lives_ok(
  $$ update public.agencies set status = 'active' where id = '00000000-0000-0000-0000-00000048c011' $$,
  'NOREAPROVE1_suspended_a_active_no_lanza_excepcion_no_revienta_por_reintentar_insertar_la_membresia'
);
select is(
  (select count(*)::int from public.agency_members
    where agency_id = '00000000-0000-0000-0000-00000048c011'
      and user_id = '00000000-0000-0000-0000-00000048c012'
      and status = 'active'),
  1,
  'NOREAPROVE2_la_membresia_owner_activa_sigue_en_EXACTAMENTE_una_fila_no_se_duplico'
);
select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-00000048c012'),
  'agent',
  'NOREAPROVE3_el_rol_del_owner_no_cambio_la_reactivacion_no_re_promociona'
);

select * from finish();
rollback;
