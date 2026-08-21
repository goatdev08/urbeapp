-- Migración 20260821000001 — RPC public.ad_metrics_for_agency (subtarea #171.1,
-- exploración 039 "Tarea D", panel del anunciante). Aditiva pura: función nueva,
-- ninguna tabla tocada, ningún contrato publicado roto (§0.5 producción viva).
-- Rollback: supabase/migrations/rollbacks/20260821000001_ad_metrics_for_agency.sql
-- Tests: supabase/tests/62_ad_metrics_for_agency_test.sql (plan 49)
--
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ: métricas agregadas por zona (municipio/colonia) para el panel del
-- anunciante, con dos defensas de privacidad que son la razón de ser de esta
-- función (no un detalle de implementación):
--   1) 🔒 k-anonimato = count(distinct user_id) >= 5, NUNCA count(*). Un
--      umbral por impresiones no protege a nadie: una sola persona que ve el
--      anuncio 6 veces desbloquearía el desglose de su propia colonia con
--      n=1 — exactamente la re-identificación que el k-anonimato existe para
--      impedir. Decisión de Abraham (2026-08-20, PLAN de la subtarea): gana
--      usuarios distintos, aunque cueste ver más zonas colapsadas al
--      principio con poca audiencia. Es el error correcto en privacidad.
--   2) 🔒 La respuesta jamás lleva user_id ni session_id, ni hasheados. El
--      retorno tiene 5 columnas y ninguna describe a una persona.
-- Y una tercera invariante que es de dinero: colapsar NUNCA pierde
-- impresiones — suma(zonas desglosadas) + fila "otras zonas" == total real
-- (facturable, base de #172 CPM/CPC). Un anunciante que ve menos de lo que
-- pagó es un problema comercial.
--
-- ── Bucket de colapso ("otras zonas") ─────────────────────────────────────
-- Fila (municipality_id IS NULL AND neighborhood_id IS NULL). Las
-- impresiones cuya zona nunca resolvió (ad_impressions.municipality_id/
-- neighborhood_id ya nacen NULL/NULL — comentario de 20260817000002: "una
-- impresión puede no resolver zona") caen ahí por construcción, sin caso
-- especial: comparten la misma llave (NULL, NULL) que las zonas colapsadas
-- por privacidad. Decisión de producto (test-author, D-OTRASZONAS en el RED):
-- el anunciante no necesita distinguir "no sabemos dónde fue" de "es muy
-- poca gente para mostrarlo sin re-identificar" — ambas son "no es una zona
-- específica".
--
-- ── Por qué SOLO ad_impressions, nunca ad_impressions_monthly (D2 del PLAN) ─
-- ad_impressions_monthly (20260817000002) tiene CERO escritores en todo el
-- repo fuera de su propia migración — verificado con grep sobre supabase/ y
-- mobile/, excluyendo tests y rollbacks. Su propia migración dice
-- literalmente que el job de rollup es "trabajo futuro". La tabla está
-- vacía y se queda vacía. Un UNION con ella hoy aportaría exactamente cero
-- filas, y el día que el rollup exista DOBLE-CONTARÍA los 90 días que viven
-- en ambas tablas — sobre datos que se facturan (#172). Un "union listo
-- para el futuro" es una defensa que solo existe en la prosa hasta que el
-- rollup exista de verdad, con un doble conteo latente de regalo. Decisión
-- de Abraham: agregar únicamente desde ad_impressions.
--
-- ponytail: TECHO CONOCIDO — pasados 90 días el crudo se purga
-- (pg_cron purge_ad_impressions_daily) y el anunciante pierde el histórico
-- más allá de esa ventana. Hoy no duele (no hay tráfico real todavía) pero
-- es real. Derivada creada: #201 hardening(170.5) — job de rollup + extender
-- este RPC más allá de los 90 días sin doble contar (backlink en #170).
--
-- ── Rango p_from/p_to ──────────────────────────────────────────────────────
-- Filtra por shown_at (cuándo se vio el anuncio — el timestamp natural para
-- un reporte de fechas), NUNCA created_at (metadata de inserción). Frontera
-- INCLUSIVA en ambos extremos. NULL = sin límite por ese lado. El
-- k-anonimato se re-evalúa SOBRE el conjunto YA filtrado por rango: una zona
-- que desgloza sin rango puede colapsar con un rango angosto.
--
-- ── security definer + autorización explícita en el cuerpo ────────────────
-- ad_impressions tiene RLS habilitado sin NINGUNA policy (fail-closed total,
-- ver 20260817000002) — cualquier lectura agregada tiene que ser security
-- definer, así que la autorización vive EXPLÍCITA aquí (bypassa RLS por
-- ownership de función), patrón EXACTO de public.get_lead_stats
-- (20260808000002): set search_path = '' + todo el cuerpo calificado por
-- schema (public./private.) evita search_path hijacking.
-- AUTZ fail-closed, las DOS condiciones (no una), reusando los helpers YA
-- existentes (no se escriben otros):
--   private.agency_role_of(p_agency_id) is not null — CUALQUIER rol activo
--     (owner/admin/agent/viewer) sirve; el helper ya filtra status='active'
--     (20260805000003:14), así que suspended da NULL igual que un no-miembro.
--   and private.org_can_advertise(p_agency_id) — capacidad encendida,
--     organización activa, no borrada (20260815000001:57).
-- 🔴 Anti-IDOR: sin autorización, el WHERE simplemente no matchea nada —
-- 0 filas, NUNCA una excepción. Un error distinguible confirmaría que el
-- recurso existe.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.ad_metrics_for_agency(
  p_agency_id uuid,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  municipality_id text,
  neighborhood_id bigint,
  impressions integer,
  views integer,
  cta_taps integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Anti-IDOR fail-closed: sin las DOS autorizaciones, devuelve vacío sin
  -- tocar ad_impressions — nunca una excepción que distinga "no existe" de
  -- "no es tuya" de "no tiene la capacidad".
  if private.agency_role_of(p_agency_id) is null
     or not private.org_can_advertise(p_agency_id) then
    return;
  end if;

  return query
  with scoped as (
    -- Filtro de autorización ya resuelto arriba; aquí solo agencia + rango
    -- por shown_at, frontera inclusiva en ambos extremos (NULL = sin límite).
    select
      ai.user_id,
      ai.municipality_id,
      ai.neighborhood_id,
      ai.viewed,
      ai.cta_tapped_at
    from public.ad_impressions ai
    where ai.agency_id = p_agency_id
      and (p_from is null or ai.shown_at >= p_from)
      and (p_to is null or ai.shown_at <= p_to)
  ),
  zone_stats as (
    -- Una fila por zona (municipality_id, neighborhood_id) con sus 3
    -- contadores y el conteo de usuarios distintos que decide el colapso.
    select
      s.municipality_id,
      s.neighborhood_id,
      count(*)::integer as impressions,
      count(*) filter (where s.viewed)::integer as views,
      count(*) filter (where s.cta_tapped_at is not null)::integer as cta_taps,
      count(distinct s.user_id) as distinct_users,
      -- Una "zona real" es la que resolvió al menos uno de los dos campos. El
      -- grupo (NULL, NULL) NO es una zona: es la ausencia de zona, y por eso
      -- nunca puede desglosarse por su cuenta por muchos usuarios que tenga.
      (s.municipality_id is not null or s.neighborhood_id is not null) as is_real_zone
    from scoped s
    group by s.municipality_id, s.neighborhood_id
  )
  -- Zonas REALES con k-anonimato >= 5 usuarios distintos: se desglosan tal cual.
  -- 🔴 `is_real_zone` NO es redundante (hallazgo del guardián, EDGE12b): sin
  -- él, un grupo (NULL, NULL) con 5+ usuarios distintos salía por ESTA rama Y
  -- otra vez por el bucket de abajo — dos filas con la MISMA llave. No perdía
  -- datos, por eso los asserts de conservación de totales no lo veían, pero
  -- contradecía el contrato ("nunca como su propia fila aparte") y le entregaba
  -- al cliente una llave duplicada: el gotcha de FlatList "same key" ya pagado
  -- en este repo. Y no es teórico: la zona no resuelve cuando el GPS está
  -- apagado o el punto cae fuera de polígono, así que 5 dispositivos distintos
  -- sin zona es lo normal, no lo raro.
  select
    z.municipality_id,
    z.neighborhood_id,
    z.impressions,
    z.views,
    z.cta_taps
  from zone_stats z
  where z.is_real_zone
    and z.distinct_users >= 5

  union all

  -- Bucket "otras zonas", UNA sola fila. Funde dos orígenes que para el
  -- anunciante significan lo mismo ("no es una zona específica"): las zonas
  -- reales colapsadas por privacidad (< 5 usuarios distintos) y las que ya
  -- nacieron sin resolver, sin importar cuántos usuarios tengan. Solo aparece
  -- si hay algo que agregar (evita una fila 0/0/0 cuando no hay nada que
  -- colapsar).
  select
    null::text as municipality_id,
    null::bigint as neighborhood_id,
    sum(z.impressions)::integer as impressions,
    sum(z.views)::integer as views,
    sum(z.cta_taps)::integer as cta_taps
  from zone_stats z
  where not z.is_real_zone
     or z.distinct_users < 5
  having sum(z.impressions) is not null;
end;
$$;

comment on function public.ad_metrics_for_agency(uuid, timestamptz, timestamptz) is
  'Métricas agregadas por zona (municipio/colonia) para el panel del anunciante '
  '(subtarea #171.1). Agrega SOLO desde ad_impressions (ad_impressions_monthly está '
  'vacía y sin escritor — un union hoy doble-contaría cuando exista el rollup, ver '
  'cabecera de la migración). k-anonimato: count(distinct user_id) >= 5 decide si una '
  'zona se desglosa; con menos, colapsa en la fila (NULL, NULL) "otras zonas" sin '
  'perder totales. La respuesta NUNCA incluye user_id ni session_id. security '
  'definer + autorización explícita en el cuerpo (private.agency_role_of + '
  'private.org_can_advertise, patrón public.get_lead_stats): sin autorización, 0 '
  'filas, nunca una excepción (anti-IDOR).';

-- Defense-in-depth (lineamientos: RLS/seguridad NO sujeta a minimalismo, mismo
-- criterio que get_lead_stats/properties_within_radius): revoca el EXECUTE que
-- Postgres concede a PUBLIC por defecto; anon no tiene caso de uso legítimo.
revoke execute on function public.ad_metrics_for_agency(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.ad_metrics_for_agency(uuid, timestamptz, timestamptz) to authenticated;
