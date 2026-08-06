-- Tests pgTAP — Aprobaciones admin vía estado (subtarea 71.5, PRD §4.7/§4.8)
-- Ejecutar con: supabase test db
-- Corre como superusuario dentro de una transacción revertida (no persiste).
-- Impersonamos con pg_temp.act_as(uid, role) (mismo patrón que 02/19/21/22/23/24_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SUT (AÚN NO EXISTE): dos TRIGGERS BEFORE UPDATE (uno en public.agencies, otro
-- en public.agent_applications) que validan la máquina de estados y registran
-- auditoría en public.admin_actions. NO hay Edge Functions en esta subtarea: el
-- super-admin de beta hace el UPDATE directo en Supabase Studio/SQL. Como Studio
-- corre como `postgres` (bypassea RLS), la seguridad y la máquina de estados
-- viven en el TRIGGER, que corre SIEMPRE sin importar el rol.
--
-- Hoy (RED) NO existe ningún trigger sobre agencies/agent_applications que toque
-- `status`: cualquier UPDATE que la RLS deje pasar simplemente se ejecuta sin
-- validar la transición ni generar auditoría. Por eso la mayoría de los asserts
-- de este archivo fallan por ASERCIÓN (no por función/módulo inexistente): la
-- fila cambia cuando no debería, o el admin_actions esperado no aparece.
--
-- ── Convención DELTA vs INVARIANTE (heredada de 21_agency_member_role_matrix) ──
-- DELTA      = falla hoy, pasa tras GREEN (discrimina la implementación).
-- INVARIANTE = ya se cumple hoy (documenta comportamiento real que NO debe
--              regresionar) — marcado explícito en el comentario de cada bloque.
-- Los no-ops (§7/§14) y la RLS de agent_applications (§8) son INVARIANTE: hoy,
-- sin trigger, un UPDATE que no cambia `status` o que la RLS ya bloquea no deja
-- rastro — eso coincide por casualidad con el comportamiento final esperado.
--
-- ════════════════════════════════════════════════════════════════════════════
-- DECISIONES DE SEAM (tomadas aquí, con el hallazgo del schema que las respalda)
-- ════════════════════════════════════════════════════════════════════════════
--
-- (D1) Target de "aprobar" una agencia = status 'active' (NO 'approved', pese a
--   que el título de la tarea diga informalmente "pending→approved"). Evidencia
--   decisiva: `upgrade_to_agent_atomic` (20260805000004) exige
--   `v_agency_status <> 'active'` para permitir canjear un token de invitación
--   de esa agencia — si "aprobar" pusiera 'approved', una agencia autoregistrada
--   y aprobada NUNCA podría operar (nunca aceptaría agentes), contradiciendo el
--   PRD §4.7 ("...antes de que la inmobiliaria pueda operar"). El valor de enum
--   'approved' (agency_status, migración 0001) queda SIN transición alcanzable
--   por este trigger — es letra muerta hoy (la RLS `agencies_select`, 0010:183,
--   ya lo trataba como visible junto con 'active', probablemente por-si-acaso).
--   Se verifica explícitamente en §2 (test: pending_approval->'approved' está
--   BLOQUEADO -> fija esta decisión para que un futuro GREEN no la reabra).
--
-- (D2) Máquina de estados de `agencies` implementada = SOLO
--   {pending_approval->active, pending_approval->rejected}. Cualquier otra
--   transición (incluida active->suspended, suspended->*, rejected->*,
--   active->pending_approval, *->'approved') es INVÁLIDA en esta migración.
--   'suspended' queda de moderación futura (fuera de alcance: la lista de edge
--   cases de la subtarea nunca pide que sea alcanzable, solo que NO lo sea desde
--   pending_approval).
--
-- (D3) "Solo admin transiciona" — CORRECCIÓN vs la premisa inicial del
--   orquestador (RLS `agencies_update`: `using (manages_agency(id) or
--   is_admin())` sí deja pasar al owner por RLS): el hallazgo real y más fuerte
--   está en los GRANTS de columna, NO en RLS. Migración 20260604000008 (líneas
--   409-412) YA hace:
--     revoke update on public.agencies from authenticated;
--     grant update (name, slug, logo_url, contact_name, contact_phone,
--                    contact_email, deleted_at) on public.agencies to authenticated;
--   `status`, `created_by_user_id`, `approved_by_admin_id` NO están en esa lista
--   blanca -> CUALQUIER UPDATE que toque `agencies.status` vía `authenticated`
--   (dueño O admin real, JWT vía PostgREST) truena 42501 ANTES de llegar a RLS
--   o a cualquier trigger (verificado empíricamente: probar con un admin real
--   autenticado también truena 42501 — test §1.4). Esto es la confirmación
--   ESTRUCTURAL, no solo de producto, de "el super-admin actúa por Studio en
--   beta": Studio conecta como `postgres` (superusuario), exento de GRANT/
--   REVOKE y de RLS. Por eso el trigger SOLO necesita resolver/exigir un admin
--   identificado para el contexto Studio (auth.uid() NULL, ver D4) — no hace
--   falta duplicar el check de actor para `authenticated` en `agencies` (ya
--   bloqueado, INVARIANTE por el GRANT, tests §1.1/§1.4). Por eso TODOS los
--   UPDATE de `agencies.status` en este archivo (§2-§7) se ejecutan vía
--   pg_temp.act_as_studio(...), el único camino real.
--   `agent_applications` NO tiene esa restricción de columna (hereda el GRANT
--   completo de `all tables in schema public to authenticated`, 0008:396) — ahí
--   SÍ funciona el camino admin-vía-JWT (RLS `using (private.is_admin())`,
--   0010:373, es la única reja) y se usa normalmente en §10-§14; el trigger
--   igual necesita el check de actor para el caso Studio-sin-identificar (§9).
--
-- (D4) Resolución del actor para Studio/postgres (auth.uid() NULL) vs JWT admin:
--   coalesce(auth.uid() si es admin, GUC de sesión `urbea.admin_actor_id` si
--   corresponde a un admin real). Se fija como GUC explícito (NO "el admin más
--   antiguo de la tabla") porque el seed demo YA siembra admins (swacg08+admin@,
--   ver memoria del proyecto) — cualquier heurística "primer admin" sería no
--   determinista/dependiente del seed. Convención Studio: el operador corre
--   `select set_config('urbea.admin_actor_id', '<su-user-id>', true);` antes del
--   UPDATE. Sin JWT admin y sin GUC válido -> STATUS_CHANGE_REQUIRES_ADMIN (§1).
--   Simulado aquí con pg_temp.act_as_studio(p_admin_uuid default null).
--
-- (D5) Efectos de aprobar AGENCIA (pending_approval->active): INSERT
--   agency_members(owner,active) para created_by_user_id + UPDATE users SET
--   role='agent', agency_id=<nueva> (idempotente si el creador YA es 'agent',
--   p.ej. independiente aprobado antes — test §6). Si el creador YA tiene una
--   membresía ACTIVA en OTRA agencia, el índice único
--   agency_members_one_active_per_user truena -> se remapea a P0001
--   ALREADY_ACTIVE_MEMBER (mismo código que admin_create_agency_atomic) y TODA
--   la transacción del UPDATE aborta (status NO cambia) — test §5.
--
-- (D6) Rechazo de AGENCIA: solo status (+ auditoría). `approved_by_admin_id` NO
--   se setea al rechazar (el nombre de la columna es literalmente "aprobado
--   por" — test §4).
--
-- (D7) Máquina de `agent_applications` implementada = SOLO
--   {pending->approved, pending->rejected}; approved/rejected son finales
--   (cualquier transición desde ahí = INVALID_STATUS_TRANSITION, test §13).
--   Rechazar EXIGE `rejection_reason` no NULL en el mismo UPDATE (columna ya
--   existe desde 0003) -> si falta, REJECTION_REASON_REQUIRED (test §10). Ojo:
--   `reason` (columna de 71.3, migración 20260805000005) es el motivo del
--   SOLICITANTE al aplicar — NO se toca ni se exige aquí, son columnas
--   distintas.
--
-- (D8) Efectos de aprobar APPLICATION: SOLO application_type='independent'
--   promueve users.role='agent' (agency_id se deja como esté — el schema
--   `users.agency_id` no tiene NOT NULL ni CHECK que lo ate a `role`, verificado
--   en 0002: sin constraint cruzado). Un 'under_agency' pendiente (caso atípico:
--   lo normal es que se resuelva automático vía redeem-invitation, pero el
--   schema no lo impide) SÍ transiciona y audita, pero NO promueve — ese flujo
--   ya tiene su propia RPC (test §12). reviewed_by_admin_id/reviewed_at se
--   setean en AMBOS approve y reject (columnas ya existen desde 0003).
--
-- (D9) admin_actions inmutable: seguimos el patrón YA EXISTENTE en el repo para
--   auditoría append-only (`user_consents`, migración 20260727000003): RLS SIN
--   política UPDATE/DELETE (ya así desde 0008/0010) + REVOKE UPDATE, DELETE,
--   TRUNCATE explícito de anon/authenticated (el agujero de TRUNCATE-por-default
--   que esa migración documentó para user_consents aplica IGUAL aquí — sigue
--   sin taparse en admin_actions, tarea #92). Hoy (RED), sin el REVOKE, un
--   UPDATE/DELETE de un no-admin ya falla por RLS (0 filas silenciosas, NO
--   excepción) pero TRUNCATE probablemente SÍ tiene éxito hoy -> por eso el
--   test de TRUNCATE va AL FINAL del archivo (si "tiene éxito" hoy, no debe
--   invalidar asserts anteriores que ya se evaluaron). NO se restringe el
--   INSERT directo de un admin autenticado (la política admin_actions_insert
--   YA lo permite desde 0008/0010) — sería una regresión no pedida (test §15).
--
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(90);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
  perform set_config('urbea.admin_actor_id', '', true);
end $$;

-- Simula Studio/SQL editor: rol postgres (bypass RLS real), auth.uid() = NULL.
-- p_admin_uuid (opcional) simula que el operador se identificó vía GUC de
-- sesión (D4); NULL simula "Studio sin identificarse" (el caso a bloquear).
create or replace function pg_temp.act_as_studio(p_admin_uuid uuid default null)
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('urbea.admin_actor_id', coalesce(p_admin_uuid::text, ''), true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000725101', 'admin_71x5@test.local'),
  ('00000000-0000-0000-0000-000000725102', 'owner_ag_active@test.local'),
  ('00000000-0000-0000-0000-000000725103', 'creador_rechazada@test.local'),
  ('00000000-0000-0000-0000-000000725104', 'creador_conflicto@test.local'),
  ('00000000-0000-0000-0000-000000725105', 'creador_happy@test.local'),
  ('00000000-0000-0000-0000-000000725106', 'creador_reject_ag@test.local'),
  ('00000000-0000-0000-0000-000000725107', 'ya_agente_independiente@test.local'),
  ('00000000-0000-0000-0000-000000725108', 'app_reject_noreason@test.local'),
  ('00000000-0000-0000-0000-000000725109', 'app_reject_reason@test.local'),
  ('00000000-0000-0000-0000-000000725110', 'app_approve_indep@test.local'),
  ('00000000-0000-0000-0000-000000725111', 'app_approve_underag@test.local'),
  ('00000000-0000-0000-0000-000000725112', 'app_final_approved@test.local'),
  ('00000000-0000-0000-0000-000000725113', 'app_final_rejected@test.local'),
  ('00000000-0000-0000-0000-000000725114', 'app_noop@test.local'),
  ('00000000-0000-0000-0000-000000725115', 'app_selfupdate@test.local'),
  ('00000000-0000-0000-0000-000000725116', 'app_actor_gate@test.local'),
  ('00000000-0000-0000-0000-000000725117', 'admin2_71x5@test.local'),
  ('00000000-0000-0000-0000-000000725118', 'app_precedencia_jwt_guc@test.local'),
  ('00000000-0000-0000-0000-000000725119', 'admin_creador_agencia@test.local'),
  ('00000000-0000-0000-0000-000000725120', 'admin_app_independent@test.local');

update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000725101';
-- Segundo admin (D4-ancla §16): existe SOLO para probar que el GUC pierde frente al JWT.
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000725117';
-- Fix 99: admins que además son creadores de una agencia/application (edge cases
-- nuevos §7-bis/§11-bis -- la aprobación NUNCA debe degradarlos a 'agent').
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000725119';
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000725120';
-- El creador de ag_pending_already_agent YA es agent (independiente, sin membresía
-- ni agencia) -- fixture del edge case (D5/§6).
update public.users set role = 'agent', agency_id = null
  where id = '00000000-0000-0000-0000-000000725107';

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000725201', 'Inmobiliaria 71.5 Activa', 'inmo-715-activa', 'active', '00000000-0000-0000-0000-000000725102'),
  ('00000000-0000-0000-0000-000000725202', 'Inmobiliaria 71.5 Rechazada', 'inmo-715-rechazada', 'rejected', '00000000-0000-0000-0000-000000725103'),
  ('00000000-0000-0000-0000-000000725203', 'Inmobiliaria 71.5 Conflicto Previa', 'inmo-715-conflicto-previa', 'active', '00000000-0000-0000-0000-000000725104'),
  ('00000000-0000-0000-0000-000000725204', 'Inmobiliaria 71.5 Pendiente Main', 'inmo-715-pendiente-main', 'pending_approval', '00000000-0000-0000-0000-000000725105'),
  ('00000000-0000-0000-0000-000000725205', 'Inmobiliaria 71.5 Pendiente Reject', 'inmo-715-pendiente-reject', 'pending_approval', '00000000-0000-0000-0000-000000725106'),
  ('00000000-0000-0000-0000-000000725206', 'Inmobiliaria 71.5 Pendiente Conflicto', 'inmo-715-pendiente-conflicto', 'pending_approval', '00000000-0000-0000-0000-000000725104'),
  ('00000000-0000-0000-0000-000000725207', 'Inmobiliaria 71.5 Pendiente Ya Agente', 'inmo-715-pendiente-ya-agente', 'pending_approval', '00000000-0000-0000-0000-000000725107'),
  ('00000000-0000-0000-0000-000000725208', 'Inmobiliaria 71.5 Pendiente Admin', 'inmo-715-pendiente-admin', 'pending_approval', '00000000-0000-0000-0000-000000725119');

-- owner activo de la agencia YA activa (para probar el gap de actor D3).
insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000725301', '00000000-0000-0000-0000-000000725201', '00000000-0000-0000-0000-000000725102', 'owner', 'active');
update public.users set role = 'agent', agency_id = '00000000-0000-0000-0000-000000725201'
  where id = '00000000-0000-0000-0000-000000725102';

-- membresía ACTIVA preexistente del "creador_conflicto" en OTRA agencia -> bloquea
-- la aprobación de su agencia pendiente (índice agency_members_one_active_per_user).
insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000725302', '00000000-0000-0000-0000-000000725203', '00000000-0000-0000-0000-000000725104', 'agent', 'active');
update public.users set role = 'agent', agency_id = '00000000-0000-0000-0000-000000725203'
  where id = '00000000-0000-0000-0000-000000725104';

insert into public.agent_applications (id, user_id, application_type, agency_id, status) values
  ('00000000-0000-0000-0000-000000725401', '00000000-0000-0000-0000-000000725108', 'independent', null, 'pending'),
  ('00000000-0000-0000-0000-000000725402', '00000000-0000-0000-0000-000000725109', 'independent', null, 'pending'),
  ('00000000-0000-0000-0000-000000725403', '00000000-0000-0000-0000-000000725110', 'independent', null, 'pending'),
  ('00000000-0000-0000-0000-000000725404', '00000000-0000-0000-0000-000000725111', 'under_agency', '00000000-0000-0000-0000-000000725201', 'pending'),
  ('00000000-0000-0000-0000-000000725405', '00000000-0000-0000-0000-000000725112', 'independent', null, 'approved'),
  ('00000000-0000-0000-0000-000000725406', '00000000-0000-0000-0000-000000725113', 'independent', null, 'rejected'),
  ('00000000-0000-0000-0000-000000725407', '00000000-0000-0000-0000-000000725114', 'independent', null, 'pending'),
  ('00000000-0000-0000-0000-000000725408', '00000000-0000-0000-0000-000000725115', 'independent', null, 'pending'),
  ('00000000-0000-0000-0000-000000725409', '00000000-0000-0000-0000-000000725116', 'independent', null, 'pending'),
  ('00000000-0000-0000-0000-000000725410', '00000000-0000-0000-0000-000000725118', 'independent', null, 'pending'),
  ('00000000-0000-0000-0000-000000725411', '00000000-0000-0000-0000-000000725120', 'independent', null, 'pending');
update public.agent_applications set rejection_reason = 'motivo previo del rechazo final'
  where id = '00000000-0000-0000-0000-000000725406';

-- ════════════════════════════════════════════════════════════════════════════
-- §1) AGENCIAS — gating de actor (D3/D4): "solo admin transiciona"
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1) [INVARIANTE] El OWNER de una agencia YA ACTIVA (RLS lo dejaría pasar vía
--      manages_agency) intenta autocambiar el status -> ya bloqueado HOY por el
--      GRANT de columna (D3), 42501, antes de llegar a RLS o al trigger.
select pg_temp.act_as('00000000-0000-0000-0000-000000725102', 'authenticated');
select throws_ok(
  $$ update public.agencies set status = 'pending_approval'
     where id = '00000000-0000-0000-0000-000000725201' $$,
  '42501', null,
  '§1.1 [INVARIANTE] owner NO-admin no puede tocar agencies.status (columna excluida del GRANT a authenticated, D3)'
);
reset role;
select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000725201'),
  'active',
  '§1.1 la agencia sigue active tras el intento bloqueado del owner'
);

-- 1.4) [INVARIANTE] Un ADMIN REAL (JWT authenticated, is_admin()=true) TAMBIÉN
--      está bloqueado por el mismo GRANT de columna -- no es un problema de RLS,
--      es que `authenticated` (sea quien sea) no tiene UPDATE de `status` en
--      absoluto. Fija D3: el único camino de aprobación es Studio.
select pg_temp.act_as('00000000-0000-0000-0000-000000725101', 'authenticated');
select throws_ok(
  $$ update public.agencies set status = 'active'
     where id = '00000000-0000-0000-0000-000000725207' $$,
  '42501', null,
  '§1.4 [INVARIANTE] ni siquiera un admin real puede aprobar agencies.status vía authenticated/PostgREST -- solo Studio'
);
reset role;
select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000725207'),
  'pending_approval',
  '§1.4 la agencia sigue pending_approval (el admin real tampoco pudo tocarla por el camino authenticated)'
);

-- 1.2) Studio sin identificarse (sin JWT admin, sin GUC) intenta aprobar.
select pg_temp.act_as_studio(null);
select throws_ok(
  $$ update public.agencies set status = 'active'
     where id = '00000000-0000-0000-0000-000000725204' $$,
  'P0001', 'STATUS_CHANGE_REQUIRES_ADMIN',
  '§1.2 Studio sin admin identificado (ni JWT ni GUC) no puede aprobar'
);
select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000725204'),
  'pending_approval',
  '§1.2 la agencia sigue pending_approval tras el intento de Studio sin identificar'
);

-- 1.3) Studio con GUC apuntando a un usuario que EXISTE pero NO es admin.
select pg_temp.act_as_studio('00000000-0000-0000-0000-000000725102');
select throws_ok(
  $$ update public.agencies set status = 'active'
     where id = '00000000-0000-0000-0000-000000725205' $$,
  'P0001', 'STATUS_CHANGE_REQUIRES_ADMIN',
  '§1.3 GUC apuntando a un usuario no-admin tampoco autoriza (no basta con "existir")'
);
select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000725205'),
  'pending_approval',
  '§1.3 la agencia sigue pending_approval tras el GUC no-admin'
);

-- ════════════════════════════════════════════════════════════════════════════
-- §2) AGENCIAS — máquina de estados: transiciones inválidas (D1/D2)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as_studio('00000000-0000-0000-0000-000000725101');
select throws_ok(
  $$ update public.agencies set status = 'approved'
     where id = '00000000-0000-0000-0000-000000725204' $$,
  'P0001', 'INVALID_STATUS_TRANSITION',
  '§2.1 pending_approval -> ''approved'' (literal, NO es el target de aprobar) está bloqueado -- fija D1'
);
select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000725204'),
  'pending_approval',
  '§2.1 la agencia sigue pending_approval (nunca llegó a ''approved'')'
);

select pg_temp.act_as_studio('00000000-0000-0000-0000-000000725101');
select throws_ok(
  $$ update public.agencies set status = 'suspended'
     where id = '00000000-0000-0000-0000-000000725204' $$,
  'P0001', 'INVALID_STATUS_TRANSITION',
  '§2.2 pending_approval -> suspended está bloqueado (fuera de alcance de esta migración, D2)'
);
select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000725204'),
  'pending_approval',
  '§2.2 la agencia sigue pending_approval tras el intento a suspended'
);

select pg_temp.act_as_studio('00000000-0000-0000-0000-000000725101');
select throws_ok(
  $$ update public.agencies set status = 'active'
     where id = '00000000-0000-0000-0000-000000725202' $$,
  'P0001', 'INVALID_STATUS_TRANSITION',
  '§2.3 rejected -> active está bloqueado (rejected es terminal en esta migración)'
);
select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000725202'),
  'rejected',
  '§2.3 la agencia sigue rejected'
);

-- Admin (no owner) intentando regresar una agencia activa a pending_approval:
-- aísla el check de VALIDEZ de transición del check de ACTOR (§1) -- el actor
-- aquí SÍ es admin, así que si esto fallara sería por INVALID_STATUS_TRANSITION.
select pg_temp.act_as_studio('00000000-0000-0000-0000-000000725101');
select throws_ok(
  $$ update public.agencies set status = 'pending_approval'
     where id = '00000000-0000-0000-0000-000000725201' $$,
  'P0001', 'INVALID_STATUS_TRANSITION',
  '§2.4 active -> pending_approval está bloqueado incluso para un admin (transición no existe)'
);
select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000725201'),
  'active',
  '§2.4 la agencia sigue active'
);

-- ════════════════════════════════════════════════════════════════════════════
-- §3) AGENCIAS — no-op idempotente (edge case 8, INVARIANTE hoy)
-- ════════════════════════════════════════════════════════════════════════════

-- Vía Studio SIN admin identificado (ni JWT ni GUC): el trigger no debe
-- dispararse en absoluto si status no cambia (WHEN old.status IS DISTINCT FROM
-- new.status), así que ni siquiera llega al check de actor -- un "resave" del
-- mismo valor es inofensivo aunque nadie se haya identificado como admin.
select pg_temp.act_as_studio(null);
select lives_ok(
  $$ update public.agencies set status = 'active'
     where id = '00000000-0000-0000-0000-000000725201' $$,
  '§3 UPDATE que reescribe el mismo status (active->active) no lanza error, ni sin admin identificado'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'agency' and entity_id = '00000000-0000-0000-0000-000000725201'),
  0,
  '§3 el no-op no generó ninguna fila de auditoría'
);

-- 3-bis) [DELTA-ANCLA, simetría opcional] mismo no-op pero CON un admin resuelto
--        (Studio identificado vía GUC): tampoco debe auditar -- el WHEN clause debe
--        saltarse el trigger por completo independientemente de si hay actor o no,
--        no solo "cuando conviene". Mata un mutante que quitara/debilitara el WHEN
--        y dependiera de un chequeo interno "if old=new then return" post-resolve
--        (que sí llamaría a resolve_admin_actor y, con un actor real, podría colarse
--        a insertar auditoría igual).
select pg_temp.act_as_studio('00000000-0000-0000-0000-000000725101');
select lives_ok(
  $$ update public.agencies set status = 'active'
     where id = '00000000-0000-0000-0000-000000725201' $$,
  '§3-bis UPDATE que reescribe el mismo status (active->active) no lanza error CON admin identificado'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'agency' and entity_id = '00000000-0000-0000-0000-000000725201'),
  0,
  '§3-bis el no-op tampoco audita aunque el actor SÍ sea un admin resuelto'
);

-- ════════════════════════════════════════════════════════════════════════════
-- §4) AGENCIAS — happy path: aprobar (pending_approval -> active), D1/D5
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as_studio('00000000-0000-0000-0000-000000725101');
select lives_ok(
  $$ update public.agencies set status = 'active'
     where id = '00000000-0000-0000-0000-000000725204' $$,
  '§4 admin aprueba ag_pending_main sin error'
);
select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000725204'),
  'active',
  '§4 ag_pending_main queda active'
);
select is(
  (select approved_by_admin_id from public.agencies where id = '00000000-0000-0000-0000-000000725204'),
  '00000000-0000-0000-0000-000000725101'::uuid,
  '§4 approved_by_admin_id queda en el admin que aprobó'
);
select is(
  (select count(*)::int from public.agency_members
    where agency_id = '00000000-0000-0000-0000-000000725204'
      and user_id = '00000000-0000-0000-0000-000000725105'
      and member_role = 'owner' and status = 'active'),
  1,
  '§4 se crea la membresía owner activa del creador'
);
select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000725105'),
  'agent',
  '§4 el creador queda promovido a role=agent'
);
select is(
  (select agency_id from public.users where id = '00000000-0000-0000-0000-000000725105'),
  '00000000-0000-0000-0000-000000725204'::uuid,
  '§4 users.agency_id del creador apunta a la nueva agencia'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'agency' and entity_id = '00000000-0000-0000-0000-000000725204'
      and action_type = 'approve_agency'),
  1,
  '§4 se registra exactamente 1 admin_actions de approve_agency'
);
select is(
  (select old_values->>'status' from public.admin_actions
    where entity_type = 'agency' and entity_id = '00000000-0000-0000-0000-000000725204'
      and action_type = 'approve_agency'),
  'pending_approval',
  '§4 admin_actions.old_values.status = pending_approval'
);
select is(
  (select new_values->>'status' from public.admin_actions
    where entity_type = 'agency' and entity_id = '00000000-0000-0000-0000-000000725204'
      and action_type = 'approve_agency'),
  'active',
  '§4 admin_actions.new_values.status = active'
);
select is(
  (select admin_id from public.admin_actions
    where entity_type = 'agency' and entity_id = '00000000-0000-0000-0000-000000725204'
      and action_type = 'approve_agency'),
  '00000000-0000-0000-0000-000000725101'::uuid,
  '§4 admin_actions.admin_id es el admin que aprobó'
);

-- ════════════════════════════════════════════════════════════════════════════
-- §5) AGENCIAS — happy path: rechazar (pending_approval -> rejected), D6
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as_studio('00000000-0000-0000-0000-000000725101');
select lives_ok(
  $$ update public.agencies set status = 'rejected'
     where id = '00000000-0000-0000-0000-000000725205' $$,
  '§5 admin rechaza ag_pending_reject sin error'
);
select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000725205'),
  'rejected',
  '§5 ag_pending_reject queda rejected'
);
select is(
  (select approved_by_admin_id from public.agencies where id = '00000000-0000-0000-0000-000000725205'),
  null,
  '§5 approved_by_admin_id NO se setea al rechazar'
);
select is(
  (select count(*)::int from public.agency_members
    where agency_id = '00000000-0000-0000-0000-000000725205'),
  0,
  '§5 rechazar no crea ninguna membresía'
);
select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000725106'),
  'user',
  '§5 el creador rechazado NO fue promovido'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'agency' and entity_id = '00000000-0000-0000-0000-000000725205'
      and action_type = 'reject_agency'),
  1,
  '§5 se registra exactamente 1 admin_actions de reject_agency'
);

-- ════════════════════════════════════════════════════════════════════════════
-- §6) AGENCIAS — conflicto de membresía activa preexistente (edge case 9, D5)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as_studio('00000000-0000-0000-0000-000000725101');
select throws_ok(
  $$ update public.agencies set status = 'active'
     where id = '00000000-0000-0000-0000-000000725206' $$,
  'P0001', 'MEMBER_OF_OTHER_AGENCY',
  '§6 aprobar una agencia cuyo creador ya es owner/agent activo en OTRA agencia truena tipado (fix 99: antes ALREADY_ACTIVE_MEMBER, sin guía; ahora nombre + hint operativo — el admin debe removerlo/cambiarlo de la otra agencia antes de reintentar, no hay auto-switch)'
);
select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000725206'),
  'pending_approval',
  '§6 la agencia en conflicto NO cambió de status (rollback completo de la transacción)'
);
select is(
  (select count(*)::int from public.agency_members
    where agency_id = '00000000-0000-0000-0000-000000725206'),
  0,
  '§6 no se creó ninguna membresía para la agencia en conflicto'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'agency' and entity_id = '00000000-0000-0000-0000-000000725206'),
  0,
  '§6 no se registró auditoría del intento fallido'
);
select is(
  (select agency_id from public.users where id = '00000000-0000-0000-0000-000000725104'),
  '00000000-0000-0000-0000-000000725203'::uuid,
  '§6 el creador en conflicto conserva su agencia/membresía original intacta'
);

-- ════════════════════════════════════════════════════════════════════════════
-- §7) AGENCIAS — creador que YA es agent (independiente) sí puede aprobar
--     su propia agencia (edge case 10, D5: promoción idempotente)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as_studio('00000000-0000-0000-0000-000000725101');
select lives_ok(
  $$ update public.agencies set status = 'active'
     where id = '00000000-0000-0000-0000-000000725207' $$,
  '§7 admin aprueba la agencia de un creador que YA es agent (sin membresía previa) sin error'
);
select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000725207'),
  'active',
  '§7 la agencia queda active'
);
select is(
  (select count(*)::int from public.agency_members
    where agency_id = '00000000-0000-0000-0000-000000725207'
      and user_id = '00000000-0000-0000-0000-000000725107'
      and member_role = 'owner' and status = 'active'),
  1,
  '§7 se crea la membresía owner (el creador NO tenía ninguna membresía activa antes)'
);
select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000725107'),
  'agent',
  '§7 el creador sigue siendo agent (promoción idempotente, sin error)'
);
select is(
  (select agency_id from public.users where id = '00000000-0000-0000-0000-000000725107'),
  '00000000-0000-0000-0000-000000725207'::uuid,
  '§7 users.agency_id se actualiza a la nueva agencia (antes era NULL, independiente)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- §7-bis) AGENCIAS — aprobar la agencia de un creador que YA es admin NO lo
--         degrada a 'agent' (DELTA, fix 99 — hallazgo del review PR #41)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as_studio('00000000-0000-0000-0000-000000725101');
select lives_ok(
  $$ update public.agencies set status = 'active'
     where id = '00000000-0000-0000-0000-000000725208' $$,
  '§7-bis admin aprueba la agencia de un creador que YA es admin sin error'
);
select is(
  (select status::text from public.agencies where id = '00000000-0000-0000-0000-000000725208'),
  'active',
  '§7-bis la agencia queda active'
);
select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000725119'),
  'admin',
  '§7-bis (fix 99) el creador admin CONSERVA role=admin -- antes se degradaba a agent en silencio'
);
select is(
  (select agency_id from public.users where id = '00000000-0000-0000-0000-000000725119'),
  '00000000-0000-0000-0000-000000725208'::uuid,
  '§7-bis users.agency_id SÍ se denormaliza a la nueva agencia aunque el rol no cambie'
);
select is(
  (select count(*)::int from public.agency_members
    where agency_id = '00000000-0000-0000-0000-000000725208'
      and user_id = '00000000-0000-0000-0000-000000725119'
      and member_role = 'owner' and status = 'active'),
  1,
  '§7-bis se crea la membresía owner igual -- un admin SÍ puede ser owner de una agencia sin perder su rol'
);

-- ════════════════════════════════════════════════════════════════════════════
-- §8) AGENT_APPLICATIONS — no-regresión RLS (agent_app_update ya es solo admin)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000725115', 'authenticated');
select lives_ok(
  $$ update public.agent_applications set status = 'approved'
     where id = '00000000-0000-0000-0000-000000725408' $$,
  '§8 [INVARIANTE] el propio solicitante puede EJECUTAR el UPDATE sin error de permiso...'
);
reset role;
select is(
  (select status::text from public.agent_applications where id = '00000000-0000-0000-0000-000000725408'),
  'pending',
  '§8 [INVARIANTE] ...pero RLS (using is_admin()) deja la fila sin tocar (0 filas afectadas realmente)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- §9) AGENT_APPLICATIONS — gating de actor vía Studio (D4, mismo helper que §1)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as_studio(null);
select throws_ok(
  $$ update public.agent_applications set status = 'approved'
     where id = '00000000-0000-0000-0000-000000725409' $$,
  'P0001', 'STATUS_CHANGE_REQUIRES_ADMIN',
  '§9 Studio sin admin identificado no puede aprobar una application'
);
select is(
  (select status::text from public.agent_applications where id = '00000000-0000-0000-0000-000000725409'),
  'pending',
  '§9 la application sigue pending tras el intento de Studio sin identificar'
);

-- ════════════════════════════════════════════════════════════════════════════
-- §10) AGENT_APPLICATIONS — rechazo exige rejection_reason (D7)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000725101', 'authenticated');
select throws_ok(
  $$ update public.agent_applications set status = 'rejected'
     where id = '00000000-0000-0000-0000-000000725401' $$,
  'P0001', 'REJECTION_REASON_REQUIRED',
  '§10.1 rechazar sin rejection_reason truena tipado'
);
reset role;
select is(
  (select status::text from public.agent_applications where id = '00000000-0000-0000-0000-000000725401'),
  'pending',
  '§10.1 la application sigue pending (el rechazo sin motivo no se aplicó)'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000725101', 'authenticated');
select lives_ok(
  $$ update public.agent_applications
     set status = 'rejected', rejection_reason = 'no cumple requisitos'
     where id = '00000000-0000-0000-0000-000000725402' $$,
  '§10.2 rechazar CON rejection_reason no lanza error'
);
reset role;
select is(
  (select status::text from public.agent_applications where id = '00000000-0000-0000-0000-000000725402'),
  'rejected',
  '§10.2 la application queda rejected'
);
select is(
  (select reviewed_by_admin_id from public.agent_applications where id = '00000000-0000-0000-0000-000000725402'),
  '00000000-0000-0000-0000-000000725101'::uuid,
  '§10.2 reviewed_by_admin_id queda en el admin que rechazó'
);
select isnt(
  (select reviewed_at from public.agent_applications where id = '00000000-0000-0000-0000-000000725402'),
  null,
  '§10.2 reviewed_at queda seteado'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'agent_application' and entity_id = '00000000-0000-0000-0000-000000725402'
      and action_type = 'reject_agent_application'),
  1,
  '§10.2 se registra exactamente 1 admin_actions de reject_agent_application'
);
select is(
  (select reason from public.admin_actions
    where entity_type = 'agent_application' and entity_id = '00000000-0000-0000-0000-000000725402'
      and action_type = 'reject_agent_application'),
  'no cumple requisitos',
  '§10.2 admin_actions.reason lleva el mismo texto que rejection_reason'
);

-- ════════════════════════════════════════════════════════════════════════════
-- §11) AGENT_APPLICATIONS — aprobar independiente promueve a agent (D8)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000725101', 'authenticated');
select lives_ok(
  $$ update public.agent_applications set status = 'approved'
     where id = '00000000-0000-0000-0000-000000725403' $$,
  '§11 admin aprueba application independent sin error'
);
reset role;
select is(
  (select status::text from public.agent_applications where id = '00000000-0000-0000-0000-000000725403'),
  'approved',
  '§11 la application queda approved'
);
select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000725110'),
  'agent',
  '§11 el solicitante queda promovido a role=agent (independiente, sin agencia)'
);
select is(
  (select reviewed_by_admin_id from public.agent_applications where id = '00000000-0000-0000-0000-000000725403'),
  '00000000-0000-0000-0000-000000725101'::uuid,
  '§11 reviewed_by_admin_id queda en el admin que aprobó'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'agent_application' and entity_id = '00000000-0000-0000-0000-000000725403'
      and action_type = 'approve_agent_application'),
  1,
  '§11 se registra exactamente 1 admin_actions de approve_agent_application'
);

-- ════════════════════════════════════════════════════════════════════════════
-- §11-bis) AGENT_APPLICATIONS — aprobar independent de un solicitante que YA es
--          admin NO lo degrada (DELTA, fix 99 — mismo defecto que §7-bis)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000725101', 'authenticated');
select lives_ok(
  $$ update public.agent_applications set status = 'approved'
     where id = '00000000-0000-0000-0000-000000725411' $$,
  '§11-bis admin aprueba application independent de un solicitante que YA es admin sin error'
);
reset role;
select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000725120'),
  'admin',
  '§11-bis (fix 99) el solicitante admin CONSERVA role=admin -- antes se degradaba a agent en silencio'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'agent_application' and entity_id = '00000000-0000-0000-0000-000000725411'
      and action_type = 'approve_agent_application'),
  1,
  '§11-bis igual se audita aunque no haya degradación'
);

-- ════════════════════════════════════════════════════════════════════════════
-- §12) AGENT_APPLICATIONS — aprobar under_agency NO promueve (D8), vía Studio+GUC
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as_studio('00000000-0000-0000-0000-000000725101');
select lives_ok(
  $$ update public.agent_applications set status = 'approved'
     where id = '00000000-0000-0000-0000-000000725404' $$,
  '§12 Studio con GUC de admin válido aprueba una application under_agency sin error (cubre D4 vía GUC, no solo JWT)'
);
select is(
  (select status::text from public.agent_applications where id = '00000000-0000-0000-0000-000000725404'),
  'approved',
  '§12 la application under_agency queda approved'
);
select is(
  (select role::text from public.users where id = '00000000-0000-0000-0000-000000725111'),
  'user',
  '§12 el solicitante NO fue promovido (under_agency se resuelve por otro flujo -- redeem-invitation)'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'agent_application' and entity_id = '00000000-0000-0000-0000-000000725404'
      and action_type = 'approve_agent_application'),
  1,
  '§12 igual se audita aunque no haya promoción'
);

-- ════════════════════════════════════════════════════════════════════════════
-- §13) AGENT_APPLICATIONS — estados finales inmutables (edge case 7, D7)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000725101', 'authenticated');
select throws_ok(
  $$ update public.agent_applications
     set status = 'rejected', rejection_reason = 'motivo tardío'
     where id = '00000000-0000-0000-0000-000000725405' $$,
  'P0001', 'INVALID_STATUS_TRANSITION',
  '§13.1 approved -> rejected está bloqueado (approved es terminal)'
);
reset role;
select is(
  (select status::text from public.agent_applications where id = '00000000-0000-0000-0000-000000725405'),
  'approved',
  '§13.1 la application sigue approved'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000725101', 'authenticated');
select throws_ok(
  $$ update public.agent_applications set status = 'pending'
     where id = '00000000-0000-0000-0000-000000725405' $$,
  'P0001', 'INVALID_STATUS_TRANSITION',
  '§13.2 approved -> pending ("reabrir") está bloqueado'
);
reset role;
select is(
  (select status::text from public.agent_applications where id = '00000000-0000-0000-0000-000000725405'),
  'approved',
  '§13.2 la application sigue approved'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000725101', 'authenticated');
select throws_ok(
  $$ update public.agent_applications set status = 'approved'
     where id = '00000000-0000-0000-0000-000000725406' $$,
  'P0001', 'INVALID_STATUS_TRANSITION',
  '§13.3 rejected -> approved está bloqueado (rejected es terminal)'
);
reset role;
select is(
  (select status::text from public.agent_applications where id = '00000000-0000-0000-0000-000000725406'),
  'rejected',
  '§13.3 la application sigue rejected'
);

-- ════════════════════════════════════════════════════════════════════════════
-- §14) AGENT_APPLICATIONS — no-op idempotente (edge case 8, INVARIANTE hoy)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000725101', 'authenticated');
select lives_ok(
  $$ update public.agent_applications set status = 'pending'
     where id = '00000000-0000-0000-0000-000000725407' $$,
  '§14 UPDATE que reescribe el mismo status (pending->pending) no lanza error'
);
reset role;
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'agent_application' and entity_id = '00000000-0000-0000-0000-000000725407'),
  0,
  '§14 el no-op no generó ninguna fila de auditoría'
);

-- ════════════════════════════════════════════════════════════════════════════
-- §16) [DELTA-ANCLA] precedencia JWT > GUC en private.resolve_admin_actor() (D4)
-- ════════════════════════════════════════════════════════════════════════════
-- Mata el mutante: invertir el coalesce de resolve_admin_actor() (que el GUC gane
-- sobre auth.uid(), en vez de al revés) pasaría igual las 559 pruebas anteriores,
-- porque ninguna sección ejercita JWT y GUC A LA VEZ con dos admins DISTINTOS --
-- todas usan uno u otro, nunca los dos simultáneos. Sin este anclaje, un admin real
-- autenticado (JWT) podría atribuirle la auditoría a OTRO admin con solo dejar un
-- GUC de sesión con valor ajeno (o restos de una llamada anterior) -- justo lo que
-- D4 dice defender.
--
-- Escenario: JWT del admin1 (725101) + GUC apuntando al admin2 (725117) al mismo
-- tiempo -> reviewed_by_admin_id (y, si el mutante ganara, también admin_actions.
-- admin_id) DEBE quedar en el admin1 (JWT), nunca en el admin2 (GUC).
select pg_temp.act_as('00000000-0000-0000-0000-000000725101', 'authenticated');
select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000725117', true);
select lives_ok(
  $$ update public.agent_applications set status = 'approved'
     where id = '00000000-0000-0000-0000-000000725410' $$,
  '§16 [DELTA-ANCLA] JWT admin1 + GUC admin2 simultáneos -> aprobar no lanza error'
);
reset role;
select is(
  (select reviewed_by_admin_id from public.agent_applications where id = '00000000-0000-0000-0000-000000725410'),
  '00000000-0000-0000-0000-000000725101'::uuid,
  '§16 [DELTA-ANCLA] reviewed_by_admin_id queda en el admin del JWT (725101), NUNCA el del GUC (725117) -- ancla la precedencia D4'
);

-- ════════════════════════════════════════════════════════════════════════════
-- §15) ADMIN_ACTIONS — inmutabilidad append-only (D9, patrón 0007/user_consents)
-- ════════════════════════════════════════════════════════════════════════════

insert into public.admin_actions (id, admin_id, action_type, entity_type, entity_id) values
  ('00000000-0000-0000-0000-000000725501', '00000000-0000-0000-0000-000000725101', 'seed_test', 'agency', '00000000-0000-0000-0000-000000725201');

-- 15.1) [INVARIANTE] un admin autenticado SÍ puede insertar directo (no se
--       restringe a "solo el trigger" -- política admin_actions_insert vigente).
select pg_temp.act_as('00000000-0000-0000-0000-000000725101', 'authenticated');
select lives_ok(
  $$ insert into public.admin_actions (admin_id, action_type, entity_type, entity_id) values
     ('00000000-0000-0000-0000-000000725101', 'manual_probe', 'agency', '00000000-0000-0000-0000-000000725201') $$,
  '§15.1 [INVARIANTE] un admin autenticado puede insertar admin_actions directo (no se restringe a triggers)'
);
reset role;

-- 15.2) [INVARIANTE] un no-admin NO puede insertar (spoof de admin_id ajeno o propio).
select pg_temp.act_as('00000000-0000-0000-0000-000000725115', 'authenticated');
select throws_ok(
  $$ insert into public.admin_actions (admin_id, action_type, entity_type, entity_id) values
     ('00000000-0000-0000-0000-000000725115', 'manual_probe', 'agency', '00000000-0000-0000-0000-000000725201') $$,
  '42501', null,
  '§15.2 [INVARIANTE] un no-admin no puede insertar en admin_actions'
);
reset role;

-- 15.3-4) UPDATE/DELETE por un admin autenticado deben quedar bloqueados
--         (hoy, sin el REVOKE de D9, ya fallan por RLS -- 0 filas, no excepción
--         -- así que throws_ok es un DELTA real hasta que se agregue el REVOKE).
select pg_temp.act_as('00000000-0000-0000-0000-000000725101', 'authenticated');
select throws_ok(
  $$ update public.admin_actions set reason = 'manipulado'
     where id = '00000000-0000-0000-0000-000000725501' $$,
  '42501', null,
  '§15.3 UPDATE sobre admin_actions bloqueado incluso para un admin'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000725101', 'authenticated');
select throws_ok(
  $$ delete from public.admin_actions where id = '00000000-0000-0000-0000-000000725501' $$,
  '42501', null,
  '§15.4 DELETE sobre admin_actions bloqueado incluso para un admin'
);
reset role;

-- 15.5) TRUNCATE — AL FINAL: si hoy tiene éxito (agujero heredado, sin el
--       REVOKE de D9), vacía la tabla dentro de esta transacción; no debe
--       correr antes de ningún assert que dependa de filas de admin_actions.
select pg_temp.act_as('00000000-0000-0000-0000-000000725101', 'authenticated');
select throws_ok(
  $$ truncate public.admin_actions $$,
  '42501', null,
  '§15.5 TRUNCATE sobre admin_actions bloqueado incluso para un admin'
);
reset role;

select * from finish();
rollback;
