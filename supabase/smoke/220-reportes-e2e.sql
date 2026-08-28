-- SMOKE E2E de la tarea #220 contra el stack LOCAL, por la puerta de producción.
-- Transaccional (rollback al final): no persiste nada.
-- Flujo: 3 cuentas reportan -> auto-suspensión -> avisos de ambos lados ->
--        resolución admin (restaurar) -> reportes cerrados + espejo al owner.
-- Más: regresión del flujo de revisiones EXISTENTE (#218) sobre la MISMA EF/RPC hermana.

begin;

\echo '=== FIXTURES (puerta de producción) ==='
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-e2e000000001', 'owner_smoke220@urbea.mx'),
  ('00000000-0000-0000-0000-e2e000000002', 'buscador1_smoke220@urbea.mx'),
  ('00000000-0000-0000-0000-e2e000000003', 'buscador2_smoke220@urbea.mx'),
  ('00000000-0000-0000-0000-e2e000000004', 'buscador3_smoke220@urbea.mx'),
  ('00000000-0000-0000-0000-e2e000000005', 'admin_smoke220@urbea.mx');
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-e2e000000005';

insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-e2e000000100', '00000000-0000-0000-0000-e2e000000001',
   'departamento', 'rent', 'Depa Smoke 220, CDMX',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-99.16, 19.43), 4326)::extensions.geography,
   12500, 'active');

\echo '=== PASO 1: primer reporte (1 de 3) ==='
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-e2e000000100', '00000000-0000-0000-0000-e2e000000002', 'misleading', null);
select status::text as status_tras_1er_reporte from public.properties where id = '00000000-0000-0000-0000-e2e000000100';
select type, deep_link, count(*)::int as avisos from public.notifications
 where related_entity_id = '00000000-0000-0000-0000-e2e000000100' group by 1,2 order by 1;

\echo '=== PASO 2: segundo reporte (2 de 3) — todavía NO suspende ==='
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-e2e000000100', '00000000-0000-0000-0000-e2e000000003', 'false_price', null);
select status::text as status_tras_2o_reporte from public.properties where id = '00000000-0000-0000-0000-e2e000000100';

\echo '=== PASO 2b: el mismo usuario intenta reportar otra vez (dedupe) ==='
do $$
begin
  insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
    ('00000000-0000-0000-0000-e2e000000100', '00000000-0000-0000-0000-e2e000000003', 'duplicate', null);
  raise notice 'DEDUPE: FALLO — el duplicado entró';
exception when unique_violation then
  raise notice 'DEDUPE: OK — segundo reporte del mismo usuario rechazado (23505)';
end $$;

\echo '=== PASO 2c: motivo "other" sin texto (CHECK) ==='
do $$
begin
  insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
    ('00000000-0000-0000-0000-e2e000000100', '00000000-0000-0000-0000-e2e000000004', 'other', E'\t\n');
  raise notice 'CHECK other: FALLO — entró un reason_text de puro whitespace';
exception when check_violation then
  raise notice 'CHECK other: OK — "other" con solo whitespace rechazado (23514)';
end $$;

\echo '=== PASO 3: TERCER reporte (3 reporteros distintos en 24h) → AUTO-SUSPENSIÓN ==='
insert into public.property_reports (property_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-e2e000000100', '00000000-0000-0000-0000-e2e000000004', 'not_exist_fraud', null);
select status::text as status_tras_3er_reporte from public.properties where id = '00000000-0000-0000-0000-e2e000000100';
select type, deep_link, count(*)::int as avisos from public.notifications
 where related_entity_id = '00000000-0000-0000-0000-e2e000000100' group by 1,2 order by 1;
select 'aviso al OWNER' as quien, type, deep_link from public.notifications
 where related_entity_id = '00000000-0000-0000-0000-e2e000000100'
   and user_id = '00000000-0000-0000-0000-e2e000000001';
select count(*)::int as filas_en_admin_actions_tras_el_trigger from public.admin_actions
 where entity_id = '00000000-0000-0000-0000-e2e000000100';

\echo '=== PASO 4: la cola de admin ve el caso agrupado ==='
select p.address, count(*)::int as reportes, array_agg(distinct r.reason::text order by r.reason::text) as motivos
  from public.property_reports r join public.properties p on p.id = r.property_id
 where r.status = 'new' and r.property_id = '00000000-0000-0000-0000-e2e000000100'
 group by p.address;

\echo '=== PASO 5: el admin RESTAURA desde la cola ==='
select public.resolve_property_reports_atomic(
  '00000000-0000-0000-0000-e2e000000005',
  '00000000-0000-0000-0000-e2e000000100',
  'restore',
  'Revisado: la publicación es legítima.'
);
select status::text as status_tras_restaurar, deleted_at from public.properties where id = '00000000-0000-0000-0000-e2e000000100';
select status::text, count(*)::int as reportes, count(reviewed_by_admin_id)::int as con_admin, count(resolution)::int as con_motivo
  from public.property_reports where property_id = '00000000-0000-0000-0000-e2e000000100' group by 1;
select 'espejo al owner' as quien, type, deep_link, data->>'resolution' as motivo from public.notifications
 where related_entity_id = '00000000-0000-0000-0000-e2e000000100'
   and user_id = '00000000-0000-0000-0000-e2e000000001' and type like 'property_report%';
select count(*)::int as admin_actions_tras_la_resolucion, max(action_type) as accion from public.admin_actions
 where entity_id = '00000000-0000-0000-0000-e2e000000100';
-- El admin SÍ recibió los 3 avisos de admin (no era el reportante); lo que
-- NUNCA debe recibir es el ESPEJO de su propia resolución.
select
  count(*) filter (where type like 'admin_report%')::int      as avisos_admin_legitimos,
  count(*) filter (where type like 'property_report%')::int   as espejos_al_admin_actor_debe_ser_0
  from public.notifications
 where related_entity_id = '00000000-0000-0000-0000-e2e000000100'
   and user_id = '00000000-0000-0000-0000-e2e000000005';

\echo '=== PASO 6: retry de la misma acción (idempotencia) ==='
select public.resolve_property_reports_atomic(
  '00000000-0000-0000-0000-e2e000000005',
  '00000000-0000-0000-0000-e2e000000100',
  'restore',
  'Segundo intento — no debe duplicar nada.'
);
select count(*)::int as admin_actions_tras_el_retry from public.admin_actions
 where entity_id = '00000000-0000-0000-0000-e2e000000100';
select count(*)::int as espejos_al_owner_tras_el_retry from public.notifications
 where related_entity_id = '00000000-0000-0000-0000-e2e000000100'
   and user_id = '00000000-0000-0000-0000-e2e000000001' and type like 'property_report%';

\echo '=== PASO 7: REGRESIÓN del flujo de revisiones EXISTENTE (#218) sobre la EF extendida ==='
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-e2e000000101', '00000000-0000-0000-0000-e2e000000001',
   'casa', 'sale', 'Casa Regresión 218, CDMX',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-99.17, 19.44), 4326)::extensions.geography,
   3200000, 'pending_review');
select public.moderate_property_atomic(
  p_admin_id           => '00000000-0000-0000-0000-e2e000000005',
  p_property_id        => '00000000-0000-0000-0000-e2e000000101',
  p_action_type        => 'approve',
  p_old_values         => jsonb_build_object('status', 'pending_review'),
  p_new_values         => jsonb_build_object('status', 'active'),
  p_new_property_status=> 'active'
);
select status::text as status_tras_aprobar_218 from public.properties where id = '00000000-0000-0000-0000-e2e000000101';
select count(*)::int as admin_actions_218 from public.admin_actions where entity_id = '00000000-0000-0000-0000-e2e000000101';

\echo '=== PASO 8: reporte de PERFIL (220.6) ==='
insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-e2e000000001', '00000000-0000-0000-0000-e2e000000002', 'inappropriate', null);
select count(*)::int as reportes_de_perfil, max(status::text) as status from public.user_reports
 where reported_user_id = '00000000-0000-0000-0000-e2e000000001';
do $$
begin
  insert into public.user_reports (reported_user_id, reported_by_user_id, reason, reason_text) values
    ('00000000-0000-0000-0000-e2e000000002', '00000000-0000-0000-0000-e2e000000002', 'inappropriate', null);
  raise notice 'AUTO-REPORTE: FALLO — un usuario se reportó a sí mismo';
exception when check_violation then
  raise notice 'AUTO-REPORTE: OK — reportarse a uno mismo rechazado (23514)';
end $$;
select role::text as role_del_reportado, deleted_at as borrado_del_reportado from public.users
 where id = '00000000-0000-0000-0000-e2e000000001';

rollback;
