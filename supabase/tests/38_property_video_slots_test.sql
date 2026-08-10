-- Tests pgTAP — public.property_video_slots: abstracción de vigencia (semilla
-- mínima para #76/pagos), subtarea 73.4 (absorbe 73.5), PRD §2.2/§17.1.
-- Ejecutar con: supabase test db (CLI global de brew, NUNCA npx supabase)
-- Corre como superusuario dentro de una transacción revertida (no persiste).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba (comportamiento observable, NO internals):
--   1) Shape de la tabla public.property_video_slots — vía funciones
--      catalográficas pgTAP (has_table/col_type_is/col_not_null/col_default_is/
--      col_is_pk) + consultas directas a pg_constraint (FK/UNIQUE), que NUNCA
--      lanzan aunque el objeto no exista.
--   2) Comportamiento real de la UNIQUE constraint sobre property_id y de la FK
--      property_id -> properties(id) on delete cascade, ejercitado con
--      INSERT/DELETE reales.
--   3) 🔒 INVARIANTE CRÍTICO: llamar la RPC public.publish_property_atomic
--      (extendida por 73.4) crea AUTOMÁTICAMENTE, en la MISMA transacción, una
--      fila en property_video_slots con el property_id correcto.
--   4) 🔒 INVARIANTE CRÍTICO (atomicidad): si el INSERT del slot falla, TODA la
--      transacción de publish_property_atomic hace ROLLBACK — ni la propiedad
--      ni el enlace del video quedan huérfanos.
-- ════════════════════════════════════════════════════════════════════════════
-- SUT (AÚN NO EXISTE — GREEN, fuera de esta fase RED):
--   - Una migración nueva que crea public.property_video_slots (id uuid pk,
--     property_id uuid not null unique references properties(id) on delete
--     cascade, started_at timestamptz not null default now(), is_free boolean
--     not null default true, created_at timestamptz not null default now()).
--   - Una extensión de la RPC public.publish_property_atomic (hoy en
--     20260721000001_publish_property_link_video.sql) que, en el MISMO INSERT
--     transaccional que crea properties, inserta también en
--     property_video_slots — sin bloque EXCEPTION alrededor (si falla, hace
--     rollback de todo, mismo patrón que el enlace de property_videos ya
--     probado en 06_publish_property_rpc_test.sql).
--
-- ── Nota sobre la técnica de fault-injection (asserts RPC6-RPC9) ─────────────
-- property_id es generado por el servidor (gen_random_uuid() dentro del INSERT
-- de properties, adentro de publish_property_atomic) — es IMPOSIBLE conocerlo
-- de antemano para "duplicarlo" y forzar una violación UNIQUE real de forma
-- determinista. El equivalente determinista usado aquí: un trigger BEFORE
-- INSERT "veneno" en property_video_slots que SIEMPRE lanza excepción — se
-- adjunta condicionalmente (solo si la tabla ya existe, vía DO + EXECUTE
-- dinámico, porque CREATE TRIGGER valida la existencia de la tabla en el acto,
-- a diferencia de un cuerpo de función que difiere la resolución) y se adjunta
-- AL FINAL del archivo, después de que las secciones de UNIQUE/FK reales y el
-- happy path del RPC ya insertaron sus propias filas sin interferencia.
--
-- ── Estrategia RED sin abortar la transacción (heredada de 06/37_*) ──────────
-- Los checks de catálogo puro (has_table/col_type_is/col_not_null/
-- col_default_is/col_is_pk, y consultas directas a pg_constraint) son seguros
-- en crudo — nunca lanzan, reportan "not ok" si el objeto no existe.
-- lives_ok/throws_ok ejecutan su SQL protegidos por el propio wrapper de
-- pgTAP (patrón verificado en 06_publish_property_rpc_test.sql: throws_ok
-- sobrevive incluso cuando la función invocada no tiene el overload nuevo,
-- 42883, sin abortar el resto del archivo).
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ─────────────────
-- Happy path (shape):
--   · La tabla existe con las 5 columnas del diseño acordado + tipos correctos.
--   · id es primary key.
--   · property_id es NOT NULL.
--   · started_at/created_at son timestamptz NOT NULL.
--   · is_free es boolean NOT NULL default true (beta: siempre gratis).
-- Ramas no obvias (invariantes 🔒):
--   · FK property_id -> properties(id) existe.
--   · La FK es ON DELETE CASCADE (catálogo + comportamiento real: borrar la
--     propiedad borra su slot).
--   · property_id tiene UNIQUE (catálogo + comportamiento real: un segundo
--     slot para la MISMA propiedad viola la constraint, 23505).
--   · 🔒 Invariante crítico: publish_property_atomic crea el slot
--     AUTOMÁTICAMENTE en la misma transacción — property_id correcto,
--     started_at no nulo, is_free=true.
-- Boundary / error (el invariante MÁS importante):
--   · 🔒 Si el INSERT del slot falla, TODA la transacción de
--     publish_property_atomic hace rollback: no queda properties creada, el
--     video en vuelo sigue SIN enlazar, y no queda ninguna fila huérfana en
--     property_video_slots.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(26);

-- ════════════════════════════════════════════════════════════════════════════
-- 0) SHAPE — tabla y columnas exactas del diseño acordado (catálogo puro,
--    nunca lanza aunque property_video_slots no exista todavía).
-- ════════════════════════════════════════════════════════════════════════════

select has_table('public', 'property_video_slots', 'ST0_tabla_property_video_slots_existe');

select col_type_is('public', 'property_video_slots', 'id', 'uuid', 'COL1_id_es_uuid');
select col_is_pk('public', 'property_video_slots', 'id', 'COL2_id_es_primary_key');
select col_type_is('public', 'property_video_slots', 'property_id', 'uuid', 'COL3_property_id_es_uuid');
select col_not_null('public', 'property_video_slots', 'property_id', 'COL4_property_id_es_not_null');
select col_type_is('public', 'property_video_slots', 'started_at', 'timestamp with time zone', 'COL5_started_at_es_timestamptz');
select col_not_null('public', 'property_video_slots', 'started_at', 'COL6_started_at_es_not_null');
select col_type_is('public', 'property_video_slots', 'is_free', 'boolean', 'COL7_is_free_es_boolean');
select col_not_null('public', 'property_video_slots', 'is_free', 'COL8_is_free_es_not_null');
select col_default_is('public', 'property_video_slots', 'is_free', 'true', 'COL9_is_free_default_true_beta_siempre_gratis');
select col_type_is('public', 'property_video_slots', 'created_at', 'timestamp with time zone', 'COL10_created_at_es_timestamptz');
select col_not_null('public', 'property_video_slots', 'created_at', 'COL11_created_at_es_not_null');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) FK + UNIQUE — catálogo puro (pg_constraint), nunca lanza.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int
     from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_namespace n on n.oid = t.relnamespace
     join pg_class ft on ft.oid = c.confrelid
    where n.nspname = 'public'
      and t.relname = 'property_video_slots'
      and c.contype = 'f'
      and ft.relname = 'properties'),
  1,
  'FK0_property_id_tiene_foreign_key_hacia_properties'
);

select is(
  (select c.confdeltype
     from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_namespace n on n.oid = t.relnamespace
     join pg_class ft on ft.oid = c.confrelid
    where n.nspname = 'public'
      and t.relname = 'property_video_slots'
      and c.contype = 'f'
      and ft.relname = 'properties'),
  'c',
  'FK1_la_fk_es_on_delete_cascade'
);

select is(
  (select count(*)::int
     from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_namespace n on n.oid = t.relnamespace
     join pg_attribute a on a.attrelid = t.oid and a.attnum = any(c.conkey)
    where n.nspname = 'public'
      and t.relname = 'property_video_slots'
      and c.contype = 'u'
      and a.attname = 'property_id'),
  1,
  'UQ0_property_id_tiene_constraint_unique'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) UNIQUE real — comportamiento ejercitado con INSERT reales.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003801', 'agente_slot_uq@urbea.mx');
update public.users set role = 'agent' where id = '00000000-0000-0000-0000-000000003801';

insert into public.properties (id, owner_user_id, operation_type, property_type, price, address, location, status) values
  ('00000000-0000-0000-0000-000000003811', '00000000-0000-0000-0000-000000003801',
   'rent', 'departamento', 5000.00, 'Calle Slot UQ 1',
   extensions.ST_SetSRID(extensions.ST_Point(-99.10, 19.10), 4326)::extensions.geography, 'active'),
  ('00000000-0000-0000-0000-000000003812', '00000000-0000-0000-0000-000000003801',
   'rent', 'departamento', 5000.00, 'Calle Slot UQ 2',
   extensions.ST_SetSRID(extensions.ST_Point(-99.11, 19.11), 4326)::extensions.geography, 'active');

-- NOTA (verificado empíricamente en esta sesión): lives_ok($$ insert ... $$)
-- NO sobrevive un "relation does not exist" (42P01) — el EXECUTE interno de
-- lives_ok lo propaga y aborta pg_prove ("died", no "not ok"), a diferencia de
-- throws_ok (sí lo atrapa, solo reporta el SQLSTATE incorrecto). Por eso aquí
-- se usan bloques do $$ ... exception when others ... $$ AUTO-PROTEGIDOS
-- (nunca dependen de que el wrapper de pgTAP atrape la excepción por fuera) y
-- se afirma sobre una tabla temporal real (siempre existe), nunca sobre
-- property_video_slots crudo.

create temp table result_uq (attempt int, ok boolean, err_sqlstate text);

do $$
begin
  begin
    insert into public.property_video_slots (property_id) values ('00000000-0000-0000-0000-000000003811');
    insert into result_uq values (1, true, null);
  exception when others then
    insert into result_uq values (1, false, sqlstate);
  end;

  begin
    insert into public.property_video_slots (property_id) values ('00000000-0000-0000-0000-000000003811');
    insert into result_uq values (2, true, null);
  exception when others then
    insert into result_uq values (2, false, sqlstate);
  end;
end $$;

select is(
  (select ok from result_uq where attempt = 1),
  true,
  'UQ1_primer_slot_para_una_propiedad_se_inserta_sin_problema'
);

select is(
  (select err_sqlstate from result_uq where attempt = 2),
  '23505',
  'UQ2_segundo_slot_para_la_MISMA_propiedad_viola_la_unique_constraint'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) FK CASCADE real — borrar la propiedad borra su slot (patrón 37_*, pero
--    con el bloque exception when others AUTO-PROTEGIDO, ver nota arriba).
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_fk_cascade (count_after int);

do $$
declare v_count int;
begin
  insert into public.property_video_slots (property_id) values ('00000000-0000-0000-0000-000000003812');

  delete from public.properties where id = '00000000-0000-0000-0000-000000003812';

  select count(*) into v_count from public.property_video_slots
    where property_id = '00000000-0000-0000-0000-000000003812';
  insert into result_fk_cascade values (v_count);
exception when others then
  insert into result_fk_cascade values (null);
end $$;

select is(
  coalesce((select count_after from result_fk_cascade), -1),
  0,
  'FK2_borrar_la_propiedad_borra_en_cascada_su_slot'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) 🔒 INVARIANTE CRÍTICO — publish_property_atomic crea el slot
--    AUTOMÁTICAMENTE en la misma transacción (happy path, SIN fault injection
--    todavía — el trigger veneno se adjunta DESPUÉS de esta sección).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003802', 'agente_slot_happy@urbea.mx');
update public.users set role = 'agent' where id = '00000000-0000-0000-0000-000000003802';

insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
values (
  '00000000-0000-0000-0000-000000003821',
  null,
  '00000000-0000-0000-0000-000000003802',
  'processing',
  1,
  'cfuid-slot-happy-01',
  'https://upload.example/slot-happy'
);

-- NOTA (misma protección que la sección 2): consultar property_video_slots
-- dentro de este DO va en un bloque begin/exception ANIDADO propio, para que
-- un 42P01 (tabla aún no existe, RED) no tumbe el resto del script — se
-- captura como slot_ok=false y las columnas de slot quedan NULL, lo que hace
-- fallar las aserciones RPC2-4 por ASERCIÓN (valor esperado vs NULL), nunca
-- por crash del runner.

create temp table result_slot_happy (
  ok               boolean,
  property_id      uuid,
  err_sqlstate     text,
  err_message      text,
  slot_count       int,
  slot_started_at  timestamptz,
  slot_is_free     boolean
);

do $$
declare
  v_property_id   uuid;
  v_slot_count    int;
  v_started_at    timestamptz;
  v_is_free       boolean;
begin
  select property_id into v_property_id
    from public.publish_property_atomic(
      p_user_id             => '00000000-0000-0000-0000-000000003802'::uuid,
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 9000.00,
      p_address             => 'Calle Slot Happy 1',
      p_lat                 => 19.10,
      p_lng                 => -99.10,
      p_cloudflare_uid      => 'cfuid-slot-happy-01'
    );

  begin
    select count(*), max(started_at), bool_and(is_free)
      into v_slot_count, v_started_at, v_is_free
      from public.property_video_slots
      where property_id = v_property_id;
  exception when others then
    v_slot_count := null;
    v_started_at := null;
    v_is_free := null;
  end;

  insert into result_slot_happy
    values (true, v_property_id, null, null, v_slot_count, v_started_at, v_is_free);
exception when others then
  insert into result_slot_happy
    values (false, null, sqlstate, sqlerrm, null, null, null);
end $$;

select is(
  (select ok from result_slot_happy),
  true,
  'RPC1_publish_property_atomic_no_lanza_excepcion_en_el_happy_path -- ' ||
  coalesce((select err_message from result_slot_happy), '')
);

select is(
  coalesce((select slot_count from result_slot_happy), -1),
  1,
  'RPC2_invariante_critico_se_crea_automaticamente_1_fila_en_property_video_slots_con_el_property_id_correcto'
);

select isnt(
  (select slot_started_at from result_slot_happy),
  null,
  'RPC3_slot_started_at_no_es_nulo'
);

select is(
  coalesce((select slot_is_free from result_slot_happy), false),
  true,
  'RPC4_slot_is_free_default_true_beta_siempre_gratis'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) 🔒 INVARIANTE CRÍTICO (atomicidad) — si el INSERT del slot falla, TODA la
--    transacción hace rollback. Fault injection determinista: trigger veneno
--    (ver nota al inicio del archivo). Se adjunta AHORA, después de que las
--    secciones 2/3/4 ya insertaron sus propias filas sin interferencia.
-- ════════════════════════════════════════════════════════════════════════════

do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'property_video_slots'
  ) then
    execute $ddl$
      create or replace function pg_temp.poison_slot_insert()
      returns trigger language plpgsql as $poison$
      begin
        raise exception 'poison: fault injection forzada (pgTAP 38_property_video_slots_test) para probar el rollback atomico'
          using errcode = '23505';
      end
      $poison$;
    $ddl$;
    execute 'create trigger poison_before_insert before insert on public.property_video_slots for each row execute function pg_temp.poison_slot_insert()';
  end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003803', 'agente_slot_poison@urbea.mx');
update public.users set role = 'agent' where id = '00000000-0000-0000-0000-000000003803';

insert into public.property_videos
  (id, property_id, agent_id, status, position, cloudflare_uid, tus_upload_url)
values (
  '00000000-0000-0000-0000-000000003822',
  null,
  '00000000-0000-0000-0000-000000003803',
  'ready',
  1,
  'cfuid-slot-poison-01',
  'https://upload.example/slot-poison'
);

select throws_ok(
  $$
    select * from public.publish_property_atomic(
      p_user_id             => '00000000-0000-0000-0000-000000003803'::uuid,
      p_operation_type      => 'rent',
      p_property_type       => 'departamento',
      p_price               => 7000.00,
      p_address             => 'Calle Slot Poison 1',
      p_lat                 => 19.20,
      p_lng                 => -99.20,
      p_cloudflare_uid      => 'cfuid-slot-poison-01'
    )
  $$,
  null,
  null,
  'RPC6_si_el_insert_del_slot_falla_publish_property_atomic_debe_lanzar_excepcion_y_no_completar'
);

select is(
  (select count(*)::int from public.properties where owner_user_id = '00000000-0000-0000-0000-000000003803'),
  0,
  'RPC7_atomicidad_el_insert_del_slot_fallo_por_eso_NO_debe_quedar_una_propiedad_creada'
);

select is(
  (select property_id from public.property_videos where id = '00000000-0000-0000-0000-000000003822'),
  null,
  'RPC8_atomicidad_el_video_en_vuelo_sigue_SIN_enlazar_property_id_null'
);

-- Mismo patrón de protección: la cuenta de slots huérfanos se calcula dentro
-- de un DO auto-protegido (property_video_slots puede no existir en RED).
create temp table result_orphan_slots (count_orphans int);

do $$
declare v_count int;
begin
  select count(*) into v_count from public.property_video_slots
    where property_id in (
      select id from public.properties where owner_user_id = '00000000-0000-0000-0000-000000003803'
    );
  insert into result_orphan_slots values (v_count);
exception when others then
  insert into result_orphan_slots values (null);
end $$;

select is(
  coalesce((select count_orphans from result_orphan_slots), -1),
  0,
  'RPC9_atomicidad_no_quedo_ninguna_fila_huerfana_en_property_video_slots'
);

select * from finish();
rollback;
