-- Tests pgTAP — RPC admin_create_agency_atomic (migración 0016)
-- Fase RED subtarea 7.4: tests 1–8 (agencia básica).
-- Fase RED subtarea 7.5: tests 9–13 (owner_user_id, agency_members, ALREADY_ACTIVE_MEMBER).
-- Fase RED subtarea 7.6: tests 14–20 (p_token_hash, agency_invitation_tokens, admin_actions).
-- Fase RED tarea 225: tests 21–24 (el RPC NO debe degradar a un admin a 'agent').
-- Ejecutar con: supabase test db
-- Corre como superusuario dentro de una transacción revertida.

begin;
select plan(24);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
-- El trigger handle_new_user (migración 0002) crea public.users al insertar en auth.users.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000a01', 'admin_test@urbea.mx'),
  ('00000000-0000-0000-0000-000000000a02', 'admin2_test@urbea.mx'),
  -- owner para los tests de 7.5 (a03 se usa en #10 y #13; ya tendrá membresía activa)
  ('00000000-0000-0000-0000-000000000a03', 'owner_test@urbea.mx'),
  -- owner fresco para el test de éxito de 7.6 (#15): no tiene membresía previa
  ('00000000-0000-0000-0000-000000000a04', 'owner2_test@urbea.mx'),
  -- 225: owner que YA es admin de plataforma y no tiene membresía previa.
  ('00000000-0000-0000-0000-000000000a05', 'admin_owner_test@urbea.mx');

-- 225: a05 nace 'user' por el trigger handle_new_user; lo subimos a admin ANTES
-- de la llamada para que el caso bajo prueba sea "un admin es asignado owner".
update public.users set role = 'admin'
 where id = '00000000-0000-0000-0000-000000000a05'::uuid;

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
-- La RPC levanta RAISE con errcode=P0001 y msg 'created_by_user_id es requerido'.
-- Usamos la forma de 4 args (sql, errcode, errmsg, description) para no ambigüedad:
-- throws_ok(sql, text) usa octet_length: si != 5 trata el 2do arg como errmsg a casar.
select throws_ok(
  $$ select public.admin_create_agency_atomic(
       'Agencia Sin Owner'::text,
       'agencia-sin-owner'::text,
       null::text,
       null::text,
       null::text,
       null::uuid) $$,
  'P0001',
  'created_by_user_id es requerido',
  'created_by_user_id NULL debe ser rechazado por la RPC'
);

-- ── 9) Firma unificada con DEFAULTs en los trailing params ──────────────────
-- La función única acepta: name, slug, contact_name, contact_phone, contact_email,
-- created_by_user_id, owner_user_id, token_hash, token_max_uses.
-- Llamadas con 6/7/9 args resuelven por defaults — no hay overload de 6/7/9 params.
-- 🔄 168.3 (20260816000001): la firma canónica creció de 9 a 11 params
-- (p_can_publish_properties, p_can_advertise, AL FINAL con DEFAULT) — mismo
-- patrón de evolución que ya documenta este archivo para 7.4→7.5→7.6 (la
-- firma "unificada" de esta prueba SIEMPRE trackea el shape vigente, no un
-- shape histórico; el comportamiento retrocompatible de la firma vieja de 9
-- params lo prueba supabase/tests/46_org_advertising_test.sql RETRO1).
-- 🔄 168.7 (20260816000004): la firma creció de 11 a 12 params
-- (p_advertiser_category, AL FINAL con DEFAULT null) — la RPC de alta ahora
-- puede sembrar la categoría de una org "solo-publicidad" sin la cual el
-- CHECK agencies_categoria_requerida_para_anunciar (20260816000003) rechaza
-- can_advertise=true.
select has_function(
  'public',
  'admin_create_agency_atomic',
  ARRAY['text', 'text', 'text', 'text', 'text', 'uuid', 'uuid', 'text', 'integer', 'boolean', 'boolean', 'advertiser_category'],
  'admin_create_agency_atomic firma unificada de 12 params (trailing 6 con DEFAULT, 168.7 agrega advertiser_category) debe existir'
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

-- ── 7.6 RED: token inicial de invitación + admin_actions ─────────────────────
-- La RPC aún NO acepta p_token_hash ni p_token_max_uses; todos estos tests fallan en RED.

-- ── 14) Firma extendida: incluye p_token_hash text y p_token_max_uses int ────
-- 🔄 168.3/168.7: mismo shape de 12 params que el test 9 (ver nota ahí).
select has_function(
  'public',
  'admin_create_agency_atomic',
  ARRAY['text', 'text', 'text', 'text', 'text', 'uuid', 'uuid', 'text', 'integer', 'boolean', 'boolean', 'advertiser_category'],
  'admin_create_agency_atomic debe aceptar p_token_hash, p_token_max_uses, (168.3) los params de capacidad y (168.7) advertiser_category'
);

-- ── 15) Llamada con 9 params y token_hash se ejecuta sin error ───────────────
-- Usa owner fresco a04 (sin membresía previa) para que la llamada sea un caso de éxito.
-- a03 ya tiene membresía activa desde test #10 → usarlo aquí levantaría ALREADY_ACTIVE_MEMBER.
-- Hash de prueba (64 chars hex válido): representa sha256('ABCD1234') en el test.
select lives_ok(
  $$ select public.admin_create_agency_atomic(
       'Agencia Con Token MX'::text,
       'agencia-con-token-mx'::text,
       null::text,
       null::text,
       null::text,
       '00000000-0000-0000-0000-000000000a01'::uuid,
       '00000000-0000-0000-0000-000000000a04'::uuid,
       'aabbccddeeff0011aabbccddeeff0011aabbccddeeff0011aabbccddeeff0011'::text,
       null::integer) $$,
  'admin_create_agency_atomic: llamada con 9 params y p_token_hash se ejecuta sin error'
);

-- ── 16) agency_invitation_tokens: fila con token = hash pasado (NOT el plano) ─
-- En RED, la llamada de test 15 falló → no hay fila → is(NULL, hash) falla.
select is(
  (select token
     from public.agency_invitation_tokens
    where token = 'aabbccddeeff0011aabbccddeeff0011aabbccddeeff0011aabbccddeeff0011'
    limit 1),
  'aabbccddeeff0011aabbccddeeff0011aabbccddeeff0011aabbccddeeff0011',
  'agency_invitation_tokens: token almacenado = el hash sha256 pasado (NOT el plano)'
);

-- ── 17) agency_invitation_tokens: created_by_user_id = admin ─────────────────
select is(
  (select created_by_user_id
     from public.agency_invitation_tokens
    where token = 'aabbccddeeff0011aabbccddeeff0011aabbccddeeff0011aabbccddeeff0011'
    limit 1),
  '00000000-0000-0000-0000-000000000a01'::uuid,
  'agency_invitation_tokens: created_by_user_id = admin que creó la agencia'
);

-- ── 18) agency_invitation_tokens: current_uses = 0 al crear ──────────────────
select is(
  (select current_uses
     from public.agency_invitation_tokens
    where token = 'aabbccddeeff0011aabbccddeeff0011aabbccddeeff0011aabbccddeeff0011'
    limit 1),
  0,
  'agency_invitation_tokens: current_uses = 0 al crear el token inicial'
);

-- ── 19) admin_actions: existe 1 fila con action_type=create_agency y token_id ──
-- La función unificada inserta admin_actions en cada llamada exitosa (tests #3, #10, #15…).
-- Filtramos por token_id not null para aislar la fila del test #15 (único con token).
select is(
  (select count(*)::integer
     from public.admin_actions
    where action_type = 'create_agency'
      and entity_type = 'agency'
      and admin_id = '00000000-0000-0000-0000-000000000a01'::uuid
      and (new_values->>'token_id') is not null),
  1,
  'admin_actions: existe exactamente 1 fila con token_id not null (la del test con p_token_hash)'
);

-- ── 20) admin_actions: new_values contiene token_id (not null) ────────────────
-- Mismo filtro que #19: aislamos la fila del test #15 (token_id not null).
select is(
  (select (new_values->>'token_id') is not null
     from public.admin_actions
    where action_type = 'create_agency'
      and entity_type = 'agency'
      and admin_id = '00000000-0000-0000-0000-000000000a01'::uuid
      and (new_values->>'token_id') is not null
    limit 1),
  true,
  'admin_actions: new_values contiene token_id (not null) tras crear agencia con token'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Tarea 225 — el RPC NO debe DEGRADAR a un administrador de plataforma.
--
-- 🔴 El bug: `update public.users set role = 'agent' ...` va SIN condicionar, así
-- que asignar a un admin como owner de una organización nueva lo baja a 'agent'
-- y le quita el panel de administrador. Ocurrió en PRODUCCIÓN el 2026-08-31 al
-- crear «Desarrolladora» (se restauró en la misma transacción).
--
-- La regla ya estaba decidida: la migración 20260805000010 añadió el guard
-- `case when role = 'admin' then role else 'agent' end` a los DOS triggers de
-- aprobación (handle_agency_status_change y handle_agent_application_status_change).
-- Este RPC se quedó fuera de aquel barrido — mismo patrón «una invariante en dos
-- capas y anclada en una sola» que dio 5 hallazgos en #220.
--
-- El test #12 (owner 'user' → 'agent') ya existe y es el caso PAREADO: sin él,
-- un "fix" que dejara el role SIEMPRE intacto pasaría los tests de aquí abajo.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 21) Crear la organización con un owner que ya es admin no truena ─────────
select lives_ok(
  $$ select public.admin_create_agency_atomic(
       'Desarrolladora Test MX'::text,
       'desarrolladora-test-mx'::text,
       null::text,
       null::text,
       null::text,
       '00000000-0000-0000-0000-000000000a05'::uuid,
       '00000000-0000-0000-0000-000000000a05'::uuid) $$,
  '225: crear organización asignando como owner a un admin se ejecuta sin error'
);

-- ── 22) 🔴 EL ASSERT DE LA TAREA: el admin SIGUE siendo admin ────────────────
select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000000a05'::uuid),
  'admin',
  '225: un admin asignado owner CONSERVA role=admin (el RPC no lo degrada a agent)'
);

-- ── 23) …pero agency_id SÍ se denormaliza igual ─────────────────────────────
-- La mitad sutil: un "fix" perezoso tipo `where id = p_owner_user_id and role <> 'admin'`
-- salvaría el role y se saltaría TAMBIÉN la denormalización, dejando al admin sin
-- organización — exactamente el fallo contra el que advierte el comentario de
-- 20260805000010 ("agency_id SÍ se denormaliza siempre; role solo se promueve").
select is(
  (select ag.name::text
     from public.users u join public.agencies ag on ag.id = u.agency_id
    where u.id = '00000000-0000-0000-0000-000000000a05'::uuid),
  'Desarrolladora Test MX',
  '225: agency_id del admin SÍ apunta a la organización nueva (la denormalización no se salta)'
);

-- ── 24) La membresía de owner se crea igual para un admin ───────────────────
select is(
  (select member_role::text
     from public.agency_members
    where user_id = '00000000-0000-0000-0000-000000000a05'::uuid
      and status = 'active'
    limit 1),
  'owner',
  '225: el admin queda como owner activo de la organización (ser admin no salta la membresía)'
);

select * from finish();
rollback;
