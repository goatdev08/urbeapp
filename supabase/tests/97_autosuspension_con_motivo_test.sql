-- Tests pgTAP — RED de la tarea #257 (derivada de #222, paso 10 del smoke).
-- Ejecutar con: supabase test db supabase/tests/97_autosuspension_con_motivo_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de
-- una transacción revertida (no persiste).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: el comportamiento OBSERVABLE de un INSERT real sobre
-- public.property_reports — las filas que deja en public.notifications
-- (data->>'rejection_reason' del trigger
-- public.notify_property_report_and_autosuspend, migración
-- 20260828000002_property_reports_autosuspend.sql). NUNCA internals: no se
-- valida el nombre de ninguna función/trigger por catálogo, solo el efecto.
--
-- SUT (YA EXISTE, delta parcial — NO es RED de "trigger inexistente" como
-- 74_*): la función ya escribe `data = jsonb_build_object('address',
-- v_address, 'reason', 'multiple_reports')` en property_suspended_by_reports
-- y `data = jsonb_build_object('address', v_address)` en
-- admin_report_autosuspend — NINGUNA de las dos trae `rejection_reason`. El
-- GREEN (otro agente) debe agregar una clave `rejection_reason` con las
-- etiquetas LEGIBLES de los motivos agregados de los reportes de la ventana
-- de 24h, deduplicadas, en ESPAÑOL, unidas con el separador ' · ', SIN
-- exponer nunca `reason_text` (texto libre, puede identificar al
-- reportante — PRIVACIDAD [[privacidad-datos]]).
--
-- Catálogo motivo→etiqueta (mismo que ReportPropertySheet.tsx:66-73):
--   not_exist_fraud → "No existe / es un fraude"
--   misleading      → "Información engañosa"
--   false_price     → "Precio falso"
--   wrong_address   → "Dirección incorrecta"
--   inappropriate   → "Contenido inapropiado"
--   duplicate       → "Publicación duplicada"
--   other           → "Otro"
--
-- Ejemplo esperado (verbatim de los `details` de la tarea #257 — fuente
-- INDEPENDIENTE del test, no recomputado del código): con reportes en el
-- orden not_exist_fraud, wrong_address, false_price →
-- "No existe / es un fraude · Dirección incorrecta · Precio falso" (orden de
-- PRIMERA aparición cronológica, no orden del catálogo ni alfabético).
--
-- ── Convención DELTA vs INVARIANTE ──────────────────────────────────────────
-- DELTA (falla HOY, debe pasar tras el GREEN): DIFF1, DIFF_ADMIN1, SAME1,
--   OTHER1 — 4 asserts, porque HOY ninguna de las dos filas de notifications
--   trae la clave `rejection_reason` (data->>'rejection_reason' es NULL en
--   ambas).
-- INVARIANTE (ya pasa HOY por una razón real, debe seguir pasando tras el
--   GREEN): DIFF2 (compat `reason: 'multiple_reports'`, columna que el GREEN
--   NO toca — aditivo puro), OTHER2 (el texto libre nunca aparece — hoy es
--   trivialmente cierto porque no hay NINGUNA clave nueva; tras el GREEN debe
--   seguir sin aparecer, ahora por diseño), ALREADY1/ALREADY2/ALREADY3
--   (el guard `status <> 'suspended'` es AJENO a este delta, ya funciona
--   desde 220.2).
--
-- ── AJUSTES POST-GUARDIAN (2026-09-05) ──────────────────────────────────────
-- (1) DIFF y OTHER fijan `created_at` EXPLÍCITO y distinto por reporte
--     (mismo patrón que WINOLD/WINSPREAD de
--     74_property_reports_autosuspend_test.sql) — el guardian detectó que
--     `created_at` es `transaction_timestamp()` (congelado durante TODA la
--     transacción del test), así que sin timestamps explícitos los 3
--     reportes de un caso quedan con el MISMO created_at y el orden de
--     "1a aparición" dejaba de estar garantizado por el fixture.
-- (2) INAPPDUP1 (sección 5, nueva) cubre las 2 etiquetas del catálogo que
--     ningún otro caso ejercía (`inappropriate`, `duplicate`) + un repetido
--     para confirmar que el dedupe por ENUM también aplica ahí. Ya pasa HOY
--     (el catálogo completo ya estaba en el GREEN) — se agrega como
--     cobertura, no como delta.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ───────────────
-- DIFF    — 3 reportes de 3 usuarios distintos, 3 motivos distintos → el
--   owner recibe rejection_reason con las 3 etiquetas agregadas (orden de
--   1a aparición), Y el mismo agregado también llega a admin_report_autosuspend.
-- SAME    — 3 reportes de 3 usuarios distintos, EL MISMO motivo → una sola
--   etiqueta, no repetida 3 veces.
-- OTHER   — motivo 'other' con reason_text libre (2 reporteros con 'other'
--   y textos libres DISTINTOS, dedupe por el ENUM no por el texto) + 1
--   reportero con otro motivo → aparece "Otro" una sola vez y NUNCA
--   ninguno de los dos textos libres.
-- ALREADY — propiedad ya suspendida (por una ronda previa de 3 reportes) →
--   un 4o reporte con un motivo nuevo NO genera notificación nueva (ni al
--   owner ni a los admins) — early return ya vigente en 220.2.
-- INAPPDUP — catálogo completo: 'inappropriate' + 'duplicate' + un repetido.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(13);

-- Fixtures — prefijo '00000000-0000-0000-0000-000000097XXX'.
--   ADMIN1(097011), ADMIN2(097012) admins de plataforma.
--   OWNER(097013)   dueño compartido de las 4 propiedades del archivo.
--   Reporteros 097021..097030 (reusados: dedupe es por property_id).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000097011', 'admin1_97@urbea.mx'),
  ('00000000-0000-0000-0000-000000097012', 'admin2_97@urbea.mx'),
  ('00000000-0000-0000-0000-000000097013', 'owner_97@urbea.mx'),
  ('00000000-0000-0000-0000-000000097021', 'r1_97@urbea.mx'),
  ('00000000-0000-0000-0000-000000097022', 'r2_97@urbea.mx'),
  ('00000000-0000-0000-0000-000000097023', 'r3_97@urbea.mx'),
  ('00000000-0000-0000-0000-000000097024', 'r4_97@urbea.mx'),
  ('00000000-0000-0000-0000-000000097025', 'r5_97@urbea.mx'),
  ('00000000-0000-0000-0000-000000097026', 'r6_97@urbea.mx'),
  ('00000000-0000-0000-0000-000000097027', 'r7_97@urbea.mx'),
  ('00000000-0000-0000-0000-000000097028', 'r8_97@urbea.mx'),
  ('00000000-0000-0000-0000-000000097029', 'r9_97@urbea.mx'),
  ('00000000-0000-0000-0000-000000097030', 'r10_97@urbea.mx');

update public.users set role = 'admin'
 where id in ('00000000-0000-0000-0000-000000097011', '00000000-0000-0000-0000-000000097012');

-- 5 propiedades del owner compartido, una por sección (DIFF/SAME/OTHER/
-- ALREADY/INAPPDUP).
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status)
select
  ('00000000-0000-0000-0000-0000000971' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000097013',
  'departamento', 'rent', 'Depa Motivo 97 #' || n,
  extensions.ST_SetSRID(extensions.ST_MakePoint(-99.16, 19.41), 4326)::extensions.geography,
  9700, 'active'
from generate_series(1, 5) as n;
-- 097101=DIFF, 097102=SAME, 097103=OTHER, 097104=ALREADY, 097105=INAPPDUP.

-- ════════════════════════════════════════════════════════════════════════════
-- 1) DIFF — 00000000-...-097101: 3 reportes, 3 motivos distintos.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text, created_at) values
  ('00000000-0000-0000-0000-000000097101', '00000000-0000-0000-0000-000000097021', 'not_exist_fraud', null, now() - interval '3 minutes');
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text, created_at) values
  ('00000000-0000-0000-0000-000000097101', '00000000-0000-0000-0000-000000097022', 'wrong_address', null, now() - interval '2 minutes');
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text, created_at) values
  ('00000000-0000-0000-0000-000000097101', '00000000-0000-0000-0000-000000097023', 'false_price', null, now() - interval '1 minute');

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000097101'),
  'suspended', 'DIFF0_FIXTURE_ANCHOR_3_reporteros_distintos_suspende'
);

select is(
  (select data ->> 'rejection_reason' from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000097101'
      and type = 'property_suspended_by_reports'
      and user_id = '00000000-0000-0000-0000-000000097013'),
  'No existe / es un fraude · Dirección incorrecta · Precio falso',
  'DIFF1_el_owner_recibe_las_3_etiquetas_agregadas_en_orden_de_1a_aparicion'
);

select is(
  (select data ->> 'reason' from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000097101'
      and type = 'property_suspended_by_reports'
      and user_id = '00000000-0000-0000-0000-000000097013'),
  'multiple_reports', 'DIFF2_compat_data_reason_multiple_reports_se_conserva'
);

select is(
  (select data ->> 'rejection_reason' from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000097101'
      and type = 'admin_report_autosuspend'
      and user_id = '00000000-0000-0000-0000-000000097011'),
  'No existe / es un fraude · Dirección incorrecta · Precio falso',
  'DIFF_ADMIN1_el_aviso_a_admins_tambien_trae_las_3_etiquetas_agregadas'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) SAME — 00000000-...-097102: 3 reportes, EL MISMO motivo.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000097102', '00000000-0000-0000-0000-000000097024', 'misleading', null);
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000097102', '00000000-0000-0000-0000-000000097025', 'misleading', null);
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000097102', '00000000-0000-0000-0000-000000097026', 'misleading', null);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000097102'),
  'suspended', 'SAME0_FIXTURE_ANCHOR_3_reportes_del_mismo_motivo_igual_suspende'
);

select is(
  (select data ->> 'rejection_reason' from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000097102'
      and type = 'property_suspended_by_reports'
      and user_id = '00000000-0000-0000-0000-000000097013'),
  'Información engañosa',
  'SAME1_una_sola_etiqueta_no_repetida_3_veces'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) OTHER — 00000000-...-097103: 2 reportes 'other' con textos libres
--    DISTINTOS (dedupe por el ENUM, no por el texto) + 1 reporte 'misleading'.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text, created_at) values
  ('00000000-0000-0000-0000-000000097103', '00000000-0000-0000-0000-000000097027', 'other',
   'Esta persona es un estafador conocido, texto libre A', now() - interval '3 minutes');
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text, created_at) values
  ('00000000-0000-0000-0000-000000097103', '00000000-0000-0000-0000-000000097028', 'other',
   'Otro texto libre completamente distinto B', now() - interval '2 minutes');
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text, created_at) values
  ('00000000-0000-0000-0000-000000097103', '00000000-0000-0000-0000-000000097029', 'misleading', null, now() - interval '1 minute');

select is(
  (select data ->> 'rejection_reason' from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000097103'
      and type = 'property_suspended_by_reports'
      and user_id = '00000000-0000-0000-0000-000000097013'),
  'Otro · Información engañosa',
  'OTHER1_la_etiqueta_Otro_una_sola_vez_pese_a_2_reportes_other'
);

select ok(
  (select
     coalesce(data ->> 'rejection_reason', '') not ilike '%estafador conocido%'
     and coalesce(data ->> 'rejection_reason', '') not ilike '%texto libre completamente distinto%'
   from public.notifications
   where related_entity_id = '00000000-0000-0000-0000-000000097103'
     and type = 'property_suspended_by_reports'
     and user_id = '00000000-0000-0000-0000-000000097013'),
  'OTHER2_ningun_reason_text_libre_se_filtra_al_owner'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) ALREADY — 00000000-...-097104: ya suspendida por una ronda previa; un
--    4o reporte con motivo NUEVO no debe generar notificación nueva (ni al
--    owner ni a los admins) — early return de 220.2, AJENO a este delta.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000097104', '00000000-0000-0000-0000-000000097021', 'not_exist_fraud', null);
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000097104', '00000000-0000-0000-0000-000000097022', 'wrong_address', null);
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000097104', '00000000-0000-0000-0000-000000097023', 'false_price', null);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000097104'),
  'suspended', 'ALREADY0_FIXTURE_ANCHOR_ya_suspendida_tras_la_1a_ronda'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000097104'
      and type = 'property_suspended_by_reports'),
  1, 'ALREADY1_exactamente_1_espejo_tras_la_1a_ronda'
);

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000097104', '00000000-0000-0000-0000-000000097030', 'duplicate', null);

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000097104'
      and type = 'property_suspended_by_reports'),
  1, 'ALREADY2_el_4o_reporte_sobre_propiedad_ya_suspendida_no_agrega_notificacion'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000097104'
      and type = 'admin_report_autosuspend'),
  2, 'ALREADY3_el_4o_reporte_tampoco_agrega_avisos_a_admins_sigue_en_2'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) INAPPDUP — 00000000-...-097105: catálogo completo — cubre 'inappropriate'
--    y 'duplicate' (los 2 motivos que ningún otro caso de este archivo
--    ejercía), + 1 repetido (inappropriate otra vez) para confirmar que el
--    3er reporte no agrega una 3a etiqueta.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text, created_at) values
  ('00000000-0000-0000-0000-000000097105', '00000000-0000-0000-0000-000000097021', 'inappropriate', null, now() - interval '3 minutes');
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text, created_at) values
  ('00000000-0000-0000-0000-000000097105', '00000000-0000-0000-0000-000000097022', 'duplicate', null, now() - interval '2 minutes');
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text, created_at) values
  ('00000000-0000-0000-0000-000000097105', '00000000-0000-0000-0000-000000097023', 'inappropriate', null, now() - interval '1 minute');

select is(
  (select data ->> 'rejection_reason' from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000097105'
      and type = 'property_suspended_by_reports'
      and user_id = '00000000-0000-0000-0000-000000097013'),
  'Contenido inapropiado · Publicación duplicada',
  'INAPPDUP1_catalogo_completo_inappropriate_y_duplicate_sin_repetir_la_etiqueta'
);

select * from finish();
rollback;
