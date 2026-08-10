-- Rollback: 20260809000006_publish_property_atomic_price_visible.sql
--
-- Restaura EXACTAMENTE el body de 20260809000005 — publish_property_atomic
-- vuelve a NO aceptar p_price_visible (la columna properties.price_visible
-- cae de nuevo en su default true en cada publicación, el bug #129 original).
--
-- El overload de 17 args (con p_price_visible) que creó la migración de ida
-- debe eliminarse explícitamente: CREATE OR REPLACE con 16 args no lo
-- sobreescribe (firmas distintas para Postgres), dejaría los DOS conviviendo.

drop function if exists public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, text, text, boolean
);

-- Overload viejo (15 args, sin p_property_status) -- debe eliminarse antes de
-- crear el de 16, o quedan dos funciones distintas conviviendo en el catálogo.
drop function if exists public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, text
);

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
  p_property_status     text     default 'active'
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

  -- INSERT properties
  -- status = p_property_status (73.4 fix crítico: YA NO hardcodeado a 'active'
  -- -- el handler de producción manda 'pending_review', PRD §14.2). El cast
  -- ::property_status rechaza naturalmente cualquier valor fuera del enum
  -- (22P02), sin necesidad de una lista de valores permitidos aquí.
  -- agency_id: NULL si independiente, la agencia activa si tiene membresía.
  -- location: geography(Point,4326) — ST_Point(lng, lat) sigue la convención (x=lng, y=lat).
  insert into public.properties (
    owner_user_id,
    agency_id,
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
    v_agency_id,
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
    p_property_status::property_status,
    now()
  )
  returning id into v_property_id;

  -- 73.4: registrar el slot de video (semilla #76/pagos) en la MISMA transacción.
  -- Sin bloque exception alrededor a propósito: si este INSERT falla (violación
  -- de la unique constraint sobre property_id — en la práctica imposible porque
  -- v_property_id es recién generado por gen_random_uuid(), pero cubierto por
  -- fault-injection determinista en pgTAP), la excepción se propaga sin capturar
  -- y hace ROLLBACK de TODO el INSERT de properties de arriba — no puede quedar
  -- una propiedad creada sin su slot.
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

  -- Si el UPDATE no afectó ninguna fila, hace ROLLBACK del INSERT de properties
  -- Y del slot de arriba (no hay bloque EXCEPTION que capture el error) —
  -- atomicidad: no puede quedar una propiedad activa sin su video enlazado.
  if v_video_id is null then
    raise exception 'video en vuelo no encontrado, no pertenece al usuario o no está listo para enlazar' using errcode='P0001';
  end if;

  return query select v_property_id;
end;
$$;

comment on function public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, text, text
) is
  '73.4: recibe property_status como parámetro (p_property_status, default '
  '''active'' por compat) y lo usa TAL CUAL en el INSERT -- ya NO hardcodeado. '
  'El handler de producción manda ''pending_review'' (PRD §14.2: toda '
  'publicación pasa por revisión). Además, en la MISMA transacción registra el '
  'slot de video en property_video_slots (semilla de vigencia para #76/pagos, '
  'beta siempre gratis) y enlaza (UPDATE) su video en vuelo. Fix 100: resuelve '
  'la membresía de agencia del publicante (active|suspended) -- bloquea con '
  'AGENCY_MEMBERSHIP_SUSPENDED si está suspendido, y denormaliza '
  'properties.agency_id (NULL si independiente, la agencia activa si tiene membresía).';

-- Grant para service_role (la EF llama con service_role key).
grant execute on function public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, text, text
) to service_role;
