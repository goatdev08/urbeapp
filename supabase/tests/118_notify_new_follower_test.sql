-- Tests pgTAP — aviso de nuevo seguidor (subtarea 78.2, tarea #78 «follow de cuentas F1»).
-- Ejecutar con:
--   supabase test db supabase/tests/118_notify_new_follower_test.sql --local
-- (CLI GLOBAL de brew, NUNCA npx supabase). Corre como superusuario (rol `postgres`, dueño
-- de las tablas -> bypassa RLS por ownership) dentro de una transacción revertida (no
-- persiste). Los fixtures y los follows se insertan CON impersonación (pg_temp.act_as,
-- mismo patrón que 117_follows_test.sql) porque follows_insert exige WITH CHECK
-- (follower_user_id = auth.uid()) — un insert crudo como superusuario bypassa esa policy
-- pero NO cambia el seam bajo prueba (el trigger reacciona al INSERT real en
-- public.follows, sea cual sea el actor que lo disparó).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba (comportamiento observable, NUNCA internals):
--   el efecto OBSERVABLE sobre public.notifications de un INSERT real en public.follows
--   (contrato de la fila insertada: type/title/body/deep_link/related_entity_type/
--   related_entity_id/data) + catálogo puro (función SECURITY DEFINER/search_path fijo,
--   trigger AFTER INSERT FOR EACH ROW en follows) — nunca el nombre de una variable interna.
-- SUT AÚN NO EXISTE (RED, 2026-09-13): lo crea
--   supabase/migrations/20260914100002_notify_new_follower.sql (agente `supabase`, fase
--   GREEN, calco de notify_comment_on_my_property/20260910300001). Este archivo NO la
--   escribe ni la aplica.
--
-- ── D-DEDUPE (decisión de Abraham 2026-09-13, fijada aquí) ──────────────────────────────
-- CADA follow nuevo avisa, SIN índice de dedupe: a diferencia de comment_on_my_property
-- (289.4, índice único parcial + ON CONFLICT DO NOTHING), un unfollow + refollow es un
-- evento de TRANSICIÓN nuevo y genera un segundo aviso (EC6, «sin dedupe»). Sin bloque
-- EXCEPTION: si el insert en notifications falla, el follow falla en la misma transacción
-- (EC-atomicidad).
--
-- ── Nombres que GREEN debe respetar (fijados aquí, test-author) ─────────────────────────
--   public.notify_new_follower()             -- función SECURITY DEFINER, search_path=''.
--   follows_notify_new_follower                -- trigger AFTER INSERT FOR EACH ROW en
--     public.follows, ejecuta la función de arriba.
--
-- ── Anti-cheat (memorias del vault) ─────────────────────────────────────────────────────
-- pgtap_execute_acl_plancache: EC-RLS (antes EC8) impersona B y A con SQL literal propio
-- para cada rol (ninguno reusa el texto de la consulta del otro rol).
-- reset_solo_se_prueba_desde_estado_poblado: EC-dedupe (antes EC6) cuenta el estado
-- poblado (1 fila de A->B) ANTES del unfollow, y solo entonces borra y vuelve a seguir
-- para comprobar la 2a fila — nunca asume "nace en 0".
-- pgtap_policy_dominada_por_select: la policy notifications_select ya existe (20260604
-- 000008/000010) y no se toca en esta subtarea; EC-RLS solo la EJERCITA con las filas
-- nuevas del trigger, no la vuelve a probar de cero.
-- tests_bomba_de_fecha_y_estado_inicial: los conteos de la sección EC-dedupe/EC-nadie son
-- LITERALES derivados a mano de la secuencia exacta de inserts/deletes de este archivo
-- (nunca recomputados con el mismo `count(*) as of now` que usaría el propio SUT).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(19);

-- Impersonación (mismo patrón que 02/.../109/112/116/117).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '00000000-0000-0000-0000-000000118XXX' (subtarea 78.2, archivo
-- 118 — sin colisión con 117XXX de 78.1, verificado por grep).
--   001 A (Ana) — full_name='Ana Prueba' en user_preferences. Sigue a B (EC-contrato,
--       EC-body-con-nombre, EC-RLS, EC-dedupe). NUNCA recibe aviso propio (EC-nadie).
--   002 B — el seguido. SIN fila en user_preferences (EC-direccion-sin-prefs) — recibe
--       los avisos de A, C y D.
--   003 C — SIN fila en user_preferences. Sigue a B (EC-body-sin-nombre, rama "sin fila").
--   004 D — user_preferences.full_name = '' (vacío, no null). Sigue a B
--       (EC-body-sin-nombre, rama "cadena vacía").
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000118001', 'a.118@test.local'),
  ('00000000-0000-0000-0000-000000118002', 'b.118@test.local'),
  ('00000000-0000-0000-0000-000000118003', 'c.118@test.local'),
  ('00000000-0000-0000-0000-000000118004', 'd.118@test.local');

insert into public.user_preferences (user_id, full_name)
values ('00000000-0000-0000-0000-000000118001', 'Ana Prueba');

insert into public.user_preferences (user_id, full_name)
values ('00000000-0000-0000-0000-000000118004', '');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) CATÁLOGO — puro, no lanza aunque el SUT no exista todavía.
-- ════════════════════════════════════════════════════════════════════════════

-- EC1: la función existe, es SECURITY DEFINER y fija search_path explícito.
select ok(
  (select count(*)::int from pg_proc
    where proname = 'notify_new_follower' and pronamespace = 'public'::regnamespace) = 1,
  'EC1a_existe_public_notify_new_follower'
);
select is(
  (select prosecdef from pg_proc
    where proname = 'notify_new_follower' and pronamespace = 'public'::regnamespace),
  true, 'EC1b_notify_new_follower_es_security_definer'
);
select ok(
  coalesce((select exists (
     select 1 from pg_proc p, unnest(p.proconfig) cfg
      where p.proname = 'notify_new_follower' and p.pronamespace = 'public'::regnamespace
        and cfg like 'search_path=%'
   )), false),
  'EC1c_notify_new_follower_fija_search_path_explicito'
);

-- EC2: trigger follows_notify_new_follower en public.follows, AFTER INSERT, FOR EACH ROW,
-- resuelto por NOMBRE de función (consulta pg_trigger vía pg_get_triggerdef; el follows de
-- 78.1 ya tiene trg_follower_count, así que NO basta un conteo bruto de triggers).
select ok(
  (select count(*)::int from pg_trigger t
    where t.tgrelid = 'public.follows'::regclass
      and not t.tgisinternal
      and t.tgname = 'follows_notify_new_follower') = 1,
  'EC2a_existe_el_trigger_follows_notify_new_follower_en_follows'
);
select ok(
  (select exists (
     select 1 from pg_trigger t
     join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.follows'::regclass and not t.tgisinternal
      and t.tgname = 'follows_notify_new_follower'
      and p.proname = 'notify_new_follower'
      and pg_get_triggerdef(t.oid) ~* 'after\s+insert'
   )),
  'EC2b_el_trigger_es_AFTER_INSERT_y_ejecuta_notify_new_follower'
);
select ok(
  (select exists (
     select 1 from pg_trigger t
    where t.tgrelid = 'public.follows'::regclass and not t.tgisinternal
      and t.tgname = 'follows_notify_new_follower'
      and pg_get_triggerdef(t.oid) ~* 'for\s+each\s+row'
   )),
  'EC2c_el_trigger_es_FOR_EACH_ROW'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) COMPORTAMIENTO — A sigue a B (impersonado, mismo patrón que follows_insert de 117).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000118001'); -- A
insert into public.follows (follower_user_id, followed_user_id) values
  ('00000000-0000-0000-0000-000000118001', '00000000-0000-0000-0000-000000118002');
reset role;

-- EC3: contrato completo de la fila insertada en notifications para B (todo excepto el
-- body, que EC4 fija aparte con el nombre público real de A). Un solo assert fuerte sobre
-- un jsonb construido con los campos observables -- valores literales, no recomputados con
-- la misma expresión que usará el trigger.
select is(
  (select jsonb_build_object(
     'total', (select count(*)::int from public.notifications
                where user_id = '00000000-0000-0000-0000-000000118002'
                  and type = 'new_follower'),
     'type', type,
     'title', title,
     'deep_link', deep_link,
     'related_entity_type', related_entity_type,
     'related_entity_id', related_entity_id,
     'data_follower', data->>'follower_user_id'
   ) from public.notifications
    where user_id = '00000000-0000-0000-0000-000000118002' and type = 'new_follower'
    order by created_at limit 1),
  jsonb_build_object(
     'total', 1,
     'type', 'new_follower',
     'title', 'Nuevo seguidor',
     'deep_link', '/profile/00000000-0000-0000-0000-000000118001',
     'related_entity_type', 'user',
     'related_entity_id', '00000000-0000-0000-0000-000000118001',
     'data_follower', '00000000-0000-0000-0000-000000118001'
   ),
  'EC3_notificacion_completa_para_B_tras_A_sigue_a_B'
);

-- EC4: body con nombre público real de A ('Ana Prueba').
select is(
  (select body from public.notifications
    where user_id = '00000000-0000-0000-0000-000000118002' and type = 'new_follower'
    order by created_at limit 1),
  'Ana Prueba empezó a seguirte.',
  'EC4_body_usa_el_full_name_publico_del_seguidor'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) RLS — se ejercita AQUÍ, mientras B tiene EXACTAMENTE 1 aviso new_follower (antes de
--    que C/D sumen más), sobre la policy notifications_select ya existente (20260604000008/
--    000010) — SQL literal propio por rol (203.1: ningún rol reusa el texto del otro).
-- ════════════════════════════════════════════════════════════════════════════

-- EC-RLSa: B (impersonado) ve su propio aviso.
select pg_temp.act_as('00000000-0000-0000-0000-000000118002'); -- B
select is(
  (select count(*)::int from public.notifications where type = 'new_follower'),
  1, 'EC_RLSa_B_impersonado_ve_su_propio_aviso_de_new_follower'
);
reset role;

-- EC-RLSb: A (impersonado) NO ve el aviso de B (ni por user_id ni de ninguna otra forma:
-- RLS de notifications solo abre user_id propio o admin).
select pg_temp.act_as('00000000-0000-0000-0000-000000118001'); -- A
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000118002' and type = 'new_follower'),
  0, 'EC_RLSb_A_impersonado_no_ve_el_aviso_de_B'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Body sin nombre público — dos ramas (sin fila en user_preferences / full_name vacío).
-- ════════════════════════════════════════════════════════════════════════════

-- EC5a: C (sin fila en user_preferences) sigue a B.
select pg_temp.act_as('00000000-0000-0000-0000-000000118003'); -- C
insert into public.follows (follower_user_id, followed_user_id) values
  ('00000000-0000-0000-0000-000000118003', '00000000-0000-0000-0000-000000118002');
reset role;
select is(
  (select body from public.notifications
    where user_id = '00000000-0000-0000-0000-000000118002'
      and related_entity_id = '00000000-0000-0000-0000-000000118003'
      and type = 'new_follower'),
  'Alguien empezó a seguirte.',
  'EC5a_body_generico_cuando_el_seguidor_no_tiene_fila_en_user_preferences'
);

-- EC5b: D (full_name = '' vacío) sigue a B.
select pg_temp.act_as('00000000-0000-0000-0000-000000118004'); -- D
insert into public.follows (follower_user_id, followed_user_id) values
  ('00000000-0000-0000-0000-000000118004', '00000000-0000-0000-0000-000000118002');
reset role;
select is(
  (select body from public.notifications
    where user_id = '00000000-0000-0000-0000-000000118002'
      and related_entity_id = '00000000-0000-0000-0000-000000118004'
      and type = 'new_follower'),
  'Alguien empezó a seguirte.',
  'EC5b_body_generico_cuando_el_full_name_del_seguidor_es_cadena_vacia'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Dirección correcta con el seguido SIN user_preferences (B nunca tuvo fila).
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.user_preferences
    where user_id = '00000000-0000-0000-0000-000000118002'),
  0, 'EC9a_fixture_B_nunca_tuvo_fila_en_user_preferences'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000118002' and type = 'new_follower'),
  3, 'EC9b_B_sin_user_preferences_igual_acumula_los_3_avisos_de_A_C_D'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Sin dedupe — unfollow + refollow de A hacia B genera un SEGUNDO aviso.
-- ════════════════════════════════════════════════════════════════════════════

-- Estado poblado ANTES del unfollow (memoria: un reset solo se prueba desde estado poblado).
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000118002'
      and related_entity_id = '00000000-0000-0000-0000-000000118001'
      and type = 'new_follower'),
  1, 'EC6pre_B_tiene_exactamente_1_aviso_de_A_antes_del_unfollow'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000118001'); -- A
delete from public.follows
 where follower_user_id = '00000000-0000-0000-0000-000000118001'
   and followed_user_id = '00000000-0000-0000-0000-000000118002';
insert into public.follows (follower_user_id, followed_user_id) values
  ('00000000-0000-0000-0000-000000118001', '00000000-0000-0000-0000-000000118002');
reset role;

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000118002'
      and related_entity_id = '00000000-0000-0000-0000-000000118001'
      and type = 'new_follower'),
  2, 'EC6_el_unfollow_mas_refollow_de_A_genera_un_SEGUNDO_aviso_sin_dedupe'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) El seguidor NUNCA recibe aviso por sus propias acciones de seguir/dejar de seguir.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000118001' and type = 'new_follower'),
  0, 'EC7_A_nunca_recibe_un_aviso_new_follower_por_sus_propias_acciones'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8) Atomicidad — sin bloque EXCEPTION (decisión de Abraham: si notifications falla, el
--    follow falla en la misma transacción). Se resuelve por OID vía pg_proc (nunca con el
--    cast ...::regprocedure, que abortaría la transacción si la función aún no existe).
-- ════════════════════════════════════════════════════════════════════════════

select ok(
  coalesce((select pg_get_functiondef(p.oid) !~* 'exception'
     from pg_proc p
    where p.proname = 'notify_new_follower' and p.pronamespace = 'public'::regnamespace),
    false),
  'EC10_notify_new_follower_no_tiene_bloque_exception'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 9) Sin índice de dedupe (fija la decisión D-DEDUPE de Abraham).
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_indexes
    where tablename = 'notifications' and indexdef ilike '%new_follower%'),
  0, 'EC11_sin_indice_unico_parcial_de_dedupe_para_new_follower'
);

select * from finish();
rollback;
