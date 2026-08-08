-- Tests pgTAP — Hardening del scoring de leads (tarea derivada fix(75.2), origen: review
-- del PR de la rama tarea/75-crm-estados-scoring — hallazgos FIX1 (ALTA), FIX3 (MEDIA),
-- FIX4 (MEDIA) y FIX5 (producto) sobre 20260807000004_lead_scoring.sql).
-- Ejecutar con: supabase test db (CLI global de brew, NUNCA npx supabase)
-- ⚠️ GOTCHA operativo: `supabase test db` NO reaplica migraciones nuevas por sí solo — si
-- agregas una migración GREEN nueva, corre `supabase db reset` antes.
-- Corre como superusuario dentro de una transacción revertida (no persiste). Sin
-- impersonación JWT — este archivo no ejercita RLS, solo triggers/funciones a nivel DB
-- (mismo enfoque que 07/29_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- CONTEXTO — 4 defectos encontrados por el revisor en 20260807000004_lead_scoring.sql:
--
--   FIX1 (ALTA) — private.compute_lead_level hace (value::text)::numeric SIN GUARDA sobre
--   app_config.value. Como esa función corre dentro de init_lead_score (BEFORE INSERT en
--   leads) y adjust_lead_score (AFTER INSERT/DELETE en likes/saves), UN SOLO valor no
--   numérico en cualquiera de las 2 claves de umbral tumba las 3 escrituras (contactar,
--   dar like, guardar) para TODA la plataforma con 22P02 invalid input syntax.
--
--   FIX3 (MEDIA) — el trigger de recálculo era "after update" SOLAMENTE. Con las claves
--   inexistentes (estado real de producción hoy), un INSERT de umbrales no recalcula nada
--   -- un lead ya creado se queda con el nivel viejo hasta que alguien haga un UPDATE.
--
--   FIX4 (MEDIA) — el trigger compartido set_updated_at se disparaba con CUALQUIER UPDATE
--   de la fila leads, incluidas las que solo tocan score/level. Dos efectos: (a) un
--   buscador que da/quita un like reordena el CRM de las apps v1.0.3 (ordenan por
--   updated_at DESC); (b) una recalibración de umbral hacía un UPDATE sin cota sobre TODOS
--   los leads activos.
--
--   FIX5 (producto) — con los defaults viejos (tibio=15/caliente=30), contacto+like+2
--   guardados (11 pts) se clasificaba "Frío", contradiciendo la intuición del producto.
--
-- SUT (AÚN NO EXISTE tal cual — GREEN, fuera de esta fase RED), todo en una migración
-- NUEVA (20260807000007), SIN editar 20260807000004 (ya desplegada):
--   1) private.compute_lead_level: filtra jsonb_typeof(value)='number' antes del cast;
--      fallback pasa de 15/30 a 10/20.
--   2) private.recompute_lead_levels + su trigger: "after insert or update or delete"
--      (el WHEN no puede mezclar NEW/OLD entre eventos -- el filtro de clave vive en el
--      cuerpo de la función); el UPDATE queda acotado a "level is distinct from
--      compute_lead_level(score)".
--   3) El trigger set_updated_at de public.leads pasa a "before update OF <columnas
--      humanas>" (excluye score/level) -- así ninguna escritura de scoring toca
--      leads.updated_at, se acote o no el UPDATE.
--
-- ── Técnica para probar "¿se tocó updated_at?" sin que now() estorbe ────────────────────
-- Todo este archivo corre en UNA transacción; now() (= transaction_timestamp()) devuelve
-- el MISMO valor durante toda la transacción sin importar cuántas veces se llame. Comparar
-- "before" vs "after" contra now() directo NO discriminaría nada (ambos serían iguales
-- pase lo que pase). Por eso cada caso que prueba FIX4 primero BACKDATEA updated_at a un
-- literal fijo ('2020-01-01') con un UPDATE que NO toca ninguna columna de la lista nueva
-- del trigger (por lo tanto no dispara set_updated_at) y luego verifica que ese valor
-- literal sobrevive (o cambia, para el caso de contraste de un UPDATE legítimo). Para
-- probar "¿el UPDATE del recompute tocó esta fila?" (acotamiento, FIX4b) se usa `ctid`
-- (identificador físico de la tupla): cualquier UPDATE que matchee la fila en su WHERE le
-- asigna una ctid nueva, sin importar qué columnas cambien ni el valor de now().
--
-- ── Estrategia RED sin abortar la transacción ────────────────────────────────
-- El schema (leads.score/level, app_config, likes/saves) YA EXISTE por completo -- lo que
-- falla hoy es COMPORTAMIENTO: la SUT lanza 22P02 (FIX1) o el valor resultante no es el
-- esperado (FIX3/4/5, detectado por un `raise exception` propio dentro del bloque). Ambos
-- casos matan el DO -- por eso TODO caso va envuelto en
-- `lives_ok($$ do $do$ ... raise exception ... $do$; $$, msg)` (mismo patrón que 28/29/31_*).
--
-- ── Convención DELTA (todo este archivo es DELTA — no hay invariantes dedicados; los
--    invariantes de scoring ya viven en 29_lead_scoring_test.sql y se re-verifican al
--    correr la suite completa) ──────────────────────────────────────────────────────────

begin;
select plan(7);

-- ════════════════════════════════════════════════════════════════════════════
-- Fixtures — usuarios/propiedades/videos (schema pre-existente, seguro en crudo). UUIDs
-- prefijo '...00000007590X'-'...0000000759XX' (fix 75.2-bis, sin colisión con 075101-
-- 075299 de 28/29, 075501-075606 de 30, ni 075801-075882 de 31 -- cada archivo pgTAP corre
-- en su propia transacción, pero se evita el solape por claridad).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000075901', 'ag1.7502b@test.local'),
  ('00000000-0000-0000-0000-000000075902', 'u1.7502b@test.local'),
  ('00000000-0000-0000-0000-000000075903', 'ag2.7502b@test.local'),
  ('00000000-0000-0000-0000-000000075904', 'u2.7502b@test.local'),
  ('00000000-0000-0000-0000-000000075905', 'ag3.7502b@test.local'),
  ('00000000-0000-0000-0000-000000075906', 'u3.7502b@test.local'),
  ('00000000-0000-0000-0000-000000075907', 'ag4.7502b@test.local'),
  ('00000000-0000-0000-0000-000000075908', 'u4.7502b@test.local'),
  ('00000000-0000-0000-0000-000000075909', 'ag5.7502b@test.local'),
  ('00000000-0000-0000-0000-000000075910', 'u5.7502b@test.local'),
  ('00000000-0000-0000-0000-000000075911', 'ag6.7502b@test.local'),
  ('00000000-0000-0000-0000-000000075912', 'u6.7502b@test.local'),
  ('00000000-0000-0000-0000-000000075913', 'ag7.7502b@test.local'),
  ('00000000-0000-0000-0000-000000075914', 'u7.7502b@test.local'),
  ('00000000-0000-0000-0000-000000075915', 'ag8.7502b@test.local'),
  ('00000000-0000-0000-0000-000000075916', 'u8.7502b@test.local');

update public.users set role = 'agent', is_verified_agent = true
  where id in (
    '00000000-0000-0000-0000-000000075901',
    '00000000-0000-0000-0000-000000075903',
    '00000000-0000-0000-0000-000000075905',
    '00000000-0000-0000-0000-000000075907',
    '00000000-0000-0000-0000-000000075909',
    '00000000-0000-0000-0000-000000075911',
    '00000000-0000-0000-0000-000000075913',
    '00000000-0000-0000-0000-000000075915'
  );

insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  -- Sección 1 (FIX5) — AG1: 2 saves + 2 likes
  ('00000000-0000-0000-0000-000000075930', '00000000-0000-0000-0000-000000075901', 'departamento', 'rent', 'Av. Hardening 30', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  ('00000000-0000-0000-0000-000000075931', '00000000-0000-0000-0000-000000075901', 'departamento', 'rent', 'Av. Hardening 31', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  ('00000000-0000-0000-0000-000000075932', '00000000-0000-0000-0000-000000075901', 'departamento', 'rent', 'Av. Hardening 32', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  ('00000000-0000-0000-0000-000000075934', '00000000-0000-0000-0000-000000075901', 'departamento', 'rent', 'Av. Hardening 34', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  -- Sección 3 (FIX4) — AG4: 3 saves (cruza el umbral)
  ('00000000-0000-0000-0000-000000075940', '00000000-0000-0000-0000-000000075907', 'departamento', 'rent', 'Av. Hardening 40', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  ('00000000-0000-0000-0000-000000075941', '00000000-0000-0000-0000-000000075907', 'departamento', 'rent', 'Av. Hardening 41', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  ('00000000-0000-0000-0000-000000075942', '00000000-0000-0000-0000-000000075907', 'departamento', 'rent', 'Av. Hardening 42', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  -- Sección 3 (FIX4) — AG5: 1 like + 1 save (updated_at)
  ('00000000-0000-0000-0000-000000075943', '00000000-0000-0000-0000-000000075909', 'departamento', 'rent', 'Av. Hardening 43', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  ('00000000-0000-0000-0000-000000075945', '00000000-0000-0000-0000-000000075909', 'departamento', 'rent', 'Av. Hardening 45', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  -- Sección 4 bloque 1 (FIX1, tibio=string) — AG6
  ('00000000-0000-0000-0000-000000075950', '00000000-0000-0000-0000-000000075911', 'departamento', 'rent', 'Av. Hardening 50', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  ('00000000-0000-0000-0000-000000075952', '00000000-0000-0000-0000-000000075911', 'departamento', 'rent', 'Av. Hardening 52', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  -- Sección 4 bloque 2 (FIX1, caliente=jsonb null) — AG7: 3 saves
  ('00000000-0000-0000-0000-000000075953', '00000000-0000-0000-0000-000000075913', 'departamento', 'rent', 'Av. Hardening 53', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  ('00000000-0000-0000-0000-000000075954', '00000000-0000-0000-0000-000000075913', 'departamento', 'rent', 'Av. Hardening 54', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  ('00000000-0000-0000-0000-000000075955', '00000000-0000-0000-0000-000000075913', 'departamento', 'rent', 'Av. Hardening 55', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  -- Sección 4 bloque 3 (FIX1, ambas=objeto) — AG8
  ('00000000-0000-0000-0000-000000075956', '00000000-0000-0000-0000-000000075915', 'departamento', 'rent', 'Av. Hardening 56', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active'),
  ('00000000-0000-0000-0000-000000075958', '00000000-0000-0000-0000-000000075915', 'departamento', 'rent', 'Av. Hardening 58', extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography, 11000, 'active');

insert into public.property_videos (id, property_id, status, position) values
  ('00000000-0000-0000-0000-000000075933', '00000000-0000-0000-0000-000000075932', 'uploading', 1), -- sección 1, like 1
  ('00000000-0000-0000-0000-000000075935', '00000000-0000-0000-0000-000000075934', 'uploading', 1), -- sección 1, like 2
  ('00000000-0000-0000-0000-000000075944', '00000000-0000-0000-0000-000000075943', 'uploading', 1), -- sección 3, AG5 like
  ('00000000-0000-0000-0000-000000075951', '00000000-0000-0000-0000-000000075950', 'uploading', 1), -- sección 4 bloque 1, AG6 like
  ('00000000-0000-0000-0000-000000075957', '00000000-0000-0000-0000-000000075956', 'uploading', 1); -- sección 4 bloque 3, AG8 like

-- Helper de nombres cortos vía CTE no aplica en pgTAP -- se referencian los UUIDs literales
-- directo dentro de cada bloque, comentando qué representa cada uno (mismo estilo 29_*).

-- ════════════════════════════════════════════════════════════════════════════
-- 1) FIX5 — defaults sanos (10/20) SIN ninguna fila en app_config: contacto solo ya es
--    tibio; contacto+2 guardados+2 likes = 20 = caliente (el ejemplo exacto del PRD).
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$
  do $do$
  declare v_score int; declare v_level text;
  begin
    -- LEAD1 = AG1(...075901) + U1(...075902)
    insert into public.leads (id, agent_id, user_id, status) values
      ('00000000-0000-0000-0000-000000075920', '00000000-0000-0000-0000-000000075901', '00000000-0000-0000-0000-000000075902', 'whatsapp_opened');

    select score, level::text into v_score, v_level from public.leads where id = '00000000-0000-0000-0000-000000075920';
    if v_score is distinct from 10 or v_level is distinct from 'tibio' then
      raise exception 'sin filas en app_config el fallback tibio debe ser 10 (contacto solo ya es tibio); esperado score=10,level=tibio; fue score=%,level=%', v_score, v_level;
    end if;

    insert into public.saves (user_id, property_id) values
      ('00000000-0000-0000-0000-000000075902', '00000000-0000-0000-0000-000000075930'),
      ('00000000-0000-0000-0000-000000075902', '00000000-0000-0000-0000-000000075931');
    insert into public.likes (user_id, property_video_id, property_id) values
      ('00000000-0000-0000-0000-000000075902', '00000000-0000-0000-0000-000000075933', '00000000-0000-0000-0000-000000075932');

    select score, level::text into v_score, v_level from public.leads where id = '00000000-0000-0000-0000-000000075920';
    if v_score is distinct from 19 or v_level is distinct from 'tibio' then
      raise exception 'esperado score=19 (10+4*2+1),level=tibio (19<20 fallback caliente); fue score=%,level=%', v_score, v_level;
    end if;

    insert into public.likes (user_id, property_video_id, property_id) values
      ('00000000-0000-0000-0000-000000075902', '00000000-0000-0000-0000-000000075935', '00000000-0000-0000-0000-000000075934');

    select score, level::text into v_score, v_level from public.leads where id = '00000000-0000-0000-0000-000000075920';
    if v_score is distinct from 20 or v_level is distinct from 'caliente' then
      raise exception 'esperado score=20,level=caliente (fallback caliente=20: contacto+2guardados+2likes=20, el ejemplo del PRD); fue score=%,level=%', v_score, v_level;
    end if;
  end
  $do$;
  $$,
  'FIX5_fallback_10_20_contacto_solo_es_tibio_y_contacto_mas_2_guardados_mas_2_likes_es_caliente'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) FIX3 — un INSERT (no solo UPDATE) de un umbral recalcula leads existentes de
--    inmediato; un DELETE también (vuelve al fallback).
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$
  do $do$
  declare v_level text;
  begin
    -- LEAD2 = AG2(...075903) + U2(...075904), sin ninguna fila en app_config (estado real
    -- de producción hoy).
    insert into public.leads (id, agent_id, user_id, status) values
      ('00000000-0000-0000-0000-000000075921', '00000000-0000-0000-0000-000000075903', '00000000-0000-0000-0000-000000075904', 'whatsapp_opened');

    select level::text into v_level from public.leads where id = '00000000-0000-0000-0000-000000075921';
    if v_level is distinct from 'tibio' then
      raise exception 'setup: esperado tibio (fallback tibio=10, score=10), fue %', v_level;
    end if;

    insert into public.app_config (key, value) values ('lead_score_threshold_caliente', '8'::jsonb);
    select level::text into v_level from public.leads where id = '00000000-0000-0000-0000-000000075921';
    if v_level is distinct from 'caliente' then
      raise exception 'un INSERT (no solo un UPDATE) de un umbral debe recalcular leads existentes de inmediato; esperado caliente (score10>=8), fue %', v_level;
    end if;

    delete from public.app_config where key = 'lead_score_threshold_caliente';
    select level::text into v_level from public.leads where id = '00000000-0000-0000-0000-000000075921';
    if v_level is distinct from 'tibio' then
      raise exception 'un DELETE de un umbral debe recalcular leads existentes de inmediato (vuelve al fallback 10/20); esperado tibio, fue %', v_level;
    end if;
  end
  $do$;
  $$,
  'FIX3_insert_y_delete_de_un_umbral_recalculan_leads_existentes_no_solo_update'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) FIX4(a) — dar like/guardar NO debe tocar leads.updated_at (reordenaría el CRM de las
--    apps v1.0.3, que ordenan por updated_at DESC). Contraste: un UPDATE legítimo (status)
--    SÍ debe seguir tocando updated_at -- el fix acota el trigger, no lo apaga.
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$
  do $do$
  declare v_score int; declare v_updated timestamptz;
  begin
    -- LEAD5 = AG5(...075909) + U5(...075910)
    insert into public.leads (id, agent_id, user_id, status) values
      ('00000000-0000-0000-0000-000000075924', '00000000-0000-0000-0000-000000075909', '00000000-0000-0000-0000-000000075910', 'whatsapp_opened');

    -- Backdatear: now() esta congelado durante toda la transaccion del archivo, comparar
    -- contra now() directo no discriminaria nada (ver header). Este UPDATE no toca ninguna
    -- columna de la lista nueva del trigger -> no debe disparar set_updated_at.
    update public.leads set updated_at = '2020-01-01T00:00:00Z'::timestamptz
      where id = '00000000-0000-0000-0000-000000075924';

    insert into public.likes (user_id, property_video_id, property_id) values
      ('00000000-0000-0000-0000-000000075910', '00000000-0000-0000-0000-000000075944', '00000000-0000-0000-0000-000000075943');
    select score, updated_at into v_score, v_updated from public.leads where id = '00000000-0000-0000-0000-000000075924';
    if v_score is distinct from 11 then
      raise exception 'esperado score=11 tras el like, fue %', v_score;
    end if;
    if v_updated is distinct from '2020-01-01T00:00:00Z'::timestamptz then
      raise exception 'dar like NO debe tocar leads.updated_at (reordenaria el CRM de v1.0.3); quedo en %', v_updated;
    end if;

    insert into public.saves (user_id, property_id) values
      ('00000000-0000-0000-0000-000000075910', '00000000-0000-0000-0000-000000075945');
    select score, updated_at into v_score, v_updated from public.leads where id = '00000000-0000-0000-0000-000000075924';
    if v_score is distinct from 15 then
      raise exception 'esperado score=15 tras el guardado, fue %', v_score;
    end if;
    if v_updated is distinct from '2020-01-01T00:00:00Z'::timestamptz then
      raise exception 'guardar NO debe tocar leads.updated_at; quedo en %', v_updated;
    end if;

    -- Contraste: un UPDATE legitimo (status, lo que hace update-lead-status) SI debe tocar
    -- updated_at -- el fix acota el trigger a columnas "humanas", no lo apaga entero.
    update public.leads set status = 'interested' where id = '00000000-0000-0000-0000-000000075924';
    select updated_at into v_updated from public.leads where id = '00000000-0000-0000-0000-000000075924';
    if v_updated is not distinct from '2020-01-01T00:00:00Z'::timestamptz then
      raise exception 'un UPDATE legitimo de status SI debe actualizar updated_at; se quedo en %', v_updated;
    end if;
  end
  $do$;
  $$,
  'FIX4a_like_y_guardado_no_tocan_updated_at_pero_un_update_legitimo_de_status_si'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) FIX4(b) — el recompute por recalibración de umbral queda ACOTADO a las filas cuyo
--    nivel de verdad cambia (verificado con `ctid`: cualquier UPDATE que matchee la fila
--    le asigna una ctid nueva, sin importar el valor de las columnas) y tampoco toca
--    updated_at.
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$
  do $do$
  declare
    v_level text;
    v_l3_ctid_before tid; v_l3_ctid_after tid;
    v_l4_ctid_before tid; v_l4_ctid_after tid;
    v_l3_updated timestamptz; v_l4_updated timestamptz;
  begin
    -- LEAD3 = AG3(...075905)+U3(...075906): score=10, se queda en tibio (no afectada).
    insert into public.leads (id, agent_id, user_id, status) values
      ('00000000-0000-0000-0000-000000075922', '00000000-0000-0000-0000-000000075905', '00000000-0000-0000-0000-000000075906', 'whatsapp_opened');
    -- LEAD4 = AG4(...075907)+U4(...075908): score=10+4*3=22, cruza de caliente a tibio.
    insert into public.leads (id, agent_id, user_id, status) values
      ('00000000-0000-0000-0000-000000075923', '00000000-0000-0000-0000-000000075907', '00000000-0000-0000-0000-000000075908', 'whatsapp_opened');
    insert into public.saves (user_id, property_id) values
      ('00000000-0000-0000-0000-000000075908', '00000000-0000-0000-0000-000000075940'),
      ('00000000-0000-0000-0000-000000075908', '00000000-0000-0000-0000-000000075941'),
      ('00000000-0000-0000-0000-000000075908', '00000000-0000-0000-0000-000000075942');

    update public.leads set updated_at = '2020-01-01T00:00:00Z'::timestamptz
      where id in ('00000000-0000-0000-0000-000000075922', '00000000-0000-0000-0000-000000075923');

    insert into public.app_config (key, value) values
      ('lead_score_threshold_tibio', '5'::jsonb),
      ('lead_score_threshold_caliente', '20'::jsonb);

    select level::text into v_level from public.leads where id = '00000000-0000-0000-0000-000000075922';
    if v_level is distinct from 'tibio' then
      raise exception 'setup L3 esperado tibio (score10, tibio=5<=10<20), fue %', v_level;
    end if;
    select level::text into v_level from public.leads where id = '00000000-0000-0000-0000-000000075923';
    if v_level is distinct from 'caliente' then
      raise exception 'setup L4 esperado caliente (score22>=20), fue %', v_level;
    end if;

    select ctid into v_l3_ctid_before from public.leads where id = '00000000-0000-0000-0000-000000075922';
    select ctid into v_l4_ctid_before from public.leads where id = '00000000-0000-0000-0000-000000075923';

    -- Recalibración: sube el umbral caliente de 20 a 30. L4 (score22) cruza a tibio; L3
    -- (score10) no cambia de nivel -- el UPDATE del recompute NO debe tocar su fila.
    update public.app_config set value = '30'::jsonb where key = 'lead_score_threshold_caliente';

    select level::text, updated_at into v_level, v_l4_updated from public.leads where id = '00000000-0000-0000-0000-000000075923';
    if v_level is distinct from 'tibio' then
      raise exception 'tras subir el umbral caliente a 30, L4 (score22) debe bajar a tibio; fue %', v_level;
    end if;
    if v_l4_updated is distinct from '2020-01-01T00:00:00Z'::timestamptz then
      raise exception 'L4 cambio de nivel pero updated_at NO debe tocarse; quedo en %', v_l4_updated;
    end if;
    select ctid into v_l4_ctid_after from public.leads where id = '00000000-0000-0000-0000-000000075923';
    if v_l4_ctid_after is not distinct from v_l4_ctid_before then
      raise exception 'L4 SI debia ser tocada por el recompute (su nivel cambio) pero su ctid no cambio';
    end if;

    select level::text, updated_at into v_level, v_l3_updated from public.leads where id = '00000000-0000-0000-0000-000000075922';
    if v_level is distinct from 'tibio' then
      raise exception 'L3 debe seguir en tibio tras la recalibracion (su nivel no cambia); fue %', v_level;
    end if;
    if v_l3_updated is distinct from '2020-01-01T00:00:00Z'::timestamptz then
      raise exception 'L3 no debia tocarse en absoluto, pero su updated_at cambio a %', v_l3_updated;
    end if;
    select ctid into v_l3_ctid_after from public.leads where id = '00000000-0000-0000-0000-000000075922';
    if v_l3_ctid_after is distinct from v_l3_ctid_before then
      raise exception 'L3 NO debia ser tocada por el recompute (su nivel no cambio) pero su ctid cambio -- el UPDATE del recompute no esta acotado a las filas que de verdad cambian';
    end if;
  end
  $do$;
  $$,
  'FIX4b_recompute_por_recalibracion_solo_toca_las_filas_cuyo_nivel_realmente_cambia'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) FIX1 — bloque 1: valor basura STRING en tibio, caliente ausente. Crear lead / dar
--    like / guardar siguen funcionando; el nivel cae al fallback.
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$
  do $do$
  declare v_score int; declare v_level text;
  begin
    delete from public.app_config where key in ('lead_score_threshold_tibio', 'lead_score_threshold_caliente');
    insert into public.app_config (key, value) values ('lead_score_threshold_tibio', '"20"'::jsonb); -- string, basura

    -- LEAD6 = AG6(...075911)+U6(...075912)
    insert into public.leads (id, agent_id, user_id, status) values
      ('00000000-0000-0000-0000-000000075925', '00000000-0000-0000-0000-000000075911', '00000000-0000-0000-0000-000000075912', 'whatsapp_opened');
    select score, level::text into v_score, v_level from public.leads where id = '00000000-0000-0000-0000-000000075925';
    if v_score is distinct from 10 or v_level is distinct from 'tibio' then
      raise exception 'crear un lead con tibio=basura(string) no debe tronar; nivel debe caer al fallback(10); esperado score=10,level=tibio; fue score=%,level=%', v_score, v_level;
    end if;

    insert into public.likes (user_id, property_video_id, property_id) values
      ('00000000-0000-0000-0000-000000075912', '00000000-0000-0000-0000-000000075951', '00000000-0000-0000-0000-000000075950');
    select score, level::text into v_score, v_level from public.leads where id = '00000000-0000-0000-0000-000000075925';
    if v_score is distinct from 11 or v_level is distinct from 'tibio' then
      raise exception 'dar like con tibio=basura no debe tronar; esperado score=11,level=tibio; fue score=%,level=%', v_score, v_level;
    end if;

    insert into public.saves (user_id, property_id) values
      ('00000000-0000-0000-0000-000000075912', '00000000-0000-0000-0000-000000075952');
    select score, level::text into v_score, v_level from public.leads where id = '00000000-0000-0000-0000-000000075925';
    if v_score is distinct from 15 or v_level is distinct from 'tibio' then
      raise exception 'guardar con tibio=basura no debe tronar; esperado score=15,level=tibio; fue score=%,level=%', v_score, v_level;
    end if;
  end
  $do$;
  $$,
  'FIX1_bloque1_tibio_basura_string_crear_dar_like_y_guardar_siguen_funcionando'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) FIX1 — bloque 2: valor basura JSONB NULL en caliente, tibio ausente. Crear lead /
--    guardar siguen funcionando; el nivel cae al fallback (incluye cruzar a caliente vía
--    el fallback, no vía el valor basura).
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$
  do $do$
  declare v_score int; declare v_level text;
  begin
    delete from public.app_config where key in ('lead_score_threshold_tibio', 'lead_score_threshold_caliente');
    insert into public.app_config (key, value) values ('lead_score_threshold_caliente', 'null'::jsonb); -- jsonb null, basura

    -- LEAD7 = AG7(...075913)+U7(...075914)
    insert into public.leads (id, agent_id, user_id, status) values
      ('00000000-0000-0000-0000-000000075926', '00000000-0000-0000-0000-000000075913', '00000000-0000-0000-0000-000000075914', 'whatsapp_opened');
    select score, level::text into v_score, v_level from public.leads where id = '00000000-0000-0000-0000-000000075926';
    if v_score is distinct from 10 or v_level is distinct from 'tibio' then
      raise exception 'crear un lead con caliente=basura(jsonb null) no debe tronar; esperado score=10,level=tibio (fallback tibio=10); fue score=%,level=%', v_score, v_level;
    end if;

    insert into public.saves (user_id, property_id) values
      ('00000000-0000-0000-0000-000000075914', '00000000-0000-0000-0000-000000075953'),
      ('00000000-0000-0000-0000-000000075914', '00000000-0000-0000-0000-000000075954'),
      ('00000000-0000-0000-0000-000000075914', '00000000-0000-0000-0000-000000075955');
    select score, level::text into v_score, v_level from public.leads where id = '00000000-0000-0000-0000-000000075926';
    if v_score is distinct from 22 or v_level is distinct from 'caliente' then
      raise exception 'guardar 3 veces con caliente=basura no debe tronar y el nivel debe usar el fallback(20) para cruzar a caliente; esperado score=22,level=caliente; fue score=%,level=%', v_score, v_level;
    end if;
  end
  $do$;
  $$,
  'FIX1_bloque2_caliente_basura_jsonb_null_crear_y_guardar_siguen_funcionando_cruzan_al_fallback'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) FIX1 — bloque 3: valor basura OBJETO en AMBAS claves simultáneamente (peor caso).
--    Crear lead / dar like / guardar siguen funcionando con los 2 fallbacks a la vez.
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$
  do $do$
  declare v_score int; declare v_level text;
  begin
    delete from public.app_config where key in ('lead_score_threshold_tibio', 'lead_score_threshold_caliente');
    insert into public.app_config (key, value) values
      ('lead_score_threshold_tibio', '{"a":1}'::jsonb),
      ('lead_score_threshold_caliente', '{"b":2}'::jsonb);

    -- LEAD8 = AG8(...075915)+U8(...075916)
    insert into public.leads (id, agent_id, user_id, status) values
      ('00000000-0000-0000-0000-000000075927', '00000000-0000-0000-0000-000000075915', '00000000-0000-0000-0000-000000075916', 'whatsapp_opened');
    select score, level::text into v_score, v_level from public.leads where id = '00000000-0000-0000-0000-000000075927';
    if v_score is distinct from 10 or v_level is distinct from 'tibio' then
      raise exception 'crear un lead con AMBAS claves basura(objeto) no debe tronar; esperado score=10,level=tibio; fue score=%,level=%', v_score, v_level;
    end if;

    insert into public.likes (user_id, property_video_id, property_id) values
      ('00000000-0000-0000-0000-000000075916', '00000000-0000-0000-0000-000000075957', '00000000-0000-0000-0000-000000075956');
    insert into public.saves (user_id, property_id) values
      ('00000000-0000-0000-0000-000000075916', '00000000-0000-0000-0000-000000075958');
    select score, level::text into v_score, v_level from public.leads where id = '00000000-0000-0000-0000-000000075927';
    if v_score is distinct from 15 or v_level is distinct from 'tibio' then
      raise exception 'dar like y guardar con AMBAS claves basura no debe tronar; esperado score=15,level=tibio; fue score=%,level=%', v_score, v_level;
    end if;
  end
  $do$;
  $$,
  'FIX1_bloque3_ambas_claves_basura_objeto_crear_dar_like_y_guardar_siguen_funcionando'
);

select * from finish();
rollback;
