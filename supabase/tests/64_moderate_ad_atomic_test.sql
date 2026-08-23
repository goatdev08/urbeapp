-- Tests pgTAP — RPC public.moderate_ad_atomic (tarea #208, subtarea 208.1).
-- Ejecutar con:
--   supabase test db supabase/tests/64_moderate_ad_atomic_test.sql --local
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL HUECO: #169 construyó el MOTOR de la moderación de anuncios —el trigger
-- handle_ad_status_change() con su grafo, su auditoría y su guard de
-- organización suspendida— pero ninguna ruta para accionarlo desde la app.
-- Hoy un anuncio pasa a 'active' solo con un UPDATE a mano en SQL.
--
-- 🔴 POR QUÉ HACE FALTA UNA RPC Y NO BASTA UN UPDATE DESDE LA EDGE FUNCTION.
-- El trigger exige un admin identificado vía private.resolve_admin_actor(),
-- que resuelve por (1) auth.uid() de un JWT cuyo dueño sea role='admin', o
-- (2) el GUC de sesión `urbea.admin_actor_id`. Una Edge Function con
-- service_role NO tiene auth.uid(), y un `set_config` por PostgREST no
-- sobrevive fuera de su transacción. Sin esta RPC, TODA moderación desde la
-- app fallaría con STATUS_CHANGE_REQUIRES_ADMIN — el 100% de las veces.
-- Misma solución que ya usa moderate_property_atomic (20260809000007) para
-- propiedades: el admin viaja como parámetro y la RPC lo instala en el GUC
-- dentro de su propia transacción.
--
-- LO QUE ESTA RPC **NO** HACE, A PROPÓSITO:
--   · NO valida el grafo de transiciones — el trigger es la única autoridad.
--   · NO escribe admin_actions — el trigger ya inserta esa fila. Duplicarla
--     haría que la auditoría contara doble sobre un acto facturable.
--   · NO decide si la organización está suspendida — el trigger lo hace.
-- Su trabajo completo: identificar al admin, hacer UN update, y distinguir
-- "no existe" (0 filas, sin excepción) de "el trigger dijo que no".
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(14);

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token,
                        email_change_token_new, email_change)
values
  ('d0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'admin208@urbea.test', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('d0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'nadmin208@urbea.test', crypt('x', gen_salt('bf')),
   now(), now(), now(), '', '', '', '');

-- ⚠️ Un trigger sobre auth.users ya espeja la fila hacia public.users, así que
-- un INSERT plano choca con users_pkey. Se hace UPSERT y lo que importa —el
-- `role`— se fija explícitamente: el espejo crea al usuario con role='user'.
insert into public.users (id, first_name, last_name, email, role)
values
  ('d0000000-0000-0000-0000-00000000000a', 'Admin', 'Dos08', 'admin208@urbea.test', 'admin'),
  ('d0000000-0000-0000-0000-00000000000b', 'No', 'Admin', 'nadmin208@urbea.test', 'agent')
on conflict (id) do update set role = excluded.role;

insert into public.agencies (id, name, slug, status, created_by_user_id,
                             can_publish_properties, can_advertise, advertiser_category)
values
  ('e0000000-0000-0000-0000-00000000000a', 'Seguros Test 208', 'seguros-208', 'active',
   'd0000000-0000-0000-0000-00000000000a', false, true, 'seguros'),
  ('e0000000-0000-0000-0000-00000000000b', 'Suspendida 208', 'susp-208', 'active',
   'd0000000-0000-0000-0000-00000000000a', false, true, 'seguros');

insert into public.ad_creatives (id, agency_id, cloudflare_uid, duration_seconds, status)
values
  ('c0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-00000000000a',
   'uid-208-a', 15, 'ready'),
  ('c0000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-00000000000b',
   'uid-208-b', 15, 'ready');

-- Anuncio en pending_review (el caso normal), y otro ya activo (transición inválida).
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value,
                        status, starts_at, ends_at)
values
  ('a0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-00000000000a',
   'c0000000-0000-0000-0000-00000000000a', 'Crédito 208', 'external_url',
   'https://ejemplo.mx', 'pending_review', now(), now() + interval '30 days'),
  ('a0000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-00000000000a',
   'c0000000-0000-0000-0000-00000000000a', 'Rechazable 208', 'external_url',
   'https://ejemplo.mx', 'pending_review', now(), now() + interval '30 days'),
  ('a0000000-0000-0000-0000-00000000000c', 'e0000000-0000-0000-0000-00000000000a',
   'c0000000-0000-0000-0000-00000000000a', 'Ya activo 208', 'external_url',
   'https://ejemplo.mx', 'pending_review', now(), now() + interval '30 days'),
  ('a0000000-0000-0000-0000-00000000000d', 'e0000000-0000-0000-0000-00000000000b',
   'c0000000-0000-0000-0000-00000000000b', 'De suspendida 208', 'external_url',
   'https://ejemplo.mx', 'pending_review', now(), now() + interval '30 days');

-- ── 1. La RPC existe con la firma esperada ──────────────────────────────────
select has_function(
  'public', 'moderate_ad_atomic',
  array['uuid', 'text', 'text', 'uuid'],
  'MOD1: moderate_ad_atomic(p_ad_id, p_next_status, p_rejection_reason, p_admin_id) existe'
);

select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'moderate_ad_atomic'),
  true,
  'MOD2: es SECURITY DEFINER'
);

-- 🔒 Un acto de moderación NO puede quedar al alcance de authenticated: la
-- RPC instala un admin_actor arbitrario en el GUC. Solo service_role.
select ok(
  not has_function_privilege('authenticated', 'public.moderate_ad_atomic(uuid, text, text, uuid)', 'EXECUTE'),
  'MOD3: authenticated NO puede ejecutarla'
);
select ok(
  not has_function_privilege('anon', 'public.moderate_ad_atomic(uuid, text, text, uuid)', 'EXECUTE'),
  'MOD4: anon NO puede ejecutarla'
);

-- ── 2. Aprobar ──────────────────────────────────────────────────────────────
select lives_ok(
  $$ select public.moderate_ad_atomic(
       'a0000000-0000-0000-0000-00000000000a'::uuid, 'active', null,
       'd0000000-0000-0000-0000-00000000000a'::uuid) $$,
  'MOD5: aprobar un anuncio en pending_review no lanza'
);

select is(
  (select status::text from public.ads where id = 'a0000000-0000-0000-0000-00000000000a'),
  'active',
  'MOD6: el anuncio quedó active'
);

-- 🔴 La auditoría la escribe el TRIGGER, no la RPC. Debe haber EXACTAMENTE
-- una fila: si la RPC insertara la suya, este assert cazaría el doble conteo.
select is(
  (select count(*) from public.admin_actions
    where entity_type = 'ad' and entity_id = 'a0000000-0000-0000-0000-00000000000a'
      and action_type = 'change_ad_status'),
  1::bigint,
  'MOD7: EXACTAMENTE una fila de auditoría (el trigger la escribe, la RPC no la duplica)'
);

select is(
  (select admin_id from public.admin_actions
    where entity_type = 'ad' and entity_id = 'a0000000-0000-0000-0000-00000000000a'
      and action_type = 'change_ad_status' limit 1),
  'd0000000-0000-0000-0000-00000000000a'::uuid,
  'MOD8: la auditoría registra al admin que pasó la RPC, resuelto vía el GUC'
);

-- ── 3. Rechazar ─────────────────────────────────────────────────────────────
select lives_ok(
  $$ select public.moderate_ad_atomic(
       'a0000000-0000-0000-0000-00000000000b'::uuid, 'rejected', 'Contenido no permitido',
       'd0000000-0000-0000-0000-00000000000a'::uuid) $$,
  'MOD9: rechazar con razón no lanza'
);

select results_eq(
  $$ select status::text, rejection_reason from public.ads
      where id = 'a0000000-0000-0000-0000-00000000000b' $$,
  $$ values ('rejected', 'Contenido no permitido') $$,
  'MOD10: quedó rejected CON su razón (CHECK ads_rejection_reason_matches_status satisfecho)'
);

-- ── 4. Lo que el trigger rechaza, la RPC propaga ────────────────────────────
-- pending_review → paused no está en el grafo. La RPC no debe "arreglarlo".
-- 🔴 210.1: el guard de la RPC se amplió a admitir 'paused' (antes SOLO
-- {active,rejected} -- este mismo caso se resolvía en la RPC, sin llegar
-- nunca al trigger). Ahora 'paused' SÍ pasa el guard de la RPC y llega al
-- trigger, que lo rechaza por transición inválida -- exactamente lo que este
-- test ya documentaba como su intención ("la RPC no debe arreglarlo", "el
-- trigger rechaza, la RPC propaga"). Mismo caso, mismo bloqueo (P0001), solo
-- cambia CUÁL de los dos guards lo lanza -- ver TKD24 en
-- 66_ad_takedown_test.sql, que fija esta misma mecánica para draft→paused.
select throws_ok(
  $$ select public.moderate_ad_atomic(
       'a0000000-0000-0000-0000-00000000000c'::uuid, 'paused', null,
       'd0000000-0000-0000-0000-00000000000a'::uuid) $$,
  'P0001',
  'INVALID_AD_STATUS_TRANSITION',
  'MOD11: pending_review->paused sigue rechazado -- ahora vía el TRIGGER (210.1 amplió el guard de la RPC a paused, no el grafo)'
);

-- ── 5. Un admin que no es admin ─────────────────────────────────────────────
-- El GUC solo cuenta si el uuid pertenece a un role='admin' real
-- (private.resolve_admin_actor lo verifica). Pasar un agente debe tronar.
select throws_ok(
  $$ select public.moderate_ad_atomic(
       'a0000000-0000-0000-0000-00000000000c'::uuid, 'active', null,
       'd0000000-0000-0000-0000-00000000000b'::uuid) $$,
  'P0001',
  'STATUS_CHANGE_REQUIRES_ADMIN',
  'MOD12: un p_admin_id que no es role=admin NO puede moderar'
);

-- ── 6. Anuncio inexistente: 0 filas, sin excepción ──────────────────────────
-- La EF necesita distinguir "no existe" (→404) de "el trigger dijo que no"
-- (→409). Por eso la RPC devuelve el número de filas afectadas.
select is(
  (select public.moderate_ad_atomic(
     'a0000000-0000-0000-0000-0000000000ff'::uuid, 'active', null,
     'd0000000-0000-0000-0000-00000000000a'::uuid)),
  0,
  'MOD13: un ad_id inexistente devuelve 0 filas afectadas, NO una excepción'
);

select is(
  (select public.moderate_ad_atomic(
     'a0000000-0000-0000-0000-00000000000c'::uuid, 'active', null,
     'd0000000-0000-0000-0000-00000000000a'::uuid)),
  1,
  'MOD14: una moderación exitosa devuelve 1 fila afectada'
);

select * from finish();
rollback;
