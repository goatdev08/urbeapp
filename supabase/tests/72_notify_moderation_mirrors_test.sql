-- Tests pgTAP — espejos de RESOLUCIÓN al usuario afectado (§28.4, solo
-- in-app), subtarea #219.2 (tarea 219 "panel admin centro operativo").
-- Ejecutar con: supabase test db supabase/tests/72_notify_moderation_mirrors_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de
-- una transacción revertida (no persiste) — el superusuario bypassa RLS: el
-- seam bajo prueba es el efecto OBSERVABLE de las 4 funciones/triggers sobre
-- public.notifications, no la autorización de quién puede invocarlos (eso ya
-- lo cubren 25/39/64_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: el comportamiento OBSERVABLE de una llamada real a
--   - public.moderate_property_atomic(...)   (RPC, última def 20260815000005)
--   - public.moderate_ad_atomic(...)          (RPC, última def 20260822000002)
--   - UPDATE sobre public.agencies            (trigger handle_agency_status_change,
--                                               20260805000007)
--   - UPDATE sobre public.agent_applications  (trigger handle_agent_application_
--                                               status_change, 20260805000007)
-- — y las FILAS que dejan (o no dejan) en public.notifications. NUNCA
-- internals: no se valida el nombre de ningún bloque interno nuevo, solo las
-- filas resultantes en notifications y (en la sección 8) la atomicidad
-- observable vía properties.status/admin_actions.
--
-- SUT (AÚN NO EXISTE — RED 2026-08-24): un create-or-replace de las 4
-- funciones/triggers vigentes debe AÑADIR, en la MISMA transacción del
-- evento (sin try/catch — DECISIÓN ABRAHAM, fallo = BLOQUEANTE, igual que
-- 219.1), un INSERT hacia public.notifications cuando la moderación
-- RESUELVE un evento (approve/needs_changes/reject de una revisión o
-- publicación inicial; approve/reject de un anuncio; aprobar/rechazar una
-- agencia o solicitud de agente). Nunca al admin actor. 219.1 cubre la
-- ENTRADA a pending (el aviso a los admins); esta subtarea cubre la
-- RESOLUCIÓN (el aviso de vuelta al afectado) — eventos disjuntos, cero
-- doble-escritura (verificado por el analista: hoy las 4 funciones no tocan
-- notifications en absoluto).
--
-- ── D-KEY/D-TYPE/D-LINK (decisiones de diseño del test-author, fijadas aquí,
--    nombres dados por el orquestador) ───────────────────────────────────────
--   property_revision_approved       → deep_link '/my-listings' · related_entity_type 'property' · related_entity_id = property_id
--   property_revision_needs_changes  → ídem, + data->>'rejection_reason'
--   property_revision_rejected       → ídem, + data->>'rejection_reason'
--     (el MISMO trío de tipos se usa tanto en la rama CON revisión activa
--     como SIN ella — publicación inicial —, ver sección 1 vs 2; el
--     DESTINATARIO es lo que cambia, no el tipo). data SIEMPRE lleva
--     'address' (dirección de la propiedad — properties no tiene 'title').
--     El motivo (needs_changes/reject) viene de p_revision_reason cuando HAY
--     revisión activa, y de p_reason (el motivo general de moderación)
--     cuando NO la hay — la RPC no tiene una columna de "motivo de rechazo"
--     propia de properties, a diferencia de property_revisions.rejection_reason
--     y agent_applications.rejection_reason.
--   ad_approved / ad_rejected / ad_paused → deep_link '/ads' (panel del
--     anunciante, mismo deep_link que notify_ads_expiring_soon
--     20260822000001) · related_entity_type 'ad' · related_entity_id =
--     ad_id · data->>'ad_title'; 'rejection_reason' cuando existe (reject).
--     Los destinatarios son los miembros ACTIVOS owner/admin de la
--     organización dueña del ad — consulta directa a agency_members, mismo
--     patrón que notify_ads_expiring_soon (20260822000001), NUNCA agent/
--     viewer/suspended. 🔴 GOTCHA #168 destapado al escribir este RED: la
--     definición VIGENTE de moderate_ad_atomic NO es 20260822000002 (la que
--     apuntaba el plan) sino 20260823000002 (#210.1 "ad_takedown") — ese
--     create-or-replace AMPLIÓ el guard de p_next_status para admitir
--     también 'paused' (retirar un anuncio activo), además de active/
--     rejected. 'ad_paused' SÍ es una rama alcanzable y SÍ ameritaba espejo
--     — se ejercita en sección 5.8 igual que approve/reject. El único valor
--     que sigue siendo inválido para el guard es cualquier otro (p.ej.
--     'expired', sección 5.6).
--   agency_approved / agency_rejected → deep_link '/profile' ·
--     related_entity_type 'agency' · data->>'agency_name'. Destinatario:
--     old.created_by_user_id (el solicitante), NUNCA el admin actor.
--     🔴 public.agencies NO tiene columna de motivo de rechazo (a diferencia
--     de agent_applications) — data NUNCA lleva 'rejection_reason' aquí,
--     ni siquiera en la rama rejected (no hay fuente de la que tomarlo).
--   agent_application_approved / agent_application_rejected → deep_link
--     '/profile' · related_entity_type 'agent_application' ·
--     data->>'application_type' ('independent'|'under_agency') ·
--     'rejection_reason' en la rama rejected (columna existe y es NOT NULL
--     al rechazar, D7 de 71.5). Destinatario: user_id (el solicitante).
--     El mirror se genera IGUAL para application_type='under_agency' pese a
--     que D8 (71.5) NO promueve su role — desde la perspectiva del
--     solicitante, su solicitud igual fue resuelta (sección 7.2).
--
-- ── Ramas que NO resuelven nada → SIN espejo (decisión, sección 3) ──────────
-- moderate_property_atomic action_type='suspend' es una acción de
-- MODERACIÓN pero no una resolución del ciclo revisión/publicación-inicial
-- que este catálogo de tipos cubre (el orquestador solo fijó los 3 tipos
-- property_revision_*, no un 'property_suspended') — fuera del alcance
-- explícito de #219.2 ("Ramas: approve / needs_changes / reject"). Se
-- ejercita como boundary NEGATIVO: la rama corre, pero NUNCA escribe un
-- property_revision_*. Mismo criterio para handle_agency_status_change:
-- 🔴 su definición VIGENTE (20260823000002, #210.1) agregó las transiciones
-- active→suspended / suspended→active (cascada de suspensión de
-- organización, 169.2) que 20260805000007 no tenía — tampoco resuelven el
-- catálogo agency_approved/agency_rejected, sección 6.5.
--
-- ── Re-moderación / duplicados (decisión, sección 4) ─────────────────────────
-- A diferencia de 219.1 (un job batch que puede re-evaluar el MISMO evento
-- fuente varias veces, de ahí su índice de idempotencia), aquí cada llamada
-- a la RPC/UPDATE es una decisión administrativa explícita — no hay un
-- cron que la reinvoque sola. PERO un reintento de RED de la MISMA llamada
-- (p.ej. la Edge Function reintenta tras un timeout de red del primer
-- intento que en realidad sí aplicó) SÍ puede volver a pedir la MISMA
-- transición sobre la MISMA entidad. Contrato fijado aquí (sin índice —
-- comparación en memoria del estado ANTERIOR vs el solicitado, mismo
-- principio que el `when (old.status is distinct from new.status)` que ya
-- gatea los triggers de agencies/agent_applications/ads_status_change): un
-- reintento EXACTO (mismo id, mismo status destino, la entidad YA está en
-- ese status) NO genera un segundo espejo. Una decisión GENUINAMENTE NUEVA
-- sobre una entidad DISTINTA (segunda revisión de la misma propiedad, o el
-- mismo anuncio vuelto a aprobar tras un ciclo real) si vuelve a transicionar
-- SÍ genera un espejo nuevo — nunca deduplicado entre eventos reales
-- distintos (sección 4.2, mismo principio que REV10/REV11 de 219.1).
--
-- ── 🔒 Semántica BLOQUEANTE (DECISIÓN ABRAHAM, igual que 219.1) — sección 8 ──
-- El INSERT hacia notifications vive en la MISMA transacción/statement del
-- evento, sin bloque EXCEPTION: si el escritor truena, TODO el evento se
-- aborta. Ejercitado UNA vez (camino RPC — moderate_property_atomic, el más
-- estructuralmente distinto del mecanismo de trigger ya probado por 219.1:
-- aquí no hay un WHEN clause externo, la función hace varios UPDATE/INSERT
-- propios en un solo cuerpo plpgsql) con fault-injection (trigger "veneno"
-- BEFORE INSERT en notifications, patrón EXACTO de 48_ads_state_machine_test.sql
-- sección 4 / 71_notify_admin_events_test.sql sección 7, dropeado
-- inmediatamente tras los asserts que lo necesitan). No se repite x4 — los 4
-- escritores comparten el mismo mecanismo (INSERT hacia la MISMA tabla en la
-- MISMA transacción); el trigger-path (agencies/agent_applications) ya quedó
-- validado en su generalidad por 219.1.
--
-- ── Estrategia RED sin migración-stub ────────────────────────────────────────
-- Las 4 funciones/triggers YA EXISTEN (no hay objeto inexistente que
-- referenciar). Llamarlas HOY simplemente no escribe nada en notifications
-- — las aserciones de conteo/contenido fallan LIMPIO contra 0 filas/NULL
-- (RED por assert, nunca por error de sintaxis/catálogo). Los throws_ok que
-- esperan una excepción (fault-injection, invalid-transition, invalid
-- next_status) ya excepcionan HOY por motivos preexistentes (esos guards
-- YA existen) — pgTAP los captura igual como "ok" en esos asserts puntuales;
-- lo que falla es el conteo posterior de notifications (0 tanto antes como
-- después del guard, así que esas líneas puntuales son INVARIANTE, ver
-- convención abajo).
--
-- ── Convención DELTA vs INVARIANTE ────────────────────────────────────────────
-- DELTA      = falla HOY por assert real (0 filas donde se esperan N, NULL
--              donde se espera un valor) y debe pasar tras el GREEN con el
--              resultado correcto — la inmensa mayoría de este archivo.
-- INVARIANTE = ya "pasa" hoy por una razón DISTINTA a la que debe sostenerlo
--              tras el GREEN: PROP30 (suspend nunca escribió nada — hoy
--              porque nada escribe nada; después porque la rama sigue
--              deliberadamente fuera del catálogo), AD2/AD3/AD4/AD_notfound
--              (nadie fuera del patrón recibe — hoy porque nadie recibe
--              nada), AGY10 (sin rejection_reason — hoy porque no hay dato
--              en absoluto), FAULT2/FAULT3 (atomicidad — hoy porque nada se
--              mueve de todas formas, dado que el guard ya excepciona por
--              el fault-injection). El guardian debe re-verificar tras
--              GREEN que sostienen por la razón correcta.
--
-- ── 🔴 Hardening post-guardian (sección 9, tras el GREEN 20260826000001) ────
-- El análisis de mutantes del guardian encontró 4 supervivientes reales: (e)
-- quitar `v_recipient is distinct from p_admin_id` en moderate_property_
-- atomic, (i)/(j) quitar el guard "nunca el admin actor" en los 2 triggers
-- de agencies/agent_applications, (d2) en la rama active↔suspended de
-- agencies, escribir un espejo con type FUERA del catálogo (p.ej.
-- 'agency_suspended'). Causa raíz: ningún fixture de las secciones 1-8 pone
-- al admin actor como destinatario NATURAL (submitted_by/owner_user_id/
-- created_by_user_id/user_id) — los asserts "el admin no recibe" eran
-- ciertos pero no discriminantes (nunca podían coincidir). El único
-- discriminante previo era AD14 (§5.7: el admin actor es ADEMÁS owner activo
-- de la agencia). Sección 9 repite ese patrón para los otros 3 escritores +
-- un escenario de type fuera de catálogo sin filtro (para d2).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(100);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures globales — 1 admin actor (reusado en TODAS las secciones, NUNCA
-- debe recibir ningún espejo), reusado como p_admin_id / GUC urbea.admin_actor_id.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0072-000000000001', 'admin_actor_72@urbea.mx'),
  ('00000000-0000-0000-0072-000000000002', 'owner_property_72@urbea.mx'),
  ('00000000-0000-0000-0072-000000000003', 'submitted_by_72@urbea.mx'),
  ('00000000-0000-0000-0072-000000000004', 'ad_agency_creator_72@urbea.mx'),
  ('00000000-0000-0000-0072-000000000005', 'ad_owner_active_72@urbea.mx'),
  ('00000000-0000-0000-0072-000000000006', 'ad_admin_active_72@urbea.mx'),
  ('00000000-0000-0000-0072-000000000007', 'ad_owner_suspended_72@urbea.mx'),
  ('00000000-0000-0000-0072-000000000008', 'ad_agent_active_72@urbea.mx'),
  ('00000000-0000-0000-0072-000000000009', 'agency5b_creator_72@urbea.mx'),
  ('00000000-0000-0000-0072-000000000010', 'agency5b_agent_member_72@urbea.mx'),
  ('00000000-0000-0000-0072-000000000011', 'agency_solicitante_72@urbea.mx'),
  ('00000000-0000-0000-0072-000000000012', 'app_applicant_independent_72@urbea.mx'),
  ('00000000-0000-0000-0072-000000000013', 'app_applicant_under_agency_72@urbea.mx');

update public.users set role = 'admin' where id = '00000000-0000-0000-0072-000000000001';
update public.users set role = 'agent' where id in (
  '00000000-0000-0000-0072-000000000003', '00000000-0000-0000-0072-000000000005',
  '00000000-0000-0000-0072-000000000006', '00000000-0000-0000-0072-000000000007',
  '00000000-0000-0000-0072-000000000008', '00000000-0000-0000-0072-000000000010'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 1) moderate_property_atomic — CON revisión activa → espejo al submitted_by,
--    NUNCA al owner de la propiedad, NUNCA al admin actor.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1.1) approve ─────────────────────────────────────────────────────────────
insert into public.properties
  (id, owner_user_id, operation_type, property_type, price, address, location, status)
values (
  '00000000-0000-0000-0072-000000000101', '00000000-0000-0000-0072-000000000002',
  'rent', 'departamento', 9000, 'Calle Espejo Con Revision Approve 72',
  extensions.ST_SetSRID(extensions.ST_Point(-99.1, 19.4), 4326)::extensions.geography,
  'pending_review'
);
insert into public.property_revisions (id, property_id, status, changed_fields, submitted_by)
values (
  '00000000-0000-0000-0072-000000000151', '00000000-0000-0000-0072-000000000101',
  'pending', '{}'::jsonb, '00000000-0000-0000-0072-000000000003'
);

select public.moderate_property_atomic(
  p_admin_id            => '00000000-0000-0000-0072-000000000001'::uuid,
  p_property_id         => '00000000-0000-0000-0072-000000000101'::uuid,
  p_action_type         => 'approve',
  p_old_values          => '{"status":"pending_review"}'::jsonb,
  p_new_values          => '{"status":"active"}'::jsonb,
  p_reason              => null,
  p_new_property_status => 'active',
  p_changed_fields      => null,
  p_revision_id         => '00000000-0000-0000-0072-000000000151'::uuid,
  p_revision_status     => 'approved',
  p_revision_reason     => null
);

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000101' and type = 'property_revision_approved'),
  array['00000000-0000-0000-0072-000000000003'::uuid],
  'PROP1_con_revision_approve_solo_el_submitted_by_recibe_el_espejo'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000001'
      and related_entity_id = '00000000-0000-0000-0072-000000000101'),
  0, 'PROP2_con_revision_el_admin_actor_NUNCA_recibe_su_propio_espejo'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000002'
      and related_entity_id = '00000000-0000-0000-0072-000000000101'),
  0, 'PROP3_con_revision_el_owner_de_la_propiedad_NO_recibe_el_espejo_ese_es_el_submitted_by'
);

create temp table result_prop11_72 (
  n_type text, n_deep_link text, n_rel_type text, n_rel_id uuid,
  n_address text, n_has_reason boolean, n_title text, n_body text
);
insert into result_prop11_72
  select type, deep_link, related_entity_type, related_entity_id,
    data->>'address', (data ? 'rejection_reason'), title, body
  from public.notifications
  where user_id = '00000000-0000-0000-0072-000000000003'
    and related_entity_id = '00000000-0000-0000-0072-000000000101'
    and type = 'property_revision_approved';

select is((select n_type from result_prop11_72), 'property_revision_approved', 'PROP4_type_property_revision_approved');
select is((select n_deep_link from result_prop11_72), '/my-listings', 'PROP5_deep_link_my_listings');
select is((select n_rel_type from result_prop11_72), 'property', 'PROP6_related_entity_type_property');
select is((select n_rel_id from result_prop11_72), '00000000-0000-0000-0072-000000000101'::uuid, 'PROP7_related_entity_id_property_id');
select is((select n_address from result_prop11_72), 'Calle Espejo Con Revision Approve 72', 'PROP8_data_address_es_la_direccion_real');
select is((select n_has_reason from result_prop11_72), false, 'PROP9_approve_NUNCA_lleva_rejection_reason');
select ok((select n_title from result_prop11_72) is not null, 'PROP10_title_no_nulo');
select ok((select n_body from result_prop11_72) ilike '%Calle Espejo Con Revision Approve 72%', 'PROP11_body_menciona_la_direccion');

-- ── 1.2) needs_changes ───────────────────────────────────────────────────────
insert into public.properties
  (id, owner_user_id, operation_type, property_type, price, address, location, status)
values (
  '00000000-0000-0000-0072-000000000102', '00000000-0000-0000-0072-000000000002',
  'rent', 'departamento', 9000, 'Calle Espejo Con Revision NeedsChanges 72',
  extensions.ST_SetSRID(extensions.ST_Point(-99.1, 19.4), 4326)::extensions.geography,
  'pending_review'
);
insert into public.property_revisions (id, property_id, status, changed_fields, submitted_by)
values (
  '00000000-0000-0000-0072-000000000152', '00000000-0000-0000-0072-000000000102',
  'pending', '{}'::jsonb, '00000000-0000-0000-0072-000000000003'
);

select public.moderate_property_atomic(
  p_admin_id            => '00000000-0000-0000-0072-000000000001'::uuid,
  p_property_id         => '00000000-0000-0000-0072-000000000102'::uuid,
  p_action_type         => 'needs_changes',
  p_old_values          => '{"revision_status":"pending"}'::jsonb,
  p_new_values          => '{"revision_status":"needs_changes"}'::jsonb,
  p_reason              => null,
  p_new_property_status => null,
  p_changed_fields      => null,
  p_revision_id         => '00000000-0000-0000-0072-000000000152'::uuid,
  p_revision_status     => 'needs_changes',
  p_revision_reason     => 'Falta ampliar fotos del baño'
);

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000102' and type = 'property_revision_needs_changes'),
  array['00000000-0000-0000-0072-000000000003'::uuid],
  'PROP12_con_revision_needs_changes_solo_el_submitted_by_recibe'
);
select is(
  (select type from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000003'
      and related_entity_id = '00000000-0000-0000-0072-000000000102'),
  'property_revision_needs_changes', 'PROP13_type_property_revision_needs_changes'
);
select is(
  (select data->>'rejection_reason' from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000003'
      and related_entity_id = '00000000-0000-0000-0072-000000000102'),
  'Falta ampliar fotos del baño',
  'PROP14_data_rejection_reason_es_p_revision_reason_con_revision'
);

-- ── 1.3) reject ──────────────────────────────────────────────────────────────
insert into public.properties
  (id, owner_user_id, operation_type, property_type, price, address, location, status)
values (
  '00000000-0000-0000-0072-000000000103', '00000000-0000-0000-0072-000000000002',
  'rent', 'departamento', 9000, 'Calle Espejo Con Revision Reject 72',
  extensions.ST_SetSRID(extensions.ST_Point(-99.1, 19.4), 4326)::extensions.geography,
  'pending_review'
);
insert into public.property_revisions (id, property_id, status, changed_fields, submitted_by)
values (
  '00000000-0000-0000-0072-000000000153', '00000000-0000-0000-0072-000000000103',
  'pending', '{}'::jsonb, '00000000-0000-0000-0072-000000000003'
);

select public.moderate_property_atomic(
  p_admin_id            => '00000000-0000-0000-0072-000000000001'::uuid,
  p_property_id         => '00000000-0000-0000-0072-000000000103'::uuid,
  p_action_type         => 'reject',
  p_old_values          => '{"revision_status":"pending"}'::jsonb,
  p_new_values          => '{"revision_status":"rejected"}'::jsonb,
  p_reason              => null,
  p_new_property_status => null,
  p_changed_fields      => null,
  p_revision_id         => '00000000-0000-0000-0072-000000000153'::uuid,
  p_revision_status     => 'rejected',
  p_revision_reason     => 'Dirección no verificable'
);

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000103' and type = 'property_revision_rejected'),
  array['00000000-0000-0000-0072-000000000003'::uuid],
  'PROP15_con_revision_reject_solo_el_submitted_by_recibe'
);
select is(
  (select type from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000003'
      and related_entity_id = '00000000-0000-0000-0072-000000000103'),
  'property_revision_rejected', 'PROP16_type_property_revision_rejected'
);
select is(
  (select data->>'rejection_reason' from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000003'
      and related_entity_id = '00000000-0000-0000-0072-000000000103'),
  'Dirección no verificable', 'PROP17_data_rejection_reason_con_revision_reject'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) moderate_property_atomic — SIN revisión activa (publicación inicial,
--    p_revision_id null) → espejo al OWNER de la propiedad.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 2.1) approve ─────────────────────────────────────────────────────────────
insert into public.properties
  (id, owner_user_id, operation_type, property_type, price, address, location, status)
values (
  '00000000-0000-0000-0072-000000000104', '00000000-0000-0000-0072-000000000002',
  'sale', 'casa', 2000000, 'Calle Espejo Sin Revision Approve 72',
  extensions.ST_SetSRID(extensions.ST_Point(-99.1, 19.4), 4326)::extensions.geography,
  'pending_review'
);

select public.moderate_property_atomic(
  p_admin_id            => '00000000-0000-0000-0072-000000000001'::uuid,
  p_property_id         => '00000000-0000-0000-0072-000000000104'::uuid,
  p_action_type         => 'approve',
  p_old_values          => '{"status":"pending_review"}'::jsonb,
  p_new_values          => '{"status":"active"}'::jsonb,
  p_reason              => null,
  p_new_property_status => 'active',
  p_changed_fields      => null,
  p_revision_id         => null,
  p_revision_status     => null,
  p_revision_reason     => null
);

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000104' and type = 'property_revision_approved'),
  array['00000000-0000-0000-0072-000000000002'::uuid],
  'PROP18_sin_revision_approve_solo_el_OWNER_recibe_el_espejo'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000001'
      and related_entity_id = '00000000-0000-0000-0072-000000000104'),
  0, 'PROP19_sin_revision_el_admin_actor_NUNCA_recibe'
);

create temp table result_prop21_72 (n_type text, n_deep_link text, n_address text, n_has_reason boolean);
insert into result_prop21_72
  select type, deep_link, data->>'address', (data ? 'rejection_reason')
  from public.notifications
  where user_id = '00000000-0000-0000-0072-000000000002'
    and related_entity_id = '00000000-0000-0000-0072-000000000104'
    and type = 'property_revision_approved';

select is((select n_type from result_prop21_72), 'property_revision_approved', 'PROP20_type_property_revision_approved');
select is((select n_deep_link from result_prop21_72), '/my-listings', 'PROP21_deep_link_my_listings_sin_revision');
select is((select n_address from result_prop21_72), 'Calle Espejo Sin Revision Approve 72', 'PROP22_data_address_sin_revision');
select is((select n_has_reason from result_prop21_72), false, 'PROP23_approve_sin_revision_NUNCA_lleva_rejection_reason');

-- ── 2.2) needs_changes ───────────────────────────────────────────────────────
insert into public.properties
  (id, owner_user_id, operation_type, property_type, price, address, location, status)
values (
  '00000000-0000-0000-0072-000000000105', '00000000-0000-0000-0072-000000000002',
  'sale', 'casa', 2000000, 'Calle Espejo Sin Revision NeedsChanges 72',
  extensions.ST_SetSRID(extensions.ST_Point(-99.1, 19.4), 4326)::extensions.geography,
  'pending_review'
);

select public.moderate_property_atomic(
  p_admin_id            => '00000000-0000-0000-0072-000000000001'::uuid,
  p_property_id         => '00000000-0000-0000-0072-000000000105'::uuid,
  p_action_type         => 'needs_changes',
  p_old_values          => '{"status":"pending_review"}'::jsonb,
  p_new_values          => '{"status":"needs_changes"}'::jsonb,
  p_reason              => 'Faltan videos',
  p_new_property_status => 'needs_changes',
  p_changed_fields      => null,
  p_revision_id         => null,
  p_revision_status     => null,
  p_revision_reason     => null
);

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000105' and type = 'property_revision_needs_changes'),
  array['00000000-0000-0000-0072-000000000002'::uuid],
  'PROP24_sin_revision_needs_changes_solo_el_owner_recibe'
);
select is(
  (select type from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000002'
      and related_entity_id = '00000000-0000-0000-0072-000000000105'),
  'property_revision_needs_changes', 'PROP25_type_property_revision_needs_changes_sin_revision'
);
select is(
  (select data->>'rejection_reason' from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000002'
      and related_entity_id = '00000000-0000-0000-0072-000000000105'),
  'Faltan videos',
  'PROP26_data_rejection_reason_es_p_reason_sin_revision_no_p_revision_reason'
);

-- ── 2.3) reject ──────────────────────────────────────────────────────────────
insert into public.properties
  (id, owner_user_id, operation_type, property_type, price, address, location, status)
values (
  '00000000-0000-0000-0072-000000000106', '00000000-0000-0000-0072-000000000002',
  'sale', 'casa', 2000000, 'Calle Espejo Sin Revision Reject 72',
  extensions.ST_SetSRID(extensions.ST_Point(-99.1, 19.4), 4326)::extensions.geography,
  'pending_review'
);

select public.moderate_property_atomic(
  p_admin_id            => '00000000-0000-0000-0072-000000000001'::uuid,
  p_property_id         => '00000000-0000-0000-0072-000000000106'::uuid,
  p_action_type         => 'reject',
  p_old_values          => '{"status":"pending_review"}'::jsonb,
  p_new_values          => '{"status":"rejected"}'::jsonb,
  p_reason              => 'Contenido prohibido',
  p_new_property_status => 'rejected',
  p_changed_fields      => null,
  p_revision_id         => null,
  p_revision_status     => null,
  p_revision_reason     => null
);

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000106' and type = 'property_revision_rejected'),
  array['00000000-0000-0000-0072-000000000002'::uuid],
  'PROP27_sin_revision_reject_solo_el_owner_recibe'
);
select is(
  (select type from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000002'
      and related_entity_id = '00000000-0000-0000-0072-000000000106'),
  'property_revision_rejected', 'PROP28_type_property_revision_rejected_sin_revision'
);
select is(
  (select data->>'rejection_reason' from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000002'
      and related_entity_id = '00000000-0000-0000-0072-000000000106'),
  'Contenido prohibido', 'PROP29_data_rejection_reason_es_p_reason_reject_sin_revision'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) suspend NO resuelve nada del catálogo property_revision_* → SIN espejo.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.properties
  (id, owner_user_id, operation_type, property_type, price, address, location, status)
values (
  '00000000-0000-0000-0072-000000000107', '00000000-0000-0000-0072-000000000002',
  'sale', 'casa', 2000000, 'Calle Espejo Suspend 72',
  extensions.ST_SetSRID(extensions.ST_Point(-99.1, 19.4), 4326)::extensions.geography,
  'active'
);

select public.moderate_property_atomic(
  p_admin_id            => '00000000-0000-0000-0072-000000000001'::uuid,
  p_property_id         => '00000000-0000-0000-0072-000000000107'::uuid,
  p_action_type         => 'suspend',
  p_old_values          => '{"status":"active"}'::jsonb,
  p_new_values          => '{"status":"suspended"}'::jsonb,
  p_reason              => 'Reporte de usuarios',
  p_new_property_status => 'suspended',
  p_changed_fields      => null,
  p_revision_id         => null,
  p_revision_status     => null,
  p_revision_reason     => null
);

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000107' and type like 'property_revision_%'),
  0, 'PROP30_suspend_NUNCA_escribe_un_espejo_property_revision_fuera_de_alcance_219_2'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Re-moderación / duplicados.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 4.1) retry EXACTO (mismo revision_id, mismo status destino) NO duplica ──
insert into public.properties
  (id, owner_user_id, operation_type, property_type, price, address, location, status)
values (
  '00000000-0000-0000-0072-000000000108', '00000000-0000-0000-0072-000000000002',
  'rent', 'departamento', 9000, 'Calle Espejo Retry Exacto 72',
  extensions.ST_SetSRID(extensions.ST_Point(-99.1, 19.4), 4326)::extensions.geography,
  'pending_review'
);
insert into public.property_revisions (id, property_id, status, changed_fields, submitted_by)
values (
  '00000000-0000-0000-0072-000000000154', '00000000-0000-0000-0072-000000000108',
  'pending', '{}'::jsonb, '00000000-0000-0000-0072-000000000003'
);

select public.moderate_property_atomic(
  p_admin_id => '00000000-0000-0000-0072-000000000001'::uuid,
  p_property_id => '00000000-0000-0000-0072-000000000108'::uuid,
  p_action_type => 'approve',
  p_old_values => '{}'::jsonb, p_new_values => '{}'::jsonb,
  p_reason => null, p_new_property_status => 'active', p_changed_fields => null,
  p_revision_id => '00000000-0000-0000-0072-000000000154'::uuid,
  p_revision_status => 'approved', p_revision_reason => null
);

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000108' and type = 'property_revision_approved'),
  1, 'PROP31_primer_approve_genera_exactamente_1_espejo'
);

select lives_ok(
  $$ select public.moderate_property_atomic(
       p_admin_id => '00000000-0000-0000-0072-000000000001'::uuid,
       p_property_id => '00000000-0000-0000-0072-000000000108'::uuid,
       p_action_type => 'approve',
       p_old_values => '{}'::jsonb, p_new_values => '{}'::jsonb,
       p_reason => null, p_new_property_status => 'active', p_changed_fields => null,
       p_revision_id => '00000000-0000-0000-0072-000000000154'::uuid,
       p_revision_status => 'approved', p_revision_reason => null
     ) $$,
  'PROP32_reintento_exacto_mismo_revision_id_mismo_status_no_lanza'
);

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000108' and type = 'property_revision_approved'),
  1, 'PROP33_reintento_exacto_NO_duplica_el_espejo_sigue_en_1'
);

-- ── 4.2) DOS resoluciones REALES sucesivas sobre la MISMA revisión (needs_
--    changes, el usuario reenvía — UPDATE directo needs_changes→pending, el
--    mismo patrón de re-envío que 219.1 REV10/REV11, fuera del alcance de
--    moderate_property_atomic — y luego approve) → CADA resolución genera SU
--    PROPIO espejo, nunca deduplicado entre eventos reales distintos, pese a
--    compartir el MISMO revision_id. 🔴 property_revisions_one_active_per_
--    property (índice único parcial sobre status in ('pending','needs_
--    changes')) es la razón real por la que un property NUNCA tiene 2 filas
--    de revisión "vivas" a la vez — el re-envío SIEMPRE reutiliza la MISMA
--    fila, nunca crea una segunda.
insert into public.properties
  (id, owner_user_id, operation_type, property_type, price, address, location, status)
values (
  '00000000-0000-0000-0072-000000000109', '00000000-0000-0000-0072-000000000002',
  'rent', 'departamento', 9000, 'Calle Espejo Multiples Revisiones 72',
  extensions.ST_SetSRID(extensions.ST_Point(-99.1, 19.4), 4326)::extensions.geography,
  'pending_review'
);
insert into public.property_revisions (id, property_id, status, changed_fields, submitted_by)
values (
  '00000000-0000-0000-0072-000000000155', '00000000-0000-0000-0072-000000000109',
  'pending', '{}'::jsonb, '00000000-0000-0000-0072-000000000003'
);

select public.moderate_property_atomic(
  p_admin_id => '00000000-0000-0000-0072-000000000001'::uuid,
  p_property_id => '00000000-0000-0000-0072-000000000109'::uuid,
  p_action_type => 'needs_changes',
  p_old_values => '{}'::jsonb, p_new_values => '{}'::jsonb,
  p_reason => null, p_new_property_status => null, p_changed_fields => null,
  p_revision_id => '00000000-0000-0000-0072-000000000155'::uuid,
  p_revision_status => 'needs_changes', p_revision_reason => 'primera vuelta'
);

-- Re-envío (fuera de este SUT: lo hace edit-property/otra RPC) — reutiliza
-- LA MISMA fila de revisión, needs_changes -> pending.
update public.property_revisions set status = 'pending'
 where id = '00000000-0000-0000-0072-000000000155';

select public.moderate_property_atomic(
  p_admin_id => '00000000-0000-0000-0072-000000000001'::uuid,
  p_property_id => '00000000-0000-0000-0072-000000000109'::uuid,
  p_action_type => 'approve',
  p_old_values => '{}'::jsonb, p_new_values => '{}'::jsonb,
  p_reason => null, p_new_property_status => 'active', p_changed_fields => null,
  p_revision_id => '00000000-0000-0000-0072-000000000155'::uuid,
  p_revision_status => 'approved', p_revision_reason => null
);

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000109' and type = 'property_revision_needs_changes'),
  1, 'PROP34_primera_resolucion_needs_changes_genero_su_espejo'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000109' and type = 'property_revision_approved'),
  1, 'PROP35_segunda_resolucion_tras_reenvio_approve_genero_SU_PROPIO_espejo'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000109' and type like 'property_revision_%'),
  2, 'PROP36_misma_revision_id_dos_resoluciones_reales_dos_espejos_nunca_deduplicados_entre_si'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) moderate_ad_atomic — espejo a los miembros ACTIVOS owner/admin de la
--    organización dueña del ad (patrón notify_ads_expiring_soon).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.agencies (id, name, slug, status, created_by_user_id,
                             can_publish_properties, can_advertise, advertiser_category)
values
  ('00000000-0000-0000-0072-000000000201', 'Agencia Espejo Ads 72', 'agencia-espejo-ads-72', 'active',
   '00000000-0000-0000-0072-000000000004', false, true, 'seguros'),
  ('00000000-0000-0000-0072-000000000202', 'Agencia Espejo Ads Sin Owner Admin 72', 'agencia-espejo-ads-sin-72', 'active',
   '00000000-0000-0000-0072-000000000009', false, true, 'seguros');

insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0072-000000000201', '00000000-0000-0000-0072-000000000005', 'owner', 'active'),
  ('00000000-0000-0000-0072-000000000201', '00000000-0000-0000-0072-000000000006', 'admin', 'active'),
  ('00000000-0000-0000-0072-000000000201', '00000000-0000-0000-0072-000000000007', 'owner', 'suspended'),
  ('00000000-0000-0000-0072-000000000201', '00000000-0000-0000-0072-000000000008', 'agent', 'active'),
  ('00000000-0000-0000-0072-000000000202', '00000000-0000-0000-0072-000000000010', 'agent', 'active');

insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0072-000000000211', '00000000-0000-0000-0072-000000000201', 'ready'),
  ('00000000-0000-0000-0072-000000000212', '00000000-0000-0000-0072-000000000202', 'ready');

-- ── 5.1) approve ─────────────────────────────────────────────────────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0072-000000000221', '00000000-0000-0000-0072-000000000201',
   '00000000-0000-0000-0072-000000000211', 'Ad Espejo Approve 72', 'phone', '+5213300007201',
   'pending_review', now() - interval '1 day', now() + interval '30 days');

select public.moderate_ad_atomic(
  '00000000-0000-0000-0072-000000000221'::uuid, 'active', null,
  '00000000-0000-0000-0072-000000000001'::uuid
);

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000221' and type = 'ad_approved'),
  array[
    '00000000-0000-0000-0072-000000000005'::uuid,
    '00000000-0000-0000-0072-000000000006'::uuid
  ],
  'AD1_los_2_miembros_activos_owner_admin_y_solo_ellos_reciben_el_espejo'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000007'
      and related_entity_id = '00000000-0000-0000-0072-000000000221'),
  0, 'AD2_owner_SUSPENDIDO_no_recibe'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000008'
      and related_entity_id = '00000000-0000-0000-0072-000000000221'),
  0, 'AD3_member_role_agent_no_recibe'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000001'
      and related_entity_id = '00000000-0000-0000-0072-000000000221'),
  0, 'AD4_admin_actor_NUNCA_recibe'
);

create temp table result_ad51_72 (n_type text, n_deep_link text, n_rel_type text, n_rel_id uuid, n_ad_title text, n_has_reason boolean);
insert into result_ad51_72
  select type, deep_link, related_entity_type, related_entity_id, data->>'ad_title', (data ? 'rejection_reason')
  from public.notifications
  where user_id = '00000000-0000-0000-0072-000000000005'
    and related_entity_id = '00000000-0000-0000-0072-000000000221'
    and type = 'ad_approved';

select is((select n_type from result_ad51_72), 'ad_approved', 'AD5_type_ad_approved');
select is((select n_deep_link from result_ad51_72), '/ads', 'AD6_deep_link_ads_panel_del_anunciante');
select is((select n_rel_type from result_ad51_72), 'ad', 'AD7_related_entity_type_ad');
select is((select n_rel_id from result_ad51_72), '00000000-0000-0000-0072-000000000221'::uuid, 'AD8_related_entity_id_ad_id');
select is((select n_ad_title from result_ad51_72), 'Ad Espejo Approve 72', 'AD9_data_ad_title_real');
select is((select n_has_reason from result_ad51_72), false, 'AD10_approve_NUNCA_lleva_rejection_reason');

-- ── 5.2) reject ──────────────────────────────────────────────────────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0072-000000000222', '00000000-0000-0000-0072-000000000201',
   '00000000-0000-0000-0072-000000000211', 'Ad Espejo Reject 72', 'phone', '+5213300007202',
   'pending_review', now() - interval '1 day', now() + interval '30 days');

select public.moderate_ad_atomic(
  '00000000-0000-0000-0072-000000000222'::uuid, 'rejected', 'Contenido engañoso',
  '00000000-0000-0000-0072-000000000001'::uuid
);

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000222' and type = 'ad_rejected'),
  array[
    '00000000-0000-0000-0072-000000000005'::uuid,
    '00000000-0000-0000-0072-000000000006'::uuid
  ],
  'AD11_los_2_miembros_activos_reciben_el_espejo_de_rechazo'
);
select is(
  (select type from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000005'
      and related_entity_id = '00000000-0000-0000-0072-000000000222'),
  'ad_rejected', 'AD12_type_ad_rejected'
);
select is(
  (select data->>'rejection_reason' from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000005'
      and related_entity_id = '00000000-0000-0000-0072-000000000222'),
  'Contenido engañoso', 'AD13_data_rejection_reason_reject'
);

-- ── 5.3) 0 miembros owner/admin activos → 0 espejos, sin error ──────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0072-000000000223', '00000000-0000-0000-0072-000000000202',
   '00000000-0000-0000-0072-000000000212', 'Ad Espejo Sin Owner Admin 72', 'phone', '+5213300007203',
   'pending_review', now() - interval '1 day', now() + interval '30 days');

select lives_ok(
  $$ select public.moderate_ad_atomic(
       '00000000-0000-0000-0072-000000000223'::uuid, 'active', null,
       '00000000-0000-0000-0072-000000000001'::uuid) $$,
  'AD_0MIEMBROS1_sin_owner_admin_activos_la_RPC_no_lanza'
);
select is(
  (select count(*)::int from public.notifications where related_entity_id = '00000000-0000-0000-0072-000000000223'),
  0, 'AD_0MIEMBROS2_0_espejos_generados_sin_error'
);

-- ── 5.4) ad inexistente → 0 filas afectadas, 0 espejos ──────────────────────
create temp table result_ad_notfound_72 (v_rows integer);
insert into result_ad_notfound_72
  select public.moderate_ad_atomic(
    '00000000-0000-0000-0072-000000000999'::uuid, 'active', null,
    '00000000-0000-0000-0072-000000000001'::uuid
  );

select is((select v_rows from result_ad_notfound_72), 0, 'AD_NOTFOUND1_ad_inexistente_0_filas_afectadas');
select is(
  (select count(*)::int from public.notifications where related_entity_id = '00000000-0000-0000-0072-000000000999'),
  0, 'AD_NOTFOUND2_ad_inexistente_0_espejos'
);

-- ── 5.5) retry EXACTO (mismo p_next_status dos veces) NO duplica ───────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0072-000000000225', '00000000-0000-0000-0072-000000000201',
   '00000000-0000-0000-0072-000000000211', 'Ad Espejo Retry 72', 'phone', '+5213300007205',
   'pending_review', now() - interval '1 day', now() + interval '30 days');

select public.moderate_ad_atomic(
  '00000000-0000-0000-0072-000000000225'::uuid, 'active', null,
  '00000000-0000-0000-0072-000000000001'::uuid
);

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000225' and type = 'ad_approved'),
  2, 'AD_RETRY1_primer_approve_2_espejos_owner_y_admin'
);

select lives_ok(
  $$ select public.moderate_ad_atomic(
       '00000000-0000-0000-0072-000000000225'::uuid, 'active', null,
       '00000000-0000-0000-0072-000000000001'::uuid) $$,
  'AD_RETRY2_reintento_mismo_next_status_no_lanza'
);

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000225' and type = 'ad_approved'),
  2, 'AD_RETRY3_reintento_NO_duplica_sigue_en_2'
);

-- ── 5.6) p_next_status inválido ('expired') → guard existente excepciona
--    ANTES de llegar al espejo → 0 espejos. 🔴 HALLAZGO al correr el RED
--    (gotcha #168): la definición VIGENTE de moderate_ad_atomic NO es
--    20260822000002 sino 20260823000002 (tarea #210.1, "ad_takedown") — ese
--    create-or-replace AMPLIÓ el guard a admitir también 'paused' (retirar
--    un anuncio activo). 'paused' NO es inválido hoy — se ejercita como
--    rama legítima en 5.8. 'expired' sigue fuera del guard (solo
--    active/rejected/paused) y es el valor que de verdad prueba el guard.
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0072-000000000226', '00000000-0000-0000-0072-000000000201',
   '00000000-0000-0000-0072-000000000211', 'Ad Espejo Invalid Status 72', 'phone', '+5213300007206',
   'pending_review', now() - interval '1 day', now() + interval '30 days');

select throws_ok(
  $$ select public.moderate_ad_atomic(
       '00000000-0000-0000-0072-000000000226'::uuid, 'expired', null,
       '00000000-0000-0000-0072-000000000001'::uuid) $$,
  'P0001', 'INVALID_NEXT_STATUS',
  'AD_INVALID1_next_status_expired_sigue_rechazado_por_el_guard_existente'
);
select is(
  (select count(*)::int from public.notifications where related_entity_id = '00000000-0000-0000-0072-000000000226'),
  0, 'AD_INVALID2_next_status_invalido_0_espejos'
);

-- ── 5.7) el admin actor ADEMÁS es owner ACTIVO de la agencia → sigue
--    excluido: "nunca el admin actor" gana sobre la membresía ─────────────
insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0072-000000000201', '00000000-0000-0000-0072-000000000001', 'owner', 'active');

insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0072-000000000227', '00000000-0000-0000-0072-000000000201',
   '00000000-0000-0000-0072-000000000211', 'Ad Espejo Admin Es Member 72', 'phone', '+5213300007207',
   'pending_review', now() - interval '1 day', now() + interval '30 days');

select public.moderate_ad_atomic(
  '00000000-0000-0000-0072-000000000227'::uuid, 'active', null,
  '00000000-0000-0000-0072-000000000001'::uuid
);

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000227' and type = 'ad_approved'),
  array[
    '00000000-0000-0000-0072-000000000005'::uuid,
    '00000000-0000-0000-0072-000000000006'::uuid
  ],
  'AD14_admin_actor_excluido_pese_a_ser_owner_activo_de_la_misma_agencia'
);

-- ── 5.8) 'paused' (retiro de un anuncio activo, #210.1) → rama LEGÍTIMA,
--    SÍ ameritaba espejo (a diferencia de lo que la cabecera original
--    asumía) — mismo destinatario/mecanismo que approve/reject. ────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0072-000000000228', '00000000-0000-0000-0072-000000000201',
   '00000000-0000-0000-0072-000000000211', 'Ad Espejo Pause 72', 'phone', '+5213300007208',
   'active', now() - interval '1 day', now() + interval '30 days');

select public.moderate_ad_atomic(
  '00000000-0000-0000-0072-000000000228'::uuid, 'paused', null,
  '00000000-0000-0000-0072-000000000001'::uuid
);

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000228' and type = 'ad_paused'),
  array[
    '00000000-0000-0000-0072-000000000005'::uuid,
    '00000000-0000-0000-0072-000000000006'::uuid
  ],
  'AD15_pause_los_2_miembros_activos_owner_admin_reciben_el_espejo'
);

create temp table result_ad58_72 (n_type text, n_deep_link text, n_ad_title text, n_has_reason boolean);
insert into result_ad58_72
  select type, deep_link, data->>'ad_title', (data ? 'rejection_reason')
  from public.notifications
  where user_id = '00000000-0000-0000-0072-000000000005'
    and related_entity_id = '00000000-0000-0000-0072-000000000228'
    and type = 'ad_paused';

select is((select n_type from result_ad58_72), 'ad_paused', 'AD16_type_ad_paused');
select is((select n_deep_link from result_ad58_72), '/ads', 'AD17_deep_link_ads_pause');
select is((select n_ad_title from result_ad58_72), 'Ad Espejo Pause 72', 'AD18_data_ad_title_pause');
select is((select n_has_reason from result_ad58_72), false, 'AD19_pause_NUNCA_lleva_rejection_reason');

-- ════════════════════════════════════════════════════════════════════════════
-- 6) handle_agency_status_change — espejo al SOLICITANTE (created_by_user_id).
-- ════════════════════════════════════════════════════════════════════════════

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0072-000000000001', true);

-- ── 6.1) pending_approval → active ──────────────────────────────────────────
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0072-000000000301', 'Agencia Espejo Approve 72', 'agencia-espejo-approve-72',
   default, '00000000-0000-0000-0072-000000000011');

update public.agencies set status = 'active' where id = '00000000-0000-0000-0072-000000000301';

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000301' and type = 'agency_approved'),
  array['00000000-0000-0000-0072-000000000011'::uuid],
  'AGY1_pending_approval_a_active_solo_el_solicitante_recibe'
);
-- Solo types de espejo: el admin SÍ recibe la legítima admin_agency_pending (219.1,
-- mismo related_entity_id — agencies no tiene entidad "revisión" intermedia).
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000001'
      and related_entity_id = '00000000-0000-0000-0072-000000000301'
      and type in ('agency_approved', 'agency_rejected')),
  0, 'AGY2_admin_actor_NUNCA_recibe_agency_approved'
);

create temp table result_agy61_72 (n_type text, n_deep_link text, n_rel_type text, n_name text, n_has_reason boolean);
insert into result_agy61_72
  select type, deep_link, related_entity_type, data->>'agency_name', (data ? 'rejection_reason')
  from public.notifications
  where user_id = '00000000-0000-0000-0072-000000000011'
    and related_entity_id = '00000000-0000-0000-0072-000000000301'
    and type = 'agency_approved';

select is((select n_type from result_agy61_72), 'agency_approved', 'AGY3_type_agency_approved');
select is((select n_deep_link from result_agy61_72), '/profile', 'AGY4_deep_link_profile');
select is((select n_rel_type from result_agy61_72), 'agency', 'AGY5_related_entity_type_agency');
select is((select n_name from result_agy61_72), 'Agencia Espejo Approve 72', 'AGY6_data_agency_name_real');
select is((select n_has_reason from result_agy61_72), false, 'AGY7_approve_NUNCA_lleva_rejection_reason');

-- ── 6.2) pending_approval → rejected ────────────────────────────────────────
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0072-000000000302', 'Agencia Espejo Reject 72', 'agencia-espejo-reject-72',
   default, '00000000-0000-0000-0072-000000000011');

update public.agencies set status = 'rejected' where id = '00000000-0000-0000-0072-000000000302';

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000302' and type = 'agency_rejected'),
  array['00000000-0000-0000-0072-000000000011'::uuid],
  'AGY8_pending_approval_a_rejected_solo_el_solicitante_recibe'
);
select is(
  (select type from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000011'
      and related_entity_id = '00000000-0000-0000-0072-000000000302'),
  'agency_rejected', 'AGY9_type_agency_rejected'
);
select is(
  (select data ? 'rejection_reason' from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000011'
      and related_entity_id = '00000000-0000-0000-0072-000000000302'
      and type = 'agency_rejected'),
  false,
  'AGY10_agencies_NO_tiene_columna_de_motivo_data_NUNCA_lleva_rejection_reason'
);

-- ── 6.3) UPDATE que reescribe el MISMO status → no-op, el trigger ni
--    siquiera se dispara (WHEN clause), 0 crecimiento ──────────────────────
update public.agencies set status = 'active' where id = '00000000-0000-0000-0072-000000000301';

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000301' and type = 'agency_approved'),
  1, 'AGY11_reescribir_el_mismo_status_no_genera_un_segundo_espejo'
);

-- ── 6.4) transición inválida (rejected -> active, origen no es
--    pending_approval) → el guard existente excepciona antes de llegar
--    al espejo → 0 espejos nuevos ───────────────────────────────────────────
select throws_ok(
  $$ update public.agencies set status = 'active' where id = '00000000-0000-0000-0072-000000000302' $$,
  'P0001', 'INVALID_STATUS_TRANSITION',
  'AGY12_transicion_invalida_rejected_a_active_sigue_rechazada_por_el_guard'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000302' and type = 'agency_approved'),
  0, 'AGY13_transicion_invalida_0_espejos_agency_approved'
);

-- ── 6.5) 🔴 HALLAZGO al correr el RED (gotcha #168): la definición VIGENTE
--    de handle_agency_status_change NO es 20260805000007 sino 20260823000002
--    (#210.1) — ese create-or-replace AGREGÓ las transiciones
--    active→suspended / suspended→active (cascada de suspensión de
--    organización, 169.2). Ninguna de las dos resuelve el catálogo
--    agency_approved/agency_rejected (no son una aprobación/rechazo de
--    solicitud) — fuera de alcance de #219.2, mismo criterio que el
--    'suspend' de propiedades (sección 3): la rama corre, pero NUNCA
--    escribe un espejo de ESTE catálogo.
update public.agencies set status = 'suspended' where id = '00000000-0000-0000-0072-000000000301';

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000301'
      and type in ('agency_approved', 'agency_rejected')),
  1, 'AGY14_active_a_suspended_NO_genera_un_segundo_espejo_sigue_en_1_el_de_la_aprobacion_original'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) handle_agent_application_status_change — espejo al SOLICITANTE (user_id).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 7.1) approve, application_type='independent' ────────────────────────────
insert into public.agent_applications (id, user_id, application_type, status) values
  ('00000000-0000-0000-0072-000000000401', '00000000-0000-0000-0072-000000000012', 'independent', 'pending');

update public.agent_applications set status = 'approved' where id = '00000000-0000-0000-0072-000000000401';

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000401' and type = 'agent_application_approved'),
  array['00000000-0000-0000-0072-000000000012'::uuid],
  'APP1_pending_a_approved_independent_solo_el_solicitante_recibe'
);
-- Solo types de espejo: el admin SÍ recibe la legítima admin_agent_application (219.1,
-- mismo related_entity_id — agent_applications no tiene entidad "revisión" intermedia).
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000001'
      and related_entity_id = '00000000-0000-0000-0072-000000000401'
      and type in ('agent_application_approved', 'agent_application_rejected')),
  0, 'APP2_admin_actor_NUNCA_recibe_agent_application_approved'
);

create temp table result_app71_72 (n_type text, n_deep_link text, n_rel_type text, n_apptype text, n_has_reason boolean);
insert into result_app71_72
  select type, deep_link, related_entity_type, data->>'application_type', (data ? 'rejection_reason')
  from public.notifications
  where user_id = '00000000-0000-0000-0072-000000000012'
    and related_entity_id = '00000000-0000-0000-0072-000000000401'
    and type = 'agent_application_approved';

select is((select n_type from result_app71_72), 'agent_application_approved', 'APP3_type_agent_application_approved');
select is((select n_deep_link from result_app71_72), '/profile', 'APP4_deep_link_profile');
select is((select n_rel_type from result_app71_72), 'agent_application', 'APP5_related_entity_type_agent_application');
select is((select n_apptype from result_app71_72), 'independent', 'APP6_data_application_type_independent');
select is((select n_has_reason from result_app71_72), false, 'APP7_approve_NUNCA_lleva_rejection_reason');

-- ── 7.2) approve, application_type='under_agency' — SÍ recibe espejo pese
--    a que D8 (71.5) NO promueve su role en esta rama ───────────────────────
insert into public.agent_applications (id, user_id, application_type, agency_id, status) values
  ('00000000-0000-0000-0072-000000000402', '00000000-0000-0000-0072-000000000013', 'under_agency',
   '00000000-0000-0000-0072-000000000201', 'pending');

update public.agent_applications set status = 'approved' where id = '00000000-0000-0000-0072-000000000402';

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000402' and type = 'agent_application_approved'),
  array['00000000-0000-0000-0072-000000000013'::uuid],
  'APP8_under_agency_approved_tambien_espeja_al_solicitante'
);
select is(
  (select type from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000013'
      and related_entity_id = '00000000-0000-0000-0072-000000000402'),
  'agent_application_approved', 'APP9_type_agent_application_approved_under_agency'
);
select is(
  (select data->>'application_type' from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000013'
      and related_entity_id = '00000000-0000-0000-0072-000000000402'),
  'under_agency', 'APP10_data_application_type_under_agency'
);

-- ── 7.3) reject ──────────────────────────────────────────────────────────────
insert into public.agent_applications (id, user_id, application_type, status) values
  ('00000000-0000-0000-0072-000000000403', '00000000-0000-0000-0072-000000000012', 'independent', 'pending');

update public.agent_applications
   set status = 'rejected', rejection_reason = 'Documentación incompleta'
 where id = '00000000-0000-0000-0072-000000000403';

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000403' and type = 'agent_application_rejected'),
  array['00000000-0000-0000-0072-000000000012'::uuid],
  'APP11_pending_a_rejected_solo_el_solicitante_recibe'
);
select is(
  (select type from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000012'
      and related_entity_id = '00000000-0000-0000-0072-000000000403'),
  'agent_application_rejected', 'APP12_type_agent_application_rejected'
);
select is(
  (select data->>'rejection_reason' from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000012'
      and related_entity_id = '00000000-0000-0000-0072-000000000403'),
  'Documentación incompleta', 'APP13_data_rejection_reason_reject'
);

-- ── 7.4) UPDATE que reescribe el MISMO status → no-op, 0 crecimiento ───────
update public.agent_applications set status = 'approved' where id = '00000000-0000-0000-0072-000000000401';

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000401' and type = 'agent_application_approved'),
  1, 'APP14_reescribir_el_mismo_status_no_genera_un_segundo_espejo'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8) 🔒 BLOQUEANTE — fault-injection (camino RPC: moderate_property_atomic).
--    Si el INSERT hacia notifications falla, TODO el evento revierte (sin
--    try/catch). Trigger "veneno" DROPEADO inmediatamente tras los asserts
--    que lo necesitan (patrón 48_ads_state_machine_test.sql sección 4 /
--    71_notify_admin_events_test.sql sección 7).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function pg_temp.poison_notifications_insert_72()
returns trigger language plpgsql as $poison$
begin
  raise exception 'poison: fault injection forzada (pgTAP 72_notify_moderation_mirrors_test) para probar rollback total del evento'
    using errcode = '23505';
end
$poison$;
create trigger poison_notifications_before_insert_72
  before insert on public.notifications
  for each row execute function pg_temp.poison_notifications_insert_72();

insert into public.properties
  (id, owner_user_id, operation_type, property_type, price, address, location, status)
values (
  '00000000-0000-0000-0072-000000000110', '00000000-0000-0000-0072-000000000002',
  'sale', 'casa', 2000000, 'Calle Espejo Fault Injection 72',
  extensions.ST_SetSRID(extensions.ST_Point(-99.1, 19.4), 4326)::extensions.geography,
  'pending_review'
);

select throws_ok(
  $$ select public.moderate_property_atomic(
       p_admin_id => '00000000-0000-0000-0072-000000000001'::uuid,
       p_property_id => '00000000-0000-0000-0072-000000000110'::uuid,
       p_action_type => 'approve',
       p_old_values => '{}'::jsonb, p_new_values => '{}'::jsonb,
       p_reason => null, p_new_property_status => 'active', p_changed_fields => null,
       p_revision_id => null, p_revision_status => null, p_revision_reason => null
     ) $$,
  '23505', null,
  'FAULT1_el_INSERT_de_notifications_falla_y_TODO_el_evento_lanza_excepcion'
);

drop trigger if exists poison_notifications_before_insert_72 on public.notifications;

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0072-000000000110'),
  'pending_review', 'FAULT2_atomicidad_la_propiedad_NO_quedo_activada_pese_al_fallo_posterior_del_espejo'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'property' and entity_id = '00000000-0000-0000-0072-000000000110'),
  0, 'FAULT3_atomicidad_no_quedo_fila_huerfana_en_admin_actions_tampoco_se_escribio'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 9) 🔴 Hardening post-guardian — el admin actor como destinatario NATURAL
--    (mutantes (e)/(i)/(j)/(d2) sobrevivientes). Ver header del archivo.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 9.1) mata (e) — moderate_property_atomic: el admin actor ES el
--    submitted_by de la revisión que él mismo resuelve → sin el guard
--    `v_recipient is distinct from p_admin_id` el INSERT SÍ ocurriría con
--    v_recipient = p_admin_id → 0 filas totales para esta propiedad (el
--    ÚNICO destinatario posible en la rama CON revisión es el admin actor) ──
insert into public.properties
  (id, owner_user_id, operation_type, property_type, price, address, location, status)
values (
  '00000000-0000-0000-0072-000000000111', '00000000-0000-0000-0072-000000000002',
  'rent', 'departamento', 9000, 'Calle Espejo Admin Es Submitted By 72',
  extensions.ST_SetSRID(extensions.ST_Point(-99.1, 19.4), 4326)::extensions.geography,
  'pending_review'
);
insert into public.property_revisions (id, property_id, status, changed_fields, submitted_by)
values (
  '00000000-0000-0000-0072-000000000156', '00000000-0000-0000-0072-000000000111',
  'pending', '{}'::jsonb, '00000000-0000-0000-0072-000000000001'
);

select public.moderate_property_atomic(
  p_admin_id            => '00000000-0000-0000-0072-000000000001'::uuid,
  p_property_id         => '00000000-0000-0000-0072-000000000111'::uuid,
  p_action_type         => 'approve',
  p_old_values          => '{}'::jsonb,
  p_new_values          => '{}'::jsonb,
  p_reason              => null,
  p_new_property_status => 'active',
  p_changed_fields      => null,
  p_revision_id         => '00000000-0000-0000-0072-000000000156'::uuid,
  p_revision_status     => 'approved',
  p_revision_reason     => null
);

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0072-000000000111'),
  0,
  'HARD_PROP1_mata_e_admin_actor_es_el_submitted_by_que_el_mismo_resuelve_0_espejos_totales'
);

-- ── 9.2) mata (i) — handle_agency_status_change: el admin actor ES el
--    created_by_user_id de la agencia que él mismo aprueba → 0 espejos
--    agency_approved/agency_rejected. SÍ recibe la legítima admin_agency_
--    pending de 219.1 (todo admin la recibe al nacer la agencia) — se filtra
--    por type, mismo criterio que AGY2. GUC urbea.admin_actor_id ya está en
--    el admin actor desde la sección 6 (persiste toda la transacción). La
--    membresía owner activa que AD14 (§5.7) le dio en la agencia 201 se
--    limpia primero — la cascada de aprobación (MEMBER_OF_OTHER_AGENCY)
--    exige que el creador NO tenga ya una membresía activa en otra agencia,
--    y esa membresía era solo un fixture del §5.7, ajeno a esta sección ────
delete from public.agency_members
 where agency_id = '00000000-0000-0000-0072-000000000201'
   and user_id = '00000000-0000-0000-0072-000000000001';

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0072-000000000303', 'Agencia Espejo Admin Es Solicitante 72',
   'agencia-espejo-admin-es-solicitante-72', default, '00000000-0000-0000-0072-000000000001');

update public.agencies set status = 'active' where id = '00000000-0000-0000-0072-000000000303';

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000001'
      and related_entity_id = '00000000-0000-0000-0072-000000000303'
      and type in ('agency_approved', 'agency_rejected')),
  0,
  'HARD_AGY1_mata_i_admin_actor_es_el_solicitante_que_el_mismo_aprueba_0_espejos'
);

-- ── 9.3) mata (j) — handle_agent_application_status_change: el admin actor
--    ES el user_id de la solicitud que él mismo aprueba → 0 espejos agent_
--    application_approved/rejected (filtrado igual que APP2, la legítima
--    admin_agent_application de 219.1 SÍ existe). 🔴 HALLAZGO: el FIX 2
--    (20260805000010) usa `role = case when role = 'admin' then role else
--    'agent' end` — protege al admin de perder su role incluso cuando
--    aprueba SU PROPIA solicitud independent (verificado abajo) ────────────
insert into public.agent_applications (id, user_id, application_type, status) values
  ('00000000-0000-0000-0072-000000000404', '00000000-0000-0000-0072-000000000001', 'independent', 'pending');

update public.agent_applications set status = 'approved'
 where id = '00000000-0000-0000-0072-000000000404';

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000001'
      and related_entity_id = '00000000-0000-0000-0072-000000000404'
      and type in ('agent_application_approved', 'agent_application_rejected')),
  0,
  'HARD_APP1_mata_j_admin_actor_es_el_solicitante_que_el_mismo_aprueba_0_espejos'
);
select is(
  (select role::text from public.users where id = '00000000-0000-0000-0072-000000000001'),
  'admin',
  'HARD_APP2_role_del_admin_actor_se_mantiene_admin_pese_a_aprobar_su_propia_solicitud_independent'
);

-- ── 9.4) mata (d2) — handle_agency_status_change, rama active↔suspended:
--    reabre la ventana ya ejercitada por AGY14 (agencia 301, solicitante
--    0011) y la cierra con la reactivación suspended→active, luego cuenta
--    TODAS las notificaciones del solicitante sobre esa agencia SIN filtro
--    de type — AGY13/AGY14 solo filtraban por el catálogo agency_approved/
--    agency_rejected, así que un espejo espurio con un type FUERA del
--    catálogo (p.ej. 'agency_suspended') no los movía; aquí sí, porque no
--    hay filtro de type que lo esconda ─────────────────────────────────────
update public.agencies set status = 'active' where id = '00000000-0000-0000-0072-000000000301';

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0072-000000000011'
      and related_entity_id = '00000000-0000-0000-0072-000000000301'),
  1,
  'HARD_AGY2_mata_d2_ventana_active_suspended_active_ningun_espejo_espurio_sin_filtro_de_type_sigue_en_1'
);

select * from finish();
rollback;
