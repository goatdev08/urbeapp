-- Tests pgTAP — public.property_revisions: doble versión current_published/pending_revision
-- (subtarea 73.2, PRD §15.5-15.6, docs/PRD.md:736-762).
-- Ejecutar con: supabase test db (CLI global de brew, NUNCA npx supabase)
-- Corre como superusuario dentro de una transacción revertida (no persiste). Los
-- fixtures se insertan directo (el superusuario bypassa RLS); las aserciones
-- impersonan con pg_temp.act_as(uid, role) (mismo patrón que 02/08/18/21/25/27/28/
-- 29/30/31/33_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba (comportamiento observable, NO internals):
--   1) Shape de la tabla public.property_revisions + el enum
--      public.property_revision_status — vía funciones catalográficas pgTAP
--      (has_table/has_column/col_type_is/col_not_null/col_default_is/col_is_pk),
--      que consultan catálogo y JAMÁS lanzan aunque el objeto no exista.
--   2) Comportamiento real de las FKs (cascade en property_id, restrict en
--      submitted_by) ejercitado con INSERT/DELETE reales.
--   3) El índice único parcial (property_id) where status in
--      ('pending','needs_changes') ejercitado con INSERT reales.
--   4) Las policies RLS de SELECT/INSERT ejercitadas con impersonación JWT real
--      (pg_temp.act_as) — dueño, admin, tercero, anon.
-- ════════════════════════════════════════════════════════════════════════════
-- SUT (AÚN NO EXISTE — GREEN, fuera de esta fase RED): una migración nueva que
-- crea el enum property_revision_status ('pending','needs_changes','rejected',
-- 'approved'), la tabla public.property_revisions (diseño exacto acordado con
-- el orquestador, calco de estilo de agent_applications
-- [20260604000003:108-133] + patrón de auditoría de admin_actions
-- [20260604000007:78-95] para submitted_by con on delete restrict), el índice
-- único parcial property_revisions_one_active_per_property, RLS ON sin policy
-- para anon, policy SELECT para dueño (properties.owner_user_id = auth.uid())
-- y para private.is_admin() (20260604000010:22-25), y SIN NINGUNA policy de
-- escritura para `authenticated` (la escritura es EXCLUSIVA de service_role,
-- Edge Function de la subtarea 73.6, aún no existe).
--
-- ── Estrategia RED sin abortar la transacción ────────────────────────────────
-- Como la tabla y el tipo NO EXISTEN todavía (ni siquiera un stub), un
-- SELECT/INSERT/DELETE crudo que los referencie ABORTARÍA toda la transacción
-- si no se protege. Verificado en esta sesión: PL/pgSQL difiere la resolución
-- de tablas/tipos referenciados dentro de un cuerpo de función (CREATE
-- FUNCTION) hasta la PRIMERA EJECUCIÓN — por eso un wrapper
-- pg_temp.try_insert_revision(...) con BEGIN/EXCEPTION WHEN OTHERS puede
-- CREARSE hoy sin abortar, y solo falla (capturado) al invocarse. Mismo
-- principio para lives_ok($$ do $do$ ... $do$ $$) (patrón heredado de
-- 28/29/33_*): el DO se ejecuta dentro del wrapper de pgTAP, que atrapa la
-- excepción y reporta "not ok" sin propagar.
-- Los checks de catálogo puro (has_table/has_column/col_type_is/col_not_null/
-- col_default_is/col_is_pk, y consultas directas a pg_type/pg_enum/pg_class)
-- SÍ son seguros en crudo — nunca lanzan, reportan "not ok" (patrón
-- 16/17/28/29_*).
--
-- ── Convención DELTA vs INVARIANTE (heredada de 21/25/27/28/29/30/31/33) ─────
-- DELTA      = falla hoy por assertion real (catálogo vacío, o lives_ok/throws_ok
--              falla porque la relación no existe) y debe pasar tras el GREEN
--              con el resultado CORRECTO (discrimina la implementación).
-- INVARIANTE = ya "falla" hoy con el mismo resultado observable (excepción, por
--              razón hoy distinta: relación inexistente) y debe seguir fallando
--              tras el GREEN, pero por la razón correcta (RLS deniega el
--              INSERT de `authenticated`). El guardian debe re-verificar tras
--              GREEN que sigue en rojo por la razón correcta.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ─────────────────
-- Happy path:
--   · La tabla existe con el shape exacto acordado (18 checks de columna/tipo/
--     pk/default + el enum con sus 4 valores).
--   · RLS está ON en la tabla.
--   · FK property_id -> properties(id) on delete cascade: borrar la propiedad
--     borra su revisión.
--   · Primera revisión 'pending' de una propiedad se inserta sin problema.
--   · El dueño de la propiedad ve su propia revisión.
--   · El admin ve la revisión de CUALQUIER propiedad (no solo la suya).
-- Ramas no obvias (invariante 🔒 §15.6, doble versión):
--   · Segunda revisión 'pending' para la MISMA propiedad → rechazada (índice
--     único parcial).
--   · Una revisión 'needs_changes' para la MISMA propiedad, mientras ya existe
--     una 'pending' activa → TAMBIÉN rechazada (needs_changes cuenta como
--     "activa" en el índice, no solo pending).
--   · Una revisión 'approved' SÍ puede coexistir con la 'pending' activa (el
--     índice único es parcial, no total — solo cubre pending/needs_changes).
--   · Una revisión 'rejected' TAMBIÉN puede coexistir con la 'pending' activa
--     (mismo razonamiento, el otro valor histórico del enum).
-- Boundary / error:
--   · FK submitted_by -> users(id) on delete RESTRICT (NO set null — patrón de
--     auditoría inmutable de admin_actions, corrección explícita del
--     orquestador): borrar el usuario que sometió una revisión existente debe
--     fallar, no dejar submitted_by en NULL silencioso.
--   · Un usuario que NO es dueño NI admin no ve la revisión (0 filas).
--   · anon no ve NINGUNA revisión, aunque existan filas en la tabla para otras
--     propiedades (fail-closed real, no solo "tabla vacía").
--   · authenticated (dueño de la propiedad) NO puede hacer INSERT directo — la
--     escritura es exclusiva de service_role/Edge Function (73.6, fuera de
--     alcance de esta subtarea).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(35);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '...00000000732XX' (subtarea 73.2, sin colisión con
-- los rangos de archivos previos — cada archivo pgTAP corre en su propia
-- transacción revertida).
--   OW1 dueño de P1 (sección FK restrict), P3 (sección FK cascade) y P4
--       (sección índice único)                                       : ...073201
--   OW2 dueño de P2 (sección RLS/visibilidad) y P5 (sección escritura): ...073202
--   ADM admin global                                                 : ...073203
--   OTH usuario autenticado sin relación con P1/P2/P3/P4/P5           : ...073204
--   SB  sometedor desechable (sección FK restrict on delete usuario) : ...073205
--
-- ⚠️ CORRECCIÓN post-GREEN #1 (guardian/orquestador, 2026-08-09): P1
-- originalmente se reusaba en DOS secciones (FK2 le sometía una revisión
-- pending vía SB, Y la sección de índice único la reusaba como "primera
-- pending") — con la tabla ya viva, la fila de FK2 seguía existiendo cuando
-- UQ1 corría, así que "la primera pending" en realidad era la SEGUNDA y el
-- índice único la rechazaba correctamente, tumbando UQ1 por un bug del
-- fixture, no de la implementación. Se separó: P1 queda EXCLUSIVA de FK2; la
-- sección de índice único gana su propia propiedad dedicada, P4 (...073214).
--
-- ⚠️ CORRECCIÓN post-GREEN #2 (guardian, mutación real, 2026-08-09): WR1
-- (sección de escritura) reusaba P2, que RLS_setup ya había cargado con una
-- revisión pending — el INSERT de WR1 tronaba con 23505 (duplicate key del
-- índice único parcial), NO con el 42501 (permission denied) que WR1 dice
-- estar probando, y `throws_ok(sql, null, ...)` acepta CUALQUIER SQLSTATE, así
-- que el assert pasaba por la razón incorrecta — el guardian abrió una policy
-- de INSERT completamente permisiva y el archivo siguió en 35/35 verde, sin
-- detectar la puerta de escritura abierta. Fix: WR1 gana su propia propiedad
-- dedicada SIN NINGUNA revisión previa, P5 (...073215), y el throws_ok ahora
-- exige el SQLSTATE explícito '42501' (permission denied — cubre tanto grant
-- ausente como violación de policy RLS, y excluye el 23505 que enmascaraba
-- el bug).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000073201', 'ow1.7302@test.local'),
  ('00000000-0000-0000-0000-000000073202', 'ow2.7302@test.local'),
  ('00000000-0000-0000-0000-000000073203', 'adm.7302@test.local'),
  ('00000000-0000-0000-0000-000000073204', 'oth.7302@test.local'),
  ('00000000-0000-0000-0000-000000073205', 'sb.7302@test.local');

update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000073203'; -- ADM

insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000073211', '00000000-0000-0000-0000-000000073201',
   'departamento', 'rent', 'Fixture property_revisions 7302 — P1 (FK restrict submitted_by)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-000000073212', '00000000-0000-0000-0000-000000073202',
   'casa', 'sale', 'Fixture property_revisions 7302 — P2 (RLS/visibilidad)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography, 2500000, 'active'),
  ('00000000-0000-0000-0000-000000073213', '00000000-0000-0000-0000-000000073201',
   'local', 'rent', 'Fixture property_revisions 7302 — P3 (FK cascade delete)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.34, 20.66), 4326)::extensions.geography, 8000, 'active'),
  ('00000000-0000-0000-0000-000000073214', '00000000-0000-0000-0000-000000073201',
   'departamento', 'sale', 'Fixture property_revisions 7302 — P4 (indice unico parcial, DEDICADA, no reusa P1)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.37, 20.69), 4326)::extensions.geography, 3200000, 'active'),
  ('00000000-0000-0000-0000-000000073215', '00000000-0000-0000-0000-000000073202',
   'local', 'sale', 'Fixture property_revisions 7302 — P5 (WR1 escritura, DEDICADA, SIN revision previa, no reusa P2)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.38, 20.70), 4326)::extensions.geography, 1800000, 'active');

-- Helper de impersonación inline (mismo patrón que 02/08/18/21/25/27/28/29/30/31/33_*).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- Helper de INSERT protegido (patrón try_add_member de 21_agency_member_role_matrix):
-- INSERT envuelto en BEGIN/EXCEPTION que atrapa CUALQUIER error (tabla/tipo
-- inexistentes hoy, violación del índice único tras GREEN) y regresa boolean
-- en vez de abortar la transacción. Verificado en esta sesión que CREATE
-- FUNCTION no valida la existencia de la tabla/tipo referenciados (se resuelve
-- en la primera ejecución, ya protegida por el propio EXCEPTION).
create or replace function pg_temp.try_insert_revision(
  p_property_id uuid,
  p_submitted_by uuid,
  p_status text default 'pending'
) returns boolean language plpgsql as $$
begin
  insert into public.property_revisions (property_id, submitted_by, status, changed_fields)
  values (p_property_id, p_submitted_by, p_status::property_revision_status, '{"price": 15000}'::jsonb);
  return true;
exception when others then
  return false;
end
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) SHAPE [DELTA] — tabla, enum y columnas exactas del diseño acordado.
--    Todo esto es catálogo puro (pgTAP + pg_type/pg_enum/pg_class): nunca lanza.
-- ════════════════════════════════════════════════════════════════════════════

select has_table('public', 'property_revisions', 'ST0_tabla_property_revisions_existe');

select is(
  (select array_agg(e.enumlabel::text order by e.enumlabel)
     from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'property_revision_status'),
  array['approved','needs_changes','pending','rejected']::text[],
  'TY1_enum_property_revision_status_tiene_exactamente_los_4_valores_acordados'
);

select col_type_is('public', 'property_revisions', 'id', 'uuid', 'COL1_id_es_uuid');
select col_is_pk('public', 'property_revisions', 'id', 'COL2_id_es_primary_key');
select col_type_is('public', 'property_revisions', 'property_id', 'uuid', 'COL3_property_id_es_uuid');
select col_not_null('public', 'property_revisions', 'property_id', 'COL4_property_id_es_not_null');
select col_type_is('public', 'property_revisions', 'status', 'property_revision_status', 'COL5_status_es_property_revision_status');
select col_not_null('public', 'property_revisions', 'status', 'COL6_status_es_not_null');
select col_default_is('public', 'property_revisions', 'status', 'pending', 'COL7_status_default_pending');
select col_type_is('public', 'property_revisions', 'changed_fields', 'jsonb', 'COL8_changed_fields_es_jsonb');
select col_not_null('public', 'property_revisions', 'changed_fields', 'COL9_changed_fields_es_not_null');
select col_type_is('public', 'property_revisions', 'submitted_by', 'uuid', 'COL10_submitted_by_es_uuid');
select col_not_null('public', 'property_revisions', 'submitted_by', 'COL11_submitted_by_es_not_null');
select col_type_is('public', 'property_revisions', 'reviewed_by_admin_id', 'uuid', 'COL12_reviewed_by_admin_id_es_uuid');
select col_type_is('public', 'property_revisions', 'reviewed_at', 'timestamp with time zone', 'COL13_reviewed_at_es_timestamptz');
select col_type_is('public', 'property_revisions', 'rejection_reason', 'text', 'COL14_rejection_reason_es_text');
select col_type_is('public', 'property_revisions', 'created_at', 'timestamp with time zone', 'COL15_created_at_es_timestamptz');
select col_not_null('public', 'property_revisions', 'created_at', 'COL16_created_at_es_not_null');
select col_type_is('public', 'property_revisions', 'updated_at', 'timestamp with time zone', 'COL17_updated_at_es_timestamptz');
select col_not_null('public', 'property_revisions', 'updated_at', 'COL18_updated_at_es_not_null');

select is(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'property_revisions'),
  true,
  'RLS0_rls_esta_activo_en_property_revisions'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 1) FKs [DELTA] — property_id on delete cascade, submitted_by on delete restrict.
-- ════════════════════════════════════════════════════════════════════════════

-- FK1: insertar una revisión para P3, borrar P3, la revisión debe desaparecer.
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    insert into public.property_revisions (property_id, submitted_by, status, changed_fields)
    values ('00000000-0000-0000-0000-000000073213', '00000000-0000-0000-0000-000000073201', 'pending', '{"video_url": "x"}'::jsonb);

    delete from public.properties where id = '00000000-0000-0000-0000-000000073213';

    select count(*) into v_count from public.property_revisions
      where property_id = '00000000-0000-0000-0000-000000073213';
    if v_count is distinct from 0 then
      raise exception 'esperaba que la revision desapareciera al borrar la propiedad (cascade), quedaron %', v_count;
    end if;
  end
  $do$;
  $$,
  'FK1_borrar_la_propiedad_borra_en_cascada_su_revision_pendiente'
);

-- FK2: SB somete una revisión sobre P1; borrar a SB (public.users) debe FALLAR
-- (on delete restrict, auditoría inmutable) — HOY, sin la tabla, el DELETE del
-- usuario no tiene nada que lo detenga y SUCEDE sin problema: RED genuino en
-- la dirección "debería lanzar y no lanza".
select lives_ok(
  $$
  insert into public.property_revisions (property_id, submitted_by, status, changed_fields)
  values ('00000000-0000-0000-0000-000000073211', '00000000-0000-0000-0000-000000073205', 'pending', '{"description": "x"}'::jsonb)
  $$,
  'FK2_setup_SB_somete_una_revision_sobre_P1'
);
select throws_ok(
  $$ delete from public.users where id = '00000000-0000-0000-0000-000000073205' $$,
  null,
  'FK2_borrar_al_usuario_que_sometio_una_revision_existente_falla_restrict_no_set_null'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) ÍNDICE ÚNICO PARCIAL [🔒 invariante §15.6] — solo UNA revisión
--    pending/needs_changes activa por propiedad; approved/rejected históricas
--    coexisten sin problema. Usa P4 — DEDICADA a esta sección, nunca reusada
--    en ninguna otra (a diferencia de P1, que ya carga la revisión de FK2) —
--    para que "primera revisión pending" sea genuinamente la primera.
-- ════════════════════════════════════════════════════════════════════════════

-- UQ1 [DELTA] primera revisión pending de P4 se inserta ok.
select ok(
  pg_temp.try_insert_revision('00000000-0000-0000-0000-000000073214', '00000000-0000-0000-0000-000000073201', 'pending'),
  'UQ1_primera_revision_pending_de_una_propiedad_se_inserta_ok'
);

-- UQ2 [INVARIANTE — verificado en esta sesión: try_insert_revision regresa
-- false HOY porque la tabla no existe, así que "not false" ya es cierto por la
-- razón incorrecta; tras GREEN debe seguir siendo false, pero por la
-- violación real del índice único parcial] segunda revisión pending de la
-- MISMA propiedad P4 es rechazada.
select ok(
  not pg_temp.try_insert_revision('00000000-0000-0000-0000-000000073214', '00000000-0000-0000-0000-000000073201', 'pending'),
  'UQ2_segunda_revision_pending_para_la_misma_propiedad_es_rechazada_indice_unico_parcial'
);

-- UQ3 [INVARIANTE, mismo razonamiento que UQ2] needs_changes TAMBIÉN choca con
-- la pending activa de P4 (ambos estados cuentan como "activos" en el índice,
-- no solo pending).
select ok(
  not pg_temp.try_insert_revision('00000000-0000-0000-0000-000000073214', '00000000-0000-0000-0000-000000073201', 'needs_changes'),
  'UQ3_needs_changes_tambien_choca_con_una_pending_activa_de_la_misma_propiedad'
);

-- UQ4 [DELTA] una revisión approved SÍ coexiste con la pending activa de P4
-- (el índice único es PARCIAL, no total).
select ok(
  pg_temp.try_insert_revision('00000000-0000-0000-0000-000000073214', '00000000-0000-0000-0000-000000073201', 'approved'),
  'UQ4_una_revision_approved_puede_coexistir_con_la_pending_activa_no_es_unique_total'
);

-- UQ5 [DELTA] una revisión rejected TAMBIÉN coexiste con la pending activa de P4.
select ok(
  pg_temp.try_insert_revision('00000000-0000-0000-0000-000000073214', '00000000-0000-0000-0000-000000073201', 'rejected'),
  'UQ5_una_revision_rejected_tambien_puede_coexistir_con_la_pending_activa'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) RLS SELECT [DELTA] — dueño, admin, tercero, anon. Usa P2 (dedicada, sin
--    tocar el estado acumulado de P1 de la sección anterior).
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$
  insert into public.property_revisions (property_id, submitted_by, status, changed_fields)
  values ('00000000-0000-0000-0000-000000073212', '00000000-0000-0000-0000-000000073202', 'pending', '{"price": 20000}'::jsonb)
  $$,
  'RLS_setup_OW2_somete_una_revision_pending_sobre_P2'
);

-- RLS1 [DELTA] OW2 (dueño de P2) ve su propia revisión.
select pg_temp.act_as('00000000-0000-0000-0000-000000073202'); -- OW2
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    select count(*) into v_count from public.property_revisions
      where property_id = '00000000-0000-0000-0000-000000073212';
    if v_count is distinct from 1 then
      raise exception 'esperaba 1 revision visible para el dueno de P2, fueron %', v_count;
    end if;
  end
  $do$;
  $$,
  'RLS1_dueno_de_la_propiedad_ve_su_propia_revision'
);
reset role;

-- RLS2 [DELTA] ADM (admin global) ve la revisión de P2 aunque no sea suya.
select pg_temp.act_as('00000000-0000-0000-0000-000000073203'); -- ADM
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    select count(*) into v_count from public.property_revisions
      where property_id = '00000000-0000-0000-0000-000000073212';
    if v_count is distinct from 1 then
      raise exception 'esperaba que el admin viera 1 revision de una propiedad ajena (P2), fueron %', v_count;
    end if;
  end
  $do$;
  $$,
  'RLS2_admin_ve_la_revision_de_cualquier_propiedad'
);
reset role;

-- RLS3 [DELTA] OTH (autenticado, ni dueño ni admin) no ve la revisión de P2.
select pg_temp.act_as('00000000-0000-0000-0000-000000073204'); -- OTH
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    select count(*) into v_count from public.property_revisions
      where property_id = '00000000-0000-0000-0000-000000073212';
    if v_count is distinct from 0 then
      raise exception 'un usuario que no es dueno ni admin NO debe ver la revision de P2; vio %', v_count;
    end if;
  end
  $do$;
  $$,
  'RLS3_usuario_que_no_es_dueno_ni_admin_no_ve_la_revision'
);
reset role;

-- RLS4 [DELTA] anon no ve NINGUNA revisión, aunque a estas alturas del archivo
-- ya existen varias filas (P1: pending de FK2; P4: pending+approved+rejected
-- de la sección de índice único; P2: pending de RLS_setup) — no es "tabla
-- vacía", es fail-closed real.
select pg_temp.act_as(null, 'anon');
select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    select count(*) into v_count from public.property_revisions;
    if v_count is distinct from 0 then
      raise exception 'anon NO debe ver ninguna revision (fail-closed), vio %', v_count;
    end if;
  end
  $do$;
  $$,
  'RLS4_anon_no_ve_ninguna_revision_pese_a_que_existen_filas_de_otras_propiedades'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) ESCRITURA [INVARIANTE] — authenticated (ni siquiera el dueño) puede
--    escribir directo; la escritura es EXCLUSIVA de service_role/Edge Function
--    (73.6, fuera de alcance de esta subtarea). Ya "falla" hoy (relación
--    inexistente); debe seguir fallando tras GREEN, pero por RLS/grant (sin
--    policy ni grant de INSERT para authenticated) — el guardian debe
--    re-verificar la razón. Usa P5 — DEDICADA, SIN ninguna revisión previa
--    (ni pending ni needs_changes), para que el INSERT solo pueda chocar con
--    el guardado de escritura bajo prueba, nunca con el índice único parcial
--    (de ahí el SQLSTATE explícito '42501' = permission denied, que excluye
--    el 23505 = duplicate key de un fixture contaminado).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000073202'); -- OW2, dueño de P5
-- ⚠️ GOTCHA pgTAP verificado en esta sesión: throws_ok(sql, errcode, X) de 3
-- args trata X como el MENSAJE de error esperado (SQLERRM), NO como
-- descripción — hay que usar la forma de 4 args con errmsg=NULL explícito
-- para fijar el SQLSTATE sin acoplarse al texto exacto del mensaje.
select throws_ok(
  $$
  insert into public.property_revisions (property_id, submitted_by, status, changed_fields)
  values ('00000000-0000-0000-0000-000000073215', '00000000-0000-0000-0000-000000073202', 'pending', '{"price": 21000}'::jsonb)
  $$,
  '42501',
  null,
  'WR1_authenticated_dueno_no_puede_insertar_una_revision_directo_solo_service_role_o_ef'
);
reset role;

select * from finish();
rollback;
