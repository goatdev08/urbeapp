-- Tests pgTAP — 4 escritores admin (subtarea #219.1, tarea 219 "panel admin
-- centro operativo", exploración 041): ads→pending_review, agencies→
-- pending_approval, agent_applications→pending, property_revisions→pending
-- (incluye re-envío needs_changes→pending) insertan aviso en
-- public.notifications hacia TODOS los users.role='admin'. + purga a 30 días
-- (retención prometida por 20260604000007:70) vía pg_cron.
-- Ejecutar con: supabase test db supabase/tests/71_notify_admin_events_test.sql --local
-- (CLI global de brew, NUNCA npx supabase). Corre como superusuario dentro de
-- una transacción revertida (no persiste) — el superusuario bypassa RLS, así
-- que las 4 escrituras fuente (ads/agencies/agent_applications/
-- property_revisions) se ejercitan directo, sin impersonación JWT: el seam
-- bajo prueba es el efecto OBSERVABLE del escritor sobre public.notifications,
-- no la autorización de quién puede tocar la tabla fuente (eso ya lo cubren
-- 25/37/48_*).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: el comportamiento OBSERVABLE de un INSERT/UPDATE real
-- sobre ads/agencies/agent_applications/property_revisions — y las FILAS que
-- deja (o no deja) en public.notifications. NUNCA internals: no se valida el
-- nombre de ninguna función/trigger de escritura por catálogo (a diferencia
-- de la función de purga, que SÍ es un seam público invocable — mismo
-- criterio que public.purge_ad_impressions, 20260817000002).
--
-- SUT (AÚN NO EXISTE — RED 2026-08-25): una migración GREEN debe crear, en la
-- MISMA transacción del evento (sin try/catch — DECISIÓN ABRAHAM 2026-08-25,
-- fallo del escritor = BLOQUEANTE, ver sección 7 abajo):
--   (a) trigger AFTER UPDATE en public.ads, WHEN (old.status = 'draft' and
--       new.status = 'pending_review') — SOLO esta transición dispara
--       (contrato explícito del orquestador: "otras transiciones de ads NO
--       disparan", incluida active→pending_review, la democión de SISTEMA de
--       #192/20260818000001 — NO se toca esa función).
--   (b) trigger AFTER INSERT en public.agencies, WHEN (new.status =
--       'pending_approval').
--   (c) trigger AFTER INSERT en public.agent_applications, WHEN (new.status =
--       'pending').
--   (d) trigger(s) en public.property_revisions: AFTER INSERT WHEN
--       (new.status = 'pending') Y AFTER UPDATE WHEN (old.status =
--       'needs_changes' and new.status = 'pending') — el re-envío SÍ genera
--       un aviso NUEVO por admin (decisión recomendada por el orquestador,
--       fijada aquí: sección 6) — el ancla NO puede ser solo (user_id,
--       related_entity_id, type) para este evento, necesita un
--       diferenciador propio (mismo principio que ends_at en
--       notify_ads_expiring_soon, 20260822000001) o el segundo envío se
--       perdería en silencio.
--       🔴 PISTA FALSA (hallazgo del guardian post-GREEN, hardening
--       2026-08-25): la frase de arriba predecía que el GREEN necesitaría un
--       índice con un diferenciador extra (tipo ends_at). El GREEN real
--       (20260825000001) resolvió esto MÁS simple y correcto: admin_
--       revision_pending NO lleva NINGÚN índice de idempotencia — un trigger
--       de FILA (no un job batch como notify_ads_expiring_soon) solo se
--       dispara una vez por INSERT/UPDATE real, así que no existe ninguna
--       forma legítima de que se re-dispare para el MISMO evento; proteger
--       contra eso sería YAGNI. El contrato que este archivo fija es
--       puramente OBSERVABLE — "nunca se deduplica" (sección 5,
--       REV9-REV11) — sin prescribir el mecanismo; el guardian confirmó con
--       el mutante (g) que ese contrato queda cazado igual sin necesidad de
--       un índice/diferenciador. Dejar esta nota para que nadie reintroduzca
--       por error un índice de idempotencia en este evento leyendo solo la
--       frase original de arriba.
--   Los 4 escritores insertan hacia TODOS los public.users.role='admin' (sin
--   relación con agency_members — es el admin de PLATAFORMA, distinto del
--   owner/admin de organización de notify_ads_expiring_soon). 0 admins ⇒ el
--   evento fuente NO falla, 0 avisos (sección 1).
--   (e) public.purge_notifications() returns void, security definer, set
--       search_path='' (patrón EXACTO de purge_ad_impressions,
--       20260817000002): borra de notifications lo que rebasa 30 días por
--       created_at (frontera `<` estricta — exactamente 30 días se CONSERVA,
--       31 se BORRA — mismo criterio que purge_ad_impressions/90d), sin
--       importar read_at ni deleted_at. Programada vía pg_cron
--       (jobname='purge_notifications_daily', horario DISTINTO de
--       rollup_ad_impressions_monthly_daily 0 8, purge_ad_impressions_daily
--       0 9 y notify_ads_expiring_soon_daily 0 15 UTC — no competir I/O).
--
-- ── D-KEY/D-TYPE/D-LINK (decisiones de diseño del test-author, fijadas aquí,
--    catálogo v1 docs/PRD.md §22.4) ──────────────────────────────────────────
--   admin_ad_pending          → deep_link '/admin/ads'      · related_entity_type 'ad'
--   admin_revision_pending    → deep_link '/admin/revisions'· related_entity_type 'property_revision'
--   admin_agent_application   → deep_link '/admin/requests' · related_entity_type 'agent_application'
--   admin_agency_pending      → deep_link '/admin/requests' · related_entity_type 'agency'
--   🔴 HISTORIA DE ESTOS 2 DEEP LINKS (leer antes de tocarlos):
--   (1) La fijación original de este RED (2026-08-25, #219.1) puso
--       '/admin/requests', pero esa ruta NO existía todavía
--       (mobile/app/admin/ solo tenía index/ads/agencies/revisions) — era una
--       expectativa equivocada del test-author, no una implementación
--       debilitada.
--   (2) #223.2 (review del PR #106) la bajó a '/admin' como destino INTERINO,
--       anotando "#221 (M4 solicitudes) re-apuntará a '/admin/requests'
--       cuando esa pantalla exista".
--   (3) 2026-09-01, #221: la pantalla EXISTE (cola unificada de M4), así que
--       este archivo vuelve a exigir '/admin/requests' y la migración
--       20260902100004 re-apunta los 2 writers + hace backfill de los avisos
--       NO LEÍDOS. Ver AGY4/APP4 abajo.
--   data lleva SIEMPRE 'ad_title' (ads) / 'address' (revisiones) /
--   'application_type' (solicitudes) / 'agency_name' (inmobiliarias) — llaves
--   snake_case sin colisionar con las columnas de la fila (title/body son del
--   AVISO, no de la entidad).
--
-- ── D-ANCLA (decisión de diseño del test-author) — índice único parcial por
--    tipo sobre (user_id, related_entity_id, type) para los 3 eventos de
--    disparo ÚNICO (admin_ad_pending/admin_agency_pending/
--    admin_agent_application: cada entidad solo puede nacer/transicionar UNA
--    vez en la vida hacia el estado que dispara el aviso — la matriz de ads
--    no permite volver a draft, agencies/agent_applications solo nacen una
--    vez). admin_revision_pending NECESITA un diferenciador adicional (el
--    re-envío es un contrato explícito de "SÍ debe avisar de nuevo") — ver
--    sección 6, no se fija aquí la columna exacta del diferenciador (detalle
--    de implementación del GREEN), solo el comportamiento OBSERVABLE: el
--    conteo de avisos para la MISMA revisión crece con cada re-envío, nunca
--    se deduplica. Sección 5 ejercita el ancla de los 3 eventos de disparo
--    único con INSERTs crudos directos contra notifications (técnica
--    equivalente a 01_constraints_test.sql: prueba el INVARIANTE de esquema
--    que la migración debe dejar, no el trigger en sí) — incluye que un aviso
--    BORRADO (deleted_at no nulo) SIGUE anclando (decisión de producto ya
--    tomada en 20260822000001 para ad_expiring_soon, aplicada aquí igual: el
--    índice es parcial SOLO por `type`, nunca filtra por deleted_at).
--
-- ── 🔴 Semántica BLOQUEANTE (DECISIÓN ABRAHAM 2026-08-25) — sección 7 ────────
-- El INSERT hacia notifications vive en la MISMA transacción del evento SIN
-- bloque EXCEPTION: si el escritor truena, el evento entero se aborta (ni la
-- fuente se escribe, ni el aviso). Ejercitado con fault-injection (trigger
-- "veneno" BEFORE INSERT en public.notifications, patrón EXACTO de
-- 48_ads_state_machine_test.sql sección 4 — DROPEADO inmediatamente después
-- de los asserts que lo necesitan) sobre 2 caminos representativos: un evento
-- por INSERT (agencies) y uno por UPDATE (ads) — no se repite x4 porque los 4
-- escritores comparten el MISMO mecanismo (un INSERT hacia la MISMA tabla
-- notifications dentro de la MISMA transacción del evento); probar el
-- mecanismo una vez por estilo de disparo (INSERT vs UPDATE) alcanza para
-- discriminar la propiedad "sin try/catch" sin inflar el archivo.
--
-- ── Convención DELTA vs INVARIANTE (heredada de 21/25/27/28/29/30/31/33/37) ──
-- DELTA      = falla HOY por assert real (0 filas donde se esperan N, NULL
--              donde se espera un valor, "no exception" donde se espera una)
--              y debe pasar tras el GREEN con el resultado correcto — 54/70
--              asserts de este archivo son DELTA.
-- INVARIANTE = ya "pasa" hoy (0 admins→0 filas; nadie más recibe; una
--              transición fuera de alcance no dispara; PURGE3/PURGE4
--              sobreviven porque hoy nada se borra) por una razón DISTINTA a
--              la que debe sostenerlo tras el GREEN (hoy: el trigger no
--              existe; después: el trigger existe pero está correctamente
--              gateado / la frontera de purga los conserva a propósito) — 16
--              asserts (FIXTURE_ANCHOR1-3, ZERO1-2, ADS2/ADS10, AGY2/AGY9,
--              APP2/APP9, REV2/REV12/REV13, PURGE3/PURGE4). El guardian debe
--              re-verificar tras GREEN que siguen en verde por la razón
--              correcta, no por ausencia del SUT.
--
-- ── Estrategia RED sin migración-stub ────────────────────────────────────────
-- NINGÚN objeto del SUT existe hoy salvo las tablas fuente (ads/agencies/
-- agent_applications/property_revisions/notifications, todas de migraciones
-- previas). Un INSERT/UPDATE crudo sobre esas tablas NO lanza (no referencia
-- ningún objeto inexistente) — simplemente no dispara ningún trigger nuevo,
-- así que las aserciones de conteo de notifications fallan LIMPIO contra 0
-- filas reales (RED por assert, no por error de sintaxis/catálogo). Los
-- throws_ok que esperan una excepción (ancla del índice, fault-injection)
-- fallan limpio porque HOY nada excepciona (pgTAP captura eso como "not ok",
-- nunca aborta el archivo). La ÚNICA llamada a un objeto que no existe es
-- `select public.purge_notifications()` (sección 8) — va dentro de un bloque
-- `do $$ ... exception when others then ... $$` AUTO-PROTEGIDO (mismo patrón
-- que 63_notify_ads_expiring_soon_test.sql, RUN1/RUN2/RUN3).
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────
-- Sección 1 — 0 admins: el evento fuente (agencies INSERT) NO falla, 0 avisos.
-- Sección 2 — admin_ad_pending: draft→pending_review con 2 admins produce
--   EXACTAMENTE 2 filas (ni agent ni user reciben); contrato de la fila
--   (type/deep_link/related_entity_type/_id/data->>'ad_title'/title/body);
--   active→pending_review (democión de sistema #192) NO dispara.
-- Sección 3 — admin_agency_pending: INSERT con status default (pending_approval)
--   produce 2 filas; contrato de la fila; INSERT con status='active' explícito
--   NO dispara.
-- Sección 4 — admin_agent_application: INSERT con status default (pending)
--   produce 2 filas; contrato de la fila; INSERT con status='approved'
--   explícito NO dispara.
-- Sección 5 — admin_revision_pending: INSERT 'pending' produce 2 filas;
--   contrato de la fila; UPDATE pending→needs_changes NO dispara; UPDATE
--   needs_changes→pending (re-envío) SÍ produce avisos NUEVOS — el conteo
--   crece 2→4→6 en 2 re-envíos sucesivos (nunca deduplicado); INSERT directo
--   en needs_changes NO dispara la rama de alta.
-- Sección 6 — D-ANCLA: para los 3 eventos de disparo único, un INSERT crudo
--   duplicado (mismo user_id/related_entity_id/type) hacia notifications
--   debe ser rechazado por el índice único parcial de la migración GREEN;
--   un aviso ya BORRADO (deleted_at) con la misma llave SIGUE bloqueando un
--   tercer INSERT duplicado (el índice no filtra por deleted_at).
-- Sección 7 — 🔒 BLOQUEANTE: fault-injection sobre agencies (INSERT) y ads
--   (UPDATE) — si el INSERT hacia notifications falla, la transacción entera
--   revierte: la agencia no queda creada / el ad no queda movido / no queda
--   ninguna fila huérfana en admin_actions.
-- Sección 8 — purga 30 días: frontera `<` estricta (30d exactos CONSERVA, 31d
--   BORRA) sin importar read_at/deleted_at; función catalogada (returns void,
--   security definer, search_path vacío); job registrado en cron.job con
--   jobname/schedule/command exactos.
-- Sección 9 — 🔴 hardening post-guardian (2026-08-25, mutante (e) sobreviviente
--   original: quitar `on conflict ... do nothing` del writer de ads NO hacía
--   fallar la suite, porque D-ANCLA solo prueba el índice con INSERTs crudos
--   y cada writer se dispara una sola vez por entidad en las secciones 2-5) —
--   rama de CONFLICTO real de un writer: se pre-inserta a mano un aviso con
--   la MISMA ancla que el writer generaría para CADA admin y luego se
--   dispara el evento real; el evento no debe abortar (a) y el conteo de
--   avisos no debe cambiar — no-op silencioso (b). 2 caminos representativos
--   (ads por UPDATE, agencies por INSERT), mismo criterio de "una vez por
--   estilo de disparo" que la sección 7.
-- Sección 11 — 🔴 defecto (a), tarea #223.2 (nace del code review del PR #106
--   de #219, ANTES del deploy a producción): las 4 funciones notify_admin_*
--   hacen el fan-out con `from public.users u where u.role = 'admin'` SIN
--   `and u.deleted_at is null` — un admin dado de baja sigue en la lista de
--   destinatarios. Se siembra un 3er admin de plataforma CON deleted_at
--   poblado DESPUÉS de que las secciones 2-5/9/10 ya corrieron sus asserts
--   de array exacto (para no invalidar retroactivamente esas fijaciones) y
--   se dispara cada uno de los 4 eventos con una entidad NUEVA: los 2 admins
--   vivos siguen recibiendo el aviso (ya cubierto arriba, no se duplica) y
--   el admin borrado NO debe aparecer — HOY sí aparece (RED).
-- Sección 10 — 🔴 BUG REAL detectado en el smoke E2E de #219.5 (subtarea
--   #219.6): esta suite (secciones 2/9) solo ejercita admin_ad_pending vía la
--   transición UPDATE draft->pending_review. Pero el flujo REAL del wizard de
--   anuncios de un anunciante es la RPC public.create_ad_campaign_atomic
--   (20260820000005, invocada desde mobile/app/(protected)/ads/new/step5.tsx)
--   — esa RPC INSERTa el ad YA NACIDO en pending_review, nunca pasa por
--   draft. El trigger vigente (AFTER UPDATE WHEN old.status='draft' and
--   new.status='pending_review') JAMÁS se dispara para ese camino: en
--   producción, el admin nunca recibe el aviso de una campaña real creada
--   por un anunciante. El camino draft->pending_review (Studio, vía
--   grant_ad_slot_atomic — revoke'd de authenticated) sigue siendo legítimo,
--   su cobertura (sección 2) no se toca.
--   10.1 happy path — se invoca la RPC REAL create_ad_campaign_atomic (vía
--     impersonación JWT, mismo patrón que 60_create_ad_campaign_atomic_
--     test.sql) porque es el seam MÁS fiel al bug: reproduce el camino de
--     producción exacto, no un espejo a mano de las columnas que la RPC
--     escribe. Los 2 admins de plataforma reciben admin_ad_pending con
--     data->>'ad_title' igual al título real de la campaña.
--   10.2 un ad nacido por INSERT crudo en OTRO status ('draft', el que usa
--     grant_ad_slot_atomic) NO dispara — el gate depende del VALOR de
--     status, no de que sea un INSERT contra ads.
--   10.3 el ancla de idempotencia cubre el camino nuevo: (a) tras el happy
--     path de 10.1, un INSERT crudo duplicado con la MISMA llave (user_id,
--     ad_id, type) es rechazado por el índice compartido
--     notifications_admin_ad_pending_anchor_idx (20260825000001) — prueba
--     que las filas que deja el escritor nuevo caen bajo el MISMO índice que
--     ancla el escritor UPDATE existente; (b) un ad DISTINTO que nace
--     pending_review con la ancla YA pre-ocupada por ambos admins no aborta
--     el evento y el conteo de avisos no cambia (no-op silencioso, mismo
--     criterio que la sección 9) — INVARIANTE hoy (nada intenta escribir sin
--     el trigger nuevo), el guardian debe reverificar tras el GREEN que sigue
--     en verde por la razón correcta (on conflict do nothing), no por
--     ausencia del SUT.
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(95);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) 0 admins — el evento fuente NO falla, 0 avisos. DEBE correr ANTES de que
--    exista NINGÚN admin en toda la transacción (por eso va primero, antes de
--    sembrar los admins reusados en el resto del archivo).
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.users where role = 'admin'), 0,
  'FIXTURE_ANCHOR1_cero_admins_en_toda_la_base_al_arrancar_el_archivo'
);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000710901', 'creador_cero_admins_71@urbea.mx');

create temp table result_zero_admins_71 (ok boolean, err_sqlstate text);
do $$
begin
  insert into public.agencies (id, name, slug, status, created_by_user_id) values
    ('00000000-0000-0000-0000-000000710902', 'Agencia Cero Admins 71', 'agencia-cero-admins-71',
     default, '00000000-0000-0000-0000-000000710901');
  insert into result_zero_admins_71 values (true, null);
exception when others then
  insert into result_zero_admins_71 values (false, sqlstate);
end $$;

select is((select ok from result_zero_admins_71), true,
  'ZERO1_0_admins_el_INSERT_de_la_agencia_no_lanza_excepcion');
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710902'),
  0, 'ZERO2_0_admins_0_avisos_generados_sin_error');

-- ════════════════════════════════════════════════════════════════════════════
-- 0) Fixtures globales — 2 admins de PLATAFORMA (reusados por las secciones
--    2-6), 1 usuario regular y 1 agente (nunca deben recibir avisos admin_*).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000710001', 'admin1_71@urbea.mx'),
  ('00000000-0000-0000-0000-000000710002', 'admin2_71@urbea.mx'),
  ('00000000-0000-0000-0000-000000710003', 'user_regular_71@urbea.mx'),
  ('00000000-0000-0000-0000-000000710004', 'agente_71@urbea.mx');

update public.users set role = 'admin'
 where id in ('00000000-0000-0000-0000-000000710001', '00000000-0000-0000-0000-000000710002');
update public.users set role = 'agent'
 where id = '00000000-0000-0000-0000-000000710004';

select is((select count(*)::int from public.users where role = 'admin'), 2,
  'FIXTURE_ANCHOR2_exactamente_2_admins_sembrados_para_el_resto_del_archivo');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) admin_ad_pending — ads: SOLO draft→pending_review dispara.
-- ════════════════════════════════════════════════════════════════════════════

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000710001', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000710011', 'owner_ads_71@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000710012', 'Agencia Notify Admin Ads 71', 'agencia-notify-admin-ads-71',
   'active', '00000000-0000-0000-0000-000000710011');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000000710013', '00000000-0000-0000-0000-000000710012', 'ready');
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000710014', '00000000-0000-0000-0000-000000710012',
   '00000000-0000-0000-0000-000000710013', 'Ad Notify Admin 71', 'phone', '+5213300007101',
   'draft', now() - interval '1 day', now() + interval '30 days');

-- ── 2.1) happy path: draft -> pending_review ────────────────────────────────
update public.ads set status = 'pending_review' where id = '00000000-0000-0000-0000-000000710014';

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710014' and type = 'admin_ad_pending'),
  array[
    '00000000-0000-0000-0000-000000710001'::uuid,
    '00000000-0000-0000-0000-000000710002'::uuid
  ],
  'ADS1_los_2_admins_de_plataforma_y_solo_ellos_reciben_el_aviso_ad_pending'
);
select is(
  (select count(*)::int from public.notifications
    where user_id in ('00000000-0000-0000-0000-000000710003', '00000000-0000-0000-0000-000000710004')
      and related_entity_id = '00000000-0000-0000-0000-000000710014'),
  0, 'ADS2_ni_usuario_regular_ni_agente_reciben_el_aviso'
);

create temp table result_ads_row_71 (
  n_type text, n_deep_link text, n_rel_type text, n_rel_id uuid,
  n_ad_title text, n_title text, n_body text
);
insert into result_ads_row_71
  select type, deep_link, related_entity_type, related_entity_id,
    data->>'ad_title', title, body
  from public.notifications
  where user_id = '00000000-0000-0000-0000-000000710001'
    and related_entity_id = '00000000-0000-0000-0000-000000710014'
    and type = 'admin_ad_pending';

select is((select n_type from result_ads_row_71), 'admin_ad_pending', 'ADS3_type_admin_ad_pending');
select is((select n_deep_link from result_ads_row_71), '/admin/ads', 'ADS4_deep_link_admin_ads_PRD_22_4');
select is((select n_rel_type from result_ads_row_71), 'ad', 'ADS5_related_entity_type_ad');
select is((select n_rel_id from result_ads_row_71), '00000000-0000-0000-0000-000000710014'::uuid,
  'ADS6_related_entity_id_es_el_id_del_ad');
select is((select n_ad_title from result_ads_row_71), 'Ad Notify Admin 71',
  'ADS7_data_ad_title_es_el_titulo_real_del_anuncio');
select ok((select n_title from result_ads_row_71) is not null, 'ADS8_title_no_nulo');
select ok((select n_body from result_ads_row_71) ilike '%Ad Notify Admin 71%',
  'ADS9_body_menciona_el_titulo_del_anuncio');

-- ── 2.2) active -> pending_review (democión de SISTEMA #192) NO dispara ────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at, description) values
  ('00000000-0000-0000-0000-000000710015', '00000000-0000-0000-0000-000000710012',
   '00000000-0000-0000-0000-000000710013', 'Ad Notify Admin Democion 71', 'phone', '+5213300007102',
   'active', now() - interval '1 day', now() + interval '30 days', 'descripcion original');
update public.ads set description = 'descripcion editada, dispara democion de sistema'
 where id = '00000000-0000-0000-0000-000000710015';

select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000710015'),
  'pending_review', 'FIXTURE_ANCHOR3_la_democion_de_sistema_192_si_movio_el_status_precondicion_del_test'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710015' and type = 'admin_ad_pending'),
  0, 'ADS10_active_a_pending_review_democion_de_sistema_192_NO_dispara_admin_ad_pending_solo_draft_dispara'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3) admin_agency_pending — agencies: SOLO status='pending_approval' dispara.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000710021', 'creador_agencia_71@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000710022', 'Agencia Notify Pending 71', 'agencia-notify-pending-71',
   default, '00000000-0000-0000-0000-000000710021');

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710022' and type = 'admin_agency_pending'),
  array[
    '00000000-0000-0000-0000-000000710001'::uuid,
    '00000000-0000-0000-0000-000000710002'::uuid
  ],
  'AGY1_los_2_admins_de_plataforma_y_solo_ellos_reciben_el_aviso_agency_pending'
);
select is(
  (select count(*)::int from public.notifications
    where user_id in ('00000000-0000-0000-0000-000000710003', '00000000-0000-0000-0000-000000710004')
      and related_entity_id = '00000000-0000-0000-0000-000000710022'),
  0, 'AGY2_ni_usuario_regular_ni_agente_reciben_el_aviso'
);

create temp table result_agy_row_71 (
  n_type text, n_deep_link text, n_rel_type text, n_rel_id uuid,
  n_agency_name text, n_title text, n_body text
);
insert into result_agy_row_71
  select type, deep_link, related_entity_type, related_entity_id,
    data->>'agency_name', title, body
  from public.notifications
  where user_id = '00000000-0000-0000-0000-000000710001'
    and related_entity_id = '00000000-0000-0000-0000-000000710022'
    and type = 'admin_agency_pending';

select is((select n_type from result_agy_row_71), 'admin_agency_pending', 'AGY3_type_admin_agency_pending');
-- 🔴 #221 (2026-09-01): fin del interino de #223.2 — la cola /admin/requests
-- ya existe, así que el writer debe apuntar ahí (migración 20260902100004).
select is((select n_deep_link from result_agy_row_71), '/admin/requests', 'AGY4_deep_link_admin_requests_221');
select is((select n_rel_type from result_agy_row_71), 'agency', 'AGY5_related_entity_type_agency');
select is((select n_rel_id from result_agy_row_71), '00000000-0000-0000-0000-000000710022'::uuid,
  'AGY6_related_entity_id_es_el_id_de_la_agencia');
select is((select n_agency_name from result_agy_row_71), 'Agencia Notify Pending 71',
  'AGY7_data_agency_name_es_el_nombre_real_de_la_inmobiliaria');
select ok((select n_body from result_agy_row_71) ilike '%Agencia Notify Pending 71%',
  'AGY8_body_menciona_el_nombre_de_la_inmobiliaria'
);

-- ── nace directo en 'active' (no pasa por pending_approval) → NO dispara ────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000710023', 'creador_agencia_activa_71@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000710024', 'Agencia Notify Ya Activa 71', 'agencia-notify-ya-activa-71',
   'active', '00000000-0000-0000-0000-000000710023');

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710024' and type = 'admin_agency_pending'),
  0, 'AGY9_INSERT_directo_en_active_NO_dispara_solo_pending_approval_dispara'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) admin_agent_application — agent_applications: SOLO status='pending'.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000710031', 'aplicante_agente_71@urbea.mx');
insert into public.agent_applications (id, user_id, application_type) values
  ('00000000-0000-0000-0000-000000710032', '00000000-0000-0000-0000-000000710031', 'independent');

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710032' and type = 'admin_agent_application'),
  array[
    '00000000-0000-0000-0000-000000710001'::uuid,
    '00000000-0000-0000-0000-000000710002'::uuid
  ],
  'APP1_los_2_admins_de_plataforma_y_solo_ellos_reciben_el_aviso_agent_application'
);
select is(
  (select count(*)::int from public.notifications
    where user_id in ('00000000-0000-0000-0000-000000710003', '00000000-0000-0000-0000-000000710004')
      and related_entity_id = '00000000-0000-0000-0000-000000710032'),
  0, 'APP2_ni_usuario_regular_ni_agente_reciben_el_aviso'
);

create temp table result_app_row_71 (
  n_type text, n_deep_link text, n_rel_type text, n_rel_id uuid,
  n_app_type text, n_title text, n_body text
);
insert into result_app_row_71
  select type, deep_link, related_entity_type, related_entity_id,
    data->>'application_type', title, body
  from public.notifications
  where user_id = '00000000-0000-0000-0000-000000710001'
    and related_entity_id = '00000000-0000-0000-0000-000000710032'
    and type = 'admin_agent_application';

select is((select n_type from result_app_row_71), 'admin_agent_application', 'APP3_type_admin_agent_application');
-- 🔴 #221 (2026-09-01): mismo caso que AGY4 arriba.
select is((select n_deep_link from result_app_row_71), '/admin/requests', 'APP4_deep_link_admin_requests_221');
select is((select n_rel_type from result_app_row_71), 'agent_application', 'APP5_related_entity_type_agent_application');
select is((select n_rel_id from result_app_row_71), '00000000-0000-0000-0000-000000710032'::uuid,
  'APP6_related_entity_id_es_el_id_de_la_solicitud');
select is((select n_app_type from result_app_row_71), 'independent',
  'APP7_data_application_type_es_el_tipo_real_de_la_solicitud'
);
select ok((select n_title from result_app_row_71) is not null, 'APP8_title_no_nulo');

-- ── INSERT directo en 'approved' (nunca nace así en la práctica, pero prueba
--    que es el VALOR el que dispara, no cualquier INSERT) → NO dispara ──────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000710033', 'aplicante_agente_aprobado_71@urbea.mx');
insert into public.agent_applications (id, user_id, application_type, status) values
  ('00000000-0000-0000-0000-000000710034', '00000000-0000-0000-0000-000000710033', 'independent', 'approved');

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710034' and type = 'admin_agent_application'),
  0, 'APP9_INSERT_directo_en_approved_NO_dispara_solo_pending_dispara'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) admin_revision_pending — property_revisions: nace 'pending' por INSERT Y
--    re-entra por UPDATE needs_changes→pending (AMBOS disparan, cada re-envío
--    genera avisos NUEVOS — NUNCA deduplicado).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000710041', 'owner_property_revision_71@urbea.mx');
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000710042', '00000000-0000-0000-0000-000000710041',
   'departamento', 'rent', 'Depa Notify Admin Revision 71, CDMX',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography,
   12000, 'active');

-- ── 5.1) INSERT 'pending' — happy path ──────────────────────────────────────
insert into public.property_revisions (id, property_id, submitted_by, status, changed_fields) values
  ('00000000-0000-0000-0000-000000710043', '00000000-0000-0000-0000-000000710042',
   '00000000-0000-0000-0000-000000710041', 'pending', '{"price": 13000}'::jsonb);

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710043' and type = 'admin_revision_pending'),
  array[
    '00000000-0000-0000-0000-000000710001'::uuid,
    '00000000-0000-0000-0000-000000710002'::uuid
  ],
  'REV1_INSERT_pending_los_2_admins_de_plataforma_y_solo_ellos_reciben_el_aviso'
);
select is(
  (select count(*)::int from public.notifications
    where user_id in ('00000000-0000-0000-0000-000000710003', '00000000-0000-0000-0000-000000710004')
      and related_entity_id = '00000000-0000-0000-0000-000000710043'),
  0, 'REV2_ni_usuario_regular_ni_agente_reciben_el_aviso'
);

create temp table result_rev_row_71 (
  n_type text, n_deep_link text, n_rel_type text, n_rel_id uuid,
  n_address text, n_title text, n_body text
);
insert into result_rev_row_71
  select type, deep_link, related_entity_type, related_entity_id,
    data->>'address', title, body
  from public.notifications
  where user_id = '00000000-0000-0000-0000-000000710001'
    and related_entity_id = '00000000-0000-0000-0000-000000710043'
    and type = 'admin_revision_pending'
  order by created_at asc
  limit 1;

select is((select n_type from result_rev_row_71), 'admin_revision_pending', 'REV3_type_admin_revision_pending');
select is((select n_deep_link from result_rev_row_71), '/admin/revisions', 'REV4_deep_link_admin_revisions_PRD_22_4');
select is((select n_rel_type from result_rev_row_71), 'property_revision', 'REV5_related_entity_type_property_revision');
select is((select n_rel_id from result_rev_row_71), '00000000-0000-0000-0000-000000710043'::uuid,
  'REV6_related_entity_id_es_el_id_de_la_revision');
select is((select n_address from result_rev_row_71), 'Depa Notify Admin Revision 71, CDMX',
  'REV7_data_address_es_la_direccion_real_de_la_propiedad'
);
select ok((select n_body from result_rev_row_71) ilike '%Depa Notify Admin Revision 71%',
  'REV8_body_menciona_la_direccion_de_la_propiedad'
);

-- ── 5.2) pending -> needs_changes (revisión del admin) NO dispara ──────────
update public.property_revisions set status = 'needs_changes',
  reviewed_by_admin_id = '00000000-0000-0000-0000-000000710001', reviewed_at = now(),
  rejection_reason = 'favor de corregir el precio'
 where id = '00000000-0000-0000-0000-000000710043';

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710043' and type = 'admin_revision_pending'),
  2, 'REV9_pending_a_needs_changes_NO_genera_avisos_nuevos_sigue_en_2'
);

-- ── 5.3) needs_changes -> pending (RE-ENVÍO #1) — SÍ dispara, avisos NUEVOS,
--    el conteo CRECE de 2 a 4 (nunca deduplicado por la misma llave) ────────
update public.property_revisions set status = 'pending' where id = '00000000-0000-0000-0000-000000710043';

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710043' and type = 'admin_revision_pending'),
  4, 'REV10_needs_changes_a_pending_re_envio_1_SI_dispara_el_conteo_crece_de_2_a_4'
);

-- ── 5.4) segundo ciclo needs_changes -> pending (RE-ENVÍO #2) — el conteo
--    sigue creciendo (4 -> 6), confirma que NO es una coincidencia del 1er
--    re-envío: el ancla nunca puede ser solo (user_id, related_entity_id,
--    type) para este evento ────────────────────────────────────────────────
update public.property_revisions set status = 'needs_changes',
  reviewed_by_admin_id = '00000000-0000-0000-0000-000000710002', reviewed_at = now(),
  rejection_reason = 'aun falta corregir'
 where id = '00000000-0000-0000-0000-000000710043';
update public.property_revisions set status = 'pending' where id = '00000000-0000-0000-0000-000000710043';

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710043' and type = 'admin_revision_pending'),
  6, 'REV11_re_envio_2_el_conteo_sigue_creciendo_de_4_a_6_nunca_se_deduplica'
);

-- ── 5.5) INSERT directo en 'needs_changes' (nunca nace así en la práctica,
--    pero prueba que la rama de ALTA es status='pending', no cualquier
--    INSERT) → NO dispara ───────────────────────────────────────────────────
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000710044', '00000000-0000-0000-0000-000000710041',
   'casa', 'sale', 'Casa Notify Admin Revision 71 P2, CDMX',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography,
   2500000, 'active');
insert into public.property_revisions (id, property_id, submitted_by, status, changed_fields) values
  ('00000000-0000-0000-0000-000000710045', '00000000-0000-0000-0000-000000710044',
   '00000000-0000-0000-0000-000000710041', 'needs_changes', '{"bedrooms": 3}'::jsonb);

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710045' and type = 'admin_revision_pending'),
  0, 'REV12_INSERT_directo_en_needs_changes_NO_dispara_la_rama_de_alta_solo_pending_dispara'
);

-- ── 5.6) needs_changes -> rejected (sale del ciclo, nunca vuelve a pending)
--    tampoco dispara ───────────────────────────────────────────────────────
update public.property_revisions set status = 'rejected',
  reviewed_by_admin_id = '00000000-0000-0000-0000-000000710001', reviewed_at = now(),
  rejection_reason = 'rechazada definitivamente'
 where id = '00000000-0000-0000-0000-000000710045';

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710045' and type = 'admin_revision_pending'),
  0, 'REV13_needs_changes_a_rejected_NO_dispara'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 6) 🔴 D-ANCLA — índice único parcial de los 3 eventos de disparo único.
--    INSERT crudo directo contra notifications (invariante de ESQUEMA, no del
--    trigger — mismo espíritu que 01_constraints_test.sql). Un aviso BORRADO
--    (deleted_at) SIGUE anclando (no se filtra por deleted_at, decisión ya
--    tomada en 20260822000001 para ad_expiring_soon, aplicada aquí igual).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 6.1) admin_ad_pending ────────────────────────────────────────────────
insert into public.notifications (id, user_id, type, title, related_entity_type, related_entity_id) values
  ('00000000-0000-0000-0000-000000710051', '00000000-0000-0000-0000-000000710001',
   'admin_ad_pending', 'Anuncio pendiente de revisión', 'ad', '00000000-0000-0000-0000-000000710052');

select throws_ok(
  $$ insert into public.notifications (id, user_id, type, title, related_entity_type, related_entity_id) values
     ('00000000-0000-0000-0000-000000710053', '00000000-0000-0000-0000-000000710001',
      'admin_ad_pending', 'Anuncio pendiente de revisión (duplicado)', 'ad', '00000000-0000-0000-0000-000000710052') $$,
  '23505', null,
  'ANCLA1_admin_ad_pending_un_segundo_INSERT_con_la_misma_llave_user_related_type_es_rechazado'
);

update public.notifications set deleted_at = now() where id = '00000000-0000-0000-0000-000000710051';

select throws_ok(
  $$ insert into public.notifications (id, user_id, type, title, related_entity_type, related_entity_id) values
     ('00000000-0000-0000-0000-000000710054', '00000000-0000-0000-0000-000000710001',
      'admin_ad_pending', 'Anuncio pendiente de revisión (post-borrado)', 'ad', '00000000-0000-0000-0000-000000710052') $$,
  '23505', null,
  'ANCLA2_admin_ad_pending_un_aviso_BORRADO_sigue_anclando_el_indice_no_filtra_por_deleted_at'
);

-- ── 6.2) admin_agency_pending ────────────────────────────────────────────
insert into public.notifications (id, user_id, type, title, related_entity_type, related_entity_id) values
  ('00000000-0000-0000-0000-000000710055', '00000000-0000-0000-0000-000000710001',
   'admin_agency_pending', 'Inmobiliaria pendiente de aprobación', 'agency', '00000000-0000-0000-0000-000000710056');

select throws_ok(
  $$ insert into public.notifications (id, user_id, type, title, related_entity_type, related_entity_id) values
     ('00000000-0000-0000-0000-000000710057', '00000000-0000-0000-0000-000000710001',
      'admin_agency_pending', 'Inmobiliaria pendiente (duplicado)', 'agency', '00000000-0000-0000-0000-000000710056') $$,
  '23505', null,
  'ANCLA3_admin_agency_pending_un_segundo_INSERT_con_la_misma_llave_es_rechazado'
);

update public.notifications set deleted_at = now() where id = '00000000-0000-0000-0000-000000710055';

select throws_ok(
  $$ insert into public.notifications (id, user_id, type, title, related_entity_type, related_entity_id) values
     ('00000000-0000-0000-0000-000000710058', '00000000-0000-0000-0000-000000710001',
      'admin_agency_pending', 'Inmobiliaria pendiente (post-borrado)', 'agency', '00000000-0000-0000-0000-000000710056') $$,
  '23505', null,
  'ANCLA4_admin_agency_pending_un_aviso_BORRADO_sigue_anclando'
);

-- ── 6.3) admin_agent_application ─────────────────────────────────────────
insert into public.notifications (id, user_id, type, title, related_entity_type, related_entity_id) values
  ('00000000-0000-0000-0000-000000710059', '00000000-0000-0000-0000-000000710001',
   'admin_agent_application', 'Nueva solicitud de agente', 'agent_application', '00000000-0000-0000-0000-000000710060');

select throws_ok(
  $$ insert into public.notifications (id, user_id, type, title, related_entity_type, related_entity_id) values
     ('00000000-0000-0000-0000-000000710062', '00000000-0000-0000-0000-000000710001',
      'admin_agent_application', 'Nueva solicitud (duplicado)', 'agent_application', '00000000-0000-0000-0000-000000710060') $$,
  '23505', null,
  'ANCLA5_admin_agent_application_un_segundo_INSERT_con_la_misma_llave_es_rechazado'
);

update public.notifications set deleted_at = now() where id = '00000000-0000-0000-0000-000000710059';

select throws_ok(
  $$ insert into public.notifications (id, user_id, type, title, related_entity_type, related_entity_id) values
     ('00000000-0000-0000-0000-000000710063', '00000000-0000-0000-0000-000000710001',
      'admin_agent_application', 'Nueva solicitud (post-borrado)', 'agent_application', '00000000-0000-0000-0000-000000710060') $$,
  '23505', null,
  'ANCLA6_admin_agent_application_un_aviso_BORRADO_sigue_anclando'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) 🔒 BLOQUEANTE — fault-injection: si el INSERT hacia notifications falla,
--    la transacción ENTERA del evento revierte (DECISIÓN ABRAHAM 2026-08-25,
--    sin try/catch). Trigger "veneno" DROPEADO inmediatamente tras los
--    asserts que lo necesitan (patrón 48_ads_state_machine_test.sql sección
--    4). 2 caminos representativos: INSERT (agencies) y UPDATE (ads) — los 4
--    escritores comparten el mismo mecanismo (un INSERT hacia la MISMA tabla
--    notifications en la MISMA transacción), no se repite x4.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function pg_temp.poison_notifications_insert_71()
returns trigger language plpgsql as $poison$
begin
  raise exception 'poison: fault injection forzada (pgTAP 71_notify_admin_events_test) para probar rollback total del evento'
    using errcode = '23505';
end
$poison$;
create trigger poison_notifications_before_insert_71
  before insert on public.notifications
  for each row execute function pg_temp.poison_notifications_insert_71();

-- ── 7.1) camino INSERT — agencies ───────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000710071', 'creador_agencia_faultinj_71@urbea.mx');

select throws_ok(
  $$ insert into public.agencies (id, name, slug, status, created_by_user_id) values
     ('00000000-0000-0000-0000-000000710072', 'Agencia Fault Injection 71', 'agencia-faultinj-71',
      default, '00000000-0000-0000-0000-000000710071') $$,
  '23505', null,
  'FAULT1_camino_INSERT_agencies_el_INSERT_de_notifications_falla_y_TODO_el_evento_lanza_excepcion'
);
select is(
  (select count(*)::int from public.agencies where id = '00000000-0000-0000-0000-000000710072'),
  0, 'FAULT2_atomicidad_la_agencia_NO_quedo_creada_pese_al_fallo_posterior_del_aviso'
);

-- ── 7.2) camino UPDATE — ads ─────────────────────────────────────────────
select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000000710001', true);
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000710073', '00000000-0000-0000-0000-000000710012',
   '00000000-0000-0000-0000-000000710013', 'Ad Fault Injection 71', 'phone', '+5213300007103',
   'draft', now() - interval '1 day', now() + interval '30 days');

select throws_ok(
  $$ update public.ads set status = 'pending_review' where id = '00000000-0000-0000-0000-000000710073' $$,
  '23505', null,
  'FAULT3_camino_UPDATE_ads_el_INSERT_de_notifications_falla_y_TODO_el_evento_lanza_excepcion'
);

drop trigger if exists poison_notifications_before_insert_71 on public.notifications;

select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000710073'),
  'draft', 'FAULT4_atomicidad_el_ad_NO_quedo_movido_pese_al_fallo_posterior_del_aviso'
);
select is(
  (select count(*)::int from public.admin_actions
    where entity_type = 'ad' and entity_id = '00000000-0000-0000-0000-000000710073'),
  0, 'FAULT5_atomicidad_no_quedo_fila_huerfana_en_admin_actions_el_BEFORE_trigger_tambien_revirtio'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8) Purga a 30 días — public.purge_notifications() + pg_cron.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 8.1) Firma pública — catálogo EXACTO ────────────────────────────────────
create temp table result_sig_71 (ok boolean, result_sig text, args_sig text);
do $$
declare
  v_oid oid;
begin
  v_oid := to_regprocedure('public.purge_notifications()');
  if v_oid is null then
    insert into result_sig_71 values (false, null, null);
  else
    insert into result_sig_71
    select true, pg_get_function_result(v_oid), pg_get_function_arguments(v_oid);
  end if;
exception when others then
  insert into result_sig_71 values (false, null, null);
end $$;

select is((select ok from result_sig_71), true,
  'PURGE_SIG1_la_funcion_resuelve_por_catalogo_sin_argumentos');
select is((select result_sig from result_sig_71), 'void',
  'PURGE_SIG2_retorna_void_patron_exacto_de_purge_ad_impressions');
select is(
  (select prosecdef from pg_proc where proname = 'purge_notifications' and pronamespace = 'public'::regnamespace),
  true, 'PURGE_SIG3_es_security_definer');
select is(
  (select proconfig from pg_proc where proname = 'purge_notifications' and pronamespace = 'public'::regnamespace),
  array['search_path=""']::text[], 'PURGE_SIG4_search_path_vacio_fijo');

-- ── 8.2) pg_cron — job registrado con jobname/schedule/command exactos ──────
create temp table result_cron_71 (jobname text, schedule text, command text);
insert into result_cron_71
  select jobname, schedule, command from cron.job where jobname = 'purge_notifications_daily';

select is((select count(*)::int from result_cron_71), 1,
  'PURGE_CRON1_existe_exactamente_1_fila_en_cron_job_para_purge_notifications_daily');
select is(coalesce((select schedule from result_cron_71), 'NONE'), '0 11 * * *',
  'PURGE_CRON2_schedule_0_11_UTC_horario_distinto_de_rollup_08_purge_ads_09_y_notify_ads_15');
select is(coalesce((select command from result_cron_71), 'NONE'), 'select public.purge_notifications();',
  'PURGE_CRON3_command_exacto_select_public_purge_notifications');

-- ── 8.3) Comportamiento real — frontera `<` estricta sobre created_at ──────
insert into public.notifications (id, user_id, type, title, created_at, read_at) values
  ('00000000-0000-0000-0000-000000710081', '00000000-0000-0000-0000-000000710001',
   'admin_ad_pending', 'Purga 31d no leido', now() - interval '31 days', null),
  ('00000000-0000-0000-0000-000000710082', '00000000-0000-0000-0000-000000710001',
   'admin_ad_pending', 'Purga 31d leido', now() - interval '31 days', now() - interval '25 days'),
  ('00000000-0000-0000-0000-000000710083', '00000000-0000-0000-0000-000000710001',
   'admin_ad_pending', 'Purga exactamente 30d', now() - interval '30 days', null),
  ('00000000-0000-0000-0000-000000710084', '00000000-0000-0000-0000-000000710001',
   'admin_ad_pending', 'Purga reciente 5d', now() - interval '5 days', null);

insert into public.notifications (id, user_id, type, title, created_at, deleted_at) values
  ('00000000-0000-0000-0000-000000710085', '00000000-0000-0000-0000-000000710001',
   'admin_ad_pending', 'Purga 40d ya borrado por el usuario', now() - interval '40 days', now() - interval '35 days');

create temp table result_purge_run_71 (ok boolean);
do $$
begin
  perform public.purge_notifications();
  insert into result_purge_run_71 values (true);
exception when others then
  insert into result_purge_run_71 values (false);
end $$;

select is((select ok from result_purge_run_71), true, 'PURGE_RUN1_no_lanza_excepcion');
select is(
  (select count(*)::int from public.notifications where id = '00000000-0000-0000-0000-000000710081'),
  0, 'PURGE1_31d_sin_leer_se_BORRA'
);
select is(
  (select count(*)::int from public.notifications where id = '00000000-0000-0000-0000-000000710082'),
  0, 'PURGE2_31d_leido_TAMBIEN_se_BORRA_la_retencion_no_depende_de_read_at'
);
select is(
  (select count(*)::int from public.notifications where id = '00000000-0000-0000-0000-000000710083'),
  1, 'PURGE3_exactamente_30d_se_CONSERVA_frontera_estricta_menor_que'
);
select is(
  (select count(*)::int from public.notifications where id = '00000000-0000-0000-0000-000000710084'),
  1, 'PURGE4_5d_reciente_se_CONSERVA'
);
select is(
  (select count(*)::int from public.notifications where id = '00000000-0000-0000-0000-000000710085'),
  0, 'PURGE5_40d_ya_borrado_por_el_usuario_TAMBIEN_se_purga_fisicamente_deleted_at_no_exime'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 9) 🔴 Hardening post-guardian — rama de CONFLICTO real de `on conflict ...
--    do nothing` (mutante (e) sobreviviente). D-ANCLA (sección 6) solo prueba
--    el ÍNDICE con INSERTs crudos aislados; ningún assert anterior hace que
--    el WRITER MISMO choque contra una llave ya ocupada. Aquí se pre-inserta
--    a mano un aviso con la MISMA ancla (user_id, related_entity_id, type)
--    que el writer real generaría para CADA admin, y luego se dispara el
--    evento real — bajo la semántica BLOQUEANTE (sección 7/DECISIÓN ABRAHAM
--    2026-08-25) la diferencia es real: sin `on conflict ... do nothing`, el
--    segundo INSERT de la fila ya ocupada lanza 23505 SIN bloque EXCEPTION y
--    aborta el evento de negocio entero (el ad no se movería / la agencia no
--    se crearía) — exactamente lo que el mutante (e) dejaba sin cazar. 2
--    caminos representativos (UPDATE ads, INSERT agencies), mismo criterio
--    de "una vez por estilo de disparo" que la sección 7 — los 3 writers de
--    disparo único comparten el mismo mecanismo (índice + on conflict do
--    nothing sobre la MISMA tabla notifications).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 9.1) camino UPDATE — ads: ambos admins YA tienen el aviso anclado ──────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000710091', '00000000-0000-0000-0000-000000710012',
   '00000000-0000-0000-0000-000000710013', 'Ad Conflict OnConflict 71', 'phone', '+5213300007104',
   'draft', now() - interval '1 day', now() + interval '30 days');

insert into public.notifications (id, user_id, type, title, related_entity_type, related_entity_id) values
  ('00000000-0000-0000-0000-000000710092', '00000000-0000-0000-0000-000000710001',
   'admin_ad_pending', 'Anuncio pendiente de revisión (pre-anclado admin1)', 'ad', '00000000-0000-0000-0000-000000710091'),
  ('00000000-0000-0000-0000-000000710093', '00000000-0000-0000-0000-000000710002',
   'admin_ad_pending', 'Anuncio pendiente de revisión (pre-anclado admin2)', 'ad', '00000000-0000-0000-0000-000000710091');

create temp table result_conflict_ads_71 (ok boolean, err_sqlstate text);
do $$
begin
  update public.ads set status = 'pending_review' where id = '00000000-0000-0000-0000-000000710091';
  insert into result_conflict_ads_71 values (true, null);
exception when others then
  insert into result_conflict_ads_71 values (false, sqlstate);
end $$;

select is((select ok from result_conflict_ads_71), true,
  'CONFLICT1_ads_ambos_admins_ya_anclados_el_evento_NO_aborta_on_conflict_do_nothing'
);
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000710091'),
  'pending_review', 'CONFLICT2_ads_la_transicion_SI_procedio_pese_al_conflicto_de_ancla'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710091' and type = 'admin_ad_pending'),
  2, 'CONFLICT3_ads_el_conteo_de_avisos_NO_cambia_no_op_silencioso_sigue_en_2'
);

-- ── 9.2) camino INSERT — agencies: ambos admins YA tienen el aviso anclado ──
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000710094', 'creador_agencia_conflict_71@urbea.mx');

insert into public.notifications (id, user_id, type, title, related_entity_type, related_entity_id) values
  ('00000000-0000-0000-0000-000000710096', '00000000-0000-0000-0000-000000710001',
   'admin_agency_pending', 'Inmobiliaria pendiente (pre-anclado admin1)', 'agency', '00000000-0000-0000-0000-000000710095'),
  ('00000000-0000-0000-0000-000000710097', '00000000-0000-0000-0000-000000710002',
   'admin_agency_pending', 'Inmobiliaria pendiente (pre-anclado admin2)', 'agency', '00000000-0000-0000-0000-000000710095');

create temp table result_conflict_agy_71 (ok boolean, err_sqlstate text);
do $$
begin
  insert into public.agencies (id, name, slug, status, created_by_user_id) values
    ('00000000-0000-0000-0000-000000710095', 'Agencia Conflict OnConflict 71', 'agencia-conflict-onconflict-71',
     default, '00000000-0000-0000-0000-000000710094');
  insert into result_conflict_agy_71 values (true, null);
exception when others then
  insert into result_conflict_agy_71 values (false, sqlstate);
end $$;

select is((select ok from result_conflict_agy_71), true,
  'CONFLICT4_agencies_ambos_admins_ya_anclados_el_evento_NO_aborta_on_conflict_do_nothing'
);
select is(
  (select count(*)::int from public.agencies where id = '00000000-0000-0000-0000-000000710095'),
  1, 'CONFLICT5_agencies_la_agencia_SI_quedo_creada_pese_al_conflicto_de_ancla'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710095' and type = 'admin_agency_pending'),
  2, 'CONFLICT6_agencies_el_conteo_de_avisos_NO_cambia_no_op_silencioso_sigue_en_2'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 10) 🔴 BUG REAL (#219.6) — admin_ad_pending para ads nacidos DIRECTO en
--    pending_review vía la RPC create_ad_campaign_atomic (el wizard real del
--    anunciante), no vía la transición UPDATE draft->pending_review que ya
--    cubren las secciones 2/9. Ver cabecera "Sección 10" arriba.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000710211', 'owner_ads_insert_71@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category) values
  ('00000000-0000-0000-0000-000000710212', 'Agencia Notify Insert Pending 71', 'agencia-notify-insert-pending-71',
   'active', '00000000-0000-0000-0000-000000710211', true, 'otro');
insert into public.agency_members (agency_id, user_id, member_role, status) values
  ('00000000-0000-0000-0000-000000710212', '00000000-0000-0000-0000-000000710211', 'owner', 'active');
insert into public.ad_creatives (id, agency_id, cloudflare_uid, status) values
  ('00000000-0000-0000-0000-000000710213', '00000000-0000-0000-0000-000000710212', 'cf-notify-insert-71', 'ready');

-- ── 10.1) happy path — RPC REAL create_ad_campaign_atomic, el ad nace
--    DIRECTO en pending_review, jamás pasa por draft ───────────────────────
create temp table result_rpc_ad_71 (ok boolean, ad_id uuid, err_message text);
do $$
declare v_ad_id uuid;
begin
  perform pg_temp.act_as('00000000-0000-0000-0000-000000710211');
  v_ad_id := public.create_ad_campaign_atomic(
    '00000000-0000-0000-0000-000000710213'::uuid,
    'Ad Wizard Real 71',
    'phone'::ad_cta_type,
    '+5213300007105',
    '[]'::jsonb,
    null,
    30
  );
  reset role;
  insert into result_rpc_ad_71 (ok, ad_id) values (true, v_ad_id);
exception when others then
  reset role;
  insert into result_rpc_ad_71 (ok, err_message) values (false, sqlerrm);
end $$;

select is((select ok from result_rpc_ad_71), true,
  'RPCINS1_la_RPC_real_del_wizard_no_lanza_en_el_happy_path -- ' ||
  coalesce((select err_message from result_rpc_ad_71), '')
);
select is(
  (select status::text from public.ads where id = (select ad_id from result_rpc_ad_71)),
  'pending_review',
  'RPCINS2_precondicion_el_ad_de_la_RPC_SI_nacio_directo_en_pending_review_jamas_paso_por_draft'
);
select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = (select ad_id from result_rpc_ad_71) and type = 'admin_ad_pending'),
  array[
    '00000000-0000-0000-0000-000000710001'::uuid,
    '00000000-0000-0000-0000-000000710002'::uuid
  ],
  'RPCINS3_BUG_219_6_los_2_admins_de_plataforma_y_solo_ellos_reciben_admin_ad_pending_aunque_el_ad_nazca_por_INSERT_via_la_RPC_del_wizard'
);
select is(
  (select data->>'ad_title' from public.notifications
    where user_id = '00000000-0000-0000-0000-000000710001'
      and related_entity_id = (select ad_id from result_rpc_ad_71)
      and type = 'admin_ad_pending'),
  'Ad Wizard Real 71',
  'RPCINS4_data_ad_title_es_el_titulo_real_de_la_campana_creada_por_la_RPC'
);

-- ── 10.2) INSERT crudo nacido en 'draft' (el status que usa
--    grant_ad_slot_atomic) — NO dispara: el gate depende del VALOR de
--    status, no de que sea un INSERT contra ads ────────────────────────────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000710214', '00000000-0000-0000-0000-000000710212',
   '00000000-0000-0000-0000-000000710213', 'Ad Nace Draft Via Insert 71', 'phone', '+5213300007106',
   'draft', now() - interval '1 day', now() + interval '30 days');

select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710214' and type = 'admin_ad_pending'),
  0, 'RPCINS5_INSERT_directo_nacido_en_draft_NO_dispara_solo_pending_review_dispara_por_INSERT'
);

-- ── 10.3a) el ancla es COMPARTIDA por el camino nuevo — tras el happy path
--    de 10.1, un INSERT crudo duplicado con la MISMA llave (user_id, ad_id,
--    type) sobre el ad de la RPC es rechazado por el índice único parcial
--    notifications_admin_ad_pending_anchor_idx (20260825000001) — las filas
--    que deja el escritor INSERT nuevo caen bajo el MISMO índice que ya
--    ancla al escritor UPDATE existente (sección 6) ─────────────────────────
select throws_ok(
  format(
    $$ insert into public.notifications (id, user_id, type, title, related_entity_type, related_entity_id) values
       ('00000000-0000-0000-0000-000000710216', '00000000-0000-0000-0000-000000710001',
        'admin_ad_pending', 'Anuncio pendiente de revisión (duplicado del camino INSERT)', 'ad', %L) $$,
    (select ad_id from result_rpc_ad_71)
  ),
  '23505', null,
  'RPCINS6_el_ancla_compartida_rechaza_un_INSERT_duplicado_con_la_llave_que_dejo_el_camino_nuevo'
);

-- ── 10.3b) hardening — un ad DISTINTO que nace pending_review con la ancla
--    YA pre-ocupada por ambos admins no aborta el evento y el conteo no
--    cambia (no-op silencioso, mismo criterio que la sección 9). INVARIANTE
--    hoy: nada intenta escribir sin el trigger AFTER INSERT nuevo — el
--    guardian debe reverificar tras el GREEN que sigue en verde por la razón
--    correcta (on conflict do nothing), no por ausencia del SUT ───────────
insert into public.notifications (id, user_id, type, title, related_entity_type, related_entity_id) values
  ('00000000-0000-0000-0000-000000710218', '00000000-0000-0000-0000-000000710001',
   'admin_ad_pending', 'Anuncio pendiente de revisión (pre-anclado admin1, camino INSERT)', 'ad',
   '00000000-0000-0000-0000-000000710217'),
  ('00000000-0000-0000-0000-000000710219', '00000000-0000-0000-0000-000000710002',
   'admin_ad_pending', 'Anuncio pendiente de revisión (pre-anclado admin2, camino INSERT)', 'ad',
   '00000000-0000-0000-0000-000000710217');

create temp table result_rpcins_conflict_71 (ok boolean, err_sqlstate text);
do $$
begin
  insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
    ('00000000-0000-0000-0000-000000710217', '00000000-0000-0000-0000-000000710212',
     '00000000-0000-0000-0000-000000710213', 'Ad Conflict Insert Pending 71', 'phone', '+5213300007107',
     'pending_review', now() - interval '1 day', now() + interval '30 days');
  insert into result_rpcins_conflict_71 values (true, null);
exception when others then
  insert into result_rpcins_conflict_71 values (false, sqlstate);
end $$;

select is((select ok from result_rpcins_conflict_71), true,
  'RPCINS7_ads_nace_pending_review_con_la_ancla_ya_ocupada_el_evento_NO_aborta_on_conflict_do_nothing'
);
select is(
  (select status::text from public.ads where id = '00000000-0000-0000-0000-000000710217'),
  'pending_review', 'RPCINS8_el_ad_SI_quedo_creado_en_pending_review_pese_al_conflicto_de_ancla'
);
select is(
  (select count(*)::int from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710217' and type = 'admin_ad_pending'),
  2, 'RPCINS9_el_conteo_de_avisos_NO_cambia_no_op_silencioso_sigue_en_2'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 11) 🔴 defecto (a) tarea #223.2 — FAN-OUT A ADMINS BORRADOS. Las 4 funciones
--    hacen `from public.users u where u.role = 'admin'` SIN
--    `and u.deleted_at is null`: notifican también a admins dados de baja
--    (y encima el índice users_role_idx es PARCIAL where deleted_at is null,
--    20260604000002:34-35, así que hoy esa query cae en seq scan dentro de
--    la transacción bloqueante del evento). Se siembra el 3er admin (borrado)
--    AQUÍ, DESPUÉS de que las secciones 2-5/9/10 ya corrieron sus arrays
--    exactos [admin1,admin2] — sembrarlo antes invalidaría esas fijaciones
--    por una razón AJENA a lo que prueban. Cada evento se dispara con una
--    entidad NUEVA para no interferir con conteos ya fijados arriba.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000710301', 'admin_borrado_71@urbea.mx');
update public.users set role = 'admin', deleted_at = now()
 where id = '00000000-0000-0000-0000-000000710301';

select is(
  (select count(*)::int from public.users where role = 'admin'), 3,
  'FIXTURE_ANCHOR4_ahora_3_usuarios_con_role_admin_2_vivos_1_borrado'
);
select is(
  (select count(*)::int from public.users where role = 'admin' and deleted_at is null), 2,
  'FIXTURE_ANCHOR5_de_esos_3_solo_2_siguen_vivos_deleted_at_is_null'
);

-- ── 11.1) admin_ad_pending — draft -> pending_review con un ad NUEVO ───────
insert into public.ads (id, agency_id, creative_id, title, cta_type, cta_value, status, starts_at, ends_at) values
  ('00000000-0000-0000-0000-000000710310', '00000000-0000-0000-0000-000000710012',
   '00000000-0000-0000-0000-000000710013', 'Ad Notify Admin Borrado 71', 'phone', '+5213300007108',
   'draft', now() - interval '1 day', now() + interval '30 days');
update public.ads set status = 'pending_review' where id = '00000000-0000-0000-0000-000000710310';

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710310' and type = 'admin_ad_pending'),
  array[
    '00000000-0000-0000-0000-000000710001'::uuid,
    '00000000-0000-0000-0000-000000710002'::uuid
  ],
  'DELADM_ADS1_solo_los_2_admins_vivos_reciben_admin_ad_pending_el_admin_borrado_queda_fuera'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000710301'
      and related_entity_id = '00000000-0000-0000-0000-000000710310'
      and type = 'admin_ad_pending'),
  0, 'DELADM_ADS2_el_admin_borrado_NO_recibe_admin_ad_pending'
);

-- ── 11.2) admin_agency_pending — INSERT en pending_approval con agencia NUEVA
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000710311', 'creador_agencia_admin_borrado_71@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000710312', 'Agencia Notify Admin Borrado 71', 'agencia-notify-admin-borrado-71',
   default, '00000000-0000-0000-0000-000000710311');

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710312' and type = 'admin_agency_pending'),
  array[
    '00000000-0000-0000-0000-000000710001'::uuid,
    '00000000-0000-0000-0000-000000710002'::uuid
  ],
  'DELADM_AGY1_solo_los_2_admins_vivos_reciben_admin_agency_pending_el_admin_borrado_queda_fuera'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000710301'
      and related_entity_id = '00000000-0000-0000-0000-000000710312'
      and type = 'admin_agency_pending'),
  0, 'DELADM_AGY2_el_admin_borrado_NO_recibe_admin_agency_pending'
);

-- ── 11.3) admin_agent_application — INSERT en pending con solicitud NUEVA ──
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000710313', 'aplicante_admin_borrado_71@urbea.mx');
insert into public.agent_applications (id, user_id, application_type) values
  ('00000000-0000-0000-0000-000000710314', '00000000-0000-0000-0000-000000710313', 'independent');

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710314' and type = 'admin_agent_application'),
  array[
    '00000000-0000-0000-0000-000000710001'::uuid,
    '00000000-0000-0000-0000-000000710002'::uuid
  ],
  'DELADM_APP1_solo_los_2_admins_vivos_reciben_admin_agent_application_el_admin_borrado_queda_fuera'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000710301'
      and related_entity_id = '00000000-0000-0000-0000-000000710314'
      and type = 'admin_agent_application'),
  0, 'DELADM_APP2_el_admin_borrado_NO_recibe_admin_agent_application'
);

-- ── 11.4) admin_revision_pending — INSERT en pending con revisión NUEVA ────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000710315', 'owner_revision_admin_borrado_71@urbea.mx');
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status) values
  ('00000000-0000-0000-0000-000000710316', '00000000-0000-0000-0000-000000710315',
   'departamento', 'rent', 'Depa Notify Admin Borrado 71, CDMX',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.37, 20.69), 4326)::extensions.geography,
   9000, 'active');
insert into public.property_revisions (id, property_id, submitted_by, status, changed_fields) values
  ('00000000-0000-0000-0000-000000710317', '00000000-0000-0000-0000-000000710316',
   '00000000-0000-0000-0000-000000710315', 'pending', '{"price": 9500}'::jsonb);

select is(
  (select array_agg(user_id order by user_id) from public.notifications
    where related_entity_id = '00000000-0000-0000-0000-000000710317' and type = 'admin_revision_pending'),
  array[
    '00000000-0000-0000-0000-000000710001'::uuid,
    '00000000-0000-0000-0000-000000710002'::uuid
  ],
  'DELADM_REV1_solo_los_2_admins_vivos_reciben_admin_revision_pending_el_admin_borrado_queda_fuera'
);
select is(
  (select count(*)::int from public.notifications
    where user_id = '00000000-0000-0000-0000-000000710301'
      and related_entity_id = '00000000-0000-0000-0000-000000710317'
      and type = 'admin_revision_pending'),
  0, 'DELADM_REV2_el_admin_borrado_NO_recibe_admin_revision_pending'
);

select * from finish();
rollback;
