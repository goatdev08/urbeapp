-- Migración 20260721000001 — publish_property_atomic: enlazar (no insertar) el
-- video en vuelo (subtarea 68.12, upload-first)
--
-- Contexto: desde 68.3/68.4 el video se sube a Cloudflare Stream (mint-upload-url)
-- ANTES de que exista la propiedad. Esa fila de property_videos ya existe con
-- property_id=NULL, agent_id=<dueño>, status en ('uploading'|'processing'|'ready'),
-- cloudflare_uid y tus_upload_url. Publicar ya NO debe INSERTar una fila nueva
-- (duplicaría el video); debe ENLAZAR (UPDATE) esa misma fila a la propiedad recién
-- creada.
--
-- Cambio de contrato del RPC public.publish_property_atomic:
--   - Se ELIMINAN p_video_id (uuid) y p_storage_path (text).
--   - Se AGREGA p_cloudflare_uid (text) — referencia del video en vuelo a enlazar.
--
-- Cuerpo:
--   1. Guards de siempre (p_user_id, p_address, p_lat/p_lng) + guard nuevo:
--      p_cloudflare_uid no nulo ni vacío.
--   2. INSERT properties idéntico al de la migración 0017 (status='active',
--      published_at=now()).
--   3. UPDATE (no INSERT) property_videos: enlaza la fila en vuelo que matchee
--      cloudflare_uid + agent_id=p_user_id (dueño) + property_id IS NULL (aún no
--      enlazada) + status IN ('processing','ready') (upload ya terminó) +
--      deleted_at IS NULL (no borrada). position=1 (primer video de la propiedad).
--   4. Si el UPDATE no afectó ninguna fila (video no encontrado / no es del
--      caller / aún 'uploading' / ya enlazado) → excepción P0001. Al no haber
--      bloque EXCEPTION, esto hace ROLLBACK del INSERT de properties del paso 2
--      (atomicidad: no puede quedar una propiedad sin su video enlazado).
--   5. return property_id.
--
-- Constraint satisfecho: property_videos_ready_requires_storage (0012) —
--   el video en vuelo ya tiene cloudflare_uid IS NOT NULL desde que se creó en
--   mint-upload-url; el UPDATE no lo toca.
--
-- Idempotente: create or replace function + drop de la firma vieja (0017) y de
--   la firma nueva (por si esta migración se reaplica en una iteración previa).
-- Rollback: supabase/migrations/rollbacks/20260721000001_publish_property_link_video.sql

-- ── Eliminar overloads anteriores si existen ─────────────────────────────────────

-- Firma vieja (0017: p_video_id uuid, p_storage_path text)
drop function if exists public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, uuid, text
);

-- Firma nueva (por si esta migración se reaplica)
drop function if exists public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, text
);

-- ── Función principal (nueva firma) ────────────────────────────────────────────

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
-- PostGIS (geography, ST_Point, ST_SetSRID) vive en el schema `extensions` en
-- Supabase; se incluye en el search_path y se califica explícitamente abajo.
set search_path = public, extensions
as $$
declare
  v_property_id uuid;
  v_video_id    uuid;
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

  -- ENLAZAR (UPDATE) el video en vuelo — NO insertar una fila nueva.
  -- Solo enlaza si: pertenece al caller (agent_id), aún no está enlazado
  -- (property_id IS NULL), el upload ya terminó (status IN processing/ready) y
  -- no está borrado (deleted_at IS NULL).
  -- Nota: la salida de la función es RETURNS TABLE(property_id uuid), lo que
  -- crea una variable implícita "property_id" en este scope — por eso la
  -- columna de la tabla se califica explícitamente como
  -- public.property_videos.property_id (evita el error 42702 ambiguous).
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
  -- de arriba (no hay bloque EXCEPTION que capture el error) — atomicidad: no
  -- puede quedar una propiedad activa sin su video enlazado.
  if v_video_id is null then
    raise exception 'video en vuelo no encontrado, no pertenece al usuario o no está listo para enlazar' using errcode='P0001';
  end if;

  return query select v_property_id;
end;
$$;

-- Grant para service_role (la EF llama con service_role key)
grant execute on function public.publish_property_atomic(
  uuid, text, text, numeric, integer, integer, numeric,
  text, double precision, double precision,
  boolean, boolean, boolean, text, text
) to service_role;
