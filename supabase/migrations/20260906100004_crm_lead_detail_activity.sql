-- Migración 20260906100004 — public.crm_lead_detail + public.lead_activity (subtarea 266.5,
-- exploración 045 "Rediseño CRM" §7.4/§12/§19.2). Aditiva pura: 2 funciones nuevas en `public`,
-- ninguna tabla tocada, ningún contrato publicado roto (§0.5 producción viva).
-- Rollback: supabase/migrations/rollbacks/20260906100004_crm_lead_detail_activity.sql
-- Tests: supabase/tests/103_crm_lead_detail_activity_test.sql (pgTAP, plan 59) — el contrato
-- completo (SEAMS, decisiones D-DEFAULTS/D-ORIGIN-KEYS/D-PRICE/D-OTHERPROPS/D-STATUSPROJ/
-- D-DELETED/D-KIND/D-DETAIL/D-SCOPE/D-CURSOR/D-AUTZ-SHARED, edge cases) está en la cabecera de
-- ese archivo; no se repite aquí para no duplicar la fuente de verdad.
--
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ: 2 RPC de lectura para la ficha expandida del CRM (fase D, exploración 045):
--   public.crm_lead_detail(p_lead_id) — propiedad de origen (la más antigua por
--     contacted_at), cuántas otras propiedades del agente sigue el mismo lead, y el próximo
--     estado sugerido (proyección 8→4 de §7.4, la MISMA que public.crm_leads_page/266.4).
--   public.lead_activity(p_lead_id, p_limit, p_cursor) — timeline unificado y paginado:
--     events_raw ∪ likes ∪ saves ∪ lead_status_history, cursor keyset por occurred_at.
--
-- ── D-AUTZ-SHARED — se REUSA private.can_view_lead tal cual, sin helper nuevo ──────────────
-- A diferencia de 266.4 (crm_leads_page/crm_funnel operan sobre "el pipeline del AGENTE
-- objetivo" y necesitaron private.can_manage_agent_pipeline porque can_view_lead exige un
-- lead_id concreto), AMBAS RPC de esta subtarea reciben p_lead_id directo — exactamente el
-- contrato de private.can_view_lead(p_lead_id uuid) (20260901000001), que YA resuelve la
-- matriz completa (dueño/owner/admin de agencia activa vía leads.agency_id, sin
-- private.is_admin() desde el fix #226). Repetir esa lógica aquí sería Duplicated Code sin
-- ganar nada (CLAUDE.md §0) — se llama al helper existente.
--
-- D-DELETED (hallazgo del RED, no supuesto): private.can_view_lead NO filtra `deleted_at` —
-- ninguna versión histórica de la función lo hizo (verificado en el catálogo real). El CUERPO
-- de AMBAS RPC agrega el filtro explícito `deleted_at is null` AL LEER la fila del lead,
-- ADEMÁS de can_view_lead — extiende CONCEPTUALMENTE 35_lead_privacy_test.sql (NO se edita ese
-- archivo) a este seam nuevo.
--
-- ── D-CURSOR — expansión del empate de frontera, sin romper el grupo ────────────────────────
-- Orden `occurred_at DESC, kind ASC`. Se calcula el `occurred_at` de la fila en la posición
-- p_limit (row_number sobre las filas YA filtradas por el cursor de entrada) como
-- "v_cutoff_ts"; la página devuelve TODA fila con `occurred_at >= v_cutoff_ts` — nunca solo
-- `rn <= p_limit`. Así, si 2+ filas empatan exactamente en esa frontera, ninguna queda
-- huérfana entre 2 páginas (el cursor de salida es un timestamp, no puede distinguirlas por
-- `kind`). Si menos de p_limit filas quedan (última página), v_cutoff_ts es NULL → coalesce a
-- '-infinity' → se devuelven todas.
--
-- ── D-KIND/D-DETAIL/D-SCOPE — union all con el mismo scope que private.can_view_user_events
--    (§19.2: "todas las publicaciones del agente") ───────────────────────────────────────────
-- events_raw/likes/saves se filtran por `user_id = v_user_id` (el usuario DE ESE lead) Y
-- `properties.owner_user_id = v_agent_id` (el agente DE ESE lead) — la MISMA frase que
-- private.can_view_user_events (20260809000001), aplicada aquí en vez de reusar ese helper
-- porque can_view_user_events recibe (user_id, property_id) por FILA y este seam necesita
-- filtrar un conjunto completo antes de UNION ALL con otras 3 fuentes (reusarlo exigiría una
-- subconsulta correlacionada por fila = 1 llamada SECURITY DEFINER por evento; el join directo
-- contra `properties` expresa la misma regla en O(1) scans, patrón batch de crm_leads_page).
-- lead_status_history se filtra directo por `lead_id = p_lead_id` (es inherentemente del lead,
-- no requiere el cruce usuario+agente).
--
-- Idempotente: create or replace function + revoke/grant repetibles.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1) public.crm_lead_detail
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.crm_lead_detail(p_lead_id uuid)
returns table (
  origin_property      jsonb,
  other_properties     integer,
  suggested_next_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status public.lead_status;
begin
  -- D-AUTZ-SHARED fail-closed: sin can_view_lead, vacío sin tocar la fila (anti-IDOR).
  -- coalesce a false: can_view_lead nunca debería devolver NULL, pero la defensa en
  -- profundidad es barata y ya es el patrón de crm_leads_page/crm_funnel (266.4).
  if not coalesce(private.can_view_lead(p_lead_id), false) then
    return;
  end if;

  -- D-DELETED: can_view_lead NO filtra deleted_at (hallazgo del RED) — se agrega aquí.
  select l.status into v_status
  from public.leads l
  where l.id = p_lead_id
    and l.deleted_at is null;

  if not found then
    return;
  end if;

  -- SELECT sin FROM: siempre 1 fila (aun si origin_property sale NULL por falta de
  -- lead_origin_properties) — un JOIN normal colapsaría a 0 filas y STATUS2-11 (que no tienen
  -- fila de origen en el fixture) perderían suggested_next_status.
  return query
  select
    (
      -- D-ORIGIN-KEYS: la fila con MENOR contacted_at (mismo criterio que
      -- get_lead_stats/crm_leads_page). D-PRICE: properties.price REAL, sin filtrar por
      -- price_visible (esa bandera protege al buscador en el feed público, no al dueño en su
      -- propio CRM).
      select jsonb_build_object(
        'property_id', lop.property_id,
        'address', p.address,
        'price', p.price,
        'thumbnail_url', (
          -- "Portada" = la MENOR position ACTIVA (deleted_at is null) de esa propiedad.
          select pv.thumbnail_url
          from public.property_videos pv
          where pv.property_id = lop.property_id
            and pv.deleted_at is null
          order by pv.position asc
          limit 1
        )
      )
      from public.lead_origin_properties lop
      join public.properties p on p.id = lop.property_id
      where lop.lead_id = p_lead_id
      order by lop.contacted_at asc
      limit 1
    ) as origin_property,
    -- D-OTHERPROPS: total de orígenes del lead, menos 1 (nunca negativo).
    greatest(
      (select count(*)::int from public.lead_origin_properties where lead_id = p_lead_id) - 1,
      0
    ) as other_properties,
    -- D-STATUSPROJ: proyección 8→4 EXACTA de public.crm_leads_page (266.4, §7.4), regla del
    -- botón aplicada AL PROYECTADO — Nuevo→contacted, Contactado→visit_scheduled,
    -- Visita/Cerrado→NULL (abre desplegable/Reabrir). Los 11 valores reales del enum,
    -- incluidos los 3 legacy (new, in_progress, closed_won).
    case v_status
      when 'whatsapp_opened' then 'contacted'
      when 'new'             then 'contacted'
      when 'contacted'       then 'visit_scheduled'
      when 'interested'      then 'visit_scheduled'
      when 'in_progress'     then 'visit_scheduled'
      when 'visit_scheduled' then null
      when 'closed_won_rent' then null
      when 'closed_won_sale' then null
      when 'closed_lost'     then null
      when 'discarded'       then null
      when 'closed_won'      then null
    end as suggested_next_status;
end;
$$;

comment on function public.crm_lead_detail(uuid) is
  'Cabecera de la ficha expandida del lead (subtarea 266.5, exploración 045 §7.4/§12): '
  'origin_property (fila de lead_origin_properties con menor contacted_at, precio REAL sin '
  'price_visible), other_properties (orígenes − 1), suggested_next_status (proyección 8→4 '
  'idéntica a crm_leads_page). D-AUTZ-SHARED: reusa private.can_view_lead + deleted_at '
  'explícito (can_view_lead no lo filtra) — fail-closed, 0 filas, nunca excepción.';

revoke execute on function public.crm_lead_detail(uuid) from public, anon;
grant execute on function public.crm_lead_detail(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) public.lead_activity
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.lead_activity(
  p_lead_id uuid,
  p_limit int default 20,
  p_cursor timestamptz default null
)
returns table (
  occurred_at timestamptz,
  kind        text,
  detail      jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_agent_id uuid;
  v_user_id  uuid;
begin
  -- D-AUTZ-SHARED + D-DELETED: idéntico a crm_lead_detail.
  if not coalesce(private.can_view_lead(p_lead_id), false) then
    return;
  end if;

  select l.agent_id, l.user_id into v_agent_id, v_user_id
  from public.leads l
  where l.id = p_lead_id
    and l.deleted_at is null;

  if not found then
    return;
  end if;

  return query
  with unified as (
    -- D-SCOPE: user_id = el usuario DE ESE lead, sobre propiedades DEL AGENTE DE ESE lead —
    -- misma frase que private.can_view_user_events (§19.2), aplicada en batch (no por fila).
    select
      er.created_at as occurred_at,
      er.event_type as kind,
      jsonb_build_object('property_id', er.property_id, 'payload', er.payload) as detail
    from public.events_raw er
    join public.properties p on p.id = er.property_id
    where er.user_id = v_user_id
      and p.owner_user_id = v_agent_id
    union all
    select
      lk.created_at,
      'like',
      jsonb_build_object('property_id', lk.property_id)
    from public.likes lk
    join public.properties p on p.id = lk.property_id
    where lk.user_id = v_user_id
      and p.owner_user_id = v_agent_id
    union all
    select
      sv.created_at,
      'save',
      jsonb_build_object('property_id', sv.property_id)
    from public.saves sv
    join public.properties p on p.id = sv.property_id
    where sv.user_id = v_user_id
      and p.owner_user_id = v_agent_id
    union all
    -- lead_status_history es inherentemente del lead — no requiere el cruce usuario+agente.
    select
      h.changed_at,
      'status_change',
      jsonb_build_object('old_status', h.old_status, 'new_status', h.new_status)
    from public.lead_status_history h
    where h.lead_id = p_lead_id
  ),
  filtered as (
    -- p_cursor = occurred_at de la ÚLTIMA fila de la página anterior; estrictamente menor
    -- (D-CURSOR). NULL = primera página.
    select * from unified u
    where p_cursor is null or u.occurred_at < p_cursor
  ),
  ranked as (
    select f.*, row_number() over (order by f.occurred_at desc, f.kind asc) as rn
    from filtered f
  ),
  cutoff as (
    -- occurred_at de la fila en la posición p_limit (si existe) — ancla de la expansión de
    -- empate. Si hay MENOS de p_limit filas (última página), esta CTE queda vacía.
    -- p_limit degenerado (0/NULL/negativo) se acota a >= 1: sin esto la CTE queda vacía y el
    -- coalesce('-infinity') abre la página COMPLETA (hallazgo del guardian, 266.5).
    select ranked.occurred_at as ts from ranked where rn = greatest(coalesce(p_limit, 20), 1)
  )
  -- D-CURSOR: la página es TODA fila >= el cutoff (nunca solo `rn <= p_limit`) — así un
  -- empate exacto sobre la frontera se devuelve COMPLETO, nunca partido entre 2 páginas.
  -- Sin cutoff (última página), coalesce a '-infinity' devuelve todo lo filtrado.
  select f.occurred_at, f.kind, f.detail
  from filtered f
  where f.occurred_at >= coalesce((select ts from cutoff), '-infinity'::timestamptz)
  order by f.occurred_at desc, f.kind asc;
end;
$$;

comment on function public.lead_activity(uuid, int, timestamptz) is
  'Timeline unificado y paginado de la ficha expandida (subtarea 266.5, exploración 045 '
  '§12/§19.2): union all de events_raw ∪ likes ∪ saves ∪ lead_status_history, D-SCOPE = misma '
  'frase que private.can_view_user_events (usuario del lead × propiedades del agente del '
  'lead), cursor keyset (occurred_at desc, kind asc) que EXPANDE el grupo empatado en la '
  'frontera de p_limit en vez de partirlo. D-AUTZ-SHARED: private.can_view_lead + deleted_at '
  'explícito, idéntico a crm_lead_detail.';

revoke execute on function public.lead_activity(uuid, int, timestamptz) from public, anon;
grant execute on function public.lead_activity(uuid, int, timestamptz) to authenticated;
