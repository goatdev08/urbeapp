-- Tests pgTAP — unique(user_id, ad_id, session_id) sobre public.ad_impressions
-- (subtarea #170.6, cierra #193: "el id de cliente sin atar a user_id, vector
-- de fraude de facturación"). Ejecutar con:
--   supabase test db supabase/tests/54_ad_impressions_unique_user_ad_session_test.sql --local
-- Corre como superusuario dentro de una transacción revertida (no persiste).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAMS bajo prueba (comportamiento observable, NUNCA internals):
--   1) Shape catalográfico: existe una constraint UNIQUE sobre
--      (ad_id, session_id, user_id) — pg_constraint, nunca lanza aunque la
--      constraint no exista.
--   2) Comportamiento REAL de la constraint con SQL ejecutado (no simulado):
--      dos filas con `id` DISTINTO (uuid v4/v5 cualquiera) pero el MISMO
--      trío (user_id, ad_id, session_id) deben ser rechazadas por la
--      constraint — este es EXACTAMENTE el escenario que #193 describe: si
--      la derivación del id de la EF regresara a un uuid aleatorio (bug de
--      regresión), la PK (que solo mira `id`) NO vería el duplicado y la
--      facturación se inflaría. Esta constraint es la garantía a nivel de
--      base que sobrevive a esa regresión.
--   3) Cada rechazo convive con una aceptación en el MISMO archivo (nunca
--      assert vacuo): variar CUALQUIERA de los 3 campos (session_id, ad_id,
--      user_id) SÍ debe insertar sin problema.
-- ════════════════════════════════════════════════════════════════════════════
-- SUT (AÚN NO EXISTE — GREEN, fuera de esta fase RED): migración
-- supabase/migrations/20260819000001_ad_impressions_unique_user_ad_session.sql
-- (+ rollback) agrega, sobre la tabla YA EXISTENTE public.ad_impressions
-- (creada en 20260817000002_ad_impressions.sql, subtarea 170.5):
--   alter table public.ad_impressions
--     add constraint ad_impressions_user_ad_session_key
--     unique (user_id, ad_id, session_id);
-- Patrón "drop constraint if exists + add" (idempotente, igual que el fix
-- guardián de 170.5 sobre ad_impressions_monthly). NO requiere `nulls not
-- distinct`: user_id/ad_id/session_id son las 3 NOT NULL desde 170.5 (a
-- diferencia de municipality_id/neighborhood_id en el rollup mensual).
--
-- ── Nota sobre la técnica RED sin abortar la transacción (heredada de
--    06/37/38/46/47/51_*) ──────────────────────────────────────────────────
-- pg_constraint (catálogo) NUNCA lanza aunque el objeto no exista. Las
-- verificaciones de comportamiento real van en bloques `do $$ ... exception
-- when others ... $$` AUTO-PROTEGIDOS que escriben su resultado en una
-- tabla temporal — un INSERT que en RED "pasa de más" (porque la
-- constraint todavía no existe) debe reportarse como tal, nunca abortar el
-- archivo completo.
--
-- ── Edge cases enumerados ────────────────────────────────────────────────────
-- Catálogo: la constraint UNIQUE con las 3 columnas exactas existe.
-- Rechazo real: mismo (user_id, ad_id, session_id) con `id` DISTINTO -> 2ª
--   fila rechazada (23505 de la NUEVA constraint, no de la PK); solo 1 fila
--   sobrevive para ese trío.
-- Aceptación real (conviven con el rechazo, no aisladas): distinto
--   session_id, distinto ad_id, distinto user_id -> las 3 variaciones SÍ se
--   insertan.
-- Generalización: repetir el rechazo sobre una de las variaciones ya
--   aceptadas (no solo sobre la primera fila) -> también rechazado.
-- Boundary: conteo final exacto de filas del fixture tras todos los
--   intentos (válidos + rechazados) -> ningún caso legítimo quedó
--   sobre-bloqueado por la constraint nueva.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(9);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) Fixtures compartidos — self-contained (lección #175: nunca contar sobre
--    datos de otro proceso). agency_id/ad_id necesitan FK real; user_id y
--    session_id NO tienen FK en ad_impressions (170.5), así que cualquier
--    uuid literal sirve para ellos.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000540101', 'owner_adsimpuniq54@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000540201', 'Inmobiliaria Ads Impressions Unique 54', 'inmo-adsimp-uniq-54', 'active',
   '00000000-0000-0000-0000-000000540101');
insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000540201', '00000000-0000-0000-0000-000000540101', 'owner', 'active');

-- 2 ads reales (necesarios para la FK ad_id) — protegido: si ads_schema
-- (169.1) o ad_impressions (170.5) no estuvieran, esto falla limpio y las
-- secciones posteriores leen "no sembrado" en vez de abortar el archivo.
create temp table result_ad_fixture (ok boolean);
do $$
begin
  insert into public.ad_creatives (id, agency_id, cloudflare_uid, duration_seconds, status) values
    ('00000000-0000-0000-0000-000000540301', '00000000-0000-0000-0000-000000540201', 'cfuid-adsimp-uniq-54-a', 15, 'ready'),
    ('00000000-0000-0000-0000-000000540302', '00000000-0000-0000-0000-000000540201', 'cfuid-adsimp-uniq-54-b', 15, 'ready');
  insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
    ('00000000-0000-0000-0000-000000540401', '00000000-0000-0000-0000-000000540201', '00000000-0000-0000-0000-000000540301',
     'Anuncio Fixture Unique 54 A', 'whatsapp', '+525500005401', 'active', now() - interval '1 day', now() + interval '29 days'),
    ('00000000-0000-0000-0000-000000540402', '00000000-0000-0000-0000-000000540201', '00000000-0000-0000-0000-000000540302',
     'Anuncio Fixture Unique 54 B', 'whatsapp', '+525500005402', 'active', now() - interval '1 day', now() + interval '29 days');
  insert into result_ad_fixture values (true);
exception when others then
  insert into result_ad_fixture values (false);
end $$;

-- Trío base A: user_id=USER_A, ad_id=AD_1, session_id=SESSION_1.
-- USER_A = ...540601, USER_B = ...540602, AD_1 = ...540401, AD_2 = ...540402,
-- SESSION_1 = ...540701, SESSION_2 = ...540702.

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Catálogo — la constraint UNIQUE existe con las 3 columnas EXACTAS.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from pg_constraint c
     join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'ad_impressions' and c.contype = 'u'
      and pg_get_constraintdef(c.oid) ilike '%user_id%'
      and pg_get_constraintdef(c.oid) ilike '%ad_id%'
      and pg_get_constraintdef(c.oid) ilike '%session_id%'),
  1,
  'UNIQ1_ad_impressions_tiene_unique_sobre_user_id_ad_id_session_id -- AÚN NO EXISTE en GREEN actual, es el RED de #193'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Comportamiento real — mismo trío, `id` DISTINTO -> rechazado.
--    Este es EXACTAMENTE el escenario de #193: la PK (solo mira `id`) NO
--    vería este duplicado; solo la constraint nueva lo detiene.
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_dup_triple (attempt int, ok boolean, err_sqlstate text);
grant insert on result_dup_triple to service_role;
do $$
begin
  execute format('set local role %I', 'service_role');
  begin
    insert into public.ad_impressions
      (id, ad_id, agency_id, user_id, session_id, shown_at, watched_ms, viewed, completed)
      values
      ('00000000-0000-0000-0000-000000540801', '00000000-0000-0000-0000-000000540401',
       '00000000-0000-0000-0000-000000540201', '00000000-0000-0000-0000-000000540601',
       '00000000-0000-0000-0000-000000540701', now(), 5000, true, false);
    insert into result_dup_triple values (1, true, null);
  exception when others then
    insert into result_dup_triple values (1, false, sqlstate);
  end;
  begin
    -- MISMO (user_id, ad_id, session_id), `id` DIFERENTE (simula la
    -- regresión de derivación que #193 describe -- p.ej. un uuid v4
    -- aleatorio en vez del uuid v5 determinista).
    insert into public.ad_impressions
      (id, ad_id, agency_id, user_id, session_id, shown_at, watched_ms, viewed, completed)
      values
      ('00000000-0000-0000-0000-000000540802', '00000000-0000-0000-0000-000000540401',
       '00000000-0000-0000-0000-000000540201', '00000000-0000-0000-0000-000000540601',
       '00000000-0000-0000-0000-000000540701', now(), 9999, true, true);
    insert into result_dup_triple values (2, true, null);
  exception when others then
    insert into result_dup_triple values (2, false, sqlstate);
  end;
  reset role;
exception when others then
  insert into result_dup_triple values (0, false, sqlstate);
end $$;

select is((select ok from result_dup_triple where attempt = 1), true,
  'DUP1_primer_INSERT_del_trio_base_se_inserta_sin_problema');
select is(
  (select ok::text || ':' || coalesce(err_sqlstate, 'NONE') from result_dup_triple where attempt = 2),
  'false:23505',
  'DUP2_mismo_trio_user_ad_session_con_id_DISTINTO_es_rechazado_por_la_constraint_nueva_no_por_la_PK'
);
select is(
  (select count(*)::int from public.ad_impressions
    where user_id = '00000000-0000-0000-0000-000000540601'
      and ad_id = '00000000-0000-0000-0000-000000540401'
      and session_id = '00000000-0000-0000-0000-000000540701'),
  1,
  'DUP3_tras_el_intento_rechazado_sigue_habiendo_1_sola_fila_para_ese_trio'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Aceptación real — variar CUALQUIERA de los 3 campos SÍ inserta
--    (conviven con el rechazo de arriba, nunca aisladas).
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_variations (label text, ok boolean, err_sqlstate text);
grant insert on result_variations to service_role;
do $$
begin
  execute format('set local role %I', 'service_role');
  -- Variación 1: mismo user_id/ad_id, session_id DISTINTO.
  begin
    insert into public.ad_impressions
      (id, ad_id, agency_id, user_id, session_id, shown_at, watched_ms, viewed, completed)
      values
      ('00000000-0000-0000-0000-000000540803', '00000000-0000-0000-0000-000000540401',
       '00000000-0000-0000-0000-000000540201', '00000000-0000-0000-0000-000000540601',
       '00000000-0000-0000-0000-000000540702', now(), 4000, true, false);
    insert into result_variations values ('distinto_session_id', true, null);
  exception when others then
    insert into result_variations values ('distinto_session_id', false, sqlstate);
  end;
  -- Variación 2: mismo user_id/session_id, ad_id DISTINTO.
  begin
    insert into public.ad_impressions
      (id, ad_id, agency_id, user_id, session_id, shown_at, watched_ms, viewed, completed)
      values
      ('00000000-0000-0000-0000-000000540804', '00000000-0000-0000-0000-000000540402',
       '00000000-0000-0000-0000-000000540201', '00000000-0000-0000-0000-000000540601',
       '00000000-0000-0000-0000-000000540701', now(), 4000, true, false);
    insert into result_variations values ('distinto_ad_id', true, null);
  exception when others then
    insert into result_variations values ('distinto_ad_id', false, sqlstate);
  end;
  -- Variación 3: mismo ad_id/session_id, user_id DISTINTO (persona B).
  begin
    insert into public.ad_impressions
      (id, ad_id, agency_id, user_id, session_id, shown_at, watched_ms, viewed, completed)
      values
      ('00000000-0000-0000-0000-000000540805', '00000000-0000-0000-0000-000000540401',
       '00000000-0000-0000-0000-000000540201', '00000000-0000-0000-0000-000000540602',
       '00000000-0000-0000-0000-000000540701', now(), 4000, true, false);
    insert into result_variations values ('distinto_user_id', true, null);
  exception when others then
    insert into result_variations values ('distinto_user_id', false, sqlstate);
  end;
  reset role;
exception when others then
  insert into result_variations values ('bloque_completo', false, sqlstate);
end $$;

select is((select ok from result_variations where label = 'distinto_session_id'), true,
  'VAR1_distinto_session_id_mismo_user_y_ad_SI_se_inserta');
select is((select ok from result_variations where label = 'distinto_ad_id'), true,
  'VAR2_distinto_ad_id_mismo_user_y_session_SI_se_inserta');
select is((select ok from result_variations where label = 'distinto_user_id'), true,
  'VAR3_distinto_user_id_mismo_ad_y_session_SI_se_inserta_persona_B_no_choca_con_persona_A');

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Generalización — repetir el rechazo sobre una variación YA aceptada
--    (no solo sobre la primera fila del archivo).
-- ════════════════════════════════════════════════════════════════════════════

create temp table result_dup_variation (ok boolean, err_sqlstate text);
grant insert on result_dup_variation to service_role;
do $$
begin
  execute format('set local role %I', 'service_role');
  begin
    -- Mismo trío que la variación 'distinto_ad_id' de arriba (user=540601,
    -- ad=540402, session=540701), `id` DISTINTO otra vez.
    insert into public.ad_impressions
      (id, ad_id, agency_id, user_id, session_id, shown_at, watched_ms, viewed, completed)
      values
      ('00000000-0000-0000-0000-000000540806', '00000000-0000-0000-0000-000000540402',
       '00000000-0000-0000-0000-000000540201', '00000000-0000-0000-0000-000000540601',
       '00000000-0000-0000-0000-000000540701', now(), 1000, false, false);
    insert into result_dup_variation values (true, null);
  exception when others then
    insert into result_dup_variation values (false, sqlstate);
  end;
  reset role;
exception when others then
  insert into result_dup_variation values (false, sqlstate);
end $$;

select is(
  (select ok::text || ':' || coalesce(err_sqlstate, 'NONE') from result_dup_variation),
  'false:23505',
  'DUP4_el_rechazo_no_es_exclusivo_de_la_primera_fila_tambien_bloquea_un_duplicado_de_una_variacion_ya_aceptada'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Boundary — conteo final exacto: 4 filas legítimas sobreviven (trío
--    base + las 3 variaciones), ningún caso legítimo quedó sobre-bloqueado.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.ad_impressions
    where user_id in ('00000000-0000-0000-0000-000000540601', '00000000-0000-0000-0000-000000540602')
      and ad_id in ('00000000-0000-0000-0000-000000540401', '00000000-0000-0000-0000-000000540402')
      and session_id in ('00000000-0000-0000-0000-000000540701', '00000000-0000-0000-0000-000000540702')),
  4,
  'BOUNDARY1_exactamente_4_filas_legitimas_sobreviven_trio_base_mas_3_variaciones_ninguna_sobre_bloqueada'
);

select * from finish();
rollback;
