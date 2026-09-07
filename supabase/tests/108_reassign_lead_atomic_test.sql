-- Tests pgTAP — public.reassign_lead_atomic (subtarea 269.2, exploración 045 §6.6/§14 T-E,
-- fila D10-bis de §18: "el buscador NO recibe aviso; solo el agente destino").
-- Ejecutar con:
--   docker exec -i supabase_db_urbea-app psql -U postgres -d postgres -v ON_ERROR_STOP=0 \
--     -tAq -f /dev/stdin < supabase/tests/108_reassign_lead_atomic_test.sql
-- Corre como superusuario dentro de una transacción revertida (no persiste). Impersonamos con
-- pg_temp.act_as(uid, role) — mismo patrón de 02/.../91/100/101/102/103/104/106/107.
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba (contrato PÚBLICO, comportamiento observable, NUNCA internals):
--   public.reassign_lead_atomic(p_lead_id uuid, p_to_agent uuid) returns void
--   SECURITY DEFINER, VOLATILE, search_path='', REVOKE de public/anon, GRANT solo a
--   authenticated. La agencia se deriva de leads.agency_id (SIN parámetro p_agency_id, a
--   diferencia del molde reassign_member_properties_atomic).
-- SUT AÚN NO EXISTE (RED 2026-09-06): lo crea
--   supabase/migrations/20260906400002_reassign_lead_atomic.sql (fuera de esta fase — sentinel
--   .taskmaster/.current-red = 269.2, esta subtarea SOLO escribe el RED).
-- Molde: public.reassign_member_properties_atomic (20260904200001) — mismo criterio
-- anti-enumeración (un código para "no existe" y "no autorizado"), mismo patrón de ancla
-- parcial de idempotencia (notifications_lead_unmanaged_anchor_idx).
--
-- ── Estrategia RED sin depender de "function does not exist" (mismo patrón que 91/100-107) ──
-- (a) Catálogo puro (has_function/pg_get_function_*/pg_proc/pg_indexes/function_privs_are) es
--     seguro aunque la función o el índice no existan: resuelve "not ok" sin lanzar.
-- (b) TODA llamada real (autenticada) pasa por pg_temp.reassign_lead(...), que atrapa
--     CUALQUIER excepción y devuelve 'ok' o 'SQLSTATE|mensaje' — nunca aborta la transacción
--     (mismo wrapper que pg_temp.reassign de 91_leads_sin_gestor_test.sql, adaptado a una RPC
--     que retorna void en vez de integer).
-- (c) Gotcha 203.1 (el EXECUTE se comprueba al planificar y el plan se cachea): el caso `anon`
--     va por su PROPIO wrapper (pg_temp.reassign_lead_anon), llamado ANTES de cualquier
--     invocación autenticada — nunca reusar pg_temp.reassign() después de que authenticated ya
--     lo llamó, o el plan cacheado esconde el ACL real.
--
-- ── Decisiones de diseño del test-author (el contrato no las fijaba; se deciden aquí y el
--    GREEN debe cumplirlas exactamente — quedan en la bitácora de la subtarea) ────────────────
-- D-ACTION: admin_actions inserta SIEMPRE (auditoría completa, incluso en la 2ª/3ª reasignación
--   del mismo lead): action_type='lead_reassigned', entity_type='lead', entity_id=p_lead_id,
--   admin_id=auth.uid(), old_values={'from_agent_id': <agente ANTES>},
--   new_values={'to_agent_id': p_to_agent}. Sin ancla de idempotencia (cada reasignación es un
--   HECHO distinto, mismo criterio que reassign_member_properties_atomic).
-- D-NOTIF: notifications SOLO al destino, type='lead_reassigned', related_entity_type='lead',
--   related_entity_id=p_lead_id, user_id=p_to_agent, IDEMPOTENTE por ancla parcial
--   notifications_lead_reassigned_anchor_idx (user_id, related_entity_id, type) where
--   type='lead_reassigned' — mismo patrón exacto que notifications_lead_unmanaged_anchor_idx.
--   NUNCA al buscador (leads.user_id, D10-bis) ni al agente origen. El copy (title/body/
--   deep_link/data) NO es parte de este contrato — no se ancla aquí (ponytail: el test más
--   corto que fija el contrato; los 4 campos de arriba son lo observable).
-- D-CLOSED: un lead con status cerrado (D-CLOSED de 107: closed_won_rent, closed_won_sale,
--   closed_lost, discarded, closed_won) se puede reasignar igual — no hay regla que lo prohíba
--   y el status NO cambia.
-- D-ADMIN-PLATFORM: is_admin() de plataforma NO amplía esta RPC — un admin de plataforma SIN
--   membresía en la agencia del lead recibe LEAD_NOT_FOUND, igual que cualquier desconocido
--   (mismo criterio que reassign_member_properties_atomic, que tampoco lo contempla).
-- D-ORDER (fijado por el contrato de la subtarea): NOT_AUTHENTICATED → LEAD_NOT_FOUND →
--   SAME_USER → TARGET_NOT_ACTIVE_MEMBER. ORDER1/ORDER2 anclan los dos cruces no triviales:
--   LEAD_NOT_FOUND gana sobre SAME_USER/TARGET_NOT_ACTIVE_MEMBER (caller no autorizado +
--   parámetros que dispararían ambos si se alcanzaran) y NOT_AUTHENTICATED gana sobre
--   LEAD_NOT_FOUND (sin sesión + lead inexistente).
--
-- ── Convención DELTA vs INVARIANTE vs GUARD (heredada de 21/25/27/.../91) ────────────────────
-- DELTA      = falla HOY por ASERCIÓN, pasa tras el GREEN (discrimina la RPC nueva). Es la
--              mayoría del archivo (41/46 en la corrida RED verificada).
-- GUARD      = pasa HOY trivialmente porque nada mutó todavía (la RPC no existe, así que el
--              conteo/valor sigue en su estado inicial) y solo cobra sentido tras el GREEN:
--              discrimina un GREEN EQUIVOCADO, no la ausencia de la RPC. En esta corrida:
--              OVERVIEW_PRE (crm_agency_overview, 269.1, YA vive — el lead del agente
--              suspendido YA aparece unmanaged sin que exista reassign_lead_atomic), HAPPY3
--              (agency_id no cambia — trivial si nada cambió), HAPPY6/HAPPY7 (nadie recibe
--              notificación — trivial con 0 notificaciones), CLOSED3 (el status no cambia —
--              trivial si nada cambió). Se marcan aparte a propósito para no inflar la cuenta
--              de DELTA con aserciones que hoy no discriminan nada.
-- Verificado en vivo (docker exec, ver bitácora de la subtarea): 41 not ok / 46, exactamente
-- las 5 GUARD listadas arriba en ok — ninguna falla por import/crash, todas por ASERCIÓN.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(46);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- Invoca la RPC bajo el rol actual y devuelve 'ok' o 'SQLSTATE|mensaje'. SECURITY INVOKER (el
-- default) a propósito: el chequeo de EXECUTE y auth.uid() deben verse desde el rol
-- impersonado, no desde postgres.
create or replace function pg_temp.reassign_lead(p_lead_id uuid, p_to_agent uuid)
returns text language plpgsql as $$
begin
  perform public.reassign_lead_atomic(p_lead_id, p_to_agent);
  return 'ok';
exception when others then
  return sqlstate || '|' || sqlerrm;
end $$;

-- Copia EXACTA de arriba, en su propio wrapper — ver gotcha 203.1 en la cabecera. Es la
-- PRIMERA invocación real de public.reassign_lead_atomic en todo el archivo.
create or replace function pg_temp.reassign_lead_anon(p_lead_id uuid, p_to_agent uuid)
returns text language plpgsql as $$
begin
  perform public.reassign_lead_atomic(p_lead_id, p_to_agent);
  return 'ok';
exception when others then
  return sqlstate || '|' || sqlerrm;
end $$;

create temp table res_108 (k text primary key, v text);
grant insert, select, update on res_108 to public;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '00000000-0000-0000-0000-0000002699XX' (subtarea 269.2, bloque
-- 900-999 sin colisión con 107 que usa hasta ...269801).
--   AGENCIAS: A ...269910 · B (ajena) ...269920.
--   USUARIOS:
--   901 OWNER_A          — owner  ACTIVO en A → autorizado.
--   902 ADMIN_A          — admin  ACTIVO en A → autorizado.
--   903 AGENT_RASO_A     — agent  ACTIVO en A → NO autorizado (LEAD_NOT_FOUND).
--   904 VIEWER_A         — viewer ACTIVO en A → NO autorizado (LEAD_NOT_FOUND).
--   905 OWNER_SUSP_A     — owner  SUSPENDIDO en A → NO autorizado (LEAD_NOT_FOUND).
--   906 OWNER_B          — owner  ACTIVO en B (ajena, sin fila en A) → NO autorizado.
--   907 FROM_AGENT       — agent  SUSPENDIDO en A → agente ACTUAL de LEAD_MAIN/LEAD_CHAIN-fuente.
--   908 TO_ACTIVE        — agent  ACTIVO en A → destino válido en todos los happy path.
--   909 TO_VIEWER        — viewer ACTIVO en A → destino inválido (TARGET_NOT_ACTIVE_MEMBER).
--   910 TO_SUSPENDED     — agent  SUSPENDIDO en A (distinto de 907) → destino inválido.
--   911 TO_OTHER_AGENCY  — agent  ACTIVO SOLO en B → destino inválido (no es miembro de A).
--   912 TO_NO_MEMBERSHIP — sin ninguna fila de agency_members → destino inválido.
--   913 SEARCHER_MAIN    — buscador de LEAD_MAIN, jamás recibe notificación.
--   914 INDEPENDENT_AGENT— sin ninguna fila de agency_members → su lead nace con agency_id NULL.
--   915 PLATFORM_ADMIN   — public.users.role='admin', SIN membresía en A → LEAD_NOT_FOUND.
--   916 AGENT_CLOSED     — agent  ACTIVO en A → agente de LEAD_CLOSED.
--   917 AGENT_ORIGIN     — agent  ACTIVO en A → primer agente de LEAD_CHAIN.
--   918 AGENT_CHAIN_C    — agent  ACTIVO en A → tercer eslabón de la cadena A→B→C→B.
--   919-923              — buscadores (leads.user_id) de LEAD_ADMIN/CLOSED/NULL/DELETED/CHAIN.
--   LEADS: 951 MAIN (agente 907, abierto) · 952 ADMIN (agente 903) · 953 CLOSED (agente 916,
--   closed_won_rent) · 954 NULL_AGENCY (agente 914, agency_id NULL) · 955 DELETED (agente 903,
--   deleted_at) · 956 CHAIN (agente 917, para la cadena de idempotencia).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000002699' || lpad(i::text, 2, '0'))::uuid,
       'u' || i || '.269e2@test.local'
from generate_series(1, 23) as s(i);

update public.users set role = 'admin'
  where id = '00000000-0000-0000-0000-000000269915';

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000269910', 'Inmobiliaria Reasignar 269.2', 'inmo-reasignar-269-2',
   'active', '00000000-0000-0000-0000-000000269901'),
  ('00000000-0000-0000-0000-000000269920', 'Inmobiliaria Ajena Reasignar 269.2', 'inmo-ajena-269-2',
   'active', '00000000-0000-0000-0000-000000269906');

insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000269910', '00000000-0000-0000-0000-000000269901', 'owner',  'active'),    -- OWNER_A
  ('00000000-0000-0000-0000-000000269910', '00000000-0000-0000-0000-000000269902', 'admin',  'active'),    -- ADMIN_A
  ('00000000-0000-0000-0000-000000269910', '00000000-0000-0000-0000-000000269903', 'agent',  'active'),    -- AGENT_RASO_A
  ('00000000-0000-0000-0000-000000269910', '00000000-0000-0000-0000-000000269904', 'viewer', 'active'),    -- VIEWER_A
  ('00000000-0000-0000-0000-000000269910', '00000000-0000-0000-0000-000000269905', 'owner',  'suspended'), -- OWNER_SUSP_A
  ('00000000-0000-0000-0000-000000269920', '00000000-0000-0000-0000-000000269906', 'owner',  'active'),    -- OWNER_B
  ('00000000-0000-0000-0000-000000269910', '00000000-0000-0000-0000-000000269907', 'agent',  'suspended'), -- FROM_AGENT
  ('00000000-0000-0000-0000-000000269910', '00000000-0000-0000-0000-000000269908', 'agent',  'active'),    -- TO_ACTIVE
  ('00000000-0000-0000-0000-000000269910', '00000000-0000-0000-0000-000000269909', 'viewer', 'active'),    -- TO_VIEWER
  ('00000000-0000-0000-0000-000000269910', '00000000-0000-0000-0000-000000269910', 'agent',  'suspended'), -- TO_SUSPENDED (¡ojo! ver nota abajo
  ('00000000-0000-0000-0000-000000269920', '00000000-0000-0000-0000-000000269911', 'agent',  'active'),    -- TO_OTHER_AGENCY
  ('00000000-0000-0000-0000-000000269910', '00000000-0000-0000-0000-000000269916', 'agent',  'active'),    -- AGENT_CLOSED
  ('00000000-0000-0000-0000-000000269910', '00000000-0000-0000-0000-000000269917', 'agent',  'active'),    -- AGENT_ORIGIN
  ('00000000-0000-0000-0000-000000269910', '00000000-0000-0000-0000-000000269918', 'agent',  'active');    -- AGENT_CHAIN_C

-- ⚠️ El id de agencia y el id de usuario TO_SUSPENDED comparten el literal '...269910' por
-- construcción del rango (agencia A y usuario 910 caen en el mismo bloque de 3 dígitos) — son
-- COLUMNAS DISTINTAS (agency_id vs user_id) en la MISMA fila y postgres no los confunde; se dej
-- explícito aquí para que quien lea el fixture no lo lea como error de copy-paste.

insert into public.leads (id, agent_id, user_id, status, agency_id) values
  ('00000000-0000-0000-0000-000000269951', '00000000-0000-0000-0000-000000269907', '00000000-0000-0000-0000-000000269913', 'new', '00000000-0000-0000-0000-000000269910'),
  ('00000000-0000-0000-0000-000000269952', '00000000-0000-0000-0000-000000269903', '00000000-0000-0000-0000-000000269919', 'new', '00000000-0000-0000-0000-000000269910'),
  ('00000000-0000-0000-0000-000000269953', '00000000-0000-0000-0000-000000269916', '00000000-0000-0000-0000-000000269920', 'closed_won_rent', '00000000-0000-0000-0000-000000269910'),
  ('00000000-0000-0000-0000-000000269954', '00000000-0000-0000-0000-000000269914', '00000000-0000-0000-0000-000000269921', 'new', null),
  ('00000000-0000-0000-0000-000000269956', '00000000-0000-0000-0000-000000269917', '00000000-0000-0000-0000-000000269923', 'new', '00000000-0000-0000-0000-000000269910');

insert into public.leads (id, agent_id, user_id, status, agency_id, deleted_at) values
  ('00000000-0000-0000-0000-000000269955', '00000000-0000-0000-0000-000000269903', '00000000-0000-0000-0000-000000269922', 'new', '00000000-0000-0000-0000-000000269910', now());

-- ════════════════════════════════════════════════════════════════════════════
-- 1) CATÁLOGO — firma, atributos, ACL, ancla de idempotencia. Seguro aunque no exista.
-- ════════════════════════════════════════════════════════════════════════════

select has_function('public', 'reassign_lead_atomic', array['uuid', 'uuid'],
  'SIG1_reassign_lead_atomic_existe_con_la_firma_declarada');

select is(
  (select pg_get_function_result(to_regprocedure('public.reassign_lead_atomic(uuid, uuid)'))),
  'void', 'SIG2_reassign_lead_atomic_returns_void'
);

select is(
  (select pg_get_function_arguments(to_regprocedure('public.reassign_lead_atomic(uuid, uuid)'))),
  'p_lead_id uuid, p_to_agent uuid', 'SIG3_reassign_lead_atomic_argumentos_EXACTOS'
);

select is(
  (select prosecdef from pg_proc where proname = 'reassign_lead_atomic' and pronamespace = 'public'::regnamespace),
  true, 'SIG4_reassign_lead_atomic_es_security_definer'
);

select is(
  (select provolatile from pg_proc where proname = 'reassign_lead_atomic' and pronamespace = 'public'::regnamespace),
  'v', 'SIG5_reassign_lead_atomic_es_volatile'
);

select is(
  (select proconfig from pg_proc where proname = 'reassign_lead_atomic' and pronamespace = 'public'::regnamespace),
  array['search_path=""']::text[],
  'SIG6_reassign_lead_atomic_search_path_vacio'
);

select is(
  (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'notifications_lead_reassigned_anchor_idx'),
  'CREATE UNIQUE INDEX notifications_lead_reassigned_anchor_idx ON public.notifications USING btree (user_id, related_entity_id, type) WHERE (type = ''lead_reassigned''::text)',
  'SIG7_indice_ancla_idempotencia_lead_reassigned_EXACTO'
);

select function_privs_are('public', 'reassign_lead_atomic', array['uuid', 'uuid'], 'anon', array[]::name[],
  'ACL1_reassign_lead_atomic_anon_SIN_execute');
select function_privs_are('public', 'reassign_lead_atomic', array['uuid', 'uuid'], 'authenticated', array['EXECUTE']::name[],
  'ACL2_reassign_lead_atomic_authenticated_CON_execute');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) ACL REAL — anon denegado en su PRIMERA invocación real (gotcha 203.1). SIN wrapper
--    compartido con authenticated.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select public.reassign_lead_atomic('00000000-0000-0000-0000-000000269951'::uuid, '00000000-0000-0000-0000-000000269908'::uuid) $$,
  '42501', null, 'ACLREAL1_anon_no_puede_ejecutar_reassign_lead_atomic'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) NOT_AUTHENTICATED — authenticated sin request.jwt.claims (auth.uid() null).
-- ════════════════════════════════════════════════════════════════════════════

set local role authenticated;
select set_config('request.jwt.claims', null, true);
insert into res_108 values ('AUTH1', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269951', '00000000-0000-0000-0000-000000269908'));
reset role;

select is((select v from res_108 where k = 'AUTH1'), 'P0001|NOT_AUTHENTICATED',
  'AUTH1_authenticated_sin_jwt_recibe_NOT_AUTHENTICATED');

-- ════════════════════════════════════════════════════════════════════════════
-- 4) LEAD_NOT_FOUND — un solo código para 8 causas distintas (anti-enumeración: el que no es
--    dueño de la conversación no puede distinguir "no existe" de "no tienes permiso").
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000269901'); -- OWNER_A (autorizado)
insert into res_108 values ('NF1', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269999', '00000000-0000-0000-0000-000000269908')); -- lead inexistente
insert into res_108 values ('NF2', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269955', '00000000-0000-0000-0000-000000269908')); -- lead BORRADO
insert into res_108 values ('NF3', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269954', '00000000-0000-0000-0000-000000269908')); -- agency_id NULL
reset role;

select is((select v from res_108 where k = 'NF1'), 'P0001|LEAD_NOT_FOUND',
  'NF1_lead_inexistente_LEAD_NOT_FOUND');
select is((select v from res_108 where k = 'NF2'), 'P0001|LEAD_NOT_FOUND',
  'NF2_lead_borrado_deleted_at_LEAD_NOT_FOUND');
select is((select v from res_108 where k = 'NF3'), 'P0001|LEAD_NOT_FOUND',
  'NF3_lead_con_agency_id_NULL_LEAD_NOT_FOUND');

select pg_temp.act_as('00000000-0000-0000-0000-000000269903'); -- AGENT_RASO_A
insert into res_108 values ('NF4', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269951', '00000000-0000-0000-0000-000000269908'));
reset role;
select is((select v from res_108 where k = 'NF4'), 'P0001|LEAD_NOT_FOUND',
  'NF4_caller_agente_raso_no_es_owner_ni_admin_LEAD_NOT_FOUND');

select pg_temp.act_as('00000000-0000-0000-0000-000000269904'); -- VIEWER_A
insert into res_108 values ('NF5', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269951', '00000000-0000-0000-0000-000000269908'));
reset role;
select is((select v from res_108 where k = 'NF5'), 'P0001|LEAD_NOT_FOUND',
  'NF5_caller_viewer_LEAD_NOT_FOUND');

select pg_temp.act_as('00000000-0000-0000-0000-000000269905'); -- OWNER_SUSP_A
insert into res_108 values ('NF6', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269951', '00000000-0000-0000-0000-000000269908'));
reset role;
select is((select v from res_108 where k = 'NF6'), 'P0001|LEAD_NOT_FOUND',
  'NF6_caller_owner_suspendido_LEAD_NOT_FOUND');

select pg_temp.act_as('00000000-0000-0000-0000-000000269906'); -- OWNER_B (ajena)
insert into res_108 values ('NF7', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269951', '00000000-0000-0000-0000-000000269908'));
reset role;
select is((select v from res_108 where k = 'NF7'), 'P0001|LEAD_NOT_FOUND',
  'NF7_caller_owner_de_otra_agencia_LEAD_NOT_FOUND');

select pg_temp.act_as('00000000-0000-0000-0000-000000269915'); -- PLATFORM_ADMIN, sin membresía
insert into res_108 values ('NF8', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269951', '00000000-0000-0000-0000-000000269908'));
reset role;
select is((select v from res_108 where k = 'NF8'), 'P0001|LEAD_NOT_FOUND',
  'NF8_admin_de_plataforma_sin_membresia_no_amplia_la_RPC_LEAD_NOT_FOUND');

-- ════════════════════════════════════════════════════════════════════════════
-- 5) SAME_USER — gana sobre TARGET_NOT_ACTIVE_MEMBER: el destino (907) es el mismo agente
--    ACTUAL del lead Y está suspendido — si el orden fuera al revés, este caso saldría
--    TARGET_NOT_ACTIVE_MEMBER.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000269901'); -- OWNER_A
insert into res_108 values ('SAME1', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269951', '00000000-0000-0000-0000-000000269907'));
reset role;
select is((select v from res_108 where k = 'SAME1'), 'P0001|SAME_USER',
  'SAME1_mismo_agente_gana_sobre_target_not_active_member');

-- ════════════════════════════════════════════════════════════════════════════
-- 6) TARGET_NOT_ACTIVE_MEMBER.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000269901'); -- OWNER_A
insert into res_108 values ('TGT1', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269951', '00000000-0000-0000-0000-000000269909')); -- viewer activo
insert into res_108 values ('TGT2', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269951', '00000000-0000-0000-0000-000000269910')); -- suspendido (distinto)
insert into res_108 values ('TGT3', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269951', '00000000-0000-0000-0000-000000269911')); -- activo SOLO en B
insert into res_108 values ('TGT4', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269951', '00000000-0000-0000-0000-000000269912')); -- sin membresía
reset role;

select is((select v from res_108 where k = 'TGT1'), 'P0001|TARGET_NOT_ACTIVE_MEMBER',
  'TGT1_destino_viewer_activo_no_puede_atender_leads');
select is((select v from res_108 where k = 'TGT2'), 'P0001|TARGET_NOT_ACTIVE_MEMBER',
  'TGT2_destino_suspendido_TARGET_NOT_ACTIVE_MEMBER');
select is((select v from res_108 where k = 'TGT3'), 'P0001|TARGET_NOT_ACTIVE_MEMBER',
  'TGT3_destino_activo_SOLO_en_otra_agencia_TARGET_NOT_ACTIVE_MEMBER');
select is((select v from res_108 where k = 'TGT4'), 'P0001|TARGET_NOT_ACTIVE_MEMBER',
  'TGT4_destino_sin_ninguna_membresia_TARGET_NOT_ACTIVE_MEMBER');

-- ════════════════════════════════════════════════════════════════════════════
-- 7) ORDEN — cruces no triviales del D-ORDER fijado por el contrato.
-- ════════════════════════════════════════════════════════════════════════════

-- ORDER1: caller NO autorizado (raso) + p_to_agent = agente actual (SAME_USER) Y suspendido
-- (TARGET_NOT_ACTIVE_MEMBER) — si la autorización no fuera lo PRIMERO tras NOT_AUTHENTICATED,
-- este caso saldría SAME_USER o TARGET_NOT_ACTIVE_MEMBER en vez de LEAD_NOT_FOUND.
select pg_temp.act_as('00000000-0000-0000-0000-000000269903'); -- AGENT_RASO_A, NO autorizado
insert into res_108 values ('ORDER1', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269951', '00000000-0000-0000-0000-000000269907'));
reset role;
select is((select v from res_108 where k = 'ORDER1'), 'P0001|LEAD_NOT_FOUND',
  'ORDER1_lead_not_found_gana_sobre_same_user_y_target_not_active_member');

-- ORDER2: sin sesión (NOT_AUTHENTICATED) + lead inexistente (LEAD_NOT_FOUND si se alcanzara) —
-- NOT_AUTHENTICATED debe ganar por ser la PRIMERA verificación.
set local role authenticated;
select set_config('request.jwt.claims', null, true);
insert into res_108 values ('ORDER2', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269999', '00000000-0000-0000-0000-000000269908'));
reset role;
select is((select v from res_108 where k = 'ORDER2'), 'P0001|NOT_AUTHENTICATED',
  'ORDER2_not_authenticated_gana_sobre_lead_not_found');

-- ════════════════════════════════════════════════════════════════════════════
-- 8) HAPPY PATH (OWNER) + integración con crm_agency_overview (269.1, ya vivo en el local):
--    el lead de un agente suspendido deja de listarse como 'unmanaged' tras la reasignación.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000269901'); -- OWNER_A
insert into res_108 values ('OVERVIEW_PRE', (
  select count(*)::text from public.crm_agency_overview('00000000-0000-0000-0000-000000269910'::uuid)
  where kind = 'unmanaged' and lead_id = '00000000-0000-0000-0000-000000269951'::uuid
));
reset role;
select is((select v from res_108 where k = 'OVERVIEW_PRE'), '1',
  'OVERVIEW_PRE_lead_del_agente_suspendido_aparece_unmanaged_antes_de_reasignar');

select pg_temp.act_as('00000000-0000-0000-0000-000000269901'); -- OWNER_A
insert into res_108 values ('HAPPY1', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269951', '00000000-0000-0000-0000-000000269908'));
reset role;
select is((select v from res_108 where k = 'HAPPY1'), 'ok',
  'HAPPY1_owner_reasigna_sin_error');

select is(
  (select agent_id::text from public.leads where id = '00000000-0000-0000-0000-000000269951'),
  '00000000-0000-0000-0000-000000269908',
  'HAPPY2_agent_id_cambia_al_destino'
);
select is(
  (select agency_id::text from public.leads where id = '00000000-0000-0000-0000-000000269951'),
  '00000000-0000-0000-0000-000000269910',
  'HAPPY3_agency_id_NO_cambia'
);

select is(
  (select aa.action_type || '|' || aa.entity_type || '|' || aa.admin_id::text || '|' ||
          (aa.old_values ->> 'from_agent_id') || '|' || (aa.new_values ->> 'to_agent_id')
     from public.admin_actions aa
    where aa.action_type = 'lead_reassigned' and aa.entity_id = '00000000-0000-0000-0000-000000269951'),
  'lead_reassigned|lead|00000000-0000-0000-0000-000000269901|'
  || '00000000-0000-0000-0000-000000269907|00000000-0000-0000-0000-000000269908',
  'HAPPY4_admin_actions_registra_actor_lead_agente_origen_y_destino'
);

select is(
  (select count(*)::int from public.notifications
    where type = 'lead_reassigned'
      and user_id = '00000000-0000-0000-0000-000000269908'
      and related_entity_id = '00000000-0000-0000-0000-000000269951'),
  1, 'HAPPY5_el_destino_recibe_1_notificacion_lead_reassigned'
);
select is(
  (select count(*)::int from public.notifications
    where type = 'lead_reassigned' and user_id = '00000000-0000-0000-0000-000000269913'), -- SEARCHER_MAIN
  0, 'HAPPY6_el_buscador_NUNCA_recibe_notificacion_D10_bis'
);
select is(
  (select count(*)::int from public.notifications
    where type = 'lead_reassigned' and user_id = '00000000-0000-0000-0000-000000269907'), -- FROM_AGENT
  0, 'HAPPY7_el_agente_origen_NO_recibe_notificacion'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000269901'); -- OWNER_A
insert into res_108 values ('OVERVIEW_POST', (
  select count(*)::text from public.crm_agency_overview('00000000-0000-0000-0000-000000269910'::uuid)
  where kind = 'unmanaged' and lead_id = '00000000-0000-0000-0000-000000269951'::uuid
));
reset role;
select is((select v from res_108 where k = 'OVERVIEW_POST'), '0',
  'OVERVIEW_POST_el_lead_ya_no_aparece_unmanaged_tras_la_reasignacion');

-- ════════════════════════════════════════════════════════════════════════════
-- 9) HAPPY PATH (ADMIN) — el admin también puede reasignar, no solo el owner.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000269902'); -- ADMIN_A
insert into res_108 values ('ADMINOK1', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269952', '00000000-0000-0000-0000-000000269908'));
reset role;
select is((select v from res_108 where k = 'ADMINOK1'), 'ok',
  'ADMINOK1_admin_tambien_puede_reasignar');
select is(
  (select agent_id::text from public.leads where id = '00000000-0000-0000-0000-000000269952'),
  '00000000-0000-0000-0000-000000269908',
  'ADMINOK2_agent_id_cambia_al_destino'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 10) LEAD CERRADO — D-CLOSED: se reasigna igual, el status no cambia.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000269901'); -- OWNER_A
insert into res_108 values ('CLOSED1', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269953', '00000000-0000-0000-0000-000000269908'));
reset role;
select is((select v from res_108 where k = 'CLOSED1'), 'ok',
  'CLOSED1_un_lead_cerrado_se_reasigna_sin_error');
select is(
  (select agent_id::text from public.leads where id = '00000000-0000-0000-0000-000000269953'),
  '00000000-0000-0000-0000-000000269908',
  'CLOSED2_agent_id_cambia_al_destino'
);
select is(
  (select status::text from public.leads where id = '00000000-0000-0000-0000-000000269953'),
  'closed_won_rent',
  'CLOSED3_el_status_NO_cambia_al_reasignar'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 11) IDEMPOTENCIA DE LA NOTIFICACIÓN — A→B→C→B: admin_actions inserta las 3 veces (auditoría
--     completa), la notificación a B (destino repetido) queda en UNA sola fila (ancla).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000269901'); -- OWNER_A
insert into res_108 values ('CHAIN1', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269956', '00000000-0000-0000-0000-000000269908')); -- A(917)→B(908)
reset role;
select is((select v from res_108 where k = 'CHAIN1'), 'ok', 'CHAIN1_primera_reasignacion_A_a_B_ok');

select pg_temp.act_as('00000000-0000-0000-0000-000000269901');
insert into res_108 values ('CHAIN2', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269956', '00000000-0000-0000-0000-000000269918')); -- B(908)→C(918)
reset role;
select is((select v from res_108 where k = 'CHAIN2'), 'ok', 'CHAIN2_segunda_reasignacion_B_a_C_ok');

select pg_temp.act_as('00000000-0000-0000-0000-000000269901');
insert into res_108 values ('CHAIN3', pg_temp.reassign_lead(
  '00000000-0000-0000-0000-000000269956', '00000000-0000-0000-0000-000000269908')); -- C(918)→B(908) otra vez
reset role;
select is((select v from res_108 where k = 'CHAIN3'), 'ok', 'CHAIN3_tercera_reasignacion_C_a_B_otra_vez_ok');

select is(
  (select count(*)::int from public.admin_actions
    where action_type = 'lead_reassigned' and entity_id = '00000000-0000-0000-0000-000000269956'),
  3, 'CHAIN4_admin_actions_registra_las_3_reasignaciones_auditoria_completa'
);
select is(
  (select count(*)::int from public.notifications
    where type = 'lead_reassigned'
      and user_id = '00000000-0000-0000-0000-000000269908'
      and related_entity_id = '00000000-0000-0000-0000-000000269956'),
  1, 'CHAIN5_la_notificacion_al_destino_repetido_B_queda_en_UNA_sola_fila_ancla'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 12) ATOMICIDAD — sobre LEAD_MAIN se hicieron ~9 llamadas que fallaron (NF4/SAME1/TGT1-4/
--     ORDER1 + AUTH1/ORDER2 que ni siquiera llegan al lead) ANTES del único HAPPY1 exitoso:
--     admin_actions para ese lead debe tener EXACTAMENTE 1 fila, nunca una fila fantasma de un
--     intento que abortó a medias.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.admin_actions
    where action_type = 'lead_reassigned' and entity_id = '00000000-0000-0000-0000-000000269951'),
  1, 'ATOMIC1_solo_1_fila_de_auditoria_pese_a_los_intentos_fallidos_previos'
);

select * from finish();
rollback;
