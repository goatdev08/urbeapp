-- Rollback: 20260816000002_publish_property_atomic_capacity_guard.sql
--
-- Restaura EXACTAMENTE el body de 20260815000004 — publish_property_atomic
-- vuelve a NO tener el guard AGENCY_CANNOT_PUBLISH_PROPERTIES. Misma firma
-- (20 params), no hace falta drop.

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
  v_property_id       uuid;
  v_video_id          uuid;
  v_agency_id         uuid;
  v_membership_status text;
begin
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

  insert into public.property_video_slots (property_id) values (v_property_id);

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
  'Quick fixes wizard paso 3 (2026-08-15): acepta p_built_square_meters '
  '(superficie construida, m²), p_half_bathrooms (medios baños) y p_currency '
  '(MXN|USD, default MXN — solo etiqueta, sin conversión). Resto idéntico a '
  '20260809000006 (p_price_visible, property_status, slot de video, '
  'membresía de agencia).';

grant execute on function public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, text, text, boolean, numeric, integer, text
) to service_role;
