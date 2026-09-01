-- STUB de RED — subtarea #221.1 (tarea 221 "cola de solicitudes", exploración
-- 041-M4). ⚠️ ANDAMIO DE TEST, NO artefacto de producción: este archivo se
-- ELIMINA del árbol antes de integrar y su contenido se consolida en
-- supabase/migrations/20260902100001_advertising_requests.sql (el GREEN),
-- mismo criterio que 220.3/20260828000004 y 220.6/20260828000005.
--
-- Su único propósito es que la suite pgTAP 79 falle por ASERCIÓN y no por
-- catálogo (42P01 tabla inexistente / 42883 función inexistente). Por eso
-- trae SOLO la forma mecánica:
--   - columnas/tipos/FK/defaults de public.advertising_requests,
--   - RLS ENABLED sin NINGUNA policy (deny-total para no-superusuarios),
--   - dos funciones no-op con la firma final.
-- Deliberadamente NO trae ninguna invariante de negocio: sin el CHECK de
-- status, sin el índice único parcial de "una pending por agencia", sin
-- policies y sin cuerpo en las RPCs.

create table if not exists public.advertising_requests (
  id                   uuid primary key default gen_random_uuid(),
  agency_id            uuid not null references public.agencies (id) on delete cascade,
  requested_by_user_id uuid not null references public.users (id) on delete cascade,
  proposed_category    public.advertiser_category not null,
  status               text not null default 'pending',
  rejection_reason     text,
  created_at           timestamptz not null default now(),
  resolved_at          timestamptz,
  resolved_by_user_id  uuid references public.users (id) on delete set null
);

alter table public.advertising_requests enable row level security;

revoke all on public.advertising_requests from anon, authenticated;
grant select on public.advertising_requests to authenticated;

create or replace function public.create_advertising_request(p_proposed_category text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return null; -- STUB
end;
$$;
revoke execute on function public.create_advertising_request(text) from public, anon;
grant execute on function public.create_advertising_request(text) to authenticated;

create or replace function public.resolve_advertising_request(
  p_request_id uuid,
  p_approve    boolean,
  p_reason     text default null
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return; -- STUB
end;
$$;
revoke execute on function public.resolve_advertising_request(uuid, boolean, text) from public, anon;
grant execute on function public.resolve_advertising_request(uuid, boolean, text) to authenticated, service_role;
