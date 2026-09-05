-- Tests pgTAP — RED de la tarea #258 (derivada de #222, paso 11 del smoke).
-- Ejecutar con: supabase test db supabase/tests/98_solicitud_agente_con_solicitante_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de
-- una transacción revertida (no persiste).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: el comportamiento OBSERVABLE de un INSERT real sobre
-- public.agent_applications con status='pending' — la fila que deja en
-- public.notifications para cada admin (public.notify_admin_agent_application,
-- última versión en 20260827000002_fix_admin_notify_recipients.sql:155).
-- NUNCA internals: no se valida el nombre de ninguna función por catálogo,
-- solo el título/body/data OBSERVABLES de la fila.
--
-- SUT (YA EXISTE, delta parcial — NO es RED de "trigger inexistente"): la
-- función ya dispara admin_agent_application a los admins vivos, pero el
-- body hoy es literal 'Nueva solicitud de agente de tipo "' ||
-- new.application_type::text || '".' (expone el enum EN INGLÉS entre
-- comillas) y `data = jsonb_build_object('application_type',
-- new.application_type::text)` (sin quién ni por qué). El GREEN (otro
-- agente) debe: (a) traducir el enum a etiqueta en español SIN comillas ni
-- literal inglés visible (independent -> "independiente", under_agency ->
-- "bajo inmobiliaria"), (b) incluir el nombre PÚBLICO del solicitante
-- (public.agent_public_profiles.full_name, join por new.user_id — NUNCA el
-- email), (c) agregar data->>'rejection_reason' = new.reason (el motivo que
-- el solicitante escribió — clave que NotificationCard ya pinta como bloque
-- "Motivo", #240), (d) conservar data->>'application_type' y el ON CONFLICT
-- DO NOTHING de idempotencia tal cual.
--
-- ── Convención DELTA vs INVARIANTE ──────────────────────────────────────────
-- DELTA (falla HOY, debe pasar tras el GREEN — verificado corriendo la suite,
--   ver bitácora): INDEP1, INDEP2, INDEP3, INDEP5, UNDERAG1 — 5 asserts. Hoy
--   el body es literal en inglés entre comillas, sin nombre del solicitante,
--   y data no trae `rejection_reason`.
-- INVARIANTE (ya pasa HOY, debe seguir pasando tras el GREEN): ANCHOR1 (fan-
--   out a los 2 admins, comportamiento AJENO a este delta -- 219.1/223.2a),
--   INDEP4 (el body de HOY simplemente no menciona el email -- trivialmente
--   cierto sin ninguna clave nueva; tras el GREEN debe seguir sin aparecer,
--   ahora por diseño -- mismo patrón que OTHER2 de 97_*), INDEP6/UNDERAG2
--   (data->>'application_type' se conserva -- YA existe hoy, el GREEN es
--   aditivo sobre esa clave), DUP1 (el índice único
--   notifications_admin_agent_application_anchor_idx de 20260825000001 ya
--   respalda el ON CONFLICT -- AJENO a este delta, no lo toca el GREEN).
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ───────────────
-- INDEP   — application_type='independent': body dice "independiente" y
--   NUNCA el literal entre comillas `"independent"` (ojo: "independiente"
--   contiene "independent" como prefijo -- el assert de negación es sobre la
--   forma ENTRE COMILLAS del enum crudo, no sobre la subcadena cruda); body
--   incluye el nombre público del solicitante y NO su email;
--   data->>'rejection_reason' = new.reason; data->>'application_type' se
--   conserva.
-- UNDERAG — application_type='under_agency': body dice "bajo inmobiliaria";
--   data->>'application_type' se conserva.
-- DUP     — un 2o INSERT manual directo a notifications con la MISMA llave
--   (user_id, related_entity_id, type='admin_agent_application') es
--   rechazado por el índice único que respalda el ON CONFLICT DO NOTHING del
--   escritor (invariante de esquema, mismo patrón que ADV11 de
--   95_notify_admin_advertising_request_test.sql).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(10);

-- Fixtures — prefijo '00000000-0000-0000-0000-000000098XXX'.
--   ADMIN1(098011), ADMIN2(098012) admins de plataforma.
--   INDEP(098021)    solicitante independiente, con `reason` propio.
--   UNDERAG(098022)  solicitante bajo inmobiliaria.
--   AGCREATOR(098023) creador de la agencia de UNDERAG.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000098011', 'admin1_98@test.local'),
  ('00000000-0000-0000-0000-000000098012', 'admin2_98@test.local'),
  ('00000000-0000-0000-0000-000000098021', 'indep_98@test.local'),
  ('00000000-0000-0000-0000-000000098022', 'underag_98@test.local'),
  ('00000000-0000-0000-0000-000000098023', 'agcreator_98@test.local');

update public.users set role = 'admin'
 where id in ('00000000-0000-0000-0000-000000098011', '00000000-0000-0000-0000-000000098012');

-- Nombre público de los solicitantes (agent_public_profiles lee de aquí, NO
-- de auth.users.email ni de users.first_name/last_name directamente).
insert into public.user_preferences (user_id, full_name) values
  ('00000000-0000-0000-0000-000000098021', 'Renata Solís Aplicante 98'),
  ('00000000-0000-0000-0000-000000098022', 'Gustavo Bajo Agencia 98');

insert into public.agencies (id, name, slug, status, created_by_user_id)
values ('00000000-0000-0000-0000-000000098201', 'Agencia Solicitud 98', 'agencia-solicitud-98', 'active',
        '00000000-0000-0000-0000-000000098023');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) INDEP — 00000000-...-098101: application_type='independent', con motivo.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.agent_applications (id, user_id, application_type, agency_id, reason) values
  ('00000000-0000-0000-0000-000000098101', '00000000-0000-0000-0000-000000098021', 'independent', null,
   'Prueba interna: quiero publicar mis propiedades');

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000098101'
      and type = 'admin_agent_application'),
  2, 'ANCHOR1_los_2_admins_reciben_el_aviso_comportamiento_ya_existente'
);

select ok(
  (select body from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000098101'
      and type = 'admin_agent_application'
      and user_id = '00000000-0000-0000-0000-000000098011') ilike '%independiente%',
  'INDEP1_el_body_dice_independiente_en_espanol'
);

select ok(
  (select body from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000098101'
      and type = 'admin_agent_application'
      and user_id = '00000000-0000-0000-0000-000000098011') not ilike '%"independent"%',
  'INDEP2_el_body_nunca_expone_el_literal_del_enum_en_ingles_entre_comillas'
);

select ok(
  (select body from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000098101'
      and type = 'admin_agent_application'
      and user_id = '00000000-0000-0000-0000-000000098011') ilike '%Renata Solís Aplicante 98%',
  'INDEP3_el_body_incluye_el_nombre_publico_del_solicitante'
);

select ok(
  (select body from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000098101'
      and type = 'admin_agent_application'
      and user_id = '00000000-0000-0000-0000-000000098011') not ilike '%indep_98@test.local%',
  'INDEP4_el_body_nunca_expone_el_email_del_solicitante'
);

select is(
  (select data ->> 'rejection_reason' from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000098101'
      and type = 'admin_agent_application'
      and user_id = '00000000-0000-0000-0000-000000098011'),
  'Prueba interna: quiero publicar mis propiedades',
  'INDEP5_data_rejection_reason_es_el_motivo_del_solicitante'
);

select is(
  (select data ->> 'application_type' from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000098101'
      and type = 'admin_agent_application'
      and user_id = '00000000-0000-0000-0000-000000098011'),
  'independent', 'INDEP6_data_application_type_se_conserva'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) UNDERAG — 00000000-...-098102: application_type='under_agency'.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.agent_applications (id, user_id, application_type, agency_id) values
  ('00000000-0000-0000-0000-000000098102', '00000000-0000-0000-0000-000000098022', 'under_agency',
   '00000000-0000-0000-0000-000000098201');

select ok(
  (select body from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000098102'
      and type = 'admin_agent_application'
      and user_id = '00000000-0000-0000-0000-000000098011') ilike '%bajo inmobiliaria%',
  'UNDERAG1_el_body_dice_bajo_inmobiliaria_en_espanol'
);

select is(
  (select data ->> 'application_type' from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000098102'
      and type = 'admin_agent_application'
      and user_id = '00000000-0000-0000-0000-000000098011'),
  'under_agency', 'UNDERAG2_data_application_type_se_conserva'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) DUP — un 2o INSERT manual directo con la MISMA llave es rechazado por el
--    índice único (invariante de esquema, ajeno al delta de este archivo).
-- ════════════════════════════════════════════════════════════════════════════

select throws_ok(
  format($$ insert into public.notifications (user_id, type, title, related_entity_type, related_entity_id)
            values ('00000000-0000-0000-0000-000000098011', 'admin_agent_application',
                    'Nueva solicitud de agente (duplicado manual)', 'agent_application', %L) $$,
         '00000000-0000-0000-0000-000000098101'),
  '23505', null,
  'DUP1_un_segundo_insert_manual_con_la_misma_llave_es_rechazado_por_el_indice_unico'
);

select * from finish();
rollback;
