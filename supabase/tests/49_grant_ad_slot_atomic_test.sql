-- Tests pgTAP — RPC public.grant_ad_slot_atomic (service_role) + siembra de
-- app_config.ads_free (subtarea #169.3, exploración 039 "Tarea B").
-- Ejecutar con: supabase test db supabase/tests/49_grant_ad_slot_atomic_test.sql --local
-- Corre como superusuario dentro de una transacción revertida (no persiste).
-- Impersonamos con pg_temp.act_as(uid, role) (mismo patrón que 02/16/25/37/46/47/48_*).
--
-- ⚠️ ARCHIVO PROPIO (no se agregan asserts a 47/48_*) -- mismo criterio de
-- separación que 39_moderate_property_atomic_test.sql vs 37/38.
--
-- NOTA sobre ad_prices: ya está sembrada con los 3 alcances a 30 días desde
-- 169.1 (20260816000005_ads_schema.sql:167-177) y YA verificada por
-- 47_ads_schema_test.sql (PRICE1-8) -- verificado en este RED, no se
-- re-testea aquí (evita duplicar cobertura).
--
-- ════════════════════════════════════════════════════════════════════════════
-- SEAM bajo prueba: el comportamiento OBSERVABLE de invocar
-- public.grant_ad_slot_atomic(uuid, uuid, text, ad_cta_type, text, jsonb,
-- integer) -- NUNCA internals -- y el estado real de public.app_config tras
-- la siembra de 'ads_free'. También se cierra aquí un hueco heredado de
-- 169.1: la ausencia de assert sobre SELECT de `authenticated` en
-- public.ad_zones (decisión de diseño: se consulta EXCLUSIVAMENTE vía RPC).
--
-- SUT (AÚN NO EXISTE -- RED 2026-08-16): una migración GREEN debe crear
--   public.grant_ad_slot_atomic(p_agency_id uuid, p_creative_id uuid,
--     p_title text, p_cta_type ad_cta_type, p_cta_value text, p_zones jsonb,
--     p_days int default 30), language plpgsql, security definer,
--   search_path fijo explícito (mismo criterio que private.agency_role_of /
--   set_org_advertising_atomic). SOLO service_role: revoke execute from
--   public, anon, authenticated; grant execute a service_role. En UNA
--   transacción: (1) guard AGENCY_CANNOT_ADVERTISE (P0001) si NOT
--   private.org_can_advertise(p_agency_id) -- reuso literal del seam de
--   168.1, nunca reimplementar la consulta -- org_can_advertise ya compone
--   "inexistente | soft-deleted | suspendida | can_advertise=false" en un
--   solo booleano, así que las 4 causas caen en el MISMO código; (2) INSERT
--   en public.ads (title/cta_type/cta_value := los parámetros tal cual, sin
--   transformar ni validar formato -- esa validación vive en el cliente,
--   169.6, el RPC NO la duplica; status default 'draft' -- el RPC NO activa,
--   "jamás se sirve sin moderación" sigue siendo responsabilidad del trigger
--   de 169.2; starts_at=now(); ends_at=now()+p_days días); (3) por cada
--   elemento de p_zones, INSERT en public.ad_zones
--   (municipality_id/neighborhood_id según la clave presente en el objeto)
--   -- p_zones NULL o '[]' -> CERO filas de ad_zones -> inventario nacional
--   (D3 de 169.1, NO es un error de input); (4) INSERT en
--   public.admin_actions con admin_id := private.resolve_admin_actor()
--   (mismo helper que set_org_advertising_atomic, 20260815000002 -- reusa el
--   mecanismo de Studio/JWT ya establecido; sin admin identificado -> P0001
--   'STATUS_CHANGE_REQUIRES_ADMIN', literal reusado del propio helper, NO
--   inventado aquí). Un fallo en el INSERT de ad_zones O en el de
--   admin_actions revierte TODO (ni ad huérfano ni zonas sueltas -- patrón
--   38_property_video_slots_test.sql / 46/48_*). app_config.ads_free = true,
--   calco exacto de video_slot_free (20260720000001_stream_schema.sql:73).
--
-- ── ⚠️ NOTAS DE CONTRATO (ver también el reporte del test-author) ───────────
-- (A) CORREGIDO por el orquestador (2026-08-16), verificado contra
--     20260816000005_ads_schema.sql:95-97: la firma del plan original
--     (p_agency_id, p_creative_id, p_zones, p_days) era mecánicamente
--     incompleta -- ads.title/cta_type/cta_value son NOT NULL sin default,
--     el RPC no podría insertar la fila. Firma AMPLIADA (no escalado a
--     Abraham -- consecuencia mecánica del esquema, no decisión de
--     producto): p_title/p_cta_type/p_cta_value se insertan ANTES de
--     p_zones, así p_days sigue siendo el único parámetro con DEFAULT al
--     final. TODAS las invocaciones de este archivo usan la firma de 7
--     parámetros (6 posicionales cuando p_days se omite para probar su
--     default).
-- (B) El tipo de retorno de la función NO está fijado por el plan. Este RED
--     lo deja deliberadamente sin comprometer: invoca siempre con `perform`
--     (válido sin importar si retorna void/uuid/table) y localiza la fila
--     creada filtrando por agency_id -- ninguna aserción depende de un valor
--     de retorno.
-- (C) action_type de la auditoría: se fija aquí como 'grant_ad_slot' (mismo
--     patrón snake_case verbo_sustantivo que 'change_ad_status',
--     'enable_org_advertising', 'suspend_agency') -- literal elegido por este
--     RED, no tomado de una fuente previa (el plan no lo fijaba).
-- (D) Se asume que el RPC exige un admin identificado vía
--     private.resolve_admin_actor() (igual que set_org_advertising_atomic) --
--     no está escrito explícitamente en el plan de 169.3, pero es necesario
--     porque admin_actions.admin_id es NOT NULL y es el ÚNICO mecanismo ya
--     establecido en el dominio para resolverlo sin un parámetro p_admin_id
--     explícito.
-- (E) Las agencias con can_advertise=true en este archivo TAMBIÉN llevan
--     advertiser_category (CHECK agencies_categoria_requerida_para_anunciar,
--     168.7, 20260816000003_advertiser_category_required.sql) -- verificado
--     al correr este RED contra la base local (no es una suposición).
-- (F) El RPC NO valida el formato de cta_value contra cta_type (URL para
--     external_url, teléfono para whatsapp/phone) -- esa validación vive en
--     el cliente (169.6, mobile/src/features/ads/lib/validation.ts, aún no
--     escrito) y el RPC solo la persiste tal cual. Si el guardián/Abraham
--     considera que el servidor SÍ debe revalidar el formato, es una
--     decisión de producto nueva, no un hueco de este RED -- reportado, no
--     decidido aquí.
-- ════════════════════════════════════════════════════════════════════════════
--
-- ── Edge cases enumerados (paso 1 del protocolo test-author) ────────────────
-- Happy path:
--   · La función existe con la firma exacta (uuid, uuid, text, ad_cta_type,
--     text, jsonb, integer), SECURITY DEFINER, search_path fijo explícito.
--   · service_role con admin identificado + title/cta_type/cta_value +
--     2 zonas (municipio y colonia) + p_days explícito crea 1 ad + 2
--     ad_zones + 1 fila de auditoría, todo en la misma invocación, sin
--     excepción -- el ad queda en status='draft', y title/cta_type/cta_value
--     llegan EXACTOS a la fila (no solo "no nulos" -- invariante que
--     garantiza el propio NOT NULL, no el SUT).
--   · La auditoría se verifica por CONTENIDO (action_type, entity_type,
--     entity_id, admin_id), no solo por conteo.
--   · cta_value se guarda tal cual para AL MENOS 2 de los 3 valores del enum
--     ad_cta_type (whatsapp, phone -- external_url ya cubierto en el happy
--     path) -- el RPC no revalida formato (ver nota F).
--   · 🔒 title/cta_value viajan VERBATIM, sin normalización suave (sin
--     btrim, sin lower) -- inputs con espacios al inicio/fin y mayúsculas
--     mezcladas, asertados contra el literal EXACTO (hallazgo del guardián,
--     mutantes M7b/M7c de la revisión de PASS: un `lower(btrim(...))`
--     sobrevivía porque ningún input tenía bordes/mayúsculas que discriminar).
-- Edge cases del PRD (D3 de 169.1, §17.2, exploración 039 §6):
--   · p_zones NULL -> 0 filas en ad_zones (inventario nacional), NO es error.
--   · p_zones '[]'::jsonb -> mismo resultado (0 filas), NO es error.
--   · p_days omitido -> default 30 (D1 de 169.1).
--   · app_config tiene la clave 'ads_free' sembrada en true.
-- Ramas no obvias (invariantes 🔒):
--   · Guard AGENCY_CANNOT_ADVERTISE (P0001, con mensaje exacto) DELEGA en
--     private.org_can_advertise -- se prueban las 4 causas que ese helper
--     compone (168.1, 20260815000001:57-67): can_advertise=false,
--     organización inexistente, SUSPENDIDA (status<>'active') y
--     SOFT-DELETED (deleted_at no nulo) -- las 2 últimas con
--     can_advertise=true a propósito, para que una reimplementación ingenua
--     que solo mire esa columna sea detectable (hallazgo del guardián,
--     revisión de PASS: mutante que sobrevivía con solo 2 de las 4 causas
--     cubiertas). Las 4 caen en el MISMO código -- no códigos distintos.
--   · Un elemento de p_zones con AMBOS ids no nulos revienta el CHECK real
--     de ad_zones (23514) -- el RPC no lo enmascara ni lo revalida por su
--     cuenta (mismo criterio que 169.2 con ads_rejection_reason_matches_status).
--   · Sin admin identificado (ni JWT admin ni GUC urbea.admin_actor_id) ->
--     P0001 STATUS_CHANGE_REQUIRES_ADMIN (literal reusado de
--     private.resolve_admin_actor, no inventado aquí).
--   · Hueco heredado de 169.1: authenticated recibe 42501 al hacer SELECT
--     sobre ad_zones -- verificado por impersonación REAL (throws_ok) Y por
--     ausencia de grant (has_table_privilege, distingue "sin grant" de "con
--     grant pero bloqueado por RLS", matiz medido por el guardián).
-- Boundary / error (los invariantes MÁS importantes):
--   · 🔒 Fault-injection: el INSERT de ad_zones falla -> ROLLBACK TOTAL (ni
--     ad ni zonas quedan).
--   · 🔒 Fault-injection: el INSERT de admin_actions falla -> ROLLBACK TOTAL
--     (ni ad ni zonas quedan, aunque ambos ya se habían insertado en la misma
--     invocación).
--   · anon/authenticated reciben 42501 al intentar ejecutar la función
--     (revoke execute, patrón set_org_advertising_atomic).
-- ════════════════════════════════════════════════════════════════════════════

begin;
select plan(55);

create or replace function pg_temp.act_as(p_uid uuid, p_role text default 'authenticated')
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid)::text, true);
end $$;

-- Captura ÚNICA de "ahora" -- dentro de UNA transacción pgTAP, now() devuelve
-- SIEMPRE el mismo valor (transaction_timestamp()), mismo patrón que 48_*.
create temp table test_now_49 as select now() as v_now;

-- ════════════════════════════════════════════════════════════════════════════
-- 0) Fixtures compartidos — self-contained (lección #175: nunca contar sobre
--    lo que otro proceso pobló). Catálogo geo propio con state '49' (fuera
--    del rango real 01-32 de INEGI, cero riesgo de colisión con #157).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.mx_states (id, name, abbr) values ('49', 'Estado Ads Test 49', 'A9');
insert into public.mx_municipalities (id, state_id, name) values ('49001', '49', 'Municipio Ads Test 49');
insert into public.mx_neighborhoods (source_key, municipality_id, name, geom) values
  ('test-ads-49-001', '49001', 'Colonia Ads Test 49',
   extensions.ST_Multi(extensions.ST_MakeEnvelope(-99.30, 19.30, -99.28, 19.32, 4326))::extensions.geography);

-- Admin actor único, reusado vía GUC (private.resolve_admin_actor, patrón
-- 46/48 -- Studio path, sin JWT).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000049000001', 'admin_grant_49@urbea.mx');
update public.users set role = 'admin' where id = '00000000-0000-0000-0000-000049000001';

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Metadata — catálogo puro, nunca lanza aunque la función no exista.
-- ════════════════════════════════════════════════════════════════════════════

select has_function(
  'public', 'grant_ad_slot_atomic',
  array['uuid', 'uuid', 'text', 'ad_cta_type', 'text', 'jsonb', 'integer'],
  'META1_grant_ad_slot_atomic_existe_con_la_firma_exacta_uuid_uuid_text_ad_cta_type_text_jsonb_integer'
);

select is(
  (select prosecdef from pg_proc join pg_namespace ns on pg_proc.pronamespace = ns.oid
    where ns.nspname = 'public' and pg_proc.proname = 'grant_ad_slot_atomic' limit 1),
  true,
  'META2_grant_ad_slot_atomic_debe_ser_security_definer'
);

select is(
  exists (
    select 1
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      cross join lateral unnest(coalesce(p.proconfig, array[]::text[])) as cfg(setting)
     where ns.nspname = 'public'
       and p.proname = 'grant_ad_slot_atomic'
       and cfg.setting like 'search_path=%'
  ),
  true,
  'META3_grant_ad_slot_atomic_fija_search_path_explicito_proteccion_contra_search_path_hijacking'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Permisos — impersonación real, no catálogo de grants. SOLO service_role.
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000049020001', 'anon');
select throws_ok(
  $$ select public.grant_ad_slot_atomic(
       '00000000-0000-0000-0000-000049020002'::uuid,
       '00000000-0000-0000-0000-000049020003'::uuid,
       'Anuncio Perm 49', 'external_url'::ad_cta_type, 'https://ejemplo.mx/perm-49',
       null, 30
     ) $$,
  '42501', null,
  'PERM1_anon_no_puede_ejecutar_grant_ad_slot_atomic'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-000049020001', 'authenticated');
select throws_ok(
  $$ select public.grant_ad_slot_atomic(
       '00000000-0000-0000-0000-000049020002'::uuid,
       '00000000-0000-0000-0000-000049020003'::uuid,
       'Anuncio Perm 49', 'external_url'::ad_cta_type, 'https://ejemplo.mx/perm-49',
       null, 30
     ) $$,
  '42501', null,
  'PERM2_authenticated_no_puede_ejecutar_grant_ad_slot_atomic_ni_para_su_propia_organizacion'
);
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) 🔒 Siembra app_config.ads_free — calco exacto de video_slot_free.
-- ════════════════════════════════════════════════════════════════════════════

select is(
  (select count(*)::int from public.app_config where key = 'ads_free'),
  1,
  'APPCFG1_app_config_tiene_la_clave_ads_free_sembrada'
);
select is(
  (select value from public.app_config where key = 'ads_free'),
  'true'::jsonb,
  'APPCFG2_ads_free_esta_en_true_calco_exacto_de_video_slot_free'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Happy path — 2 zonas (municipio + colonia), p_days explícito. Crea 1 ad
--    + 2 ad_zones + 1 fila de auditoría, TODO en la misma invocación.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000049040002', 'owner_happy_49@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category) values
  ('00000000-0000-0000-0000-000049040001', 'Inmobiliaria Grant Happy 49', 'inmo-grant-happy-49', 'active',
   '00000000-0000-0000-0000-000049040002', true, 'otro');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000049040003', '00000000-0000-0000-0000-000049040001', 'ready');

create temp table result_happy_49 (
  ok boolean, ad_id uuid, ad_count int, ads_status text, ads_agency_id uuid,
  ads_creative_id uuid, ads_title text, ads_cta_type text,
  ads_cta_value text, ads_starts_at timestamptz, ads_ends_at timestamptz,
  zones_count int, zone_municipality_id text, zone_neighborhood_id bigint,
  audit_count int, audit_action_type text, audit_entity_type text,
  audit_entity_id uuid, audit_admin_id uuid, err_sqlstate text, err_message text
);

-- Bloque autoprotegido (aprendizaje de 169.2): una regresión temprana no debe
-- abortar la transacción de pgTAP y cascadear ~49 fallos fantasma.
do $$
declare
  v_neighborhood_id bigint;
  v_ad_id            uuid;
begin
  select id into v_neighborhood_id from public.mx_neighborhoods where source_key = 'test-ads-49-001';

  perform set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000049000001', true);

  -- Título con espacios al inicio/fin y cta_value con mayúsculas mezcladas +
  -- espacios al inicio/fin -- a propósito (hallazgo del guardián: M7b
  -- lower(btrim(cta_value)) y M7c btrim(title) sobreviven si ningún input
  -- tiene bordes/mayúsculas que discriminar). El contrato es "tal cual, sin
  -- transformar" (nota F de cabecera) -- los asserts HAPPY6/HAPPY8 verifican
  -- la igualdad EXACTA contra este literal, espacios y mayúsculas incluidos.
  perform public.grant_ad_slot_atomic(
    '00000000-0000-0000-0000-000049040001'::uuid,
    '00000000-0000-0000-0000-000049040003'::uuid,
    '  Anuncio Grant Happy 49  ',
    'external_url'::ad_cta_type,
    '  https://Ejemplo.MX/Grant-Happy-49  ',
    jsonb_build_array(
      jsonb_build_object('municipality_id', '49001'),
      jsonb_build_object('neighborhood_id', v_neighborhood_id)
    ),
    45
  );

  select id into v_ad_id from public.ads
   where agency_id = '00000000-0000-0000-0000-000049040001'::uuid
   order by created_at desc limit 1;

  insert into result_happy_49 (
    ok, ad_id, ad_count, ads_status, ads_agency_id, ads_creative_id,
    ads_title, ads_cta_type, ads_cta_value,
    ads_starts_at, ads_ends_at, zones_count, zone_municipality_id,
    zone_neighborhood_id, audit_count, audit_action_type, audit_entity_type,
    audit_entity_id, audit_admin_id
  )
  select
    true, v_ad_id,
    (select count(*)::int from public.ads where agency_id = '00000000-0000-0000-0000-000049040001'::uuid),
    (select status::text from public.ads where id = v_ad_id),
    (select agency_id from public.ads where id = v_ad_id),
    (select creative_id from public.ads where id = v_ad_id),
    (select title from public.ads where id = v_ad_id),
    (select cta_type::text from public.ads where id = v_ad_id),
    (select cta_value from public.ads where id = v_ad_id),
    (select starts_at from public.ads where id = v_ad_id),
    (select ends_at from public.ads where id = v_ad_id),
    (select count(*)::int from public.ad_zones where ad_id = v_ad_id),
    (select municipality_id from public.ad_zones where ad_id = v_ad_id and municipality_id is not null),
    (select neighborhood_id from public.ad_zones where ad_id = v_ad_id and neighborhood_id is not null),
    (select count(*)::int from public.admin_actions where entity_type = 'ad' and entity_id = v_ad_id),
    (select action_type from public.admin_actions where entity_type = 'ad' and entity_id = v_ad_id),
    (select entity_type from public.admin_actions where entity_type = 'ad' and entity_id = v_ad_id),
    (select entity_id from public.admin_actions where entity_type = 'ad' and entity_id = v_ad_id),
    (select admin_id from public.admin_actions where entity_type = 'ad' and entity_id = v_ad_id);
exception when others then
  insert into result_happy_49 (ok, err_sqlstate, err_message) values (false, sqlstate, sqlerrm);
end $$;

select is(
  (select ok from result_happy_49), true,
  'HAPPY1_grant_ad_slot_atomic_no_lanza_excepcion_en_el_happy_path -- ' ||
  coalesce((select err_message from result_happy_49), '')
);
select is(
  coalesce((select ad_count from result_happy_49), -1), 1,
  'HAPPY2_se_crea_EXACTAMENTE_1_fila_nueva_en_ads_para_la_agencia'
);
select is(
  coalesce((select ads_status from result_happy_49), 'x'), 'draft',
  'HAPPY3_el_ad_creado_queda_en_status_draft_el_rpc_NO_lo_activa_jamas_se_sirve_sin_moderacion'
);
select is(
  (select ads_agency_id from result_happy_49), '00000000-0000-0000-0000-000049040001'::uuid,
  'HAPPY4_el_ad_creado_tiene_el_agency_id_correcto'
);
select is(
  (select ads_creative_id from result_happy_49), '00000000-0000-0000-0000-000049040003'::uuid,
  'HAPPY5_el_ad_creado_tiene_el_creative_id_correcto'
);
select is(
  (select ads_title from result_happy_49), '  Anuncio Grant Happy 49  ',
  'HAPPY6_title_llega_EXACTO_a_la_fila_CON_los_espacios_al_inicio_fin_intactos_el_rpc_no_hace_btrim'
);
select is(
  (select ads_cta_type from result_happy_49), 'external_url',
  'HAPPY7_cta_type_llega_EXACTO_a_la_fila_tal_cual_se_paso_no_solo_no_nulo'
);
select is(
  (select ads_cta_value from result_happy_49), '  https://Ejemplo.MX/Grant-Happy-49  ',
  'HAPPY8_cta_value_llega_EXACTO_a_la_fila_CON_mayusculas_y_espacios_intactos_el_rpc_no_hace_lower_btrim'
);
select is(
  (select ads_starts_at from result_happy_49), (select v_now from test_now_49),
  'HAPPY9_starts_at_queda_estampado_exactamente_en_now'
);
select is(
  (select ads_ends_at from result_happy_49), (select v_now + interval '45 days' from test_now_49),
  'HAPPY10_ends_at_es_starts_at_mas_los_45_dias_de_p_days_explicito'
);
select is(
  coalesce((select zones_count from result_happy_49), -1), 2,
  'HAPPY11_se_crean_EXACTAMENTE_2_filas_en_ad_zones_una_por_cada_elemento_de_p_zones'
);
select is(
  (select zone_municipality_id from result_happy_49), '49001',
  'HAPPY12_la_zona_de_municipio_queda_con_el_municipality_id_correcto'
);
select is(
  (select zone_neighborhood_id from result_happy_49),
  (select id from public.mx_neighborhoods where source_key = 'test-ads-49-001'),
  'HAPPY13_la_zona_de_colonia_queda_con_el_neighborhood_id_correcto'
);
select is(
  coalesce((select audit_count from result_happy_49), -1), 1,
  'HAPPY14_se_escribe_EXACTAMENTE_1_fila_en_admin_actions_en_la_misma_invocacion'
);
select is(
  (select audit_action_type from result_happy_49), 'grant_ad_slot',
  'HAPPY15_la_auditoria_tiene_action_type_grant_ad_slot_contenido_no_solo_conteo'
);
select is(
  (select audit_entity_type from result_happy_49), 'ad',
  'HAPPY16_la_auditoria_tiene_entity_type_ad'
);
select is(
  (select audit_entity_id from result_happy_49), (select ad_id from result_happy_49),
  'HAPPY17_la_auditoria_referencia_el_id_del_ad_recien_creado_contenido_no_solo_conteo'
);
select is(
  (select audit_admin_id from result_happy_49), '00000000-0000-0000-0000-000049000001'::uuid,
  'HAPPY18_la_auditoria_registra_el_admin_id_correcto_del_actor_identificado'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 4B) 🔒 cta_value se guarda TAL CUAL para 'whatsapp' y 'phone' -- external_url
--     ya cubierto en el happy path (sección 4). El RPC NO revalida formato
--     (nota F de cabecera) -- solo persiste lo que el cliente ya validó.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000049045002', 'owner_cta_49@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category) values
  ('00000000-0000-0000-0000-000049045001', 'Inmobiliaria Grant CTA 49', 'inmo-grant-cta-49', 'active',
   '00000000-0000-0000-0000-000049045002', true, 'otro');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000049045003', '00000000-0000-0000-0000-000049045001', 'ready'),
  ('00000000-0000-0000-0000-000049045004', '00000000-0000-0000-0000-000049045001', 'ready');

create temp table result_cta_49 (
  ok boolean,
  whatsapp_row text, phone_row text,
  err_sqlstate text
);
do $$
declare
  v_whatsapp_ad_id uuid;
  v_phone_ad_id    uuid;
begin
  perform set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000049000001', true);

  -- cta_value con espacios al inicio/fin en ambos (hallazgo del guardián:
  -- M7b lower(btrim(cta_value)) sobrevive si ningún cta_value tiene bordes
  -- que discriminar; los teléfonos no tienen mayúsculas, así que el borde es
  -- la única señal disponible aquí -- sigue siendo un valor plausible, el
  -- cliente 169.6 recorta espacios antes de enviar en el flujo real).
  perform public.grant_ad_slot_atomic(
    '00000000-0000-0000-0000-000049045001'::uuid,
    '00000000-0000-0000-0000-000049045003'::uuid,
    'Anuncio CTA WhatsApp 49', 'whatsapp'::ad_cta_type, '  5213312345678  ',
    null, 30
  );
  perform public.grant_ad_slot_atomic(
    '00000000-0000-0000-0000-000049045001'::uuid,
    '00000000-0000-0000-0000-000049045004'::uuid,
    'Anuncio CTA Phone 49', 'phone'::ad_cta_type, '  +523312345678  ',
    null, 30
  );

  select id into v_whatsapp_ad_id from public.ads
   where creative_id = '00000000-0000-0000-0000-000049045003'::uuid limit 1;
  select id into v_phone_ad_id from public.ads
   where creative_id = '00000000-0000-0000-0000-000049045004'::uuid limit 1;

  insert into result_cta_49 (ok, whatsapp_row, phone_row)
  select
    true,
    (select row(cta_type::text, cta_value)::text from public.ads where id = v_whatsapp_ad_id),
    (select row(cta_type::text, cta_value)::text from public.ads where id = v_phone_ad_id);
exception when others then
  insert into result_cta_49 (ok, err_sqlstate) values (false, sqlstate);
end $$;

-- Literal esperado verificado empíricamente (ROW(...)::text cita entre
-- comillas dobles un campo con espacios al inicio/fin -- no es una
-- transformación del RPC, es cómo Postgres imprime el tipo compuesto).
select is(
  (select whatsapp_row from result_cta_49), '(whatsapp,"  5213312345678  ")',
  'CTA1_cta_value_whatsapp_se_guarda_CON_los_espacios_al_inicio_fin_intactos_sin_revalidar_formato_en_el_servidor'
);
select is(
  (select phone_row from result_cta_49), '(phone,"  +523312345678  ")',
  'CTA2_cta_value_phone_se_guarda_CON_los_espacios_al_inicio_fin_intactos_sin_revalidar_formato_en_el_servidor'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 5) 🔒 p_zones NULL o '[]' -> 0 filas en ad_zones -- inventario NACIONAL, NO
--    es un error de input (D3 de 169.1).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 5.1) NULL ────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000049050002', 'owner_nacional_null_49@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category) values
  ('00000000-0000-0000-0000-000049050001', 'Inmobiliaria Grant Nacional Null 49', 'inmo-grant-nacional-null-49', 'active',
   '00000000-0000-0000-0000-000049050002', true, 'otro');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000049050003', '00000000-0000-0000-0000-000049050001', 'ready');

create temp table result_nacional_null_49 (ok boolean, ad_count int, zones_count int, err_sqlstate text);
do $$
declare v_ad_id uuid;
begin
  perform set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000049000001', true);
  perform public.grant_ad_slot_atomic(
    '00000000-0000-0000-0000-000049050001'::uuid,
    '00000000-0000-0000-0000-000049050003'::uuid,
    'Anuncio Nacional Null 49', 'external_url'::ad_cta_type, 'https://ejemplo.mx/nacional-null-49',
    null, 30
  );
  select id into v_ad_id from public.ads
   where agency_id = '00000000-0000-0000-0000-000049050001'::uuid order by created_at desc limit 1;
  insert into result_nacional_null_49 values (
    true,
    (select count(*)::int from public.ads where agency_id = '00000000-0000-0000-0000-000049050001'::uuid),
    (select count(*)::int from public.ad_zones where ad_id = v_ad_id),
    null
  );
exception when others then
  insert into result_nacional_null_49 values (false, null, null, sqlstate);
end $$;

select is((select ok from result_nacional_null_49), true, 'NAC1_p_zones_null_no_lanza_excepcion');
select is(coalesce((select ad_count from result_nacional_null_49), -1), 1, 'NAC2_p_zones_null_igual_crea_1_ad');
select is(coalesce((select zones_count from result_nacional_null_49), -1), 0, 'NAC3_p_zones_null_deja_0_filas_en_ad_zones_inventario_nacional');

-- ── 5.2) '[]'::jsonb (arreglo vacío) ────────────────────────────────────
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000049050102', 'owner_nacional_vacio_49@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category) values
  ('00000000-0000-0000-0000-000049050101', 'Inmobiliaria Grant Nacional Vacio 49', 'inmo-grant-nacional-vacio-49', 'active',
   '00000000-0000-0000-0000-000049050102', true, 'otro');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000049050103', '00000000-0000-0000-0000-000049050101', 'ready');

create temp table result_nacional_vacio_49 (ok boolean, ad_count int, zones_count int, err_sqlstate text);
do $$
declare v_ad_id uuid;
begin
  perform set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000049000001', true);
  perform public.grant_ad_slot_atomic(
    '00000000-0000-0000-0000-000049050101'::uuid,
    '00000000-0000-0000-0000-000049050103'::uuid,
    'Anuncio Nacional Vacio 49', 'external_url'::ad_cta_type, 'https://ejemplo.mx/nacional-vacio-49',
    '[]'::jsonb, 30
  );
  select id into v_ad_id from public.ads
   where agency_id = '00000000-0000-0000-0000-000049050101'::uuid order by created_at desc limit 1;
  insert into result_nacional_vacio_49 values (
    true,
    (select count(*)::int from public.ads where agency_id = '00000000-0000-0000-0000-000049050101'::uuid),
    (select count(*)::int from public.ad_zones where ad_id = v_ad_id),
    null
  );
exception when others then
  insert into result_nacional_vacio_49 values (false, null, null, sqlstate);
end $$;

select is((select ok from result_nacional_vacio_49), true, 'NAC4_p_zones_arreglo_vacio_no_lanza_excepcion');
select is(coalesce((select ad_count from result_nacional_vacio_49), -1), 1, 'NAC5_p_zones_arreglo_vacio_igual_crea_1_ad');
select is(coalesce((select zones_count from result_nacional_vacio_49), -1), 0, 'NAC6_p_zones_arreglo_vacio_deja_0_filas_en_ad_zones_inventario_nacional');

-- ════════════════════════════════════════════════════════════════════════════
-- 6) p_days omitido -> default 30 (D1 de 169.1).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000049060002', 'owner_dias_default_49@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category) values
  ('00000000-0000-0000-0000-000049060001', 'Inmobiliaria Grant Dias Default 49', 'inmo-grant-dias-default-49', 'active',
   '00000000-0000-0000-0000-000049060002', true, 'otro');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000049060003', '00000000-0000-0000-0000-000049060001', 'ready');

create temp table result_dias_default_49 (ok boolean, starts_at timestamptz, ends_at timestamptz, err_sqlstate text);
do $$
declare v_ad_id uuid;
begin
  perform set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000049000001', true);
  perform public.grant_ad_slot_atomic(
    '00000000-0000-0000-0000-000049060001'::uuid,
    '00000000-0000-0000-0000-000049060003'::uuid,
    'Anuncio Dias Default 49', 'external_url'::ad_cta_type, 'https://ejemplo.mx/dias-default-49',
    null
    -- p_days omitido a propósito
  );
  select id into v_ad_id from public.ads
   where agency_id = '00000000-0000-0000-0000-000049060001'::uuid order by created_at desc limit 1;
  insert into result_dias_default_49 values (
    true,
    (select starts_at from public.ads where id = v_ad_id),
    (select ends_at from public.ads where id = v_ad_id),
    null
  );
exception when others then
  insert into result_dias_default_49 values (false, null, null, sqlstate);
end $$;

select is((select ok from result_dias_default_49), true, 'DAYS1_p_days_omitido_no_lanza_excepcion');
select is(
  (select starts_at from result_dias_default_49), (select v_now from test_now_49),
  'DAYS2_p_days_omitido_starts_at_sigue_estampado_en_now'
);
select is(
  (select ends_at from result_dias_default_49), (select v_now + interval '30 days' from test_now_49),
  'DAYS3_p_days_omitido_ends_at_default_a_30_dias_D1_de_169_1'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 7) 🔒 Guard AGENCY_CANNOT_ADVERTISE — organización con can_advertise=false.
--    Admin actor identificado a propósito, para aislar el P0001 de negocio de
--    cualquier fallo de resolución de admin.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000049070002', 'owner_sincapacidad_49@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000049070001', 'Inmobiliaria Grant Sin Capacidad 49', 'inmo-grant-sincapacidad-49', 'active',
   '00000000-0000-0000-0000-000049070002');
-- can_advertise/advertiser_category omitidos a propósito -- default
-- (false, null), que el CHECK agencies_categoria_requerida_para_anunciar
-- permite sin problema.
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000049070003', '00000000-0000-0000-0000-000049070001', 'ready');

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000049000001', true);
select throws_ok(
  $$ select public.grant_ad_slot_atomic(
       '00000000-0000-0000-0000-000049070001'::uuid,
       '00000000-0000-0000-0000-000049070003'::uuid,
       'Anuncio Sin Capacidad 49', 'external_url'::ad_cta_type, 'https://ejemplo.mx/sincapacidad-49',
       null, 30
     ) $$,
  'P0001', 'AGENCY_CANNOT_ADVERTISE',
  'CAP1_organizacion_con_can_advertise_false_es_rechazada_ANTES_de_crear_el_ad'
);
select is(
  (select count(*)::int from public.ads where agency_id = '00000000-0000-0000-0000-000049070001'::uuid),
  0,
  'CAP2_atomicidad_del_bloqueo_no_queda_ningun_ad_creado_para_esa_organizacion'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8) 🔒 Guard AGENCY_CANNOT_ADVERTISE — organización INEXISTENTE cae en el
--    MISMO código (org_can_advertise ya compone esa lógica, 168.1) — no
--    inventa un segundo código tipo AGENCY_NOT_FOUND.
-- ════════════════════════════════════════════════════════════════════════════

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000049000001', true);
select throws_ok(
  $$ select public.grant_ad_slot_atomic(
       '00000000-0000-0000-0000-000049080099'::uuid,
       '00000000-0000-0000-0000-000049080098'::uuid,
       'Anuncio Org Inexistente 49', 'external_url'::ad_cta_type, 'https://ejemplo.mx/orginexistente-49',
       null, 30
     ) $$,
  'P0001', 'AGENCY_CANNOT_ADVERTISE',
  'CAP3_organizacion_inexistente_cae_en_el_mismo_guard_AGENCY_CANNOT_ADVERTISE_org_can_advertise_ya_lo_compone'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 8B) 🔒 Guard AGENCY_CANNOT_ADVERTISE — el RPC DELEGA en
--     private.org_can_advertise, no reimplementa la consulta (hallazgo del
--     guardián: el mutante que reemplaza el guard por
--     `coalesce((select can_advertise from agencies where id=...), false)`
--     sobrevivía porque el RED solo cubría 2 de las 4 causas que ese helper
--     compone -- 168.1, 20260815000001_org_advertising_capability.sql:57-67
--     -- verificado ANTES de escribir estos asserts, no inventado). Las 4
--     causas (mismo fixture que 46_org_advertising_test.sql:150-183):
--     id inexistente (CAP3 arriba), can_advertise=false (CAP1 arriba),
--     deleted_at no nulo, status<>'active' -- las 2 que faltaban aquí. En
--     AMBOS casos can_advertise=true a propósito (es lo que rompe la
--     implementación ingenua que solo mira esa columna).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 8B.1) Organización SUSPENDIDA (status<>'active'), can_advertise=true ───
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000049081002', 'owner_suspendida_49@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category) values
  ('00000000-0000-0000-0000-000049081001', 'Inmobiliaria Grant Suspendida 49', 'inmo-grant-suspendida-49', 'suspended',
   '00000000-0000-0000-0000-000049081002', true, 'otro');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000049081003', '00000000-0000-0000-0000-000049081001', 'ready');

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000049000001', true);
select throws_ok(
  $$ select public.grant_ad_slot_atomic(
       '00000000-0000-0000-0000-000049081001'::uuid,
       '00000000-0000-0000-0000-000049081003'::uuid,
       'Anuncio Suspendida 49', 'external_url'::ad_cta_type, 'https://ejemplo.mx/suspendida-49',
       null, 30
     ) $$,
  'P0001', 'AGENCY_CANNOT_ADVERTISE',
  'CAP4_organizacion_suspendida_status_no_activa_es_rechazada_pese_a_can_advertise_true_delegacion_real_en_org_can_advertise'
);
select is(
  (select count(*)::int from public.ads where agency_id = '00000000-0000-0000-0000-000049081001'::uuid),
  0,
  'CAP5_atomicidad_no_queda_ningun_ad_creado_para_la_organizacion_suspendida'
);

-- ── 8B.2) Organización SOFT-DELETED (deleted_at no nulo), can_advertise=true ─
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000049082002', 'owner_borrada_49@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category, deleted_at) values
  ('00000000-0000-0000-0000-000049082001', 'Inmobiliaria Grant Borrada 49', 'inmo-grant-borrada-49', 'active',
   '00000000-0000-0000-0000-000049082002', true, 'otro', now());
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000049082003', '00000000-0000-0000-0000-000049082001', 'ready');

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000049000001', true);
select throws_ok(
  $$ select public.grant_ad_slot_atomic(
       '00000000-0000-0000-0000-000049082001'::uuid,
       '00000000-0000-0000-0000-000049082003'::uuid,
       'Anuncio Borrada 49', 'external_url'::ad_cta_type, 'https://ejemplo.mx/borrada-49',
       null, 30
     ) $$,
  'P0001', 'AGENCY_CANNOT_ADVERTISE',
  'CAP6_organizacion_soft_deleted_es_rechazada_pese_a_can_advertise_true_delegacion_real_en_org_can_advertise'
);
select is(
  (select count(*)::int from public.ads where agency_id = '00000000-0000-0000-0000-000049082001'::uuid),
  0,
  'CAP7_atomicidad_no_queda_ningun_ad_creado_para_la_organizacion_soft_deleted'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 9) 🔒 p_zones con un elemento con AMBOS ids no nulos revienta el CHECK real
--    ad_zones_exactly_one_scope (23514) -- el RPC no lo enmascara ni lo
--    revalida por su cuenta (mismo criterio que 169.2 con el CHECK de
--    rejection_reason). Atomicidad: el ad ya insertado también se revierte.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000049090002', 'owner_zonaxor_49@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category) values
  ('00000000-0000-0000-0000-000049090001', 'Inmobiliaria Grant Zona XOR 49', 'inmo-grant-zona-xor-49', 'active',
   '00000000-0000-0000-0000-000049090002', true, 'otro');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000049090003', '00000000-0000-0000-0000-000049090001', 'ready');

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000049000001', true);
select throws_ok(
  $$ select public.grant_ad_slot_atomic(
       '00000000-0000-0000-0000-000049090001'::uuid,
       '00000000-0000-0000-0000-000049090003'::uuid,
       'Anuncio Zona XOR 49', 'external_url'::ad_cta_type, 'https://ejemplo.mx/zonaxor-49',
       jsonb_build_array(jsonb_build_object('municipality_id', '49001', 'neighborhood_id', 1)),
       30
     ) $$,
  '23514',
  'new row for relation "ad_zones" violates check constraint "ad_zones_exactly_one_scope"',
  'ZONE1_un_elemento_de_p_zones_con_ambos_ids_no_nulos_revienta_el_check_real_sin_que_el_rpc_lo_enmascare'
);
select is(
  (select count(*)::int from public.ads where agency_id = '00000000-0000-0000-0000-000049090001'::uuid),
  0,
  'ZONE2_atomicidad_el_ad_ya_insertado_tambien_se_revierte_cuando_falla_el_check_de_ad_zones'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 10) 🔒 Fault-injection — el INSERT de ad_zones falla -> ROLLBACK TOTAL. Trigger
--     "veneno" DROPEADO INMEDIATAMENTE tras el assert que lo necesita
--     (aprendizaje de la derivada #176 -- no dejarlo vivo hasta el final).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000049100002', 'owner_faultzones_49@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category) values
  ('00000000-0000-0000-0000-000049100001', 'Inmobiliaria Grant Fault Zones 49', 'inmo-grant-fault-zones-49', 'active',
   '00000000-0000-0000-0000-000049100002', true, 'otro');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000049100003', '00000000-0000-0000-0000-000049100001', 'ready');

create or replace function pg_temp.poison_ad_zones_insert_49()
returns trigger language plpgsql as $poison$
begin
  raise exception 'poison: fault injection forzada (pgTAP 49_grant_ad_slot_atomic_test) para probar el rollback total del insert de ad_zones'
    using errcode = '23505';
end
$poison$;
create trigger poison_ad_zones_before_insert_49
  before insert on public.ad_zones
  for each row execute function pg_temp.poison_ad_zones_insert_49();

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000049000001', true);
select throws_ok(
  $$ select public.grant_ad_slot_atomic(
       '00000000-0000-0000-0000-000049100001'::uuid,
       '00000000-0000-0000-0000-000049100003'::uuid,
       'Anuncio Fault Zones 49', 'external_url'::ad_cta_type, 'https://ejemplo.mx/faultzones-49',
       jsonb_build_array(jsonb_build_object('municipality_id', '49001')),
       30
     ) $$,
  '23505', null,
  'FI1_fault_injection_el_insert_de_ad_zones_falla_y_grant_ad_slot_atomic_debe_lanzar_excepcion'
);

drop trigger if exists poison_ad_zones_before_insert_49 on public.ad_zones;

select is(
  (select count(*)::int from public.ads where agency_id = '00000000-0000-0000-0000-000049100001'::uuid),
  0,
  'FI2_atomicidad_rollback_total_no_quedo_ningun_ad_creado_pese_al_insert_previo_a_la_falla'
);
select is(
  (select count(*)::int from public.ad_zones z join public.ads a on a.id = z.ad_id
    where a.agency_id = '00000000-0000-0000-0000-000049100001'::uuid),
  0,
  'FI3_atomicidad_no_quedo_ninguna_zona_huerfana_para_esta_organizacion'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 11) 🔒 Fault-injection — el INSERT de admin_actions falla -> ROLLBACK TOTAL
--     (ni el ad ni las zonas, aunque ambos ya se habían insertado en la misma
--     invocación). Trigger "veneno" DROPEADO INMEDIATAMENTE.
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000049110002', 'owner_faultaudit_49@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category) values
  ('00000000-0000-0000-0000-000049110001', 'Inmobiliaria Grant Fault Audit 49', 'inmo-grant-fault-audit-49', 'active',
   '00000000-0000-0000-0000-000049110002', true, 'otro');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000049110003', '00000000-0000-0000-0000-000049110001', 'ready');

create or replace function pg_temp.poison_admin_actions_insert_49()
returns trigger language plpgsql as $poison$
begin
  raise exception 'poison: fault injection forzada (pgTAP 49_grant_ad_slot_atomic_test) para probar el rollback total del insert de admin_actions'
    using errcode = '23505';
end
$poison$;
create trigger poison_admin_actions_before_insert_49
  before insert on public.admin_actions
  for each row execute function pg_temp.poison_admin_actions_insert_49();

select set_config('urbea.admin_actor_id', '00000000-0000-0000-0000-000049000001', true);
select throws_ok(
  $$ select public.grant_ad_slot_atomic(
       '00000000-0000-0000-0000-000049110001'::uuid,
       '00000000-0000-0000-0000-000049110003'::uuid,
       'Anuncio Fault Audit 49', 'external_url'::ad_cta_type, 'https://ejemplo.mx/faultaudit-49',
       jsonb_build_array(jsonb_build_object('municipality_id', '49001')),
       30
     ) $$,
  '23505', null,
  'FI5_fault_injection_el_insert_de_admin_actions_falla_y_grant_ad_slot_atomic_debe_lanzar_excepcion'
);

drop trigger if exists poison_admin_actions_before_insert_49 on public.admin_actions;

select is(
  (select count(*)::int from public.ads where agency_id = '00000000-0000-0000-0000-000049110001'::uuid),
  0,
  'FI6_atomicidad_rollback_total_no_quedo_ningun_ad_pese_a_que_el_ad_y_sus_zonas_ya_se_habian_insertado'
);
select is(
  (select count(*)::int from public.ad_zones z join public.ads a on a.id = z.ad_id
    where a.agency_id = '00000000-0000-0000-0000-000049110001'::uuid),
  0,
  'FI7_atomicidad_rollback_total_tampoco_quedan_zonas_huerfanas'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 12) 🔒 Sin admin identificado (ni JWT admin ni GUC urbea.admin_actor_id) ->
--     P0001 STATUS_CHANGE_REQUIRES_ADMIN — literal reusado de
--     private.resolve_admin_actor (ver ambigüedad D de cabecera).
-- ════════════════════════════════════════════════════════════════════════════

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000049120002', 'owner_sinadmin_49@urbea.mx');
insert into public.agencies (id, name, slug, status, created_by_user_id, can_advertise, advertiser_category) values
  ('00000000-0000-0000-0000-000049120001', 'Inmobiliaria Grant Sin Admin 49', 'inmo-grant-sinadmin-49', 'active',
   '00000000-0000-0000-0000-000049120002', true, 'otro');
insert into public.ad_creatives (id, agency_id, status) values
  ('00000000-0000-0000-0000-000049120003', '00000000-0000-0000-0000-000049120001', 'ready');

select set_config('urbea.admin_actor_id', '', true);
select pg_temp.act_as(null, 'service_role');
select throws_ok(
  $$ select public.grant_ad_slot_atomic(
       '00000000-0000-0000-0000-000049120001'::uuid,
       '00000000-0000-0000-0000-000049120003'::uuid,
       'Anuncio Sin Admin 49', 'external_url'::ad_cta_type, 'https://ejemplo.mx/sinadmin-49',
       null, 30
     ) $$,
  'P0001', 'STATUS_CHANGE_REQUIRES_ADMIN',
  'NOADMIN1_sin_admin_identificado_falla_defensa_en_profundidad_no_basta_el_grant_de_service_role'
);
reset role;

select is(
  (select count(*)::int from public.ads where agency_id = '00000000-0000-0000-0000-000049120001'::uuid),
  0,
  'NOADMIN2_atomicidad_no_queda_ningun_ad_creado_tras_el_intento_bloqueado_por_falta_de_admin'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 13) 🔒 Hueco heredado de 169.1 — authenticated NO puede hacer SELECT sobre
--     ad_zones (decisión de diseño: se consulta EXCLUSIVAMENTE vía RPC).
--     Matiz medido por el guardián: una violación de RLS TAMBIÉN levanta
--     42501, así que además de la impersonación real se inspecciona la
--     AUSENCIA del grant con has_table_privilege (no depende de RLS).
-- ════════════════════════════════════════════════════════════════════════════

select pg_temp.act_as('00000000-0000-0000-0000-000049130001', 'authenticated');
select throws_ok(
  $$ select count(*) from public.ad_zones $$,
  '42501', null,
  'GAPGRANT1_authenticated_no_puede_hacer_select_sobre_ad_zones_permission_denied_impersonacion_real'
);
reset role;

select is(
  has_table_privilege('authenticated', 'public.ad_zones', 'SELECT'),
  false,
  'GAPGRANT2_authenticated_no_tiene_el_grant_de_select_sobre_ad_zones_ausencia_real_no_solo_bloqueo_por_rls'
);

select * from finish();
rollback;
