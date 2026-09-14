-- Tests pgTAP — follow de cuentas (subtarea 78.1, tarea #78 «follow de cuentas F1»)
-- Ejecutar con:
--   supabase test db supabase/tests/117_follows_test.sql --local
-- (CLI GLOBAL de brew, NUNCA npx supabase). Corre como superusuario (rol `postgres`, dueño
-- de las tablas -> bypassa RLS por ownership, NO es superuser real) dentro de una
-- transacción revertida (no persiste). Los fixtures se insertan directo (bypass RLS); las
-- aserciones de comportamiento impersonan con pg_temp.act_as(uid,role) (mismo patrón que
-- 02/.../109/112/116).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba (comportamiento observable, NUNCA internals):
--   1) tabla public.follows (columnas, PK compuesta, FKs cascade, CHECK anti-autofollow) —
--      contrato de catálogo + comportamiento vía INSERT/DELETE reales.
--   2) public.users.follower_count (columna denormalizada) + la función trigger
--      public.update_follower_count() (AFTER INSERT OR DELETE en follows, SECURITY DEFINER,
--      search_path fijo, GREATEST(0,...) — nunca negativo) — comportamiento observable vía
--      el VALOR del contador, nunca invocando la función directo.
--   3) políticas follows_select / follows_insert / follows_delete vía impersonación JWT — SIN
--      policy de UPDATE.
--   4) vista public.agent_public_profiles con follower_count como ÚLTIMA columna (contrato
--      ya publicado — los builds instalados hacen `select('*')`/leen por posición nombrada,
--      NUNCA por índice, pero el orden es parte del contrato acordado con el GREEN).
-- SUT AÚN NO EXISTE (RED, 2026-09-13): lo crea
--   supabase/migrations/20260914100001_follows.sql (agente `supabase`, fase GREEN).
--
-- ── Por qué el archivo NO aborta por "relation does not exist" ──────────────────────────
-- A diferencia de 112_comments_test.sql (que acepta el abort parcial de la transacción tras
-- el primer INSERT crudo sobre una tabla inexistente — "patrón RED establecido en el repo"),
-- aquí CADA aserción de comportamiento se envuelve en algo que pgTAP/plpgsql ya atrapa con su
-- propio EXCEPTION WHEN OTHERS interno (throws_ok/lives_ok — verificado en el pg_proc real de
-- la instancia: ambos usan BEGIN/EXCEPTION, que crea un savepoint implícito y NUNCA propaga el
-- abort a la transacción externa) o en un helper pg_temp con su propio EXCEPTION (safe_count/
-- safe_bool/safe_rowcount/safe_exec, mismo patrón que pg_temp.try_select_view de
-- 41_agent_public_profiles_view_test.sql). Resultado: el archivo completo CORRE sus N
-- aserciones (ninguna se pierde por abort), y en RED fallan por valor/aserción (NULL, false,
-- SQLSTATE equivocado) en vez de reventar la transacción. Los chequeos de catálogo puro
-- (has_table/has_column/pg_constraint vía to_regclass/pg_policies/pg_proc) ya son
-- inherentemente seguros sin necesidad de wrapper.
--
-- ── Anti-cheat (memorias del vault) ──────────────────────────────────────────────────────
-- pgtap_execute_acl_plancache: el caso `anon` (EC7) vive en su PROPIO throws_ok con SQL
-- literal ad-hoc (EXECUTE de texto dinámico → replanifica siempre, sin plan cacheado
-- compartido con `authenticated`), primera invocación de anon sobre follows en el archivo.
-- pgtap_policy_dominada_por_select: EC6 (visibilidad) y el caso admin corren como
-- invocaciones independientes (EC6a/b/c), cada una su propio `pg_temp.safe_count` con EXECUTE
-- de texto nuevo — ninguna reusa un plan de otro rol.
-- reset_solo_se_prueba_desde_estado_poblado: EC11 (cascade) verifica PRIMERO que las 2 filas
-- existen (estado poblado) antes de borrar al usuario y comprobar que desaparecen — nunca se
-- asume "ya nacía en 0/ausente".
-- tests_bomba_de_fecha_y_estado_inicial: EC4 (conteo) usa un usuario dedicado (H) exclusivo
-- del ciclo de 3 seguidores, aislado de B (usado por EC2/EC3/EC5/EC6) y de F (usado solo para
-- el clamp GREATEST) — ningún conteo se contamina entre secciones.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(53);

-- ════════════════════════════════════════════════════════════════════════════
-- Helpers
-- ════════════════════════════════════════════════════════════════════════════

-- Impersonación (mismo patrón que 02/.../109/112/116).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- Lecturas defensivas: si la relación/columna aún no existe, regresan NULL en vez de abortar
-- la transacción (mismo patrón que pg_temp.try_select_view de 41_agent_public_profiles_view_test.sql).
create or replace function pg_temp.safe_count(p_sql text)
returns int language plpgsql as $$
declare v int;
begin
  execute p_sql into v;
  return v;
exception when others then
  return null;
end $$;

create or replace function pg_temp.safe_bool(p_sql text)
returns boolean language plpgsql as $$
declare v boolean;
begin
  execute p_sql into v;
  return v;
exception when others then
  return null;
end $$;

-- Filas afectadas por un DML (para distinguir "0 filas por RLS" de "no existe"): regresa NULL
-- si la sentencia lanza (para que la aserción falle limpio en vez de abortar).
create or replace function pg_temp.safe_rowcount(p_sql text)
returns int language plpgsql as $$
declare v int;
begin
  execute p_sql;
  get diagnostics v = row_count;
  return v;
exception when others then
  return null;
end $$;

-- Setup sin aserción (p.ej. corromper follower_count a propósito para probar el clamp):
-- no emite TAP, solo evita que un DDL/DML de preparación aborte si la columna no existe aún.
create or replace function pg_temp.safe_exec(p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
exception when others then
  return;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '00000000-0000-0000-0000-000000117XXX' (subtarea 78.1, archivo
-- 117 — sin colisión con prefijos previos verificada por grep).
--   001 A       — actor principal: EC1 (self-check), EC2 (follow real + spoof), EC3
--                 (duplicado), EC5 (unfollow propio + intento ajeno), EC6 (visibilidad)
--   002 B       — seguido por A y C (EC2/EC3/EC5/EC6/EC9)
--   003 C       — sigue a B directo (EC5/EC6); su fila NUNCA la borra A
--   004 ADMIN   — role='admin' de plataforma (EC6c)
--   005 H       — seguido dedicado del ciclo de conteo (EC4), aislado de B
--   006 D       — sigue a H (ciclo 1), luego deja de seguir (EC4)
--   007 E       — sigue a H (ciclo 2)
--   008 I       — sigue a H (ciclo 3)
--   009 F       — seguido dedicado del clamp GREATEST (EC4 clamp), aislado de H
--   010 G       — sigue a F, luego deja de seguir con el contador ya corrompido a 0
--   011 O       — sigue a M (EC11 cascade, dirección "M como seguido")
--   012 M       — se borra entera (EC11 cascade en AMBAS direcciones)
--   013 P       — M lo sigue (EC11 cascade, dirección "M como seguidor")
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000117001', 'a.117@test.local'),
  ('00000000-0000-0000-0000-000000117002', 'b.117@test.local'),
  ('00000000-0000-0000-0000-000000117003', 'c.117@test.local'),
  ('00000000-0000-0000-0000-000000117004', 'admin.117@test.local'),
  ('00000000-0000-0000-0000-000000117005', 'h.117@test.local'),
  ('00000000-0000-0000-0000-000000117006', 'd.117@test.local'),
  ('00000000-0000-0000-0000-000000117007', 'e.117@test.local'),
  ('00000000-0000-0000-0000-000000117008', 'i.117@test.local'),
  ('00000000-0000-0000-0000-000000117009', 'f.117@test.local'),
  ('00000000-0000-0000-0000-000000117010', 'g.117@test.local'),
  ('00000000-0000-0000-0000-000000117011', 'o.117@test.local'),
  ('00000000-0000-0000-0000-000000117012', 'm.117@test.local'),
  ('00000000-0000-0000-0000-000000117013', 'p.117@test.local');

update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000117004';

-- B necesita fila en user_preferences: agent_public_profiles hace INNER JOIN con
-- user_preferences (fail-open probado en 96_identidad_publica_test #4) — sin
-- identidad pública elegida, el usuario no aparece en la vista aunque tenga
-- seguidores (el conteo sigue vivo en users.follower_count).
insert into public.user_preferences (user_id, full_name)
values ('00000000-0000-0000-0000-000000117002', 'B seguido')
on conflict (user_id) do update set full_name = excluded.full_name;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) ESTRUCTURA — catálogo puro, seguro aunque el SUT no exista todavía (EC-1, EC-4, EC-8,
--    EC-9, EC-10 — la parte de forma).
-- ════════════════════════════════════════════════════════════════════════════

select has_table('public', 'follows', 'ST1_EC1_tabla_follows_existe');
select has_column('public', 'follows', 'follower_user_id', 'ST2_EC1_columna_follower_user_id');
select has_column('public', 'follows', 'followed_user_id', 'ST3_EC1_columna_followed_user_id');
select has_column('public', 'follows', 'created_at', 'ST4_EC1_columna_created_at');

select is(
  (select array_agg(a.attname::text order by k.ord)
     from pg_constraint c
     cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.conrelid = to_regclass('public.follows') and c.contype = 'p'),
  array['follower_user_id', 'followed_user_id']::text[],
  'ST5_EC1_pk_compuesta_follower_followed'
);

select is(
  coalesce((select exists (
    select 1 from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.conrelid = to_regclass('public.follows')
      and c.contype = 'f'
      and c.confrelid = to_regclass('public.users')
      and c.confdeltype = 'c'
      and a.attname = 'follower_user_id'
      and array_length(c.conkey, 1) = 1
  )), false),
  true,
  'ST6_EC1_fk_follower_user_id_referencia_users_on_delete_cascade'
);

select is(
  coalesce((select exists (
    select 1 from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.conrelid = to_regclass('public.follows')
      and c.contype = 'f'
      and c.confrelid = to_regclass('public.users')
      and c.confdeltype = 'c'
      and a.attname = 'followed_user_id'
      and array_length(c.conkey, 1) = 1
  )), false),
  true,
  'ST7_EC1_fk_followed_user_id_referencia_users_on_delete_cascade'
);

select is(
  coalesce((select exists (
    select 1 from pg_constraint c
    where c.conrelid = to_regclass('public.follows')
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%<>%'
  )), false),
  true,
  'ST8_EC1_check_follows_no_self_existe_en_catalogo'
);

select has_column('public', 'users', 'follower_count', 'ST9_EC4_users_follower_count_columna_existe');

select is(
  coalesce((select exists (
    select 1 from pg_constraint c
    where c.conrelid = to_regclass('public.users')
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%follower_count%>=%'
  )), false),
  true,
  'ST10_EC4_users_follower_count_check_no_negativo_existe'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'follows' and cmd = 'UPDATE'),
  0,
  'ST11_EC8_sin_policy_de_update_en_follows'
);

select is(
  coalesce((select has_table_privilege('authenticated', c.oid, 'UPDATE')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'follows'), false),
  false,
  'ST12_EC8_authenticated_sin_privilegio_de_update_a_nivel_tabla'
);

select is(
  (select prosecdef from pg_proc where proname = 'update_follower_count' and pronamespace = 'public'::regnamespace),
  true,
  'ST13_EC10_trigger_fn_update_follower_count_es_security_definer'
);

select ok(
  coalesce((select exists (
     select 1 from pg_proc p, unnest(p.proconfig) cfg
      where p.proname = 'update_follower_count' and p.pronamespace = 'public'::regnamespace
        and cfg like 'search_path=%'
  )), false),
  'ST14_EC10_trigger_fn_update_follower_count_fija_search_path_explicito'
);

select is(
  (select array_agg(column_name::text order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'agent_public_profiles'),
  array['user_id', 'full_name', 'profile_photo_url', 'has_phone', 'follower_count']::text[],
  'ST15_EC9_vista_columnas_en_orden_exacto_con_follower_count_al_final'
);

select is(
  (select reloptions from pg_class where relname = 'agent_public_profiles' and relnamespace = 'public'::regnamespace),
  array['security_invoker=false']::text[],
  'ST16_EC9_vista_conserva_security_invoker_false'
);

select is(
  coalesce((select has_table_privilege('authenticated', c.oid, 'SELECT')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'agent_public_profiles'), false),
  true,
  'ST17_EC9_vista_authenticated_conserva_select'
);

select is(
  coalesce((select has_table_privilege('anon', c.oid, 'SELECT')
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'agent_public_profiles'), false),
  false,
  'ST18_EC9_vista_anon_sigue_sin_select'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) GRANTS de tabla — has_table_privilege resuelto por JOIN (0 filas si la tabla no existe
--    = NULL, nunca lanza; patrón de 101_crm_temperature_daily_test / 112_comments_test).
-- ════════════════════════════════════════════════════════════════════════════

select is(coalesce((select has_table_privilege('anon', c.oid, 'SELECT') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'follows'), false), false, 'GR1_anon_sin_select');
select is(coalesce((select has_table_privilege('anon', c.oid, 'INSERT') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'follows'), false), false, 'GR2_anon_sin_insert');
select is(coalesce((select has_table_privilege('anon', c.oid, 'DELETE') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'follows'), false), false, 'GR3_anon_sin_delete');
select is(coalesce((select has_table_privilege('authenticated', c.oid, 'SELECT') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'follows'), false), true, 'GR4_authenticated_con_select');
select is(coalesce((select has_table_privilege('authenticated', c.oid, 'INSERT') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'follows'), false), true, 'GR5_authenticated_con_insert');
select is(coalesce((select has_table_privilege('authenticated', c.oid, 'DELETE') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'follows'), false), true, 'GR6_authenticated_con_delete');

-- ════════════════════════════════════════════════════════════════════════════
-- 3) COMPORTAMIENTO — impersonación real. Todo envuelto en throws_ok/lives_ok/safe_* para
--    que un "relation does not exist" falle por ASERCIÓN, no aborte la transacción.
-- ════════════════════════════════════════════════════════════════════════════

-- EC1 (comportamiento): auto-follow viola el CHECK anti-self (23514).
select pg_temp.act_as('00000000-0000-0000-0000-000000117001'); -- A
select throws_ok(
  $$ insert into public.follows (follower_user_id, followed_user_id)
     values ('00000000-0000-0000-0000-000000117001', '00000000-0000-0000-0000-000000117001') $$,
  '23514', null, 'EC1_auto_follow_viola_el_check_anti_self'
);
reset role;

-- EC2a: A sigue a B (real, permitido).
select pg_temp.act_as('00000000-0000-0000-0000-000000117001'); -- A
select lives_ok(
  $$ insert into public.follows (follower_user_id, followed_user_id)
     values ('00000000-0000-0000-0000-000000117001', '00000000-0000-0000-0000-000000117002') $$,
  'EC2a_A_sigue_a_B_permitido'
);
-- EC2b: A intenta insertar un follow A NOMBRE de C (spoof) → RLS lo rechaza (42501/WITH CHECK).
select throws_ok(
  $$ insert into public.follows (follower_user_id, followed_user_id)
     values ('00000000-0000-0000-0000-000000117003', '00000000-0000-0000-0000-000000117002') $$,
  '42501', null, 'EC2b_A_no_puede_insertar_un_follow_a_nombre_de_C_bajo_RLS'
);
reset role;

-- EC3: doble insert A->B viola la PK compuesta (23505).
select pg_temp.act_as('00000000-0000-0000-0000-000000117001'); -- A
select throws_ok(
  $$ insert into public.follows (follower_user_id, followed_user_id)
     values ('00000000-0000-0000-0000-000000117001', '00000000-0000-0000-0000-000000117002') $$,
  '23505', null, 'EC3_doble_insert_A_hacia_B_viola_la_pk_compuesta'
);
reset role;

-- EC6 setup: C sigue a B directo (fila propia).
select pg_temp.act_as('00000000-0000-0000-0000-000000117003'); -- C
select lives_ok(
  $$ insert into public.follows (follower_user_id, followed_user_id)
     values ('00000000-0000-0000-0000-000000117003', '00000000-0000-0000-0000-000000117002') $$,
  'EC6setup_C_sigue_a_B_directo'
);
reset role;

-- EC6a: A ve solo su propio follow (1), no el de C.
select pg_temp.act_as('00000000-0000-0000-0000-000000117001'); -- A
select is(pg_temp.safe_count($$ select count(*)::int from public.follows $$), 1,
  'EC6a_A_ve_solo_su_propio_follow_no_el_de_C');
reset role;

-- EC6b: C ve solo su propio follow (1), no el de A.
select pg_temp.act_as('00000000-0000-0000-0000-000000117003'); -- C
select is(pg_temp.safe_count($$ select count(*)::int from public.follows $$), 1,
  'EC6b_C_ve_solo_su_propio_follow_no_el_de_A');
reset role;

-- EC6c: admin de plataforma ve TODOS los follows existentes hasta ahora (2: A->B, C->B).
select pg_temp.act_as('00000000-0000-0000-0000-000000117004'); -- ADMIN
select is(pg_temp.safe_count($$ select count(*)::int from public.follows $$), 2,
  'EC6c_admin_de_plataforma_ve_TODOS_los_follows_existentes');
reset role;

-- EC7: anon no puede leer follows — primera invocación real de anon sobre esta tabla, SQL
-- literal ad-hoc (sin wrapper compartido con authenticated, gotcha 203.1).
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select count(*) from public.follows $$,
  '42501', null, 'EC7_anon_no_puede_leer_follows'
);
reset role;

-- EC4: ciclo de 3 seguidores sobre H (aislado de B).
select pg_temp.act_as('00000000-0000-0000-0000-000000117006'); -- D
select lives_ok(
  $$ insert into public.follows (follower_user_id, followed_user_id)
     values ('00000000-0000-0000-0000-000000117006', '00000000-0000-0000-0000-000000117005') $$,
  'EC4a_D_sigue_a_H_ciclo_1'
);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-000000117007'); -- E
select lives_ok(
  $$ insert into public.follows (follower_user_id, followed_user_id)
     values ('00000000-0000-0000-0000-000000117007', '00000000-0000-0000-0000-000000117005') $$,
  'EC4b_E_sigue_a_H_ciclo_2'
);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-000000117008'); -- I
select lives_ok(
  $$ insert into public.follows (follower_user_id, followed_user_id)
     values ('00000000-0000-0000-0000-000000117008', '00000000-0000-0000-0000-000000117005') $$,
  'EC4c_I_sigue_a_H_ciclo_3'
);
reset role;

select is(
  pg_temp.safe_count($$ select follower_count from public.users where id = '00000000-0000-0000-0000-000000117005' $$),
  3, 'EC4d_follower_count_de_H_coincide_con_3_seguidores_reales'
);
select is(
  pg_temp.safe_count($$ select count(*)::int from public.follows where followed_user_id = '00000000-0000-0000-0000-000000117005' $$),
  3, 'EC4e_count_real_en_follows_para_H_es_3_fuente_independiente'
);

-- D deja de seguir a H → el contador baja a 2.
select pg_temp.act_as('00000000-0000-0000-0000-000000117006'); -- D
select lives_ok(
  $$ delete from public.follows
      where follower_user_id = '00000000-0000-0000-0000-000000117006'
        and followed_user_id = '00000000-0000-0000-0000-000000117005' $$,
  'EC4f_D_deja_de_seguir_a_H'
);
reset role;
select is(
  pg_temp.safe_count($$ select follower_count from public.users where id = '00000000-0000-0000-0000-000000117005' $$),
  2, 'EC4g_follower_count_de_H_baja_a_2_tras_el_unfollow_de_D'
);

-- EC4 clamp: G sigue a F, se corrompe el contador a 0 a propósito y se borra el follow — el
-- trigger NUNCA debe dejarlo en -1 (GREATEST(0,...)).
select pg_temp.act_as('00000000-0000-0000-0000-000000117010'); -- G
select lives_ok(
  $$ insert into public.follows (follower_user_id, followed_user_id)
     values ('00000000-0000-0000-0000-000000117010', '00000000-0000-0000-0000-000000117009') $$,
  'EC4h_G_sigue_a_F_para_probar_el_clamp'
);
reset role;
select pg_temp.safe_exec($$ update public.users set follower_count = 0 where id = '00000000-0000-0000-0000-000000117009' $$);
select pg_temp.act_as('00000000-0000-0000-0000-000000117010'); -- G
select lives_ok(
  $$ delete from public.follows
      where follower_user_id = '00000000-0000-0000-0000-000000117010'
        and followed_user_id = '00000000-0000-0000-0000-000000117009' $$,
  'EC4i_G_deja_de_seguir_a_F_con_el_contador_ya_corrompido_en_0'
);
reset role;
select is(
  pg_temp.safe_count($$ select follower_count from public.users where id = '00000000-0000-0000-0000-000000117009' $$),
  0, 'EC4j_el_trigger_nunca_deja_el_contador_negativo_GREATEST_clamp'
);

-- EC5a: A deja de seguir a B (su propio follow).
select pg_temp.act_as('00000000-0000-0000-0000-000000117001'); -- A
select lives_ok(
  $$ delete from public.follows
      where follower_user_id = '00000000-0000-0000-0000-000000117001'
        and followed_user_id = '00000000-0000-0000-0000-000000117002' $$,
  'EC5a_A_puede_dejar_de_seguir_su_propio_follow_de_B'
);
-- EC5b: A intenta borrar el follow AJENO de C hacia B → 0 filas afectadas bajo RLS (no error).
select is(
  pg_temp.safe_rowcount($$ delete from public.follows
      where follower_user_id = '00000000-0000-0000-0000-000000117003'
        and followed_user_id = '00000000-0000-0000-0000-000000117002' $$),
  0, 'EC5b_A_no_puede_borrar_el_follow_ajeno_de_C_hacia_B_0_filas_bajo_RLS'
);
reset role;
-- EC5c: la fila de C hacia B sigue viva tras el intento fallido de A (verificado como superusuario).
select is(
  pg_temp.safe_count($$ select count(*)::int from public.follows
      where follower_user_id = '00000000-0000-0000-0000-000000117003'
        and followed_user_id = '00000000-0000-0000-0000-000000117002' $$),
  1, 'EC5c_la_fila_de_C_hacia_B_sigue_viva_tras_el_intento_fallido_de_A'
);

-- EC9 (dato): follower_count de B en la vista coincide con el conteo real (1: solo C, tras
-- el unfollow de A en EC5a).
select is(
  pg_temp.safe_count($$ select follower_count from public.agent_public_profiles
      where user_id = '00000000-0000-0000-0000-000000117002' $$),
  1, 'EC9_vista_follower_count_de_B_coincide_con_el_conteo_real_tras_unfollow_de_A'
);

-- EC11: cascade en AMBAS direcciones al borrar a M (O sigue a M; M sigue a P).
select pg_temp.act_as('00000000-0000-0000-0000-000000117011'); -- O
select lives_ok(
  $$ insert into public.follows (follower_user_id, followed_user_id)
     values ('00000000-0000-0000-0000-000000117011', '00000000-0000-0000-0000-000000117012') $$,
  'EC11setup_O_sigue_a_M'
);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-000000117012'); -- M
select lives_ok(
  $$ insert into public.follows (follower_user_id, followed_user_id)
     values ('00000000-0000-0000-0000-000000117012', '00000000-0000-0000-0000-000000117013') $$,
  'EC11setup_M_sigue_a_P'
);
reset role;

-- Estado poblado ANTES del borrado (memoria: un reset solo se prueba desde estado poblado).
select is(
  pg_temp.safe_count($$ select count(*)::int from public.follows
      where follower_user_id = '00000000-0000-0000-0000-000000117011'
        and followed_user_id = '00000000-0000-0000-0000-000000117012' $$),
  1, 'EC11pre_la_fila_O_hacia_M_existe_antes_del_borrado'
);
select is(
  pg_temp.safe_count($$ select count(*)::int from public.follows
      where follower_user_id = '00000000-0000-0000-0000-000000117012'
        and followed_user_id = '00000000-0000-0000-0000-000000117013' $$),
  1, 'EC11pre_la_fila_M_hacia_P_existe_antes_del_borrado'
);

-- Borrar a M en auth.users cascada a public.users(M) y de ahí a AMBAS filas de follows.
delete from auth.users where id = '00000000-0000-0000-0000-000000117012';

select is(
  pg_temp.safe_count($$ select count(*)::int from public.follows
      where follower_user_id = '00000000-0000-0000-0000-000000117011'
        and followed_user_id = '00000000-0000-0000-0000-000000117012' $$),
  0, 'EC11a_cascade_borra_la_fila_donde_M_era_el_seguido'
);
select is(
  pg_temp.safe_count($$ select count(*)::int from public.follows
      where follower_user_id = '00000000-0000-0000-0000-000000117012'
        and followed_user_id = '00000000-0000-0000-0000-000000117013' $$),
  0, 'EC11b_cascade_borra_la_fila_donde_M_era_el_seguidor'
);

select * from finish();
rollback;
