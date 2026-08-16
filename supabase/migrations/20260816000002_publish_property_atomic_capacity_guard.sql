-- Migración 20260816000002 — publish_property_atomic: guard
-- AGENCY_CANNOT_PUBLISH_PROPERTIES (subtarea #168.3, exploración 039).
--
-- Extiende public.publish_property_atomic partiendo EXACTAMENTE del cuerpo
-- VIGENTE en 20260815000004_publish_property_atomic_wizard_fields.sql (create
-- or replace :25, 20 params: los 17 previos + p_built_square_meters,
-- p_half_bathrooms, p_currency — tarea #167, YA DESPLEGADA en producción,
-- hizo backfill real de las 20 propiedades existentes con el default
-- p_currency='MXN'). NO parte de 20260809000006 (17 params) — copiar ese
-- cuerpo borraría los 3 campos del wizard y sería una regresión directa
-- (§0.5 regla 1/2).
--
-- La FIRMA no cambia (sigue en 20 params, mismos nombres/tipos/defaults) —
-- solo se agrega un guard nuevo AL CUERPO: si la agencia resuelta del
-- publicante tiene can_publish_properties = false, se rechaza con un código
-- de error EXPLÍCITO (P0001 AGENCY_CANNOT_PUBLISH_PROPERTIES), ANTES del
-- INSERT en properties — sin eso, can_publish_properties=false sería
-- decorativa (una organización solo-publicidad podría seguir publicando).
--
-- El guard AGENCY_MEMBERSHIP_SUSPENDED (20260809000005) y el manejo de
-- p_price_visible (20260809000006) sobreviven intactos — un create or
-- replace reescribe el cuerpo entero, así que ambos se copian tal cual desde
-- 20260815000004.
--
-- Idempotente: mismo pronargs (20) → sin DROP necesario, create or replace
-- directo (no cambia el shape de argumentos, solo el cuerpo).
-- Rollback: supabase/migrations/rollbacks/20260816000002_publish_property_atomic_capacity_guard.sql
-- Tests: supabase/tests/46_org_advertising_test.sql (sección 8: CAP2, CAP3,
-- CAP4; sección 8.6: NOREG1-3; sección 9: SIG1, SIG2, NOREG4-6).

create or replace function public.publish_property_atomic(
  p_user_id             uuid,
  p_operation_type      text,
  p_property_type       text,
  p_price               numeric,
  p_bedrooms            integer  default null,
  p_bathrooms           integer  default null,
  p_square_meters       numeric  default null,
  p_address             text     default null,
  p_lat                 double precision default null,
  p_lng                 double precision default null,
  p_pet_friendly        boolean  default false,
  p_allows_no_guarantor boolean  default false,
  p_student_friendly    boolean  default false,
  p_description         text     default null,
  p_cloudflare_uid      text     default null,
  p_property_status     text     default 'active',
  p_price_visible       boolean  default true,
  p_built_square_meters numeric  default null,
  p_half_bathrooms      integer  default null,
  p_currency            text     default 'MXN'
)
returns table(property_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_property_id            uuid;
  v_video_id               uuid;
  v_agency_id               uuid;
  v_membership_status       text;
  v_can_publish_properties  boolean;
begin
  -- Guard: parámetros obligatorios
  if p_user_id is null then
    raise exception 'user_id es requerido' using errcode = 'P0001';
  end if;
  if p_address is null or trim(p_address) = '' then
    raise exception 'address es requerido' using errcode = 'P0001';
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'lat y lng son requeridos para ST_Point' using errcode = 'P0001';
  end if;
  if p_cloudflare_uid is null or trim(p_cloudflare_uid) = '' then
    raise exception 'cloudflare_uid es requerido' using errcode = 'P0001';
  end if;
  if p_property_status is null or trim(p_property_status) = '' then
    raise exception 'property_status es requerido' using errcode = 'P0001';
  end if;

  -- Fix 100: resolver la membresía de agencia del publicante ANTES de insertar
  -- (desempate ORDER BY: la fila ACTIVE siempre gana sobre una suspended vieja
  -- de otra agencia — ver 20260805000011 para el detalle completo).
  select agency_id, status
    into v_agency_id, v_membership_status
    from public.agency_members
   where user_id = p_user_id
     and status in ('active', 'suspended')
   order by (status = 'active') desc
   limit 1;

  if v_membership_status = 'suspended' then
    raise exception 'AGENCY_MEMBERSHIP_SUSPENDED' using errcode = 'P0001';
  end if;

  -- Subtarea #168.3: organización solo-publicidad (can_publish_properties=false)
  -- no puede publicar propiedades — bloqueo explícito, ANTES del INSERT.
  -- Un publicante sin membresía de agencia (v_agency_id null) no está sujeto
  -- a este guard (mismo criterio que AGENCY_MEMBERSHIP_SUSPENDED arriba).
  if v_agency_id is not null then
    select can_publish_properties
      into v_can_publish_properties
      from public.agencies
     where id = v_agency_id;

    if v_can_publish_properties = false then
      raise exception 'AGENCY_CANNOT_PUBLISH_PROPERTIES' using errcode = 'P0001';
    end if;
  end if;

  -- INSERT properties
  insert into public.properties (
    owner_user_id,
    agency_id,
    operation_type,
    property_type,
    price,
    bedrooms,
    bathrooms,
    square_meters,
    built_square_meters,
    half_bathrooms,
    currency,
    address,
    location,
    pet_friendly,
    allows_no_guarantor,
    student_friendly,
    price_visible,
    description,
    status,
    published_at
  )
  values (
    p_user_id,
    v_agency_id,
    p_operation_type::operation_type,
    p_property_type::property_type,
    p_price,
    p_bedrooms,
    p_bathrooms,
    p_square_meters,
    p_built_square_meters,
    p_half_bathrooms,
    coalesce(p_currency, 'MXN'),
    p_address,
    extensions.ST_SetSRID(extensions.ST_Point(p_lng, p_lat), 4326)::extensions.geography,
    p_pet_friendly,
    p_allows_no_guarantor,
    p_student_friendly,
    coalesce(p_price_visible, true),
    p_description,
    p_property_status::property_status,
    now()
  )
  returning id into v_property_id;

  -- 73.4: registrar el slot de video (semilla #76/pagos) en la MISMA transacción.
  insert into public.property_video_slots (property_id) values (v_property_id);

  -- ENLAZAR (UPDATE) el video en vuelo — NO insertar una fila nueva.
  update public.property_videos
     set property_id = v_property_id,
         position = 1
   where public.property_videos.cloudflare_uid = p_cloudflare_uid
     and public.property_videos.agent_id = p_user_id
     and public.property_videos.property_id is null
     and public.property_videos.status in ('processing', 'ready')
     and public.property_videos.deleted_at is null
  returning public.property_videos.id into v_video_id;

  if v_video_id is null then
    raise exception 'video en vuelo no encontrado, no pertenece al usuario o no está listo para enlazar' using errcode='P0001';
  end if;

  return query select v_property_id;
end;
$$;

comment on function public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, text, text, boolean, numeric, integer, text
) is
  'Subtarea #168.3: agrega el guard AGENCY_CANNOT_PUBLISH_PROPERTIES (P0001) '
  'si la agencia resuelta del publicante tiene can_publish_properties=false — '
  'ANTES del INSERT en properties, atómico. Resto idéntico a 20260815000004 '
  '(p_built_square_meters, p_half_bathrooms, p_currency del wizard paso 3; '
  'AGENCY_MEMBERSHIP_SUSPENDED, p_price_visible, slot de video de '
  '20260809000005/000006).';

-- Grant para service_role (la EF llama con service_role key). Mismo shape de
-- argumentos que 20260815000004 — el grant es idempotente (no hace falta
-- revoke/drop porque no cambió pronargs).
grant execute on function public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, text, text, boolean, numeric, integer, text
) to service_role;
