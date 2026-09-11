-- Tests pgTAP — notificaciones sociales de comentarios: comment_on_my_property,
-- comment_hidden y admin_comment_report (subtarea 289.4, tarea #289).
-- Ejecutar con:
--   supabase test db supabase/tests/115_notify_social_comments_test.sql --local
-- (CLI GLOBAL de brew, NUNCA npx supabase). Corre como superusuario (rol `postgres`, dueño
-- de las tablas -> bypassa RLS por ownership) dentro de una transacción revertida (no
-- persiste). Los fixtures y las transiciones de estado se hacen con UPDATE/INSERT crudos
-- (bypass RLS a propósito -- el SEAM de este archivo es el efecto OBSERVABLE del trigger
-- sobre public.notifications, no RLS -- RLS de comments/comment_reports ya está cubierto
-- por 112/113). Las llamadas a la RPC resolve_comment_reports_atomic sí impersonan
-- (pg_temp.act_as) porque esa función lee auth.uid() internamente.
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAMS bajo prueba (comportamiento observable, NUNCA internals):
--   1) el efecto OBSERVABLE sobre public.notifications de un INSERT/UPDATE real en
--      public.comments (comment_on_my_property, comment_hidden) y en
--      public.comment_reports (admin_comment_report) — nunca el nombre interno de una
--      variable, solo filas de notifications y su contrato (title/body/deep_link/
--      related_entity_type/related_entity_id/data).
--   2) catálogo puro: existen las 3 funciones SECURITY DEFINER con search_path fijo, y los
--      triggers que las disparan tienen el evento correcto (AFTER INSERT OR UPDATE OF
--      status en comments; AFTER INSERT en comment_reports, NUNCA UPDATE).
-- SUT AÚN NO EXISTE (RED, 2026-09-11): lo crea
--   supabase/migrations/20260910300001_notify_social_comments.sql (agente `supabase`, fase
--   GREEN). Este archivo NO la escribe ni la aplica.
--
-- ── Nombres que GREEN debe respetar (fijados aquí, test-author) ────────────────────────────
--   public.notify_comment_on_my_property()  -- trigger en comments (AFTER INSERT OR UPDATE
--     OF status).
--   public.notify_comment_hidden()          -- trigger en comments (AFTER UPDATE OF status;
--     puede compartir el mismo trigger físico que la anterior o vivir en uno propio — el
--     catálogo de abajo solo exige que CADA función esté enganchada a un trigger con el
--     evento correcto, no cuántos triggers físicos hay).
--   public.notify_admin_comment_report()    -- trigger en comment_reports (AFTER INSERT,
--     NUNCA UPDATE — CAT14 ancla explícitamente la ausencia).
--
-- ── D-KEY/D-TYPE/D-LINK (catálogo fijado aquí) ───────────────────────────────────────────
--   comment_on_my_property → destinatario properties.owner_user_id · related_entity_type
--     'comment' · related_entity_id = comment_id · deep_link '/property/'||property_id ·
--     data->>'address' (dirección de la propiedad, patrón `moderate_property_atomic`). NUNCA
--     al propio publicador cuando comenta su propia propiedad. Dispara en 2 caminos: INSERT
--     con status='visible' directo, o UPDATE status held_for_review→visible (moderación lo
--     libera) — NINGÚN OTRO camino (ni INSERT con otro status, ni cualquier otra transición
--     UPDATE). Dedupe: UN aviso por comment_id en TODA su vida — índice único parcial
--     `(user_id, related_entity_id, type) where type='comment_on_my_property'` (mismo patrón
--     que notifications_admin_*_anchor_idx), + ON CONFLICT DO NOTHING. Se ancla fuerte en
--     COMP-CYCLE (sección 2.5): held_for_review→visible→held_for_review→visible dispara la
--     condición de transición DOS veces pero solo debe persistir 1 fila.
--   comment_hidden → destinatario comments.user_id (el autor) · related_entity_type
--     'comment' · related_entity_id = comment_id · deep_link '/property/'||property_id ·
--     data->>'reason' = 'oculto_por_moderacion' (🔴 DECISIÓN test-author: el trigger no
--     puede distinguir si quien mandó el UPDATE a 'hidden' fue un gestor humano o el trigger
--     de auto-ocultar de 289.3 — ambos llegan como el MISMO evento SQL, AFTER UPDATE OF
--     status en comments, sin metadata de "quién"/"por qué" disponible en NEW/OLD. Un solo
--     motivo genérico, documentado, en vez de inventar una distinción que el trigger no
--     puede observar). Dispara SOLO en la transición OLD.status <> 'hidden' AND
--     NEW.status = 'hidden' (nunca hacia 'deleted', nunca si ya estaba 'hidden'). SIN
--     índice único de dedupe (a diferencia de comment_on_my_property): un comentario puede
--     recuperarse (RPC restore, hidden→visible) y volver a ocultarse legítimamente — cada
--     ciclo de "entrar a hidden" genera un aviso NUEVO (🔴 DECISIÓN test-author, la que el
--     plan de la subtarea deja abierta como "recomendado"; se ancla en HID-CYCLE, sección
--     3.6). El guard de transición (OLD<>'hidden') es la única protección — mismo patrón
--     que moderate_ad_atomic (v_old_status IS DISTINCT FROM p_next_status).
--   admin_comment_report → destinatarios: TODOS los public.users.role='admin' VIVOS
--     (deleted_at is null — #223.2a, mismo criterio que TODO el catálogo admin_* del repo),
--     EXCLUYENDO al propio reportante si resulta ser admin (guard "nunca el actor", mismo
--     criterio que notify_property_report_and_autosuspend). related_entity_type 'comment' ·
--     related_entity_id = comment_id · deep_link '/admin/reports' (ruta YA viva, #220.4).
--     Dispara AFTER INSERT en comment_reports SOLO cuando la fila insertada es el ÚNICO
--     reporte 'new' abierto de ese comment_id (🔴 DECISIÓN de diseño, documentada porque
--     es la pieza más fina de la subtarea): el patrón estándar de anclar con un índice único
--     parcial `(user_id, related_entity_id, type)` NO sirve aquí — bloquearía para SIEMPRE
--     el aviso tras el primer reporte, y la subtarea exige que un reporte NUEVO después de
--     que `resolve_comment_reports_atomic` cierra el ciclo anterior SÍ vuelva a avisar (ver
--     ADM5). GREEN debe implementar el dedupe en el CUERPO del trigger, no con un índice: al
--     insertar, si YA existe otra fila de comment_reports con `comment_id = new.comment_id
--     AND status = 'new' AND id <> new.id`, es reporte-2/3/N del MISMO ciclo abierto → NO
--     notifica; si NO existe ninguna otra 'new', es el primer reporte de un ciclo (nuevo o
--     reabierto tras resolución) → notifica a todos los admins vivos. Esto es válido porque
--     resolve_comment_reports_atomic cierra TODOS los 'new' de ese comment_id a 'resolved'
--     en la misma transacción de la resolución (ver 113, RPC8/RPC9) — el siguiente reporte
--     ve 0 hermanos 'new' y dispara un ciclo nuevo.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(59);

-- Helper de impersonación (mismo patrón que 02/.../109/110/112/113).
create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — UUIDs prefijo '00000000-0000-0000-0000-000000289 4XX' (subtarea 289.4,
-- archivo 115 -- sin colisión con 289.2 (2892XX) / 289.3 (2893XX)).
--   USERS: 01 PUBLISHER (dueño de las 3 propiedades) · 02 AUTHOR1 (comenta PROP_COMP,
--     nunca dueño) · 03 AUTHOR_H (autor de los comentarios ocultados) · 04-07 REPORTER1-4 ·
--     09 PLAT_ADMIN1 · 10 PLAT_ADMIN2 · 11 PLAT_ADMIN_DELETED (role=admin, deleted_at NOT
--     NULL) · 12 AUTHOR_ADM (autor del comentario de la cadena 1o/2o/3o reporte) ·
--     13 AUTHOR_ADM2 (autor del comentario de ADM6, autoreporte de un admin).
--   PROPERTIES: 50 PROP_COMP · 51 PROP_HID · 52 PROP_ADM.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000289401', 'publisher.2894@test.local'),
  ('00000000-0000-0000-0000-000000289402', 'author1.2894@test.local'),
  ('00000000-0000-0000-0000-000000289403', 'authorh.2894@test.local'),
  ('00000000-0000-0000-0000-000000289404', 'rep1.2894@test.local'),
  ('00000000-0000-0000-0000-000000289405', 'rep2.2894@test.local'),
  ('00000000-0000-0000-0000-000000289406', 'rep3.2894@test.local'),
  ('00000000-0000-0000-0000-000000289407', 'rep4.2894@test.local'),
  ('00000000-0000-0000-0000-000000289409', 'platadmin1.2894@test.local'),
  ('00000000-0000-0000-0000-000000289410', 'platadmin2.2894@test.local'),
  ('00000000-0000-0000-0000-000000289411', 'platadmindeleted.2894@test.local'),
  ('00000000-0000-0000-0000-000000289412', 'authoradm.2894@test.local'),
  ('00000000-0000-0000-0000-000000289413', 'authoradm2.2894@test.local');

update public.users set role = 'admin'
 where id in ('00000000-0000-0000-0000-000000289409',
              '00000000-0000-0000-0000-000000289410',
              '00000000-0000-0000-0000-000000289411');
update public.users set deleted_at = now()
 where id = '00000000-0000-0000-0000-000000289411';

insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000289450', '00000000-0000-0000-0000-000000289401',
   'departamento', 'rent', 'Fixture 2894 — PROP_COMP',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-000000289451', '00000000-0000-0000-0000-000000289401',
   'departamento', 'rent', 'Fixture 2894 — PROP_HID',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography, 12100, 'active'),
  ('00000000-0000-0000-0000-000000289452', '00000000-0000-0000-0000-000000289401',
   'departamento', 'rent', 'Fixture 2894 — PROP_ADM',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.37, 20.69), 4326)::extensions.geography, 12200, 'active');

-- ════════════════════════════════════════════════════════════════════════════
-- 1) CATÁLOGO — puro, no lanza aunque el SUT no exista todavía (nunca hace INSERT/UPDATE
--    contra comments/comment_reports todavía; solo consulta pg_proc/pg_trigger por nombre).
-- ════════════════════════════════════════════════════════════════════════════

select ok(
  (select count(*)::int from pg_proc
    where proname = 'notify_comment_on_my_property' and pronamespace = 'public'::regnamespace) = 1,
  'CAT1_existe_public_notify_comment_on_my_property'
);
select is(
  (select prosecdef from pg_proc
    where proname = 'notify_comment_on_my_property' and pronamespace = 'public'::regnamespace),
  true, 'CAT2_notify_comment_on_my_property_es_security_definer'
);
select ok(
  (select exists (
     select 1 from pg_proc p, unnest(p.proconfig) cfg
      where p.proname = 'notify_comment_on_my_property' and p.pronamespace = 'public'::regnamespace
        and cfg like 'search_path=%'
   )),
  'CAT3_notify_comment_on_my_property_fija_search_path_explicito'
);

select ok(
  (select count(*)::int from pg_proc
    where proname = 'notify_comment_hidden' and pronamespace = 'public'::regnamespace) = 1,
  'CAT4_existe_public_notify_comment_hidden'
);
select is(
  (select prosecdef from pg_proc
    where proname = 'notify_comment_hidden' and pronamespace = 'public'::regnamespace),
  true, 'CAT5_notify_comment_hidden_es_security_definer'
);
select ok(
  (select exists (
     select 1 from pg_proc p, unnest(p.proconfig) cfg
      where p.proname = 'notify_comment_hidden' and p.pronamespace = 'public'::regnamespace
        and cfg like 'search_path=%'
   )),
  'CAT6_notify_comment_hidden_fija_search_path_explicito'
);

select ok(
  (select count(*)::int from pg_proc
    where proname = 'notify_admin_comment_report' and pronamespace = 'public'::regnamespace) = 1,
  'CAT7_existe_public_notify_admin_comment_report'
);
select is(
  (select prosecdef from pg_proc
    where proname = 'notify_admin_comment_report' and pronamespace = 'public'::regnamespace),
  true, 'CAT8_notify_admin_comment_report_es_security_definer'
);
select ok(
  (select exists (
     select 1 from pg_proc p, unnest(p.proconfig) cfg
      where p.proname = 'notify_admin_comment_report' and p.pronamespace = 'public'::regnamespace
        and cfg like 'search_path=%'
   )),
  'CAT9_notify_admin_comment_report_fija_search_path_explicito'
);

-- Triggers — evento correcto, resueltos por NOMBRE de función (no por conteo bruto de
-- triggers de la tabla, que ya tiene trg_comment_count/comment_reports_autohide de 289.2/3).
select ok(
  (select exists (
     select 1 from pg_trigger t
     join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.comments'::regclass and not t.tgisinternal
      and p.proname = 'notify_comment_on_my_property'
      and pg_get_triggerdef(t.oid) ~* 'after\s+insert'
   )),
  'CAT10_trigger_de_notify_comment_on_my_property_es_AFTER_INSERT'
);
select ok(
  (select exists (
     select 1 from pg_trigger t
     join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.comments'::regclass and not t.tgisinternal
      and p.proname = 'notify_comment_on_my_property'
      and pg_get_triggerdef(t.oid) ~* 'update\s+of\s+status'
   )),
  'CAT11_trigger_de_notify_comment_on_my_property_dispara_en_UPDATE_OF_status'
);
select ok(
  (select exists (
     select 1 from pg_trigger t
     join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.comments'::regclass and not t.tgisinternal
      and p.proname = 'notify_comment_hidden'
      and pg_get_triggerdef(t.oid) ~* 'update\s+of\s+status'
   )),
  'CAT12_trigger_de_notify_comment_hidden_dispara_en_UPDATE_OF_status'
);
select ok(
  (select exists (
     select 1 from pg_trigger t
     join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.comment_reports'::regclass and not t.tgisinternal
      and p.proname = 'notify_admin_comment_report'
      and pg_get_triggerdef(t.oid) ~* 'after\s+insert'
   )),
  'CAT13_trigger_de_notify_admin_comment_report_es_AFTER_INSERT_en_comment_reports'
);
select ok(
  not (select exists (
     select 1 from pg_trigger t
     join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.comment_reports'::regclass and not t.tgisinternal
      and p.proname = 'notify_admin_comment_report'
      and pg_get_triggerdef(t.oid) ~* '\bupdate\b'
   )),
  'CAT14_trigger_de_notify_admin_comment_report_NUNCA_dispara_en_UPDATE'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) [COMP] comment_on_my_property — a partir de aquí un INSERT real contra comments (que
--    ya existe, 289.2) es válido; lo que puede no existir todavía es el TRIGGER nuevo, así
--    que estas secciones SÍ lanzarían si comments no existiera (no es el caso, RED real es
--    "0 filas en notifications" / catálogo de arriba).
-- ════════════════════════════════════════════════════════════════════════════

-- COMP1/2/3 — insert visible por un tercero: 1 aviso completo y correcto al publicador.
insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002894c1', '00000000-0000-0000-0000-000000289450',
   '00000000-0000-0000-0000-000000289402', 'Bonito depa', 'visible');

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894c1'
      and type = 'comment_on_my_property'),
  1, 'COMP1_insert_visible_de_un_tercero_genera_1_aviso_al_publicador'
);
select is(
  (select user_id from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894c1' and type = 'comment_on_my_property'),
  '00000000-0000-0000-0000-000000289401'::uuid,
  'COMP2_el_destinatario_es_properties_owner_user_id (el publicador)'
);

create temp table result_comp1 (n_title text, n_body text, n_deep_link text, n_rel_type text, n_address text);
insert into result_comp1
  select title, body, deep_link, related_entity_type, data->>'address'
    from public.notifications
   where related_entity_id = '00000000-0000-0000-0000-0000002894c1' and type = 'comment_on_my_property';

select is((select n_body from result_comp1),
  'Tu propiedad en "Fixture 2894 — PROP_COMP" recibió un nuevo comentario.',
  'COMP3_body_nombra_la_direccion_real_de_la_propiedad');
select is((select n_deep_link from result_comp1),
  '/property/00000000-0000-0000-0000-000000289450', 'COMP4_deep_link_property_mas_property_id');
select is((select n_rel_type from result_comp1),
  'comment', 'COMP5_related_entity_type_comment');
select is((select n_address from result_comp1),
  'Fixture 2894 — PROP_COMP', 'COMP6_data_address');

-- COMP7 — insert held_for_review: 0 avisos (moderación pendiente, "nada para
-- held_for_review").
insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002894c2', '00000000-0000-0000-0000-000000289450',
   '00000000-0000-0000-0000-000000289402', 'Comentario a revisar', 'held_for_review');
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894c2' and type = 'comment_on_my_property'),
  0, 'COMP7_insert_held_for_review_no_genera_aviso'
);

-- COMP8 — moderación libera ese MISMO comentario (held_for_review→visible): SÍ 1 aviso.
update public.comments set status = 'visible' where id = '00000000-0000-0000-0000-0000002894c2';
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894c2' and type = 'comment_on_my_property'),
  1, 'COMP8_la_liberacion_held_for_review_a_visible_SI_genera_1_aviso'
);

-- COMP9 — self: el publicador comenta su propia propiedad (visible directo) → 0 avisos.
insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002894c3', '00000000-0000-0000-0000-000000289450',
   '00000000-0000-0000-0000-000000289401', 'Comento mi propio depa', 'visible');
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894c3' and type = 'comment_on_my_property'),
  0, 'COMP9_el_publicador_comentando_su_propia_propiedad_NO_se_autoavisa'
);

-- COMP10 — self, camino UPDATE: held_for_review→visible del propio publicador → 0 avisos
-- también (el guard "nunca el autor==dueño" aplica en AMBOS caminos, no solo INSERT).
insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002894c4', '00000000-0000-0000-0000-000000289450',
   '00000000-0000-0000-0000-000000289401', 'Comento y se revisa', 'held_for_review');
update public.comments set status = 'visible' where id = '00000000-0000-0000-0000-0000002894c4';
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894c4' and type = 'comment_on_my_property'),
  0, 'COMP10_liberacion_held_for_review_a_visible_del_propio_publicador_NO_se_autoavisa'
);

-- COMP11 — boundary: INSERT directo con status='hidden' (camino inusual pero alcanzable
-- desde service_role) NUNCA dispara comment_on_my_property (solo 'visible' en INSERT).
insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002894c5', '00000000-0000-0000-0000-000000289450',
   '00000000-0000-0000-0000-000000289402', 'Nace oculto', 'hidden');
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894c5' and type = 'comment_on_my_property'),
  0, 'COMP11_insert_directo_con_status_hidden_NO_genera_aviso'
);

-- COMP12 — boundary: hidden→visible (restaurado por un admin, NUNCA pasó por
-- held_for_review) tampoco dispara comment_on_my_property -- solo la transición
-- held_for_review→visible cuenta, no "cualquier cosa que no sea visible" → visible.
select pg_temp.act_as('00000000-0000-0000-0000-000000289409'); -- PLAT_ADMIN1
select public.resolve_comment_reports_atomic(
  '00000000-0000-0000-0000-0000002894c5'::uuid, 'restore', null);
reset role;
select is(
  (select status::text from public.comments where id = '00000000-0000-0000-0000-0000002894c5'),
  'visible', 'COMP12_precondicion_c5_quedo_visible_tras_el_restore'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894c5' and type = 'comment_on_my_property'),
  0, 'COMP13_hidden_a_visible_NUNCA_dispara_comment_on_my_property (solo held_for_review->visible)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2.5) [COMP-CYCLE] Dedupe fuerte — held_for_review→visible→held_for_review→visible
--     dispara la condición de transición DOS veces; solo debe persistir 1 fila (índice
--     único parcial, D-KEY de la cabecera).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002894c6', '00000000-0000-0000-0000-000000289450',
   '00000000-0000-0000-0000-000000289402', 'Ciclo held-visible-held-visible', 'held_for_review');
update public.comments set status = 'visible' where id = '00000000-0000-0000-0000-0000002894c6';
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894c6' and type = 'comment_on_my_property'),
  1, 'COMPCYCLE1_primera_liberacion_genera_1_aviso'
);
update public.comments set status = 'held_for_review' where id = '00000000-0000-0000-0000-0000002894c6';
update public.comments set status = 'visible' where id = '00000000-0000-0000-0000-0000002894c6';
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894c6' and type = 'comment_on_my_property'),
  1, 'COMPCYCLE2_una_segunda_liberacion_del_MISMO_comentario_NO_duplica_el_aviso (dedupe por comment_id)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) [HID] comment_hidden — recipiente el AUTOR (nunca el gestor/admin que oculta).
-- ════════════════════════════════════════════════════════════════════════════

-- HID1/2/3 — gestor oculta un comentario visible: 1 aviso completo y correcto al autor.
insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002894d1', '00000000-0000-0000-0000-000000289451',
   '00000000-0000-0000-0000-000000289403', 'Comentario que se oculta', 'visible');
update public.comments set status = 'hidden' where id = '00000000-0000-0000-0000-0000002894d1';

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894d1' and type = 'comment_hidden'),
  1, 'HID1_ocultar_un_comentario_visible_genera_1_aviso_al_autor'
);
select is(
  (select user_id from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894d1' and type = 'comment_hidden'),
  '00000000-0000-0000-0000-000000289403'::uuid,
  'HID2_el_destinatario_es_el_autor_del_comentario_comments_user_id'
);

create temp table result_hid1 (n_title text, n_body text, n_deep_link text, n_rel_type text, n_reason text);
insert into result_hid1
  select title, body, deep_link, related_entity_type, data->>'reason'
    from public.notifications
   where related_entity_id = '00000000-0000-0000-0000-0000002894d1' and type = 'comment_hidden';

select is((select n_body from result_hid1),
  'Tu comentario en "Fixture 2894 — PROP_HID" fue ocultado por moderación.',
  'HID3_body_nombra_la_direccion_real_de_la_propiedad');
select is((select n_deep_link from result_hid1),
  '/property/00000000-0000-0000-0000-000000289451', 'HID4_deep_link_property_mas_property_id');
select is((select n_rel_type from result_hid1),
  'comment', 'HID5_related_entity_type_comment');
select is((select n_reason from result_hid1),
  'oculto_por_moderacion', 'HID6_data_reason_generico_documentado (decision test-author)');

-- HID7 — visible→deleted directo (NUNCA por hidden intermedio): 0 avisos de comment_hidden.
insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002894d2', '00000000-0000-0000-0000-000000289451',
   '00000000-0000-0000-0000-000000289403', 'Se borra directo', 'visible');
update public.comments set status = 'deleted' where id = '00000000-0000-0000-0000-0000002894d2';
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894d2' and type = 'comment_hidden'),
  0, 'HID7_visible_a_deleted_directo_NUNCA_genera_comment_hidden'
);

-- HID8 — boundary: visible→held_for_review directo (re-envío a revisión hipotético) tampoco
-- dispara comment_hidden -- "nada para held_for_review" aplica a los 3 tipos del catálogo.
insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002894d6', '00000000-0000-0000-0000-000000289451',
   '00000000-0000-0000-0000-000000289403', 'Vuelve a revision', 'visible');
update public.comments set status = 'held_for_review' where id = '00000000-0000-0000-0000-0000002894d6';
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894d6' and type = 'comment_hidden'),
  0, 'HID8_visible_a_held_for_review_directo_NUNCA_genera_comment_hidden'
);

-- HID9 — hidden→deleted vía la RPC (resolve_comment_reports_atomic, delete_comment): NO
-- agrega un 2o aviso sobre h1 (que ya tiene 1 de HID1) -- solo "entrar" a hidden notifica.
select pg_temp.act_as('00000000-0000-0000-0000-000000289409'); -- PLAT_ADMIN1
select public.resolve_comment_reports_atomic(
  '00000000-0000-0000-0000-0000002894d1'::uuid, 'delete_comment', 'confirmado');
reset role;
select is(
  (select status::text from public.comments where id = '00000000-0000-0000-0000-0000002894d1'),
  'deleted', 'HID9_precondicion_h1_quedo_deleted_tras_la_RPC'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894d1' and type = 'comment_hidden'),
  1, 'HID10_hidden_a_deleted_via_RPC_NO_agrega_un_2o_aviso_sigue_en_1'
);

-- HID11 — integración con 289.3: 3 reportes distintos auto-ocultan el comentario, y ESE
-- mismo UPDATE (disparado por el trigger de auto-ocultar) SÍ dispara comment_hidden al
-- autor -- sin necesidad de que un gestor humano lo haga a mano.
insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002894d5', '00000000-0000-0000-0000-000000289451',
   '00000000-0000-0000-0000-000000289403', 'Se oculta por 3 reportes', 'visible');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002894d5', '00000000-0000-0000-0000-000000289404', 'inappropriate'),
  ('00000000-0000-0000-0000-0000002894d5', '00000000-0000-0000-0000-000000289405', 'inappropriate'),
  ('00000000-0000-0000-0000-0000002894d5', '00000000-0000-0000-0000-000000289406', 'inappropriate');
select is(
  (select status::text from public.comments where id = '00000000-0000-0000-0000-0000002894d5'),
  'hidden', 'HID11_precondicion_h5_quedo_hidden_por_3_reportes_distintos (289.3)'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894d5' and type = 'comment_hidden'),
  1, 'HID12_el_auto_ocultar_por_reportes_TAMBIEN_avisa_al_autor_comment_hidden'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3.6) [HID-CYCLE] recuperar y volver a ocultar el MISMO comentario genera un aviso NUEVO
--     por cada ciclo (🔒 decisión test-author de la cabecera).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002894d4', '00000000-0000-0000-0000-000000289451',
   '00000000-0000-0000-0000-000000289403', 'Ciclo oculto-visible-oculto', 'visible');
update public.comments set status = 'hidden' where id = '00000000-0000-0000-0000-0000002894d4';
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894d4' and type = 'comment_hidden'),
  1, 'HIDCYCLE1_primer_ciclo_hidden_genera_1_aviso'
);

select pg_temp.act_as('00000000-0000-0000-0000-000000289409'); -- PLAT_ADMIN1
select public.resolve_comment_reports_atomic(
  '00000000-0000-0000-0000-0000002894d4'::uuid, 'restore', null);
reset role;
select is(
  (select status::text from public.comments where id = '00000000-0000-0000-0000-0000002894d4'),
  'visible', 'HIDCYCLE2_precondicion_h4_vuelve_a_visible'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894d4' and type = 'comment_hidden'),
  1, 'HIDCYCLE3_volver_a_visible_no_agrega_un_2o_aviso_sigue_en_1'
);

update public.comments set status = 'hidden' where id = '00000000-0000-0000-0000-0000002894d4';
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894d4' and type = 'comment_hidden'),
  2, 'HIDCYCLE4_un_2o_ciclo_de_ocultamiento_SI_genera_un_2o_aviso_nuevo'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) [ADM] admin_comment_report — fan-out a admins vivos, dedupe por ciclo abierto,
--    reabre tras resolve_comment_reports_atomic, nunca al reportante, nunca al admin
--    borrado, nunca al admin que es su propio reportante.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002894a1', '00000000-0000-0000-0000-000000289452',
   '00000000-0000-0000-0000-000000289412', 'Comentario reportado 3 veces', 'visible');

-- ADM1/2/3/4/5 — 1er reporte: fan-out completo a los 2 admins vivos, nunca al borrado, nunca
-- al reportante.
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002894a1', '00000000-0000-0000-0000-000000289404', 'inappropriate');

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894a1' and type = 'admin_comment_report'),
  array[
    '00000000-0000-0000-0000-000000289409'::uuid,
    '00000000-0000-0000-0000-000000289410'::uuid
  ],
  'ADM1_el_1er_reporte_avisa_a_los_2_admins_vivos_y_SOLO_a_ellos'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000289411' and related_entity_id = '00000000-0000-0000-0000-0000002894a1'),
  0, 'ADM2_el_admin_BORRADO_deleted_at_no_recibe_el_aviso'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000289404' and type = 'admin_comment_report'
      and related_entity_id = '00000000-0000-0000-0000-0000002894a1'),
  0, 'ADM3_el_reportante_nunca_recibe_su_propio_aviso_de_admin'
);

create temp table result_adm1 (n_title text, n_body text, n_deep_link text, n_rel_type text);
insert into result_adm1
  select title, body, deep_link, related_entity_type
    from public.notifications
   where user_id = '00000000-0000-0000-0000-000000289409'
     and related_entity_id = '00000000-0000-0000-0000-0000002894a1' and type = 'admin_comment_report';

select is((select n_body from result_adm1),
  'Un comentario en "Fixture 2894 — PROP_ADM" fue reportado.',
  'ADM4_body_nombra_la_direccion_real_de_la_propiedad');
select is((select n_deep_link from result_adm1),
  '/admin/reports', 'ADM5_deep_link_admin_reports (ruta ya viva de 220.4)');
select is((select n_rel_type from result_adm1),
  'comment', 'ADM6_related_entity_type_comment');

-- ADM7 — 2o reporte del MISMO ciclo abierto (el 1o sigue 'new'): 0 avisos nuevos.
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002894a1', '00000000-0000-0000-0000-000000289405', 'inappropriate');
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894a1' and type = 'admin_comment_report'),
  2, 'ADM7_el_2o_reporte_del_mismo_ciclo_abierto_NO_agrega_avisos_nuevos (sigue en 2)'
);

-- ADM8 — 3er reporte: cruza el umbral de auto-ocultar (289.3, comment_hidden dispara aparte)
-- pero el ciclo de reportes SIGUE abierto (los 3 siguen 'new') -> tampoco agrega avisos.
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002894a1', '00000000-0000-0000-0000-000000289406', 'inappropriate');
select is(
  (select status::text from public.comments where id = '00000000-0000-0000-0000-0000002894a1'),
  'hidden', 'ADM8_precondicion_el_3er_reporte_oculto_el_comentario (289.3)'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894a1' and type = 'admin_comment_report'),
  2, 'ADM9_el_3er_reporte_que_cruza_el_umbral_TAMPOCO_agrega_avisos_de_admin_report (sigue en 2)'
);

-- ADM10 — un admin resuelve (keep_hidden): cierra los 3 reportes 'new' -> 'resolved'.
select pg_temp.act_as('00000000-0000-0000-0000-000000289409'); -- PLAT_ADMIN1
select public.resolve_comment_reports_atomic(
  '00000000-0000-0000-0000-0000002894a1'::uuid, 'keep_hidden', 'Reportes fundados');
reset role;
select is(
  (select count(*)::int from public.comment_reports
    where comment_id = '00000000-0000-0000-0000-0000002894a1' and status = 'new'),
  0, 'ADM10_precondicion_los_3_reportes_del_ciclo_anterior_quedaron_resolved'
);

-- ADM11 — un 4o reportante, DESPUÉS de resolver, abre un ciclo NUEVO -> aviso NUEVO a los
-- 2 admins vivos (2 filas más: 4 en total).
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002894a1', '00000000-0000-0000-0000-000000289407', 'inappropriate');
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-0000002894a1' and type = 'admin_comment_report'),
  4, 'ADM11_un_reporte_posterior_a_la_resolucion_SI_abre_un_ciclo_nuevo_y_avisa_de_nuevo (2 mas)'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000289409' and related_entity_id = '00000000-0000-0000-0000-0000002894a1'
      and type = 'admin_comment_report'),
  2, 'ADM12_PLAT_ADMIN1_tiene_2_avisos_uno_por_ciclo (1er ciclo + ciclo reabierto)'
);

-- ADM13 — guard "nunca el actor": un admin que reporta un comentario AJENO (no el suyo) NO
-- recibe SU PROPIO aviso, pero el OTRO admin vivo sí.
insert into public.comments (id, property_id, user_id, body, status) values
  ('00000000-0000-0000-0000-0000002894a2', '00000000-0000-0000-0000-000000289452',
   '00000000-0000-0000-0000-000000289413', 'Comentario reportado por un admin', 'visible');
insert into public.comment_reports (comment_id, reported_by_user_id, reason) values
  ('00000000-0000-0000-0000-0000002894a2', '00000000-0000-0000-0000-000000289409', 'inappropriate'); -- PLAT_ADMIN1 reporta
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000289409' and related_entity_id = '00000000-0000-0000-0000-0000002894a2'
      and type = 'admin_comment_report'),
  0, 'ADM14_el_admin_que_reporta_NO_recibe_su_propio_aviso'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000289410' and related_entity_id = '00000000-0000-0000-0000-0000002894a2'
      and type = 'admin_comment_report'),
  1, 'ADM15_el_OTRO_admin_vivo_SI_recibe_el_aviso_del_reporte_de_su_colega'
);

select * from finish();
rollback;
