-- Rollback 20260721000001 — revierte publish_property_atomic a la firma vieja
-- (0017: p_video_id uuid, p_storage_path text; INSERT de property_videos en vez
-- de ENLAZAR). Ejecutar ANTES de borrar la migración 20260721000001 del historial.

-- ── Eliminar la firma nueva ───────────────────────────────────────────────────

revoke execute on function public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, text
) from service_role;

drop function if exists public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, text
);

-- ── Restaurar la firma vieja (idéntica a 20260625000001_publish_property_rpc.sql) ──

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
  p_video_id            uuid     default null,
  p_storage_path        text     default null
)
returns table(property_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_property_id uuid;
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
  if p_video_id is null then
    raise exception 'video_id es requerido' using errcode = 'P0001';
  end if;
  if p_storage_path is null or trim(p_storage_path) = '' then
    raise exception 'storage_path es requerido' using errcode = 'P0001';
  end if;

  insert into public.properties (
    owner_user_id,
    operation_type,
    property_type,
    price,
    bedrooms,
    bathrooms,
    square_meters,
    address,
    location,
    pet_friendly,
    allows_no_guarantor,
    student_friendly,
    description,
    status,
    published_at
  )
  values (
    p_user_id,
    p_operation_type::operation_type,
    p_property_type::property_type,
    p_price,
    p_bedrooms,
    p_bathrooms,
    p_square_meters,
    p_address,
    extensions.ST_SetSRID(extensions.ST_Point(p_lng, p_lat), 4326)::extensions.geography,
    p_pet_friendly,
    p_allows_no_guarantor,
    p_student_friendly,
    p_description,
    'active',
    now()
  )
  returning id into v_property_id;

  insert into public.property_videos (
    id,
    property_id,
    status,
    storage_path,
    position
  )
  values (
    p_video_id,
    v_property_id,
    'ready',
    p_storage_path,
    1
  );

  return query select v_property_id;
end;
$$;

grant execute on function public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, uuid, text
) to service_role;
