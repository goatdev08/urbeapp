-- Migración 20260820000003 — grant_ad_slot_atomic audita zones y ends_at (#182).
--
-- POR QUÉ. El INSERT en admin_actions escribía new_values, pero ningún assert
-- verificaba su contenido: el guardián de 169.3 demostró (mutante M20) que
-- vaciarlo a '{}' pasaba los 55 asserts de 49_grant_ad_slot_atomic_test.sql.
-- Al ir a asertarlo se vio que además faltaba contenido.
--
-- CRITERIO: la auditoría debe permitir reconstruir el acto SIN volver a
-- consultar las tablas que el acto modificó — porque esas pueden haber
-- cambiado después. Con eso, `days` y `zones` son insuficientes tal como
-- estaban:
--   · `days` sin fecha de referencia no da la vigencia → se agrega `ends_at`,
--     tomado del RETURNING del propio INSERT para que sea el MISMO valor que
--     quedó en la fila, nunca uno recalculado aparte.
--   · las zonas otorgadas no aparecían por ningún lado → se agrega `zones`,
--     con coalesce a '[]' para que el inventario NACIONAL sea afirmable.
--
-- Los otros dos escritores de auditoría del dominio (handle_ad_status_change y
-- el de agencias, 20260816000006) NO se tocan: su payload {status} ya es
-- suficiente para reconstruir el acto — ahí lo que faltaba era el assert, y
-- eso vive en supabase/tests/58_audit_new_values_test.sql.
--
-- ADITIVA y sin riesgo (§0.5): `create or replace` de una función; no cambia
-- su firma, ni sus grants, ni el shape de lo que devuelve. Solo agrega dos
-- claves a un jsonb de auditoría que nadie lee todavía (#81 lo leerá).
-- Idempotente: create or replace repetible.
-- Rollback: supabase/migrations/rollbacks/20260820000003_grant_ad_slot_audit_payload.sql

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
  v_ends_at  timestamptz;
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
  returning id, ends_at into v_ad_id, v_ends_at;

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
    -- #182: la auditoría debe permitir reconstruir el acto SIN volver a
    -- consultar las tablas que el acto modificó, porque esas pueden haber
    -- cambiado después. Por eso viajan también:
    --   · ends_at — `days` sin fecha de referencia no da la vigencia.
    --   · zones   — si alguien edita ad_zones más tarde, sin esto la
    --               auditoría ya no puede decir qué se vendió originalmente.
    --     coalesce a '[]' para que el inventario NACIONAL sea AFIRMABLE
    --     (arreglo vacío) y no indistinguible de "no se registró" (clave
    --     ausente). Se guarda p_zones TAL CUAL se recibió, que es lo que el
    --     admin efectivamente pidió.
    jsonb_build_object(
      'agency_id', p_agency_id,
      'creative_id', p_creative_id,
      'days', p_days,
      'ends_at', v_ends_at,
      'zones', coalesce(p_zones, '[]'::jsonb)
    )
  );

  return v_ad_id;
end;
$function$;
