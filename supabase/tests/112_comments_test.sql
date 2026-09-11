-- Tests pgTAP — comments (subtarea 289.2, tarea #289): enum comment_status, tabla
-- public.comments, properties.comment_count por trigger atómico, RLS y CHECKs.
-- Ejecutar con:
--   supabase test db supabase/tests/112_comments_test.sql --local
-- (CLI GLOBAL de brew, NUNCA npx supabase). Corre como superusuario (rol `postgres`, dueño
-- de las tablas -> bypassa RLS por ownership, NO es superuser real: 20260904300001) dentro de
-- una transacción revertida (no persiste). Los fixtures se insertan directo (bypass RLS); las
-- aserciones impersonan con pg_temp.act_as(uid,role) (mismo patrón que 02/08/18/21/25/27/28/
-- 29/30/31/77/90/107/108/109/110).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba (comportamiento observable vía impersonación JWT / catálogo, NUNCA
-- internals):
--   1) enum public.comment_status (4 labels)
--   2) tabla public.comments (columnas, CHECK de body, FKs, defaults)
--   3) properties.comment_count (columna denormalizada, AL FINAL de properties)
--   4) trigger atómico AFTER INSERT OR UPDATE OF status OR DELETE en comments que mantiene
--      comment_count (cuenta solo status='visible', GREATEST(0,...), SECURITY DEFINER
--      search_path='')
--   5) policies comments_select / comments_update (USING/WITH CHECK) — sin policy de INSERT
--      ni DELETE para authenticated
--   6) GRANTs de tabla (solo authenticated: select+update; anon nada; service_role insert)
-- SUT AÚN NO EXISTE (RED, 2026-09-11): lo crea
--   supabase/migrations/20260910100001_comments.sql (agente `supabase`, fase GREEN).
--
-- ── 🔴 CORRECCIÓN AL PLAN REGISTRADO (verificación empírica, 2026-09-11) ────────────────────
-- (a) FK de user_id: el plan pedía `references auth.users(id)`. Grep exhaustivo de
--     `supabase/migrations/*.sql` muestra que SOLO `public.users.id` referencia
--     `auth.users(id)` directamente (20260604000002:7); TODA tabla de contenido
--     (property_reports, notifications, admin_actions, events_raw, likes, saves, leads,
--     properties.owner_user_id) referencia `public.users(id) on delete cascade`
--     (20260604000006/20260604000007/20260604000005). comments.user_id sigue ese mismo
--     patrón: `references public.users(id) on delete cascade`. FK2 abajo ancla esto.
-- (b) <gestor>: el plan citaba la expresión de properties_update de
--     `20260805000003_agency_role_matrix.sql` (`owner_user_id=auth.uid() OR
--     private.is_agency_owner_of(owner_user_id) OR agency_role_of(agency_id)='admin' OR
--     is_admin()`) — esa migración quedó SUPERADA por #202
--     (`20260904100001_suspension_congela_escritura.sql`, verificado en el archivo): la
--     properties_update VIVA hoy es
--       (owner_user_id = auth.uid() AND (agency_id IS NULL OR agency_role_of(agency_id) IS NOT NULL))
--       OR agency_role_of(agency_id) IN ('owner','admin')
--       OR private.is_admin()
--     — la rama del dueño exige membresía VIGENTE (activa) cuando la property tiene agencia
--     ("suspender congela la ACTUACIÓN", #202). <gestor> de comments usa ESTA forma viva
--     (vía subquery a properties por comments.property_id), no la desactualizada. Las
--     secciones SEL13-15 anclan exactamente esto (un dueño SUSPENDIDO pierde el poder de
--     gestor sobre los comentarios ocultos de su propia propiedad; el owner/admin de agencia
--     lo conserva, sin verse afectado por la suspensión individual del dueño).
-- ── Trampa metodológica evitada (memoria pgtap_policy_dominada_por_select, guardian 269.3) ──
-- Todo negativo de UPDATE (UPD3/UPD6/UPD7) se ejerce sobre una fila que el rol SÍ VE por
-- comments_select (visible o propia) -- así un 0-filas discrimina la policy de escritura, no
-- un filtro de lectura que ya la escondía.
-- ── Aislamiento de fixtures (evita mutar estado leído por otras secciones) ──────────────────
-- Las filas de PROP1/PROP2/PROP3 (60-67) son SOLO-LECTURA en este archivo (nunca reciben un
-- UPDATE/DELETE que prospere) -- las secciones de escritura real (UPD/DEL) usan PROP4 (rows
-- CW1-CW3, 68-6a), y el trigger de contador usa PROP5 (fresca, sin comentarios de fixture).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(83);

-- Helper de impersonación (mismo patrón que 02/.../109/110).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '00000000-0000-0000-0000-000000289XXX' (subtarea 289.2, archivo
-- 112 -- sin colisión con prefijos previos: 0202XX/0226XX/269XXX/1093XX/2761XX).
--   USERS (actores, 01-09):
--     01 AG          agente ACTIVO en AGX, DUEÑO de PROP1 (owner_user_id) — gestor por self+membresía activa
--     02 AG_SUS      agente SUSPENDIDO en AGX, DUEÑO de PROP2 — pierde el poder de gestor (#202)
--     03 IND         agente INDEPENDIENTE (sin agencia), DUEÑO de PROP3 — gestor por self, agency_id NULL
--     04 OWNER_AGX   owner  ACTIVO de AGX — gestor de TODO lo de AGX
--     05 ADMIN_AGX   admin  ACTIVO de AGX — gestor de TODO lo de AGX
--     06 RASO_AGX    agente ACTIVO en AGX, NO dueño de nada del fixture — NO es gestor
--     07 PLAT_ADMIN  admin de PLATAFORMA (users.role='admin'), sin relación con AGX
--     08 OWNER_AGY   owner ACTIVO de AGY (agencia AJENA) — sin relación con AGX
--     09 STRANGER    authenticated sin ninguna relación con propiedades/agencias del fixture
--   AUTORES DE COMENTARIOS (0a-0d):
--     0a BU1  autor de C_VIS1/C_HELD1/C_HIDDEN1/C_DEL1 (PROP1) y CW1/CW2/CW3 (PROP4)
--     0b BU2  autor de C_HIDDEN2 (PROP1) — comentario AJENO a BU1
--     0c BU3  autor de C_VIS_P2/C_HIDDEN_P2 (PROP2)
--     0d BU4  autor de C_HIDDEN_P3 (PROP3)
--   AGENCIES: 30=AGX, 31=AGY (ajena, sin relación con AGX)
--   AGENCY_MEMBERS (40-45): 40=AGX/AG(agent,active) 41=AGX/AG_SUS(agent,suspended)
--     42=AGX/OWNER_AGX(owner,active) 43=AGX/ADMIN_AGX(admin,active) 44=AGX/RASO_AGX(agent,active)
--     45=AGY/OWNER_AGY(owner,active)
--   PROPERTIES (50-54): 50=PROP1(AG/AGX) 51=PROP2(AG_SUS/AGX) 52=PROP3(IND/null)
--     53=PROP4(AG/AGX, dedicada a UPDATE/DELETE reales) 54=PROP5(AG/AGX, fresca, trigger de conteo)
--   COMMENTS (60-6a): 60=C_VIS1(visible) 61=C_HELD1(held_for_review) 62=C_HIDDEN1(hidden)
--     63=C_DEL1(deleted) — los 4 de BU1 en PROP1; 64=C_HIDDEN2(hidden, BU2, PROP1);
--     65=C_VIS_P2(visible,BU3,PROP2) 66=C_HIDDEN_P2(hidden,BU3,PROP2) 67=C_HIDDEN_P3(hidden,BU4,PROP3)
--     68=CW1(visible,BU1,PROP4) 69=CW2(visible,BU1,PROP4) 6a=CW3(visible,BU1,PROP4)
--   COUNT TRIGGER (80-81, insertados DURANTE el test, no en fixtures): 80=CT_VIS 81=CT_HELD
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000289201', 'ag.289@test.local'),
  ('00000000-0000-0000-0000-000000289202', 'agsus.289@test.local'),
  ('00000000-0000-0000-0000-000000289203', 'ind.289@test.local'),
  ('00000000-0000-0000-0000-000000289204', 'owneragx.289@test.local'),
  ('00000000-0000-0000-0000-000000289205', 'adminagx.289@test.local'),
  ('00000000-0000-0000-0000-000000289206', 'rasoagx.289@test.local'),
  ('00000000-0000-0000-0000-000000289207', 'platadmin.289@test.local'),
  ('00000000-0000-0000-0000-000000289208', 'owneragy.289@test.local'),
  ('00000000-0000-0000-0000-000000289209', 'stranger.289@test.local'),
  ('00000000-0000-0000-0000-00000028920a', 'bu1.289@test.local'),
  ('00000000-0000-0000-0000-00000028920b', 'bu2.289@test.local'),
  ('00000000-0000-0000-0000-00000028920c', 'bu3.289@test.local'),
  ('00000000-0000-0000-0000-00000028920d', 'bu4.289@test.local');

update public.users set role = 'agent', is_verified_agent = true
  where id in ('00000000-0000-0000-0000-000000289201', '00000000-0000-0000-0000-000000289202',
               '00000000-0000-0000-0000-000000289203', '00000000-0000-0000-0000-000000289204',
               '00000000-0000-0000-0000-000000289205', '00000000-0000-0000-0000-000000289206');
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000000289207';

insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000289230', 'Inmobiliaria Comments 289', 'inmo-comments-289',
   'active', '00000000-0000-0000-0000-000000289204'),
  ('00000000-0000-0000-0000-000000289231', 'Inmobiliaria Ajena 289', 'inmo-ajena-289',
   'active', '00000000-0000-0000-0000-000000289208');

insert into public.agency_members (id, agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000289240', '00000000-0000-0000-0000-000000289230', '00000000-0000-0000-0000-000000289201', 'agent',  'active'),
  ('00000000-0000-0000-0000-000000289241', '00000000-0000-0000-0000-000000289230', '00000000-0000-0000-0000-000000289202', 'agent',  'suspended'),
  ('00000000-0000-0000-0000-000000289242', '00000000-0000-0000-0000-000000289230', '00000000-0000-0000-0000-000000289204', 'owner',  'active'),
  ('00000000-0000-0000-0000-000000289243', '00000000-0000-0000-0000-000000289230', '00000000-0000-0000-0000-000000289205', 'admin',  'active'),
  ('00000000-0000-0000-0000-000000289244', '00000000-0000-0000-0000-000000289230', '00000000-0000-0000-0000-000000289206', 'agent',  'active'),
  ('00000000-0000-0000-0000-000000289245', '00000000-0000-0000-0000-000000289231', '00000000-0000-0000-0000-000000289208', 'owner',  'active');

insert into public.properties (id, owner_user_id, agency_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000289250', '00000000-0000-0000-0000-000000289201', '00000000-0000-0000-0000-000000289230',
   'departamento', 'rent', 'Fixture 289 — PROP1 (dueño AG, activo)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-000000289251', '00000000-0000-0000-0000-000000289202', '00000000-0000-0000-0000-000000289230',
   'departamento', 'rent', 'Fixture 289 — PROP2 (dueño AG_SUS, suspendido)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography, 13000, 'active'),
  ('00000000-0000-0000-0000-000000289252', '00000000-0000-0000-0000-000000289203', null,
   'casa', 'sale', 'Fixture 289 — PROP3 (dueño IND, independiente)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.37, 20.69), 4326)::extensions.geography, 2500000, 'active'),
  ('00000000-0000-0000-0000-000000289253', '00000000-0000-0000-0000-000000289201', '00000000-0000-0000-0000-000000289230',
   'departamento', 'rent', 'Fixture 289 — PROP4 (dedicada a UPDATE/DELETE reales)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.38, 20.70), 4326)::extensions.geography, 14000, 'active'),
  ('00000000-0000-0000-0000-000000289254', '00000000-0000-0000-0000-000000289201', '00000000-0000-0000-0000-000000289230',
   'departamento', 'rent', 'Fixture 289 — PROP5 (fresca, dedicada al trigger de conteo)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.39, 20.71), 4326)::extensions.geography, 15000, 'active'),
  ('00000000-0000-0000-0000-000000289255', '00000000-0000-0000-0000-000000289201', '00000000-0000-0000-0000-000000289230',
   'departamento', 'rent', 'Fixture 289 — PROP6 (dedicada a CHECK/COL3 -- nunca contada en SEL*, evita ensuciar PROP1)',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.40, 20.72), 4326)::extensions.geography, 16000, 'active');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) ESTRUCTURA — enum, tabla, columnas, FKs, properties.comment_count. TODO catálogo puro
--    (has_type/has_table/col_*/pg_constraint/pg_attribute) — NUNCA lanza aunque comments no
--    exista todavía (patrón heredado de 38_property_video_slots_test.sql: "checks de
--    catálogo puro son seguros en crudo, reportan not ok si el objeto no existe"). Va ANTES
--    de cualquier INSERT real en comments -- un INSERT crudo (fuera de throws_ok/lives_ok)
--    contra una tabla inexistente SÍ aborta la transacción, y eso apagaría el resto de esta
--    sección si se ejecutara antes.
-- ════════════════════════════════════════════════════════════════════════════

select has_type('public', 'comment_status', 'ENUM1_el_enum_public_comment_status_existe');
select is(
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
     from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'comment_status' and t.typnamespace = 'public'::regnamespace),
  array['visible', 'held_for_review', 'hidden', 'deleted'],
  'ENUM2_comment_status_tiene_EXACTAMENTE_esos_4_labels_en_ese_orden'
);

select has_table('public', 'comments', 'TBL1_tabla_public_comments_existe');

select col_type_is('public', 'comments', 'id', 'uuid', 'COL1_id_es_uuid');
select col_is_pk('public', 'comments', 'id', 'COL2_id_es_primary_key');
select col_type_is('public', 'comments', 'property_id', 'uuid', 'COL4_property_id_es_uuid');
select col_not_null('public', 'comments', 'property_id', 'COL5_property_id_es_not_null');
select col_type_is('public', 'comments', 'user_id', 'uuid', 'COL6_user_id_es_uuid');
select col_not_null('public', 'comments', 'user_id', 'COL7_user_id_es_not_null');
select col_type_is('public', 'comments', 'body', 'text', 'COL8_body_es_text');
select col_not_null('public', 'comments', 'body', 'COL9_body_es_not_null');
select col_type_is('public', 'comments', 'status', 'comment_status', 'COL10_status_es_comment_status');
select col_not_null('public', 'comments', 'status', 'COL11_status_es_not_null');
select col_default_is('public', 'comments', 'status', 'visible', 'COL12_status_default_visible');
select col_type_is('public', 'comments', 'created_at', 'timestamp with time zone', 'COL13_created_at_es_timestamptz');
select col_not_null('public', 'comments', 'created_at', 'COL14_created_at_es_not_null');
select col_type_is('public', 'comments', 'updated_at', 'timestamp with time zone', 'COL15_updated_at_es_timestamptz');
select col_not_null('public', 'comments', 'updated_at', 'COL16_updated_at_es_not_null');

select is(
  (select c2.confdeltype
     from pg_constraint c2
     join pg_class t on t.oid = c2.conrelid
     join pg_namespace n on n.oid = t.relnamespace
     join pg_class ft on ft.oid = c2.confrelid
    where n.nspname = 'public' and t.relname = 'comments' and c2.contype = 'f'
      and ft.relname = 'properties'),
  'c', 'FK1_property_id_referencia_properties_on_delete_cascade'
);
select is(
  (select c2.confdeltype
     from pg_constraint c2
     join pg_class t on t.oid = c2.conrelid
     join pg_namespace n on n.oid = t.relnamespace
     join pg_class ft on ft.oid = c2.confrelid
    where n.nspname = 'public' and t.relname = 'comments' and c2.contype = 'f'
      and ft.relname = 'users' and ft.relnamespace = 'public'::regnamespace),
  'c', 'FK2_user_id_referencia_public_users_on_delete_cascade (corrección al plan: NO auth.users, ver header)'
);

select col_type_is('public', 'properties', 'comment_count', 'integer', 'PROPCOL1_comment_count_es_integer');
select col_not_null('public', 'properties', 'comment_count', 'PROPCOL2_comment_count_es_not_null');
select col_default_is('public', 'properties', 'comment_count', '0', 'PROPCOL3_comment_count_default_0');
select is(
  (select a.attnum from pg_attribute a
    where a.attrelid = 'public.properties'::regclass and a.attname = 'comment_count' and not a.attisdropped),
  (select max(a2.attnum) from pg_attribute a2
    where a2.attrelid = 'public.properties'::regclass and not a2.attisdropped),
  'POS1_comment_count_es_la_ULTIMA_columna_de_properties (select(*) de builds instalados no se desordena)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — public.comments (a partir de aquí un INSERT crudo contra una tabla inexistente
-- ABORTA la transacción -- es la frontera esperada del RED: todo lo de arriba (estructura)
-- puede reportar "not ok" limpio; todo lo de abajo simplemente no corre hasta que exista la
-- migración GREEN, y finish() lo refleja como plan/actual desalineados).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-000000289260', '00000000-0000-0000-0000-000000289250', '00000000-0000-0000-0000-00000028920a', 'Comentario visible de BU1', 'visible'),
  ('00000000-0000-0000-0000-000000289261', '00000000-0000-0000-0000-000000289250', '00000000-0000-0000-0000-00000028920a', 'Comentario en revisión de BU1', 'held_for_review'),
  ('00000000-0000-0000-0000-000000289262', '00000000-0000-0000-0000-000000289250', '00000000-0000-0000-0000-00000028920a', 'Comentario oculto de BU1', 'hidden'),
  ('00000000-0000-0000-0000-000000289263', '00000000-0000-0000-0000-000000289250', '00000000-0000-0000-0000-00000028920a', 'Comentario borrado de BU1', 'deleted'),
  ('00000000-0000-0000-0000-000000289264', '00000000-0000-0000-0000-000000289250', '00000000-0000-0000-0000-00000028920b', 'Comentario oculto de BU2', 'hidden'),
  ('00000000-0000-0000-0000-000000289265', '00000000-0000-0000-0000-000000289251', '00000000-0000-0000-0000-00000028920c', 'Comentario visible de BU3 en PROP2', 'visible'),
  ('00000000-0000-0000-0000-000000289266', '00000000-0000-0000-0000-000000289251', '00000000-0000-0000-0000-00000028920c', 'Comentario oculto de BU3 en PROP2', 'hidden'),
  ('00000000-0000-0000-0000-000000289267', '00000000-0000-0000-0000-000000289252', '00000000-0000-0000-0000-00000028920d', 'Comentario oculto de BU4 en PROP3', 'hidden'),
  ('00000000-0000-0000-0000-000000289268', '00000000-0000-0000-0000-000000289253', '00000000-0000-0000-0000-00000028920a', 'CW1 — visible, PROP4', 'visible'),
  ('00000000-0000-0000-0000-000000289269', '00000000-0000-0000-0000-000000289253', '00000000-0000-0000-0000-00000028920a', 'CW2 — visible, PROP4', 'visible'),
  ('00000000-0000-0000-0000-00000028926a', '00000000-0000-0000-0000-000000289253', '00000000-0000-0000-0000-00000028920a', 'CW3 — visible, PROP4', 'visible');

-- COL3/CHECK usan PROP6 (id ...289255), NUNCA PROP1-5: CHK4/CHK5/COL3 SOBREVIVEN el INSERT
-- (lives_ok) y dejarían filas 'visible' de más en cualquier propiedad contada por SEL*/CNT*
-- si se insertaran ahí (aislamiento de fixtures, mismo principio que PROP4/PROP5).

-- COL3: id se autogenera al insertar sin especificarlo (comportamiento, no solo catálogo).
-- El WITH con INSERT...RETURNING debe ir al NIVEL SUPERIOR del statement (Postgres no
-- admite una CTE que modifica datos anidada dentro de un argumento de función).
with ins as (
  insert into public.comments (property_id, user_id, body)
  values ('00000000-0000-0000-0000-000000289255', '00000000-0000-0000-0000-00000028920a', 'Fixture default id')
  returning id
)
select isnt((select id from ins), null, 'COL3_id_se_autogenera_sin_especificarlo');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) CHECK del body — calco de property_reports_other_requires_text (220.1): \S, no trim()
-- ════════════════════════════════════════════════════════════════════════════

select throws_ok(
  $$ insert into public.comments (property_id, user_id, body)
     values ('00000000-0000-0000-0000-000000289255', '00000000-0000-0000-0000-00000028920a', null) $$,
  '23502', null, 'CHK1_body_NULL_viola_NOT_NULL'
);
select throws_ok(
  $$ insert into public.comments (property_id, user_id, body)
     values ('00000000-0000-0000-0000-000000289255', '00000000-0000-0000-0000-00000028920a', E'\t\n  ') $$,
  '23514', null, 'CHK2_body_solo_whitespace_tabs_y_saltos_viola_el_CHECK (lección 220.1: trim() no basta)'
);
select throws_ok(
  format($$ insert into public.comments (property_id, user_id, body)
            values ('00000000-0000-0000-0000-000000289255', '00000000-0000-0000-0000-00000028920a', %L) $$,
         repeat('a', 501)),
  '23514', null, 'CHK3_body_de_501_caracteres_viola_el_CHECK'
);
select lives_ok(
  format($$ insert into public.comments (property_id, user_id, body)
            values ('00000000-0000-0000-0000-000000289255', '00000000-0000-0000-0000-00000028920a', %L) $$,
         repeat('a', 500)),
  'CHK4_body_de_EXACTAMENTE_500_caracteres_pasa_el_CHECK'
);
select lives_ok(
  $$ insert into public.comments (property_id, user_id, body)
     values ('00000000-0000-0000-0000-000000289255', '00000000-0000-0000-0000-00000028920a', '  buen depa, sigue disponible?  ') $$,
  'CHK5_body_con_espacios_en_los_bordes_pasa_el_CHECK (no exige trim, solo presencia de \S)'
);
select throws_ok(
  $$ insert into public.comments (property_id, user_id, body, status)
     values ('00000000-0000-0000-0000-000000289255', '00000000-0000-0000-0000-00000028920a', 'valido', 'spam') $$,
  '22P02', null, 'ENUMCHK1_un_status_fuera_del_enum_lanza_22P02'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) GRANTS de catálogo — has_table_privilege resuelto por JOIN (0 filas si la tabla no
--    existe = NULL, nunca lanza; el cast de texto a regclass SÍ lanza, gotcha documentado
--    en 68_rollup_ad_impressions_monthly_test / reusado en 101_crm_temperature_daily_test).
-- ════════════════════════════════════════════════════════════════════════════

select is(coalesce((select has_table_privilege('anon', c.oid, 'SELECT') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'comments'), false), false, 'GRANT1_anon_SIN_select');
select is(coalesce((select has_table_privilege('anon', c.oid, 'UPDATE') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'comments'), false), false, 'GRANT2_anon_SIN_update');
select is(coalesce((select has_table_privilege('anon', c.oid, 'INSERT') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'comments'), false), false, 'GRANT3_anon_SIN_insert');
select is(coalesce((select has_table_privilege('anon', c.oid, 'DELETE') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'comments'), false), false, 'GRANT4_anon_SIN_delete');
select is(coalesce((select has_table_privilege('authenticated', c.oid, 'SELECT') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'comments'), false), true, 'GRANT5_authenticated_CON_select');
-- GRANT6 a nivel de COLUMNA (status), no de tabla: comments_update es status-only y el
-- mecanismo elegido por GREEN puede ser un GRANT UPDATE(status) restringido a esa columna
-- (has_table_privilege(...,'UPDATE') da FALSE en ese caso -- verificado empíricamente contra
-- un GREEN de referencia con ese mecanismo -- así que el ancla correcta, válida bajo
-- CUALQUIER mecanismo que GREEN elija, es a nivel de columna).
select is(coalesce((select has_column_privilege('authenticated', 'public.comments', 'status', 'UPDATE')), false), true, 'GRANT6_authenticated_CON_update_de_status');
select is(coalesce((select has_table_privilege('authenticated', c.oid, 'INSERT') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'comments'), false), false, 'GRANT7_authenticated_SIN_insert (la EF escribe con service_role)');
select is(coalesce((select has_table_privilege('authenticated', c.oid, 'DELETE') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'comments'), false), false, 'GRANT8_authenticated_SIN_delete (NO hay policy de delete)');
select is(coalesce((select has_table_privilege('service_role', c.oid, 'INSERT') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'comments'), false), true, 'GRANT9_service_role_CON_insert_control_positivo');

-- ── ACL REAL — primera invocación real de cada rol (gotcha 203.1: SIN wrapper compartido
--    entre roles; cada throws_ok corre SQL literal ad-hoc, ninguna función propia se
--    reusa entre anon/authenticated). anon va primero, antes de cualquier SELECT
--    autenticado sobre comments. ──────────────────────────────────────────────────────
select pg_temp.act_as(null, 'anon');
select throws_ok(
  $$ select count(*) from public.comments $$,
  '42501', null, 'ACLREAL1_anon_no_puede_leer_comments_primera_invocacion_real'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-00000028920a'); -- BU1
select throws_ok(
  $$ insert into public.comments (property_id, user_id, body)
     values ('00000000-0000-0000-0000-000000289250', '00000000-0000-0000-0000-00000028920a', 'intento de insert directo') $$,
  '42501', null, 'ACLREAL2_authenticated_no_puede_insertar_directo (sin policy de insert)'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) SELECT — visibilidad por rol (PROP1/PROP2/PROP3, SOLO LECTURA en esta sección)
-- ════════════════════════════════════════════════════════════════════════════

-- STRANGER (ajeno total) ve solo lo visible de PROP1.
select pg_temp.act_as('00000000-0000-0000-0000-000000289209');
select is((select count(*)::int from public.comments where property_id = '00000000-0000-0000-0000-000000289250'), 1,
  'SEL1_stranger_ve_solo_1_visible_en_PROP1');
select is((select count(*)::int from public.comments where id = '00000000-0000-0000-0000-000000289262'), 0,
  'SEL2_stranger_NO_ve_el_hidden_de_BU1_en_PROP1');
reset role;

-- BU1 (autor) ve sus 4 comentarios en cualquier status, pero no el hidden de BU2.
select pg_temp.act_as('00000000-0000-0000-0000-00000028920a');
select is((select count(*)::int from public.comments
            where property_id = '00000000-0000-0000-0000-000000289250' and user_id = '00000000-0000-0000-0000-00000028920a'), 4,
  'SEL3_autor_BU1_ve_sus_4_comentarios_propios_en_cualquier_status');
select is((select count(*)::int from public.comments where id = '00000000-0000-0000-0000-000000289264'), 0,
  'SEL4_autor_BU1_NO_ve_el_hidden_ajeno_de_BU2');
reset role;

-- Dueño de la propiedad (AG, activo) ve TODO PROP1 (5 filas: 4 de BU1 + 1 hidden de BU2).
select pg_temp.act_as('00000000-0000-0000-0000-000000289201');
select is((select count(*)::int from public.comments where property_id = '00000000-0000-0000-0000-000000289250'), 5,
  'SEL5_dueno_AG_ve_TODO_PROP1_incluido_lo_hidden_ajeno');
reset role;

-- owner/admin de la agencia ven TODO PROP1 (gestor por rol de agencia, no por ser dueños).
select pg_temp.act_as('00000000-0000-0000-0000-000000289204');
select is((select count(*)::int from public.comments where property_id = '00000000-0000-0000-0000-000000289250'), 5,
  'SEL6_owner_AGX_ve_TODO_PROP1');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-000000289205');
select is((select count(*)::int from public.comments where property_id = '00000000-0000-0000-0000-000000289250'), 5,
  'SEL7_admin_AGX_ve_TODO_PROP1');
reset role;

-- agente raso de la MISMA agencia, no dueño de PROP1: NO es gestor, solo ve lo visible.
select pg_temp.act_as('00000000-0000-0000-0000-000000289206');
select is((select count(*)::int from public.comments where property_id = '00000000-0000-0000-0000-000000289250'), 1,
  'SEL8_agente_raso_de_AGX_NO_es_gestor_ve_solo_1_visible');
reset role;

-- admin de PLATAFORMA ve todo (is_admin()).
select pg_temp.act_as('00000000-0000-0000-0000-000000289207');
select is((select count(*)::int from public.comments where property_id = '00000000-0000-0000-0000-000000289250'), 5,
  'SEL9_admin_plataforma_ve_TODO_PROP1');
reset role;

-- owner de agencia AJENA: sin relación con PROP1, solo ve lo visible.
select pg_temp.act_as('00000000-0000-0000-0000-000000289208');
select is((select count(*)::int from public.comments where property_id = '00000000-0000-0000-0000-000000289250'), 1,
  'SEL10_owner_de_agencia_ajena_ve_solo_1_visible');
reset role;

-- IND (agente independiente, agency_id NULL) ve su propio hidden en PROP3.
select pg_temp.act_as('00000000-0000-0000-0000-000000289203');
select is((select count(*)::int from public.comments where property_id = '00000000-0000-0000-0000-000000289252'), 1,
  'SEL11_agente_independiente_IND_ve_su_hidden_en_PROP3');
reset role;

-- STRANGER no ve el hidden de PROP3.
select pg_temp.act_as('00000000-0000-0000-0000-000000289209');
select is((select count(*)::int from public.comments where id = '00000000-0000-0000-0000-000000289267'), 0,
  'SEL12_stranger_NO_ve_el_hidden_de_PROP3');
reset role;

-- AG_SUS (dueño SUSPENDIDO de PROP2): conserva la lectura de lo visible, pierde el poder de
-- gestor sobre lo oculto de SU PROPIA propiedad (#202, corrección al plan).
select pg_temp.act_as('00000000-0000-0000-0000-000000289202');
select is((select count(*)::int from public.comments where property_id = '00000000-0000-0000-0000-000000289251'), 1,
  'SEL13_dueno_suspendido_AG_SUS_ve_solo_1_visible_en_PROP2');
select is((select count(*)::int from public.comments where id = '00000000-0000-0000-0000-000000289266'), 0,
  'SEL14_dueno_suspendido_AG_SUS_NO_ve_el_hidden_de_su_propia_PROP2');
reset role;

-- owner de la agencia SÍ ve ese mismo hidden en PROP2 — el poder es de AGENCIA, no depende
-- de la suspensión individual de AG_SUS.
select pg_temp.act_as('00000000-0000-0000-0000-000000289204');
select is((select count(*)::int from public.comments where id = '00000000-0000-0000-0000-000000289266'), 1,
  'SEL15_owner_AGX_SI_ve_el_hidden_de_PROP2_pese_a_la_suspension_de_AG_SUS');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) UPDATE — solo status, PROP4 (CW1/CW2/CW3), escritura REAL
-- ════════════════════════════════════════════════════════════════════════════

-- Gestor (owner de agencia) alterna visible->hidden->visible sobre CW1.
select pg_temp.act_as('00000000-0000-0000-0000-000000289204');
with u as (
  update public.comments set status = 'hidden'
   where id = '00000000-0000-0000-0000-000000289268' returning id
)
select is((select count(*)::int from u), 1, 'UPD1_gestor_owner_AGX_oculta_CW1_visible_a_hidden');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000000289204');
with u as (
  update public.comments set status = 'visible'
   where id = '00000000-0000-0000-0000-000000289268' returning id
)
select is((select count(*)::int from u), 1, 'UPD2_gestor_owner_AGX_restaura_CW1_hidden_a_visible');
reset role;

-- STRANGER (ajeno, pero SÍ ve CW1 porque está visible -- isolation-correct) no puede tocarlo.
select pg_temp.act_as('00000000-0000-0000-0000-000000289209');
with u as (
  update public.comments set status = 'hidden'
   where id = '00000000-0000-0000-0000-000000289268' returning id
)
select is((select count(*)::int from u), 0, 'UPD3_stranger_NO_puede_ocultar_CW1_pese_a_verlo_visible');
reset role;

-- Autor BU1 pasa su propio CW2 de visible a deleted (permitido).
select pg_temp.act_as('00000000-0000-0000-0000-00000028920a');
with u as (
  update public.comments set status = 'deleted'
   where id = '00000000-0000-0000-0000-000000289269' returning id
)
select is((select count(*)::int from u), 1, 'UPD4_autor_BU1_borra_su_CW2_visible_a_deleted');
reset role;

-- Autor BU1 NO puede pasar su propio CW3 de visible a hidden (solo puede ir a deleted).
-- A diferencia de UPD3/UPD7/UPD8 (el actor NO pasa el USING de comments_update -> 0 filas
-- silenciosas), aquí BU1 SÍ pasa el USING (es el autor de la fila VIEJA) pero la fila NUEVA
-- (status='hidden') viola el WITH CHECK -- Postgres LANZA "new row violates row-level
-- security policy" (42501) en vez de devolver 0 filas (verificado empíricamente: el USING
-- de una UPDATE policy solo puede mirar la fila VIEJA, nunca el valor que se intenta
-- escribir, así que CUALQUIER implementación correcta de "autor solo -> deleted" tiene que
-- vivir en el WITH CHECK, y ahí SIEMPRE lanza cuando el actor ya pasó el USING).
select pg_temp.act_as('00000000-0000-0000-0000-00000028920a');
select throws_ok(
  $$ update public.comments set status = 'hidden' where id = '00000000-0000-0000-0000-00000028926a' $$,
  '42501', null, 'UPD5_autor_BU1_NO_puede_ocultar_su_propio_CW3 (solo -> deleted, lanza WITH_CHECK)'
);
reset role;
select is((select status from public.comments where id = '00000000-0000-0000-0000-00000028926a'), 'visible',
  'UPD6_CW3_sigue_visible_tras_el_intento_rechazado');

-- Agente raso de la MISMA agencia (no gestor, no autor) tampoco puede tocar CW1.
select pg_temp.act_as('00000000-0000-0000-0000-000000289206');
with u as (
  update public.comments set status = 'hidden'
   where id = '00000000-0000-0000-0000-000000289268' returning id
)
select is((select count(*)::int from u), 0, 'UPD7_agente_raso_de_AGX_NO_puede_ocultar_CW1');
reset role;

-- AG_SUS (suspendido, no gestor, no autor) intenta sobre una fila que SÍ VE (visible en
-- PROP2) -- aisla la policy de escritura del filtro de SELECT (lección 269.3).
select pg_temp.act_as('00000000-0000-0000-0000-000000289202');
with u as (
  update public.comments set status = 'hidden'
   where id = '00000000-0000-0000-0000-000000289265' returning id
)
select is((select count(*)::int from u), 0, 'UPD8_AG_SUS_NO_puede_ocultar_C_VIS_P2_pese_a_verlo');
reset role;

-- Nadie puede cambiar el body vía UPDATE, ni siquiera el gestor (mecanismo -- trigger o
-- column-level WITH CHECK -- lo decide GREEN; el test verifica el RESULTADO observable).
select pg_temp.act_as('00000000-0000-0000-0000-000000289204');
do $$
begin
  update public.comments set body = 'CUERPO_MODIFICADO_NO_PERMITIDO' where id = '00000000-0000-0000-0000-000000289268';
exception when others then
  null; -- el mecanismo puede lanzar (trigger) o simplemente no aplicar (WITH CHECK/columna) -- lo que importa es el resultado
end $$;
reset role;
select isnt(
  (select body from public.comments where id = '00000000-0000-0000-0000-000000289268'),
  'CUERPO_MODIFICADO_NO_PERMITIDO',
  'UPD9_ni_el_gestor_puede_cambiar_el_body_via_UPDATE (comments_update es status-only)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) DELETE — negado a TODOS, incluidos autor y gestor (sin grant, sin policy)
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000000289204'); -- gestor
select throws_ok(
  $$ delete from public.comments where id = '00000000-0000-0000-0000-000000289268' $$,
  '42501', null, 'DEL1_gestor_NO_puede_borrar_un_comentario'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-00000028920a'); -- autor
select throws_ok(
  $$ delete from public.comments where id = '00000000-0000-0000-0000-000000289269' $$,
  '42501', null, 'DEL2_autor_NO_puede_borrar_su_propio_comentario'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) TRIGGER de comment_count — atómico, solo cuenta 'visible', GREATEST(0,...), PROP5 fresca
-- ════════════════════════════════════════════════════════════════════════════

select is((select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289254'), 0,
  'CNT1_PROP5_arranca_en_comment_count_0');

insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-000000289280', '00000000-0000-0000-0000-000000289254', '00000000-0000-0000-0000-00000028920a', 'CT_VIS', 'visible');
select is((select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289254'), 1,
  'CNT2_insert_visible_incrementa_a_1');

insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-000000289281', '00000000-0000-0000-0000-000000289254', '00000000-0000-0000-0000-00000028920a', 'CT_HELD', 'held_for_review');
select is((select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289254'), 1,
  'CNT3_insert_held_for_review_NO_incrementa_sigue_en_1');

update public.comments set status = 'hidden' where id = '00000000-0000-0000-0000-000000289280';
select is((select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289254'), 0,
  'CNT4_visible_a_hidden_decrementa_a_0');

update public.comments set status = 'visible' where id = '00000000-0000-0000-0000-000000289280';
select is((select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289254'), 1,
  'CNT5_hidden_a_visible_incrementa_de_nuevo_a_1');

delete from public.comments where id = '00000000-0000-0000-0000-000000289280';
select is((select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289254'), 0,
  'CNT6_DELETE_fisico_de_un_visible_decrementa_a_0');

delete from public.comments where id = '00000000-0000-0000-0000-000000289281';
select is((select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289254'), 0,
  'CNT7_DELETE_de_un_held_for_review_nunca_contado_NO_baja_de_0 (guard GREATEST)');

insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-000000289282', '00000000-0000-0000-0000-000000289254', '00000000-0000-0000-0000-00000028920a', 'CT_RT', 'visible');
select is((select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289254'), 1,
  'CNT8a_round_trip_insert_visible_vuelve_a_1');
delete from public.comments where id = '00000000-0000-0000-0000-000000289282';
select is((select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289254'), 0,
  'CNT8b_round_trip_delete_regresa_a_0_neto');

-- Backfill idempotente: corromper el contador y recomputar (mismo cálculo que el backfill
-- de la migración: count(*) de status='visible' por propiedad) -- reproducible sin poder
-- re-ejecutar la migración completa dentro de este test (instrucción explícita del plan).
update public.properties set comment_count = 999 where id = '00000000-0000-0000-0000-000000289250';
update public.properties p set comment_count = (
  select count(*)::int from public.comments c where c.property_id = p.id and c.status = 'visible'
) where p.id = '00000000-0000-0000-0000-000000289250';
select is(
  (select comment_count from public.properties where id = '00000000-0000-0000-0000-000000289250'),
  (select count(*)::int from public.comments where property_id = '00000000-0000-0000-0000-000000289250' and status = 'visible'),
  'BACKFILL1_recomputar_el_conteo_de_PROP1_da_el_total_real_de_visibles (idempotencia del backfill)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8) Trigger — SECURITY DEFINER + search_path='' (blindaje estándar del repo, 20260701000001)
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select bool_and(p.prosecdef)
     from pg_trigger t
     join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.comments'::regclass and not t.tgisinternal),
  true, 'SECDEF1_la_funcion_del_trigger_de_comments_es_SECURITY_DEFINER'
);
select is(
  (select bool_and(exists (
      select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'
    ))
     from pg_trigger t
     join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.comments'::regclass and not t.tgisinternal),
  true, 'SECDEF2_la_funcion_del_trigger_fija_search_path_explicito'
);
select is(
  (select bool_or(pg_get_triggerdef(t.oid) ~* 'after\s+insert')
     from pg_trigger t where t.tgrelid = 'public.comments'::regclass and not t.tgisinternal),
  true, 'TRIGDEF1_hay_trigger_AFTER_INSERT_en_comments'
);
select is(
  (select bool_or(pg_get_triggerdef(t.oid) ~* 'delete')
     from pg_trigger t where t.tgrelid = 'public.comments'::regclass and not t.tgisinternal),
  true, 'TRIGDEF2_hay_trigger_que_dispara_en_DELETE_en_comments'
);
select is(
  (select bool_or(pg_get_triggerdef(t.oid) ~* 'update\s+of\s+status')
     from pg_trigger t where t.tgrelid = 'public.comments'::regclass and not t.tgisinternal),
  true, 'TRIGDEF3_el_trigger_de_UPDATE_esta_acotado_a_OF_status (no cualquier columna)'
);

select * from finish();
rollback;
