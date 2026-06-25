-- Tests pgTAP — RPC admin_create_agency_atomic (migración 0016)
-- Fase RED subtarea 7.4: la función NO existe aún → todos los asserts fallan en rojo.
-- Ejecutar con: supabase test db
-- Corre como superusuario dentro de una transacción revertida.

begin;
select plan(8);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- El trigger handle_new_user (migración 0002) crea public.users al insertar en auth.users.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000a01', 'admin_test@urbea.mx'),
  ('00000000-0000-0000-0000-000000000a02', 'admin2_test@urbea.mx');

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

select * from finish();
rollback;
