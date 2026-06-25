-- Tests pgTAP — RPC admin_create_agency_atomic (migración 0016)
-- Fase RED subtarea 7.4: tests 1–8 (agencia básica).
-- Fase RED subtarea 7.5: tests 9–13 (owner_user_id, agency_members, ALREADY_ACTIVE_MEMBER).
-- Ejecutar con: supabase test db
-- Corre como superusuario dentro de una transacción revertida.

begin;
select plan(13);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- El trigger handle_new_user (migración 0002) crea public.users al insertar en auth.users.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000a01', 'admin_test@urbea.mx'),
  ('00000000-0000-0000-0000-000000000a02', 'admin2_test@urbea.mx'),
  -- owner para los tests de 7.5
  ('00000000-0000-0000-0000-000000000a03', 'owner_test@urbea.mx');

-- Agencia existente para tests de unicidad de slug y name
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000000a10',
   'Agencia Existente SA de CV',
   'agencia-existente',
   'active',
   '00000000-0000-0000-0000-000000000a01');

-- ── 1) La función admin_create_agency_atomic existe en public ─────────────────
select has_function(
  'public',
  'admin_create_agency_atomic',
  'función admin_create_agency_atomic debe existir en el schema public'
);

-- ── 2) Es SECURITY DEFINER ───────────────────────────────────────────────────
-- Sin la función, prosecdef es NULL → is(NULL, true) falla (RED correcto).
select is(
  (select prosecdef
     from pg_proc
     join pg_namespace ns on pg_proc.pronamespace = ns.oid
    where ns.nspname = 'public'
      and proname = 'admin_create_agency_atomic'
    limit 1),
  true,
  'admin_create_agency_atomic debe ser SECURITY DEFINER'
);

-- ── 3) Happy path: insert básico se ejecuta sin error ────────────────────────
select lives_ok(
  $$ select public.admin_create_agency_atomic(
       'Nueva Inmobiliaria MX'::text,
       'nueva-inmobiliaria-mx'::text,
       'Director Comercial'::text,
       '+52 55 1234 5678'::text,
       'director@nuevamx.com'::text,
       '00000000-0000-0000-0000-000000000a01'::uuid) $$,
  'admin_create_agency_atomic: insert básico se ejecuta sin error'
);

-- ── 4) Agencia insertada con status = active ──────────────────────────────────
-- La RPC debe insertar con status = 'active' (el admin aprueba al crear).
select is(
  (select status::text from public.agencies where slug = 'nueva-inmobiliaria-mx'),
  'active',
  'agencia creada por admin tiene status = active'
);

-- ── 5) created_by_user_id registrado correctamente ──────────────────────────
select is(
  (select created_by_user_id from public.agencies where slug = 'nueva-inmobiliaria-mx'),
  '00000000-0000-0000-0000-000000000a01'::uuid,
  'agencia creada con created_by_user_id correcto'
);

-- ── 6) Slug duplicado de agencia activa → SLUG_DUPLICATE (P0001) ─────────────
select throws_ok(
  $$ select public.admin_create_agency_atomic(
       'Otra Agencia Con Slug Duplicado'::text,
       'agencia-existente'::text,
       null::text,
       null::text,
       null::text,
       '00000000-0000-0000-0000-000000000a01'::uuid) $$,
  'P0001', 'SLUG_DUPLICATE',
  'slug duplicado de agencia activa → SLUG_DUPLICATE'
);

-- ── 7) Name duplicado de agencia activa → NAME_DUPLICATE (P0001) ─────────────
select throws_ok(
  $$ select public.admin_create_agency_atomic(
       'Agencia Existente SA de CV'::text,
       'slug-diferente-pero-name-igual'::text,
       null::text,
       null::text,
       null::text,
       '00000000-0000-0000-0000-000000000a01'::uuid) $$,
  'P0001', 'NAME_DUPLICATE',
  'name duplicado de agencia activa → NAME_DUPLICATE'
);

-- ── 8) created_by_user_id NULL → la RPC debe rechazarlo ─────────────────────
-- Puede ser NOT NULL en el INSERT o un RAISE explícito en la función.
select throws_ok(
  $$ select public.admin_create_agency_atomic(
       'Agencia Sin Owner'::text,
       'agencia-sin-owner'::text,
       null::text,
       null::text,
       null::text,
       null::uuid) $$,
  'created_by_user_id NULL debe ser rechazado por la RPC'
);

-- ── 9) Firma extendida con p_owner_user_id (7.5) — RED: función no existe aún ──
-- La RPC debe aceptar 7 parámetros: name, slug, contact_name, contact_phone,
-- contact_email, created_by_user_id, owner_user_id.
-- En RED, has_function con 7 parámetros falla porque solo existe la versión de 6.
select has_function(
  'public',
  'admin_create_agency_atomic',
  ARRAY['text', 'text', 'text', 'text', 'text', 'uuid', 'uuid'],
  'admin_create_agency_atomic con p_owner_user_id (7 params) debe existir'
);

-- ── 10) Llamada extendida: insert con owner_user_id sin error ────────────────
-- En RED, esta llamada falla porque la versión de 7 parámetros no existe.
select lives_ok(
  $$ select public.admin_create_agency_atomic(
       'Agencia Con Owner MX'::text,
       'agencia-con-owner-mx'::text,
       null::text,
       null::text,
       null::text,
       '00000000-0000-0000-0000-000000000a01'::uuid,
       '00000000-0000-0000-0000-000000000a03'::uuid) $$,
  'admin_create_agency_atomic extendida: insert con owner_user_id se ejecuta sin error'
);

-- ── 11) agency_member del owner creado con member_role=owner status=active ───
-- En RED, la agencia no fue insertada (lives_ok falló) → SELECT devuelve NULL.
select is(
  (select member_role::text
     from public.agency_members
    where user_id = '00000000-0000-0000-0000-000000000a03'::uuid
      and status = 'active'
    limit 1),
  'owner',
  'owner insertado en agency_members con member_role=owner y status=active'
);

-- ── 12) public.users.role actualizado a agent para el owner ─────────────────
-- En RED, la UPDATE no ocurrió → role sigue siendo 'user' (el trigger lo setea así).
select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000000a03'::uuid),
  'agent',
  'public.users.role actualizado a agent para el owner tras crear agencia'
);

-- ── 13) owner ya con membresía activa → P0001 ALREADY_ACTIVE_MEMBER ─────────
-- En RED, la función de 7 params no existe → throws error distinto a P0001.
-- El test fallará porque el errcode o el mensaje no coinciden.
select throws_ok(
  $$ select public.admin_create_agency_atomic(
       'Otra Agencia Para Mismo Owner'::text,
       'otra-agencia-para-mismo-owner'::text,
       null::text,
       null::text,
       null::text,
       '00000000-0000-0000-0000-000000000a02'::uuid,
       '00000000-0000-0000-0000-000000000a03'::uuid) $$,
  'P0001', 'ALREADY_ACTIVE_MEMBER',
  'owner ya con membresía activa → P0001 ALREADY_ACTIVE_MEMBER'
);

select * from finish();
rollback;
