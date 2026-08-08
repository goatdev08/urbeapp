-- Migración 20260808000002 — RPC public.get_lead_stats: estadísticas tangibles del lead,
-- con el LIKE como filtro de entrada (subtarea 112.3, origen: producto(75.2) "estadísticas
-- tangibles del lead" -> tarea 112). Consumo agregado de los datos crudos que habilita
-- 112.1 (RLS de events_raw, 20260808000001) + likes/saves (0006).
--
-- QUÉ: public.get_lead_stats(p_lead_ids uuid[]) devuelve, por cada lead_id que (a) el
-- caller puede ver (private.can_view_lead, REUSADO tal cual — 20260807000006, NO se
-- escribe un helper nuevo) Y (b) el usuario del lead dio like a la propiedad de origen del
-- lead: {lead_id, vio_completo, veces_visto, guardo, ultima_actividad}. Si (a) o (b) no se
-- cumplen, ese lead_id simplemente NO aparece en el resultset (ni una fila parcial) — el
-- gate central del producto: los datos se REGISTRAN siempre (events_raw/saves), pero solo
-- se MUESTRAN tras el like (decisión del dueño, 2026-08-08).
--
-- ── POR QUÉ security definer, no una vista security_invoker ──────────────────────────────
-- Las policies de public.likes/public.saves (0006, patrón user_id = auth.uid()) solo dejan
-- leer al PROPIO usuario. Con security_invoker el caller sería el agente/owner, que nunca
-- es dueño de esas filas (son del buscador) -> la vista devolvería SIEMPRE vacío. security
-- definer corre como el owner de la función (postgres, bypasea RLS por ownership de tabla),
-- así que la autorización tiene que vivir EXPLÍCITA en el cuerpo (can_view_lead + el gate
-- del like), no delegada a RLS. set search_path = '' + todo el cuerpo calificado por schema
-- (public./private.) evita la clase de vulnerabilidad de search_path hijacking en funciones
-- SECURITY DEFINER (mismo criterio que private.compute_lead_level, 20260807000007).
--
-- ── "la propiedad de origen del lead" cuando hay ambigüedad ───────────────────────────────
-- public.leads NO tiene columna origin_property_id propia; el origen vive en
-- lead_origin_properties (0..N filas por lead). Se usa la fila con MENOR contacted_at (el
-- primer contacto) — decisión documentada en el RED (34_lead_stats_rpc_test.sql:33-41), no
-- se prueba el caso de múltiples orígenes por lead aquí (fuera de alcance de 112.3).
--
-- ── el gate del like es POR LA PROPIEDAD DE ORIGEN, no "cualquier like" ───────────────────
-- public.likes ya trae property_id denormalizado (migración 0006) — el gate consulta
-- likes.user_id = lead.user_id AND likes.property_id = <origen>, nunca "algún like en
-- cualquier propiedad del agente". Se usa EXISTS (no JOIN) para el gate: un usuario puede
-- tener MÁS de un like sobre la misma propiedad (videos distintos, likes.property_video_id
-- no es único por property_id) — un JOIN directo produciría fanout y duplicaría
-- veces_visto/vio_completo en el agregado siguiente. El máximo del like (para
-- ultima_actividad) se resuelve aparte con un `max()` escalar, mismo motivo.
--
-- ── batch vía arreglo, sin N+1 (diseño obligado por la subtarea) ──────────────────────────
-- p_lead_ids uuid[] + returns setof: el CRM pinta una lista completa con UNA sola llamada
-- RPC, no un round-trip por lead. Los CTE (candidate_leads -> origin -> gated) filtran
-- antes de agregar, así que solo se calculan estadísticas para los leads que califican.
--
-- ── ultima_actividad = máximo real entre fuentes, no solo el like ─────────────────────────
-- greatest(max(events_raw.created_at), max(likes.created_at), saves.created_at) — NULLs se
-- ignoran (GREATEST solo es NULL si TODOS los argumentos lo son; siempre hay al menos el
-- like, por el gate). Los eventos considerados son video_view/video_completed (las 2 únicas
-- fuentes de events_raw que alimentan vio_completo/veces_visto en este RPC) — otros
-- event_type (p.ej. app_open) no aportan a estas 4 estadísticas y quedan fuera del máximo.
--
-- ── veces_visto / vio_completo ─────────────────────────────────────────────────────────────
-- count(*) filter (where event_type = 'video_view') y bool_or(event_type = 'video_completed')
-- sobre events_raw filtrado por (user_id, property_id) = (lead.user_id, origen) — usa el
-- índice events_raw_user_property_idx (20260808000001). Con LEFT JOIN vacío (sin eventos)
-- ambos agregados dan NULL -> coalesce a 0/false (EDGE2: like sin ningún evento de video).
--
-- Autorización (hereda de can_view_lead, no reimplementa nada — evita la clase de fuga de
-- #100/75.5-bis): agente dueño del lead, OR owner/admin de la agencia REAL donde nació el
-- lead (leads.agency_id, agency_role_of), OR admin de plataforma.
--
-- Idempotente: create or replace function, revoke/grant repetibles.
-- Tests: supabase/tests/34_lead_stats_rpc_test.sql (plan 9 — HP1/HP2, EDGE1-4, RAMA1,
-- AISLA1-2). El stub transaccional del archivo se retira en este mismo cambio (GREEN): de
-- lo contrario pisaría esta función DENTRO de la transacción de test y se probaría el stub,
-- no la migración real.
-- Rollback: supabase/migrations/rollbacks/20260808000002_get_lead_stats_rpc.sql

create or replace function public.get_lead_stats(p_lead_ids uuid[])
returns table (
  lead_id          uuid,
  vio_completo     boolean,
  veces_visto      integer,
  guardo           boolean,
  ultima_actividad timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return query
  with candidate_leads as (
    -- (a) autorización: solo leads que el caller puede ver, vía el helper existente.
    select l.id as lead_id, l.user_id
    from public.leads l
    where l.id = any(p_lead_ids)
      and private.can_view_lead(l.id)
  ),
  origin as (
    -- "propiedad de origen" = el primer contacto (menor contacted_at) por lead.
    select distinct on (lop.lead_id)
      lop.lead_id, lop.property_id
    from public.lead_origin_properties lop
    join candidate_leads cl on cl.lead_id = lop.lead_id
    order by lop.lead_id, lop.contacted_at asc
  ),
  gated as (
    -- (b) el gate del like: EXISTS, no JOIN (evita fanout si el usuario likeó > 1 video de
    -- la misma propiedad). Sin like -> el lead simplemente no aparece (EDGE1).
    select o.lead_id, o.property_id, cl.user_id
    from origin o
    join candidate_leads cl on cl.lead_id = o.lead_id
    where exists (
      select 1 from public.likes lk
      where lk.user_id = cl.user_id
        and lk.property_id = o.property_id
    )
  )
  select
    g.lead_id,
    coalesce(bool_or(ev.event_type = 'video_completed'), false) as vio_completo,
    coalesce(count(*) filter (where ev.event_type = 'video_view'), 0)::integer as veces_visto,
    exists (
      select 1 from public.saves sv
      where sv.user_id = g.user_id and sv.property_id = g.property_id
    ) as guardo,
    greatest(
      max(ev.created_at),
      (select max(lk.created_at) from public.likes lk
        where lk.user_id = g.user_id and lk.property_id = g.property_id),
      (select sv.created_at from public.saves sv
        where sv.user_id = g.user_id and sv.property_id = g.property_id)
    ) as ultima_actividad
  from gated g
  left join public.events_raw ev
    on ev.user_id = g.user_id
   and ev.property_id = g.property_id
   and ev.event_type in ('video_view', 'video_completed')
  group by g.lead_id, g.user_id, g.property_id;
end;
$$;

comment on function public.get_lead_stats(uuid[]) is
  'Estadísticas tangibles del lead (subtarea 112.3): por cada lead_id visible para el '
  'caller (private.can_view_lead) cuyo usuario dio like a la propiedad de origen '
  '(lead_origin_properties, primer contacto), devuelve vio_completo/veces_visto/guardo/ '
  'ultima_actividad agregados desde events_raw+likes+saves. Sin like -> sin fila (gate '
  'central del producto, ver decisión del dueño 2026-08-08). security definer: las RLS de '
  'likes/saves solo dejan leer al propio usuario, así que la autorización real vive en el '
  'cuerpo (can_view_lead + el gate), no en RLS.';

-- Defense-in-depth (lineamientos: RLS/seguridad NO sujeta a minimalismo, mismo criterio que
-- properties_within_radius, 20260706000001): revoca el EXECUTE que Postgres concede a
-- PUBLIC por defecto y lo otorga explícito solo a authenticated — anon no tiene caso de uso
-- legítimo (el CRM vive detrás del auth wall).
revoke execute on function public.get_lead_stats(uuid[]) from public, anon;
grant execute on function public.get_lead_stats(uuid[]) to authenticated;
