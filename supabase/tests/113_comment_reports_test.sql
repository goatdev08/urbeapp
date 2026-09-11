-- Tests pgTAP — comment_reports: dedupe, auto-ocultar 3/24h y RPC de resolución atómica
-- (subtarea 289.3, tarea #289). Ejecutar con:
--   supabase test db supabase/tests/113_comment_reports_test.sql --local
-- (CLI GLOBAL de brew, NUNCA npx supabase). Corre como superusuario (rol `postgres`, dueño
-- de las tablas -> bypassa RLS por ownership) dentro de una transacción revertida (no
-- persiste). Los fixtures se insertan directo (bypass RLS); las aserciones impersonan con
-- pg_temp.act_as(uid,role) (mismo patrón que 02/.../109/110/112).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAMS bajo prueba (comportamiento observable, NUNCA internals):
--   1) tabla public.comment_reports — columnas, FKs, UNIQUE, CHECKs (catálogo puro).
--   2) policies comment_reports_insert / comment_reports_select vía impersonación JWT
--      (sin policy de update/delete para authenticated).
--   3) el efecto OBSERVABLE de un INSERT real (trigger AFTER INSERT): comments.status y
--      properties.comment_count — nunca el nombre del trigger/función por catálogo.
--   4) el contrato de public.resolve_comment_reports_atomic(p_comment_id, p_action,
--      p_reason) vía llamada real (RPC), incluida su atomicidad ante fallo.
-- SUT AÚN NO EXISTE (RED, 2026-09-11): lo crea
--   supabase/migrations/20260910200001_comment_reports.sql (agente `supabase`, fase GREEN).
--
-- ── Decisiones de diseño FIJADAS aquí (test-author) que GREEN debe respetar ─────────────────
-- (a) `comment_reports.status` es TEXT con CHECK IN ('new','resolved') — NO el enum
--     property_report_status (que trae 'reviewing'/'dismissed', estados que este flujo no
--     usa: el auto-ocultar decide solo, y la RPC resuelve directo sin cola manual de
--     revisión intermedia). Ponytail: 2 estados reales, no 4 especulativos.
-- (b) "el autor no puede reportar su propio comentario" NO es un CHECK de columna (la tabla
--     no guarda el autor, solo comment_id) — vive en el WITH CHECK de comment_reports_insert
--     vía subquery a public.comments.user_id, calco del patrón <gestor> de 112 (subquery a
--     properties). Un intento del autor lanza 42501 (RLS), NUNCA 23514.
-- (c) Trigger `check_comment_reports_autohide`, AFTER INSERT en comment_reports, SIN bloque
--     EXCEPTION (calco textual de 20260828000002_property_reports_autosuspend.sql): lockea
--     la fila de comments (`for update`), si status YA es 'hidden' o 'deleted' → no-op total;
--     si no, cuenta `count(distinct reported_by_user_id)` con `created_at >= now() -
--     interval '24 hours'` (incluye la fila recién insertada) → >=3 hace
--     `update comments set status='hidden'`. El trigger de 289.2
--     (`trg_comment_count`, AFTER UPDATE OF status) hace el resto (decrementa
--     properties.comment_count) — este archivo NO duplica esa lógica, solo observa su
--     efecto. Sin notificaciones (fuera del footprint de esta subtarea, a diferencia de
--     220.2 que sí notifica).
-- (d) `resolve_comment_reports_atomic(p_comment_id uuid, p_action text, p_reason text
--     default null)` SECURITY DEFINER, SIN parámetro p_admin_id (a diferencia de
--     resolve_property_reports_atomic, que lo recibe de una EF con service_role): el actor
--     es SIEMPRE `auth.uid()`, la función se GRANTea a `authenticated` y el guard de admin
--     vive DENTRO (private.is_admin()) — corre ANTES incluso de resolver p_comment_id (no
--     revela si el comentario existe a un no-admin, mismo criterio que
--     resolve_advertising_request/20260902100001 D-ADMIN). Orden de guards, calco de
--     resolve_property_reports_atomic:
--       1. admin_id := auth.uid(); si es null o no private.is_admin() → RAISE 'ADMIN_REQUIRED'
--          P0001.
--       2. p_action NOT IN ('restore','keep_hidden','delete_comment') → RAISE
--          'INVALID_ACTION' P0001.
--       3. `for update` sobre comments por p_comment_id; NOT FOUND → RAISE
--          'COMMENT_NOT_FOUND' P0001.
--       4. Guard de ORIGEN común a las 3 acciones (calco del guard "status<>'suspended'" de
--          220.3): si status ANTES no es 'hidden' → NO-OP TOTAL silencioso (retry-dedup +
--          comentario que nunca estuvo oculto).
--       5. Transición: restore→'visible', delete_comment→'deleted', keep_hidden→sin cambio
--          de status.
--       6. Cierra comment_reports 'new'→'resolved' de ESE comment_id (D-SCOPE, calco 220.3).
--       7. INSERT en admin_actions: admin_id=auth.uid(), entity_type='comment',
--          entity_id=p_comment_id, action_type IN ('comment_restore','comment_keep_hidden',
--          'comment_delete') (admin_actions.action_type es TEXT libre, SIN CHECK — verificado
--          en 20260604000007, ningún catálogo que ensanchar), reason=p_reason.
--       8. SIN bloque EXCEPTION (D-ATOMICIDAD): el fallo del INSERT de admin_actions revierte
--          TODO — status y comment_reports.status NO cambian.
--     Grants: 🔴 Postgres otorga EXECUTE a PUBLIC por default en toda función nueva (anon
--     hereda PUBLIC) — GREEN DEBE `revoke execute ... from public, anon` ANTES de `grant
--     execute ... to authenticated` (calco `create_advertising_request`,
--     20260902100001:205), o RPC_ANON1 de abajo pasa por accidente hoy y se rompe en
--     silencio el día que alguien confíe en "anon no puede". anon sin grant → 42501 nativo
--     de Postgres, nunca entra al cuerpo (el guard interno ni se evalúa).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(96);

-- Helper de impersonación (mismo patrón que 02/.../109/110/112).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '00000000-0000-0000-0000-000000289 3XX' (subtarea 289.3, archivo
-- 113 -- sin colisión con 289.2/112 que usa 2892XX).
--   USERS (01-09):
--     01 AUTHOR1    autor de la mayoría de los comentarios bajo prueba
--     02 AUTHOR2    autor de un comentario dedicado a dedupe (evita compartir con AUTHOR1)
--     03 REP1       reportante 1 (reusado entre secciones — el dedupe es por comment_id+user)
--     04 REP2       reportante 2
--     05 REP3       reportante 3
--     06 REP4       reportante 4 (4º reporte sobre un comentario ya oculto)
--     07 STRANGER   authenticated sin relación con los reportes del fixture
--     08 PROP_OWNER dueño de TODAS las propiedades del fixture — "gestor" de comments (RLS de
--                   289.2), NUNCA admin de plataforma — ancla RLS_SEL4 (el gestor NO ve
--                   comment_reports, solo el admin sí).
--     09 PLAT_ADMIN admin de plataforma (users.role='admin')
--   PROPERTIES (50-56): 50=PROP1(general, RLS/dedupe/self-report) 51=PROP_COUNT_A(dedicada,
--     3/24h feliz) 52=PROP_COUNT_OLD(dedicada, reporte viejo no cuenta) 53=PROP_ALREADY
--     (dedicada, ya oculto por gestor) 54=PROP_TZ(dedicada, boundary 23:59/24:01 bajo 4 TZ)
--     55=PROP_RPC(dedicada, RPC de resolución) 56=PROP_DELETED(dedicada, ya deleted)
--   COMMENTS: ver cada sección (IDs descriptivos por comentario, evita colisión de estado
--     entre secciones — mismo principio de aislamiento que 112).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000289301', 'author1.2893@test.local'),
  ('00000000-0000-0000-0000-000000289302', 'author2.2893@test.local'),
  ('00000000-0000-0000-0000-000000289303', 'rep1.2893@test.local'),
  ('00000000-0000-0000-0000-000000289304', 'rep2.2893@test.local'),
  ('00000000-0000-0000-0000-000000289305', 'rep3.2893@test.local'),
  ('00000000-0000-0000-0000-000000289306', 'rep4.2893@test.local'),
  ('00000000-0000-0000-0000-000000289307', 'stranger.2893@test.local'),
  ('00000000-0000-0000-0000-000000289308', 'propowner.2893@test.local'),
  ('00000000-0000-0000-0000-000000289309', 'platadmin.2893@test.local');

update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000289309';

insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000289350', '00000000-0000-0000-0000-000000289308',
   'departamento', 'rent', 'Fixture 2893 — PROP1 (general)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-000000289351', '00000000-0000-0000-0000-000000289308',
   'departamento', 'rent', 'Fixture 2893 — PROP_COUNT_A',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography, 12100, 'active'),
  ('00000000-0000-0000-0000-000000289352', '00000000-0000-0000-0000-000000289308',
   'departamento', 'rent', 'Fixture 2893 — PROP_COUNT_OLD',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.37, 20.69), 4326)::extensions.geography, 12200, 'active'),
  ('00000000-0000-0000-0000-000000289353', '00000000-0000-0000-0000-000000289308',
   'departamento', 'rent', 'Fixture 2893 — PROP_ALREADY',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.38, 20.70), 4326)::extensions.geography, 12300, 'active'),
  ('00000000-0000-0000-0000-000000289354', '00000000-0000-0000-0000-000000289308',
   'departamento', 'rent', 'Fixture 2893 — PROP_TZ',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.39, 20.71), 4326)::extensions.geography, 12400, 'active'),
  ('00000000-0000-0000-0000-000000289355', '00000000-0000-0000-0000-000000289308',
   'departamento', 'rent', 'Fixture 2893 — PROP_RPC',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.40, 20.72), 4326)::extensions.geography, 12500, 'active'),
  ('00000000-0000-0000-0000-000000289356', '00000000-0000-0000-0000-000000289308',
   'departamento', 'rent', 'Fixture 2893 — PROP_DELETED',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.41, 20.73), 4326)::extensions.geography, 12600, 'active');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) ESTRUCTURA — catálogo puro (has_table/col_*/pg_constraint). NUNCA lanza aunque
--    comment_reports no exista todavía (patrón heredado de 112/38). Va ANTES de cualquier
--    INSERT real en comment_reports.
-- ════════════════════════════════════════════════════════════════════════════

select has_table('public', 'comment_reports', 'TBL1_tabla_public_comment_reports_existe');

select col_type_is('public', 'comment_reports', 'id', 'uuid', 'COL1_id_es_uuid');
select col_is_pk('public', 'comment_reports', 'id', 'COL2_id_es_primary_key');
select col_type_is('public', 'comment_reports', 'comment_id', 'uuid', 'COL3_comment_id_es_uuid');
select col_not_null('public', 'comment_reports', 'comment_id', 'COL4_comment_id_es_not_null');
select col_type_is('public', 'comment_reports', 'reported_by_user_id', 'uuid', 'COL5_reported_by_user_id_es_uuid');
select col_not_null('public', 'comment_reports', 'reported_by_user_id', 'COL6_reported_by_user_id_es_not_null');
select col_type_is('public', 'comment_reports', 'reason', 'property_report_reason', 'COL7_reason_reusa_el_enum_property_report_reason');
select col_not_null('public', 'comment_reports', 'reason', 'COL8_reason_es_not_null');
select col_type_is('public', 'comment_reports', 'reason_text', 'text', 'COL9_reason_text_es_text');
select col_type_is('public', 'comment_reports', 'status', 'text', 'COL10_status_es_text (decision a — no el enum property_report_status)');
select col_not_null('public', 'comment_reports', 'status', 'COL11_status_es_not_null');
select col_default_is('public', 'comment_reports', 'status', 'new', 'COL12_status_default_new');
select col_type_is('public', 'comment_reports', 'created_at', 'timestamp with time zone', 'COL13_created_at_es_timestamptz');
select col_not_null('public', 'comment_reports', 'created_at', 'COL14_created_at_es_not_null');

select is(
  (select c2.confdeltype
     from pg_constraint c2
     join pg_class t on t.oid = c2.conrelid
     join pg_namespace n on n.oid = t.relnamespace
     join pg_class ft on ft.oid = c2.confrelid
    where n.nspname = 'public' and t.relname = 'comment_reports' and c2.contype = 'f'
      and ft.relname = 'comments'),
  'c', 'FK1_comment_id_referencia_comments_on_delete_cascade'
);
select is(
  (select c2.confdeltype
     from pg_constraint c2
     join pg_class t on t.oid = c2.conrelid
     join pg_namespace n on n.oid = t.relnamespace
     join pg_class ft on ft.oid = c2.confrelid
    where n.nspname = 'public' and t.relname = 'comment_reports' and c2.contype = 'f'
      and ft.relname = 'users' and ft.relnamespace = 'public'::regnamespace),
  'c', 'FK2_reported_by_user_id_referencia_public_users_on_delete_cascade'
);

-- UNIQUE(comment_id, reported_by_user_id): vía pg_index (property_reports_one_per_user y
-- user_reports_one_per_user, los 2 precedentes reusados, son índices únicos SUELTOS, no
-- constraints nombrados -- pg_constraint.contype='u' daría falso negativo contra ESE mismo
-- patrón). Sin cast ::regclass (revienta si la tabla no existe todavía, rompiendo la
-- frontera RED-catalogo-puro) -- todo resuelto por nombre vía joins, mismo criterio que
-- FK1/FK2 de arriba.
select is(
  (select count(*)::int
     from pg_index ix
     join pg_class t on t.oid = ix.indrelid
     join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'comment_reports' and ix.indisunique
      and (select array_agg(k order by k) from unnest(ix.indkey::int2[]) as k)
        = (
            select array_agg(a.attnum order by a.attnum)
              from pg_attribute a
              join pg_class t2 on t2.oid = a.attrelid
              join pg_namespace n2 on n2.oid = t2.relnamespace
             where n2.nspname = 'public' and t2.relname = 'comment_reports'
               and a.attname in ('comment_id', 'reported_by_user_id')
          )
  ),
  1, 'UNIQ1_unique_comment_id_reported_by_user_id_existe (columnas como CONJUNTO, sin importar el orden del indice)'
);

-- SECDEF: trigger de auto-ocultar y la RPC son SECURITY DEFINER (catálogo puro, patrón 112
-- SECDEF1).
select is(
  (select count(*)::int from pg_trigger tg
     join pg_proc p on p.oid = tg.tgfoid
     join pg_class t on t.oid = tg.tgrelid
    where t.relname = 'comment_reports' and not tg.tgisinternal and p.prosecdef = true),
  (select count(*)::int from pg_trigger tg
     join pg_class t on t.oid = tg.tgrelid
    where t.relname = 'comment_reports' and not tg.tgisinternal),
  'SECDEF1_todo_trigger_no_interno_de_comment_reports_es_security_definer'
);
select ok(
  (select prosecdef from pg_proc
    where proname = 'resolve_comment_reports_atomic' and pronamespace = 'public'::regnamespace),
  'SECDEF2_resolve_comment_reports_atomic_es_security_definer'
);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — public.comments (a partir de aquí un INSERT crudo contra comment_reports
-- inexistente ABORTA la transacción -- frontera esperada del RED, igual que 112).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-000000289360', '00000000-0000-0000-0000-000000289350', '00000000-0000-0000-0000-000000289301', 'Comentario para self-report', 'visible'),
  ('00000000-0000-0000-0000-000000289361', '00000000-0000-0000-0000-000000289350', '00000000-0000-0000-0000-000000289301', 'Comentario para RLS insert/select', 'visible'),
  ('00000000-0000-0000-0000-000000289362', '00000000-0000-0000-0000-000000289350', '00000000-0000-0000-0000-000000289302', 'Comentario para dedupe', 'visible');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) [CHECK] reason='other' exige reason_text con contenido real — calco 220.1/289.2 (\S,
--    NUNCA trim()). Usa reportantes distintos por fila para no chocar con el UNIQUE.
-- ════════════════════════════════════════════════════════════════════════════

select throws_ok(
  $$ insert into public.comment_reports (comment_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000289361', '00000000-0000-0000-0000-000000289303', 'other', null) $$,
  '23514', null,
  'CHK1_other_sin_reason_text_NULL_es_rechazado'
);
select throws_ok(
  $$ insert into public.comment_reports (comment_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000289361', '00000000-0000-0000-0000-000000289304', 'other', '') $$,
  '23514', null,
  'CHK2_other_con_reason_text_vacio_es_rechazado'
);
select throws_ok(
  $$ insert into public.comment_reports (comment_id, reported_by_user_id, reason, reason_text)
     values ('00000000-0000-0000-0000-000000289361', '00000000-0000-0000-0000-000000289305', 'other', E'\t\n ') $$,
  '23514', null,
  'CHK3_other_con_solo_whitespace_unicode_no_ascii_es_rechazado'
);
insert into public.comment_reports (comment_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000289361', '00000000-0000-0000-0000-000000289306', 'other', 'motivo real');
select is(
  (select reason_text from public.comment_reports
    where comment_id = '00000000-0000-0000-0000-000000289361' and reported_by_user_id = '00000000-0000-0000-0000-000000289306'),
  'motivo real', 'CHK4_other_con_texto_real_se_acepta'
);
insert into public.comment_reports (comment_id, reported_by_user_id, reason, reason_text) values
  ('00000000-0000-0000-0000-000000289360', '00000000-0000-0000-0000-000000289303', 'duplicate', null);
select is(
  (select status from public.comment_reports
    where comment_id = '00000000-0000-0000-0000-000000289360' and reported_by_user_id = '00000000-0000-0000-0000-000000289303'),
  'new', 'CHK5_status_nace_new'
);

-- 'spam' NO es un label del enum reusado (property_report_reason no lo tiene) -- CHK5 usa un
-- cast directo que debe fallar en catálogo puro si el plan de reuso es correcto: se ancla acá
-- como boundary de que el enum reusado es EXACTAMENTE property_report_reason (7 labels), sin
-- un 8vo label 'spam' agregado ad hoc para comment_reports.
select throws_ok(
  $$ select 'spam'::property_report_reason $$,
  '22P02', null,
  'CHK6_spam_NO_es_un_label_de_property_report_reason (el catalogo de razones NO crece para comments)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) [CHECK status] status fuera de ('new','resolved') es rechazado.
-- ════════════════════════════════════════════════════════════════════════════

select throws_ok(
  $$ insert into public.comment_reports (comment_id, reported_by_user_id, reason, status)
     values ('00000000-0000-0000-0000-000000289360', '00000000-0000-0000-0000-000000289304', 'inappropriate', 'reviewing') $$,
  '23514', null,
  'CHK7_status_fuera_del_catalogo_new_resolved_es_rechazado'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) [DEDUPE] UNIQUE(comment_id, reported_by_user_id).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-000000289362', '00000000-0000-0000-0000-000000289303', 'duplicate');
select throws_ok(
  $$ insert into public.comment_reports (comment_id, reported_by_user_id, reason)
     values ('00000000-0000-0000-0000-000000289362', '00000000-0000-0000-0000-000000289303', 'misleading') $$,
  '23505', null,
  'DEDUPE1_segundo_reporte_del_mismo_usuario_sobre_el_mismo_comentario_es_rechazado'
);
-- El mismo usuario (REP4/289306, que ya reportó 289361 en CHK4 arriba con reason='other') SÍ
-- puede reportar OTRO comentario más (289360, nunca antes reportado por él).
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-000000289360', '00000000-0000-0000-0000-000000289306', 'duplicate');
select is(
  (select count(*)::int from public.comment_reports where reported_by_user_id = '00000000-0000-0000-0000-000000289306'),
  2, 'DEDUPE2_el_mismo_usuario_si_puede_reportar_otro_comentario_distinto (289361 de CHK4 + 289360)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) [RLS] INSERT — reported_by_user_id = auth.uid(), NO el autor del comentario, anon nada.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000289303'); -- REP1
select lives_ok(
  $$ insert into public.comment_reports (comment_id, reported_by_user_id, reason)
     values ('00000000-0000-0000-0000-000000289361', '00000000-0000-0000-0000-000000289303', 'inappropriate') $$,
  'RLS_INS1_un_usuario_puede_insertar_con_reported_by_user_id_igual_a_si_mismo'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000289303'); -- REP1
select throws_ok(
  $$ insert into public.comment_reports (comment_id, reported_by_user_id, reason)
     values ('00000000-0000-0000-0000-000000289360', '00000000-0000-0000-0000-000000289305', 'inappropriate') $$,
  '42501', null,
  'RLS_INS2_un_usuario_NO_puede_insertar_a_nombre_de_otro_usuario'
);
reset role;

-- AUTHOR1 (0289301) es el autor de C_SELFREPORT (289360) -- no puede reportar su propio
-- comentario. Ancla decisión (b) del header: 42501, NUNCA 23514.
select pg_temp.act_as('00000000-0000-0000-0000-000000289301'); -- AUTHOR1
select throws_ok(
  $$ insert into public.comment_reports (comment_id, reported_by_user_id, reason)
     values ('00000000-0000-0000-0000-000000289360', '00000000-0000-0000-0000-000000289301', 'inappropriate') $$,
  '42501', null,
  'RLS_INS3_el_autor_del_comentario_NO_puede_reportar_su_propio_comentario'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000289307', 'anon'); -- STRANGER como anon
select throws_ok(
  $$ insert into public.comment_reports (comment_id, reported_by_user_id, reason)
     values ('00000000-0000-0000-0000-000000289360', '00000000-0000-0000-0000-000000289307', 'inappropriate') $$,
  '42501', null,
  'RLS_INS4_anon_no_puede_insertar (sin GRANT de tabla, lección 203.1: helper propio para anon)'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) [RLS] SELECT — el reportante ve lo suyo, otro authenticated no ve, admin ve todo, el
--    GESTOR de la propiedad (NO admin de plataforma) NO ve los reportes.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000289303'); -- REP1, dueño de su reporte sobre 289361
select is(
  (select count(*)::int from public.comment_reports
    where comment_id = '00000000-0000-0000-0000-000000289361' and reported_by_user_id = '00000000-0000-0000-0000-000000289303'),
  1, 'RLS_SEL1_el_reportante_ve_su_propio_reporte'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000289307'); -- STRANGER, ajeno
select is(
  (select count(*)::int from public.comment_reports
    where comment_id = '00000000-0000-0000-0000-000000289361' and reported_by_user_id = '00000000-0000-0000-0000-000000289303'),
  0, 'RLS_SEL2_un_usuario_ajeno_NO_ve_reportes_de_otro'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000289309'); -- PLAT_ADMIN
select ok(
  (select count(*)::int from public.comment_reports) >= 4,
  'RLS_SEL3_un_admin_de_plataforma_ve_todos_los_reportes'
);
reset role;

-- PROP_OWNER (0289308) es GESTOR de comments de PROP1 (owner_user_id, vía
-- private.is_property_comment_manager de 289.2) pero NUNCA admin de plataforma -- no debe ver
-- comment_reports (solo la RPC/admin resuelve).
select pg_temp.act_as('00000000-0000-0000-0000-000000289308'); -- PROP_OWNER
select is(
  (select count(*)::int from public.comment_reports
    where comment_id = '00000000-0000-0000-0000-000000289361' and reported_by_user_id = '00000000-0000-0000-0000-000000289303'),
  0, 'RLS_SEL4_el_gestor_de_la_propiedad_NO_ve_los_reportes_solo_admin'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) [RLS] Sin UPDATE/DELETE para authenticated, NI SIQUIERA para admin (la resolución va
--    SOLO por la RPC) -- 42501 de privilegio (sin GRANT), no 0 filas de policy.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000289303'); -- REP1
select throws_ok(
  $$ update public.comment_reports set status = 'resolved'
     where comment_id = '00000000-0000-0000-0000-000000289361' and reported_by_user_id = '00000000-0000-0000-0000-000000289303' $$,
  '42501', null,
  'RLS_UPD1_el_reportante_no_puede_actualizar_su_propio_reporte'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000289309'); -- PLAT_ADMIN
select throws_ok(
  $$ update public.comment_reports set status = 'resolved'
     where comment_id = '00000000-0000-0000-0000-000000289361' and reported_by_user_id = '00000000-0000-0000-0000-000000289303' $$,
  '42501', null,
  'RLS_UPD2_ni_siquiera_el_admin_puede_actualizar_directo_sin_pasar_por_la_RPC'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000289303'); -- REP1
select throws_ok(
  $$ delete from public.comment_reports
     where comment_id = '00000000-0000-0000-0000-000000289361' and reported_by_user_id = '00000000-0000-0000-0000-000000289303' $$,
  '42501', null,
  'RLS_DEL1_el_reportante_no_puede_borrar_su_propio_reporte'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000289309'); -- PLAT_ADMIN
select throws_ok(
  $$ delete from public.comment_reports
     where comment_id = '00000000-0000-0000-0000-000000289361' and reported_by_user_id = '00000000-0000-0000-0000-000000289303' $$,
  '42501', null,
  'RLS_DEL2_ni_siquiera_el_admin_puede_borrar_directo_sin_pasar_por_la_RPC'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 8) [AUTOHIDE feliz] PROP_COUNT_A — comentario visible, comment_count arranca en 1 (backfill
--    del trigger de 289.2 al insertar el comentario). 2 reportantes distintos -> sigue
--    visible; 3ro distinto -> oculto + comment_count baja a 0; 4to -> no-op (sin error, sigue
--    oculto, comment_count sigue en 0, no baja a -1).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002893a0', '00000000-0000-0000-0000-000000289351', '00000000-0000-0000-0000-000000289301', 'Comentario feliz 3/24h', 'visible');
select is(
  (select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289351'),
  1, 'AUTOHIDE1_comment_count_arranca_en_1'
);

insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002893a0', '00000000-0000-0000-0000-000000289303', 'inappropriate');
select is(
  (select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893a0'),
  'visible', 'AUTOHIDE2_con_1_reportante_distinto_sigue_visible'
);

insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002893a0', '00000000-0000-0000-0000-000000289304', 'inappropriate');
select is(
  (select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893a0'),
  'visible', 'AUTOHIDE3_con_2_reportantes_distintos_sigue_visible'
);
select is(
  (select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289351'),
  1, 'AUTOHIDE4_comment_count_sin_cambio_con_2_reportantes'
);

insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002893a0', '00000000-0000-0000-0000-000000289305', 'inappropriate');
select is(
  (select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893a0'),
  'hidden', 'AUTOHIDE5_el_3er_reportante_distinto_oculta_el_comentario'
);
select is(
  (select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289351'),
  0, 'AUTOHIDE6_comment_count_baja_a_0_via_trigger_de_289_2'
);

-- 4to reportante: no-op total, sin error, sin volver a decrementar.
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002893a0', '00000000-0000-0000-0000-000000289306', 'inappropriate');
select is(
  (select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893a0'),
  'hidden', 'AUTOHIDE7_el_4to_reportante_es_no_op_sigue_hidden'
);
select is(
  (select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289351'),
  0, 'AUTOHIDE8_comment_count_NO_baja_de_nuevo_sigue_en_0_nunca_negativo'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 9) [WINOLD] PROP_COUNT_OLD — un reporte de hace 25h NO cuenta para la ventana de 24h: 2
--    recientes + 1 viejo (distinto) -> sigue visible (conteo de ventana = 2).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002893b0', '00000000-0000-0000-0000-000000289352', '00000000-0000-0000-0000-000000289301', 'Comentario con reporte viejo', 'visible');

insert into public.comment_reports (comment_id, reported_by_user_id, reason, created_at) values
  ('00000000-0000-0000-0000-0000002893b0', '00000000-0000-0000-0000-000000289303', 'inappropriate', now() - interval '25 hours');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002893b0', '00000000-0000-0000-0000-000000289304', 'inappropriate');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002893b0', '00000000-0000-0000-0000-000000289305', 'inappropriate');
select is(
  (select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893b0'),
  'visible', 'WINOLD1_2_recientes_mas_1_de_hace_25h_no_alcanza_el_umbral_sigue_visible'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 10) [ALREADY] PROP_ALREADY — comentario ya oculto por el GESTOR (UPDATE directo, simula la
--     acción manual de un dueño/admin de agencia, fuera del footprint de esta subtarea).
--     Recibir 3 reportes nuevos es no-op total: sigue hidden, comment_count NO se decrementa
--     dos veces (ya bajó una sola vez con el UPDATE del gestor).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002893c0', '00000000-0000-0000-0000-000000289353', '00000000-0000-0000-0000-000000289301', 'Comentario ya oculto por gestor', 'visible');
select is(
  (select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289353'),
  1, 'ALREADY1_comment_count_arranca_en_1'
);

update public.comments set status = 'hidden' where id = '00000000-0000-0000-0000-0000002893c0';
select is(
  (select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289353'),
  0, 'ALREADY2_el_gestor_oculta_manualmente_comment_count_baja_a_0 (trigger 289.2, ajeno a este SUT)'
);

insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002893c0', '00000000-0000-0000-0000-000000289303', 'inappropriate');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002893c0', '00000000-0000-0000-0000-000000289304', 'inappropriate');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002893c0', '00000000-0000-0000-0000-000000289305', 'inappropriate');
select is(
  (select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893c0'),
  'hidden', 'ALREADY3_3_reportes_sobre_un_comentario_ya_oculto_es_no_op_sigue_hidden'
);
select is(
  (select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289353'),
  0, 'ALREADY4_comment_count_NO_se_decrementa_una_segunda_vez_sigue_en_0'
);

-- Variante 'deleted': mismo guard de origen debe cubrir el otro estado terminal.
insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002893c1', '00000000-0000-0000-0000-000000289356', '00000000-0000-0000-0000-000000289301', 'Comentario ya deleted', 'visible');
update public.comments set status = 'deleted' where id = '00000000-0000-0000-0000-0000002893c1';
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002893c1', '00000000-0000-0000-0000-000000289303', 'inappropriate');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002893c1', '00000000-0000-0000-0000-000000289304', 'inappropriate');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002893c1', '00000000-0000-0000-0000-000000289305', 'inappropriate');
select is(
  (select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893c1'),
  'deleted', 'ALREADY5_3_reportes_sobre_un_comentario_ya_deleted_es_no_op_sigue_deleted'
);
select is(
  (select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289356'),
  0, 'ALREADY6_un_comentario_deleted_nunca_conto_en_comment_count'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 11) [WINBOUNDARY 4 TZ] PROP_TZ — el frontera 23h59 (dentro) vs 24h01 (fuera) se sostiene
--     IDÉNTICO sin importar el timezone de sesión (memoria tests_bomba_de_fecha_y_estado_
--     inicial): interval arithmetic sobre timestamptz es absoluto, nunca depende de
--     `set local timezone`. 4 comentarios frescos por TZ para el caso "dentro" (23h59, con 2
--     recientes -> hidden) y 2 para el caso "fuera" (24h01, con 2 recientes -> sigue visible,
--     UTC y Pacific/Kiritimati como extremos +14/-11h respecto a UTC).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002893d1', '00000000-0000-0000-0000-000000289354', '00000000-0000-0000-0000-000000289301', 'TZ UTC dentro', 'visible'),
  ('00000000-0000-0000-0000-0000002893d2', '00000000-0000-0000-0000-000000289354', '00000000-0000-0000-0000-000000289301', 'TZ Mexico dentro', 'visible'),
  ('00000000-0000-0000-0000-0000002893d3', '00000000-0000-0000-0000-000000289354', '00000000-0000-0000-0000-000000289301', 'TZ Kiritimati dentro', 'visible'),
  ('00000000-0000-0000-0000-0000002893d4', '00000000-0000-0000-0000-000000289354', '00000000-0000-0000-0000-000000289301', 'TZ Pago Pago dentro', 'visible'),
  ('00000000-0000-0000-0000-0000002893e1', '00000000-0000-0000-0000-000000289354', '00000000-0000-0000-0000-000000289301', 'TZ UTC fuera', 'visible'),
  ('00000000-0000-0000-0000-0000002893e2', '00000000-0000-0000-0000-000000289354', '00000000-0000-0000-0000-000000289301', 'TZ Kiritimati fuera', 'visible');

set local timezone = 'UTC';
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values ('00000000-0000-0000-0000-0000002893d1', '00000000-0000-0000-0000-000000289303', 'inappropriate');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values ('00000000-0000-0000-0000-0000002893d1', '00000000-0000-0000-0000-000000289304', 'inappropriate');
insert into public.comment_reports (comment_id, reported_by_user_id, reason, created_at) values ('00000000-0000-0000-0000-0000002893d1', '00000000-0000-0000-0000-000000289305', 'inappropriate', now() - interval '23 hours 59 minutes');
select is((select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893d1'), 'hidden', 'TZ1_UTC_reporte_a_23h59_esta_DENTRO_de_la_ventana_oculta');

set local timezone = 'America/Mexico_City';
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values ('00000000-0000-0000-0000-0000002893d2', '00000000-0000-0000-0000-000000289303', 'inappropriate');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values ('00000000-0000-0000-0000-0000002893d2', '00000000-0000-0000-0000-000000289304', 'inappropriate');
insert into public.comment_reports (comment_id, reported_by_user_id, reason, created_at) values ('00000000-0000-0000-0000-0000002893d2', '00000000-0000-0000-0000-000000289305', 'inappropriate', now() - interval '23 hours 59 minutes');
select is((select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893d2'), 'hidden', 'TZ2_America_Mexico_City_reporte_a_23h59_esta_DENTRO_de_la_ventana_oculta');

set local timezone = 'Pacific/Kiritimati';
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values ('00000000-0000-0000-0000-0000002893d3', '00000000-0000-0000-0000-000000289303', 'inappropriate');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values ('00000000-0000-0000-0000-0000002893d3', '00000000-0000-0000-0000-000000289304', 'inappropriate');
insert into public.comment_reports (comment_id, reported_by_user_id, reason, created_at) values ('00000000-0000-0000-0000-0000002893d3', '00000000-0000-0000-0000-000000289305', 'inappropriate', now() - interval '23 hours 59 minutes');
select is((select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893d3'), 'hidden', 'TZ3_Pacific_Kiritimati_UTC_mas_14_reporte_a_23h59_esta_DENTRO_de_la_ventana_oculta');

set local timezone = 'Pacific/Pago_Pago';
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values ('00000000-0000-0000-0000-0000002893d4', '00000000-0000-0000-0000-000000289303', 'inappropriate');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values ('00000000-0000-0000-0000-0000002893d4', '00000000-0000-0000-0000-000000289304', 'inappropriate');
insert into public.comment_reports (comment_id, reported_by_user_id, reason, created_at) values ('00000000-0000-0000-0000-0000002893d4', '00000000-0000-0000-0000-000000289305', 'inappropriate', now() - interval '23 hours 59 minutes');
select is((select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893d4'), 'hidden', 'TZ4_Pacific_Pago_Pago_UTC_menos_11_reporte_a_23h59_esta_DENTRO_de_la_ventana_oculta');

set local timezone = 'UTC';
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values ('00000000-0000-0000-0000-0000002893e1', '00000000-0000-0000-0000-000000289303', 'inappropriate');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values ('00000000-0000-0000-0000-0000002893e1', '00000000-0000-0000-0000-000000289304', 'inappropriate');
insert into public.comment_reports (comment_id, reported_by_user_id, reason, created_at) values ('00000000-0000-0000-0000-0000002893e1', '00000000-0000-0000-0000-000000289305', 'inappropriate', now() - interval '24 hours 1 minute');
select is((select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893e1'), 'visible', 'TZ5_UTC_reporte_a_24h01_esta_FUERA_de_la_ventana_sigue_visible');

set local timezone = 'Pacific/Kiritimati';
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values ('00000000-0000-0000-0000-0000002893e2', '00000000-0000-0000-0000-000000289303', 'inappropriate');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values ('00000000-0000-0000-0000-0000002893e2', '00000000-0000-0000-0000-000000289304', 'inappropriate');
insert into public.comment_reports (comment_id, reported_by_user_id, reason, created_at) values ('00000000-0000-0000-0000-0000002893e2', '00000000-0000-0000-0000-000000289305', 'inappropriate', now() - interval '24 hours 1 minute');
select is((select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893e2'), 'visible', 'TZ6_Pacific_Kiritimati_reporte_a_24h01_esta_FUERA_de_la_ventana_sigue_visible');

set local timezone to default;

-- ════════════════════════════════════════════════════════════════════════════
-- 12) [WINSPREAD] 3 reportes repartidos dentro de la ventana (23h/12h/ahora) SÍ ocultan --
--     ancla que la ventana es deslizante real, no "todos a la vez".
-- ════════════════════════════════════════════════════════════════════════════

insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002893f0', '00000000-0000-0000-0000-000000289354', '00000000-0000-0000-0000-000000289301', 'Comentario ventana repartida', 'visible');
insert into public.comment_reports (comment_id, reported_by_user_id, reason, created_at) values
  ('00000000-0000-0000-0000-0000002893f0', '00000000-0000-0000-0000-000000289303', 'inappropriate', now() - interval '23 hours');
insert into public.comment_reports (comment_id, reported_by_user_id, reason, created_at) values
  ('00000000-0000-0000-0000-0000002893f0', '00000000-0000-0000-0000-000000289304', 'inappropriate', now() - interval '12 hours');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002893f0', '00000000-0000-0000-0000-000000289305', 'inappropriate');
select is(
  (select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893f0'),
  'hidden', 'WINSPREAD1_3_reportes_repartidos_en_23h_12h_y_ahora_todos_dentro_de_24h_ocultan'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 13) [RPC] resolve_comment_reports_atomic — guards de admin/acción/existencia, orden de
--     evaluación, y las 3 transiciones (restore/keep_hidden/delete_comment).
-- ════════════════════════════════════════════════════════════════════════════

-- RPC_ORDER1: el guard de admin corre ANTES del de existencia -- un no-admin con un
-- comment_id INEXISTENTE recibe ADMIN_REQUIRED, no COMMENT_NOT_FOUND (no revela existencia).
select pg_temp.act_as('00000000-0000-0000-0000-000000289307'); -- STRANGER, no-admin
select throws_ok(
  $$ select public.resolve_comment_reports_atomic(
       '00000000-0000-0000-0000-000000000000'::uuid, 'restore', null) $$,
  'P0001', 'ADMIN_REQUIRED',
  'RPC_ORDER1_no_admin_con_comment_id_inexistente_recibe_ADMIN_REQUIRED_no_COMMENT_NOT_FOUND'
);
reset role;

-- RPC_ANON1: anon sin GRANT execute -> 42501 nativo, nunca entra al cuerpo.
select pg_temp.act_as('00000000-0000-0000-0000-000000289307', 'anon');
select throws_ok(
  $$ select public.resolve_comment_reports_atomic('00000000-0000-0000-0000-0000002893c0'::uuid, 'restore', null) $$,
  '42501', null,
  'RPC_ANON1_anon_sin_grant_execute_es_rechazado'
);
reset role;

-- RPC2: admin real con acción inválida -> INVALID_ACTION (antes de resolver el comment_id).
select pg_temp.act_as('00000000-0000-0000-0000-000000289309'); -- PLAT_ADMIN
select throws_ok(
  $$ select public.resolve_comment_reports_atomic(
       '00000000-0000-0000-0000-000000000000'::uuid, 'bogus_action', null) $$,
  'P0001', 'INVALID_ACTION',
  'RPC2_admin_con_accion_invalida_recibe_INVALID_ACTION'
);
reset role;

-- RPC3: admin real, acción válida, comment_id inexistente -> COMMENT_NOT_FOUND.
select pg_temp.act_as('00000000-0000-0000-0000-000000289309');
select throws_ok(
  $$ select public.resolve_comment_reports_atomic(
       '00000000-0000-0000-0000-000000000000'::uuid, 'restore', null) $$,
  'P0001', 'COMMENT_NOT_FOUND',
  'RPC3_admin_con_comment_id_inexistente_recibe_COMMENT_NOT_FOUND'
);
reset role;

-- Fixture RPC — comentario oculto (289301) con reportes 'new' pendientes.
insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002893a1', '00000000-0000-0000-0000-000000289355', '00000000-0000-0000-0000-000000289301', 'RPC restore', 'hidden');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002893a1', '00000000-0000-0000-0000-000000289303', 'inappropriate');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002893a1', '00000000-0000-0000-0000-000000289304', 'inappropriate');
select is(
  (select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289355'),
  0, 'RPC4_baseline_comment_count_en_0_comentario_oculto_desde_su_creacion'
);

-- RPC_ORDER2: no-admin con comment_id y acción VÁLIDOS -> igual ADMIN_REQUIRED, cero efecto.
select pg_temp.act_as('00000000-0000-0000-0000-000000289307'); -- STRANGER
select throws_ok(
  $$ select public.resolve_comment_reports_atomic(
       '00000000-0000-0000-0000-0000002893a1'::uuid, 'restore', 'motivo') $$,
  'P0001', 'ADMIN_REQUIRED',
  'RPC_ORDER2_no_admin_con_comment_id_y_accion_validos_tambien_recibe_ADMIN_REQUIRED'
);
reset role;
select is(
  (select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893a1'),
  'hidden', 'RPC_ORDER3_el_intento_de_no_admin_no_cambio_nada_sigue_hidden'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000289309'); -- PLAT_ADMIN
select lives_ok(
  $$ select public.resolve_comment_reports_atomic(
       '00000000-0000-0000-0000-0000002893a1'::uuid, 'restore', 'Reportes sin fundamento') $$,
  'RPC5_restore_por_un_admin_real_no_lanza'
);
reset role;
select is(
  (select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893a1'),
  'visible', 'RPC6_restore_pasa_el_comentario_de_hidden_a_visible'
);
select is(
  (select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289355'),
  1, 'RPC7_restore_incrementa_comment_count_via_trigger_de_289_2'
);
select is(
  (select count(*)::int from public.comment_reports
    where comment_id = '00000000-0000-0000-0000-0000002893a1' and status = 'new'),
  0, 'RPC8_restore_cierra_TODOS_los_reportes_new_a_resolved'
);
select is(
  (select count(*)::int from public.comment_reports
    where comment_id = '00000000-0000-0000-0000-0000002893a1' and status = 'resolved'),
  2, 'RPC9_restore_deja_los_2_reportes_en_resolved'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'comment' and entity_id = '00000000-0000-0000-0000-0000002893a1' and action_type = 'comment_restore'),
  1, 'RPC10_restore_audita_1_fila_en_admin_actions_con_action_type_comment_restore'
);
select is(
  (select admin_id from public.admin_actions
    where entity_type = 'comment' and entity_id = '00000000-0000-0000-0000-0000002893a1' and action_type = 'comment_restore'),
  '00000000-0000-0000-0000-000000289309'::uuid,
  'RPC11_admin_actions_admin_id_es_el_caller_auth_uid'
);

-- RPC12: retry-dedup -- una 2a llamada 'restore' sobre el mismo comentario (ya 'visible', NO
-- 'hidden') es no-op total: sin error, sin nueva fila en admin_actions.
select pg_temp.act_as('00000000-0000-0000-0000-000000289309');
select lives_ok(
  $$ select public.resolve_comment_reports_atomic(
       '00000000-0000-0000-0000-0000002893a1'::uuid, 'restore', null) $$,
  'RPC12_una_2a_llamada_restore_sobre_un_comentario_ya_visible_no_lanza'
);
reset role;
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'comment' and entity_id = '00000000-0000-0000-0000-0000002893a1'),
  1, 'RPC13_la_2a_llamada_retry_dedup_NO_agrego_una_2a_fila_de_auditoria (guard de origen status<>hidden)'
);

-- keep_hidden: comentario oculto con reportes 'new', el status NO cambia, se cierran los
-- reportes, se audita.
insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002893a2', '00000000-0000-0000-0000-000000289355', '00000000-0000-0000-0000-000000289301', 'RPC keep_hidden', 'hidden');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002893a2', '00000000-0000-0000-0000-000000289303', 'inappropriate');

select pg_temp.act_as('00000000-0000-0000-0000-000000289309');
select lives_ok(
  $$ select public.resolve_comment_reports_atomic(
       '00000000-0000-0000-0000-0000002893a2'::uuid, 'keep_hidden', 'Reportes fundados') $$,
  'RPC14_keep_hidden_por_un_admin_real_no_lanza'
);
reset role;
select is(
  (select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893a2'),
  'hidden', 'RPC15_keep_hidden_deja_el_comentario_hidden'
);
select is(
  (select count(*)::int from public.comment_reports
    where comment_id = '00000000-0000-0000-0000-0000002893a2' and status = 'resolved'),
  1, 'RPC16_keep_hidden_cierra_el_reporte_new_a_resolved'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'comment' and entity_id = '00000000-0000-0000-0000-0000002893a2' and action_type = 'comment_keep_hidden'),
  1, 'RPC17_keep_hidden_audita_action_type_comment_keep_hidden'
);

-- delete_comment: comentario oculto -> 'deleted', comment_count sin cambio (ya estaba en 0
-- por hidden), se audita.
insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002893a3', '00000000-0000-0000-0000-000000289355', '00000000-0000-0000-0000-000000289301', 'RPC delete_comment', 'hidden');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002893a3', '00000000-0000-0000-0000-000000289303', 'inappropriate');

select pg_temp.act_as('00000000-0000-0000-0000-000000289309');
select lives_ok(
  $$ select public.resolve_comment_reports_atomic(
       '00000000-0000-0000-0000-0000002893a3'::uuid, 'delete_comment', 'Contenido inapropiado confirmado') $$,
  'RPC18_delete_comment_por_un_admin_real_no_lanza'
);
reset role;
select is(
  (select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893a3'),
  'deleted', 'RPC19_delete_comment_pasa_el_comentario_a_deleted'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'comment' and entity_id = '00000000-0000-0000-0000-0000002893a3' and action_type = 'comment_delete'),
  1, 'RPC20_delete_comment_audita_action_type_comment_delete'
);
select is(
  (select count(*)::int from public.comment_reports
    where comment_id = '00000000-0000-0000-0000-0000002893a3' and status = 'resolved'),
  1, 'RPC21_delete_comment_tambien_cierra_los_reportes_new'
);

-- RPC22: guard de origen -- un comentario que NUNCA estuvo 'hidden' (visible desde su
-- creación) es no-op total para las 3 acciones, aunque ya tenga un reporte 'new' colgado
-- (caso patológico: el reporte se insertó pero el trigger de autohide, por lo que sea, no
-- llegó al umbral -- 1 solo reportante).
insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002893a4', '00000000-0000-0000-0000-000000289355', '00000000-0000-0000-0000-000000289301', 'RPC sobre visible nunca oculto', 'visible');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002893a4', '00000000-0000-0000-0000-000000289303', 'inappropriate');

select pg_temp.act_as('00000000-0000-0000-0000-000000289309');
select lives_ok(
  $$ select public.resolve_comment_reports_atomic(
       '00000000-0000-0000-0000-0000002893a4'::uuid, 'keep_hidden', null) $$,
  'RPC22_keep_hidden_sobre_un_comentario_que_nunca_estuvo_hidden_no_lanza'
);
reset role;
select is(
  (select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893a4'),
  'visible', 'RPC23_sigue_visible_el_guard_de_origen_lo_deja_intacto (decision documentada en el header)'
);
select is(
  (select count(*)::int from public.comment_reports
    where comment_id = '00000000-0000-0000-0000-0000002893a4' and status = 'new'),
  1, 'RPC24_el_reporte_new_NO_se_cierra_el_no_op_es_TOTAL'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'comment' and entity_id = '00000000-0000-0000-0000-0000002893a4'),
  0, 'RPC25_0_admin_actions_para_el_no_op'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 14) [FAULT] 🔒 BLOQUEANTE fault-injection: INSERT hacia admin_actions envenenado -> TODA la
--     llamada lanza excepción y NADA persiste (status, comment_reports.status).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002893a5', '00000000-0000-0000-0000-000000289355', '00000000-0000-0000-0000-000000289301', 'RPC fault injection', 'hidden');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002893a5', '00000000-0000-0000-0000-000000289303', 'inappropriate');

create or replace function pg_temp.poison_admin_actions_insert_2893()
returns trigger language plpgsql as $poison$
begin
  raise exception 'poison: fault injection forzada (pgTAP 113_comment_reports_test) para probar rollback total del evento'
    using errcode = '23505';
end
$poison$;

create trigger poison_admin_actions_before_insert_2893
  before insert on public.admin_actions
  for each row execute function pg_temp.poison_admin_actions_insert_2893();

select pg_temp.act_as('00000000-0000-0000-0000-000000289309');
select throws_ok(
  $$ select public.resolve_comment_reports_atomic(
       '00000000-0000-0000-0000-0000002893a5'::uuid, 'restore', 'Reportes sin fundamento') $$,
  '23505', null,
  'FAULT1_el_insert_de_admin_actions_falla_y_TODO_el_evento_lanza_excepcion'
);
reset role;

drop trigger if exists poison_admin_actions_before_insert_2893 on public.admin_actions;

select is(
  (select status::text from public.comments where id = '00000000-0000-0000-0000-0000002893a5'),
  'hidden', 'FAULT2_atomicidad_el_status_NO_quedo_restaurado'
);
select is(
  (select count(*)::int from public.comment_reports
    where comment_id = '00000000-0000-0000-0000-0000002893a5' and status = 'new'),
  1, 'FAULT3_atomicidad_el_reporte_NO_quedo_cerrado_sigue_new'
);
select is(
  (select count(*)::int from public.admin_actions where entity_id = '00000000-0000-0000-0000-0000002893a5'),
  0, 'FAULT4_atomicidad_0_admin_actions_huerfano'
);
select is(
  (select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289355'),
  2, 'FAULT5_atomicidad_comment_count_regreso_al_valor_previo_a_la_llamada_envenenada (1 de RPC5-restore + 1 de la insercion visible de RPC22, ver header de la seccion)'
);

select * from finish();
rollback;
