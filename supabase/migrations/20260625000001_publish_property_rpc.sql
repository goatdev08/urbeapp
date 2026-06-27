-- Migración 0017 — RPC publish_property_atomic
-- Propósito: la Edge Function publish-property llama esta RPC con service_role
-- para insertar en properties + property_videos en UNA transacción PostgreSQL.
-- Atomicidad: si falla el INSERT de property_videos, el INSERT de properties
-- hace ROLLBACK automáticamente — no puede quedar una propiedad activa sin video.
--
-- Columnas cubiertas:
--   properties: owner_user_id, operation_type, property_type, price, bedrooms,
--               bathrooms, square_meters, address, location (ST_Point), pet_friendly,
--               allows_no_guarantor, student_friendly, description, status='active',
--               published_at=now()
--   property_videos: id=p_video_id (UUID del cliente), property_id, status='ready',
--                    storage_path, position=1
--
-- Constraint satisfecho: property_videos_ready_requires_storage
--   (status='ready' AND storage_path IS NOT NULL → válido)
--
-- Idempotente: create or replace function
-- Rollback: supabase/migrations/rollbacks/20260625000001_publish_property_rpc.sql

-- ── Eliminar overloads anteriores si existen ─────────────────────────────────────

-- (guard por si la función se creó con una firma distinta en una iteración anterior)
drop function if exists public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, uuid, text
);

-- ── Función principal ─────────────────────────────────────────────────────────────

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
-- PostGIS (geography, ST_Point, ST_SetSRID) vive en el schema `extensions` en
-- Supabase; se incluye en el search_path y se califica explícitamente abajo.
set search_path = public, extensions
as $$
declare
  v_property_id uuid;
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
  if p_video_id is null then
    raise exception 'video_id es requerido' using errcode = 'P0001';
  end if;
  if p_storage_path is null or trim(p_storage_path) = '' then
    raise exception 'storage_path es requerido' using errcode = 'P0001';
  end if;

  -- INSERT properties
  -- status='active' + published_at=now(): la EF publica directamente (auto-aprobación, PRD §12).
  -- location: geography(Point,4326) — ST_Point(lng, lat) sigue la convención (x=lng, y=lat).
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

  -- INSERT property_videos
  -- id=p_video_id: UUID generado por el cliente (convención PRD §13).
  -- status='ready': el video ya fue subido al bucket antes de llamar esta RPC.
  -- storage_path: satisface constraint property_videos_ready_requires_storage.
  -- position=1: primer (y único) video de la propiedad en el flujo de publicación.
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

  -- Si cualquiera de los INSERTs falla, la transacción completa hace ROLLBACK
  -- (comportamiento estándar de PL/pgSQL sin bloques EXCEPTION que capturen el error).
  return query select v_property_id;
end;
$$;

-- Grant para service_role (la EF llama con service_role key)
grant execute on function public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, uuid, text
) to service_role;
