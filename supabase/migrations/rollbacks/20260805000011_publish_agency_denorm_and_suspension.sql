-- Rollback de 20260805000011_publish_agency_denorm_and_suspension.sql (fix 100)
--
-- Re-ejecutable: create or replace / drop-create policy restauran EXACTAMENTE
-- los bodies previos (20260721000001 para el RPC, 20260805000003 para la
-- policy) -- agency_id vuelve a NUNCA denormalizarse, la suspensión vuelve a
-- NO bloquear el publish real, y properties_update vuelve a is_agency_owner_of.

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
  p_cloudflare_uid      text     default null
)
returns table(property_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_property_id uuid;
  v_video_id    uuid;
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
  boolean, boolean, boolean, text, text
) is
  'Publica una property y enlaza (UPDATE, no INSERT) su video en vuelo previamente '
  'subido a Cloudflare Stream (68.12). Referencia: p_cloudflare_uid. Errores '
  '(P0001): parámetros faltantes, video no encontrado/ajeno/no-listo/ya-enlazado.';

grant execute on function public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, text
) to service_role;

drop policy if exists properties_select on public.properties;
create policy properties_select on public.properties for select to anon, authenticated
  using (
    (status = 'active' and deleted_at is null)
    or owner_user_id = (select auth.uid())
    or private.is_agency_owner_of(owner_user_id)
    or private.is_admin()
  );

drop policy if exists properties_select_agency_role on public.properties;
create policy properties_select_agency_role on public.properties for select to authenticated
  using (private.agency_role_of(agency_id) in ('admin', 'viewer'));

drop policy if exists properties_update on public.properties;
create policy properties_update on public.properties for update to authenticated
  using (
    owner_user_id = (select auth.uid())
    or private.is_agency_owner_of(owner_user_id)
    or private.agency_role_of(agency_id) = 'admin'
    or private.is_admin()
  )
  with check (
    owner_user_id = (select auth.uid())
    or private.is_agency_owner_of(owner_user_id)
    or private.agency_role_of(agency_id) = 'admin'
    or private.is_admin()
  );
