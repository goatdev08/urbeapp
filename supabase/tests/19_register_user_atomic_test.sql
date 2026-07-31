-- Tests pgTAP — RPC register_user_atomic (espejo de redeem_invitation_atomic), subtarea 93.1
-- Ejecutar con: supabase test db
--   Gotcha de este entorno: si la CLI se cuelga pidiendo el Keychain, exportar
--   SUPABASE_ACCESS_TOKEN con un valor dummy (40 ceros tras el prefijo estándar de
--   token de Supabase) antes del comando. NO se escribe el literal aquí: el escáner
--   de secretos de GitHub reconoce ese prefijo y bloquea el push aunque el valor sea
--   obviamente falso.
-- Corre como superusuario dentro de una transacción revertida. Impersonamos roles con
-- pg_temp.act_as(uid, role) (mismo patrón que 02_rls_test.sql / 16_mx_catalog_test.sql /
-- 17_registro_constraints_test.sql / 18_legal_gate_test.sql).
--
-- RED (2026-07-29): public.register_user_atomic AÚN NO EXISTE. La migración GREEN
-- (supabase/migrations/20260729000001_register_user_atomic_rpc.sql, fuera de esta subtarea
-- de tests) debe crear:
--   register_user_atomic(p_user_id uuid, p_ip inet default null) returns void
--   security definer, set search_path fijo. Verifica que public.users.{phone, date_of_birth,
--   state_id, municipality_id} de p_user_id no son NULL (si alguno lo es -> P0001
--   FIELDS_INCOMPLETE) e inserta atómicamente 4 filas en public.user_consents (terms/privacy
--   con el terms_version_id vigente de su doc_type -- P0001 NO_ACTIVE_TERMS / NO_ACTIVE_PRIVACY
--   si no hay vigente -- y age/whatsapp con terms_version_id NULL, todas con p_ip). revoke all
--   from public/anon/authenticated; grant execute a service_role.
--
-- ── Contrato para "usuario inexistente en public.users" (elegido en esta fase RED) ──
-- redeem_invitation_atomic distingue USER_NOT_FOUND como excepción propia porque ahí el
-- usuario YA existe (se registró antes) y lo que falla es el UPDATE de denormalización
-- ("if not found" tras el UPDATE). register_user_atomic es distinto: NO hace ningún UPDATE
-- sobre public.users, solo LEE sus columnas. Un SELECT ... INTO v_phone, v_dob, ... FROM
-- public.users WHERE id = p_user_id sobre una fila que no existe dejará las 4 variables en
-- NULL exactamente igual que un usuario que sí existe pero con esos campos vacíos -- son
-- indistinguibles con una sola query, y no vale la pena una segunda query solo para dar un
-- mensaje de error distinto a un caso que en la práctica no debería ocurrir nunca (la EF
-- 93.2 llama a esta RPC inmediatamente después de auth.admin.createUser). Por eso el
-- contrato elegido es: usuario inexistente -> P0001 FIELDS_INCOMPLETE (test #20 abajo).
--
-- ── Contrato para "llamada duplicada" (elegido en esta fase RED) ────────────────────
-- public.user_consents NO tiene ningún unique/exclusion constraint sobre (user_id,
-- consent_type) -- ver migración 20260604000004_user_profile_legal.sql: solo hay índices
-- NO únicos (user_consents_user_idx, user_consents_version_idx). El historial es
-- append-only por diseño (confirmado en 18_legal_gate_test.sql #19/#21: re-aceptar una
-- versión de términos AGREGA una fila, no la reemplaza). register_user_atomic no agrega
-- ninguna barrera propia sobre esto: una segunda llamada para el mismo usuario NO lanza y
-- deja 8 filas totales (2x4). La idempotencia (llamar esta RPC una sola vez por registro)
-- es responsabilidad de la Edge Function 93.2, no de esta RPC -- documentado y verificado
-- en los tests #13-14 abajo, para que un futuro cambio de este comportamiento sea
-- deliberado y no un accidente silencioso.

begin;
select plan(24);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — usuarios (el trigger handle_new_user, migración 0002, crea public.users
-- vacío en phone/date_of_birth/state_id/municipality_id; completamos por UPDATE)
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000009301', 'reg_completo@test.local'),      -- happy path + duplicado
  ('00000000-0000-0000-0000-000000009302', 'reg_sin_phone@test.local'),     -- FIELDS_INCOMPLETE: phone NULL
  ('00000000-0000-0000-0000-000000009303', 'reg_sin_dob@test.local'),       -- FIELDS_INCOMPLETE: date_of_birth NULL
  ('00000000-0000-0000-0000-000000009304', 'reg_sin_state@test.local'),     -- FIELDS_INCOMPLETE: state_id NULL
  ('00000000-0000-0000-0000-000000009305', 'reg_sin_muni@test.local'),      -- FIELDS_INCOMPLETE: municipality_id NULL
  ('00000000-0000-0000-0000-000000009306', 'reg_sin_terms@test.local'),     -- NO_ACTIVE_TERMS (perfil completo)
  ('00000000-0000-0000-0000-000000009307', 'reg_sin_privacy@test.local');   -- NO_ACTIVE_PRIVACY (perfil completo)
-- '...9399' NUNCA se inserta en auth.users ni public.users: es el caso "usuario inexistente".

update public.users set phone = '+525511119301', date_of_birth = '1990-01-01', state_id = '14', municipality_id = '14039'
 where id = '00000000-0000-0000-0000-000000009301';
update public.users set date_of_birth = '1990-01-01', state_id = '14', municipality_id = '14039'
 where id = '00000000-0000-0000-0000-000000009302'; -- phone se queda NULL
update public.users set phone = '+525511119303', state_id = '14', municipality_id = '14039'
 where id = '00000000-0000-0000-0000-000000009303'; -- date_of_birth se queda NULL
update public.users set phone = '+525511119304', date_of_birth = '1990-01-01', municipality_id = '14039'
 where id = '00000000-0000-0000-0000-000000009304'; -- state_id se queda NULL
update public.users set phone = '+525511119305', date_of_birth = '1990-01-01', state_id = '14'
 where id = '00000000-0000-0000-0000-000000009305'; -- municipality_id se queda NULL
update public.users set phone = '+525511119306', date_of_birth = '1990-01-01', state_id = '14', municipality_id = '14039'
 where id = '00000000-0000-0000-0000-000000009306';
update public.users set phone = '+525511119307', date_of_birth = '1990-01-01', state_id = '14', municipality_id = '14039'
 where id = '00000000-0000-0000-0000-000000009307';

-- ════════════════════════════════════════════════════════════════════════════
-- 1-2) La RPC existe con la firma esperada, SECURITY DEFINER (metadata pura sobre
--      pg_proc: segura aunque la función no exista todavía -- solo faltará al
--      catálogo, no lanza)
-- ════════════════════════════════════════════════════════════════════════════

select has_function(
  'public',
  'register_user_atomic',
  ARRAY['uuid', 'inet'],
  'register_user_atomic(uuid, inet) debe existir en el schema public'
);
select is(
  (select prosecdef from pg_proc join pg_namespace ns on pg_proc.pronamespace = ns.oid
    where ns.nspname = 'public' and pg_proc.proname = 'register_user_atomic' limit 1),
  true,
  'register_user_atomic debe ser SECURITY DEFINER'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3-4) Grants defensivos: solo service_role puede ejecutar
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select public.register_user_atomic('00000000-0000-0000-0000-000000009301'::uuid) $$,
  '42501', null,
  'anon no puede ejecutar register_user_atomic'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000009301', 'authenticated');
select throws_ok(
  $$ select public.register_user_atomic('00000000-0000-0000-0000-000000009301'::uuid) $$,
  '42501', null,
  'authenticated no puede ejecutar register_user_atomic (ni siquiera para su propio user_id)'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5-12) Happy path (ejecutado como service_role): perfil completo -> 4
--       consentimientos correctos, ip registrada, perfil no tocado
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select lives_ok(
  $$ select public.register_user_atomic(
       '00000000-0000-0000-0000-000000009301'::uuid, '201.123.45.67'::inet) $$,
  'register_user_atomic: perfil completo con terms/privacy vigentes se ejecuta sin error'
);
reset role;

select is(
  (select count(*)::int from public.user_consents
    where user_id = '00000000-0000-0000-0000-000000009301'),
  4,
  'user_consents: exactamente 4 registros (terms, privacy, age, whatsapp)'
);
select is(
  (select terms_version_id from public.user_consents
    where user_id = '00000000-0000-0000-0000-000000009301' and consent_type = 'terms'),
  (select id from public.terms_versions where doc_type = 'terms' and is_current),
  'consent terms -> terms_version_id vigente'
);
select is(
  (select terms_version_id from public.user_consents
    where user_id = '00000000-0000-0000-0000-000000009301' and consent_type = 'privacy'),
  (select id from public.terms_versions where doc_type = 'privacy' and is_current),
  'consent privacy -> terms_version_id vigente'
);
select ok(
  (select terms_version_id is null from public.user_consents
    where user_id = '00000000-0000-0000-0000-000000009301' and consent_type = 'age'),
  'consent age -> terms_version_id NULL'
);
select ok(
  (select terms_version_id is null from public.user_consents
    where user_id = '00000000-0000-0000-0000-000000009301' and consent_type = 'whatsapp'),
  'consent whatsapp -> terms_version_id NULL'
);
select is(
  (select count(*)::int from public.user_consents
    where user_id = '00000000-0000-0000-0000-000000009301' and ip_address = '201.123.45.67'::inet),
  4,
  'las 4 filas de user_consents registran la ip_address recibida (p_ip)'
);
select is(
  (select phone from public.users where id = '00000000-0000-0000-0000-000000009301'),
  '+525511119301',
  'register_user_atomic NO toca el perfil: users.phone permanece sin cambios tras la llamada'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 13-14) Llamada duplicada para el mismo usuario: no hay unique constraint en
--        user_consents(user_id, consent_type) -> no lanza, y el historial acumula
--        (contrato documentado arriba; idempotencia es responsabilidad de la EF 93.2)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select lives_ok(
  $$ select public.register_user_atomic(
       '00000000-0000-0000-0000-000000009301'::uuid, '201.123.45.67'::inet) $$,
  'una segunda llamada para el mismo usuario no lanza (sin unique constraint en user_consents)'
);
reset role;

select is(
  (select count(*)::int from public.user_consents
    where user_id = '00000000-0000-0000-0000-000000009301'),
  8,
  'tras la doble llamada hay 8 filas totales para el usuario (append-only, no upsert)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 15-20) FIELDS_INCOMPLETE: cualquier campo de §5.1 en NULL bloquea el registro,
--        atómicamente (cero filas insertadas), incluido el usuario inexistente
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.register_user_atomic('00000000-0000-0000-0000-000000009302'::uuid) $$,
  'P0001', 'FIELDS_INCOMPLETE',
  'phone NULL (resto del perfil completo) -> P0001 FIELDS_INCOMPLETE'
);
reset role;

select is(
  (select count(*)::int from public.user_consents
    where user_id = '00000000-0000-0000-0000-000000009302'),
  0,
  'atomicidad: cero filas de user_consents tras el intento fallido por phone NULL'
);

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.register_user_atomic('00000000-0000-0000-0000-000000009303'::uuid) $$,
  'P0001', 'FIELDS_INCOMPLETE',
  'date_of_birth NULL (resto del perfil completo) -> P0001 FIELDS_INCOMPLETE'
);
reset role;

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.register_user_atomic('00000000-0000-0000-0000-000000009304'::uuid) $$,
  'P0001', 'FIELDS_INCOMPLETE',
  'state_id NULL (resto del perfil completo) -> P0001 FIELDS_INCOMPLETE'
);
reset role;

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.register_user_atomic('00000000-0000-0000-0000-000000009305'::uuid) $$,
  'P0001', 'FIELDS_INCOMPLETE',
  'municipality_id NULL (resto del perfil completo) -> P0001 FIELDS_INCOMPLETE'
);
reset role;

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.register_user_atomic('00000000-0000-0000-0000-000000009399'::uuid) $$,
  'P0001', 'FIELDS_INCOMPLETE',
  'usuario inexistente en public.users -> P0001 FIELDS_INCOMPLETE (contrato documentado arriba)'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 21-24) Sin versión vigente de terms/privacy: NO_ACTIVE_TERMS / NO_ACTIVE_PRIVACY,
--        también atómico. Se apaga is_current temporalmente y se restaura después
--        de cada caso -- el resto de la suite (y los tests anteriores de este mismo
--        archivo) depende de que ambos documentos sigan vigentes al terminar.
-- ════════════════════════════════════════════════════════════════════════════

update public.terms_versions set is_current = false where doc_type = 'terms' and is_current = true;

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.register_user_atomic('00000000-0000-0000-0000-000000009306'::uuid) $$,
  'P0001', 'NO_ACTIVE_TERMS',
  'perfil completo pero sin versión vigente de terms -> P0001 NO_ACTIVE_TERMS'
);
reset role;

select is(
  (select count(*)::int from public.user_consents
    where user_id = '00000000-0000-0000-0000-000000009306'),
  0,
  'atomicidad: cero filas de user_consents tras NO_ACTIVE_TERMS'
);

update public.terms_versions set is_current = true where doc_type = 'terms' and version = '1.0';
update public.terms_versions set is_current = false where doc_type = 'privacy' and is_current = true;

select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.register_user_atomic('00000000-0000-0000-0000-000000009307'::uuid) $$,
  'P0001', 'NO_ACTIVE_PRIVACY',
  'perfil completo, terms vigente pero sin versión vigente de privacy -> P0001 NO_ACTIVE_PRIVACY'
);
reset role;

select is(
  (select count(*)::int from public.user_consents
    where user_id = '00000000-0000-0000-0000-000000009307'),
  0,
  'atomicidad: cero filas de user_consents tras NO_ACTIVE_PRIVACY'
);

update public.terms_versions set is_current = true where doc_type = 'privacy' and version = '1.0';

select * from finish();
rollback;
