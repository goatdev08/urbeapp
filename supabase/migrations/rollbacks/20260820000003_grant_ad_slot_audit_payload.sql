-- Rollback: 20260820000003_grant_ad_slot_audit_payload.sql (tarea #182)
--
-- Restaura grant_ad_slot_atomic al cuerpo de 20260816000007 — es decir, con
-- new_values sin `ends_at` ni `zones`. Re-ejecutable (create or replace).
--
-- ⚠️ Revertir NO borra las auditorías ya escritas con los campos nuevos: las
-- filas viejas conservan lo que tuvieran. Lo que se pierde es la garantía
-- hacia adelante, y con ella la capacidad de reconstruir qué zonas se
-- vendieron si ad_zones se edita después.

CREATE OR REPLACE FUNCTION public.grant_ad_slot_atomic(p_agency_id uuid, p_creative_id uuid, p_title text, p_cta_type ad_cta_type, p_cta_value text, p_zones jsonb, p_days integer DEFAULT 30)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
