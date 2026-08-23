-- Tests pgTAP — overload de 4 argumentos de public.set_org_advertising_atomic
-- (tarea #209, subtarea 209.1).
-- Ejecutar con:
--   supabase test db supabase/tests/65_set_org_advertising_atomic_admin_test.sql --local
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL HUECO: la RPC de 3 argumentos (20260815000002, extendida en 20260816000003)
-- ya hace todo el trabajo de negocio (valida agencia, exige categoría al
-- encender, hace el UPDATE, audita en admin_actions) pero resuelve el admin
-- vía private.resolve_admin_actor(), que necesita auth.uid() o el GUC de
-- sesión `urbea.admin_actor_id` YA instalado. Una Edge Function con
-- service_role no tiene auth.uid(). Este overload de 4 argumentos instala el
-- GUC y delega el resto -- mismo patrón que moderate_ad_atomic (#208.1,
-- 64_moderate_ad_atomic_test.sql).
--
-- LO QUE ESTE OVERLOAD **NO** HACE, A PROPÓSITO: no repite la validación, el
-- UPDATE ni el INSERT de auditoría -- eso ya está cubierto por
-- 46_org_advertising_test.sql (sección 7, asserts 29-48) sobre la RPC de 3
-- argumentos. Aquí solo se verifica que el overload (a) exista con la firma
-- correcta, (b) instale correctamente el admin en admin_actions, (c) propague
-- AGENCY_NOT_FOUND y ADVERTISER_CATEGORY_REQUIRED sin traducirlos, y (d) sea
-- inalcanzable para authenticated/anon.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(9);

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token,
                        email_change_token_new, email_change)
values
  ('d0000000-0000-0000-0000-00000000009a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin209@urbea.test', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

-- ⚠️ Un trigger sobre auth.users ya espeja la fila hacia public.users, así que
-- un INSERT plano choca con users_pkey. Se hace UPSERT y lo que importa —el
-- `role`— se fija explícitamente: el espejo crea al usuario con role='user'.
insert into public.users (id, first_name, last_name, email, role)
values
  ('d0000000-0000-0000-0000-00000000009a', 'Admin', 'Dos09', 'admin209@urbea.test', 'admin')
on conflict (id) do update set role = excluded.role;

insert into public.agencies (id, name, slug, status, created_by_user_id,
                             can_publish_properties, can_advertise, advertiser_category)
values
  ('e0000000-0000-0000-0000-00000000009a', 'Seguros Test 209', 'seguros-209', 'active',
   'd0000000-0000-0000-0000-00000000009a', true, false, null);

-- ── 1. El overload existe con la firma esperada ─────────────────────────────
select has_function(
  'public', 'set_org_advertising_atomic',
  array['uuid', 'boolean', 'advertiser_category', 'uuid'],
  'SOA1: set_org_advertising_atomic(p_agency_id, p_enabled, p_category, p_admin_id) existe'
);

select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_org_advertising_atomic'
      and p.pronargs = 4),
  true,
  'SOA2: el overload de 4 argumentos es SECURITY DEFINER'
);

-- 🔒 Este overload instala un admin_actor ARBITRARIO en el GUC: en manos de
-- authenticated/anon sería escalada de privilegios directa. Solo service_role.
select ok(
  not has_function_privilege(
    'authenticated',
    'public.set_org_advertising_atomic(uuid, boolean, advertiser_category, uuid)',
    'EXECUTE'
  ),
  'SOA3: authenticated NO puede ejecutar el overload de 4 argumentos'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.set_org_advertising_atomic(uuid, boolean, advertiser_category, uuid)',
    'EXECUTE'
  ),
  'SOA4: anon NO puede ejecutar el overload de 4 argumentos'
);

-- ── 2. Encender con categoría: audita con el admin_id correcto ─────────────
select lives_ok(
  $$ select public.set_org_advertising_atomic(
       'e0000000-0000-0000-0000-00000000009a'::uuid, true, 'seguros'::public.advertiser_category,
       'd0000000-0000-0000-0000-00000000009a'::uuid) $$,
  'SOA5: encender con categoría válida no lanza'
);

select results_eq(
  $$ select can_advertise, advertiser_category::text from public.agencies
      where id = 'e0000000-0000-0000-0000-00000000009a' $$,
  $$ values (true, 'seguros') $$,
  'SOA6: la agencia quedó con can_advertise=true y la categoría dada'
);

select is(
  (select admin_id from public.admin_actions
    where entity_type = 'agency' and entity_id = 'e0000000-0000-0000-0000-00000000009a'
      and action_type = 'enable_org_advertising'
    order by created_at desc limit 1),
  'd0000000-0000-0000-0000-00000000009a'::uuid,
  'SOA7: la auditoría registra al admin que pasó el overload, resuelto vía el GUC'
);

-- ── 3. Lo que la RPC de 3 argumentos rechaza, el overload propaga sin traducir ─
select throws_ok(
  $$ select public.set_org_advertising_atomic(
       'e0000000-0000-0000-0000-00000000009a'::uuid, true, null,
       'd0000000-0000-0000-0000-00000000009a'::uuid) $$,
  'P0001',
  'ADVERTISER_CATEGORY_REQUIRED',
  'SOA8: encender sin categoría se rechaza igual que en la RPC de 3 argumentos'
);

-- ── 4. Agencia inexistente: el overload propaga AGENCY_NOT_FOUND ───────────
select throws_ok(
  $$ select public.set_org_advertising_atomic(
       'e0000000-0000-0000-0000-0000000000ff'::uuid, true, 'seguros'::public.advertiser_category,
       'd0000000-0000-0000-0000-00000000009a'::uuid) $$,
  'P0001',
  'AGENCY_NOT_FOUND',
  'SOA9: una agencia inexistente se rechaza igual que en la RPC de 3 argumentos'
);

select * from finish();
rollback;
