-- Migración 20260820000005 — RPC public.create_ad_campaign_atomic (tarea #191,
-- subtarea 170.10). ADITIVA.
--
-- EL HUECO QUE CIERRA: no existía NINGUNA ruta para que un anunciante creara el
-- registro de su campaña. `public.ads` solo tiene `grant select` a
-- authenticated y su única policy es `ads_select` — sin policy de INSERT, a
-- propósito ("exclusivo de RPC/EF security definer futura",
-- 20260816000005:205). Y grant_ad_slot_atomic (169.3) está revoke'd de
-- authenticated: la invoca el admin desde Studio. Resultado: el wizard de
-- 169.9 recogía título, CTA y zonas que no tenían dónde ir.
--
-- SIMETRÍA con grant_ad_slot_atomic, con dos diferencias que son el punto:
--   1. El caller es `authenticated`, no service_role.
--   2. 🔒 LA AGENCIA NO ES UN PARÁMETRO. Se resuelve del JWT. Si viajara como
--      argumento, cualquiera podría crear campañas a nombre de otra
--      organización — el mismo criterio que #193 aplicó al derivar el id de
--      impresión server-side en vez de blindar el que mandaba el cliente:
--      no se blinda un dato que el cliente controla, se deja de aceptar.
--
-- 🔴 EL AD NACE EN 'pending_review', NUNCA EN 'active'. Activar es exclusivo
-- del admin: el trigger de 169.2 exige un admin identificado vía
-- private.resolve_admin_actor() y audita en admin_actions. Un intento de nacer
-- activo desde aquí lo rechazaría ese trigger, pero no se depende de eso — se
-- escribe el literal.
--
-- 📋 AUDITORÍA — DECISIÓN, no olvido: esta RPC NO escribe en `admin_actions`.
-- Esa tabla tiene `admin_id NOT NULL` y registra actos de ADMIN; estampar ahí
-- el user_id de un anunciante corrompería el significado de toda consulta de
-- auditoría. El rastro de la creación es la propia fila de `ads` —con
-- `created_by_user_id`, columna que agrega esta migración— y el
-- `admin_actions` que SÍ se escribe cuando un admin la saca de
-- 'pending_review' (el trigger de 169.2 ya audita ese cambio de estado).
--
-- ⚠️ ARISTA CONOCIDA de la vigencia: `ads.starts_at`/`ends_at` son NOT NULL, así
-- que la ventana se fija AL CREAR, no al aprobar — si la campaña queda días en
-- 'pending_review', esos días se consumen. En beta no hay pago y la aprobación
-- es manual y rápida, así que se acepta; el admin puede ajustar antes de
-- activar. Queda anotado aquí para que la decisión sea visible el día que haya
-- dinero de por medio, en vez de descubrirse.
--
-- Idempotente: add column if not exists + create or replace.
-- Rollback: supabase/migrations/rollbacks/20260820000005_create_ad_campaign_atomic.sql

alter table public.ads
  add column if not exists created_by_user_id uuid references public.users (id) on delete set null;

comment on column public.ads.created_by_user_id is
  'Quién creó la campaña (#191). NULL para las que otorgó un admin con '
  'grant_ad_slot_atomic (ahí el actor queda en admin_actions). No se usa '
  'admin_actions para el alta self-service: esa tabla tiene admin_id NOT NULL '
  'y registra actos de admin.';

create or replace function public.create_ad_campaign_atomic(
  p_creative_id uuid,
  p_title       text,
  p_cta_type    ad_cta_type,
  p_cta_value   text,
  p_zones       jsonb default '[]'::jsonb,
  p_description text default null,
  p_days        int  default 30
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_id  uuid;
  v_agency_id  uuid;
  v_ad_id      uuid;
  v_zone       jsonb;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'NOT_AGENCY_MANAGER' using errcode = 'P0001';
  end if;

  -- 🔒 La agencia sale del CALLER, nunca de un parámetro. Solo owner/admin
  -- ACTIVOS: un 'agent' o 'viewer' no gestiona la publicidad de la
  -- organización, y una membresía 'suspended'/'removed' no gestiona nada.
  select m.agency_id into v_agency_id
  from public.agency_members m
  where m.user_id = v_caller_id
    and m.status = 'active'
    and m.member_role in ('owner', 'admin')
  limit 1;

  if v_agency_id is null then
    raise exception 'NOT_AGENCY_MANAGER' using errcode = 'P0001';
  end if;

  -- Mismo guard que grant_ad_slot_atomic. Se llama a la PRIVATE desde dentro:
  -- el wrapper public.org_can_advertise está revoke'd a authenticated
  -- (20260816000008) a propósito, y esta RPC no puede exponerlo.
  -- Compone inexistente | soft-deleted | suspendida | can_advertise=false en
  -- el MISMO código: no se distingue "no existe" de "no puede anunciarse".
  if not private.org_can_advertise(v_agency_id) then
    raise exception 'AGENCY_CANNOT_ADVERTISE' using errcode = 'P0001';
  end if;

  -- 🔒 El creativo debe ser DE LA AGENCIA DEL CALLER y estar 'ready'. Sin el
  -- filtro por agency_id, cualquiera podría montar una campaña sobre el video
  -- de otra organización. Las dos causas comparten código a propósito: no se
  -- revela si el creativo existe pero es ajeno.
  if not exists (
    select 1 from public.ad_creatives c
    where c.id = p_creative_id
      and c.agency_id = v_agency_id
      and c.status = 'ready'
  ) then
    raise exception 'CREATIVE_NOT_FOUND' using errcode = 'P0001';
  end if;

  insert into public.ads (
    agency_id, creative_id, title, cta_type, cta_value, description,
    status, starts_at, ends_at, created_by_user_id
  )
  values (
    v_agency_id, p_creative_id, p_title, p_cta_type, p_cta_value, p_description,
    'pending_review', now(), now() + p_days * interval '1 day', v_caller_id
  )
  returning id into v_ad_id;

  -- p_zones NULL o '[]' -> jsonb_array_elements no itera -> 0 filas en
  -- ad_zones -> inventario NACIONAL (D3 de 169.1, NO es un error). Cada
  -- elemento se pasa TAL CUAL: un elemento con ambos ids no nulos revienta el
  -- CHECK ad_zones_exactly_one_scope (23514) y, al no haber bloque EXCEPTION,
  -- se lleva el INSERT del ad con él — atomicidad real, no compensación.
  for v_zone in select * from jsonb_array_elements(coalesce(p_zones, '[]'::jsonb))
  loop
    insert into public.ad_zones (ad_id, municipality_id, neighborhood_id)
    values (
      v_ad_id,
      v_zone ->> 'municipality_id',
      (v_zone ->> 'neighborhood_id')::bigint
    );
  end loop;

  return v_ad_id;
end;
$$;

comment on function public.create_ad_campaign_atomic(uuid, text, ad_cta_type, text, jsonb, text, integer) is
  'Alta SELF-SERVICE de una campaña por el owner/admin de su propia '
  'organización (#191). La agencia se resuelve del JWT, nunca es un parámetro. '
  'El ad nace en pending_review — activarlo es exclusivo del admin (trigger de '
  '169.2). p_zones vacío = inventario nacional. Atómica: ad + zonas o nada.';

revoke execute on function public.create_ad_campaign_atomic(uuid, text, ad_cta_type, text, jsonb, text, integer)
  from public, anon;
grant execute on function public.create_ad_campaign_atomic(uuid, text, ad_cta_type, text, jsonb, text, integer)
  to authenticated;
