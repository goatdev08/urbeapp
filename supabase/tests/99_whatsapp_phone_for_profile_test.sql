-- Tests pgTAP (RED) — public.whatsapp_phone_for_profile(uuid) (tarea #255)
-- Ejecutar con: supabase test db supabase/tests/99_whatsapp_phone_for_profile_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de una
-- transacción revertida (no persiste).
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL HUECO (origen: tarea 250, PR #143 — ver task-master show 255)
--
-- El feed y el detalle ya deciden el botón de WhatsApp con `has_phone` (derivado,
-- vista agent_public_profiles) y resuelven el número server-side (contact-agent).
-- El perfil público (ProfileActions.tsx) sigue leyendo `users.phone` crudo, que
-- RLS oculta para cualquier publicador `role='admin'` visto por un no-admin (el
-- caso EXACTO de Vladimir en producción) → sin fila de users, sin teléfono, sin
-- botón. `contact-agent` exige `property_id` y el perfil no tiene propiedad ni
-- registra lead, así que esa EF no aplica aquí (decisión ya tomada, opción c).
--
-- SUT (AÚN NO EXISTE — GREEN, fuera de esta fase RED): una migración nueva que
-- cree `public.whatsapp_phone_for_profile(p_user_id uuid) returns text`,
-- SECURITY DEFINER, `set search_path = ''`, que devuelve `users.phone` SOLO si:
--   (1) el llamador está autenticado (auth.uid() no nulo);
--   (2) el destino existe con deleted_at is null;
--   (3) el destino tiene role in ('agent','admin');
--   (4) el destino tiene phone is not null.
-- Cualquier otro caso -> NULL. Nunca devuelve otra columna de `users`.
--
-- GRANTS (parte del contrato SEAM, no de la lógica de negocio bajo prueba):
--   revoke all from anon, public; grant execute to authenticated. Estos SÍ se
--   fijan ya en el stub transaccional de abajo (plomería declarativa) — el
--   guardian NO debe esperar que a1/a3/g fallen por esta razón: lo que SÍ debe
--   fallar en rojo es la LÓGICA de decisión de qué teléfono devolver (b-f),
--   stubeada para lanzar 'not_implemented' sin importar el caller ni el
--   destino. Ver la nota "Estrategia RED" más abajo.
--
-- ── Estrategia RED sin depender de "function does not exist" ─────────────────
-- El SUT no existe en ninguna migración todavía. Para que los asserts de
-- comportamiento (b-f) fallen POR ASERCIÓN/EXCEPCIÓN (no por "function does
-- not exist", que abortaría la transacción completa con un error genérico de
-- Postgres en vez de un mensaje diagnóstico) este archivo crea un STUB
-- transaccional de `public.whatsapp_phone_for_profile` (sección 0) que
-- SIEMPRE lanza 'not_implemented'. Vive DENTRO de esta transacción
-- (`begin; ... rollback;`, igual que `pg_temp.act_as`) — nunca persiste ni
-- toca supabase/migrations/; la migración GREEN real crea su propia versión
-- persistente que reemplaza a esta por completo. Cada aserción de
-- comportamiento envuelve la llamada en `lives_ok($$ do $do$ ... $do$; $$,
-- msg)` (mismo patrón que 34_lead_stats_rpc_test.sql) para que el `raise
-- exception` del stub se traduzca en un FAIL diagnóstico de pgTAP, sin abortar
-- el resto del archivo.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ─────────────────
-- SEAMS bajo prueba:
--   - Contrato de la RPC `public.whatsapp_phone_for_profile(uuid) -> text`,
--     ejercitado vía impersonación JWT (act_as), nunca leyendo `users.phone`
--     directo (canal lateral).
--   - Catálogo de grants (declarativo, no lógica): quién puede ejecutar la RPC.
--
-- Happy path:
--   a) has_function + grants: la RPC existe con la firma (uuid)->text;
--      anon NO tiene EXECUTE; authenticated SÍ.
--   b) publicador role='admin' con phone -> el llamador role='user' obtiene
--      el E.164 exacto (el caso de Vladimir en producción).
--   c) publicador role='agent' con phone -> también lo devuelve.
-- Ramas de reglas no obvias (derivadas del contrato fijado en el SEAM):
--   d) destino con has_phone=false (phone NULL) -> NULL.
--   e) destino role='user' (buscador) con phone -> NULL — los buscadores NO
--      exponen su número aunque lo tengan capturado.
--   f) destino borrado (deleted_at no nulo) -> NULL, aunque tenga phone y
--      role='agent'.
-- Boundary / error:
--   g) sin JWT (anon, sin grant) -> permiso denegado (42501) antes de
--      ejecutar el cuerpo — nunca obtiene el número.
--   h) role=authenticated (SÍ tiene EXECUTE) pero SIN request.jwt.claims
--      (auth.uid() is null) -> NULL. Cubre la rama defensiva
--      `if auth.uid() is null then return null` del cuerpo — g solo prueba
--      el bloqueo a nivel ACL de `anon`; un `authenticated` sin sesión
--      válida nunca pasa por ahí (post-guardian, #255).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(10);

-- ════════════════════════════════════════════════════════════════════════════
-- GREEN (tarea #255): el stub transaccional de la fase RED ya se quitó de
-- aquí. La función real vive en
-- supabase/migrations/20260905300002_whatsapp_phone_for_profile.sql (mismos
-- grants que fijaba el stub, ahora declarados ahí) y ya está aplicada al
-- momento de correr este archivo (las migraciones corren antes que los
-- tests). Los 10 asserts de abajo corren contra esa función real (el h,
-- post-guardian, se sumó tras el PASS inicial).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Impersonación (mismo patrón que 02/08/41/96_*) ──────────────────────────
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — prefijo '00000000-0000-0000-0255-...' (tarea #255, sin colisión
-- con otros archivos de test).
--   CALLER  buscador role='user', SIN teléfono propio, llama la RPC          : ...01
--   ADMIN   publicador role='admin' CON teléfono (el caso Vladimir)          : ...02
--   AGENT   publicador role='agent' CON teléfono                            : ...03
--   SINTEL  publicador role='agent' SIN teléfono (has_phone=false)          : ...04
--   USUARIO publicador role='user' CON teléfono (buscador con tel capturado): ...05
--   BORRADO publicador role='agent' CON teléfono pero deleted_at no nulo    : ...06
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0255-000000000001', 'caller.255@test.local'),
  ('00000000-0000-0000-0255-000000000002', 'admin.255@test.local'),
  ('00000000-0000-0000-0255-000000000003', 'agent.255@test.local'),
  ('00000000-0000-0000-0255-000000000004', 'sintel.255@test.local'),
  ('00000000-0000-0000-0255-000000000005', 'usuario.255@test.local'),
  ('00000000-0000-0000-0255-000000000006', 'borrado.255@test.local');

update public.users set role = 'user'
 where id = '00000000-0000-0000-0255-000000000001';  -- CALLER

update public.users
   set role = 'admin', is_verified_agent = true, phone = '+523312345678'
 where id = '00000000-0000-0000-0255-000000000002';  -- ADMIN (caso Vladimir)

update public.users
   set role = 'agent', is_verified_agent = true, phone = '+523322345678'
 where id = '00000000-0000-0000-0255-000000000003';  -- AGENT

update public.users
   set role = 'agent', is_verified_agent = true, phone = null
 where id = '00000000-0000-0000-0255-000000000004';  -- SINTEL (has_phone=false)

update public.users
   set role = 'user', phone = '+523332345678'
 where id = '00000000-0000-0000-0255-000000000005';  -- USUARIO (buscador con tel)

update public.users
   set role = 'agent', is_verified_agent = true, phone = '+523342345678',
       deleted_at = now()
 where id = '00000000-0000-0000-0255-000000000006';  -- BORRADO

-- ════════════════════════════════════════════════════════════════════════════
-- a) Catálogo + grants — firma existe; anon NO ejecuta, authenticated SÍ.
-- ════════════════════════════════════════════════════════════════════════════

select has_function(
  'public', 'whatsapp_phone_for_profile', array['uuid'],
  'a1) public.whatsapp_phone_for_profile(uuid) existe'
);

select is(
  coalesce(
    has_function_privilege('anon',
      to_regprocedure('public.whatsapp_phone_for_profile(uuid)')::oid, 'EXECUTE'),
    true),
  false,
  'a2) anon NO tiene EXECUTE sobre whatsapp_phone_for_profile'
);

select is(
  coalesce(
    has_function_privilege('authenticated',
      to_regprocedure('public.whatsapp_phone_for_profile(uuid)')::oid, 'EXECUTE'),
    false),
  true,
  'a3) authenticated SÍ tiene EXECUTE sobre whatsapp_phone_for_profile'
);

-- ════════════════════════════════════════════════════════════════════════════
-- b) Publicador role=admin CON teléfono -> el E.164 exacto (caso Vladimir).
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.act_as('00000000-0000-0000-0255-000000000001'); -- CALLER
select lives_ok(
  $$
  do $do$
  declare
    v_phone text;
  begin
    select public.whatsapp_phone_for_profile('00000000-0000-0000-0255-000000000002'::uuid)
      into v_phone;
    if v_phone is distinct from '+523312345678' then
      raise exception 'un role=user que llama sobre un publicador role=admin CON teléfono '
        'debía obtener EXACTAMENTE +523312345678; obtuvo %', coalesce(v_phone, '<NULL>');
    end if;
  end
  $do$;
  $$,
  'b_publicador_admin_con_telefono_devuelve_el_e164_exacto'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- c) Publicador role=agent CON teléfono -> también lo devuelve.
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.act_as('00000000-0000-0000-0255-000000000001'); -- CALLER
select lives_ok(
  $$
  do $do$
  declare
    v_phone text;
  begin
    select public.whatsapp_phone_for_profile('00000000-0000-0000-0255-000000000003'::uuid)
      into v_phone;
    if v_phone is distinct from '+523322345678' then
      raise exception 'un role=user que llama sobre un publicador role=agent CON teléfono '
        'debía obtener EXACTAMENTE +523322345678; obtuvo %', coalesce(v_phone, '<NULL>');
    end if;
  end
  $do$;
  $$,
  'c_publicador_agent_con_telefono_devuelve_el_e164_exacto'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- d) Destino con has_phone=false (phone NULL) -> NULL.
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.act_as('00000000-0000-0000-0255-000000000001'); -- CALLER
select lives_ok(
  $$
  do $do$
  declare
    v_phone text;
  begin
    select public.whatsapp_phone_for_profile('00000000-0000-0000-0255-000000000004'::uuid)
      into v_phone;
    if v_phone is not null then
      raise exception 'un publicador agent SIN teléfono (has_phone=false) debía devolver '
        'NULL; obtuvo %', v_phone;
    end if;
  end
  $do$;
  $$,
  'd_destino_sin_telefono_devuelve_null'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- e) Destino role=user (buscador) CON teléfono -> NULL. Los buscadores NO
--    exponen su número aunque lo tengan capturado en el registro.
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.act_as('00000000-0000-0000-0255-000000000001'); -- CALLER
select lives_ok(
  $$
  do $do$
  declare
    v_phone text;
  begin
    select public.whatsapp_phone_for_profile('00000000-0000-0000-0255-000000000005'::uuid)
      into v_phone;
    if v_phone is not null then
      raise exception 'un destino role=user (buscador) NUNCA debe exponer su teléfono, '
        'aunque lo tenga capturado; obtuvo %', v_phone;
    end if;
  end
  $do$;
  $$,
  'e_destino_role_user_nunca_expone_su_telefono'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- f) Destino borrado (deleted_at no nulo) -> NULL, aunque tenga phone y
--    role='agent'.
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.act_as('00000000-0000-0000-0255-000000000001'); -- CALLER
select lives_ok(
  $$
  do $do$
  declare
    v_phone text;
  begin
    select public.whatsapp_phone_for_profile('00000000-0000-0000-0255-000000000006'::uuid)
      into v_phone;
    if v_phone is not null then
      raise exception 'un publicador BORRADO (deleted_at no nulo) NUNCA debe devolver su '
        'teléfono, aunque tenga phone y role=agent; obtuvo %', v_phone;
    end if;
  end
  $do$;
  $$,
  'f_destino_borrado_devuelve_null'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- g) Sin JWT (anon, sin grant) -> permiso denegado (42501) antes de ejecutar
--    el cuerpo. Nunca obtiene el número.
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select public.whatsapp_phone_for_profile('00000000-0000-0000-0255-000000000002'::uuid) $$,
  '42501',
  null,
  'g_anon_sin_grant_recibe_permiso_denegado_nunca_obtiene_el_numero'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- h) role=authenticated (SÍ tiene EXECUTE), pero SIN request.jwt.claims —
--    auth.uid() resuelve NULL -> la rama defensiva del cuerpo debe devolver
--    NULL (no truena, no cae a ninguna otra rama). A diferencia de g (anon,
--    bloqueado por el REVOKE antes de ejecutar el cuerpo), aquí el rol SÍ
--    puede ejecutar la función — lo que se prueba es que el CUERPO se
--    defiende solo, sin depender del ACL, cuando el caller no trae una
--    sesión válida. `reset request.jwt.claims` limpia cualquier residuo de
--    los `pg_temp.act_as(...)` anteriores (nunca confiar en que quedó vacío).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
reset request.jwt.claims;
select lives_ok(
  $$
  do $do$
  declare
    v_phone text;
  begin
    select public.whatsapp_phone_for_profile('00000000-0000-0000-0255-000000000002'::uuid)
      into v_phone;
    if v_phone is not null then
      raise exception 'un caller authenticated SIN request.jwt.claims (auth.uid() '
        'is null) debía obtener NULL; obtuvo %', v_phone;
    end if;
  end
  $do$;
  $$,
  'h_authenticated_sin_jwt_claims_devuelve_null'
);
reset role;

select * from finish();
rollback;
