-- Tests pgTAP — premium derivado (subtarea 71.1)
-- SUT: private.is_premium(uid uuid) RETURNS boolean SECURITY DEFINER STABLE
--      (aún no existe -- se crea en la migración GREEN, patrón migración 0010:
--      helpers en schema `private`, EXECUTE otorgado explícitamente).
-- Ejecutar con: supabase test db (o pnpm supabase test db)
-- Corre como superusuario dentro de una transacción revertida (no persiste).
--
-- Semántica bajo prueba (PRD §4.5 "Usuario premium" + PRD-beta épica 71): un usuario
-- es "premium" (capacidad derivada, NUNCA un rol almacenado -- el enum user_role
-- queda {user,agent,admin}) si EXISTS al menos una public.properties suya con
-- deleted_at IS NULL. El status (draft/active/etc.) NO filtra: la condición literal
-- es "no borrada", no "activa" -- ver caso 9.
--
-- ⚠️ Rama "purchase vigente" DIFERIDA (ponytail): no existe tabla purchases/video_slots
-- en supabase/migrations/ (grep confirmado) -- esa tabla es de la épica futura #76
-- (PRD-beta §17, "Modelo de pagos"). Esta suite cubre EXCLUSIVAMENTE la rama de
-- properties. Cuando #76 aterrice, is_premium ganará el segundo OR EXISTS y esta
-- suite se extenderá (no se reescribe).
--
-- Estrategia RED sin abortar la transacción: los checks de metadata (existe / security
-- definer / stable / tipo de retorno / grants) son consultas puras contra pg_proc /
-- information_schema -- seguras aunque la función no exista todavía (fila NULL / 0 filas,
-- nunca un error). Para los checks de VALOR de retorno (true/false), como la función
-- literalmente no existe todavía, invocarla directo abortaría la transacción entera
-- (42883 sin capturar, a diferencia de throws_ok/lives_ok que sí capturan). Por eso se usa
-- un wrapper pg_temp que atrapa undefined_function y devuelve NULL -- is(NULL, false, ...)
-- falla limpio por aserción, no por excepción sin capturar (mismo espíritu que
-- throws_ok/lives_ok en 06_publish_property_rpc_test.sql y 19_register_user_atomic_test.sql).

begin;
select plan(16);

-- ── Wrapper seguro: invoca private.is_premium sin abortar si aún no existe ───────
create or replace function pg_temp.premium_or_null(p_uid uuid)
returns boolean language plpgsql as $$
begin
  return private.is_premium(p_uid);
exception when undefined_function or invalid_schema_name then
  return null;
end $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- El trigger handle_new_user (migración 0002) crea public.users al insertar en auth.users.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000002001', 'u1.sin_properties@test.local'),
  ('00000000-0000-0000-0000-000000002002', 'u2.activa@test.local'),
  ('00000000-0000-0000-0000-000000002003', 'u3.draft_no_borrada@test.local'),
  ('00000000-0000-0000-0000-000000002004', 'u4.todas_borradas@test.local'),
  ('00000000-0000-0000-0000-000000002005', 'u5.activa_y_borrada@test.local'),
  ('00000000-0000-0000-0000-000000002006', 'u6.agent@test.local'),
  ('00000000-0000-0000-0000-000000002007', 'u7.admin_sin_properties@test.local'),
  ('00000000-0000-0000-0000-000000002008', 'u8.aislamiento@test.local');

update public.users set role = 'agent' where id = '00000000-0000-0000-0000-000000002006';
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000002007';

-- u2: una property activa, no borrada.
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000002102', '00000000-0000-0000-0000-000000002002',
   'departamento', 'rent', 'Fixture premium — u2 activa',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography,
   12000, 'active');

-- u3: una property en draft (NO borrada, pero tampoco activa) -- "no borrada" basta.
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000002103', '00000000-0000-0000-0000-000000002003',
   'casa', 'sale', 'Fixture premium — u3 draft',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography,
   2500000, 'draft');

-- u4: dos properties, AMBAS soft-deleted.
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000002104', '00000000-0000-0000-0000-000000002004',
   'local', 'rent', 'Fixture premium — u4 borrada #1',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.34, 20.66), 4326)::extensions.geography,
   8000, 'active'),
  ('00000000-0000-0000-0000-000000002105', '00000000-0000-0000-0000-000000002004',
   'oficina', 'rent', 'Fixture premium — u4 borrada #2',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.34, 20.66), 4326)::extensions.geography,
   9000, 'active');
update public.properties set deleted_at = now()
  where id in ('00000000-0000-0000-0000-000000002104', '00000000-0000-0000-0000-000000002105');

-- u5: una activa + una borrada -- basta la NO borrada para ser premium.
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000002106', '00000000-0000-0000-0000-000000002005',
   'terreno', 'sale', 'Fixture premium — u5 activa',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.33, 20.65), 4326)::extensions.geography,
   500000, 'active'),
  ('00000000-0000-0000-0000-000000002107', '00000000-0000-0000-0000-000000002005',
   'casa', 'sale', 'Fixture premium — u5 borrada',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.33, 20.65), 4326)::extensions.geography,
   600000, 'active');
update public.properties set deleted_at = now()
  where id = '00000000-0000-0000-0000-000000002107';

-- u6 (agent): una property activa -- el agente "hereda" premium por la misma vía derivada.
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000002108', '00000000-0000-0000-0000-000000002006',
   'departamento', 'rent', 'Fixture premium — u6 agent activa',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.37, 20.69), 4326)::extensions.geography,
   11000, 'active');

-- u7 (admin): SIN properties -- el rol NO otorga premium por sí solo.
-- u8: SIN properties propias -- existe la de u2 (aislamiento: no debe "contagiarse").

-- ════════════════════════════════════════════════════════════════════════════
-- 1-4) Metadata de la función (segura aunque no exista todavía)
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Existe en el schema private con la firma (uuid).
select has_function(
  'private',
  'is_premium',
  ARRAY['uuid'],
  'private.is_premium(uuid) debe existir en el schema private'
);

-- 2) SECURITY DEFINER.
select is(
  (select prosecdef from pg_proc join pg_namespace ns on pg_proc.pronamespace = ns.oid
    where ns.nspname = 'private' and pg_proc.proname = 'is_premium' limit 1),
  true,
  'private.is_premium debe ser SECURITY DEFINER'
);

-- 3) STABLE (provolatile = 's').
select is(
  (select provolatile from pg_proc join pg_namespace ns on pg_proc.pronamespace = ns.oid
    where ns.nspname = 'private' and pg_proc.proname = 'is_premium' limit 1),
  's',
  'private.is_premium debe ser STABLE'
);

-- 4) Retorna boolean.
select is(
  (select prorettype = 'boolean'::regtype
     from pg_proc join pg_namespace ns on pg_proc.pronamespace = ns.oid
    where ns.nspname = 'private' and pg_proc.proname = 'is_premium' limit 1),
  true,
  'private.is_premium debe retornar boolean'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5-6) Grants (patrón de la migración 20260702000001: EXECUTE explícito solo a
--      authenticated -- no el blanket original de la migración 0010). Consulta segura
--      contra information_schema: 0 filas si la función no existe, nunca error.
-- ════════════════════════════════════════════════════════════════════════════

-- 5) EXECUTE concedido a authenticated.
select ok(
  exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'private' and routine_name = 'is_premium'
      and grantee = 'authenticated' and privilege_type = 'EXECUTE'
  ),
  'authenticated tiene EXECUTE sobre private.is_premium'
);

-- 6) EXECUTE NO concedido a anon (capacidades premium son de gestión de la cuenta propia,
--    nunca de un visitante anónimo -- mismo criterio que private.can_view_user_as_lead_searcher).
select ok(
  not exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'private' and routine_name = 'is_premium'
      and grantee = 'anon' and privilege_type = 'EXECUTE'
  ),
  'anon NO tiene EXECUTE sobre private.is_premium'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7-16) Valor de retorno (wrapper pg_temp.premium_or_null -- ver comentario de cabecera)
-- ════════════════════════════════════════════════════════════════════════════

-- 7) Usuario sin properties → false.
select is(
  pg_temp.premium_or_null('00000000-0000-0000-0000-000000002001'),
  false,
  'usuario_sin_properties_no_es_premium'
);

-- 8) Usuario con property activa (no borrada) → true.
select is(
  pg_temp.premium_or_null('00000000-0000-0000-0000-000000002002'),
  true,
  'usuario_con_property_activa_es_premium'
);

-- 9) Usuario con property en draft (no activa, pero no borrada) → true.
--    La condición es "no borrada", NO "activa" -- distingue de una lectura estricta del PRD.
select is(
  pg_temp.premium_or_null('00000000-0000-0000-0000-000000002003'),
  true,
  'usuario_con_property_no_borrada_en_draft_es_premium_sin_importar_status'
);

-- 10) Usuario con TODAS sus properties soft-deleted → false.
select is(
  pg_temp.premium_or_null('00000000-0000-0000-0000-000000002004'),
  false,
  'usuario_con_todas_sus_properties_borradas_no_es_premium'
);

-- 11) Usuario con una activa y otra borrada → true (basta UNA no borrada).
select is(
  pg_temp.premium_or_null('00000000-0000-0000-0000-000000002005'),
  true,
  'usuario_con_al_menos_una_property_no_borrada_es_premium_aunque_tenga_otras_borradas'
);

-- 12) Agent con property → true (misma vía derivada, el rol no cambia la lógica).
select is(
  pg_temp.premium_or_null('00000000-0000-0000-0000-000000002006'),
  true,
  'agent_con_property_no_borrada_es_premium_via_la_misma_derivacion'
);

-- 13) Admin SIN properties → false. El rol almacenado no otorga premium por sí solo;
--     is_premium depende exclusivamente de la existencia de la property.
select is(
  pg_temp.premium_or_null('00000000-0000-0000-0000-000000002007'),
  false,
  'admin_sin_properties_no_es_premium_el_rol_no_basta'
);

-- 14) uid inexistente (no está en auth.users ni public.users) → false, SIN error.
select is(
  pg_temp.premium_or_null('00000000-0000-0000-0000-000000002099'),
  false,
  'uid_inexistente_retorna_false_sin_lanzar_error'
);

-- 15) uid NULL → false, SIN error (NULL no debe propagarse ni lanzar).
select is(
  pg_temp.premium_or_null(null),
  false,
  'uid_null_retorna_false_sin_lanzar_error'
);

-- 16) Aislamiento: u8 no tiene properties propias -- la property de u2 (otro usuario)
--     NO debe "contagiarle" premium.
select is(
  pg_temp.premium_or_null('00000000-0000-0000-0000-000000002008'),
  false,
  'property_de_otro_usuario_no_contagia_premium_aislamiento_por_owner_user_id'
);

select * from finish();
rollback;
