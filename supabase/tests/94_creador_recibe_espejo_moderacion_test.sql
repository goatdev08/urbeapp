-- Tests pgTAP — el CREADOR de un anuncio/promoción recibe SIEMPRE el espejo de
-- la moderación (tarea #252, derivada de la subtarea 219.2; detectada por el
-- usuario en el smoke de producción #222 paso 6, 2026-09-03).
-- Ejecutar con: supabase test db supabase/tests/94_creador_recibe_espejo_moderacion_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de
-- una transacción revertida — el seam es el efecto OBSERVABLE de una llamada
-- real a public.moderate_ad_atomic sobre public.notifications, jamás internals.
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL HUECO, REPRODUCIDO EN PRODUCCIÓN (smoke #222, 2026-09-03)
-- ════════════════════════════════════════════════════════════════════════════
-- El agente de prueba (agency_members.member_role = 'agent') promocionó su
-- propia propiedad; el admin la aprobó; la notificación ad_approved SÍ se
-- generó… y llegó ÚNICAMENTE a Vladimir, owner de la agencia. Quien tomó la
-- acción no se enteró de su resultado. No es un bug de ejecución: la lista de
-- destinatarios vigente (20260905100001, heredada de 20260826000001) es
-- literalmente `join agency_members … member_role in ('owner','admin')`, y
-- ads.created_by_user_id nunca se consulta.
--
-- DECISIÓN (Abraham, 2026-09-03, smoke #222) — ya no es una duda de producto:
--   destinatarios = (owner/admin ACTIVOS de la agencia)
--                 ∪ (ads.created_by_user_id)
--                 − (el admin actor)
-- con dedupe por user_id. El UNION es INCONDICIONAL sobre el creador: "si un
-- anuncio o promoción se aprueba o se rechaza, se notifica también al agente
-- que lo envió". La membresía del creador NO se re-verifica (CRE12) — quien
-- envió algo a moderación merece saber en qué acabó, aunque su membresía haya
-- cambiado desde entonces.
--
-- ── SEAM (contrato público bajo prueba) ─────────────────────────────────────
-- public.moderate_ad_atomic(p_ad_id uuid, p_next_status text,
--                           p_rejection_reason text, p_admin_id uuid) → integer
-- Firma, `returns`, deep_link, `type`, `data` y textos: IDÉNTICOS a hoy. Lo
-- único que cambia es QUIÉN aparece en public.notifications.user_id.
--
-- ── Lo que este RED NO cambia (regresión protegida, CRE10-CRE11) ────────────
-- Sin creador (created_by_user_id null — todos los ads previos a #217 y todo
-- ad de Studio) el resultado es BYTE POR BYTE el de hoy. La suite 72
-- (109 asserts, AD1-AD21) sigue siendo el contrato base y NO se toca: sus
-- fixtures nacen con created_by_user_id null, así que AD1/AD3/AD11/AD15
-- (incluido "member_role agent NO recibe" para un agente que NO es el creador)
-- siguen verdes tal cual.
--
-- ponytail: los ads de este archivo se arman con creative_id, no con
-- property_id (una "promo" real). moderate_ad_atomic no lee ninguna de las dos
-- columnas — el destinatario sale de agency_id + created_by_user_id — así que
-- una promo con propiedad ejercitaría EXACTAMENTE el mismo camino a cambio de
-- montar una propiedad completa de fixture. Techo conocido: si algún día el
-- espejo distingue promo de anuncio (texto o deep_link distinto), este archivo
-- necesita el caso con property_id.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(13);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — 1 admin de plataforma actor, 1 agencia, 4 miembros.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0094-000000000001', 'admin_actor_94@urbea.mx'),
  ('00000000-0000-0000-0094-000000000002', 'org_owner_94@urbea.mx'),
  ('00000000-0000-0000-0094-000000000003', 'org_admin_94@urbea.mx'),
  ('00000000-0000-0000-0094-000000000004', 'agente_creador_94@urbea.mx'),
  ('00000000-0000-0000-0094-000000000005', 'agente_creador_suspendido_94@urbea.mx');

update public.users set role = 'admin' where id = '00000000-0000-0000-0094-000000000001';
update public.users set role = 'agent' where id in (
  '00000000-0000-0000-0094-000000000002', '00000000-0000-0000-0094-000000000003',
  '00000000-0000-0000-0094-000000000004', '00000000-0000-0000-0094-000000000005'
);

insert into public.agencies (id, name, slug, status, created_by_user_id,
                             can_publish_properties, can_advertise, advertiser_category)
values
  ('00000000-0000-0000-0094-000000000101', 'Agencia Creador 94', 'agencia-creador-94', 'active',
   '00000000-0000-0000-0094-000000000002', true, true, 'seguros');

insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0094-000000000101', '00000000-0000-0000-0094-000000000002', 'owner', 'active'),
  ('00000000-0000-0000-0094-000000000101', '00000000-0000-0000-0094-000000000003', 'admin', 'active'),
  ('00000000-0000-0000-0094-000000000101', '00000000-0000-0000-0094-000000000004', 'agent', 'active'),
  ('00000000-0000-0000-0094-000000000101', '00000000-0000-0000-0094-000000000005', 'agent', 'suspended');

insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0094-000000000111', '00000000-0000-0000-0094-000000000101', 'ready');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) APROBAR una promoción enviada por un member_role='agent' — el caso EXACTO
--    del smoke #222 paso 6.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value,
                        status, starts_at, ends_at, created_by_user_id) values
  ('00000000-0000-0000-0094-000000000201', '00000000-0000-0000-0094-000000000101',
   '00000000-0000-0000-0094-000000000111', 'Promo del Agente 94', 'phone', '+5213300009401',
   'pending_review', now() - interval '1 day', now() + interval '30 days',
   '00000000-0000-0000-0094-000000000004');

select public.moderate_ad_atomic(
  '00000000-0000-0000-0094-000000000201'::uuid, 'active', null,
  '00000000-0000-0000-0094-000000000001'::uuid
);

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0094-000000000201' and type = 'ad_approved'),
  array[
    '00000000-0000-0000-0094-000000000002'::uuid,
    '00000000-0000-0000-0094-000000000003'::uuid,
    '00000000-0000-0000-0094-000000000004'::uuid
  ],
  'CRE1_aprobar_notifica_al_agente_creador_ADEMAS_de_owner_y_admin_de_la_agencia'
);

-- El aviso del creador es el MISMO aviso, no uno de segunda: mismo type, mismo
-- deep_link, mismo data. Ancla el contrato completo de la fila nueva.
create temp table result_cre_approve_94 (n_type text, n_title text, n_body text, n_deep_link text,
                                         n_rel_type text, n_rel_id uuid, n_ad_title text);
insert into result_cre_approve_94
  select type, title, body, deep_link, related_entity_type, related_entity_id, data->>'ad_title'
  from public.notifications
  where user_id = '00000000-0000-0000-0094-000000000004'
    and related_entity_id = '00000000-0000-0000-0094-000000000201'
    and type = 'ad_approved';

select is((select n_type from result_cre_approve_94), 'ad_approved', 'CRE2_type_ad_approved_para_el_creador');
select is((select n_deep_link from result_cre_approve_94), '/ads', 'CRE3_deep_link_ads_para_el_creador');
select is((select n_rel_type from result_cre_approve_94), 'ad', 'CRE4_related_entity_type_ad_para_el_creador');
select is((select n_body from result_cre_approve_94),
  'Tu anuncio "Promo del Agente 94" fue aprobado y ya está activo.',
  'CRE5_body_identico_al_de_owner_admin_el_creador_no_recibe_un_texto_de_segunda');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) RECHAZAR — el creador recibe el motivo, igual que owner/admin.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value,
                        status, starts_at, ends_at, created_by_user_id) values
  ('00000000-0000-0000-0094-000000000202', '00000000-0000-0000-0094-000000000101',
   '00000000-0000-0000-0094-000000000111', 'Promo Rechazada 94', 'phone', '+5213300009402',
   'pending_review', now() - interval '1 day', now() + interval '30 days',
   '00000000-0000-0000-0094-000000000004');

select public.moderate_ad_atomic(
  '00000000-0000-0000-0094-000000000202'::uuid, 'rejected', 'Foto de baja calidad',
  '00000000-0000-0000-0094-000000000001'::uuid
);

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0094-000000000202' and type = 'ad_rejected'),
  array[
    '00000000-0000-0000-0094-000000000002'::uuid,
    '00000000-0000-0000-0094-000000000003'::uuid,
    '00000000-0000-0000-0094-000000000004'::uuid
  ],
  'CRE6_rechazar_notifica_al_agente_creador_ADEMAS_de_owner_y_admin'
);
select is(
  (select data->>'rejection_reason' from public.notifications
    where user_id = '00000000-0000-0000-0094-000000000004'
      and related_entity_id = '00000000-0000-0000-0094-000000000202'
      and type = 'ad_rejected'),
  'Foto de baja calidad',
  'CRE7_el_motivo_del_rechazo_viaja_al_creador_no_solo_a_owner_admin'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) PAUSAR (retiro por un admin, #210.1) — misma regla.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value,
                        status, starts_at, ends_at, created_by_user_id) values
  ('00000000-0000-0000-0094-000000000203', '00000000-0000-0000-0094-000000000101',
   '00000000-0000-0000-0094-000000000111', 'Promo Pausada 94', 'phone', '+5213300009403',
   'active', now() - interval '1 day', now() + interval '30 days',
   '00000000-0000-0000-0094-000000000004');

select public.moderate_ad_atomic(
  '00000000-0000-0000-0094-000000000203'::uuid, 'paused', null,
  '00000000-0000-0000-0094-000000000001'::uuid
);

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0094-000000000203' and type = 'ad_paused'),
  array[
    '00000000-0000-0000-0094-000000000002'::uuid,
    '00000000-0000-0000-0094-000000000003'::uuid,
    '00000000-0000-0000-0094-000000000004'::uuid
  ],
  'CRE8_pausar_notifica_al_agente_creador_ADEMAS_de_owner_y_admin'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) DEDUPE — el owner que promociona lo suyo recibe UN aviso, no dos.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value,
                        status, starts_at, ends_at, created_by_user_id) values
  ('00000000-0000-0000-0094-000000000204', '00000000-0000-0000-0094-000000000101',
   '00000000-0000-0000-0094-000000000111', 'Promo del Owner 94', 'phone', '+5213300009404',
   'pending_review', now() - interval '1 day', now() + interval '30 days',
   '00000000-0000-0000-0094-000000000002');

select public.moderate_ad_atomic(
  '00000000-0000-0000-0094-000000000204'::uuid, 'active', null,
  '00000000-0000-0000-0094-000000000001'::uuid
);

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0094-000000000002'
      and related_entity_id = '00000000-0000-0000-0094-000000000204'
      and type = 'ad_approved'),
  1,
  'CRE9_el_owner_CREADOR_recibe_exactamente_un_aviso_el_union_deduplica'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) El admin ACTOR nunca se notifica a sí mismo, ni siendo el creador.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value,
                        status, starts_at, ends_at, created_by_user_id) values
  ('00000000-0000-0000-0094-000000000205', '00000000-0000-0000-0094-000000000101',
   '00000000-0000-0000-0094-000000000111', 'Promo del Admin Actor 94', 'phone', '+5213300009405',
   'pending_review', now() - interval '1 day', now() + interval '30 days',
   '00000000-0000-0000-0094-000000000001');

select public.moderate_ad_atomic(
  '00000000-0000-0000-0094-000000000205'::uuid, 'active', null,
  '00000000-0000-0000-0094-000000000001'::uuid
);

-- Filtrado por los 3 types de espejo: el INSERT crudo en pending_review dispara
-- el admin_ad_pending legítimo de #219.1 hacia este mismo admin (mismo
-- related_entity_id) — ese aviso NO es un espejo y debe seguir existiendo.
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0094-000000000001'
      and related_entity_id = '00000000-0000-0000-0094-000000000205'
      and type in ('ad_approved', 'ad_rejected', 'ad_paused')),
  0,
  'CRE10_el_admin_actor_que_ADEMAS_es_el_creador_no_se_autonotifica'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) REGRESIÓN — sin creador, el reparto es el de hoy, sin filas de más.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value,
                        status, starts_at, ends_at) values
  ('00000000-0000-0000-0094-000000000206', '00000000-0000-0000-0094-000000000101',
   '00000000-0000-0000-0094-000000000111', 'Ad Sin Creador 94', 'phone', '+5213300009406',
   'pending_review', now() - interval '1 day', now() + interval '30 days');

select public.moderate_ad_atomic(
  '00000000-0000-0000-0094-000000000206'::uuid, 'active', null,
  '00000000-0000-0000-0094-000000000001'::uuid
);

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0094-000000000206' and type = 'ad_approved'),
  array[
    '00000000-0000-0000-0094-000000000002'::uuid,
    '00000000-0000-0000-0094-000000000003'::uuid
  ],
  'CRE11_created_by_user_id_null_reparte_exactamente_como_hoy_owner_y_admin'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) El UNION del creador es INCONDICIONAL: no se re-verifica su membresía.
--    Un agente cuya membresía quedó suspendida DESPUÉS de enviar su promoción
--    igual se entera del veredicto (decisión Abraham: "se notifica también al
--    agente que lo envió"). Es el complemento —no la contradicción— de AD2 de
--    la suite 72: ahí el suspendido no era el creador y sigue sin recibir.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value,
                        status, starts_at, ends_at, created_by_user_id) values
  ('00000000-0000-0000-0094-000000000207', '00000000-0000-0000-0094-000000000101',
   '00000000-0000-0000-0094-000000000111', 'Promo de Suspendido 94', 'phone', '+5213300009407',
   'pending_review', now() - interval '1 day', now() + interval '30 days',
   '00000000-0000-0000-0094-000000000005');

select public.moderate_ad_atomic(
  '00000000-0000-0000-0094-000000000207'::uuid, 'rejected', 'Fuera de catálogo',
  '00000000-0000-0000-0094-000000000001'::uuid
);

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0094-000000000005'
      and related_entity_id = '00000000-0000-0000-0094-000000000207'
      and type = 'ad_rejected'),
  1,
  'CRE12_el_creador_recibe_aunque_su_membresia_este_suspendida_el_union_es_incondicional'
);

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0094-000000000207' and type = 'ad_rejected'),
  3,
  'CRE13_tres_destinatarios_exactos_owner_admin_y_creador_sin_filas_de_mas'
);

select * from finish();
rollback;
