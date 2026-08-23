-- Tests pgTAP — RPC public.set_agency_status_atomic (tarea #211, subtarea 211.1).
-- Ejecutar con:
--   supabase test db supabase/tests/67_set_agency_status_atomic_test.sql --local
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL HUECO: el trigger `handle_agency_status_change()` (71.5, extendido en
-- 169.2/210.1) YA valida la máquina de estados {pending_approval→active,
-- pending_approval→rejected, active→suspended, suspended→active}, YA cascada
-- sobre `ads` (suspender pausa los ads active de la organización marcando
-- paused_by_suspension=true; reactivar resume SOLO esos, vía el GUC
-- urbea.ad_cascade_reactivation) y YA audita en admin_actions — todo dentro
-- de la MISMA transacción. Pero, igual que moderate_ad_atomic (#208.1) y el
-- overload de 4 argumentos de set_org_advertising_atomic (#209.1), el trigger
-- exige un admin identificado vía private.resolve_admin_actor(), que resuelve
-- por (1) auth.uid() de un JWT cuyo dueño sea role='admin', o (2) el GUC de
-- sesión `urbea.admin_actor_id` YA instalado. Una Edge Function con
-- service_role NO tiene auth.uid(), y un `set_config` hecho por PostgREST en
-- una llamada aparte no sobrevive fuera de esa transacción. Sin esta RPC,
-- suspender/reactivar una organización desde la app fallaría con
-- STATUS_CHANGE_REQUIRES_ADMIN el 100% de las veces — hoy el único camino real
-- es Studio/SQL a mano (decisión D3 de 71.5: agencies.status está excluido del
-- GRANT de columna a `authenticated`).
--
-- 🔴 LO QUE ESTA RPC **NO** HACE, A PROPÓSITO (mismo espíritu que
-- moderate_ad_atomic y el overload de set_org_advertising_atomic):
--   · NO valida el grafo de transiciones — el trigger es la ÚNICA autoridad.
--     Reafirmarlo aquí crearía una segunda copia que podría desincronizarse
--     (#183, la ventana del reaper duplicada entre dos EFs).
--   · NO cascada sobre `ads` — el trigger ya lo hace (169.2/210.1). AGST7/11
--     verifican esa cascada VÍA la RPC con UN assert cada uno, no la
--     re-testean: la matriz completa ya vive en 48_ads_state_machine_test.sql
--     (AGMATRIZ1-14) y 66_ad_takedown_test.sql (TKD1-27).
--   · NO escribe admin_actions — el trigger ya inserta esa fila. Duplicarla
--     haría que la auditoría contara DOBLE sobre un acto facturable.
-- Su trabajo completo son tres cosas: identificar al admin, hacer UN update, y
-- devolver el número de filas afectadas para que quien llame pueda distinguir
-- "la agencia no existe" (0 filas, sin excepción → 404) de "el trigger dijo
-- que no" (excepción P0001 → 409).
--
-- 🔒 SOLO service_role — instala un admin_actor ARBITRARIO en el GUC: en
-- manos de `authenticated` sería escalada de privilegios directa.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 CORRECCIÓN AL PLAN 211.1, VERIFICADA CONTRA EL TRIGGER VIGENTE (no
-- inventada): el plan original suponía "suspender una agencia YA suspendida →
-- P0001 INVALID_STATUS_TRANSITION". Se verificó EN VIVO contra
-- handle_agency_status_change() (`docker exec supabase_db_urbea-app psql`,
-- UPDATE directo con status idéntico) que **NO** es así: el trigger se creó
-- con `for each row when (old.status is distinct from new.status)`
-- (20260805000007:169-174) — un UPDATE que reescribe el MISMO status NUNCA
-- dispara el trigger. Es un no-op idempotente: 1 fila afectada, SIN excepción,
-- SIN nueva fila de auditoría, y sin exigir siquiera un admin identificado
-- (el trigger, que es quien resuelve el actor, no llega a correr). AGST19 fija
-- ese comportamiento real. La transición genuinamente inválida y alcanzable
-- por esta RPC (next_status limitado a {active,suspended} por su propio
-- guard) es partir de un estado que NO es ni active ni suspended —
-- pending_approval→suspended, que 48_ads_state_machine_test.sql ya marca como
-- "sigue fallando, no se amplía la matriz" (AGMATRIZ5) — AGST17/18 la fijan
-- aquí como lo que la RPC debe PROPAGAR sin traducir.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(20);

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token,
                        email_change_token_new, email_change)
values
  ('a0000000-0000-0000-0000-000000211001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin211@urbea.test', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('a0000000-0000-0000-0000-000000211002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'nadmin211@urbea.test', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

-- ⚠️ Un trigger sobre auth.users ya espeja la fila hacia public.users, así que
-- un INSERT plano choca con users_pkey. Se hace UPSERT y lo que importa —el
-- `role`— se fija explícitamente: el espejo crea al usuario con role='user'.
insert into public.users (id, first_name, last_name, email, role)
values
  ('a0000000-0000-0000-0000-000000211001', 'Admin', 'Doce11', 'admin211@urbea.test', 'admin'),
  ('a0000000-0000-0000-0000-000000211002', 'No', 'Admin211', 'nadmin211@urbea.test', 'agent')
on conflict (id) do update set role = excluded.role;

-- CASC: agencia activa con UN ad activo — ejercita el ciclo completo
-- suspender→reactivar y su cascada (AGST5-12).
insert into public.agencies (id, name, slug, status, created_by_user_id,
                             can_publish_properties, can_advertise, advertiser_category)
values
  ('b0000000-0000-0000-0000-000000211011', 'Cascada Test 211', 'cascada-211', 'active',
   'a0000000-0000-0000-0000-000000211001', false, true, 'seguros');

insert into public.ad_creatives (id, agency_id, cloudflare_uid, duration_seconds, status)
values
  ('c0000000-0000-0000-0000-000000211012', 'b0000000-0000-0000-0000-000000211011',
   'uid-211-cascada', 15, 'ready');

insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value,
                        status, starts_at, ends_at)
values
  ('d0000000-0000-0000-0000-000000211013', 'b0000000-0000-0000-0000-000000211011',
   'c0000000-0000-0000-0000-000000211012', 'Anuncio cascada 211', 'external_url',
   'https://ejemplo.mx', 'active', now() - interval '1 day', now() + interval '20 days');

-- CASC_REACT: agencia sembrada DIRECTO en 'suspended' con un ad YA paused +
-- paused_by_suspension=true (para AGST9-12, el path de REACTIVAR). 🔴 A
-- PROPÓSITO no se reusa CASC/AGST5-8 para esto (un round-trip
-- suspender→reactivar sobre la MISMA agencia que arrancó 'active'): mientras
-- la RPC no exista, el estado final esperado de "reactivar" coincidiría por
-- COINCIDENCIA con el valor original nunca tocado ('active'), y el caso
-- pasaría TRIVIALMENTE en RED sin haber ejercitado nada — el mismo hueco que
-- EC-15 de moderate-ad ya cazó una vez (un test que no puede distinguir no
-- protege). Arrancar YA en 'suspended'/'paused' garantiza que un RED real
-- (la RPC no toca nada) deja el estado ORIGINAL, que es DISTINTO del
-- esperado tras reactivar.
insert into public.agencies (id, name, slug, status, created_by_user_id,
                             can_publish_properties, can_advertise, advertiser_category)
values
  ('b0000000-0000-0000-0000-000000211041', 'Cascada React 211', 'cascada-react-211', 'suspended',
   'a0000000-0000-0000-0000-000000211001', false, true, 'seguros');

insert into public.ad_creatives (id, agency_id, cloudflare_uid, duration_seconds, status)
values
  ('c0000000-0000-0000-0000-000000211042', 'b0000000-0000-0000-0000-000000211041',
   'uid-211-react', 15, 'ready');

insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value,
                        status, starts_at, ends_at, paused_at, paused_by_suspension)
values
  ('d0000000-0000-0000-0000-000000211043', 'b0000000-0000-0000-0000-000000211041',
   'c0000000-0000-0000-0000-000000211042', 'Anuncio pausado por suspensión 211', 'external_url',
   'https://ejemplo.mx', 'paused', now() - interval '10 days', now() + interval '20 days',
   now() - interval '2 days', true);

-- ALRSUSP: agencia sembrada DIRECTO en 'suspended' (el INSERT no dispara el
-- trigger BEFORE UPDATE) — para el caso "re-suspender lo ya suspendido" (AGST19).
insert into public.agencies (id, name, slug, status, created_by_user_id,
                             can_publish_properties, can_advertise, advertiser_category)
values
  ('b0000000-0000-0000-0000-000000211021', 'Ya Suspendida 211', 'ya-suspendida-211', 'suspended',
   'a0000000-0000-0000-0000-000000211001', true, false, null);

-- PEND: agencia en pending_approval — para la transición genuinamente
-- inválida alcanzable por esta RPC (AGST17/18).
insert into public.agencies (id, name, slug, status, created_by_user_id,
                             can_publish_properties, can_advertise, advertiser_category)
values
  ('b0000000-0000-0000-0000-000000211031', 'Pendiente 211', 'pendiente-211', 'pending_approval',
   'a0000000-0000-0000-0000-000000211001', true, false, null);

-- ── 1. La RPC existe con la firma esperada ──────────────────────────────────
select has_function(
  'public', 'set_agency_status_atomic',
  array['uuid', 'text', 'uuid'],
  'AGST1: set_agency_status_atomic(p_agency_id, p_next_status, p_admin_id) existe'
);

select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_agency_status_atomic'),
  true,
  'AGST2: es SECURITY DEFINER'
);

-- 🔒 Un acto administrativo NO puede quedar al alcance de authenticated: la
-- RPC instala un admin_actor arbitrario en el GUC. Solo service_role.
--
-- 🔴 `has_function_privilege(text, 'firma(text)', text)` hace un cast interno
-- a regprocedure: sobre una función que TODAVÍA no existe, ese cast por sí
-- solo lanza `42883 function does not exist` SIN protección (a diferencia de
-- lives_ok/throws_ok, que sí envuelven su EXECUTE en un handler) y aborta el
-- resto del script — se comprobó en vivo. La forma `(role, oid, priv)` NO
-- hace ese cast: se resuelve el oid vía pg_proc con un LEFT JOIN implícito
-- (subquery vacía = NULL), así que mientras la RPC no exista esto falla por
-- ASERCIÓN limpia (`... is true` sobre NULL = false), no por excepción.
select ok(
  (
    select not has_function_privilege('authenticated', p.oid, 'EXECUTE')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_agency_status_atomic' and p.pronargs = 3
  ) is true,
  'AGST3: authenticated NO puede ejecutarla'
);
select ok(
  (
    select not has_function_privilege('anon', p.oid, 'EXECUTE')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_agency_status_atomic' and p.pronargs = 3
  ) is true,
  'AGST4: anon NO puede ejecutarla'
);

-- ── 2. Suspender (active → suspended) ───────────────────────────────────────
select lives_ok(
  $$ select public.set_agency_status_atomic(
       'b0000000-0000-0000-0000-000000211011'::uuid, 'suspended',
       'a0000000-0000-0000-0000-000000211001'::uuid) $$,
  'AGST5: suspender una agencia active no lanza'
);

select is(
  (select status::text from public.agencies where id = 'b0000000-0000-0000-0000-000000211011'),
  'suspended',
  'AGST6: la agencia quedó suspended'
);

-- 🔴 Cascada (169.2/210.1) VÍA la RPC — un assert, no re-testear la matriz
-- completa (ya cubierta en 48/66).
select results_eq(
  $$ select status::text, paused_by_suspension from public.ads
      where id = 'd0000000-0000-0000-0000-000000211013' $$,
  $$ values ('paused', true) $$,
  'AGST7: el ad active de la agencia quedó paused con paused_by_suspension=true (cascada del trigger, vía la RPC)'
);

-- La auditoría la escribe el TRIGGER, no la RPC — un solo assert combinado
-- (action_type + admin_id) evita, si la RPC insertara la suya, un doble
-- conteo silencioso.
select results_eq(
  $$ select action_type, admin_id from public.admin_actions
      where entity_type = 'agency' and entity_id = 'b0000000-0000-0000-0000-000000211011'
      order by created_at desc limit 1 $$,
  $$ values ('suspend_agency'::text, 'a0000000-0000-0000-0000-000000211001'::uuid) $$,
  'AGST8: EXACTAMENTE una fila de auditoría suspend_agency, con el admin que pasó la RPC'
);

-- ── 3. Reactivar (suspended → active) — sobre CASC_REACT, sembrada YA
--    suspendida/pausada (ver nota en el fixture: evita el falso-verde de un
--    round-trip sobre una agencia que arrancó 'active') ───────────────────────
select lives_ok(
  $$ select public.set_agency_status_atomic(
       'b0000000-0000-0000-0000-000000211041'::uuid, 'active',
       'a0000000-0000-0000-0000-000000211001'::uuid) $$,
  'AGST9: reactivar una agencia suspended no lanza'
);

select is(
  (select status::text from public.agencies where id = 'b0000000-0000-0000-0000-000000211041'),
  'active',
  'AGST10: la agencia quedó active'
);

select results_eq(
  $$ select status::text, paused_by_suspension from public.ads
      where id = 'd0000000-0000-0000-0000-000000211043' $$,
  $$ values ('active', false) $$,
  'AGST11: el ad pausado por la cascada revivió a active y paused_by_suspension volvió a false'
);

select results_eq(
  $$ select action_type, admin_id from public.admin_actions
      where entity_type = 'agency' and entity_id = 'b0000000-0000-0000-0000-000000211041'
        and action_type = 'reactivate_agency'
      order by created_at desc limit 1 $$,
  $$ values ('reactivate_agency'::text, 'a0000000-0000-0000-0000-000000211001'::uuid) $$,
  'AGST12: EXACTAMENTE una fila de auditoría reactivate_agency, con el admin que pasó la RPC'
);

-- ── 4. Guard propio de la RPC: p_next_status fuera de {active,suspended} ────
-- Frontera de confianza: agency_status tiene 5 valores y solo dos son un
-- resultado de esta RPC. Sin este guard, un caller podría empujar 'rejected'
-- o 'pending_approval' —valores que EXISTEN en el enum— saltándose la
-- semántica de "suspender/reactivar". Se valida ANTES de tocar la fila.
select throws_ok(
  $$ select public.set_agency_status_atomic(
       'b0000000-0000-0000-0000-000000211031'::uuid, 'rejected',
       'a0000000-0000-0000-0000-000000211001'::uuid) $$,
  'P0001',
  'INVALID_NEXT_STATUS',
  'AGST13: p_next_status=rejected se rechaza en el guard de la RPC, antes del trigger'
);

select throws_ok(
  $$ select public.set_agency_status_atomic(
       'b0000000-0000-0000-0000-000000211031'::uuid, 'pending_approval',
       'a0000000-0000-0000-0000-000000211001'::uuid) $$,
  'P0001',
  'INVALID_NEXT_STATUS',
  'AGST14: p_next_status=pending_approval se rechaza en el guard de la RPC'
);

select throws_ok(
  $$ select public.set_agency_status_atomic(
       'b0000000-0000-0000-0000-000000211031'::uuid, 'esto-no-es-un-estado',
       'a0000000-0000-0000-0000-000000211001'::uuid) $$,
  'P0001',
  'INVALID_NEXT_STATUS',
  'AGST15: p_next_status = basura arbitraria se rechaza en el guard de la RPC'
);

-- ── 5. Agencia inexistente: 0 filas, sin excepción ──────────────────────────
-- La EF necesita distinguir "no existe" (→404) de "el trigger dijo que no"
-- (→409). La RPC devuelve el número de filas afectadas. Se captura el
-- resultado vía un DO block con su propio manejo de excepción (en vez de un
-- `select is(...)` directo sobre la llamada) para que, mientras la RPC no
-- exista, este caso falle por ASERCIÓN (sentinela -1 ≠ 0) en vez de abortar
-- el resto del script — mismo espíritu que lives_ok/throws_ok arriba, que sí
-- están protegidos nativamente por pgTAP.
create temporary table zz_agst_capture (case_id text primary key, v_rows integer);

do $$
begin
  insert into zz_agst_capture (case_id, v_rows) values (
    'nonexistent_agency',
    coalesce((select public.set_agency_status_atomic(
      'b0000000-0000-0000-0000-0000002110ff'::uuid, 'suspended',
      'a0000000-0000-0000-0000-000000211001'::uuid)), -999)
  );
exception when others then
  insert into zz_agst_capture (case_id, v_rows) values ('nonexistent_agency', -1);
end $$;

select is(
  (select v_rows from zz_agst_capture where case_id = 'nonexistent_agency'),
  0,
  'AGST16: un agency_id inexistente devuelve 0 filas afectadas, NO una excepción'
);

-- ── 6. Lo que el trigger rechaza, la RPC propaga sin traducir ──────────────
-- pending_approval → suspended NO está en el grafo (AGMATRIZ5 en
-- 48_ads_state_machine_test.sql ya lo fija: "sigue fallando, no se agrega a
-- la matriz"). El guard de esta RPC deja pasar 'suspended' como
-- p_next_status válido — es el TRIGGER quien la rechaza.
select throws_ok(
  $$ select public.set_agency_status_atomic(
       'b0000000-0000-0000-0000-000000211031'::uuid, 'suspended',
       'a0000000-0000-0000-0000-000000211001'::uuid) $$,
  'P0001',
  'INVALID_STATUS_TRANSITION',
  'AGST17: pending_approval->suspended lo rechaza el TRIGGER (INVALID_STATUS_TRANSITION), la RPC no lo arregla'
);

select is(
  (select status::text from public.agencies where id = 'b0000000-0000-0000-0000-000000211031'),
  'pending_approval',
  'AGST18: tras el intento bloqueado, la agencia PEND sigue en pending_approval (sin efecto parcial)'
);

-- ── 7. 🔴 Corrección verificada: re-suspender lo YA suspendido es un no-op
--    idempotente, NO una excepción (ver nota al inicio del archivo). El WHEN
--    clause del trigger (old.status IS DISTINCT FROM new.status) ni siquiera
--    lo dispara: 1 fila afectada, CERO filas nuevas en admin_actions. Un solo
--    assert combinado (rows_affected + audit_delta) para que, mientras la RPC
--    no exista, el sentinela -1 en rows_affected haga fallar el caso incluso
--    aunque audit_delta trivialmente dé 0 en ambos mundos.
do $$
declare
  v_audit_before bigint;
  v_rows integer;
begin
  select count(*) into v_audit_before from public.admin_actions
    where entity_type = 'agency' and entity_id = 'b0000000-0000-0000-0000-000000211021';

  begin
    v_rows := public.set_agency_status_atomic(
      'b0000000-0000-0000-0000-000000211021'::uuid, 'suspended',
      'a0000000-0000-0000-0000-000000211001'::uuid);
  exception when others then
    v_rows := -1;
  end;

  insert into zz_agst_capture (case_id, v_rows) values ('idempotent_resuspend', v_rows);
  insert into zz_agst_capture (case_id, v_rows) values (
    'idempotent_resuspend_audit_delta',
    (
      (select count(*) from public.admin_actions
        where entity_type = 'agency' and entity_id = 'b0000000-0000-0000-0000-000000211021')
      - v_audit_before
    )::integer
  );
end $$;

select results_eq(
  $$ select case_id, v_rows from zz_agst_capture
      where case_id in ('idempotent_resuspend', 'idempotent_resuspend_audit_delta')
      order by case_id $$,
  $$ values ('idempotent_resuspend', 1), ('idempotent_resuspend_audit_delta', 0) $$,
  'AGST19: re-suspender una agencia YA suspendida es un no-op idempotente — 1 fila afectada, CERO auditoría nueva (el trigger nunca dispara: WHEN old.status IS DISTINCT FROM new.status)'
);

-- ── 8. Un admin que no es admin (defensa en profundidad, sobre una transición
--    GENUINA para que sí llegue al trigger) ─────────────────────────────────
-- El GUC solo cuenta si el uuid pertenece a un role='admin' real
-- (private.resolve_admin_actor lo verifica). Se ejercita sobre CASC, que a
-- estas alturas del archivo quedó 'suspended' (AGST5-8; AGST9 en adelante
-- opera sobre CASC_REACT, no sobre CASC) — reactivarla (suspended->active) SÍ
-- es una transición del grafo, así que si el guard de admin no existiera este
-- caso pasaría trivialmente. 🔴 A propósito NO se usa p_next_status=
-- 'suspended' aquí: CASC ya está suspended, y eso caería en el no-op
-- idempotente de AGST19 (el trigger nunca dispara sobre un WHEN sin cambio de
-- status, así que STATUS_CHANGE_REQUIRES_ADMIN jamás se levantaría — ni
-- siquiera con la RPC ya implementada correctamente).
select throws_ok(
  $$ select public.set_agency_status_atomic(
       'b0000000-0000-0000-0000-000000211011'::uuid, 'active',
       'a0000000-0000-0000-0000-000000211002'::uuid) $$,
  'P0001',
  'STATUS_CHANGE_REQUIRES_ADMIN',
  'AGST20: un p_admin_id que no es role=admin NO puede suspender/reactivar'
);

select * from finish();
rollback;
