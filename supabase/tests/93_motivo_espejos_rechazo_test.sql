-- Tests pgTAP — el motivo del rechazo VIAJA en el `body` de los tres espejos
-- que quedaron fuera de #234 (tarea #237, derivada de la 234).
-- Ejecutar con: supabase test db supabase/tests/93_motivo_espejos_rechazo_test.sql --local
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL HUECO QUE CIERRA — reproducido EN PRODUCCIÓN el 2026-09-02
-- #234 hizo que el motivo llegara al solicitante de una INMOBILIARIA, y dejó
-- anotado que los otros tres espejos seguían mudos. Lo confirmamos en vivo: un
-- admin rechazó una promoción escribiendo «Prueba», el motivo quedó guardado en
-- `ads.rejection_reason` y en `data.rejection_reason`… y la notificación que
-- recibió el anunciante decía solo «Tu anuncio "…" fue rechazado.». La persona
-- ve la puerta cerrada sin saber qué corregir, que es exactamente el bug que
-- #234 cerró para el otro espejo.
--
-- 🔴 POR QUÉ EL MOTIVO VA EN `body` Y NO SOLO EN `data`: el centro de
-- notificaciones (mobile/src/features/notifications/components/
-- NotificationCard.tsx) renderiza EXCLUSIVAMENTE `title` y `body`. `data` no se
-- lee en ninguna superficie viva, así que un motivo que solo vive ahí es un
-- motivo que nadie leerá. Se escribe en AMBOS: `body` para que se lea HOY sin
-- OTA, y `data.rejection_reason` para conservar la forma del catálogo #219.
--
-- SEAM bajo prueba: el comportamiento OBSERVABLE de rechazar — la fila de
-- public.notifications que ve la persona. NO se prueba el cuerpo de las
-- funciones ni se reimplementa su lógica: cada caso pasa por la PUERTA de
-- producción (la RPC real, o el UPDATE que dispara el trigger real).
--
-- SUT: supabase/migrations/20260905100001_motivo_en_espejos_de_rechazo.sql
--   (create-or-replace de public.moderate_ad_atomic, public.moderate_property_
--    atomic y public.handle_agent_application_status_change).
--
-- ── DECISIONES DE CONTRATO que este archivo FIJA ────────────────────────────
-- D-BODY     Con motivo, el body de hoy MÁS ' Motivo: <texto>' pegado al final
--            (un espacio antes de «Motivo», dos puntos, un espacio). Idéntico
--            al de #234, para que las cuatro notificaciones de rechazo del
--            producto se lean igual.
-- D-SIN      Sin motivo, el body queda BYTE POR BYTE como hoy. Es lo que
--            protege a las filas históricas y a cualquier camino que no lo
--            capture.
-- D-BLANCO   Un motivo de puro espacio en blanco se trata como SIN motivo:
--            `~ '\S'`, NUNCA trim() — trim() solo recorta el espacio ASCII y
--            deja pasar tabuladores y saltos de línea (hallazgo 220.1). Sin
--            este guard el body terminaría en un «Motivo: » vacío, que es peor
--            que no decir nada. Aplica también a `data.rejection_reason`: si el
--            motivo no sirve para el body, tampoco se guarda como dato.
-- D-CAMBIOS  'needs_changes' de una revisión de propiedad TAMBIÉN lleva el
--            motivo. «Tu propiedad necesita cambios» sin decir cuáles es la
--            versión más inútil de este bug, no la más leve.
-- D-APROBAR  Aprobar nunca lleva motivo, aunque el llamador mande uno.
--
-- Corre como superusuario en una transacción revertida; el camino admin del
-- trigger de solicitudes impersona con pg_temp.act_as (patrón 83_*).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(22);

-- Fixtures — prefijo '00000000-0000-0000-0000-000000093XXX'.
--   ADMIN(093001)   admin de plataforma (resuelve todo).
--   OWNER(093002)   owner de la agencia: recibe los espejos de anuncio.
--   AGENTE(093003)  publica y envía revisiones: recibe los espejos de propiedad.
--   SOL_A/B/C(093004/5/6) solicitantes de agente.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000093001', 'admin_93@test.local'),
  ('00000000-0000-0000-0000-000000093002', 'owner_93@test.local'),
  ('00000000-0000-0000-0000-000000093003', 'agente_93@test.local'),
  ('00000000-0000-0000-0000-000000093004', 'sol_a_93@test.local'),
  ('00000000-0000-0000-0000-000000093005', 'sol_b_93@test.local'),
  ('00000000-0000-0000-0000-000000093006', 'sol_c_93@test.local');

update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000093001';
update public.users set role = 'agent' where id in (
  '00000000-0000-0000-0000-000000093002', '00000000-0000-0000-0000-000000093003');

insert into public.agencies (id, name, slug, status, created_by_user_id, can_publish_properties)
values ('00000000-0000-0000-0000-000000093201', 'Agencia 93', 'agencia-93', 'active',
        '00000000-0000-0000-0000-000000093002', true);

insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000093201', '00000000-0000-0000-0000-000000093002', 'owner', 'active'),
  ('00000000-0000-0000-0000-000000093201', '00000000-0000-0000-0000-000000093003', 'agent', 'active');

-- Ocho propiedades: tres sostienen anuncios (una promo por propiedad, por el
-- índice de una sola promo abierta) y cinco sostienen revisiones.
insert into public.properties
  (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, status)
select
  ('00000000-0000-0000-0000-00000009310' || i)::uuid,
  '00000000-0000-0000-0000-000000093003',
  '00000000-0000-0000-0000-000000093201',
  'departamento', 'rent',
  'Calle 93 número ' || i,
  extensions.ST_SetSRID(extensions.ST_Point(-103.35, 20.67), 4326)::extensions.geography,
  10000 + i, 'active'
from generate_series(1, 8) as i;

-- Tres anuncios de tipo PROMOCIÓN (creative_id null, sin CTA), en revisión.
insert into public.ads
  (id, agency_id, property_id, creative_id, title, status, starts_at, ends_at, created_by_user_id)
values
  ('00000000-0000-0000-0000-000000093301', '00000000-0000-0000-0000-000000093201',
   '00000000-0000-0000-0000-000000093101', null, 'Depa 93 A', 'pending_review',
   now(), now() + interval '30 days', '00000000-0000-0000-0000-000000093003'),
  ('00000000-0000-0000-0000-000000093302', '00000000-0000-0000-0000-000000093201',
   '00000000-0000-0000-0000-000000093102', null, 'Depa 93 B', 'pending_review',
   now(), now() + interval '30 days', '00000000-0000-0000-0000-000000093003'),
  ('00000000-0000-0000-0000-000000093303', '00000000-0000-0000-0000-000000093201',
   '00000000-0000-0000-0000-000000093103', null, 'Depa 93 C', 'pending_review',
   now(), now() + interval '30 days', '00000000-0000-0000-0000-000000093003');

-- Cinco revisiones pendientes, una por caso.
insert into public.property_revisions (id, property_id, status, changed_fields, submitted_by) values
  ('00000000-0000-0000-0000-000000093401', '00000000-0000-0000-0000-000000093104', 'pending',
   '{"price": 11111}'::jsonb, '00000000-0000-0000-0000-000000093003'),
  ('00000000-0000-0000-0000-000000093402', '00000000-0000-0000-0000-000000093105', 'pending',
   '{"price": 22222}'::jsonb, '00000000-0000-0000-0000-000000093003'),
  ('00000000-0000-0000-0000-000000093403', '00000000-0000-0000-0000-000000093106', 'pending',
   '{"price": 33333}'::jsonb, '00000000-0000-0000-0000-000000093003'),
  ('00000000-0000-0000-0000-000000093404', '00000000-0000-0000-0000-000000093107', 'pending',
   '{"price": 44444}'::jsonb, '00000000-0000-0000-0000-000000093003'),
  ('00000000-0000-0000-0000-000000093405', '00000000-0000-0000-0000-000000093108', 'pending',
   '{"price": 55555}'::jsonb, '00000000-0000-0000-0000-000000093003');

insert into public.agent_applications (id, user_id, application_type, agency_id, status) values
  ('00000000-0000-0000-0000-000000093501', '00000000-0000-0000-0000-000000093004', 'independent', null, 'pending'),
  ('00000000-0000-0000-0000-000000093502', '00000000-0000-0000-0000-000000093005', 'independent', null, 'pending'),
  ('00000000-0000-0000-0000-000000093503', '00000000-0000-0000-0000-000000093006', 'independent', null, 'pending');

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- Lee el body del espejo de un anuncio/propiedad/solicitud sin repetir el join.
create or replace function pg_temp.mirror_body(p_type text, p_entity uuid)
returns text language sql stable as $$
  select n.body from public.notifications n
   where n.type::text = p_type and n.related_entity_id = p_entity
   order by n.created_at desc limit 1;
$$;

create or replace function pg_temp.mirror_reason(p_type text, p_entity uuid)
returns text language sql stable as $$
  select n.data->>'rejection_reason' from public.notifications n
   where n.type::text = p_type and n.related_entity_id = p_entity
   order by n.created_at desc limit 1;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) [ANCLA] Las firmas no se mueven. Un create-or-replace que cambiara la
--    lista de argumentos crearía una función NUEVA y dejaría la vieja viva:
--    el cliente seguiría llamando a la de antes y el fix sería invisible.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select pg_get_function_identity_arguments('public.moderate_ad_atomic'::regproc)),
  'p_ad_id uuid, p_next_status text, p_rejection_reason text, p_admin_id uuid',
  'SIG1_moderate_ad_atomic_conserva_su_firma'
);

select is(
  (select pg_get_function_identity_arguments('public.moderate_property_atomic'::regproc)),
  'p_admin_id uuid, p_property_id uuid, p_action_type text, p_old_values jsonb, p_new_values jsonb, p_reason text, p_new_property_status text, p_changed_fields jsonb, p_revision_id uuid, p_revision_status text, p_revision_reason text',
  'SIG2_moderate_property_atomic_conserva_su_firma'
);

select ok(
  exists (
    select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     where t.tgrelid = 'public.agent_applications'::regclass
       and p.proname = 'handle_agent_application_status_change'
  ),
  'SIG3_el_trigger_de_solicitudes_sigue_colgado_de_la_tabla'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 1) ANUNCIO — public.moderate_ad_atomic
-- ════════════════════════════════════════════════════════════════════════════

select public.moderate_ad_atomic(
  '00000000-0000-0000-0000-000000093301', 'rejected', 'Foto borrosa',
  '00000000-0000-0000-0000-000000093001');

select is(
  pg_temp.mirror_body('ad_rejected', '00000000-0000-0000-0000-000000093301'),
  'Tu anuncio "Depa 93 A" fue rechazado. Motivo: Foto borrosa',
  'AD1_el_motivo_llega_en_el_body_del_espejo_de_anuncio'
);

select is(
  pg_temp.mirror_reason('ad_rejected', '00000000-0000-0000-0000-000000093301'),
  'Foto borrosa',
  'AD2_y_tambien_en_data_rejection_reason'
);

-- Motivo de puro espacio en blanco: tabulador + salto de línea + espacio. El
-- CHECK ads_rejection_reason_matches_status solo exige NOT NULL, así que esta
-- fila es alcanzable; trim() la dejaría pasar y produciría «Motivo: » vacío.
select public.moderate_ad_atomic(
  '00000000-0000-0000-0000-000000093302', 'rejected', E'\t\n ',
  '00000000-0000-0000-0000-000000093001');

select is(
  pg_temp.mirror_body('ad_rejected', '00000000-0000-0000-0000-000000093302'),
  'Tu anuncio "Depa 93 B" fue rechazado.',
  'AD3_motivo_en_blanco_deja_el_body_byte_por_byte_como_hoy'
);

select is(
  pg_temp.mirror_reason('ad_rejected', '00000000-0000-0000-0000-000000093302'),
  null,
  'AD4_motivo_en_blanco_tampoco_se_guarda_como_dato'
);

select public.moderate_ad_atomic(
  '00000000-0000-0000-0000-000000093303', 'active', null,
  '00000000-0000-0000-0000-000000093001');

select is(
  pg_temp.mirror_body('ad_approved', '00000000-0000-0000-0000-000000093303'),
  'Tu anuncio "Depa 93 C" fue aprobado y ya está activo.',
  'AD5_aprobar_no_toca_el_body'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) REVISIÓN DE PROPIEDAD — public.moderate_property_atomic
-- ════════════════════════════════════════════════════════════════════════════

select public.moderate_property_atomic(
  '00000000-0000-0000-0000-000000093001', '00000000-0000-0000-0000-000000093104',
  'reject', '{}'::jsonb, '{}'::jsonb, null, null, null,
  '00000000-0000-0000-0000-000000093401', 'rejected', 'Fotos con marca de agua');

select is(
  pg_temp.mirror_body('property_revision_rejected', '00000000-0000-0000-0000-000000093104'),
  'Tu propiedad en "Calle 93 número 4" fue rechazada. Motivo: Fotos con marca de agua',
  'PR1_el_motivo_llega_en_el_body_del_espejo_de_propiedad'
);

select is(
  pg_temp.mirror_reason('property_revision_rejected', '00000000-0000-0000-0000-000000093104'),
  'Fotos con marca de agua',
  'PR2_y_tambien_en_data_rejection_reason'
);

-- D-CAMBIOS: «necesita cambios» sin decir cuáles es la versión más inútil del bug.
select public.moderate_property_atomic(
  '00000000-0000-0000-0000-000000093001', '00000000-0000-0000-0000-000000093105',
  'needs_changes', '{}'::jsonb, '{}'::jsonb, null, null, null,
  '00000000-0000-0000-0000-000000093402', 'needs_changes', 'Falta el número interior');

select is(
  pg_temp.mirror_body('property_revision_needs_changes', '00000000-0000-0000-0000-000000093105'),
  'Tu propiedad en "Calle 93 número 5" necesita cambios antes de poder publicarse. Motivo: Falta el número interior',
  'PR3_needs_changes_tambien_dice_que_hay_que_cambiar'
);

select public.moderate_property_atomic(
  '00000000-0000-0000-0000-000000093001', '00000000-0000-0000-0000-000000093106',
  'reject', '{}'::jsonb, '{}'::jsonb, null, null, null,
  '00000000-0000-0000-0000-000000093403', 'rejected', E' \t ');

select is(
  pg_temp.mirror_body('property_revision_rejected', '00000000-0000-0000-0000-000000093106'),
  'Tu propiedad en "Calle 93 número 6" fue rechazada.',
  'PR4_motivo_en_blanco_deja_el_body_byte_por_byte_como_hoy'
);

select is(
  pg_temp.mirror_reason('property_revision_rejected', '00000000-0000-0000-0000-000000093106'),
  null,
  'PR4b_motivo_en_blanco_tampoco_se_guarda_como_dato'
);

-- D-CRUDO: el guard normaliza lo que se COMUNICA, nunca lo que se PERSISTE. La
-- columna guarda lo que el admin escribió: es registro de lo ocurrido, no un
-- mensaje, y normalizarlo ahí sería reescribir la evidencia.
select is(
  (select rejection_reason from public.property_revisions
    where id = '00000000-0000-0000-0000-000000093403'),
  E' \t ',
  'PR7_la_revision_guarda_el_motivo_crudo_sin_normalizar'
);

select public.moderate_property_atomic(
  '00000000-0000-0000-0000-000000093001', '00000000-0000-0000-0000-000000093107',
  'approve', '{}'::jsonb, '{}'::jsonb, null, null, null,
  '00000000-0000-0000-0000-000000093404', 'approved', null);

select is(
  pg_temp.mirror_body('property_revision_approved', '00000000-0000-0000-0000-000000093107'),
  'Tu propiedad en "Calle 93 número 7" fue aprobada y ya está activa.',
  'PR5_aprobar_no_toca_el_body'
);

-- D-APROBAR dice «aunque el llamador mande uno», y aquí SÍ es alcanzable: a
-- diferencia de ads (donde ads_rejection_reason_matches_status lo hace
-- imposible), property_revisions no tiene CHECK que ate motivo y estado.
select public.moderate_property_atomic(
  '00000000-0000-0000-0000-000000093001', '00000000-0000-0000-0000-000000093108',
  'approve', '{}'::jsonb, '{}'::jsonb, null, null, null,
  '00000000-0000-0000-0000-000000093405', 'approved', 'motivo colado en una aprobación');

select is(
  pg_temp.mirror_body('property_revision_approved', '00000000-0000-0000-0000-000000093108'),
  'Tu propiedad en "Calle 93 número 8" fue aprobada y ya está activa.',
  'PR6_aprobar_con_motivo_en_la_mano_sigue_sin_llevarlo'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) SOLICITUD DE AGENTE — trigger public.handle_agent_application_status_change
--    Aquí la puerta es el UPDATE con JWT de admin, no una RPC.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000093001'); -- ADMIN
update public.agent_applications
   set status = 'rejected', rejection_reason = 'Documento ilegible'
 where id = '00000000-0000-0000-0000-000000093501';
reset role;

select is(
  pg_temp.mirror_body('agent_application_rejected', '00000000-0000-0000-0000-000000093501'),
  'Tu solicitud de agente fue rechazada. Motivo: Documento ilegible',
  'AA1_el_motivo_llega_en_el_body_del_espejo_de_solicitud'
);

select is(
  pg_temp.mirror_reason('agent_application_rejected', '00000000-0000-0000-0000-000000093501'),
  'Documento ilegible',
  'AA2_y_tambien_en_data_rejection_reason'
);

-- El trigger exige rejection_reason NOT NULL al rechazar, pero no que tenga
-- contenido: el blanco es alcanzable y no debe producir «Motivo: » vacío.
select pg_temp.act_as('00000000-0000-0000-0000-000000093001'); -- ADMIN
update public.agent_applications
   set status = 'rejected', rejection_reason = E'\n\t'
 where id = '00000000-0000-0000-0000-000000093502';
reset role;

select is(
  pg_temp.mirror_body('agent_application_rejected', '00000000-0000-0000-0000-000000093502'),
  'Tu solicitud de agente fue rechazada.',
  'AA3_motivo_en_blanco_deja_el_body_byte_por_byte_como_hoy'
);

select is(
  pg_temp.mirror_reason('agent_application_rejected', '00000000-0000-0000-0000-000000093502'),
  null,
  'AA3b_motivo_en_blanco_tampoco_se_guarda_como_dato'
);

select is(
  (select reason from public.admin_actions
    where entity_id = '00000000-0000-0000-0000-000000093502'
      and action_type = 'reject_agent_application'),
  E'\n\t',
  'AA5_la_auditoria_guarda_el_motivo_crudo_sin_normalizar'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000093001'); -- ADMIN
update public.agent_applications
   set status = 'approved'
 where id = '00000000-0000-0000-0000-000000093503';
reset role;

select is(
  pg_temp.mirror_body('agent_application_approved', '00000000-0000-0000-0000-000000093503'),
  'Tu solicitud de agente fue aprobada.',
  'AA4_aprobar_no_toca_el_body'
);

select * from finish();
rollback;
