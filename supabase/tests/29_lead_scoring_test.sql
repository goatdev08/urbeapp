-- Tests pgTAP — Scoring denormalizado + nivel automático del CRM (subtarea 75.2)
-- Ejecutar con: supabase test db (CLI global de brew, NUNCA npx supabase)
-- ⚠️ GOTCHA operativo (heredado del agente de 75.1): `supabase test db` NO reaplica
-- migraciones nuevas por sí solo contra la DB local existente — si agregas una
-- migración GREEN nueva, corre `supabase db reset` antes.
-- Corre como superusuario dentro de una transacción revertida (no persiste). Sin
-- impersonación JWT (pg_temp.act_as) — este archivo no ejercita RLS, solo el
-- comportamiento de triggers/columnas a nivel DB (mismo enfoque que
-- 07_engagement_counts_test.sql).
--
-- ════════════════════════════════════════════════════════════════════════════
-- CONTEXTO — REORIENTACIÓN (2026-08-07): el diseño original de 75.2 sumaba
-- desde public.events_raw, pero esa tabla NO TIENE ESCRITORES (0 referencias en
-- código, 0 filas en el remoto) — pipeline inexistente. El scoring se deriva de
-- señales que YA EXISTEN:
--   Contacto (existe el lead)                         = 10 puntos
--   Guardado (public.saves del usuario sobre props    =  4 puntos c/u
--             del agente)
--   Like     (public.likes del usuario sobre videos   =  1 punto c/u
--             de props del agente)
-- Las señales que faltan del PRD §19.6 (compartido 5, comentario 3, video
-- completo 2) llegan con el pipeline de eventos de otra ola — la fórmula debe
-- poder crecer sin rehacerse.
-- El guard "una acción cuenta una sola vez" YA LO DAN los unique index
-- likes_user_video_unique y saves_user_property_unique (migración 0006) — NO
-- se reinventa aquí, solo se demuestra con un test que un like repetido no
-- infla el score (caso 5).
--
-- Patrón seguido (precedente vivo): supabase/migrations/20260701000001_
-- engagement_count_triggers.sql — triggers AFTER INSERT OR DELETE sobre
-- likes/saves, SECURITY DEFINER, con backfill. El GREEN de esta subtarea
-- previsiblemente añade: (a) triggers AFTER INSERT/DELETE en likes/saves que
-- ajustan leads.score+leads.level del lead correspondiente (agent_id = dueño
-- de la propiedad, user_id = quien da like/guarda); (b) un trigger BEFORE/AFTER
-- INSERT en leads que inicializa score=10+retroactivo y level derivado; (c) un
-- mecanismo que recalcula leads.level cuando cambian los umbrales en
-- app_config (caso 10 — "calibrable sin deploy" tiene que ser verdad para
-- leads YA EXISTENTES, no solo para escrituras futuras).
--
-- SUT (AÚN NO EXISTE — GREEN, fuera de esta fase RED):
--   1) enum public.lead_temperature ('frio','tibio','caliente').
--   2) public.leads.score integer not null default 0.
--   3) public.leads.level lead_temperature not null default 'frio'.
--   4) Triggers sobre likes/saves/leads que mantienen score+level (ver arriba).
--   5) Recompute de level cuando cambian los umbrales de app_config.
--
-- ── DECISIÓN DE SEAM — shape asumido de las claves de app_config (el GREEN
--    DEBE respetar esto exactamente; los tests de umbral lo asumen) ─────────
--   key='lead_score_threshold_tibio'    value=<jsonb número escalar>  (ej. 15)
--   key='lead_score_threshold_caliente' value=<jsonb número escalar>  (ej. 30)
-- Semántica (cortes INCLUSIVOS, mismo patrón que 'archived_retention_days'/
-- 'signed_url_ttl_seconds' de 20260720000001_stream_schema.sql — valor jsonb
-- escalar plano, NO un objeto ni un string):
--   level = 'caliente' si score >= threshold_caliente
--   level = 'tibio'    si score >= threshold_tibio (y < threshold_caliente)
--   level = 'frio'     en otro caso
-- Este archivo NUNCA depende de que la migración GREEN siembre estas 2 claves
-- con un valor por defecto concreto — cada caso que necesita umbrales los
-- fija él mismo por UPSERT dentro de su propio bloque autocontenido (15/30
-- como convención del archivo). Bloqueante para el GREEN: sí conviene sembrar
-- defaults sanos en la migración (mismo patrón fail-closed de app_config) para
-- que un lead nunca quede sin nivel derivable si el admin borra las claves —
-- no cubierto aquí (no fue pedido explícito, ver nota de alcance del
-- orquestador).
--
-- ── Estrategia RED sin abortar la transacción (heredada de 18/21/28) ────────
-- Referenciar hoy `leads.score`, `leads.level` o `'frio'::lead_temperature` en
-- un statement CRUDO top-level ABORTARÍA toda la transacción (42703 columna
-- inexistente / 42704 tipo inexistente) — matando el archivo entero. Por eso
-- TODA lectura/escritura de schema nuevo va envuelta en
-- `lives_ok($$ do $do$ ... raise exception ... $do$; $$, msg)`: si el objeto no
-- existe, el DO muere "not ok" (el mensaje de diag mostrará el 42703/42704
-- crudo de Postgres, NO un mensaje "esperado X fue Y" — el guardian debe leer
-- el diag para confirmar que la razón del rojo es la correcta) sin tumbar el
-- resto de la suite. Cada bloque es AUTÓNOMO (crea su propio fixture) porque
-- un `lives_ok` que falla hace ROLLBACK a su propio savepoint interno.
-- Los checks de catálogo puro (pg_enum/pg_type, has_column, col_type_is,
-- col_not_null, col_default_is) SÍ son seguros en crudo — nunca lanzan,
-- reportan "not ok" limpio si la columna/tipo no existe.
--
-- ── Convención DELTA vs INVARIANTE (heredada de 21/25/27/28) ────────────────
-- DELTA      = falla hoy, pasa tras GREEN completo (discrimina la implementación).
-- INVARIANTE = ya se cumple hoy (ancla de no-regresión) — marcado explícito.

begin;
select plan(22);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — usuarios (el trigger handle_new_user, migración 0002, crea
-- public.users al insertar en auth.users). UUIDs: prefijo hex libre
-- '...0000000752XX' (subtarea 75.2, sin colisión con 075101-075208 de 28_*
-- porque cada archivo pgTAP corre en su propia transacción con rollback).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000075201', 'ag1.7502@test.local'),   -- AG1: agente bajo prueba
  ('00000000-0000-0000-0000-000000075202', 'ag2.7502@test.local'),   -- AG2: otro agente (aislamiento)
  ('00000000-0000-0000-0000-000000075210', 'u02.7502@test.local'),   -- caso 2
  ('00000000-0000-0000-0000-000000075211', 'u03.7502@test.local'),   -- caso 3
  ('00000000-0000-0000-0000-000000075220', 'u04.7502@test.local'),   -- caso 4
  ('00000000-0000-0000-0000-000000075230', 'u05.7502@test.local'),   -- caso 5
  ('00000000-0000-0000-0000-000000075240', 'u06.7502@test.local'),   -- caso 6
  ('00000000-0000-0000-0000-000000075250', 'u07.7502@test.local'),   -- caso 7
  ('00000000-0000-0000-0000-000000075260', 'u08.7502@test.local'),   -- caso 8
  ('00000000-0000-0000-0000-000000075270', 'u09.7502@test.local'),   -- caso 9
  ('00000000-0000-0000-0000-000000075280', 'u10.7502@test.local'),   -- caso 10
  ('00000000-0000-0000-0000-000000075290', 'u11.7502@test.local'),   -- caso 11
  ('00000000-0000-0000-0000-0000000752a0', 'u12.7502@test.local');   -- caso 12 (invariantes)

update public.users set role = 'agent', is_verified_agent = true
  where id in (
    '00000000-0000-0000-0000-000000075201',
    '00000000-0000-0000-0000-000000075202'
  );

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — propiedades + videos (schema pre-existente, seguro en crudo).
-- Todas de AG1 salvo donde se indica AG2 (aislamiento, caso 7).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  -- caso 3 — retroactividad: 2 propiedades de AG1
  ('00000000-0000-0000-0000-000000075212', '00000000-0000-0000-0000-000000075201', 'departamento', 'rent', 'Av. Scoring 12', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 12000, 'active'),
  ('00000000-0000-0000-0000-000000075213', '00000000-0000-0000-0000-000000075201', 'casa', 'sale', 'Av. Scoring 13', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 2500000, 'active'),
  -- caso 4 — delta tras crear el lead
  ('00000000-0000-0000-0000-000000075221', '00000000-0000-0000-0000-000000075201', 'departamento', 'rent', 'Av. Scoring 21', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  -- caso 5 — like repetido
  ('00000000-0000-0000-0000-000000075231', '00000000-0000-0000-0000-000000075201', 'departamento', 'rent', 'Av. Scoring 31', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  -- caso 6 — eliminar like
  ('00000000-0000-0000-0000-000000075241', '00000000-0000-0000-0000-000000075201', 'departamento', 'rent', 'Av. Scoring 41', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  -- caso 7 — aislamiento: propiedad de AG2 (OTRO agente)
  ('00000000-0000-0000-0000-000000075252', '00000000-0000-0000-0000-000000075202', 'departamento', 'rent', 'Av. Scoring 52', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  -- caso 8 — sin lead, no debe crear nada
  ('00000000-0000-0000-0000-000000075261', '00000000-0000-0000-0000-000000075201', 'departamento', 'rent', 'Av. Scoring 61', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  -- caso 9 — umbrales, 5 propiedades para saves
  ('00000000-0000-0000-0000-000000075271', '00000000-0000-0000-0000-000000075201', 'departamento', 'rent', 'Av. Scoring 71', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  ('00000000-0000-0000-0000-000000075272', '00000000-0000-0000-0000-000000075201', 'departamento', 'rent', 'Av. Scoring 72', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  ('00000000-0000-0000-0000-000000075273', '00000000-0000-0000-0000-000000075201', 'departamento', 'rent', 'Av. Scoring 73', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  ('00000000-0000-0000-0000-000000075274', '00000000-0000-0000-0000-000000075201', 'departamento', 'rent', 'Av. Scoring 74', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  ('00000000-0000-0000-0000-000000075275', '00000000-0000-0000-0000-000000075201', 'departamento', 'rent', 'Av. Scoring 75', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  -- caso 10 — calibración
  ('00000000-0000-0000-0000-000000075281', '00000000-0000-0000-0000-000000075201', 'departamento', 'rent', 'Av. Scoring 81', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  -- caso 11 — status nunca cambia
  ('00000000-0000-0000-0000-000000075291', '00000000-0000-0000-0000-000000075201', 'departamento', 'rent', 'Av. Scoring 91', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  -- caso 12 — invariantes (like_count/save_count + historial)
  ('00000000-0000-0000-0000-0000000752a1', '00000000-0000-0000-0000-000000075201', 'departamento', 'rent', 'Av. Scoring A1', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active');

insert into public.property_videos (id, property_id, status, position) values
  ('00000000-0000-0000-0000-000000075214', '00000000-0000-0000-0000-000000075212', 'uploading', 1), -- caso 3, video 1 de prop 1
  ('00000000-0000-0000-0000-000000075215', '00000000-0000-0000-0000-000000075212', 'uploading', 2), -- caso 3, video 2 de prop 1
  ('00000000-0000-0000-0000-000000075216', '00000000-0000-0000-0000-000000075213', 'uploading', 1), -- caso 3, video de prop 2
  ('00000000-0000-0000-0000-000000075222', '00000000-0000-0000-0000-000000075221', 'uploading', 1), -- caso 4
  ('00000000-0000-0000-0000-000000075232', '00000000-0000-0000-0000-000000075231', 'uploading', 1), -- caso 5
  ('00000000-0000-0000-0000-000000075242', '00000000-0000-0000-0000-000000075241', 'uploading', 1), -- caso 6
  ('00000000-0000-0000-0000-000000075253', '00000000-0000-0000-0000-000000075252', 'uploading', 1), -- caso 7 (video de AG2)
  ('00000000-0000-0000-0000-000000075262', '00000000-0000-0000-0000-000000075261', 'uploading', 1), -- caso 8
  ('00000000-0000-0000-0000-000000075292', '00000000-0000-0000-0000-000000075291', 'uploading', 1), -- caso 11
  ('00000000-0000-0000-0000-0000000752a2', '00000000-0000-0000-0000-0000000752a1', 'uploading', 1); -- caso 12

-- ════════════════════════════════════════════════════════════════════════════
-- 1) SHAPE — enum lead_temperature + columnas leads.score/leads.level [DELTA]
--    (catálogo puro: seguro en crudo, nunca aborta la transacción)
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select array_agg(e.enumlabel::text order by e.enumlabel)
     from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'lead_temperature'),
  array['caliente','frio','tibio'],
  'lead_temperature_tiene_exactamente_frio_tibio_caliente'
);

select has_column('public', 'leads', 'score', 'leads.score existe');
select col_type_is('public', 'leads', 'score', 'integer', 'leads.score es integer');
select col_not_null('public', 'leads', 'score', 'leads.score es NOT NULL');
select col_default_is('public', 'leads', 'score', '0', 'leads.score default 0');

select has_column('public', 'leads', 'level', 'leads.level existe');
select col_type_is('public', 'leads', 'level', 'lead_temperature', 'leads.level es lead_temperature');
select col_not_null('public', 'leads', 'level', 'leads.level es NOT NULL');
select col_default_is('public', 'leads', 'level', 'frio', 'leads.level default frio');

-- ════════════════════════════════════════════════════════════════════════════
-- Umbrales canónicos de este archivo — sembrados aquí (tabla+columnas ya
-- existen, INSERT crudo seguro). Los casos 9 y 10 los usan/perturban dentro de
-- su propio bloque autocontenido; ningún otro caso depende de su valor exacto
-- (los casos 2-8, 11, 12 solo verifican `score`, o `level` muy lejos de estos
-- cortes salvo donde se documenta explícitamente el límite).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.app_config (key, value) values
  ('lead_score_threshold_tibio', '15'::jsonb),
  ('lead_score_threshold_caliente', '30'::jsonb);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Caso 2 — lead nuevo SIN actividad previa: score arranca en 10 [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$
  do $do$
  declare v_score int; declare v_level text;
  begin
    insert into public.leads (id, agent_id, user_id, status) values
      ('00000000-0000-0000-0000-000000075219',
       '00000000-0000-0000-0000-000000075201',
       '00000000-0000-0000-0000-000000075210', 'whatsapp_opened');

    select score, level::text into v_score, v_level from public.leads
      where id = '00000000-0000-0000-0000-000000075219';

    if v_score is distinct from 10 or v_level is distinct from 'frio' then
      raise exception 'esperado score=10,level=frio (solo contacto, sin actividad previa); fue score=%,level=%', v_score, v_level;
    end if;
  end
  $do$;
  $$,
  'lead_sin_actividad_previa_nace_con_score_10_y_nivel_frio'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Caso 3 — RETROACTIVIDAD: likes/saves ANTES de contactar ya suman al nacer
--    el lead. 2 saves (prop1+prop2) + 3 likes (2 videos de prop1 + 1 de prop2)
--    => score = 10 + 4*2 + 1*3 = 21 (tibio, umbral 15) [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$
  do $do$
  declare v_score int; declare v_level text;
  begin
    -- Actividad ANTES de que exista el lead.
    insert into public.saves (user_id, property_id) values
      ('00000000-0000-0000-0000-000000075211', '00000000-0000-0000-0000-000000075212'),
      ('00000000-0000-0000-0000-000000075211', '00000000-0000-0000-0000-000000075213');
    insert into public.likes (user_id, property_video_id, property_id) values
      ('00000000-0000-0000-0000-000000075211', '00000000-0000-0000-0000-000000075214', '00000000-0000-0000-0000-000000075212'),
      ('00000000-0000-0000-0000-000000075211', '00000000-0000-0000-0000-000000075215', '00000000-0000-0000-0000-000000075212'),
      ('00000000-0000-0000-0000-000000075211', '00000000-0000-0000-0000-000000075216', '00000000-0000-0000-0000-000000075213');

    -- El contacto llega DESPUÉS.
    insert into public.leads (id, agent_id, user_id, status) values
      ('00000000-0000-0000-0000-000000075218',
       '00000000-0000-0000-0000-000000075201',
       '00000000-0000-0000-0000-000000075211', 'whatsapp_opened');

    select score, level::text into v_score, v_level from public.leads
      where id = '00000000-0000-0000-0000-000000075218';

    if v_score is distinct from 21 or v_level is distinct from 'tibio' then
      raise exception 'esperado score=21 (10+4*2+1*3),level=tibio; fue score=%,level=%', v_score, v_level;
    end if;
  end
  $do$;
  $$,
  'retroactividad_likes_y_saves_previos_al_contacto_ya_suman_al_nacer_el_lead'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Caso 4 — like y guardado NUEVOS (después de existir el lead) incrementan
--    el score: +1 por like, +4 por save. 10 -> 11 -> 15 (toca el umbral tibio
--    inclusive) [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$
  do $do$
  declare v_score int;
  begin
    insert into public.leads (id, agent_id, user_id, status) values
      ('00000000-0000-0000-0000-000000075229',
       '00000000-0000-0000-0000-000000075201',
       '00000000-0000-0000-0000-000000075220', 'whatsapp_opened');

    select score into v_score from public.leads where id = '00000000-0000-0000-0000-000000075229';
    if v_score is distinct from 10 then
      raise exception 'esperado score=10 recien creado el lead, fue %', v_score;
    end if;

    insert into public.likes (user_id, property_video_id, property_id) values
      ('00000000-0000-0000-0000-000000075220', '00000000-0000-0000-0000-000000075222', '00000000-0000-0000-0000-000000075221');
    select score into v_score from public.leads where id = '00000000-0000-0000-0000-000000075229';
    if v_score is distinct from 11 then
      raise exception 'esperado score=11 tras 1 like nuevo (10+1), fue %', v_score;
    end if;

    insert into public.saves (user_id, property_id) values
      ('00000000-0000-0000-0000-000000075220', '00000000-0000-0000-0000-000000075221');
    select score into v_score from public.leads where id = '00000000-0000-0000-0000-000000075229';
    if v_score is distinct from 15 then
      raise exception 'esperado score=15 tras 1 save nuevo mas (11+4), fue %', v_score;
    end if;
  end
  $do$;
  $$,
  'like_y_guardado_nuevos_tras_crear_el_lead_suman_1_y_4_respectivamente'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Caso 5 — like repetido (mismo usuario, mismo video) NO vuelve a sumar
--    (lo bloquea likes_user_video_unique, migración 0006) [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$
  do $do$
  declare v_score int;
  begin
    insert into public.leads (id, agent_id, user_id, status) values
      ('00000000-0000-0000-0000-000000075239',
       '00000000-0000-0000-0000-000000075201',
       '00000000-0000-0000-0000-000000075230', 'whatsapp_opened');
    insert into public.likes (user_id, property_video_id, property_id) values
      ('00000000-0000-0000-0000-000000075230', '00000000-0000-0000-0000-000000075232', '00000000-0000-0000-0000-000000075231');

    select score into v_score from public.leads where id = '00000000-0000-0000-0000-000000075239';
    if v_score is distinct from 11 then
      raise exception 'esperado score=11 tras el primer like (10+1), fue %', v_score;
    end if;

    begin
      insert into public.likes (user_id, property_video_id, property_id) values
        ('00000000-0000-0000-0000-000000075230', '00000000-0000-0000-0000-000000075232', '00000000-0000-0000-0000-000000075231');
      raise exception 'esperaba unique_violation (23505) al repetir el like, pero se insertó sin error';
    exception when unique_violation then
      null; -- comportamiento esperado, ya cubierto por likes_user_video_unique
    end;

    select score into v_score from public.leads where id = '00000000-0000-0000-0000-000000075239';
    if v_score is distinct from 11 then
      raise exception 'el like repetido NO debe inflar el score; seguia esperando 11, fue %', v_score;
    end if;
  end
  $do$;
  $$,
  'like_repetido_mismo_usuario_mismo_video_no_infla_el_score'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) Caso 6 — eliminar el like (DELETE) resta el punto [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$
  do $do$
  declare v_score int;
  begin
    insert into public.leads (id, agent_id, user_id, status) values
      ('00000000-0000-0000-0000-000000075249',
       '00000000-0000-0000-0000-000000075201',
       '00000000-0000-0000-0000-000000075240', 'whatsapp_opened');
    insert into public.likes (user_id, property_video_id, property_id) values
      ('00000000-0000-0000-0000-000000075240', '00000000-0000-0000-0000-000000075242', '00000000-0000-0000-0000-000000075241');

    select score into v_score from public.leads where id = '00000000-0000-0000-0000-000000075249';
    if v_score is distinct from 11 then
      raise exception 'esperado score=11 tras el like (10+1), fue %', v_score;
    end if;

    delete from public.likes
      where user_id = '00000000-0000-0000-0000-000000075240'
        and property_video_id = '00000000-0000-0000-0000-000000075242';

    select score into v_score from public.leads where id = '00000000-0000-0000-0000-000000075249';
    if v_score is distinct from 10 then
      raise exception 'esperado score=10 tras eliminar el like (11-1), fue %', v_score;
    end if;
  end
  $do$;
  $$,
  'eliminar_like_resta_el_punto_del_score'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) Caso 7 — AISLAMIENTO por agente: likes/saves del usuario sobre
--    publicaciones de OTRO agente (AG2) NO afectan el lead con AG1
--    (mutante clásico: trigger que suma sin filtrar por dueño real) [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$
  do $do$
  declare v_score int; declare v_level text;
  begin
    insert into public.leads (id, agent_id, user_id, status) values
      ('00000000-0000-0000-0000-000000075259',
       '00000000-0000-0000-0000-000000075201',
       '00000000-0000-0000-0000-000000075250', 'whatsapp_opened');

    -- Actividad sobre una propiedad de AG2, NO de AG1.
    insert into public.likes (user_id, property_video_id, property_id) values
      ('00000000-0000-0000-0000-000000075250', '00000000-0000-0000-0000-000000075253', '00000000-0000-0000-0000-000000075252');
    insert into public.saves (user_id, property_id) values
      ('00000000-0000-0000-0000-000000075250', '00000000-0000-0000-0000-000000075252');

    select score, level::text into v_score, v_level from public.leads
      where id = '00000000-0000-0000-0000-000000075259';

    if v_score is distinct from 10 or v_level is distinct from 'frio' then
      raise exception 'actividad sobre propiedades de OTRO agente no debe afectar este lead; esperado score=10,level=frio; fue score=%,level=%', v_score, v_level;
    end if;
  end
  $do$;
  $$,
  'aislamiento_likes_y_saves_de_otro_agente_no_afectan_el_lead_de_este_agente'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8) Caso 8 — actividad de un usuario SIN lead con ese agente: no crea lead
--    ni truena (PRD §19.1: "las interacciones no son leads") [INVARIANTE —
--    ya PASA hoy trivialmente (nada auto-crea leads todavía); el guardian
--    debe re-confirmarlo tras GREEN, cuando los triggers de scoring puedan
--    tener la tentación de auto-vivificar un lead al primer like/save]
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$
  do $do$
  declare v_count int;
  begin
    -- U08 NUNCA contactó a AG1 — no existe fila en leads para este par.
    insert into public.likes (user_id, property_video_id, property_id) values
      ('00000000-0000-0000-0000-000000075260', '00000000-0000-0000-0000-000000075262', '00000000-0000-0000-0000-000000075261');
    insert into public.saves (user_id, property_id) values
      ('00000000-0000-0000-0000-000000075260', '00000000-0000-0000-0000-000000075261');

    select count(*) into v_count from public.leads
      where agent_id = '00000000-0000-0000-0000-000000075201'
        and user_id = '00000000-0000-0000-0000-000000075260';

    if v_count is distinct from 0 then
      raise exception 'la actividad de un usuario sin lead NO debe crear un lead automatico; se encontraron % filas', v_count;
    end if;
  end
  $do$;
  $$,
  'actividad_sin_lead_previo_no_crea_lead_ni_truena'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 9) Caso 9 — el NIVEL cruza a tibio y a caliente al pasar los umbrales
--    (15/30, sembrados arriba), y BAJA de nuevo si el score baja [DELTA]
--    (boundary inclusiva: score=18>=15 ya es tibio; score=30>=30 ya caliente)
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$
  do $do$
  declare v_score int; declare v_level text;
  begin
    insert into public.leads (id, agent_id, user_id, status) values
      ('00000000-0000-0000-0000-000000075279',
       '00000000-0000-0000-0000-000000075201',
       '00000000-0000-0000-0000-000000075270', 'whatsapp_opened');

    select score, level::text into v_score, v_level from public.leads where id = '00000000-0000-0000-0000-000000075279';
    if v_score is distinct from 10 or v_level is distinct from 'frio' then
      raise exception 'estado inicial esperado score=10,level=frio; fue score=%,level=%', v_score, v_level;
    end if;

    -- +2 saves (8 pts) -> 18: cruza a tibio (>=15).
    insert into public.saves (user_id, property_id) values
      ('00000000-0000-0000-0000-000000075270', '00000000-0000-0000-0000-000000075271'),
      ('00000000-0000-0000-0000-000000075270', '00000000-0000-0000-0000-000000075272');
    select score, level::text into v_score, v_level from public.leads where id = '00000000-0000-0000-0000-000000075279';
    if v_score is distinct from 18 or v_level is distinct from 'tibio' then
      raise exception 'tras 2 saves esperado score=18,level=tibio; fue score=%,level=%', v_score, v_level;
    end if;

    -- +3 saves más (12 pts) -> 30: cruza a caliente (>=30).
    insert into public.saves (user_id, property_id) values
      ('00000000-0000-0000-0000-000000075270', '00000000-0000-0000-0000-000000075273'),
      ('00000000-0000-0000-0000-000000075270', '00000000-0000-0000-0000-000000075274'),
      ('00000000-0000-0000-0000-000000075270', '00000000-0000-0000-0000-000000075275');
    select score, level::text into v_score, v_level from public.leads where id = '00000000-0000-0000-0000-000000075279';
    if v_score is distinct from 30 or v_level is distinct from 'caliente' then
      raise exception 'tras 5 saves esperado score=30,level=caliente; fue score=%,level=%', v_score, v_level;
    end if;

    -- Quitar 1 save (-4) -> 26: BAJA de nuevo a tibio (<30, >=15).
    delete from public.saves
      where user_id = '00000000-0000-0000-0000-000000075270'
        and property_id = '00000000-0000-0000-0000-000000075275';
    select score, level::text into v_score, v_level from public.leads where id = '00000000-0000-0000-0000-000000075279';
    if v_score is distinct from 26 or v_level is distinct from 'tibio' then
      raise exception 'tras quitar 1 save esperado score=26,level=tibio (baja de caliente); fue score=%,level=%', v_score, v_level;
    end if;
  end
  $do$;
  $$,
  'nivel_cruza_a_tibio_y_caliente_al_subir_el_score_y_baja_de_nuevo_al_bajar'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 10) Caso 10 — cambiar los umbrales en app_config cambia el NIVEL derivado
--     SIN tocar el score, para un lead YA EXISTENTE (calibrable sin deploy de
--     verdad, no un comentario) [DELTA]
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$
  do $do$
  declare v_score int; declare v_level text;
  begin
    insert into public.leads (id, agent_id, user_id, status) values
      ('00000000-0000-0000-0000-000000075289',
       '00000000-0000-0000-0000-000000075201',
       '00000000-0000-0000-0000-000000075280', 'whatsapp_opened');
    insert into public.saves (user_id, property_id) values
      ('00000000-0000-0000-0000-000000075280', '00000000-0000-0000-0000-000000075281');

    -- score=14 (10+4), con umbral canonico tibio=15 esto es FRIO (14<15).
    select score, level::text into v_score, v_level from public.leads where id = '00000000-0000-0000-0000-000000075289';
    if v_score is distinct from 14 or v_level is distinct from 'frio' then
      raise exception 'estado previo a recalibrar esperado score=14,level=frio; fue score=%,level=%', v_score, v_level;
    end if;

    -- Bajar el umbral de tibio a 10 (sin tocar likes/saves/leads directamente).
    update public.app_config set value = '10'::jsonb where key = 'lead_score_threshold_tibio';

    select score, level::text into v_score, v_level from public.leads where id = '00000000-0000-0000-0000-000000075289';
    if v_score is distinct from 14 then
      raise exception 'cambiar el umbral NO debe tocar el score; seguia esperando 14, fue %', v_score;
    end if;
    if v_level is distinct from 'tibio' then
      raise exception 'tras bajar el umbral de tibio a 10 (score=14>=10) el nivel debe recalcularse a tibio SIN nueva actividad; fue %', v_level;
    end if;

    -- Restaurar el umbral canonico del archivo (15) para no filtrar estado a otros casos.
    update public.app_config set value = '15'::jsonb where key = 'lead_score_threshold_tibio';
    select level::text into v_level from public.leads where id = '00000000-0000-0000-0000-000000075289';
    if v_level is distinct from 'frio' then
      raise exception 'al restaurar el umbral a 15 (score=14<15) el nivel debe volver a frio; fue %', v_level;
    end if;
  end
  $do$;
  $$,
  'cambiar_umbrales_en_app_config_recalcula_el_nivel_de_leads_existentes_sin_tocar_el_score'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 11) Caso 11 — 🔴 el STATUS del lead NUNCA cambia por actividad (score/nivel
--     son automáticos; el estado lo mueve el agente a mano) [INVARIANTE — ya
--     PASA hoy trivialmente (nada toca `status` todavía); se vuelve el ancla
--     real de no-regresión una vez GREEN añada triggers de scoring: el
--     guardian debe re-confirmarlo tras GREEN para descartar un UPDATE que
--     arrastre `status` (ver también 12c, mismo riesgo vía
--     trg_lead_status_history)]
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$
  do $do$
  declare v_status_before text; declare v_status_after text;
  begin
    insert into public.leads (id, agent_id, user_id, status) values
      ('00000000-0000-0000-0000-000000075299',
       '00000000-0000-0000-0000-000000075201',
       '00000000-0000-0000-0000-000000075290', 'interested');

    select status::text into v_status_before from public.leads where id = '00000000-0000-0000-0000-000000075299';
    if v_status_before is distinct from 'interested' then
      raise exception 'status inicial esperado interested, fue %', v_status_before;
    end if;

    insert into public.likes (user_id, property_video_id, property_id) values
      ('00000000-0000-0000-0000-000000075290', '00000000-0000-0000-0000-000000075292', '00000000-0000-0000-0000-000000075291');
    insert into public.saves (user_id, property_id) values
      ('00000000-0000-0000-0000-000000075290', '00000000-0000-0000-0000-000000075291');
    delete from public.likes
      where user_id = '00000000-0000-0000-0000-000000075290'
        and property_video_id = '00000000-0000-0000-0000-000000075292';

    select status::text into v_status_after from public.leads where id = '00000000-0000-0000-0000-000000075299';
    if v_status_after is distinct from 'interested' then
      raise exception 'el status NO debe cambiar por actividad (like/save/delete); seguia esperando interested, fue %', v_status_after;
    end if;
  end
  $do$;
  $$,
  'status_del_lead_nunca_cambia_por_actividad_solo_score_y_nivel_son_automaticos'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 12) INVARIANTES / no-regresión [INVARIANTE]
-- ════════════════════════════════════════════════════════════════════════════

-- Lead de soporte para 12a/12b/12c (columnas pre-existentes: seguro en crudo).
insert into public.leads (id, agent_id, user_id, status) values
  ('00000000-0000-0000-0000-0000000752a9',
   '00000000-0000-0000-0000-000000075201',
   '00000000-0000-0000-0000-0000000752a0', 'whatsapp_opened');

-- 12a) properties.like_count / save_count (triggers de 20260701000001) siguen
-- funcionando con los triggers nuevos de scoring activos sobre las mismas
-- tablas likes/saves. Columnas pre-existentes: seguro en crudo, YA pasa hoy.
insert into public.likes (user_id, property_video_id, property_id) values
  ('00000000-0000-0000-0000-0000000752a0', '00000000-0000-0000-0000-0000000752a2', '00000000-0000-0000-0000-0000000752a1');
insert into public.saves (user_id, property_id) values
  ('00000000-0000-0000-0000-0000000752a0', '00000000-0000-0000-0000-0000000752a1');

select is(
  (select like_count from public.properties where id = '00000000-0000-0000-0000-0000000752a1'),
  1,
  '[INVARIANTE] like_count de properties sigue incrementando (trigger 20260701000001 intacto)'
);
select is(
  (select save_count from public.properties where id = '00000000-0000-0000-0000-0000000752a1'),
  1,
  '[INVARIANTE] save_count de properties sigue incrementando (trigger 20260701000001 intacto)'
);

-- 12c) el historial de estado (lead_status_history, subtarea 75.1) NO registra
-- filas por los cambios de score/nivel disparados arriba (like+save) — solo la
-- fila de creación del lead debe existir. Columnas pre-existentes (tabla y
-- trigger de 75.1 ya viven en esta rama): seguro en crudo. Hoy es TRIVIALMENTE
-- cierto (ningún trigger nuevo toca `leads` todavía); se vuelve el ancla real
-- de no-regresión una vez GREEN añada triggers que hacen UPDATE sobre
-- leads.score/level — el guardian debe confirmar que ese UPDATE nunca arrastra
-- `status` de forma que dispare trg_lead_status_history (AFTER UPDATE OF status).
select is(
  (select count(*)::int from public.lead_status_history
     where lead_id = '00000000-0000-0000-0000-0000000752a9'),
  1,
  '[INVARIANTE] cambios de score/nivel (like+save) no agregan filas a lead_status_history'
);

-- ════════════════════════════════════════════════════════════════════════════
-- finish
-- ════════════════════════════════════════════════════════════════════════════

select * from finish();
rollback;
