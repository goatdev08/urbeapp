-- Tests pgTAP — public.agencies.rejection_reason y el motivo en el espejo
-- 'agency_rejected' (tarea #234, derivada de la subtarea 221.2).
-- Ejecutar con: supabase test db supabase/tests/85_agency_rejection_reason_test.sql --local
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL HUECO QUE CIERRA (limitación anclada por REJ5 de la suite 84): al rechazar
-- el REGISTRO de una inmobiliaria, el motivo quedaba SOLO en admin_actions —una
-- tabla que el solicitante no puede leer— y el espejo 'agency_rejected' de
-- #219.2 llegaba con el cuerpo «Tu inmobiliaria "X" fue rechazada.», sin el
-- porqué. El usuario veía la puerta cerrada sin saber qué corregir.
--
-- 🔴 POR QUÉ EL MOTIVO VA EN `body` Y NO SOLO EN `data`: el lector del centro
-- de notificaciones (mobile/src/features/notifications/components/
-- NotificationCard.tsx) renderiza EXCLUSIVAMENTE `title` y `body` — `data` no
-- se lee en ninguna superficie viva. El patrón de ad_rejected/
-- property_revision_rejected mete el motivo solo en `data.rejection_reason`,
-- así que ahí TAMPOCO llega al usuario (hallazgo reportado como derivada, no
-- se toca aquí). Este espejo escribe en AMBOS: `body` para que el solicitante
-- lo LEA hoy sin OTA, y `data.rejection_reason` para conservar la forma exacta
-- del catálogo #219 (cualquier lector futuro que quiera el dato estructurado
-- —una pantalla de detalle, un push— lo encuentra donde ya lo busca).
--
-- SEAM bajo prueba: el comportamiento OBSERVABLE de rechazar/aprobar un
-- registro de inmobiliaria — la columna public.agencies.rejection_reason, la
-- fila en public.notifications que ve el solicitante, y quién puede leer esa
-- columna (RLS + grants de columna). NO se prueba el cuerpo de las funciones.
--
-- SUT: supabase/migrations/20260903100001_agency_rejection_reason.sql
--   (columna nueva + create-or-replace de public.resolve_agency_registration
--    y del trigger public.handle_agency_status_change).
--
-- ── RED: cómo corre la suite completa sin abortar ───────────────────────────
-- En RED la columna NO existe, así que cualquier SELECT/UPDATE que la nombre
-- revienta con 42703 en tiempo de parseo y abortaría la transacción entera
-- (matando los ~20 asserts siguientes). Dos andamios lo evitan — son andamio
-- de TEST, no mocks del SUT: ninguno reimplementa lógica de negocio, ambos
-- pasan por la puerta de producción real (la RPC / el UPDATE que dispara el
-- trigger) y sus valores se comparan contra el valor esperado, no contra
-- "algo".
--   (a) pg_temp.agency_reason(uuid) — lee la columna por SQL dinámico y
--       devuelve el centinela '<<SIN_COLUMNA>>' si aún no existe. En RED el
--       assert falla por VALOR ('<<SIN_COLUMNA>>' <> el motivo esperado); en
--       GREEN compara el motivo de verdad. Respeta RLS (SECURITY INVOKER), por
--       eso sirve también para la sección 7.
--   (b) pg_temp.reject_via_studio(...) — escribe la columna por SQL dinámico,
--       SIN fallback: en RED truena y el lives_ok que la envuelve falla como
--       assert (subtransacción propia), sin llevarse la suite.
--
-- ── DECISIONES DE CONTRATO que este archivo FIJA ────────────────────────────
-- D-ADITIVA  `rejection_reason text` NULLABLE y SIN CHECK bidireccional
--            status↔reason (el que sí tiene ads:
--            `(status='rejected') = (rejection_reason is not null)`). Motivo:
--            producción viva — ya hay agencias 'rejected' históricas sin
--            motivo (rechazadas por Studio antes de #221.2) y un CHECK
--            bidireccional NO se puede validar contra esas filas. El
--            invariante lo sostiene la PUERTA (resolve_agency_registration
--            exige `p_reason ~ '\S'` al rechazar), no una constraint.
-- D-BODY     Con motivo: 'Tu inmobiliaria "X" fue rechazada. Motivo: <texto>'.
--            Sin motivo: 'Tu inmobiliaria "X" fue rechazada.' (byte por byte
--            lo de hoy — el camino Studio no se rompe).
-- D-BLANCO   Un motivo de puro espacio en blanco (solo alcanzable por UPDATE
--            directo; la RPC lo rechaza con REASON_REQUIRED) se trata como
--            SIN motivo: `~ '\S'`, NUNCA trim() — trim() solo recorta el
--            espacio ASCII y deja pasar tabuladores y saltos de línea
--            (hallazgo 220.1). Es una frontera de confianza (SQL directo),
--            por eso el guard vive también en el trigger y no solo en la RPC.
-- D-APROBAR  Aprobar escribe `rejection_reason = null` en el MISMO UPDATE (una
--            expresión, cero statements extra): la columna refleja la decisión
--            vigente y nunca queda un motivo colgando en una agencia activa.
--            'rejected' es TERMINAL para el trigger (INVALID_STATUS_TRANSITION
--            desde rejected), así que "aprobar después de rechazar" NO existe
--            como camino — anclado por RR21.
-- D-GRANTS   🔴 CERO grants nuevos, y NO es un olvido: en agencies el SELECT es
--            de TABLA (relacl `authenticated=ardDxtm`, `anon=rDxtm`) y solo el
--            UPDATE es de COLUMNA (attacl sobre las 7 escribibles: name, slug,
--            logo_url, contact_{name,phone,email}, deleted_at — 0008). Un grant
--            de tabla cubre AUTOMÁTICAMENTE las columnas futuras, así que
--            `select('*')` de los builds YA INSTALADOS sigue funcionando (§0.5)
--            sin tocar nada; y como la whitelist de UPDATE es explícita, la
--            columna nueva nace fuera de ella -> `authenticated` no puede
--            reescribir su propio motivo de rechazo. Ese doble efecto es
--            afortunado, no obvio: se ANCLA (RR26/RR27) para que un `grant
--            update` descuidado en el futuro rompa un test en vez de la app.
-- D-RLS      El motivo NO necesita policy nueva: `agencies_select` ya deja
--            fuera las filas 'rejected' del público (solo expone
--            approved/active) y las reserva al solicitante, a quien administra
--            la agencia y al admin. Un tercero no ve la FILA, así que tampoco
--            la columna. Anclado por RR23/RR24/RR25 en vez de asumirlo.
--
-- Suite hermana: 84_resolve_agency_registration_test.sql (contrato de la
-- puerta; su REJ5 —que anclaba la limitación— queda INVERTIDO por esta tarea).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(27);

-- ── Andamio (a): lectura de la columna tolerante al RED ─────────────────────
-- SECURITY INVOKER a propósito: bajo `set local role authenticated` respeta
-- las policies de agencies, que es justo lo que mide la sección 7.
create or replace function pg_temp.agency_reason(p_id uuid)
returns text language plpgsql as $$
declare v_reason text;
begin
  execute 'select rejection_reason from public.agencies where id = $1'
    into v_reason using p_id;
  return v_reason;
exception
  when undefined_column then return '<<SIN_COLUMNA>>';
end $$;

-- Cuántas filas de esta agencia VE el rol actual (no nombra la columna nueva:
-- mide la policy, y sirve igual en RED y en GREEN).
create or replace function pg_temp.agency_visible_count(p_id uuid)
returns int language sql security invoker as $$
  select count(*)::int from public.agencies where id = p_id;
$$;

-- ── Andamio (b): el camino Studio/SQL directo, SIN fallback ─────────────────
create or replace function pg_temp.reject_via_studio(p_id uuid, p_admin uuid, p_reason text)
returns void language plpgsql as $$
begin
  perform set_config('urbea.admin_actor_id', p_admin::text, true);
  execute 'update public.agencies set status = ''rejected'', rejection_reason = $1 where id = $2'
    using p_reason, p_id;
end $$;

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- Fixtures — prefijo '00000000-0000-0000-0000-000000085XXX'.
--   ADMIN(085001)    admin de plataforma que resuelve.
--   CREATOR1(085002) creó AG1 -> RECHAZO CON MOTIVO por la RPC.
--   CREATOR2(085003) creó AG2 -> RECHAZO SIN MOTIVO por UPDATE directo (Studio).
--   CREATOR3(085004) creó AG3 -> RECHAZO con motivo EN BLANCO (Studio).
--   CREATOR4(085005) creó AG4 -> APROBACIÓN.
--   OUTSIDER(085006) tercero autenticado, ajeno a todas.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000085001', 'admin_85@test.local'),
  ('00000000-0000-0000-0000-000000085002', 'creator1_85@test.local'),
  ('00000000-0000-0000-0000-000000085003', 'creator2_85@test.local'),
  ('00000000-0000-0000-0000-000000085004', 'creator3_85@test.local'),
  ('00000000-0000-0000-0000-000000085005', 'creator4_85@test.local'),
  ('00000000-0000-0000-0000-000000085006', 'outsider_85@test.local');

update public.users set role = 'admin'
 where id = '00000000-0000-0000-0000-000000085001';

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000085101', 'Agencia 85 Uno',    'agencia-85-uno',    'pending_approval', '00000000-0000-0000-0000-000000085002'),
  ('00000000-0000-0000-0000-000000085102', 'Agencia 85 Dos',    'agencia-85-dos',    'pending_approval', '00000000-0000-0000-0000-000000085003'),
  ('00000000-0000-0000-0000-000000085103', 'Agencia 85 Tres',   'agencia-85-tres',   'pending_approval', '00000000-0000-0000-0000-000000085004'),
  ('00000000-0000-0000-0000-000000085104', 'Agencia 85 Cuatro', 'agencia-85-cuatro', 'pending_approval', '00000000-0000-0000-0000-000000085005');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) La columna existe y es ADITIVA (nullable, sin default) — D-ADITIVA.
-- ════════════════════════════════════════════════════════════════════════════

select has_column('public', 'agencies', 'rejection_reason',
  'RR1_agencies_tiene_columna_rejection_reason');

select col_type_is('public', 'agencies', 'rejection_reason', 'text',
  'RR2_la_columna_es_text_libre_no_enum');

select col_is_null('public', 'agencies', 'rejection_reason',
  'RR3_la_columna_es_nullable_las_filas_historicas_no_tienen_motivo');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) RECHAZO CON MOTIVO por la RPC (el camino real de la cola #221.4):
--    la columna se puebla Y el motivo VIAJA en el espejo al solicitante.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000085001'); -- ADMIN
select lives_ok(
  $$ select public.resolve_agency_registration(
       '00000000-0000-0000-0000-000000085101', false, 'Acta constitutiva ilegible') $$,
  'RR4_el_admin_rechaza_con_motivo_por_la_RPC'
);
reset role;

select is(
  pg_temp.agency_reason('00000000-0000-0000-0000-000000085101'),
  'Acta constitutiva ilegible',
  'RR5_el_motivo_queda_en_agencies_rejection_reason'
);

-- El corazón de #234: lo ÚNICO que el solicitante llega a leer es el body.
select is(
  (select body from public.notifications
    where user_id = '00000000-0000-0000-0000-000000085002' and type = 'agency_rejected'),
  'Tu inmobiliaria "Agencia 85 Uno" fue rechazada. Motivo: Acta constitutiva ilegible',
  'RR6_el_body_del_espejo_LLEVA_el_motivo_ANTES_REJ5_de_la_suite_84'
);

-- Forma exacta de ad_rejected (#219.2): el dato estructurado también viaja.
select is(
  (select data ->> 'rejection_reason' from public.notifications
    where user_id = '00000000-0000-0000-0000-000000085002' and type = 'agency_rejected'),
  'Acta constitutiva ilegible',
  'RR7_data_rejection_reason_conserva_la_forma_de_ad_rejected'
);

select is(
  (select data ->> 'agency_name' from public.notifications
    where user_id = '00000000-0000-0000-0000-000000085002' and type = 'agency_rejected'),
  'Agencia 85 Uno',
  'RR8_regresion_data_agency_name_sigue_ahi'
);

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000085002' and type = 'agency_rejected'),
  1, 'RR9_regresion_exactamente_un_espejo_no_se_duplico'
);

-- REGRESIÓN de la suite 84 (D-REASON): la auditoría con el motivo NO se retira
-- al agregar la columna — admin_actions es append-only y es el registro de
-- QUIÉN rechazó y por qué; la columna es el estado vigente, no la historia.
select is(
  (select reason from public.admin_actions
    where action_type = 'reject_agency_registration'
      and entity_id   = '00000000-0000-0000-0000-000000085101'),
  'Acta constitutiva ilegible',
  'RR10_regresion_la_auditoria_del_motivo_sigue_escribiendose'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) RECHAZO SIN MOTIVO (UPDATE directo por Studio, sin tocar la columna):
--    exactamente el comportamiento de HOY. No revienta, no fabrica texto.
-- ════════════════════════════════════════════════════════════════════════════

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000085001', true);
update public.agencies set status = 'rejected'
 where id = '00000000-0000-0000-0000-000000085102';

select is(
  (select body from public.notifications
    where user_id = '00000000-0000-0000-0000-000000085003' and type = 'agency_rejected'),
  'Tu inmobiliaria "Agencia 85 Dos" fue rechazada.',
  'RR11_sin_motivo_el_body_es_byte_por_byte_el_de_hoy'
);

select ok(
  (select not (data ? 'rejection_reason') from public.notifications
    where user_id = '00000000-0000-0000-0000-000000085003' and type = 'agency_rejected'),
  'RR12_sin_motivo_data_NO_trae_la_llave_nunca_se_fabrica_texto'
);

select is(
  pg_temp.agency_reason('00000000-0000-0000-0000-000000085102'),
  null,
  'RR13_sin_motivo_la_columna_queda_null'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) MOTIVO EN BLANCO por SQL directo (frontera de confianza) — D-BLANCO.
--    Tabulador + salto de línea + espacios: `trim()` los dejaría pasar.
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$ select pg_temp.reject_via_studio(
       '00000000-0000-0000-0000-000000085103',
       '00000000-0000-0000-0000-000000085001',
       E' \t\n ') $$,
  'RR14_studio_puede_escribir_la_columna_directo'
);

select is(
  (select body from public.notifications
    where user_id = '00000000-0000-0000-0000-000000085004' and type = 'agency_rejected'),
  'Tu inmobiliaria "Agencia 85 Tres" fue rechazada.',
  'RR15_motivo_en_blanco_NO_ensucia_el_body_con_Motivo_vacio'
);

select ok(
  (select not (data ? 'rejection_reason') from public.notifications
    where user_id = '00000000-0000-0000-0000-000000085004' and type = 'agency_rejected'),
  'RR16_motivo_en_blanco_tampoco_entra_a_data'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) APROBACIÓN — D-APROBAR: la columna refleja la decisión vigente.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000085001'); -- ADMIN
select lives_ok(
  $$ select public.resolve_agency_registration(
       '00000000-0000-0000-0000-000000085104', true) $$,
  'RR17_el_admin_aprueba'
);
reset role;

select is(
  pg_temp.agency_reason('00000000-0000-0000-0000-000000085104'),
  null,
  'RR18_aprobar_deja_la_columna_en_null'
);

select is(
  (select body from public.notifications
    where user_id = '00000000-0000-0000-0000-000000085005' and type = 'agency_approved'),
  'Tu inmobiliaria "Agencia 85 Cuatro" fue aprobada.',
  'RR19_regresion_el_body_de_aprobacion_no_cambia'
);

select ok(
  (select not (data ? 'rejection_reason') from public.notifications
    where user_id = '00000000-0000-0000-0000-000000085005' and type = 'agency_approved'),
  'RR20_el_espejo_de_aprobacion_nunca_lleva_motivo'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) 'rejected' es TERMINAL: "aprobar después de rechazar" no es un camino.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000085001'); -- ADMIN
select throws_ok(
  $$ select public.resolve_agency_registration(
       '00000000-0000-0000-0000-000000085101', true) $$,
  'P0001', 'ALREADY_RESOLVED',
  'RR21_no_se_aprueba_una_agencia_ya_rechazada_rejected_es_terminal'
);
reset role;

select is(
  pg_temp.agency_reason('00000000-0000-0000-0000-000000085101'),
  'Acta constitutiva ilegible',
  'RR22_el_intento_fallido_no_borra_el_motivo'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) EL MOTIVO NO SE FILTRA — D-RLS + D-GRANTS (privacidad: es texto que un
--    admin escribió SOBRE una persona; solo esa persona y quien la administra).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000085006'); -- OUTSIDER
select is(
  pg_temp.agency_visible_count('00000000-0000-0000-0000-000000085101'),
  0, 'RR23_un_tercero_no_ve_ni_la_fila_de_una_agencia_rechazada'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000085002'); -- CREATOR1
select is(
  pg_temp.agency_reason('00000000-0000-0000-0000-000000085101'),
  'Acta constitutiva ilegible',
  'RR24_el_solicitante_SI_lee_su_propio_motivo'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000085001'); -- ADMIN
select is(
  pg_temp.agency_reason('00000000-0000-0000-0000-000000085101'),
  'Acta constitutiva ilegible',
  'RR25_el_admin_lee_el_motivo'
);
reset role;

-- 🔴 §0.5: si la columna nueva quedara FUERA del SELECT de `authenticated`,
-- `select('*')` de los builds YA INSTALADOS tronaría con «permission denied
-- for column rejection_reason». Lo cubre el grant de TABLA de 0008 (que se
-- extiende solo a las columnas nuevas) — este assert lo verifica en vez de
-- suponerlo.
select ok(
  exists (select 1 from information_schema.column_privileges
           where table_schema = 'public' and table_name = 'agencies'
             and column_name = 'rejection_reason'
             and grantee = 'authenticated' and privilege_type = 'SELECT'),
  'RR26_authenticated_LEE_la_columna_select_star_de_builds_instalados_no_truena'
);

-- La otra mitad: el motivo lo escribe el admin, no el rechazado. La whitelist
-- de UPDATE de 0008 es de COLUMNA y explícita, así que la columna nueva nace
-- fuera de ella. Un `grant update (rejection_reason)` futuro rompe este assert.
select ok(
  not exists (select 1 from information_schema.column_privileges
               where table_schema = 'public' and table_name = 'agencies'
                 and column_name = 'rejection_reason'
                 and grantee = 'authenticated' and privilege_type = 'UPDATE'),
  'RR27_authenticated_NO_reescribe_su_propio_motivo_de_rechazo'
);

select * from finish();
rollback;
