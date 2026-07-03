-- Tests pgTAP — RLS: identidad del BUSCADOR de un lead se lee desde public.users
-- SUT: helper private.can_view_user_as_lead_searcher(uuid) (aún no existe) +
--      nueva cláusula en la política users_select que lo use.
-- Subtarea 30.1 — FASE RED
-- Ejecutar con: supabase test db
-- Corre como superusuario dentro de una transacción revertida (no persiste).
--
-- Decisión de diseño (30): la identidad del buscador (first_name, last_name,
-- avatar_url, phone) se lee de public.users, NUNCA de user_preferences. Este
-- archivo cubre EXCLUSIVAMENTE la política users_select. NO toca
-- user_preferences (fuera de alcance de esta tarea).
--
-- Regla nueva esperada (GREEN, migración futura):
--   users_select gana la cláusula `or private.can_view_user_as_lead_searcher(id)`
--   donde can_view_user_as_lead_searcher(p_user_id) = existe un lead ACTIVO
--   (deleted_at is null) con leads.user_id = p_user_id y
--   (leads.agent_id = auth.uid() or private.is_agency_owner_of(leads.agent_id)).

begin;
select plan(12);

-- ── UUIDs de fixtures (prefijo 08, hex válido, sin colisión con tests 01–07) ──
--   O1 owner agencia   : 000...8001
--   G1 agente (con lead): 000...8002
--   G2 agente (sin lead a S1): 000...8003
--   S1 buscador (con lead activo hacia G1): 000...8004
--   U1 usuario regular cualquiera (sin lead): 000...8005
--   AD admin            : 000...8006

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000008001', 'o1.searcher@test.local'),
  ('00000000-0000-0000-0000-000000008002', 'g1.searcher@test.local'),
  ('00000000-0000-0000-0000-000000008003', 'g2.searcher@test.local'),
  ('00000000-0000-0000-0000-000000008004', 's1.searcher@test.local'),
  ('00000000-0000-0000-0000-000000008005', 'u1.searcher@test.local'),
  ('00000000-0000-0000-0000-000000008006', 'ad.searcher@test.local');

-- S1 es el buscador: identidad de contacto que el agente/owner necesitan leer.
update public.users set
    first_name = 'Sofia',
    last_name  = 'Buscadora',
    phone      = '+52 33 1234 5678',
    avatar_url = 'https://cdn.test.local/s1.jpg'
  where id = '00000000-0000-0000-0000-000000008004';

update public.users set role = 'agent', is_verified_agent = false
  where id in ('00000000-0000-0000-0000-000000008002', '00000000-0000-0000-0000-000000008003');
update public.users set role = 'admin'
  where id = '00000000-0000-0000-0000-000000008006';

-- Agencia con O1 como owner y G1/G2 como agentes activos.
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-0000000080e1', 'Inmobiliaria Buscador', 'inmo-buscador', 'active', '00000000-0000-0000-0000-000000008001');
insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-0000000080e1', '00000000-0000-0000-0000-000000008001', 'owner', 'active'),
  ('00000000-0000-0000-0000-0000000080e1', '00000000-0000-0000-0000-000000008002', 'agent', 'active'),
  ('00000000-0000-0000-0000-0000000080e1', '00000000-0000-0000-0000-000000008003', 'agent', 'active');
update public.users set agency_id = '00000000-0000-0000-0000-0000000080e1'
  where id in ('00000000-0000-0000-0000-000000008001', '00000000-0000-0000-0000-000000008002', '00000000-0000-0000-0000-000000008003');

-- Lead ACTIVO: S1 contactó a G1 (deleted_at is null).
insert into public.leads (id, agent_id, user_id, deleted_at) values
  ('00000000-0000-0000-0000-0000000080f1', '00000000-0000-0000-0000-000000008002', '00000000-0000-0000-0000-000000008004', null);

-- Helper de impersonación inline (mismo patrón que 02_rls_test.sql).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ── Asserts ─────────────────────────────────────────────────────────────────

-- 1) (+) El AGENTE G1 (dueño del lead) lee la fila de identidad del buscador S1.
-- RED: falla porque el helper/cláusula no existen → users_select no otorga acceso.
select pg_temp.act_as('00000000-0000-0000-0000-000000008002');
select is(
  (select count(*)::int from public.users where id = '00000000-0000-0000-0000-000000008004'),
  1,
  'agente_con_lead_activo_lee_fila_users_del_buscador'
);
reset role;

-- 2) (+) Ese mismo SELECT expone first_name/last_name/phone/avatar_url legibles.
-- RED: falla porque no hay fila visible (count previo=0 ⇒ concat da NULL, no coincide).
select pg_temp.act_as('00000000-0000-0000-0000-000000008002');
select is(
  (select first_name || '|' || last_name || '|' || phone || '|' || avatar_url
     from public.users where id = '00000000-0000-0000-0000-000000008004'),
  'Sofia|Buscadora|+52 33 1234 5678|https://cdn.test.local/s1.jpg',
  'agente_con_lead_activo_lee_datos_de_contacto_del_buscador'
);
reset role;

-- 3) (+) El OWNER de la agencia de G1 también lee la identidad del buscador S1.
-- RED: falla, is_agency_owner_of(G1) es true pero la cláusula nueva no existe.
select pg_temp.act_as('00000000-0000-0000-0000-000000008001');
select is(
  (select count(*)::int from public.users where id = '00000000-0000-0000-0000-000000008004'),
  1,
  'owner_de_agencia_del_agente_lee_fila_users_del_buscador'
);
reset role;

-- 4) (-) G2 (otro agente de la MISMA agencia, sin lead con S1) NO lo ve.
select pg_temp.act_as('00000000-0000-0000-0000-000000008003');
select is(
  (select count(*)::int from public.users where id = '00000000-0000-0000-0000-000000008004'),
  0,
  'agente_sin_lead_con_ese_buscador_no_lo_ve'
);
reset role;

-- 5) (-) Un usuario regular cualquiera (no agente, sin lead) no ve el perfil de S1.
select pg_temp.act_as('00000000-0000-0000-0000-000000008005');
select is(
  (select count(*)::int from public.users where id = '00000000-0000-0000-0000-000000008004'),
  0,
  'usuario_regular_ajeno_no_ve_perfil_del_buscador'
);
reset role;

-- 6) (-) Lead soft-deleted: el acceso a la identidad del buscador se revoca.
update public.leads set deleted_at = now()
  where id = '00000000-0000-0000-0000-0000000080f1';
select pg_temp.act_as('00000000-0000-0000-0000-000000008002');
select is(
  (select count(*)::int from public.users where id = '00000000-0000-0000-0000-000000008004'),
  0,
  'lead_soft_deleted_revoca_acceso_a_identidad_del_buscador'
);
reset role;

-- Restaurar el lead a activo para los casos restantes.
update public.leads set deleted_at = null
  where id = '00000000-0000-0000-0000-0000000080f1';

-- 7) (=) El admin sigue leyendo cualquier fila de users (comportamiento existente).
select pg_temp.act_as('00000000-0000-0000-0000-000000008006');
select is(
  (select count(*)::int from public.users where id = '00000000-0000-0000-0000-000000008004'),
  1,
  'admin_lee_cualquier_fila_de_users'
);
reset role;

-- 8) (=) El agente G1 sigue leyendo su propia fila (id = auth.uid()).
select pg_temp.act_as('00000000-0000-0000-0000-000000008002');
select is(
  (select count(*)::int from public.users where id = '00000000-0000-0000-0000-000000008002'),
  1,
  'agente_lee_su_propia_fila'
);
reset role;

-- 9) (=) El propio buscador S1 sigue leyendo su propia fila (id = auth.uid()).
select pg_temp.act_as('00000000-0000-0000-0000-000000008004');
select is(
  (select count(*)::int from public.users where id = '00000000-0000-0000-0000-000000008004'),
  1,
  'buscador_lee_su_propia_fila'
);
reset role;

-- 10) (=) El perfil de un agente VERIFICADO sigue siendo públicamente legible
--     (cláusula existente: role='agent' and deleted_at is null and is_verified_agent=true).
update public.users set is_verified_agent = true
  where id = '00000000-0000-0000-0000-000000008002';
select pg_temp.act_as('00000000-0000-0000-0000-000000008005');
select is(
  (select count(*)::int from public.users where id = '00000000-0000-0000-0000-000000008002'),
  1,
  'perfil_de_agente_verificado_sigue_publicamente_legible'
);
reset role;

-- 11) (-) ...pero un agente NO verificado sigue sin ser visible para un extraño sin lead.
select pg_temp.act_as('00000000-0000-0000-0000-000000008005');
select is(
  (select count(*)::int from public.users where id = '00000000-0000-0000-0000-000000008003'),
  0,
  'agente_no_verificado_sin_lead_no_es_visible_para_extraño'
);
reset role;

-- 12) (+) Boundary: reactivar el lead (deleted_at=null, ya restaurado tras el
--     caso 6) devuelve el acceso a G1 — confirma que la cláusula reacciona al
--     estado actual de deleted_at y no queda "pegada" en el resultado del caso 6.
-- RED: falla igual que el caso 1 (el helper/cláusula no existen).
select pg_temp.act_as('00000000-0000-0000-0000-000000008002');
select is(
  (select count(*)::int from public.users where id = '00000000-0000-0000-0000-000000008004'),
  1,
  'reactivar_lead_restaura_acceso_a_identidad_del_buscador'
);
reset role;

select * from finish();
rollback;
