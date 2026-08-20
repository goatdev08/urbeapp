-- Tests pgTAP — CONTENIDO de admin_actions.new_values (tarea #182).
-- Ejecutar con:
--   supabase test db supabase/tests/58_audit_new_values_test.sql --local
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL PROBLEMA (guardián de 169.3, mutante M20): grant_ad_slot_atomic escribe
-- new_values, pero NINGÚN assert verificaba su contenido — vaciarlo a '{}'
-- pasaba los 55 asserts de 49_grant_ad_slot_atomic_test.sql. Es justo el campo
-- que un panel de admin (#81) leería para reconstruir QUÉ se otorgó.
--
-- 🔴 EL HUECO SE REPITE, verificado por grep de `new_values` sobre los tests:
--     39_moderate_property_atomic_test.sql .... 3 ocurrencias  (bien cubierto)
--     46_org_advertising_test.sql ............. 0
--     48_ads_state_machine_test.sql ........... 0
--     49_grant_ad_slot_atomic_test.sql ........ 0
-- Por eso este archivo NO es un parche a grant_ad_slot: cubre los tres
-- escritores de auditoría del dominio de anuncios, que era la condición que la
-- propia tarea puso para crecer ("si el patrón se repite...").
--
-- QUÉ DEBE CONTENER new_values (decisión de esta tarea): lo suficiente para
-- reconstruir el acto SIN volver a consultar las tablas que el acto modificó
-- —porque esas pueden haber cambiado después—. Para grant_ad_slot eso son las
-- ZONAS otorgadas y el ends_at resultante, que hoy NO están: `days` sin la
-- fecha de referencia no permite reconstruir la vigencia, y las zonas no
-- aparecen por ningún lado (si alguien edita ad_zones más tarde, la auditoría
-- ya no puede decir qué se vendió originalmente).
--
-- Para los cambios de estado (48/46) el payload {status} YA es suficiente —
-- ahí no falta contenido, faltaba el assert.
--
-- ── Edge cases ──────────────────────────────────────────────────────────────
--  EC-1 grant_ad_slot: new_values no está vacío (mata M20 directamente).
--  EC-2 grant_ad_slot: agency_id, creative_id y days con el valor exacto.
--  EC-3 grant_ad_slot: ends_at presente y ALINEADO con ads.ends_at real.
--  EC-4 grant_ad_slot: las zonas otorgadas viajan en new_values.
--  EC-5 grant_ad_slot NACIONAL (sin zonas): la clave existe y es un arreglo
--       vacío — "sin zonas" debe ser afirmable, no indistinguible de "no se
--       registró".
--  EC-6 cambio de estado de un ad: old_values/new_values traen el status.
--  EC-7 aprobación de agencia: old_values/new_values traen el status.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(11);

create temp table test_now_58 as select now() as v_now;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) Fixtures — self-contained, state '58' (fuera del rango real INEGI).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.mx_states (id, name, abbr) values ('58', 'Estado Auditoria 58', 'AU');
insert into public.mx_municipalities (id, state_id, name) values ('58001', '58', 'Municipio Auditoria 58');
insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('test-audit-58-001', '58001', 'Colonia Auditoria 58',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-99.30, 19.30, -99.28, 19.32, 4326))::extensions.geography);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000058000001', 'admin_audit_58@urbea.mx'),
  ('00000000-0000-0000-0000-000058000002', 'owner_audit_58@urbea.mx');
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000058000001';

insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category) values
  ('00000000-0000-0000-0000-000058040001', 'Inmobiliaria Auditoria 58', 'inmo-audit-58', 'active',
   '00000000-0000-0000-0000-000058000002', true, 'otro');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000058040003', '00000000-0000-0000-0000-000058040001', 'ready'),
  ('00000000-0000-0000-0000-000058040004', '00000000-0000-0000-0000-000058040001', 'ready');

create temp table result_58 (
  zoned_ad_id      uuid,
  zoned_new_values jsonb,
  zoned_ends_at    timestamptz,
  nat_ad_id        uuid,
  nat_new_values   jsonb
);

do $$
declare
  v_neighborhood_id bigint;
  v_ad_id           uuid;
  v_nat_id          uuid;
begin
  select id into v_neighborhood_id from public.mx_neighborhoods where source_key = 'test-audit-58-001';
  perform set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000058000001', true);

  -- Slot ZONADO: un municipio y una colonia, 45 días.
  v_ad_id := public.grant_ad_slot_atomic(
    '00000000-0000-0000-0000-000058040001'::uuid,
    '00000000-0000-0000-0000-000058040003'::uuid,
    'Anuncio Auditoria Zonado 58',
    'external_url'::ad_cta_type,
    'https://ejemplo.mx/audit-58',
    jsonb_build_array(
      jsonb_build_object('municipality_id', '58001'),
      jsonb_build_object('neighborhood_id', v_neighborhood_id)
    ),
    45
  );

  -- Slot NACIONAL: sin zonas (D3 de 169.1 — cero filas en ad_zones).
  v_nat_id := public.grant_ad_slot_atomic(
    '00000000-0000-0000-0000-000058040001'::uuid,
    '00000000-0000-0000-0000-000058040004'::uuid,
    'Anuncio Auditoria Nacional 58',
    'phone'::ad_cta_type,
    '+5213300000058',
    '[]'::jsonb,
    30
  );

  insert into result_58 (zoned_ad_id, zoned_new_values, zoned_ends_at, nat_ad_id, nat_new_values)
  select
    v_ad_id,
    (select new_values from public.admin_actions where entity_type = 'ad' and entity_id = v_ad_id),
    (select ends_at from public.ads where id = v_ad_id),
    v_nat_id,
    (select new_values from public.admin_actions where entity_type = 'ad' and entity_id = v_nat_id);
end $$;

-- ── EC-1: mata M20 (vaciar new_values a '{}') ───────────────────────────────
select isnt(
  (select zoned_new_values from result_58), '{}'::jsonb,
  'EC-1 new_values de grant_ad_slot NO esta vacio (mutante M20)'
);

-- ── EC-2: contenido campo por campo (no igualdad de jsonb completo, que se
--    vuelve frágil ante cualquier campo nuevo) ──────────────────────────────
select is(
  (select zoned_new_values ->> 'agency_id' from result_58),
  '00000000-0000-0000-0000-000058040001',
  'EC-2a new_values.agency_id exacto'
);
select is(
  (select zoned_new_values ->> 'creative_id' from result_58),
  '00000000-0000-0000-0000-000058040003',
  'EC-2b new_values.creative_id exacto'
);
select is(
  (select zoned_new_values ->> 'days' from result_58), '45',
  'EC-2c new_values.days exacto'
);

-- ── EC-3: ends_at, y ALINEADO con la fila real ──────────────────────────────
select isnt(
  (select zoned_new_values ->> 'ends_at' from result_58), null,
  'EC-3a new_values trae ends_at (days solo no permite reconstruir la vigencia)'
);
select is(
  (select (zoned_new_values ->> 'ends_at')::timestamptz from result_58),
  (select zoned_ends_at from result_58),
  'EC-3b el ends_at auditado es el MISMO que quedo en ads, no uno recalculado aparte'
);

-- ── EC-4: las zonas otorgadas ───────────────────────────────────────────────
select is(
  (select jsonb_array_length(zoned_new_values -> 'zones') from result_58), 2,
  'EC-4a new_values.zones trae las 2 zonas otorgadas'
);
select is(
  (select count(*)::int from result_58, jsonb_array_elements(zoned_new_values -> 'zones') z
    where z ->> 'municipality_id' = '58001'),
  1,
  'EC-4b la zona de municipio aparece en la auditoria'
);

-- ── EC-5: nacional — "sin zonas" debe ser AFIRMABLE ─────────────────────────
select is(
  (select jsonb_array_length(nat_new_values -> 'zones') from result_58), 0,
  'EC-5 inventario nacional: zones existe y es un arreglo vacio, no ausente'
);

-- ── EC-6/EC-7: los otros dos escritores de auditoria del dominio ────────────

do $$
declare
  v_ad_id uuid;
begin
  perform set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000058000001', true);
  select zoned_ad_id into v_ad_id from result_58;
  update public.ads set status = 'pending_review' where id = v_ad_id;
end $$;

select is(
  (select new_values ->> 'status' from public.admin_actions
    where action_type = 'change_ad_status'
      and entity_id = (select zoned_ad_id from result_58)
    order by created_at desc limit 1),
  'pending_review',
  'EC-6 el cambio de estado de un ad audita el status nuevo en new_values'
);

do $$
begin
  perform set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000058000001', true);
  insert into public.agencies (id, name, slug, status, created_by_user_id)
  values ('00000000-0000-0000-0000-000058050001', 'Inmobiliaria Pendiente 58', 'inmo-pend-58',
          'pending_approval', '00000000-0000-0000-0000-000058000002');
  update public.agencies set status = 'active' where id = '00000000-0000-0000-0000-000058050001';
end $$;

select is(
  (select new_values ->> 'status' from public.admin_actions
    where action_type = 'approve_agency'
      and entity_id = '00000000-0000-0000-0000-000058050001'),
  'active',
  'EC-7 la aprobacion de una agencia audita el status nuevo en new_values'
);

select * from finish();
rollback;
