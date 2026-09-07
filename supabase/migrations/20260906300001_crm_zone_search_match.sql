-- Migración 20260906300001 — private.crm_temperature: zone_search emparejado
-- ESPACIALMENTE (subtarea 268.3, tarea 268 "CRM — señales nuevas"). Aditiva pura sobre
-- una función `private` ya existente (266.2, 20260906100001): create or replace con la
-- MISMA firma, mismo security definer/search_path/stable, mismo revoke. Ningún contrato
-- publicado se toca (§0.5 producción viva) — impacto-prod: sin riesgo. La función
-- alimenta crm_leads_page/crm_radar_anon (ya en producción) pero hoy hay 0 filas
-- zone_search en la base remota: este GREEN no mueve ninguna temperatura existente.
-- Rollback: supabase/migrations/rollbacks/20260906300001_crm_zone_search_match.sql
-- Tests: supabase/tests/106_crm_zone_search_test.sql (plan 31)
--
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ CAMBIA: el CTE `other_events` de 20260906100001 sumaba zone_search vía
--   `join properties p on p.id = er.property_id` -> owner, IGUAL que contact_repeat.
-- Pesaba 0 SIEMPRE: el contrato de 268.2 dicta que un evento zone_search NUNCA trae
-- property_id (payload = {kind:'neighborhood'|'municipality'|'area', ...}). properties
-- NO tiene columna municipality_id/neighborhood_id (solo location geography(Point)) —
-- corrección del analista sobre el doc 045, que asumía join por columna — así que la
-- zona se resuelve ESPACIALMENTE, mismo patrón que
-- properties_within_neighborhood/_municipality/_radius (20260813000002/20260902200002/
-- 20260706000001): ST_Intersects contra mx_neighborhoods.geom (neighborhood/municipality,
-- vía EXISTS para usar el GiST mx_neighborhoods_geom_gix) o ST_DWithin contra un punto
-- (area, vía properties_location_gix).
--
-- other_events se separa en dos CTEs:
--   contact_repeat: SIN CAMBIO — sigue por property_id -> owner (CONTACTREPEAT1).
--   zone_search: SIN join por property_id. Aporta crm_weight_zone_search cuando EXISTS
--     una propiedad de ORIGEN del lead ACTIVO del agente/usuario consultado
--     (lead_origin_properties -> active_lead, ya definido arriba en el WITH) dentro de
--     la zona del payload. `active_lead` ya está acotado a p_agent_id/p_user_id/deleted_at
--     is null, así que reusarlo aquí automáticamente:
--       - excluye leads borrados (NOLEAD1: 0 pese al match espacial),
--       - excluye propiedades de OTRO agente (OTHERAGENT1: active_lead de p_agent_id no
--         incluye el lead de otro agente aunque su origen esté en la misma zona),
--       - excluye eventos de OTRO usuario (er.user_id = p_user_id se mantiene).
--     El join viejo por property_id desaparece del todo (mata OLDJOIN1: una propiedad
--     DEL AGENTE que no matchea espacialmente ya no cuenta).
--
-- ── Payload malformado: parseo seguro en un CTE aparte (zone_search_parsed) ────────────
-- (er.payload->>'neighborhood_id')::bigint LANZA 22P02 con 'abc'. Un CASE WHEN <regex>
-- THEN <cast> END dentro de una expresión de SELECT es una posición de evaluación única
-- (garantiza no evaluar el cast si la guarda es falsa, semántica CASE del estándar SQL);
-- lo que NO está garantizado es meter la guarda y el cast como dos conjuntos ANDados en
-- un WHERE, porque el planner puede reordenar RestrictInfo de un WHERE de formas que no
-- preservan el orden textual. Por eso el parseo (neighborhood_id/lat/lng/radius_m) vive
-- en el SELECT de zone_search_parsed -- cada valor sale ya casteado o NULL -- y el EXISTS
-- de zone_search solo compara esos valores ya seguros (is not null / ST_Intersects /
-- ST_DWithin), sin cast alguno en su WHERE. {} y {"kind":"neighborhood"} sin id dan NULL
-- por ausencia de la clave (->> de una clave inexistente ya es NULL, no hace falta
-- guarda); 'abc' y kind desconocido dan NULL/false por la guarda. Los 4 casos MALFORMED
-- viven, dan 0 y no rompen la señal contact_repeat/contacto (verificado por lives_ok +
-- is en 106_*).
--
-- ── Índice en events_raw: NO se agrega (disparador c, techo con datos reales) ──────────
-- EXPLAIN ANALYZE local (0-10 filas events_raw, ver bitácora 268.3): Seq Scan sobre
-- events_raw, ~0.03 ms. Con ese volumen cualquier índice nuevo es prematuro
-- (// ponytail: sin índice — agregar cuando events_raw crezca y el plan real lo pida).
-- El costo del EXISTS espacial está acotado por afuera: pocas propiedades de origen por
-- lead (lead_origin_properties) y el cliente dedupea zone_search por sesión+zona antes
-- de escribir (268.2), así que el volumen de filas a evaluar por llamada es chico. Los
-- índices espaciales que SÍ importan (mx_neighborhoods_geom_gix, properties_location_gix)
-- ya existen desde 20260813000001/20260604000005.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function private.crm_temperature(
  p_agent_id uuid,
  p_user_id uuid,
  p_at timestamptz
)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_weight_video_completed'), 10) as w_video,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_max_video_completed'), 5)::int as max_video,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_weight_like'), 5) as w_like,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_weight_save'), 18) as w_save,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_weight_contact_first'), 30) as w_contact_first,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_weight_contact_repeat'), 30) as w_contact_repeat,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_weight_zone_search'), 8) as w_zone_search,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_decay_daily'), 0.08) as decay,
      coalesce((select (value::text)::numeric from public.app_config where key = 'crm_temp_floor_active_lead'), 0) as floor_active
  ),
  active_lead as (
    select l.id
    from public.leads l
    where l.agent_id = p_agent_id
      and l.user_id = p_user_id
      and l.deleted_at is null
  ),
  contacts as (
    -- 1ª fila por contacted_at = piso de entrada; el resto = re-contacto (§7.2). Solo del
    -- lead ACTIVO (join a active_lead: un lead borrado no aporta nada).
    select
      lop.contacted_at as ts,
      case when row_number() over (order by lop.contacted_at asc) = 1
           then cfg.w_contact_first
           else cfg.w_contact_repeat
      end as weight
    from public.lead_origin_properties lop
    join active_lead al on al.id = lop.lead_id
    cross join cfg
    where lop.contacted_at <= p_at
  ),
  video_events as (
    -- Tope crm_max_video_completed: cuentan los MÁS RECIENTES (order by desc + limit).
    select er.created_at as ts, cfg.w_video as weight
    from public.events_raw er
    join public.properties p on p.id = er.property_id
    cross join cfg
    where er.event_type = 'video_completed'
      and p.owner_user_id = p_agent_id
      and er.user_id = p_user_id
      and er.created_at <= p_at
    order by er.created_at desc
    limit (select max_video from cfg)
  ),
  contact_repeat_events as (
    -- Sin cambio (268.3): sigue por property_id -> owner, sin relación con lead alguno
    -- (CONTACTREPEAT1: cuenta aunque no exista lead_origin_properties/active_lead).
    select er.created_at as ts, cfg.w_contact_repeat as weight
    from public.events_raw er
    join public.properties p on p.id = er.property_id
    cross join cfg
    where er.event_type = 'contact_repeat'
      and p.owner_user_id = p_agent_id
      and er.user_id = p_user_id
      and er.created_at <= p_at
  ),
  zone_search_parsed as (
    -- Parseo seguro: cada valor sale casteado o NULL, nunca lanza (ver cabecera). ->> de
    -- una clave ausente ya es NULL (MALFORMED1/2 no necesitan guarda extra).
    select
      er.created_at as ts,
      er.payload->>'kind' as kind,
      case when er.payload->>'neighborhood_id' ~ '^\d+$'
        then (er.payload->>'neighborhood_id')::bigint end as neighborhood_id,
      er.payload->>'municipality_id' as municipality_id,
      case when er.payload#>>'{center,lat}' ~ '^-?\d+(\.\d+)?$'
        then (er.payload#>>'{center,lat}')::double precision end as center_lat,
      case when er.payload#>>'{center,lng}' ~ '^-?\d+(\.\d+)?$'
        then (er.payload#>>'{center,lng}')::double precision end as center_lng,
      case when er.payload->>'radius_m' ~ '^\d+(\.\d+)?$'
        then (er.payload->>'radius_m')::double precision end as radius_m
    from public.events_raw er
    where er.event_type = 'zone_search'
      and er.user_id = p_user_id
      and er.created_at <= p_at
  ),
  zone_search_events as (
    -- EXISTS acotado por active_lead (ya filtrado a p_agent_id/p_user_id/deleted_at is
    -- null): mata OLDJOIN1 (ya no hay join por property_id), NOLEAD1 (lead borrado no
    -- aparece en active_lead), OTHERAGENT1/OTHERUSER1 (el origen tiene que ser del lead
    -- ACTIVO de este agente+usuario, no de cualquier propiedad en la zona).
    select zsp.ts, cfg.w_zone_search as weight
    from zone_search_parsed zsp
    cross join cfg
    where exists (
      select 1
      from public.lead_origin_properties lop
      join active_lead al on al.id = lop.lead_id
      join public.properties p on p.id = lop.property_id
      where
        (
          zsp.kind = 'neighborhood'
          and zsp.neighborhood_id is not null
          and exists (
            select 1 from public.mx_neighborhoods n
            where n.id = zsp.neighborhood_id
              and extensions.ST_Intersects(p.location, n.geom)
          )
        )
        or (
          zsp.kind = 'municipality'
          and zsp.municipality_id is not null
          and exists (
            select 1 from public.mx_neighborhoods n
            where n.municipality_id = zsp.municipality_id
              and extensions.ST_Intersects(p.location, n.geom)
          )
        )
        or (
          zsp.kind = 'area'
          and zsp.center_lat is not null
          and zsp.center_lng is not null
          and zsp.radius_m is not null
          and extensions.ST_DWithin(
            p.location,
            extensions.ST_SetSRID(extensions.ST_Point(zsp.center_lng, zsp.center_lat), 4326)::extensions.geography,
            zsp.radius_m
          )
        )
    )
  ),
  likes_signal as (
    select l.created_at as ts, cfg.w_like as weight
    from public.likes l
    join public.properties p on p.id = l.property_id
    cross join cfg
    where p.owner_user_id = p_agent_id
      and l.user_id = p_user_id
      and l.created_at <= p_at
  ),
  saves_signal as (
    select s.created_at as ts, cfg.w_save as weight
    from public.saves s
    join public.properties p on p.id = s.property_id
    cross join cfg
    where p.owner_user_id = p_agent_id
      and s.user_id = p_user_id
      and s.created_at <= p_at
  ),
  all_signals as (
    select ts, weight from contacts
    union all select ts, weight from video_events
    union all select ts, weight from contact_repeat_events
    union all select ts, weight from zone_search_events
    union all select ts, weight from likes_signal
    union all select ts, weight from saves_signal
  ),
  totals as (
    select coalesce(sum(
      all_signals.weight * power(1 - cfg.decay, (extract(epoch from (p_at - all_signals.ts)))::numeric / 86400)
    ), 0) as raw_sum
    from all_signals
    cross join cfg
  )
  select least(100, round(greatest(
    case when exists (select 1 from active_lead) then (select floor_active from cfg) else 0 end,
    (select raw_sum from totals)
  )))::int;
$$;

comment on function private.crm_temperature(uuid, uuid, timestamptz) is
  'T1 (subtarea 266.2, exploración 045 §7.1; 268.3: zone_search emparejado '
  'ESPACIALMENTE): min(100, round(greatest(piso_activo, Σ w_i·(1−decay)^días))) sobre '
  'video_completed/likes/saves/contacto (lead activo) + contact_repeat (property_id -> '
  'owner) + zone_search (EXISTS de una propiedad de origen del lead ACTIVO dentro de la '
  'zona del payload -- ST_Intersects vía mx_neighborhoods para neighborhood/municipality, '
  'ST_DWithin para area; properties NO tiene columna de zona, solo location geography). '
  'Reloj SIEMPRE por p_at, nunca now(). Claves de app_config por COALESCE, NO sembradas. '
  'Helper interno de las RPC de 266.4–266.6 — sin EXECUTE para anon/authenticated.';

-- Defense-in-depth: SIN CAMBIO (266.2) — ningún rol de cliente tiene caso de uso legítimo.
revoke execute on function private.crm_temperature(uuid, uuid, timestamptz) from public, anon, authenticated;
