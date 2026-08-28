-- Tests pgTAP — trigger de auto-suspensión 3/24h + notificaciones de ambos
-- lados (subtarea #220.2, tarea 220 "reportes de propiedad y auto-moderación").
-- Ejecutar con: supabase test db supabase/tests/74_property_reports_autosuspend_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de
-- una transacción revertida (no persiste) — el superusuario bypassa RLS: el
-- seam bajo prueba es el efecto OBSERVABLE de un INSERT real en
-- public.property_reports (la vía de creación es INSERT directo del cliente,
-- sin Edge Function — decisión Abraham 2026-08-28, ya ancorada por
-- 73_property_reports_create_test.sql), no la autorización de RLS (esa ya la
-- cubre 73_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: el comportamiento OBSERVABLE de un INSERT real sobre
-- public.property_reports — las filas que deja (o no deja) en
-- public.properties.status y en public.notifications. NUNCA internals: no se
-- valida el nombre de ninguna función/trigger por catálogo.
--
-- SUT (AÚN NO EXISTE — RED 2026-08-28): un trigger AFTER INSERT en
-- public.property_reports, MISMA transacción del INSERT, SIN bloque
-- EXCEPTION (🔒 decisión 041/219, reafirmada para 220.2 por Abraham
-- 2026-08-28), que:
--   1. Cuenta, en una ventana deslizante REAL de 24h por created_at (created_at
--      >= now() - interval '24 hours'), cuántos reported_by_user_id
--      DISTINTOS reportaron esa property_id — incluyendo la fila recién
--      insertada.
--   2. Si el conteo de la ventana es >= 3 Y la propiedad NO está ya
--      'suspended' → status = 'suspended' (guard idempotente, SIN índice
--      único de dedupe — permite re-suspensión futura tras restaurar, mismo
--      patrón que admin_revision_pending de 219.1) y dispara
--      admin_report_autosuspend + property_suspended_by_reports.
--   3. Si el conteo de la ventana es 1 o 2 (y la propiedad no está ya
--      suspendida) → dispara admin_report_new.
--   4. Si la propiedad YA está 'suspended' → no-op total, ni siquiera
--      admin_report_new (el reporte SÍ se persiste como fila, auditoría, pero
--      no genera ningún aviso).
--   Fan-out a admins: public.users role='admin' AND deleted_at is null
--   (lección 223.2 — habilita el índice parcial users_role_idx). Guard "nunca
--   el actor": si reported_by_user_id de LA FILA QUE DISPARA el evento es él
--   mismo un admin vivo, se excluye SOLO de ESE evento (mismo guard que las 4
--   funciones de 219.1/219.2) — un admin que reportó una propiedad SÍ recibe
--   los avisos de reportes AJENOS sobre esa misma propiedad, solo nunca el
--   aviso de su PROPIO reporte.
--   NO escribe en admin_actions (decisión Abraham 2026-08-28: sin actor
--   humano, admin_actions.admin_id es NOT NULL FK restrict) — ancla explícita
--   sección ACTIONS.
--
-- ── D-KEY/D-TYPE/D-LINK (catálogo, decisión de diseño del test-author,
--    fijada aquí) ─────────────────────────────────────────────────────────
--   admin_report_new          → deep_link '/admin/reports' (nace en #220.4,
--     MISMA tarea — no es ruta muerta al cerrar) · related_entity_type
--     'property' · data->>'address'.
--   admin_report_autosuspend  → deep_link '/admin/reports' · related_entity_type
--     'property' · data->>'address'.
--   property_suspended_by_reports → deep_link '/profile/my-listings' (ruta
--     viva, mobile/app/(protected)/profile/my-listings.tsx) ·
--     related_entity_type 'property' · data->>'address' Y data->>'reason' =
--     'multiple_reports' (el "motivo" pedido por el orquestador — llave
--     snake_case, consistente con ad_title/address/application_type/
--     agency_name de 219.1).
--
-- ── Convención DELTA vs INVARIANTE ──────────────────────────────────────────
-- DELTA      = falla HOY por assert real (0 filas donde se esperan N, status
--              nunca cambia a suspended, "no exception" donde se espera una)
--              y debe pasar tras el GREEN — 63/90 asserts de este archivo,
--              porque HOY no existe ningún trigger sobre property_reports
--              (verificado: `select tgname from pg_trigger where tgrelid =
--              'public.property_reports'::regclass` solo devuelve los FK
--              RI_ConstraintTrigger_* y set_updated_at).
-- INVARIANTE = ya "pasa" hoy por una razón DISTINTA a la que debe sostenerlo
--              tras el GREEN — 27/90 asserts: ZERO1/ZERO2/ZERO3/ZERO5/ZERO6,
--              HAPPY2/HAPPY4/HAPPY30, TWO1/TWO3/TWO4, ISO2, DEDUPE1/DEDUPE2/
--              DEDUPE4 (el índice de dedupe YA existe desde 0007/220.1 —
--              ajeno al SUT nuevo, pasa por una razón real y estable),
--              WINOLD1/WINOLD3/WINOLD4, ALREADY6, RESUS2 (un UPDATE directo,
--              nunca pasa por el SUT), FAULTB3/FAULTB4/FAULTB5, DELADM3,
--              SELF10, ACTIONS1. Hoy: nada escribe notifications ni cambia
--              status (0 filas / 'active' inmutable es trivialmente cierto);
--              después del GREEN: cierto por el comportamiento CORRECTO
--              (guards, fault-injection revierte todo, admin_actions nunca se
--              toca). El guardian debe re-verificar tras GREEN que las 27
--              siguen en verde por la razón correcta, no por ausencia del SUT.
-- Verificado corriendo la suite HOY (RED): `select plan(90)` → "Looks like you
-- failed 63 tests of 90" — exactamente los 63 DELTA de arriba, ninguno más,
-- 0 errores de sintaxis/catálogo, la transacción llega a rollback limpio (sin
-- "current transaction is aborted").
--
-- ── 🔴 Estrategia RED sin migración-stub + efecto CASCADA de throws_ok ──────
-- Ningún objeto del SUT existe hoy salvo property_reports/properties/
-- notifications/admin_actions (todas de migraciones previas) — un INSERT
-- crudo sobre property_reports NO lanza (no referencia ningún objeto
-- inexistente), simplemente no dispara ningún trigger nuevo: las aserciones
-- de conteo/status fallan LIMPIO contra 0 filas / 'active' inmutable (RED por
-- assert). Las secciones FAULTA/FAULTB usan throws_ok esperando una excepción
-- que HOY nunca ocurre (nada escribe hacia notifications, así que el trigger
-- "veneno" jamás se dispara) — pgTAP throws_ok NO usa savepoint propio: si no
-- hay excepción, el INSERT que intentaba SÍ se ejecuta y SÍ persiste dentro de
-- la transacción (mismo gotcha documentado en 73_property_reports_create_test
-- sección 3). Efecto CASCADA verificado en este archivo: FAULTA1 y FAULTB1
-- (throws_ok) fallan hoy, y por cascada TAMBIÉN fallan FAULTA2/FAULTB2
-- (conteo de property_reports > 0 en vez de 0, porque el INSERT "fallido" en
-- realidad persistió). FAULTB3/FAULTB4/FAULTB5 se sostienen HOY solos
-- (INVARIANTE, ver arriba) pese a la cascada, porque nada en el flujo actual
-- cambia status ni escribe notifications de todos modos.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ───────────────
-- ZERO      — 0 admins de plataforma: el 3er reporte SÍ suspende (decisión:
--   la suspensión NO depende de que existan admins) y el owner SÍ recibe su
--   espejo; 0 avisos admin_* porque no hay a quién.
-- HAPPY     — exactamente 3 reporteros distintos en 24h: 1º y 2º reporte →
--   admin_report_new (x2 admins cada uno); 3er reporte → suspende +
--   admin_report_autosuspend (x2) + property_suspended_by_reports (al owner,
--   x1) — NUNCA un admin_report_new adicional en el 3er reporte. Contrato
--   EXACTO de fila (type/deep_link/related_entity_type/_id/data/body) de los
--   3 tipos.
-- TWO/ISO   — exactamente 2 reporteros distintos: NO suspende, solo
--   admin_report_new x2 eventos; y NO contamina ni es contaminado por HAPPY
--   (propiedades distintas permanecen con su status propio).
-- DEDUPE    — un 2º INSERT del MISMO usuario sobre la MISMA propiedad es
--   rechazado por el índice de 220.1 (23505): ni cuenta para la ventana ni
--   duplica avisos ni crea una 2ª fila.
-- WINOLD    — ventana deslizante real: 2 reportes con created_at > 24h atrás
--   (ya fuera de ventana en el momento en que se insertan, medido contra el
--   now() REAL, no contra su propio timestamp fingido) + 1 reciente → el
--   conteo de ventana nunca pasa de 1 → NO dispara la suspensión, solo
--   admin_report_new del reciente.
-- WINSPREAD — 3 reportes repartidos en 23h/12h/ahora, TODOS dentro de la
--   ventana de 24h pese a estar repartidos → SÍ dispara la suspensión.
-- ALREADY   — propiedad ya 'suspended': el 4º reporte (nuevo usuario
--   distinto) es no-op total — no re-suspende (el status no cambia porque ya
--   estaba así), no genera NINGÚN aviso nuevo (ni admin_report_new ni
--   admin_report_autosuspend), pero el reporte SÍ se persiste como fila
--   (auditoría).
-- RESUS     — re-suspensión: tras restaurar status='active' a mano (simula
--   la acción admin, fuera del SUT de esta subtarea), un reporte nuevo que
--   vuelve a completar >=3 en ventana SÍ vuelve a suspender y SÍ vuelve a
--   notificar (esto es lo que exige NO tener índice único de dedupe en el
--   escritor — mismo criterio que admin_revision_pending).
-- FAULTA/B  — 🔒 BLOQUEANTE fault-injection: si el INSERT hacia notifications
--   falla, el INSERT del reporte entero revierte — 2 caminos representativos
--   (FAULTA: el más simple, un 1er reporte que solo dispara admin_report_new;
--   FAULTB: el más compuesto, el 3er reporte que dispara autosuspend +
--   property UPDATE + 3 tipos de aviso — todo debe revertir junto).
-- DELADM    — un admin con deleted_at poblado NUNCA aparece como
--   destinatario (ni admin_report_new ni admin_report_autosuspend).
-- SELF      — un admin que TAMBIÉN reporta la propiedad no recibe el aviso de
--   SU PROPIO reporte, pero SÍ recibe los avisos de reportes AJENOS sobre esa
--   misma propiedad (guard "nunca el actor", no "nunca cualquier admin
--   involucrado").
-- ACTIONS   — cero filas nuevas en admin_actions en todo el archivo (decisión
--   Abraham: sin actor humano).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(93);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) ZERO — 0 admins de plataforma: la suspensión y el espejo al owner NO
--    dependen de que existan admins. DEBE correr ANTES de sembrar ningún
--    admin en el resto del archivo.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.users where role = 'admin'), 0,
  'ZERO1_FIXTURE_ANCHOR_cero_admins_en_toda_la_base_al_arrancar_el_archivo'
);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000074001', 'owner_zero_admins_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074002', 'rz1_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074003', 'rz2_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074004', 'rz3_74@urbea.mx');

insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000074100', '00000000-0000-0000-0000-000000074001',
   'departamento', 'rent', 'Depa Zero Admins 74, CDMX',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-99.10, 19.40), 4326)::extensions.geography,
   9500, 'active');

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074100', '00000000-0000-0000-0000-000000074002', 'misleading', null);
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074100', '00000000-0000-0000-0000-000000074003', 'misleading', null);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000074100'),
  'active', 'ZERO2_solo_2_de_3_reporteros_status_sigue_active'
);

create temp table result_zero_74 (ok boolean, err_sqlstate text);
do $$
begin
  insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
    ('00000000-0000-0000-0000-000000074100', '00000000-0000-0000-0000-000000074004', 'misleading', null);
  insert into result_zero_74 values (true, null);
exception when others then
  insert into result_zero_74 values (false, sqlstate);
end $$;

select is((select ok from result_zero_74), true,
  'ZERO3_el_3er_reporte_con_0_admins_no_lanza_excepcion');
select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000074100'),
  'suspended', 'ZERO4_3_reporteros_distintos_suspende_aunque_no_haya_ningun_admin'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074100' and type = 'admin_report_new'),
  0, 'ZERO5_0_admins_0_avisos_admin_report_new'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074100' and type = 'admin_report_autosuspend'),
  0, 'ZERO6_0_admins_0_avisos_admin_report_autosuspend'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074100' and type = 'property_suspended_by_reports'
      and user_id = '00000000-0000-0000-0000-000000074001'),
  1, 'ZERO7_el_owner_SI_recibe_su_espejo_pese_a_0_admins_desacoplado_del_fanout_admin'
);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures globales — 2 admins de plataforma, 1 owner compartido, pool de
-- reporteros (reusados: el dedupe es por property_id, no globalmente).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000074011', 'admin1_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074012', 'admin2_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074013', 'owner_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074021', 'r1_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074022', 'r2_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074023', 'r3_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074024', 'r4_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074025', 'r5_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074026', 'r6_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074027', 'r7_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074028', 'r8_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074029', 'r9_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074030', 'r10_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074031', 'r11_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074032', 'r12_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074033', 'r13_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074034', 'r14_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074035', 'r15_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074036', 's1_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074037', 's2_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074038', 's3_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074039', 's4_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074041', 'fa1_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074042', 'fb1_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074043', 'fb2_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074044', 'fb3_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074045', 'da1_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074046', 'da2_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074047', 'da3_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074048', 'se2_74@urbea.mx'),
  ('00000000-0000-0000-0000-000000074049', 'se3_74@urbea.mx');

update public.users set role = 'admin'
 where id in ('00000000-0000-0000-0000-000000074011', '00000000-0000-0000-0000-000000074012');

select is((select count(*)::int from public.users where role = 'admin'), 2,
  'FIXTURE_ANCHOR_exactamente_2_admins_sembrados_para_el_resto_del_archivo');

-- 12 propiedades del owner compartido, una por sección.
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status)
select
  ('00000000-0000-0000-0000-0000000741' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000074013',
  'departamento', 'rent', 'Depa Autosuspend 74 #' || n,
  extensions.ST_SetSRID(extensions.ST_MakePoint(-99.15, 19.42), 4326)::extensions.geography,
  9800, 'active'
from generate_series(1, 12) as n;
-- IDs resultantes: ...074101 (HAPPY) .. 074112 (SELF), ver mapa en cada sección.

-- ════════════════════════════════════════════════════════════════════════════
-- 1) HAPPY — 00000000-...-074101: exactamente 3 reporteros distintos.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074101', '00000000-0000-0000-0000-000000074021', 'not_exist_fraud', null);

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074101' and type = 'admin_report_new'),
  2, 'HAPPY1_1er_reporte_2_admins_reciben_admin_report_new'
);
select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000074101'),
  'active', 'HAPPY2_1er_reporte_status_sigue_active'
);

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074101', '00000000-0000-0000-0000-000000074022', 'misleading', null);

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074101' and type = 'admin_report_new'),
  4, 'HAPPY3_2o_reporte_el_conteo_crece_a_4_2_eventos_x_2_admins'
);
select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000074101'),
  'active', 'HAPPY4_2o_reporte_status_sigue_active'
);

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074101', '00000000-0000-0000-0000-000000074023', 'false_price', null);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000074101'),
  'suspended', 'HAPPY5_3er_reporte_3_distintos_en_ventana_suspende'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074101' and type = 'admin_report_new'),
  4, 'HAPPY6_el_3er_reporte_NO_agrega_admin_report_new_sigue_en_4'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074101' and type = 'admin_report_autosuspend'),
  2, 'HAPPY7_el_3er_reporte_dispara_admin_report_autosuspend_x2_admins'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074101' and type = 'property_suspended_by_reports'),
  1, 'HAPPY8_el_owner_recibe_exactamente_1_espejo_property_suspended_by_reports'
);
select is(
  (select array_agg(distinct user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074101' and type = 'admin_report_autosuspend'),
  array[
    '00000000-0000-0000-0000-000000074011'::uuid,
    '00000000-0000-0000-0000-000000074012'::uuid
  ],
  'HAPPY9_los_2_admins_y_solo_ellos_reciben_admin_report_autosuspend'
);
select is(
  (select array_agg(distinct user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074101' and type = 'admin_report_new'),
  array[
    '00000000-0000-0000-0000-000000074011'::uuid,
    '00000000-0000-0000-0000-000000074012'::uuid
  ],
  'HAPPY10_los_2_admins_y_solo_ellos_reciben_admin_report_new_en_las_2_rondas'
);

create temp table result_happy_new_74 (
  n_type text, n_deep_link text, n_rel_type text, n_rel_id uuid, n_address text, n_title text, n_body text
);
insert into result_happy_new_74
  select type, deep_link, related_entity_type, related_entity_id, data->>'address', title, body
  from public.notifications
  where user_id = '00000000-0000-0000-0000-000000074011'
    and related_entity_id = '00000000-0000-0000-0000-000000074101'
    and type = 'admin_report_new'
  order by created_at asc limit 1;

select is((select n_type from result_happy_new_74), 'admin_report_new', 'HAPPY11_type_admin_report_new');
select is((select n_deep_link from result_happy_new_74), '/admin/reports', 'HAPPY12_deep_link_admin_reports');
select is((select n_rel_type from result_happy_new_74), 'property', 'HAPPY13_related_entity_type_property');
select is((select n_rel_id from result_happy_new_74), '00000000-0000-0000-0000-000000074101'::uuid,
  'HAPPY14_related_entity_id_es_el_id_de_la_propiedad');
select is((select n_address from result_happy_new_74), 'Depa Autosuspend 74 #1',
  'HAPPY15_data_address_es_la_direccion_real_de_la_propiedad');
select ok((select n_body from result_happy_new_74) ilike '%Depa Autosuspend 74 #1%',
  'HAPPY16_body_menciona_la_direccion_de_la_propiedad');

create temp table result_happy_susp_74 (
  n_type text, n_deep_link text, n_rel_type text, n_rel_id uuid, n_address text, n_title text, n_body text
);
insert into result_happy_susp_74
  select type, deep_link, related_entity_type, related_entity_id, data->>'address', title, body
  from public.notifications
  where user_id = '00000000-0000-0000-0000-000000074011'
    and related_entity_id = '00000000-0000-0000-0000-000000074101'
    and type = 'admin_report_autosuspend';

select is((select n_type from result_happy_susp_74), 'admin_report_autosuspend', 'HAPPY17_type_admin_report_autosuspend');
select is((select n_deep_link from result_happy_susp_74), '/admin/reports', 'HAPPY18_deep_link_admin_reports');
select is((select n_rel_type from result_happy_susp_74), 'property', 'HAPPY19_related_entity_type_property');
select is((select n_rel_id from result_happy_susp_74), '00000000-0000-0000-0000-000000074101'::uuid,
  'HAPPY20_related_entity_id_es_el_id_de_la_propiedad');
select is((select n_address from result_happy_susp_74), 'Depa Autosuspend 74 #1',
  'HAPPY21_data_address_es_la_direccion_real_de_la_propiedad');
select ok((select n_body from result_happy_susp_74) ilike '%Depa Autosuspend 74 #1%',
  'HAPPY22_body_menciona_la_direccion_de_la_propiedad');

create temp table result_happy_owner_74 (
  n_type text, n_deep_link text, n_rel_type text, n_rel_id uuid, n_address text, n_reason text, n_user uuid
);
insert into result_happy_owner_74
  select type, deep_link, related_entity_type, related_entity_id, data->>'address', data->>'reason', user_id
  from public.notifications
  where related_entity_id = '00000000-0000-0000-0000-000000074101' and type = 'property_suspended_by_reports';

select is((select n_type from result_happy_owner_74), 'property_suspended_by_reports', 'HAPPY23_type_property_suspended_by_reports');
select is((select n_deep_link from result_happy_owner_74), '/profile/my-listings', 'HAPPY24_deep_link_profile_my_listings');
select is((select n_rel_type from result_happy_owner_74), 'property', 'HAPPY25_related_entity_type_property');
select is((select n_rel_id from result_happy_owner_74), '00000000-0000-0000-0000-000000074101'::uuid,
  'HAPPY26_related_entity_id_es_el_id_de_la_propiedad');
select is((select n_address from result_happy_owner_74), 'Depa Autosuspend 74 #1',
  'HAPPY27_data_address_es_la_direccion_real_de_la_propiedad');
select is((select n_reason from result_happy_owner_74), 'multiple_reports', 'HAPPY28_data_reason_multiple_reports');
select is((select n_user from result_happy_owner_74), '00000000-0000-0000-0000-000000074013'::uuid,
  'HAPPY29_el_destinatario_es_el_owner_de_la_propiedad');
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074101' and type = 'property_suspended_by_reports'
      and user_id in ('00000000-0000-0000-0000-000000074011', '00000000-0000-0000-0000-000000074012')),
  0, 'HAPPY30_ningun_admin_recibe_el_espejo_del_owner'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) TWO/ISO — 00000000-...-074102: exactamente 2 reporteros distintos NO
--    suspende; y ninguna de las 2 propiedades contamina a la otra.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074102', '00000000-0000-0000-0000-000000074024', 'wrong_address', null);
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074102', '00000000-0000-0000-0000-000000074025', 'inappropriate', null);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000074102'),
  'active', 'TWO1_solo_2_distintos_no_suspende'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074102' and type = 'admin_report_new'),
  4, 'TWO2_2_eventos_x_2_admins_4_avisos_admin_report_new'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074102' and type = 'admin_report_autosuspend'),
  0, 'TWO3_0_avisos_admin_report_autosuspend'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074102' and type = 'property_suspended_by_reports'),
  0, 'TWO4_0_espejo_al_owner'
);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000074101'),
  'suspended', 'ISO1_HAPPY_sigue_suspended_sin_ser_tocada_por_la_actividad_de_TWO'
);
select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000074102'),
  'active', 'ISO2_TWO_sigue_active_sin_ser_tocada_por_la_actividad_de_HAPPY'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074101' and type = 'property_suspended_by_reports'),
  1, 'ISO3_el_espejo_de_HAPPY_sigue_en_exactamente_1_no_se_incremento_por_TWO'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) DEDUPE — 00000000-...-074103: un 2º INSERT del MISMO usuario es
--    rechazado por el índice de 220.1, ni cuenta ni crea fila ni duplica avisos.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074103', '00000000-0000-0000-0000-000000074021', 'duplicate', null);

select throws_ok(
  $$ insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000074103', '00000000-0000-0000-0000-000000074021', 'misleading', null) $$,
  '23505', null,
  'DEDUPE1_2o_insert_del_mismo_usuario_sobre_la_misma_propiedad_es_rechazado'
);
select is(
  (select count(*)::int from public.property_reports where property_id = '00000000-0000-0000-0000-000000074103'),
  1, 'DEDUPE2_sigue_habiendo_exactamente_1_fila_el_duplicado_no_persistio'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074103' and type = 'admin_report_new'),
  2, 'DEDUPE3_el_intento_duplicado_no_duplico_los_avisos_sigue_en_2'
);
select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000074103'),
  'active', 'DEDUPE4_solo_1_distinto_real_status_sigue_active'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) WINOLD — 00000000-...-074104: ventana deslizante real, 2 reportes con
--    created_at > 24h atrás (medido contra el now() REAL) + 1 reciente.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text, created_at) values
  ('00000000-0000-0000-0000-000000074104', '00000000-0000-0000-0000-000000074026', 'misleading', null, now() - interval '30 hours');
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text, created_at) values
  ('00000000-0000-0000-0000-000000074104', '00000000-0000-0000-0000-000000074027', 'misleading', null, now() - interval '26 hours');

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074104' and type = 'admin_report_new'),
  0, 'WINOLD1_los_2_reportes_fuera_de_ventana_no_generan_ningun_aviso'
);

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074104', '00000000-0000-0000-0000-000000074028', 'misleading', null);

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074104' and type = 'admin_report_new'),
  2, 'WINOLD2_el_reporte_reciente_SI_dispara_admin_report_new_como_1er_reporte_de_la_ventana'
);
select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000074104'),
  'active', 'WINOLD3_conteo_de_ventana_real_es_1_no_suspende'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074104' and type = 'admin_report_autosuspend'),
  0, 'WINOLD4_0_avisos_de_autosuspension'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) WINSPREAD — 00000000-...-074105: 3 reportes repartidos en 23h/12h/ahora,
--    TODOS dentro de la ventana de 24h → SÍ dispara.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text, created_at) values
  ('00000000-0000-0000-0000-000000074105', '00000000-0000-0000-0000-000000074029', 'misleading', null, now() - interval '23 hours');
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text, created_at) values
  ('00000000-0000-0000-0000-000000074105', '00000000-0000-0000-0000-000000074030', 'misleading', null, now() - interval '12 hours');
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074105', '00000000-0000-0000-0000-000000074031', 'misleading', null);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000074105'),
  'suspended', 'WINSPREAD1_3_reportes_repartidos_pero_dentro_de_24h_SI_suspende'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074105' and type = 'admin_report_new'),
  4, 'WINSPREAD2_2_rondas_admin_report_new_4_filas'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074105' and type = 'admin_report_autosuspend'),
  2, 'WINSPREAD3_admin_report_autosuspend_x2'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074105' and type = 'property_suspended_by_reports'),
  1, 'WINSPREAD4_espejo_al_owner_x1'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) ALREADY — 00000000-...-074106: propiedad ya suspended, el 4º reporte es
--    no-op total (no re-suspende, no re-notifica), pero SÍ se persiste la fila.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074106', '00000000-0000-0000-0000-000000074032', 'inappropriate', null);
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074106', '00000000-0000-0000-0000-000000074033', 'inappropriate', null);
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074106', '00000000-0000-0000-0000-000000074034', 'inappropriate', null);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000074106'),
  'suspended', 'ALREADY1_precondicion_los_3_primeros_reportes_ya_suspendieron'
);

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074106', '00000000-0000-0000-0000-000000074035', 'inappropriate', null);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000074106'),
  'suspended', 'ALREADY2_el_4o_reporte_no_cambia_el_status_sigue_suspended'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074106' and type = 'admin_report_autosuspend'),
  2, 'ALREADY3_admin_report_autosuspend_NO_se_duplico_sigue_en_2'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074106' and type = 'property_suspended_by_reports'),
  1, 'ALREADY4_el_espejo_al_owner_NO_se_duplico_sigue_en_1'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074106' and type = 'admin_report_new'),
  4, 'ALREADY5_el_4o_reporte_no_genero_ningun_admin_report_new_sigue_en_4'
);
select is(
  (select count(*)::int from public.property_reports where property_id = '00000000-0000-0000-0000-000000074106'),
  4, 'ALREADY6_el_4o_reporte_SI_se_persistio_como_fila_de_auditoria'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) RESUS — 00000000-...-074107: re-suspensión tras restaurar a mano. Exige
--    NO tener índice único de dedupe en el escritor.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074107', '00000000-0000-0000-0000-000000074036', 'duplicate', null);
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074107', '00000000-0000-0000-0000-000000074037', 'duplicate', null);
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074107', '00000000-0000-0000-0000-000000074038', 'duplicate', null);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000074107'),
  'suspended', 'RESUS1_precondicion_3_reportes_suspendieron'
);

update public.properties set status = 'active' where id = '00000000-0000-0000-0000-000000074107';

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000074107'),
  'active', 'RESUS2_precondicion_un_admin_restauro_la_propiedad_a_mano'
);

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074107', '00000000-0000-0000-0000-000000074039', 'duplicate', null);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000074107'),
  'suspended', 'RESUS3_un_4o_reportero_distinto_completa_3_en_ventana_de_nuevo_y_RE_suspende'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074107' and type = 'admin_report_autosuspend'),
  4, 'RESUS4_admin_report_autosuspend_crece_de_2_a_4_nuevo_ciclo_de_avisos'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074107' and type = 'property_suspended_by_reports'),
  2, 'RESUS5_el_owner_recibe_un_2o_espejo_crece_de_1_a_2'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074107' and type = 'admin_report_new'),
  4, 'RESUS6_el_reporte_que_re_suspende_NO_genero_un_admin_report_new_sigue_en_4'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8) FAULTA/FAULTB — 🔒 BLOQUEANTE fault-injection: si el INSERT hacia
--    notifications falla, el INSERT del reporte entero revierte. Trigger
--    "veneno" DROPEADO tras los asserts que lo necesitan (patrón
--    48_ads_state_machine_test.sql sección 4 / 71_* sección 7).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function pg_temp.poison_notifications_insert_74()
returns trigger language plpgsql as $poison$
begin
  raise exception 'poison: fault injection forzada (pgTAP 74_property_reports_autosuspend_test) para probar rollback total del evento'
    using errcode = '23505';
end
$poison$;
-- 🔴 Los 2 primeros reportes de FAULTB (8.2) son LEGÍTIMOS y tienen que ocurrir
-- ANTES de instalar el veneno: disparan admin_report_new, así que con el trigger
-- ya puesto reventarían fuera de un throws_ok y abortarían la transacción entera
-- de psql (fix del RED, 220.2 — la versión original los tenía después y dejaba
-- 19 asserts sin correr).
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074109', '00000000-0000-0000-0000-000000074042', 'inappropriate', null);
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074109', '00000000-0000-0000-0000-000000074043', 'inappropriate', null);

create trigger poison_notifications_before_insert_74
  before insert on public.notifications
  for each row execute function pg_temp.poison_notifications_insert_74();

-- ── 8.1) FAULTA — 00000000-...-074108: camino simple, 1er reporte
--    (solo dispararía admin_report_new). ─────────────────────────────────────
select throws_ok(
  $$ insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000074108', '00000000-0000-0000-0000-000000074041', 'misleading', null) $$,
  '23505', null,
  'FAULTA1_camino_simple_1er_reporte_el_insert_de_notifications_falla_y_TODO_el_evento_lanza_excepcion'
);
select is(
  (select count(*)::int from public.property_reports where property_id = '00000000-0000-0000-0000-000000074108'),
  0, 'FAULTA2_atomicidad_el_reporte_NO_quedo_creado_pese_al_fallo_posterior_del_aviso'
);

-- ── 8.2) FAULTB — 00000000-...-074109: camino compuesto, el 3er reporte
--    (autosuspend + UPDATE properties + 3 tipos de aviso) revierte TODO
--    junto. Sus 2 primeros reportes ya se sembraron arriba, antes del poison. ─
select throws_ok(
  $$ insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000074109', '00000000-0000-0000-0000-000000074044', 'inappropriate', null) $$,
  '23505', null,
  'FAULTB1_camino_compuesto_3er_reporte_el_insert_de_notifications_falla_y_TODO_el_evento_lanza_excepcion'
);

drop trigger if exists poison_notifications_before_insert_74 on public.notifications;

select is(
  (select count(*)::int from public.property_reports where property_id = '00000000-0000-0000-0000-000000074109'),
  2, 'FAULTB2_atomicidad_el_3er_reporte_NO_quedo_creado_sigue_en_2_filas'
);
select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000074109'),
  'active', 'FAULTB3_atomicidad_la_propiedad_NO_quedo_suspendida_pese_al_fallo_posterior_del_aviso'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074109' and type = 'admin_report_autosuspend'),
  0, 'FAULTB4_atomicidad_0_avisos_admin_report_autosuspend_huerfanos'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074109' and type = 'property_suspended_by_reports'),
  0, 'FAULTB5_atomicidad_0_espejo_huerfano_al_owner'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 9) DELADM — 00000000-...-074110: un admin dado de baja (deleted_at) NUNCA
--    aparece como destinatario. Se agrega DESPUÉS de que las secciones
--    anteriores ya fijaron sus arrays exactos de 2 admins (mismo criterio que
--    71 sección 11).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000074015', 'admin3_deleted_74@urbea.mx');
update public.users set role = 'admin', deleted_at = now()
 where id = '00000000-0000-0000-0000-000000074015';

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074110', '00000000-0000-0000-0000-000000074045', 'misleading', null);
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074110', '00000000-0000-0000-0000-000000074046', 'misleading', null);
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074110', '00000000-0000-0000-0000-000000074047', 'misleading', null);

select is(
  (select array_agg(distinct user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074110' and type = 'admin_report_new'),
  array[
    '00000000-0000-0000-0000-000000074011'::uuid,
    '00000000-0000-0000-0000-000000074012'::uuid
  ],
  'DELADM1_admin_report_new_excluye_al_admin_dado_de_baja'
);
select is(
  (select array_agg(distinct user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074110' and type = 'admin_report_autosuspend'),
  array[
    '00000000-0000-0000-0000-000000074011'::uuid,
    '00000000-0000-0000-0000-000000074012'::uuid
  ],
  'DELADM2_admin_report_autosuspend_excluye_al_admin_dado_de_baja'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074110'
      and user_id = '00000000-0000-0000-0000-000000074015'),
  0, 'DELADM3_el_admin_dado_de_baja_no_recibe_NINGUN_tipo_de_aviso'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 10) SELF — 00000000-...-074111: un admin que TAMBIÉN reporta la propiedad
--    no recibe el aviso de SU PROPIO reporte, pero SÍ recibe los avisos de
--    reportes AJENOS sobre esa misma propiedad (guard "nunca el actor", 219.1/
--    219.2).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000074014', 'admin_reporter_74@urbea.mx');
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000074014';

-- Reporte 1: el propio admin_reporter (074014) reporta la propiedad.
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074111', '00000000-0000-0000-0000-000000074014', 'inappropriate', null);

select is(
  (select array_agg(distinct user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074111' and type = 'admin_report_new'),
  array[
    '00000000-0000-0000-0000-000000074011'::uuid,
    '00000000-0000-0000-0000-000000074012'::uuid
  ],
  'SELF1_el_admin_que_reporto_NO_se_recibe_a_si_mismo_solo_los_otros_2_admins'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074111' and type = 'admin_report_new'),
  2, 'SELF2_2_destinatarios_tras_el_1er_reporte_del_propio_admin'
);

-- Reporte 2: un usuario regular reporta la misma propiedad — AHORA sí
-- corresponde avisarle a admin_reporter (no es el actor de ESTE evento).
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074111', '00000000-0000-0000-0000-000000074048', 'inappropriate', null);

select is(
  (select array_agg(distinct user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074111' and type = 'admin_report_new'),
  array[
    '00000000-0000-0000-0000-000000074011'::uuid,
    '00000000-0000-0000-0000-000000074012'::uuid,
    '00000000-0000-0000-0000-000000074014'::uuid
  ],
  'SELF3_tras_el_2o_reporte_ajeno_admin_reporter_SI_aparece_como_destinatario'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074111' and type = 'admin_report_new'),
  5, 'SELF4_5_filas_2_del_1er_reporte_mas_3_del_2o_reporte'
);

-- Reporte 3: otro usuario regular completa 3 distintos → autosuspende;
-- admin_reporter tampoco es el actor de este evento, SÍ recibe.
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074111', '00000000-0000-0000-0000-000000074049', 'inappropriate', null);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000074111'),
  'suspended', 'SELF5_el_3er_reporte_suspende'
);
select is(
  (select array_agg(distinct user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074111' and type = 'admin_report_autosuspend'),
  array[
    '00000000-0000-0000-0000-000000074011'::uuid,
    '00000000-0000-0000-0000-000000074012'::uuid,
    '00000000-0000-0000-0000-000000074014'::uuid
  ],
  'SELF6_admin_report_autosuspend_incluye_a_admin_reporter_no_es_el_actor_de_este_evento'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074111' and type = 'admin_report_autosuspend'),
  3, 'SELF7_3_destinatarios_de_admin_report_autosuspend'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074111' and type = 'admin_report_new'),
  5, 'SELF8_admin_report_new_no_cambio_por_el_3er_reporte_sigue_en_5'
);
select is(
  (select array_agg(user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074111' and type = 'property_suspended_by_reports'),
  array['00000000-0000-0000-0000-000000074013'::uuid],
  'SELF9_property_suspended_by_reports_solo_va_al_owner_no_a_ningun_admin'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074111'
      and user_id = '00000000-0000-0000-0000-000000074015'),
  0, 'SELF10_el_admin_dado_de_baja_tampoco_recibe_nada_aqui'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 10.b) SELFSUSP — 00000000-...-074112: el guard "nunca el actor" en la rama
--    de AUTOSUSPEND. La sección 10 solo probaba el caso positivo (el admin
--    reportó ANTES y el 3er reporte lo hace otro), así que el guard de esa
--    rama estaba sin anclar y se podía borrar con la suite en verde
--    (hallazgo del guardian, 220.2). Aquí el admin ES el 3er reportero: el
--    que DISPARA la suspensión.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074112', '00000000-0000-0000-0000-000000074021', 'inappropriate', null);
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074112', '00000000-0000-0000-0000-000000074022', 'inappropriate', null);
-- 3er reportero = el admin 074014 → dispara la autosuspensión y es el ACTOR.
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000074112', '00000000-0000-0000-0000-000000074014', 'inappropriate', null);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0000-000000074112'),
  'suspended', 'SELFSUSP1_el_3er_reporte_hecho_por_un_admin_igual_suspende'
);
select is(
  (select array_agg(distinct user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074112' and type = 'admin_report_autosuspend'),
  array[
    '00000000-0000-0000-0000-000000074011'::uuid,
    '00000000-0000-0000-0000-000000074012'::uuid
  ],
  'SELFSUSP2_el_admin_que_disparo_la_suspension_NO_recibe_su_propio_admin_report_autosuspend'
);
select is(
  (select array_agg(user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000074112'
      and type = 'property_suspended_by_reports'),
  array['00000000-0000-0000-0000-000000074013'::uuid],
  'SELFSUSP3_el_owner_SI_recibe_su_espejo_aunque_el_actor_sea_admin'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 11) ACTIONS — cero filas nuevas en admin_actions en todo el archivo
--    (decisión Abraham 2026-08-28: sin actor humano, admin_id es NOT NULL FK
--    restrict).
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.admin_actions
    where entity_id = any(array[
      '00000000-0000-0000-0000-000000074100'::uuid,
      '00000000-0000-0000-0000-000000074101'::uuid,
      '00000000-0000-0000-0000-000000074102'::uuid,
      '00000000-0000-0000-0000-000000074103'::uuid,
      '00000000-0000-0000-0000-000000074104'::uuid,
      '00000000-0000-0000-0000-000000074105'::uuid,
      '00000000-0000-0000-0000-000000074106'::uuid,
      '00000000-0000-0000-0000-000000074107'::uuid,
      '00000000-0000-0000-0000-000000074108'::uuid,
      '00000000-0000-0000-0000-000000074109'::uuid,
      '00000000-0000-0000-0000-000000074110'::uuid,
      '00000000-0000-0000-0000-000000074111'::uuid,
      '00000000-0000-0000-0000-000000074112'::uuid
    ])),
  0, 'ACTIONS1_cero_filas_nuevas_en_admin_actions_para_ninguna_de_las_propiedades_del_archivo'
);

select * from finish();
rollback;
