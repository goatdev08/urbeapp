-- Migración 20260816000008 — wrapper público para private.org_can_advertise
-- (fix del guardián sobre 169.4, 2026-08-16).
--
-- BUG (guardián, sonda contra el stack local): PostgREST NO expone el esquema
-- `private` -- ese es su propósito. client.rpc("org_can_advertise") desde
-- make_advertiser_authorizer (_shared/clients.ts) resolvía contra `public` y
-- fallaba SIEMPRE con PGRST202 (función no encontrada). rpc_error quedaba
-- truthy en el 100% de las llamadas ⇒ el authorize fail-closed colapsaba en
-- FORBIDDEN para CUALQUIER anunciante legítimo, sin importar sus datos —
-- error de esquema, no de datos (precedente #68: el token de Stream en el
-- PATH, no en ?token=).
--
-- FIX: wrapper en `public` que DELEGA en private.org_can_advertise (168.1,
-- 20260815000001) -- una sola fuente de verdad para "esta organización puede
-- anunciar". El wrapper NO reimplementa los 3 predicados (existe / activa /
-- capacidad); solo los expone a PostgREST a través de una llamada. Permisos
-- restringidos a propósito: SOLO service_role puede ejecutarla (revoke
-- explícito de public/anon/authenticated) -- la capacidad de anunciar de una
-- organización ajena no es información pública; las Edge Functions la
-- consultan con service_role (make_advertiser_authorizer), nunca el cliente
-- directo vía RLS/PostgREST.
--
-- Idempotente: create or replace function + revoke/grant repetibles sin error.
-- Aditiva, cero riesgo para producción viva (CLAUDE.md §0.5): no toca ninguna
-- tabla ni política existente.
-- Rollback: supabase/migrations/rollbacks/20260816000008_org_can_advertise_public_wrapper.sql

create or replace function public.org_can_advertise(p_agency_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select private.org_can_advertise(p_agency_id);
$$;

comment on function public.org_can_advertise(uuid) is
  'Wrapper PÚBLICO (PostgREST no expone el esquema private) que DELEGA en '
  'private.org_can_advertise (168.1) -- misma fuente de verdad, sin '
  'reimplementar los predicados existe/activa/capacidad. SOLO service_role '
  'puede ejecutarla (revoke explícito de public/anon/authenticated) -- la '
  'capacidad de anunciar de una organización ajena no es información pública. '
  'Consumidor: make_advertiser_authorizer (_shared/clients.ts, subtarea 169.4, '
  'fix del guardián 2026-08-16: la EF devolvía 403 al 100% de los anunciantes '
  'porque client.rpc() no puede alcanzar el esquema private).';

-- Fail-closed con dientes (patrón 20260809000004): Postgres otorga EXECUTE a
-- PUBLIC por default al crear la función -- revoke explícito antes del grant
-- mínimo, para que anon/authenticated NUNCA puedan ejecutar esto vía
-- PostgREST, ni siquiera por el hueco de "EXECUTE a PUBLIC por default" que
-- 20260805000003 documenta para agency_role_of.
revoke execute on function public.org_can_advertise(uuid) from public, anon, authenticated;
grant execute on function public.org_can_advertise(uuid) to service_role;
