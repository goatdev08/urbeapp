-- Tests pgTAP — takedown de anuncios activos (tarea #210, subtarea 210.1).
-- Extiende el contrato de public.moderate_ad_atomic (#208.1,
-- 64_moderate_ad_atomic_test.sql) y de public.handle_ad_status_change()
-- (#169.2, 48_ads_state_machine_test.sql) con pause/resume/guard de
-- suspensión sobre anuncios ACTIVOS.
-- Ejecutar con:
--   supabase test db supabase/tests/66_ad_takedown_test.sql --local
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL HUECO: moderate_ad_atomic (208.1) solo acepta p_next_status en
-- {'active','rejected'} — un admin puede aprobar/rechazar en revisión, pero
-- NO puede pausar (retirar temporalmente) un anuncio YA activo, ni resumirlo.
-- El trigger handle_ad_status_change YA acepta active→paused y paused→active
-- en su matriz (169.2, D2 "pausar el reloj") — el único bloqueo hoy es el
-- guard de la RPC.
--
-- 🔴 GAP DE SEGURIDAD que este RED también fija: el resume genérico
-- (paused→active) hoy NO distingue "un admin pausó este ad a mano" de "la
-- cascada de suspensión de la organización lo pausó" (columna
-- paused_by_suspension, 169.2). Sin guard, moderar un ad individual
-- (paused→active vía esta RPC) revivirìa un ad cuya organización sigue
-- suspendida — ese caso debe resolverse por la cascada de #211 al reactivar
-- la ORGANIZACIÓN, nunca por un click aislado sobre el ad.
--
-- SEAMS bajo prueba (protocolo test-author, paso 1):
--   1. El contrato PÚBLICO de public.moderate_ad_atomic(uuid, text, text, uuid)
--      — igual firma que 208.1, NO se agrega overload.
--   2. El comportamiento OBSERVABLE de un UPDATE directo sobre
--      public.ads.status vía el trigger handle_ad_status_change (defensa en
--      profundidad, mismo patrón que 48) — el trigger es la ÚNICA autoridad
--      del guard nuevo, no un chequeo que solo viva en la RPC.
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────
-- Happy path:
--   · active→paused vía la RPC: no lanza, estampa paused_at=now(), NO toca
--     ends_at (D2), audita EXACTAMENTE 1 fila (el trigger, sin doble conteo).
--   · paused→active vía la RPC (resume normal, paused_by_suspension=false):
--     no lanza, recorre ends_at exactamente (now()-paused_at), limpia
--     paused_at, audita EXACTAMENTE 1 fila.
-- Edge cases del PRD / reglas no obvias (🔒):
--   · paused→active vía la RPC CON paused_by_suspension=true: LANZA P0001
--     'AD_PAUSED_BY_SUSPENSION' — código NUEVO fijado por este RED. El ad
--     queda EXACTAMENTE como estaba (status, paused_at, paused_by_suspension
--     sin tocar) y SIN fila nueva de auditoría (el guard corta antes del
--     INSERT).
--   · El guard vive en el TRIGGER, no solo en la RPC: un UPDATE directo
--     (bypaseando la RPC, admin identificado vía GUC) sobre un ad
--     paused_by_suspension=true también lanza 'AD_PAUSED_BY_SUSPENSION'.
--   · active→rejected con rejection_reason sigue funcionando vía la RPC
--     (regresión — YA era alcanzable antes de este RED, se fija como
--     contrato aquí porque 64 solo lo cubre desde pending_review).
-- Boundary / error:
--   · p_next_status='expired' sigue INVALID_NEXT_STATUS (el guard se amplía
--     SOLO a 'paused', no a cualquier valor del enum).
--   · pending_review='paused' inexistente en la matriz: RPC no "arregla" lo
--     que el trigger rechaza — INVALID_AD_STATUS_TRANSITION (post-GREEN; hoy
--     el guard de la RPC ni deja llegar ahí).
--   · draft→'active' sigue prohibido vía la RPC (el guard ampliado a
--     'paused' no reabre draft→active).
--   · rejected/expired son terminales: ningún next_status los mueve, ni
--     'paused' ni 'active'.
--   · active→paused sin admin identificado (raw UPDATE, GUC vacío): sigue
--     STATUS_CHANGE_REQUIRES_ADMIN — el guard nuevo no afloja la defensa en
--     profundidad ya vigente en el camino de pausa.
--   · ad_id inexistente con p_next_status='paused': el contrato de
--     "0 filas, sin excepción" (208.1) también aplica al nuevo status.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(27);

-- Captura ÚNICA de "ahora" para todo el archivo — dentro de UNA transacción
-- pgTAP, now() devuelve SIEMPRE el mismo valor (transaction_timestamp()), así
-- que lo que el trigger calcule con now() será IDÉNTICO a lo capturado aquí
-- (mismo patrón que 48_ads_state_machine_test.sql).
create temp table test_now_66 as select now() as v_now;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('21000000-0000-0000-0000-000000000001', 'admin210@urbea.test'),
  ('21000000-0000-0000-0000-000000000002', 'owner210@urbea.test');

update public.users set role = 'admin'
 where id = '21000000-0000-0000-0000-000000000001';

insert into public.agencies (id, name, slug, status, created_by_user_id,
                             can_publish_properties, can_advertise, advertiser_category)
values
  ('21000000-0000-0000-0000-000000000003', 'Inmobiliaria Takedown 210', 'inmo-takedown-210', 'active',
   '21000000-0000-0000-0000-000000000002', false, true, 'seguros');

insert into public.ad_creatives (id, agency_id, status) values
  ('21000000-0000-0000-0000-000000000004', '21000000-0000-0000-0000-000000000003', 'ready');

-- Anuncios, uno por caso — evita que un assert contamine el fixture de otro.
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value,
                        status, starts_at, ends_at) values
  -- 1.1) active→paused (happy path).
  ('21000000-0000-0000-0000-000000001001', '21000000-0000-0000-0000-000000000003',
   '21000000-0000-0000-0000-000000000004', 'Pausable 210', 'external_url', 'https://ejemplo.mx/1001',
   'active', (select v_now - interval '1 day' from test_now_66), (select v_now + interval '20 days' from test_now_66)),
  -- 1.2) active→rejected (regresión, contrato 4).
  ('21000000-0000-0000-0000-000000001005', '21000000-0000-0000-0000-000000000003',
   '21000000-0000-0000-0000-000000000004', 'Rechazable activo 210', 'external_url', 'https://ejemplo.mx/1005',
   'active', (select v_now from test_now_66), (select v_now + interval '20 days' from test_now_66)),
  -- 1.3) active→'expired' vía la RPC: sigue fuera del guard.
  ('21000000-0000-0000-0000-000000001006', '21000000-0000-0000-0000-000000000003',
   '21000000-0000-0000-0000-000000000004', 'Boundary expired 210', 'external_url', 'https://ejemplo.mx/1006',
   'active', (select v_now from test_now_66), (select v_now + interval '20 days' from test_now_66)),
  -- 1.4) draft→'active' vía la RPC: sigue prohibido (guard ampliado no lo reabre).
  ('21000000-0000-0000-0000-000000001007', '21000000-0000-0000-0000-000000000003',
   '21000000-0000-0000-0000-000000000004', 'Boundary draft act 210', 'external_url', 'https://ejemplo.mx/1007',
   'draft', (select v_now from test_now_66), (select v_now + interval '20 days' from test_now_66)),
  -- 1.5) draft→'paused' vía la RPC: fuera de la matriz del trigger.
  ('21000000-0000-0000-0000-000000001008', '21000000-0000-0000-0000-000000000003',
   '21000000-0000-0000-0000-000000000004', 'Boundary draft pause 210', 'external_url', 'https://ejemplo.mx/1008',
   'draft', (select v_now from test_now_66), (select v_now + interval '20 days' from test_now_66)),
  -- 1.6) active→paused SIN admin identificado (raw UPDATE, defensa en profundidad).
  ('21000000-0000-0000-0000-000000001010', '21000000-0000-0000-0000-000000000003',
   '21000000-0000-0000-0000-000000000004', 'Pausar sin admin 210', 'external_url', 'https://ejemplo.mx/1010',
   'active', (select v_now from test_now_66), (select v_now + interval '20 days' from test_now_66));

-- Anuncios terminales/pausados: sembrados DIRECTO en su status de partida
-- (el INSERT no dispara el trigger BEFORE UPDATE).
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value,
                        status, rejection_reason, starts_at, ends_at) values
  ('21000000-0000-0000-0000-000000001009', '21000000-0000-0000-0000-000000000003',
   '21000000-0000-0000-0000-000000000004', 'Terminal rechazado 210', 'external_url', 'https://ejemplo.mx/1009',
   'rejected', 'motivo previo', (select v_now - interval '10 days' from test_now_66),
   (select v_now + interval '10 days' from test_now_66)),
  ('21000000-0000-0000-0000-00000000100a', '21000000-0000-0000-0000-000000000003',
   '21000000-0000-0000-0000-000000000004', 'Terminal expirado 210', 'external_url', 'https://ejemplo.mx/100a',
   'expired', null, (select v_now - interval '60 days' from test_now_66),
   (select v_now - interval '30 days' from test_now_66));

insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value,
                        status, starts_at, ends_at, paused_at, paused_by_suspension) values
  -- 1.2) paused→active, resume normal (paused_by_suspension=false).
  ('21000000-0000-0000-0000-000000001002', '21000000-0000-0000-0000-000000000003',
   '21000000-0000-0000-0000-000000000004', 'Resumible normal 210', 'external_url', 'https://ejemplo.mx/1002',
   'paused', (select v_now - interval '10 days' from test_now_66), (select v_now + interval '20 days' from test_now_66),
   (select v_now - interval '5 days' from test_now_66), false),
  -- 1.3) paused→active vía RPC con paused_by_suspension=true: guard nuevo.
  ('21000000-0000-0000-0000-000000001003', '21000000-0000-0000-0000-000000000003',
   '21000000-0000-0000-0000-000000000004', 'Pausado por suspension RPC 210', 'external_url', 'https://ejemplo.mx/1003',
   'paused', (select v_now - interval '10 days' from test_now_66), (select v_now + interval '20 days' from test_now_66),
   (select v_now - interval '2 days' from test_now_66), true),
  -- 1.4) igual, pero ejercitado por UPDATE directo (trigger es la autoridad, no solo la RPC).
  ('21000000-0000-0000-0000-000000001004', '21000000-0000-0000-0000-000000000003',
   '21000000-0000-0000-0000-000000000004', 'Pausado por suspension trigger 210', 'external_url', 'https://ejemplo.mx/1004',
   'paused', (select v_now - interval '10 days' from test_now_66), (select v_now + interval '20 days' from test_now_66),
   (select v_now - interval '2 days' from test_now_66), true);

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Happy path — active→paused vía la RPC (contrato 1).
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$ select public.moderate_ad_atomic(
       '21000000-0000-0000-0000-000000001001'::uuid, 'paused', null,
       '21000000-0000-0000-0000-000000000001'::uuid) $$,
  'TKD1: pausar un anuncio active vía la RPC ya NO lanza INVALID_NEXT_STATUS'
);

select is(
  (select status::text from public.ads where id = '21000000-0000-0000-0000-000000001001'),
  'paused',
  'TKD2: el anuncio quedó paused'
);

select is(
  (select paused_at from public.ads where id = '21000000-0000-0000-0000-000000001001'),
  (select v_now from test_now_66),
  'TKD3: paused_at quedó estampado exactamente en now() (D2)'
);

select is(
  (select ends_at from public.ads where id = '21000000-0000-0000-0000-000000001001'),
  (select v_now + interval '20 days' from test_now_66),
  'TKD4: ends_at NO cambió al pausar — se conservan los días restantes (D2)'
);

select is(
  (select count(*) from public.admin_actions
    where entity_type = 'ad' and entity_id = '21000000-0000-0000-0000-000000001001'
      and action_type = 'change_ad_status'),
  1::bigint,
  'TKD5: EXACTAMENTE una fila de auditoría para el pause (el trigger la escribe, la RPC no la duplica)'
);

select is(
  (select admin_id from public.admin_actions
    where entity_type = 'ad' and entity_id = '21000000-0000-0000-0000-000000001001'
      and action_type = 'change_ad_status' limit 1),
  '21000000-0000-0000-0000-000000000001'::uuid,
  'TKD6: la auditoría del pause registra al admin que pasó la RPC'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Happy path — paused→active vía la RPC, resume normal (contrato 2).
--    YA alcanzable hoy (el guard de la RPC ya admite 'active') — se fija
--    aquí como contrato explícito, junto al guard nuevo de la sección 3.
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$ select public.moderate_ad_atomic(
       '21000000-0000-0000-0000-000000001002'::uuid, 'active', null,
       '21000000-0000-0000-0000-000000000001'::uuid) $$,
  'TKD7: resumir un anuncio paused (paused_by_suspension=false) vía la RPC no lanza'
);

select is(
  (select status::text from public.ads where id = '21000000-0000-0000-0000-000000001002'),
  'active',
  'TKD8: el anuncio quedó active'
);

select is(
  (select ends_at from public.ads where id = '21000000-0000-0000-0000-000000001002'),
  (select v_now + interval '25 days' from test_now_66),
  'TKD9: ends_at se recorrió EXACTAMENTE los 5 días no consumidos (ends_at + (now()-paused_at))'
);

select is(
  (select paused_at from public.ads where id = '21000000-0000-0000-0000-000000001002'),
  null::timestamptz,
  'TKD10: paused_at vuelve a NULL tras el resume'
);

select is(
  (select count(*) from public.admin_actions
    where entity_type = 'ad' and entity_id = '21000000-0000-0000-0000-000000001002'
      and action_type = 'change_ad_status'),
  1::bigint,
  'TKD11: EXACTAMENTE una fila de auditoría para el resume normal'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Guard nuevo — paused→active CON paused_by_suspension=true (contrato 3).
--    🔴 El caso que #211 (cascada de reactivación de organización) debe
--    resolver — NUNCA un click aislado sobre un ad individual.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 3.1) Vía la RPC ──────────────────────────────────────────────────────────
select throws_ok(
  $$ select public.moderate_ad_atomic(
       '21000000-0000-0000-0000-000000001003'::uuid, 'active', null,
       '21000000-0000-0000-0000-000000000001'::uuid) $$,
  'P0001',
  'AD_PAUSED_BY_SUSPENSION',
  'TKD12: resumir un ad paused_by_suspension=true vía la RPC LANZA AD_PAUSED_BY_SUSPENSION'
);

select is(
  (select status::text from public.ads where id = '21000000-0000-0000-0000-000000001003'),
  'paused',
  'TKD13: tras el intento bloqueado, el anuncio SIGUE paused (no se resucitó)'
);

select is(
  (select paused_by_suspension from public.ads where id = '21000000-0000-0000-0000-000000001003'),
  true,
  'TKD14: paused_by_suspension SIGUE true tras el intento bloqueado'
);

select is(
  (select paused_at from public.ads where id = '21000000-0000-0000-0000-000000001003'),
  (select v_now - interval '2 days' from test_now_66),
  'TKD15: paused_at NO se tocó tras el intento bloqueado'
);

select is(
  (select count(*) from public.admin_actions
    where entity_type = 'ad' and entity_id = '21000000-0000-0000-0000-000000001003'
      and action_type = 'change_ad_status'),
  0::bigint,
  'TKD16: el intento bloqueado NO deja fila de auditoría (el guard corta antes del INSERT)'
);

-- ── 3.2) Vía UPDATE directo — el trigger es la ÚNICA autoridad, no la RPC ──
select set_config('urbea.admin_actor_id', '21000000-0000-0000-0000-000000000001', true);
select throws_ok(
  $$ update public.ads set status = 'active'
      where id = '21000000-0000-0000-0000-000000001004' $$,
  'P0001',
  'AD_PAUSED_BY_SUSPENSION',
  'TKD17: el guard también corre por UPDATE directo — el trigger es la autoridad, no un chequeo solo-RPC'
);

select is(
  (select status::text from public.ads where id = '21000000-0000-0000-0000-000000001004'),
  'paused',
  'TKD18: tras el UPDATE directo bloqueado, el anuncio SIGUE paused'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Regresión — active→rejected con rejection_reason sigue vía la RPC
--    (contrato 4, YA alcanzable antes de este RED desde 'active').
-- ════════════════════════════════════════════════════════════════════════════

select lives_ok(
  $$ select public.moderate_ad_atomic(
       '21000000-0000-0000-0000-000000001005'::uuid, 'rejected', 'Contenido engañoso',
       '21000000-0000-0000-0000-000000000001'::uuid) $$,
  'TKD19: rechazar un anuncio ACTIVO con razón sigue sin lanzar (regresión)'
);

select results_eq(
  $$ select status::text, rejection_reason from public.ads
      where id = '21000000-0000-0000-0000-000000001005' $$,
  $$ values ('rejected', 'Contenido engañoso') $$,
  'TKD20: quedó rejected CON su razón (CHECK ads_rejection_reason_matches_status satisfecho)'
);

select is(
  (select count(*) from public.admin_actions
    where entity_type = 'ad' and entity_id = '21000000-0000-0000-0000-000000001005'
      and action_type = 'change_ad_status'),
  1::bigint,
  'TKD21: EXACTAMENTE una fila de auditoría para el rechazo desde active'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Boundary / error — el guard ampliado NO sobre-permite.
-- ════════════════════════════════════════════════════════════════════════════

-- El guard solo se amplía a 'paused' — cualquier otro valor del enum sigue
-- fuera de {'active','rejected','paused'}.
select throws_ok(
  $$ select public.moderate_ad_atomic(
       '21000000-0000-0000-0000-000000001006'::uuid, 'expired', null,
       '21000000-0000-0000-0000-000000000001'::uuid) $$,
  'P0001',
  'INVALID_NEXT_STATUS',
  'TKD22: p_next_status=expired sigue INVALID_NEXT_STATUS (el guard NO se amplió a todo el enum)'
);

-- El grafo del trigger sigue siendo la única autoridad: la RPC no "arregla"
-- lo que el trigger rechaza. draft→active sigue prohibido.
select throws_ok(
  $$ select public.moderate_ad_atomic(
       '21000000-0000-0000-0000-000000001007'::uuid, 'active', null,
       '21000000-0000-0000-0000-000000000001'::uuid) $$,
  'P0001',
  'INVALID_AD_STATUS_TRANSITION',
  'TKD23: draft→active vía la RPC sigue prohibido (regresión: ampliar el guard a paused no reabre esto)'
);

-- draft→paused: fuera de la matriz del trigger. Tras el GREEN, el guard de
-- la RPC deja pasar 'paused' y es el TRIGGER quien lo rechaza.
select throws_ok(
  $$ select public.moderate_ad_atomic(
       '21000000-0000-0000-0000-000000001008'::uuid, 'paused', null,
       '21000000-0000-0000-0000-000000000001'::uuid) $$,
  'P0001',
  'INVALID_AD_STATUS_TRANSITION',
  'TKD24: draft→paused vía la RPC lo rechaza el TRIGGER (INVALID_AD_STATUS_TRANSITION), no la RPC'
);

-- rejected es terminal: ni siquiera 'paused' lo mueve.
select throws_ok(
  $$ select public.moderate_ad_atomic(
       '21000000-0000-0000-0000-000000001009'::uuid, 'paused', null,
       '21000000-0000-0000-0000-000000000001'::uuid) $$,
  'P0001',
  'INVALID_AD_STATUS_TRANSITION',
  'TKD25: rejected sigue TERMINAL — paused no lo mueve'
);

-- expired es terminal: 'active' tampoco lo mueve (regresión, ya vigente).
select throws_ok(
  $$ select public.moderate_ad_atomic(
       '21000000-0000-0000-0000-00000000100a'::uuid, 'active', null,
       '21000000-0000-0000-0000-000000000001'::uuid) $$,
  'P0001',
  'INVALID_AD_STATUS_TRANSITION',
  'TKD26: expired sigue TERMINAL — active no lo mueve (regresión)'
);

-- El guard nuevo NO afloja la defensa en profundidad: pausar sin admin
-- identificado (raw UPDATE, GUC vacío) sigue exigiendo un admin real.
select set_config('urbea.admin_actor_id', '', true);
select throws_ok(
  $$ update public.ads set status = 'paused'
      where id = '21000000-0000-0000-0000-000000001010' $$,
  'P0001',
  'STATUS_CHANGE_REQUIRES_ADMIN',
  'TKD27: active→paused SIN admin identificado sigue exigiendo admin (defensa en profundidad intacta)'
);

select * from finish();
rollback;
