-- Tests pgTAP — public.moderate_property_atomic (#130, fix 73.9)
-- Ejecutar con: supabase test db (CLI global de brew, NUNCA npx supabase)
-- Corre como superusuario dentro de una transacción revertida (no persiste).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SUT: RPC SECURITY DEFINER moderate_property_atomic (migración 20260809000007).
-- Origen del defecto (#130): moderate-property escribía status, resolvía la
-- revisión e insertaba en admin_actions en TRES round-trips independientes sin
-- transacción — si el audit fallaba tras activar la propiedad, la EF devolvía
-- 500 con la propiedad YA activa y sin rastro en admin_actions, y el reintento
-- chocaba con NOTHING_TO_MODERATE. Esta RPC junta las escrituras en UNA
-- transacción (mismo patrón que publish_property_atomic):
--   - p_changed_fields (jsonb, opcional): aplica el snapshot de la revisión a
--     properties con semántica POR PRESENCIA DE CLAVE (jsonb ? key): clave
--     ausente = no tocar; null explícito = borrar a propósito (#142).
--   - p_new_property_status (opcional): mueve properties.status.
--   - p_revision_id + p_revision_status + p_revision_reason (opcional): cierra
--     la revisión (reviewed_by_admin_id, reviewed_at).
--   - SIEMPRE inserta la fila de auditoría en admin_actions.
--   - Cualquier fallo → rollback de TODO (fault-injection abajo).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(17);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- El trigger handle_new_user (0002) crea public.users al insertar en auth.users.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0007-000000000001', 'agente_mod_atomic@urbea.mx'),
  ('00000000-0000-0000-0007-000000000002', 'admin_mod_atomic@urbea.mx');
update public.users set role = 'agent'
 where id = '00000000-0000-0000-0007-000000000001';
update public.users set role = 'admin'
 where id = '00000000-0000-0000-0007-000000000002';

-- Propiedad base en pending_review con datos que el snapshot va a pisar.
insert into public.properties
  (id, owner_user_id, operation_type, property_type, price, bedrooms, bathrooms,
   address, location, price_visible, description, status)
values (
  '00000000-0000-0000-0007-000000000010',
  '00000000-0000-0000-0007-000000000001',
  'rent', 'departamento', 10000, 2, 1,
  'Calle Moderación Atómica 1',
  extensions.ST_SetSRID(extensions.ST_Point(-99.1, 19.4), 4326)::extensions.geography,
  true, 'descripción original', 'pending_review'
);

-- Revisión activa con snapshot: cambia price y description; bedrooms va null
-- EXPLÍCITO (= borrar a propósito); bathrooms NO viene (= no tocar, #142).
insert into public.property_revisions (id, property_id, status, changed_fields, submitted_by)
values (
  '00000000-0000-0000-0007-000000000020',
  '00000000-0000-0000-0007-000000000010',
  'pending',
  '{"price": 12000, "description": "descripción editada", "bedrooms": null, "price_visible": false, "built_square_meters": 210.5, "half_bathrooms": 1, "currency": "USD"}'::jsonb,
  '00000000-0000-0000-0007-000000000001'
);

-- ── 1) La función existe y es SECURITY DEFINER ───────────────────────────────
select has_function(
  'public', 'moderate_property_atomic',
  '1) moderate_property_atomic debe existir en public'
);

select is(
  (select prosecdef from pg_proc
     join pg_namespace ns on pg_proc.pronamespace = ns.oid
    where ns.nspname = 'public' and pg_proc.proname = 'moderate_property_atomic'
    limit 1),
  true,
  '2) moderate_property_atomic debe ser SECURITY DEFINER'
);

-- ── Camino completo: aprobar-con-revisión desde pending_review ───────────────
-- snapshot + status→active + revisión→approved + admin_action, en UNA llamada.
select public.moderate_property_atomic(
  p_admin_id            => '00000000-0000-0000-0007-000000000002'::uuid,
  p_property_id         => '00000000-0000-0000-0007-000000000010'::uuid,
  p_action_type         => 'approve',
  p_old_values          => '{"status": "pending_review", "revision_status": "pending"}'::jsonb,
  p_new_values          => '{"status": "active", "revision_status": "approved"}'::jsonb,
  p_reason              => null,
  p_new_property_status => 'active',
  p_changed_fields      => (select changed_fields from public.property_revisions
                             where id = '00000000-0000-0000-0007-000000000020'),
  p_revision_id         => '00000000-0000-0000-0007-000000000020'::uuid,
  p_revision_status     => 'approved',
  p_revision_reason     => null
);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0007-000000000010'),
  'active',
  '3) status pasa a active (el defecto #130: la rama con-revisión nunca lo movía)'
);

select is(
  (select price from public.properties where id = '00000000-0000-0000-0007-000000000010'),
  12000::numeric,
  '4) el snapshot aplica price'
);

select is(
  (select description from public.properties where id = '00000000-0000-0000-0007-000000000010'),
  'descripción editada',
  '5) el snapshot aplica description'
);

select is(
  (select bedrooms from public.properties where id = '00000000-0000-0000-0007-000000000010'),
  null::integer,
  '6) bedrooms null EXPLÍCITO en el snapshot borra el dato (semántica #142)'
);

select is(
  (select bathrooms from public.properties where id = '00000000-0000-0000-0007-000000000010'),
  1,
  '7) bathrooms AUSENTE del snapshot NO se toca (clave ausente ≠ null)'
);

select is(
  (select price_visible from public.properties where id = '00000000-0000-0000-0007-000000000010'),
  false,
  '8) el snapshot aplica price_visible=false'
);

-- Quick fixes wizard paso 3 (sesión 2026-08-15, sin tarea de Taskmaster):
-- built_square_meters/half_bathrooms/currency también son parte del snapshot.
select is(
  (select built_square_meters from public.properties where id = '00000000-0000-0000-0007-000000000010'),
  210.5::numeric,
  '9) el snapshot aplica built_square_meters'
);

select is(
  (select half_bathrooms from public.properties where id = '00000000-0000-0000-0007-000000000010'),
  1,
  '10) el snapshot aplica half_bathrooms'
);

select is(
  (select currency from public.properties where id = '00000000-0000-0000-0007-000000000010'),
  'USD',
  '11) el snapshot aplica currency'
);

select is(
  (select status::text from public.property_revisions
    where id = '00000000-0000-0000-0007-000000000020'),
  'approved',
  '12) la revisión queda approved con reviewed_by/reviewed_at'
);

select is(
  (select reviewed_by_admin_id from public.property_revisions
    where id = '00000000-0000-0000-0007-000000000020'),
  '00000000-0000-0000-0007-000000000002'::uuid,
  '13) reviewed_by_admin_id = el admin que moderó'
);

select is(
  (select count(*)::int from public.admin_actions
    where entity_id = '00000000-0000-0000-0007-000000000010'
      and action_type = 'approve'),
  1,
  '14) la auditoría queda registrada en la MISMA transacción'
);

-- ── Solo status + auditoría (rama suspend / sin-revisión) ────────────────────
select public.moderate_property_atomic(
  p_admin_id            => '00000000-0000-0000-0007-000000000002'::uuid,
  p_property_id         => '00000000-0000-0000-0007-000000000010'::uuid,
  p_action_type         => 'suspend',
  p_old_values          => '{"status": "active"}'::jsonb,
  p_new_values          => '{"status": "suspended"}'::jsonb,
  p_reason              => 'reporte de fraude'
  -- sin changed_fields, sin revision — solo status + audit
  , p_new_property_status => 'suspended'
);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0007-000000000010'),
  'suspended',
  '15) sin snapshot ni revisión: solo mueve status (rama suspend)'
);

-- ── Fault-injection: admin_id inexistente → TODO hace rollback ───────────────
-- El INSERT de admin_actions viola la FK (admin_id restrict) — la excepción
-- debe revertir también el cambio de status de la MISMA llamada.
select throws_ok(
  $$
    select public.moderate_property_atomic(
      p_admin_id            => '00000000-0000-0000-0007-0000000000ff'::uuid,
      p_property_id         => '00000000-0000-0000-0007-000000000010'::uuid,
      p_action_type         => 'approve',
      p_old_values          => '{"status": "suspended"}'::jsonb,
      p_new_values          => '{"status": "active"}'::jsonb,
      p_new_property_status => 'active'
    )
  $$,
  '23503',
  null,
  '16) admin_id inexistente viola la FK de admin_actions y lanza 23503'
);

select is(
  (select status::text from public.properties where id = '00000000-0000-0000-0007-000000000010'),
  'suspended',
  '17) el status NO cambió: el fallo del audit revierte TODA la llamada (el defecto #130 original)'
);

select * from finish();
rollback;
