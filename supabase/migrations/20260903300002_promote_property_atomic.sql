-- Migración 20260903300002 — RPC public.promote_property_atomic (tarea #213,
-- subtarea 213.2). ADITIVA: función nueva, cero cambios de esquema.
--
-- ── El producto ─────────────────────────────────────────────────────────────
-- "Promocionar publicación" (exploración 040, decisiones 2-5 de Abraham
-- 2026-08-23): un miembro con permiso de PUBLICAR toma una propiedad ya activa
-- de su organización y la manda a moderación como anuncio. Sin creativo nuevo,
-- sin CTA, sin selector de alcance y sin pago: municipio heredado, 30 días
-- fijos, UN paso. El gate es la moderación.
--
-- ── 🔒 DOS PRODUCTOS, DOS GATES ─────────────────────────────────────────────
-- Esta RPC es hermana de create_ad_campaign_atomic (20260820000005) y calca su
-- estructura, pero NO su guard. `private.org_can_advertise` es el gate del
-- anuncio DISPLAY (creativo propio + CTA, modelo "Ads Manager"). La promo es
-- el "boost": la abre el permiso de PUBLICAR. Reusar aquí org_can_advertise
-- sería el bug silencioso más fácil de introducir — dejaría la feature muerta
-- para toda organización que solo publica, que son casi todas. El assert
-- HAPPY11/HAPPY12 de la suite 88 promociona precisamente desde una
-- organización con can_advertise=false.
--
-- ── 🔒 Nada que identifique al actor viaja como parámetro ───────────────────
-- El único argumento es la propiedad. El actor sale de `auth.uid()` y la
-- organización sale de la PROPIEDAD, nunca del cliente (mismo criterio que
-- #191 con la agencia y #193 con el id de impresión: no se blinda un dato que
-- el cliente controla, se deja de aceptar).
--
-- ── Anti-enumeración ────────────────────────────────────────────────────────
-- Cuatro causas distintas comparten el código PROPERTY_NOT_FOUND (no existe ·
-- soft-deleted · sin agency_id · el caller no puede publicar en esa
-- organización). Distinguirlas convertiría la RPC en un oráculo de qué
-- propiedades existen y de quién son — el mismo criterio que CREATIVE_NOT_FOUND
-- en create_ad_campaign_atomic.
--
-- Idempotente: create or replace + revoke/grant repetibles.
-- Rollback: supabase/migrations/rollbacks/20260903300002_promote_property_atomic.sql
-- Tests: supabase/tests/88_promote_property_atomic_test.sql

create or replace function public.promote_property_atomic(p_property_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_id       uuid;
  v_agency_id       uuid;
  v_status          public.property_status;
  v_address         text;
  v_point           extensions.geometry;
  v_municipality_id text;
  v_ad_id           uuid;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  select p.agency_id, p.status, p.address, p.location::extensions.geometry
    into v_agency_id, v_status, v_address, v_point
  from public.properties p
  where p.id = p_property_id
    and p.deleted_at is null;

  -- Las cuatro causas en una sola condición y un solo código. `v_agency_id is
  -- null` cubre a la vez "la propiedad no existe / está borrada" (el SELECT no
  -- trajo fila) y "es de un agente independiente" (agency_id NULL en la fila):
  -- promocionar es un producto de ORGANIZACIONES, y en ambos casos la
  -- respuesta correcta es la misma.
  --
  -- El predicado de "miembro con permiso de publicar" NO se inventa aquí: es
  -- literalmente el de la policy properties_insert (20260805000009:144-150).
  -- Si algún día cambia quién puede publicar, promocionar debe cambiar con él
  -- — por eso se expresa con los mismos dos helpers y no con una consulta
  -- propia a agency_members.
  if v_agency_id is null
     or private.current_user_role() not in ('agent', 'admin')
     or private.agency_role_of(v_agency_id) is null
  then
    raise exception 'PROPERTY_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Espejo de private.org_can_advertise con la capacidad de PUBLICAR. Se
  -- escribe inline en vez de crear private.org_can_publish porque hoy tiene un
  -- solo llamador; el día que aparezca el segundo (una policy, otra RPC), esto
  -- se extrae al helper y esa es la señal para hacerlo.
  -- ponytail: predicado inline, techo = un segundo consumidor.
  if not exists (
    select 1 from public.agencies ag
    where ag.id = v_agency_id
      and ag.deleted_at is null
      and ag.status = 'active'
      and ag.can_publish_properties
  ) then
    raise exception 'AGENCY_CANNOT_PUBLISH' using errcode = 'P0001';
  end if;

  if v_status <> 'active' then
    raise exception 'PROPERTY_NOT_PUBLISHED' using errcode = 'P0001';
  end if;

  -- Municipio HEREDADO de la propiedad. Se reusa public.resolve_ad_zone
  -- (20260819000002 + #194) en vez de repetir la resolución: esa función y
  -- ads_for_zone comparten el mismo `order by` palabra por palabra
  -- precisamente para que un anuncio no se sirva en un municipio y se cuente
  -- en otro. Una tercera copia aquí reabriría esa grieta.
  -- GOTCHA de orden: resolve_ad_zone(p_lat, p_lng) -> y = lat, x = lng.
  select z.municipality_id into v_municipality_id
  from public.resolve_ad_zone(extensions.ST_Y(v_point), extensions.ST_X(v_point)) z;

  -- 🔒 Fuera de cobertura NO se degrada a inventario nacional. Cero filas en
  -- ad_zones significa "se muestra en todo el país" (D3 de 169.1): crear el ad
  -- sin zona regalaría alcance nacional. Se rechaza ANTES del INSERT.
  if v_municipality_id is null then
    raise exception 'ZONE_UNRESOLVED' using errcode = 'P0001';
  end if;

  -- 🔴 El ad nace en 'pending_review', nunca en 'active'. Activarlo es
  -- exclusivo del admin (trigger de 169.2, que exige private.resolve_admin_
  -- actor()). Se escribe el literal en vez de depender de que ese trigger lo
  -- rechace.
  --
  -- ALREADY_PROMOTED se traduce del unique_violation del índice
  -- ads_one_open_promo_per_property (213.1) en vez de comprobarse antes: entre
  -- un `select ... if not exists` y el INSERT de dos transacciones concurrentes
  -- no hay nada que las ordene, y el doble tap en «Promocionar» es exactamente
  -- esa carrera. El índice es el único punto que no tiene ventana.
  begin
    insert into public.ads (
      agency_id, property_id, creative_id, title, description,
      cta_type, cta_value, status, starts_at, ends_at, created_by_user_id
    )
    values (
      v_agency_id, p_property_id, null, v_address, null,
      null, null, 'pending_review', now(), now() + interval '30 days', v_caller_id
    )
    returning id into v_ad_id;
  exception when unique_violation then
    raise exception 'ALREADY_PROMOTED' using errcode = 'P0001';
  end;

  -- Alcance MUNICIPAL (decisión 5): sin colonia. El selector de alcance llega
  -- con el cobro (fase 2, #172/#84).
  insert into public.ad_zones (ad_id, municipality_id)
  values (v_ad_id, v_municipality_id);

  return v_ad_id;
end;
$$;

comment on function public.promote_property_atomic(uuid) is
  'Promociona una publicación activa de una organización como anuncio (#213): '
  'ad en pending_review con property_id (sin creativo ni CTA), municipio '
  'heredado vía resolve_ad_zone y 30 días fijos. 🔒 El gate es el permiso de '
  'PUBLICAR de la organización, NO can_advertise (ese es el gate del anuncio '
  'display). El actor sale del JWT y la organización de la propiedad; ningún '
  'identificador de actor viaja como parámetro. Códigos P0001: '
  'NOT_AUTHENTICATED, PROPERTY_NOT_FOUND (no existe / borrada / sin '
  'organización / ajena, un solo código anti-enumeración), '
  'AGENCY_CANNOT_PUBLISH, PROPERTY_NOT_PUBLISHED, ALREADY_PROMOTED, '
  'ZONE_UNRESOLVED. Atómica: ad + zona o nada.';

revoke execute on function public.promote_property_atomic(uuid) from public, anon;
grant  execute on function public.promote_property_atomic(uuid) to authenticated;
