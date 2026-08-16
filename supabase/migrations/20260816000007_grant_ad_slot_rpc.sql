-- Migración 20260816000007 — RPC public.grant_ad_slot_atomic (service_role) +
-- siembra de app_config.ads_free (subtarea 169.3, exploración 039 "Tarea B").
--
-- Numeración: el plan original decía 20260815000012, pero eso correría ANTES
-- de 20260816000005_ads_schema.sql (169.1, crea ads/ad_zones/ad_creatives) y
-- 20260816000006_ads_state_machine.sql (169.2, crea el trigger de estados) --
-- corregido a 20260816000007 (mismo criterio que 169.1/169.2).
--
-- ── Propósito ────────────────────────────────────────────────────────────────
-- El admin otorga un slot de anuncio (ad + zonas + vigencia) en UNA sola
-- transacción, auditada en admin_actions. En beta no hay pago real: el admin
-- otorga el slot a mano (PRD §17.2) -- por eso app_config.ads_free = true,
-- calco exacto de video_slot_free (20260720000001_stream_schema.sql:73).
--
-- Contrato completo (firma, edge cases, invariantes 🔒): ver cabecera de
-- supabase/tests/49_grant_ad_slot_atomic_test.sql (RED, 2026-08-16).
--
-- ── Decisiones de esta migración ────────────────────────────────────────────
-- · Firma AMPLIADA respecto al plan original (p_agency_id, p_creative_id,
--   p_zones, p_days): ads.title/cta_type/cta_value son NOT NULL sin default
--   (20260816000005_ads_schema.sql:95-97) -- p_title/p_cta_type/p_cta_value se
--   insertan ANTES de p_zones, p_days sigue siendo el único parámetro con
--   DEFAULT, al final.
-- · Guard AGENCY_CANNOT_ADVERTISE (P0001) reusa private.org_can_advertise
--   (168.1, 20260815000001) tal cual -- NO reimplementa la consulta. Es el
--   guard hermano de AGENCY_CANNOT_PUBLISH_PROPERTIES de 168.3
--   (20260816000002_publish_property_atomic_capacity_guard.sql).
--   org_can_advertise ya compone "inexistente | soft-deleted | suspendida |
--   can_advertise=false" en un solo booleano -- las 4 causas caen en el mismo
--   código, no se inventa un AGENCY_NOT_FOUND separado.
-- · admin_id vía private.resolve_admin_actor() (mismo helper que
--   set_org_advertising_atomic/handle_ad_status_change) -- sin admin
--   identificado, el propio helper lanza P0001 STATUS_CHANGE_REQUIRES_ADMIN
--   (literal reusado, no inventado aquí).
-- · p_zones NULL o '[]' -> CERO filas en ad_zones -> inventario NACIONAL (D3
--   de 169.1). NO es un error de input -- validarlo como tal rompería el
--   modelo de venta. El INSERT por zona pasa municipality_id/neighborhood_id
--   TAL CUAL (sin validar XOR): un elemento con ambos ids no nulos revienta el
--   CHECK real ad_zones_exactly_one_scope (23514), sin que este RPC lo
--   enmascare (mismo criterio que 169.2 con ads_rejection_reason_matches_status).
-- · title/cta_type/cta_value se insertan TAL CUAL, sin transformar ni
--   revalidar formato -- esa validación vive en el cliente (169.6). El RPC es
--   service_role-only, el llamador es un admin, no una frontera de confianza
--   abierta.
-- · Atomicidad: SIN bloque `exception when others` que trague el error --
--   INSERT de ads, ad_zones y admin_actions corren en la MISMA invocación de
--   función (mismo statement top-level); si cualquiera falla, Postgres revierte
--   TODOS los efectos de la sentencia (patrón literal de moderate_property_atomic
--   / set_org_advertising_atomic / handle_ad_status_change -- ninguno usa
--   BEGIN/EXCEPTION propio).
--
-- Idempotente: create or replace function, insert ... on conflict do nothing
-- para la siembra de ads_free (patrón video_slot_free).
-- Rollback: supabase/migrations/rollbacks/20260816000007_grant_ad_slot_rpc.sql

-- ════════════════════════════════════════════════════════════════════════════
-- 1) RPC public.grant_ad_slot_atomic — SOLO service_role.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.grant_ad_slot_atomic(
  p_agency_id   uuid,
  p_creative_id uuid,
  p_title       text,
  p_cta_type    ad_cta_type,
  p_cta_value   text,
  p_zones       jsonb,
  p_days        int default 30
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
  v_ad_id    uuid;
  v_zone     jsonb;
begin
  -- Guard de capacidad (168.1, hermano de AGENCY_CANNOT_PUBLISH_PROPERTIES):
  -- compone inexistente | soft-deleted | suspendida | can_advertise=false en
  -- el MISMO código -- no se distingue "no existe" de "no puede anunciarse".
  if not private.org_can_advertise(p_agency_id) then
    raise exception 'AGENCY_CANNOT_ADVERTISE' using errcode = 'P0001';
  end if;

  -- Defensa en profundidad: exige un admin identificado ANTES de crear nada,
  -- aunque el caller ya tenga GRANT de tabla (service_role). Sin admin ->
  -- P0001 STATUS_CHANGE_REQUIRES_ADMIN (el propio helper lo lanza).
  v_admin_id := private.resolve_admin_actor();

  -- El ad nace SIEMPRE en 'draft' -- este RPC NO lo activa, "jamás se sirve
  -- sin moderación" sigue siendo responsabilidad exclusiva del trigger de
  -- 169.2 (handle_ad_status_change). title/cta_type/cta_value tal cual, sin
  -- transformar ni revalidar formato (esa validación vive en 169.6).
  insert into public.ads (
    agency_id, creative_id, title, cta_type, cta_value, starts_at, ends_at
  )
  values (
    p_agency_id, p_creative_id, p_title, p_cta_type, p_cta_value,
    now(), now() + p_days * interval '1 day'
  )
  returning id into v_ad_id;

  -- p_zones NULL o '[]' -> jsonb_array_elements no itera -> 0 filas en
  -- ad_zones -> inventario NACIONAL (D3 de 169.1, NO es un error). Cada
  -- elemento se pasa TAL CUAL: un elemento con ambos ids no nulos revienta el
  -- CHECK real ad_zones_exactly_one_scope (23514) sin que este RPC lo
  -- enmascare ni lo revalide por su cuenta.
  for v_zone in select * from jsonb_array_elements(coalesce(p_zones, '[]'::jsonb))
  loop
    insert into public.ad_zones (ad_id, municipality_id, neighborhood_id)
    values (
      v_ad_id,
      v_zone ->> 'municipality_id',
      (v_zone ->> 'neighborhood_id')::bigint
    );
  end loop;

  -- Auditoría SIEMPRE, en la MISMA transacción/statement: si este INSERT
  -- falla, TODO lo anterior (ad + zonas) se revierte también (atomicidad
  -- real, sin bloque EXCEPTION propio -- patrón moderate_property_atomic /
  -- set_org_advertising_atomic).
  insert into public.admin_actions (
    admin_id, action_type, entity_type, entity_id, new_values
  )
  values (
    v_admin_id,
    'grant_ad_slot',
    'ad',
    v_ad_id,
    jsonb_build_object(
      'agency_id', p_agency_id,
      'creative_id', p_creative_id,
      'days', p_days
    )
  );

  return v_ad_id;
end;
$$;

comment on function public.grant_ad_slot_atomic(uuid, uuid, text, ad_cta_type, text, jsonb, int) is
  'Otorga un slot de anuncio (subtarea #169.3): crea el ad (status=draft), sus '
  'ad_zones (0 filas = inventario nacional, D3 de 169.1) y audita en '
  'admin_actions, TODO en la misma transacción -- si el INSERT de ad_zones o '
  'el de admin_actions falla, rollback total (ni ad huérfano ni zonas '
  'sueltas). Guard AGENCY_CANNOT_ADVERTISE reusa private.org_can_advertise '
  '(168.1). admin_id vía private.resolve_admin_actor(). SOLO service_role -- '
  'lo invoca el admin de Urbea desde Studio/CLI (sin pago real en beta, PRD '
  '§17.2). NO revalida formato de cta_value contra cta_type (esa validación '
  'vive en el cliente, 169.6).';

revoke execute on function public.grant_ad_slot_atomic(uuid, uuid, text, ad_cta_type, text, jsonb, int)
  from public, anon, authenticated;
grant execute on function public.grant_ad_slot_atomic(uuid, uuid, text, ad_cta_type, text, jsonb, int)
  to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Siembra app_config.ads_free — calco exacto de video_slot_free
--    (20260720000001_stream_schema.sql:73): en beta el slot lo otorga el
--    admin a mano y NINGÚN pago real ocurre.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.app_config (key, value) values
  ('ads_free', 'true'::jsonb)
on conflict (key) do nothing;
