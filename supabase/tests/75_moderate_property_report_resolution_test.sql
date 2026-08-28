-- Tests pgTAP — public.resolve_property_reports_atomic (subtarea #220.3, tarea
-- 220 "reportes de usuarios y auto-moderación", exploración 041-M3).
-- Ejecutar con: supabase test db supabase/tests/75_moderate_property_report_resolution_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de
-- una transacción revertida (no persiste). SECURITY DEFINER: superusuario
-- bypassa RLS igual que en 39_moderate_property_atomic_test.sql — el seam bajo
-- prueba es el efecto OBSERVABLE de llamar la RPC, no la autorización (esa la
-- cubre el AdminVerifier de la EF, ver report_resolution.test.ts).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: el efecto OBSERVABLE de `select resolve_property_reports_atomic(...)`
-- — filas resultantes en public.properties (status/deleted_at),
-- public.property_reports (status/reviewed_by_admin_id/reviewed_at/resolution),
-- public.notifications y public.admin_actions. Nunca se valida el cuerpo de la
-- función por catálogo.
--
-- SUT (STUB hoy — RED 2026-08-28, migración 20260828000003): la migración de
-- este RED crea la función con la firma correcta pero un cuerpo NO-OP (return;
-- sin escrituras) — así toda llamada TIENE ÉXITO (nunca 42883 function does not
-- exist, que abortaría la transacción entera) pero no produce NINGÚN efecto, y
-- cada aserción de abajo sobre status/reports/notifications/admin_actions falla
-- LIMPIO por comparación, nunca por error de catálogo. Las 4 aserciones de
-- VALIDATION (throws_ok esperando P0001) SÍ fallan hoy porque el STUB nunca
-- lanza esa excepción (retorna éxito siempre) — throws_ok las reporta como
-- "expected exception errcode P0001 to be thrown, but non-exception was
-- returned". ⚠️ throws_ok NO usa savepoint propio (mismo gotcha 73_*/74_*): si
-- el STUB no lanza, el resto del efecto (aquí: ninguno, el STUB no escribe
-- nada) igual "sucede" sin error — no hay cascada real que temer en esta
-- suite porque el STUB es un no-op total, a diferencia de 74 donde el INSERT sí
-- perseveraba.
--
-- ════════════════════════════════════════════════════════════════════════════
-- DECISIONES fijadas por el test-author (ver también types.ts,
-- report_resolution.test.ts y la bitácora de 220.3 en Taskmaster):
--   D-STATUS: property_reports.status destino = 'resolved' (el enum
--     property_report_status = new/reviewing/resolved/dismissed — no existe
--     el valor literal "reviewed" del lenguaje natural de la subtarea).
--   D-DEDUPE (retry en memoria, SIN índice único, mismo criterio 219.2/223.1):
--     restore/request_changes: no-op TOTAL si old_status <> 'suspended'.
--     keep_suspended: además exige >=1 reporte 'new' pendiente.
--     delete: además exige deleted_at IS NULL.
--     El cierre de reportes en sí (`WHERE status='new'`) es idempotente por
--     construcción, independiente del guard de arriba.
--   D-SCOPE: el UPDATE de property_reports SIEMPRE filtra por
--     property_id=p_property_id AND status='new'.
--   D-RESOLUTION: property_reports.resolution := p_reason (nullable, tal cual).
--   D-TYPE/D-LINK: deep_link SIEMPRE '/profile/my-listings' (ruta viva,
--     mobile/app/(protected)/profile/my-listings.tsx — NUNCA '/admin/reports'
--     aquí, esta RPC solo notifica al OWNER, nunca a admins — esos avisos ya
--     salieron en 220.2 al crearse los reportes). related_entity_type
--     'property'. Tipos: restore→'property_report_restored',
--     request_changes→'property_report_needs_changes',
--     keep_suspended→'property_report_kept_suspended',
--     delete→'property_report_deleted'.
--   D-RECIPIENT: destinatario = properties.owner_user_id; nunca el admin actor.
--   D-ADMIN-ACTIONS: siempre que hubo trabajo real, 1 fila, action_type=el
--     literal de la acción, entity_type='property'.
--   D-ATOMICIDAD: sin bloque EXCEPTION — el fallo del INSERT de notifications
--     revierte TODO el evento (fault-injection, 1 caso representativo).
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ───────────────
-- VALIDATION — action_type fuera del catálogo, admin_id/property_id nulos,
--   property_id inexistente → excepción P0001 en los 4 casos.
-- ORIGIN     — propiedad NUNCA estuvo suspended (status='active') → NO-OP
--   total sin excepción (mismo guard que sostiene el retry de restore/
--   request_changes).
-- RESTORE    — status→active, reportes 'new'→'resolved' con auditoría
--   completa, 1 admin_actions, 1 notification al owner con contrato exacto;
--   funciona también con 0 reportes 'new'; retry (2ª llamada idéntica) no
--   duplica nada.
-- REQCHANGES — status→needs_changes, mismo contrato de reports/admin_actions/
--   notification; retry sin duplicar.
-- KEEPSUSP   — status se queda 'suspended', reportes cerrados, admin_actions +
--   notification; CON 0 reportes 'new' → NO-OP total (edge case D-DEDUPE);
--   retry sin duplicar.
-- DELETE     — deleted_at se setea (antes NULL), status se queda 'suspended',
--   cascada a property_videos.deleted_at (trigger ya existente 0005), reportes
--   cerrados, admin_actions + notification; funciona con 0 reportes 'new';
--   retry (deleted_at ya seteado) sin duplicar.
-- SCOPE      — 2 propiedades suspendidas con reportes 'new' cada una; resolver
--   SOLO una → la otra conserva sus reportes 'new' intactos.
-- ALREADYRES — 1 reporte 'new' + 1 reporte YA 'dismissed' (con su propio
--   reviewed_at/admin/resolution previos) → tras resolver, el 'new' pasa a
--   'resolved' con el admin actual; el 'dismissed' NO se toca.
-- SELF       — admin_id = owner_user_id de la propiedad (gestiona su propia
--   propiedad) → 0 notifications, pero SÍ se resuelve (admin_actions=1).
-- FAULT      — 🔒 BLOQUEANTE fault-injection: INSERT hacia notifications
--   envenenado → toda la llamada lanza excepción y NADA persiste.
-- REGRESION  — #218: moderate_property_atomic (SIN TOCAR por esta migración)
--   sigue transicionando exactamente igual (publicación inicial y con-
--   revisión activa).
--
-- ── Convención DELTA vs INVARIANTE (verificado corriendo la suite HOY, RED) ──
-- `select plan(83)` → "Looks like you failed 60 tests of 83" contra el STUB
-- no-op (migración 20260828000003) — exactamente estos 60 DELTA (fallan hoy,
-- deben pasar tras el GREEN): VAL1-4, RESTORE1-14, RESTORE_RETRY1-3,
-- RESTORE_NOREPORTS1-3, REQCHANGES1-8, REQCHANGES_RETRY1-2, KEEPSUSP2-7,
-- KEEPSUSP_RETRY1-2, DELETE2-10, DELETE_RETRY1-2, DELETE_NOREPORTS1-2, SCOPE1,
-- ALREADYRES1, SELF2-3, FAULT1. Los 23 restantes son INVARIANTE (ya "pasan"
-- hoy por una razón DISTINTA a la que debe sostenerlos tras el GREEN, porque
-- el STUB no escribe NADA — el guardian debe re-verificar que sigan en verde
-- por la razón correcta): ORIGIN1-4 (el STUB también es no-op ahí, pero por
-- ausencia total de lógica, no por el guard real), KEEPSUSP1/KEEPSUSP_NOREPORTS1-3
-- (status/conteos triviales), DELETE_FIXTURE/DELETE1 (deleted_at ya era null,
-- status ya era suspended), SCOPE2-4 (nada cambia para NINGUNA de las 2
-- propiedades, así que "B intacta" es trivial), ALREADYRES2-3 (nada se toca,
-- así que "el dismissed no se reescribe" es trivial), SELF1 (0 notifications
-- porque el STUB nunca escribe ninguna, no por el guard "nunca el admin
-- actor"), FAULT2-4 (nada persiste porque el STUB no escribe nada, no por el
-- rollback de la excepción — de hecho FAULT1 es DELTA: el STUB nunca lanza),
-- REGRESION1-4 (moderate_property_atomic es una función DISTINTA, ajena al
-- SUT de esta migración — pasa por una razón real y estable, igual que el
-- índice de dedupe en la suite 74).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(89);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures compartidos — 1 admin actor, 2 owners (uno normal, uno que también
-- es admin para la sección SELF).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000075001', 'admin_75@urbea.mx'),
  ('00000000-0000-0000-0000-000000075002', 'owner_75@urbea.mx'),
  ('00000000-0000-0000-0000-000000075003', 'owner_admin_75@urbea.mx'),
  ('00000000-0000-0000-0000-000000075004', 'reporter1_75@urbea.mx'),
  ('00000000-0000-0000-0000-000000075005', 'reporter2_75@urbea.mx'),
  ('00000000-0000-0000-0000-000000075006', 'reporter3_75@urbea.mx'),
  ('00000000-0000-0000-0000-000000075007', 'admin_old_75@urbea.mx');

update public.users set role = 'admin'
 where id in ('00000000-0000-0000-0000-000000075001', '00000000-0000-0000-0000-000000075003');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) VALIDATION — guards de la firma.
-- ════════════════════════════════════════════════════════════════════════════

select throws_ok(
  $$ select public.resolve_property_reports_atomic(
       '00000000-0000-0000-0000-000000075001'::uuid,
       '00000000-0000-0000-0000-000000075002'::uuid,
       'bogus_action', null) $$,
  'P0001', null,
  'VAL1_action_type_fuera_del_catalogo_lanza_P0001'
);
select throws_ok(
  $$ select public.resolve_property_reports_atomic(
       null, '00000000-0000-0000-0000-000000075002'::uuid, 'restore', null) $$,
  'P0001', null,
  'VAL2_admin_id_nulo_lanza_P0001'
);
select throws_ok(
  $$ select public.resolve_property_reports_atomic(
       '00000000-0000-0000-0000-000000075001'::uuid, null, 'restore', null) $$,
  'P0001', null,
  'VAL3_property_id_nulo_lanza_P0001'
);
select throws_ok(
  $$ select public.resolve_property_reports_atomic(
       '00000000-0000-0000-0000-000000075001'::uuid,
       '00000000-0000-0000-0000-000000075999'::uuid,
       'restore', null) $$,
  'P0001', null,
  'VAL4_property_id_inexistente_lanza_P0001'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) ORIGIN — propiedad 075113: NUNCA estuvo suspended (status='active').
-- ════════════════════════════════════════════════════════════════════════════

insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000075113', '00000000-0000-0000-0000-000000075002',
   'departamento', 'rent', 'Depa Origin 75', extensions.ST_SetSRID(extensions.ST_MakePoint(-99.10, 19.40), 4326)::extensions.geography,
   9000, 'active');

create temp table result_origin_75 (ok boolean, err_sqlstate text);
do $$
begin
  perform public.resolve_property_reports_atomic(
    '00000000-0000-0000-0000-000000075001'::uuid,
    '00000000-0000-0000-0000-000000075113'::uuid,
    'restore', null);
  insert into result_origin_75 values (true, null);
exception when others then
  insert into result_origin_75 values (false, sqlstate);
end $$;

select is((select ok from result_origin_75), true,
  'ORIGIN1_propiedad_nunca_suspendida_no_lanza_excepcion_es_no_op_silencioso');
select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000075113'),
  'active', 'ORIGIN2_status_sigue_active_sin_cambio'
);
select is(
  (select count(*)::int from public.admin_actions where entity_id = '00000000-0000-0000-0000-000000075113'),
  0, 'ORIGIN3_0_admin_actions_es_no_op_total'
);
select is(
  (select count(*)::int from public.notifications where related_entity_id = '00000000-0000-0000-0000-000000075113'),
  0, 'ORIGIN4_0_notifications_es_no_op_total'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) RESTORE — 00000000-...-075101: happy path con 2 reportes 'new'.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000075101', '00000000-0000-0000-0000-000000075002',
   'departamento', 'rent', 'Depa Restore 75', extensions.ST_SetSRID(extensions.ST_MakePoint(-99.11, 19.41), 4326)::extensions.geography,
   9100, 'suspended');

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000075101', '00000000-0000-0000-0000-000000075004', 'misleading', null),
  ('00000000-0000-0000-0000-000000075101', '00000000-0000-0000-0000-000000075005', 'false_price', null);

select public.resolve_property_reports_atomic(
  '00000000-0000-0000-0000-000000075001'::uuid,
  '00000000-0000-0000-0000-000000075101'::uuid,
  'restore', 'Reportes sin fundamento');

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000075101'),
  'active', 'RESTORE1_status_transiciona_a_active'
);
select is(
  (select count(*)::int from public.property_reports
    where property_id = '00000000-0000-0000-0000-000000075101' and status = 'resolved'),
  2, 'RESTORE2_los_2_reportes_new_pasan_a_resolved'
);
select is(
  (select count(distinct reviewed_by_admin_id)::int from public.property_reports
    where property_id = '00000000-0000-0000-0000-000000075101'),
  1, 'RESTORE3_reviewed_by_admin_id_es_el_admin_actor_en_ambos'
);
select is(
  (select count(*)::int from public.property_reports
    where property_id = '00000000-0000-0000-0000-000000075101' and resolution = 'Reportes sin fundamento'),
  2, 'RESTORE4_resolution_es_el_motivo_del_admin_en_ambos'
);
select is(
  (select count(*)::int from public.property_reports
    where property_id = '00000000-0000-0000-0000-000000075101' and reviewed_at is not null),
  2, 'RESTORE5_reviewed_at_seteado_en_ambos'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_id = '00000000-0000-0000-0000-000000075101' and action_type = 'restore'),
  1, 'RESTORE6_exactamente_1_admin_actions'
);

-- ── Hardening (mutantes P4/P7 del guardian, 2026-08-28) — admin_actions.
--    old_values/new_values reflejan el estado REAL de la transición (D-
--    ADMIN-ACTIONS), no valores fabricados/copiados uno del otro. ─────────
select is(
  (select old_values->>'status' from public.admin_actions
    where entity_id = '00000000-0000-0000-0000-000000075101' and action_type = 'restore'),
  'suspended', 'RESTORE_AA1_admin_actions_old_values_status_es_el_estado_anterior_real'
);
select is(
  (select new_values->>'status' from public.admin_actions
    where entity_id = '00000000-0000-0000-0000-000000075101' and action_type = 'restore'),
  'active', 'RESTORE_AA2_admin_actions_new_values_status_es_el_destino_de_la_accion'
);
select is(
  (select (new_values ? 'deleted') from public.admin_actions
    where entity_id = '00000000-0000-0000-0000-000000075101' and action_type = 'restore'),
  false, 'RESTORE_AA3_admin_actions_new_values_NO_trae_la_clave_deleted_fuera_de_delete'
);

create temp table result_restore_notif_75 (
  n_type text, n_deep_link text, n_rel_type text, n_rel_id uuid, n_user uuid,
  n_address text, n_resolution text
);
insert into result_restore_notif_75
  select type, deep_link, related_entity_type, related_entity_id, user_id,
         data->>'address', data->>'resolution'
  from public.notifications
  where related_entity_id = '00000000-0000-0000-0000-000000075101';

select is((select count(*)::int from result_restore_notif_75), 1, 'RESTORE7_exactamente_1_notification');
select is((select n_type from result_restore_notif_75), 'property_report_restored', 'RESTORE8_type_property_report_restored');
select is((select n_deep_link from result_restore_notif_75), '/profile/my-listings', 'RESTORE9_deep_link_profile_my_listings');
select is((select n_rel_type from result_restore_notif_75), 'property', 'RESTORE10_related_entity_type_property');
select is((select n_rel_id from result_restore_notif_75), '00000000-0000-0000-0000-000000075101'::uuid, 'RESTORE11_related_entity_id_correcto');
select is((select n_user from result_restore_notif_75), '00000000-0000-0000-0000-000000075002'::uuid, 'RESTORE12_destinatario_es_el_owner');
select is((select n_address from result_restore_notif_75), 'Depa Restore 75', 'RESTORE13_data_address_correcta');
select is((select n_resolution from result_restore_notif_75), 'Reportes sin fundamento', 'RESTORE14_data_resolution_es_el_motivo');

-- ── RESTORE retry — 2ª llamada idéntica no duplica nada. ────────────────────
select public.resolve_property_reports_atomic(
  '00000000-0000-0000-0000-000000075001'::uuid,
  '00000000-0000-0000-0000-000000075101'::uuid,
  'restore', 'Reportes sin fundamento');

select is(
  (select count(*)::int from public.admin_actions where entity_id = '00000000-0000-0000-0000-000000075101'),
  1, 'RESTORE_RETRY1_admin_actions_sigue_en_1_no_se_duplico'
);
select is(
  (select count(*)::int from public.notifications where related_entity_id = '00000000-0000-0000-0000-000000075101'),
  1, 'RESTORE_RETRY2_notifications_sigue_en_1_no_se_duplico'
);
select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000075101'),
  'active', 'RESTORE_RETRY3_status_sigue_active'
);

-- ── RESTORE con 0 reportes 'new' — igual transiciona (D-DEDUPE: restore no
--    depende de que existan reportes, a diferencia de keep_suspended). ──────
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000075102', '00000000-0000-0000-0000-000000075002',
   'casa', 'sale', 'Depa Restore Sin Reportes 75', extensions.ST_SetSRID(extensions.ST_MakePoint(-99.12, 19.42), 4326)::extensions.geography,
   2100000, 'suspended');

select public.resolve_property_reports_atomic(
  '00000000-0000-0000-0000-000000075001'::uuid,
  '00000000-0000-0000-0000-000000075102'::uuid,
  'restore', null);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000075102'),
  'active', 'RESTORE_NOREPORTS1_transiciona_igual_sin_ningun_reporte_que_cerrar'
);
select is(
  (select count(*)::int from public.admin_actions where entity_id = '00000000-0000-0000-0000-000000075102'),
  1, 'RESTORE_NOREPORTS2_admin_actions_se_escribe_igual'
);
select is(
  (select count(*)::int from public.notifications where related_entity_id = '00000000-0000-0000-0000-000000075102'),
  1, 'RESTORE_NOREPORTS3_notification_se_envia_igual'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) REQCHANGES — 00000000-...-075103: happy + retry.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000075103', '00000000-0000-0000-0000-000000075002',
   'departamento', 'rent', 'Depa RequestChanges 75', extensions.ST_SetSRID(extensions.ST_MakePoint(-99.13, 19.43), 4326)::extensions.geography,
   9300, 'suspended');

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000075103', '00000000-0000-0000-0000-000000075004', 'wrong_address', null);

select public.resolve_property_reports_atomic(
  '00000000-0000-0000-0000-000000075001'::uuid,
  '00000000-0000-0000-0000-000000075103'::uuid,
  'request_changes', 'Corrige la dirección');

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000075103'),
  'needs_changes', 'REQCHANGES1_status_transiciona_a_needs_changes'
);
select is(
  (select status::text from public.property_reports where property_id = '00000000-0000-0000-0000-000000075103'),
  'resolved', 'REQCHANGES2_el_reporte_new_pasa_a_resolved'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_id = '00000000-0000-0000-0000-000000075103' and action_type = 'request_changes'),
  1, 'REQCHANGES3_exactamente_1_admin_actions'
);

create temp table result_reqchanges_notif_75 (n_type text, n_deep_link text, n_user uuid, n_resolution text);
insert into result_reqchanges_notif_75
  select type, deep_link, user_id, data->>'resolution'
  from public.notifications where related_entity_id = '00000000-0000-0000-0000-000000075103';

select is((select count(*)::int from result_reqchanges_notif_75), 1, 'REQCHANGES4_exactamente_1_notification');
select is((select n_type from result_reqchanges_notif_75), 'property_report_needs_changes', 'REQCHANGES5_type_property_report_needs_changes');
select is((select n_deep_link from result_reqchanges_notif_75), '/profile/my-listings', 'REQCHANGES6_deep_link_profile_my_listings');
select is((select n_user from result_reqchanges_notif_75), '00000000-0000-0000-0000-000000075002'::uuid, 'REQCHANGES7_destinatario_es_el_owner');
select is((select n_resolution from result_reqchanges_notif_75), 'Corrige la dirección', 'REQCHANGES8_data_resolution_es_el_motivo');

select public.resolve_property_reports_atomic(
  '00000000-0000-0000-0000-000000075001'::uuid,
  '00000000-0000-0000-0000-000000075103'::uuid,
  'request_changes', 'Corrige la dirección');

select is(
  (select count(*)::int from public.admin_actions where entity_id = '00000000-0000-0000-0000-000000075103'),
  1, 'REQCHANGES_RETRY1_admin_actions_sigue_en_1'
);
select is(
  (select count(*)::int from public.notifications where related_entity_id = '00000000-0000-0000-0000-000000075103'),
  1, 'REQCHANGES_RETRY2_notifications_sigue_en_1'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) KEEPSUSP — 00000000-...-075104: happy con reportes; 00000000-...-075105:
--    0 reportes 'new' → NO-OP total (edge case D-DEDUPE).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000075104', '00000000-0000-0000-0000-000000075002',
   'departamento', 'rent', 'Depa KeepSuspended 75', extensions.ST_SetSRID(extensions.ST_MakePoint(-99.14, 19.44), 4326)::extensions.geography,
   9400, 'suspended');

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000075104', '00000000-0000-0000-0000-000000075004', 'inappropriate', null),
  ('00000000-0000-0000-0000-000000075104', '00000000-0000-0000-0000-000000075005', 'duplicate', null);

select public.resolve_property_reports_atomic(
  '00000000-0000-0000-0000-000000075001'::uuid,
  '00000000-0000-0000-0000-000000075104'::uuid,
  'keep_suspended', 'Contenido revisado, se mantiene la suspensión');

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000075104'),
  'suspended', 'KEEPSUSP1_status_se_queda_suspended_sin_cambio'
);
select is(
  (select count(*)::int from public.property_reports
    where property_id = '00000000-0000-0000-0000-000000075104' and status = 'resolved'),
  2, 'KEEPSUSP2_los_2_reportes_new_pasan_a_resolved'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_id = '00000000-0000-0000-0000-000000075104' and action_type = 'keep_suspended'),
  1, 'KEEPSUSP3_exactamente_1_admin_actions'
);

create temp table result_keepsusp_notif_75 (n_type text, n_deep_link text, n_user uuid);
insert into result_keepsusp_notif_75
  select type, deep_link, user_id
  from public.notifications where related_entity_id = '00000000-0000-0000-0000-000000075104';

select is((select count(*)::int from result_keepsusp_notif_75), 1, 'KEEPSUSP4_exactamente_1_notification');
select is((select n_type from result_keepsusp_notif_75), 'property_report_kept_suspended', 'KEEPSUSP5_type_property_report_kept_suspended');
select is((select n_deep_link from result_keepsusp_notif_75), '/profile/my-listings', 'KEEPSUSP6_deep_link_profile_my_listings');
select is((select n_user from result_keepsusp_notif_75), '00000000-0000-0000-0000-000000075002'::uuid, 'KEEPSUSP7_destinatario_es_el_owner');

select public.resolve_property_reports_atomic(
  '00000000-0000-0000-0000-000000075001'::uuid,
  '00000000-0000-0000-0000-000000075104'::uuid,
  'keep_suspended', 'Contenido revisado, se mantiene la suspensión');

select is(
  (select count(*)::int from public.admin_actions where entity_id = '00000000-0000-0000-0000-000000075104'),
  1, 'KEEPSUSP_RETRY1_admin_actions_sigue_en_1_0_reportes_new_restantes'
);
select is(
  (select count(*)::int from public.notifications where related_entity_id = '00000000-0000-0000-0000-000000075104'),
  1, 'KEEPSUSP_RETRY2_notifications_sigue_en_1'
);

-- ── KEEPSUSP con 0 reportes 'new' desde el inicio → NO-OP total. ────────────
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000075105', '00000000-0000-0000-0000-000000075002',
   'departamento', 'rent', 'Depa KeepSuspended SinReportes 75', extensions.ST_SetSRID(extensions.ST_MakePoint(-99.145, 19.445), 4326)::extensions.geography,
   9450, 'suspended');

select public.resolve_property_reports_atomic(
  '00000000-0000-0000-0000-000000075001'::uuid,
  '00000000-0000-0000-0000-000000075105'::uuid,
  'keep_suspended', null);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000075105'),
  'suspended', 'KEEPSUSP_NOREPORTS1_status_sigue_suspended'
);
select is(
  (select count(*)::int from public.admin_actions where entity_id = '00000000-0000-0000-0000-000000075105'),
  0, 'KEEPSUSP_NOREPORTS2_0_admin_actions_nada_que_resolver_es_no_op_total'
);
select is(
  (select count(*)::int from public.notifications where related_entity_id = '00000000-0000-0000-0000-000000075105'),
  0, 'KEEPSUSP_NOREPORTS3_0_notifications_es_no_op_total'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) DELETE — 00000000-...-075106: happy con reportes + cascada a videos;
--    00000000-...-075107: funciona con 0 reportes.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000075106', '00000000-0000-0000-0000-000000075002',
   'departamento', 'rent', 'Depa Delete 75', extensions.ST_SetSRID(extensions.ST_MakePoint(-99.15, 19.45), 4326)::extensions.geography,
   9500, 'suspended');

insert into public.property_videos (id, property_id, cloudflare_uid, status, position) values
  ('00000000-0000-0000-0000-000000075160', '00000000-0000-0000-0000-000000075106', 'cf-uid-75-delete', 'ready', 1);

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000075106', '00000000-0000-0000-0000-000000075004', 'not_exist_fraud', null),
  ('00000000-0000-0000-0000-000000075106', '00000000-0000-0000-0000-000000075005', 'not_exist_fraud', null),
  ('00000000-0000-0000-0000-000000075106', '00000000-0000-0000-0000-000000075006', 'not_exist_fraud', null);

select is(
  (select deleted_at from public.properties where id = '00000000-0000-0000-0000-000000075106'),
  null, 'DELETE_FIXTURE_precondicion_deleted_at_es_null'
);

select public.resolve_property_reports_atomic(
  '00000000-0000-0000-0000-000000075001'::uuid,
  '00000000-0000-0000-0000-000000075106'::uuid,
  'delete', 'Fraude confirmado');

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000075106'),
  'suspended', 'DELETE1_status_se_queda_suspended_NUNCA_deleted_soft_o_deleted_hard'
);
select isnt(
  (select deleted_at from public.properties where id = '00000000-0000-0000-0000-000000075106'),
  null, 'DELETE2_deleted_at_queda_seteado_soft_delete'
);
select isnt(
  (select deleted_at from public.property_videos where id = '00000000-0000-0000-0000-000000075160'),
  null, 'DELETE3_cascada_al_video_property_videos_deleted_at_via_el_trigger_0005'
);
select is(
  (select count(*)::int from public.property_reports
    where property_id = '00000000-0000-0000-0000-000000075106' and status = 'resolved'),
  3, 'DELETE4_los_3_reportes_new_pasan_a_resolved'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_id = '00000000-0000-0000-0000-000000075106' and action_type = 'delete'),
  1, 'DELETE5_exactamente_1_admin_actions'
);

-- ── Hardening (mutante P7 del guardian) — new_values SÍ trae {deleted:true}
--    en la acción delete (D-ADMIN-ACTIONS). ─────────────────────────────────
select is(
  (select (new_values->>'deleted')::boolean from public.admin_actions
    where entity_id = '00000000-0000-0000-0000-000000075106' and action_type = 'delete'),
  true, 'DELETE_AA1_admin_actions_new_values_deleted_true_en_la_accion_delete'
);

create temp table result_delete_notif_75 (n_type text, n_deep_link text, n_user uuid, n_resolution text);
insert into result_delete_notif_75
  select type, deep_link, user_id, data->>'resolution'
  from public.notifications where related_entity_id = '00000000-0000-0000-0000-000000075106';

select is((select count(*)::int from result_delete_notif_75), 1, 'DELETE6_exactamente_1_notification');
select is((select n_type from result_delete_notif_75), 'property_report_deleted', 'DELETE7_type_property_report_deleted');
select is((select n_deep_link from result_delete_notif_75), '/profile/my-listings', 'DELETE8_deep_link_profile_my_listings');
select is((select n_user from result_delete_notif_75), '00000000-0000-0000-0000-000000075002'::uuid, 'DELETE9_destinatario_es_el_owner');
select is((select n_resolution from result_delete_notif_75), 'Fraude confirmado', 'DELETE10_data_resolution_es_el_motivo');

-- ── DELETE retry — deleted_at ya seteado, 2ª llamada es no-op. ──────────────
select public.resolve_property_reports_atomic(
  '00000000-0000-0000-0000-000000075001'::uuid,
  '00000000-0000-0000-0000-000000075106'::uuid,
  'delete', 'Fraude confirmado');

select is(
  (select count(*)::int from public.admin_actions where entity_id = '00000000-0000-0000-0000-000000075106'),
  1, 'DELETE_RETRY1_admin_actions_sigue_en_1'
);
select is(
  (select count(*)::int from public.notifications where related_entity_id = '00000000-0000-0000-0000-000000075106'),
  1, 'DELETE_RETRY2_notifications_sigue_en_1'
);

-- ── DELETE con 0 reportes 'new' — igual funciona (deleted_at es el ancla, no
--    los reportes). ──────────────────────────────────────────────────────────
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000075107', '00000000-0000-0000-0000-000000075002',
   'departamento', 'rent', 'Depa Delete SinReportes 75', extensions.ST_SetSRID(extensions.ST_MakePoint(-99.155, 19.455), 4326)::extensions.geography,
   9550, 'suspended');

select public.resolve_property_reports_atomic(
  '00000000-0000-0000-0000-000000075001'::uuid,
  '00000000-0000-0000-0000-000000075107'::uuid,
  'delete', null);

select isnt(
  (select deleted_at from public.properties where id = '00000000-0000-0000-0000-000000075107'),
  null, 'DELETE_NOREPORTS1_deleted_at_se_setea_igual_sin_ningun_reporte'
);
select is(
  (select count(*)::int from public.admin_actions where entity_id = '00000000-0000-0000-0000-000000075107'),
  1, 'DELETE_NOREPORTS2_admin_actions_se_escribe_igual'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) SCOPE — 00000000-...-075109 (se resuelve) y 00000000-...-075110
--    (hermana, NUNCA se toca) — cada una con sus propios reportes 'new'.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000075109', '00000000-0000-0000-0000-000000075002',
   'departamento', 'rent', 'Depa Scope A 75', extensions.ST_SetSRID(extensions.ST_MakePoint(-99.19, 19.49), 4326)::extensions.geography,
   9600, 'suspended'),
  ('00000000-0000-0000-0000-000000075110', '00000000-0000-0000-0000-000000075002',
   'departamento', 'rent', 'Depa Scope B 75', extensions.ST_SetSRID(extensions.ST_MakePoint(-99.20, 19.50), 4326)::extensions.geography,
   9700, 'suspended');

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000075109', '00000000-0000-0000-0000-000000075004', 'misleading', null),
  ('00000000-0000-0000-0000-000000075110', '00000000-0000-0000-0000-000000075004', 'misleading', null);

select public.resolve_property_reports_atomic(
  '00000000-0000-0000-0000-000000075001'::uuid,
  '00000000-0000-0000-0000-000000075109'::uuid,
  'restore', null);

select is(
  (select status::text from public.property_reports where property_id = '00000000-0000-0000-0000-000000075109'),
  'resolved', 'SCOPE1_los_reportes_de_A_se_cierran'
);
select is(
  (select status::text from public.property_reports where property_id = '00000000-0000-0000-0000-000000075110'),
  'new', 'SCOPE2_los_reportes_de_B_siguen_new_intactos'
);
select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000075110'),
  'suspended', 'SCOPE3_B_sigue_suspended_no_se_toco'
);
select is(
  (select count(*)::int from public.admin_actions where entity_id = '00000000-0000-0000-0000-000000075110'),
  0, 'SCOPE4_0_admin_actions_para_B'
);

-- ── Hardening (mutante P1 del guardian) — reusa la llamada de A (SCOPE,
--    'restore' con p_reason=null sobre 075109, ya hecha arriba): NO se
--    fabrica texto por defecto cuando el admin no da motivo. ───────────────
select is(
  (select resolution from public.property_reports
    where property_id = '00000000-0000-0000-0000-000000075109'),
  null, 'SCOPE5_property_reports_resolution_es_null_cuando_p_reason_es_null_no_se_fabrica_texto'
);
select is(
  (select (data ? 'resolution') from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000075109'),
  false, 'SCOPE6_notifications_data_no_trae_la_clave_resolution_cuando_p_reason_es_null'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8) ALREADYRES — 00000000-...-075111: 1 reporte 'new' + 1 reporte YA
--    'dismissed' (con su propio reviewed_at/admin/resolution previos, sembrado
--    directo -- fuera del SUT, simula una resolución anterior).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000075111', '00000000-0000-0000-0000-000000075002',
   'departamento', 'rent', 'Depa AlreadyRes 75', extensions.ST_SetSRID(extensions.ST_MakePoint(-99.21, 19.51), 4326)::extensions.geography,
   9800, 'suspended');

insert into public.property_reports
  (property_id, reported_by_user_id, reason, reason_text, status, reviewed_by_admin_id, reviewed_at, resolution) values
  ('00000000-0000-0000-0000-000000075111', '00000000-0000-0000-0000-000000075004', 'duplicate', null,
   'dismissed', '00000000-0000-0000-0000-000000075007', '2026-01-01 00:00:00+00', 'Ya revisado antes, sin fundamento');
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000075111', '00000000-0000-0000-0000-000000075005', 'inappropriate', null);

select public.resolve_property_reports_atomic(
  '00000000-0000-0000-0000-000000075001'::uuid,
  '00000000-0000-0000-0000-000000075111'::uuid,
  'restore', 'Segundo reporte revisado');

select is(
  (select count(*)::int from public.property_reports
    where property_id = '00000000-0000-0000-0000-000000075111' and status = 'resolved'),
  1, 'ALREADYRES1_solo_1_reporte_pasa_a_resolved_el_new'
);
select is(
  (select resolution from public.property_reports
    where property_id = '00000000-0000-0000-0000-000000075111' and status = 'dismissed'),
  'Ya revisado antes, sin fundamento',
  'ALREADYRES2_el_reporte_ya_dismissed_NO_se_reescribe_conserva_su_resolution_previa'
);
select is(
  (select reviewed_by_admin_id from public.property_reports
    where property_id = '00000000-0000-0000-0000-000000075111' and status = 'dismissed'),
  '00000000-0000-0000-0000-000000075007'::uuid,
  'ALREADYRES3_el_reporte_ya_dismissed_conserva_su_reviewed_by_admin_id_previo_no_el_admin_actual'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 9) SELF — 00000000-...-075112: el admin actor ES el owner (gestiona su
--    propia propiedad) → 0 notifications, pero SÍ se resuelve.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000075112', '00000000-0000-0000-0000-000000075003',
   'departamento', 'rent', 'Depa Self 75', extensions.ST_SetSRID(extensions.ST_MakePoint(-99.22, 19.52), 4326)::extensions.geography,
   9900, 'suspended');

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000075112', '00000000-0000-0000-0000-000000075004', 'misleading', null);

select public.resolve_property_reports_atomic(
  '00000000-0000-0000-0000-000000075003'::uuid,
  '00000000-0000-0000-0000-000000075112'::uuid,
  'restore', null);

select is(
  (select count(*)::int from public.notifications where related_entity_id = '00000000-0000-0000-0000-000000075112'),
  0, 'SELF1_el_admin_actor_nunca_se_auto_notifica'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_id = '00000000-0000-0000-0000-000000075112' and action_type = 'restore'),
  1, 'SELF2_pero_la_resolucion_SI_se_registra_en_admin_actions'
);
select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000075112'),
  'active', 'SELF3_y_el_status_SI_transiciona'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 10) FAULT — 🔒 BLOQUEANTE fault-injection: INSERT hacia notifications
--    envenenado → toda la llamada lanza excepción y NADA persiste.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000075114', '00000000-0000-0000-0000-000000075002',
   'departamento', 'rent', 'Depa Fault 75', extensions.ST_SetSRID(extensions.ST_MakePoint(-99.23, 19.53), 4326)::extensions.geography,
   10100, 'suspended');

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000075114', '00000000-0000-0000-0000-000000075004', 'misleading', null);

create or replace function pg_temp.poison_notifications_insert_75()
returns trigger language plpgsql as $poison$
begin
  raise exception 'poison: fault injection forzada (pgTAP 75_moderate_property_report_resolution_test) para probar rollback total del evento'
    using errcode = '23505';
end
$poison$;

create trigger poison_notifications_before_insert_75
  before insert on public.notifications
  for each row execute function pg_temp.poison_notifications_insert_75();

select throws_ok(
  $$ select public.resolve_property_reports_atomic(
       '00000000-0000-0000-0000-000000075001'::uuid,
       '00000000-0000-0000-0000-000000075114'::uuid,
       'restore', 'Reportes sin fundamento') $$,
  '23505', null,
  'FAULT1_el_insert_de_notifications_falla_y_TODO_el_evento_lanza_excepcion'
);

drop trigger if exists poison_notifications_before_insert_75 on public.notifications;

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000075114'),
  'suspended', 'FAULT2_atomicidad_el_status_NO_quedo_restaurado'
);
select is(
  (select count(*)::int from public.property_reports
    where property_id = '00000000-0000-0000-0000-000000075114' and status = 'new'),
  1, 'FAULT3_atomicidad_el_reporte_NO_quedo_cerrado_sigue_new'
);
select is(
  (select count(*)::int from public.admin_actions where entity_id = '00000000-0000-0000-0000-000000075114'),
  0, 'FAULT4_atomicidad_0_admin_actions_huerfano'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 11) REGRESION — #218: moderate_property_atomic (esta migración NO la toca)
--    sigue transicionando exactamente igual que antes.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000075201', 'agente_regresion_75@urbea.mx');
update public.users set role = 'agent' where id = '00000000-0000-0000-0000-000000075201';

-- 11a) Publicación inicial (SIN revisión) — approve exige pending_review y
--     transiciona directo a active, igual que hoy (39_*, sección sin-revisión).
insert into public.properties
  (id, owner_user_id, operation_type, property_type, price, address, location, status) values
  ('00000000-0000-0000-0000-000000075210', '00000000-0000-0000-0000-000000075201',
   'rent', 'departamento', 8800, 'Calle Regresión 218 #1',
   extensions.ST_SetSRID(extensions.ST_Point(-99.16, 19.46), 4326)::extensions.geography,
   'pending_review');

select public.moderate_property_atomic(
  '00000000-0000-0000-0000-000000075001'::uuid,
  '00000000-0000-0000-0000-000000075210'::uuid,
  'approve',
  jsonb_build_object('status', 'pending_review'),
  jsonb_build_object('status', 'active'),
  null, 'active', null, null, null, null
);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000075210'),
  'active', 'REGRESION1_approve_sin_revision_desde_pending_review_sigue_activando_igual'
);

-- 11b) Con revisión activa — needs_changes solo toca la revisión, properties
--     intacta, igual que hoy (39_*, sección con-revisión).
insert into public.properties
  (id, owner_user_id, operation_type, property_type, price, address, location, status) values
  ('00000000-0000-0000-0000-000000075211', '00000000-0000-0000-0000-000000075201',
   'rent', 'departamento', 8900, 'Calle Regresión 218 #2',
   extensions.ST_SetSRID(extensions.ST_Point(-99.17, 19.47), 4326)::extensions.geography,
   'active');

insert into public.property_revisions (id, property_id, submitted_by, changed_fields, status) values
  ('00000000-0000-0000-0000-000000075212', '00000000-0000-0000-0000-000000075211',
   '00000000-0000-0000-0000-000000075201', jsonb_build_object('price', 9200), 'pending');

select public.moderate_property_atomic(
  '00000000-0000-0000-0000-000000075001'::uuid,
  '00000000-0000-0000-0000-000000075211'::uuid,
  'needs_changes',
  jsonb_build_object('revision_status', 'pending'),
  jsonb_build_object('revision_status', 'needs_changes'),
  'Falta comprobante', null, null,
  '00000000-0000-0000-0000-000000075212'::uuid, 'needs_changes', 'Falta comprobante'
);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000075211'),
  'active', 'REGRESION2_needs_changes_con_revision_properties_intacta'
);
select is(
  (select status::text from public.property_revisions where id = '00000000-0000-0000-0000-000000075212'),
  'needs_changes', 'REGRESION3_la_revision_transiciona_a_needs_changes'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_id = '00000000-0000-0000-0000-000000075211' and action_type = 'needs_changes'),
  1, 'REGRESION4_admin_actions_se_escribe_igual_que_siempre'
);

select * from finish();
rollback;
