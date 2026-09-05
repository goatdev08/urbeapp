-- Migración 20260905300002 — WhatsApp del perfil público resuelto por RPC (tarea #255)
--
-- ── El hueco (origen: tarea 250, PR #143) ───────────────────────────────────
-- El perfil público (ProfileActions.tsx) decidía el botón "Contactar por
-- WhatsApp" leyendo `users.phone` crudo. RLS oculta la fila de `users` de
-- cualquier publicador role='admin' para un no-admin (#250, el caso de
-- Vladimir en producción) -> sin fila, sin phone, sin botón, aunque el
-- publicador SÍ tenga teléfono capturado. `contact-agent` (la EF que YA
-- resuelve el número server-side para el feed/detalle) exige `property_id`;
-- el perfil no tiene propiedad ni registra lead, así que esa puerta no
-- aplica aquí (decisión ya tomada, opción c del PR #143).
--
-- Esta RPC es la puerta nueva: el cliente decide el botón con `has_phone`
-- (derivado, vista `agent_public_profiles`, migración 20260905200003) y solo
-- pide el número CRUDO al pulsar, vía esta función -- que decide server-side
-- si el destino es un publicador (agent/admin) vivo con teléfono. El teléfono
-- nunca sale por ningún otro canal del perfil público.
--
-- SEGURIDAD: SECURITY DEFINER + search_path vacío (bypass de RLS deliberado,
-- acotado a UNA columna, con las mismas reglas que ya decide la vista). Solo
-- `authenticated` puede ejecutarla; `anon`/`public` NUNCA.
--
-- Idempotente (create or replace). Rollback:
-- supabase/migrations/rollbacks/20260905300002_whatsapp_phone_for_profile.sql
-- Tests: supabase/tests/99_whatsapp_phone_for_profile_test.sql
--
-- Gate §0.5: ADITIVO puro -- función nueva, ninguna tabla/vista/RPC existente
-- cambia. Orden de deploy: esta migración PRIMERO al remoto, el cliente
-- (ProfileActions) por OTA después -- un build viejo simplemente no la llama.

create or replace function public.whatsapp_phone_for_profile(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
begin
  -- Defensivo: en la práctica el REVOKE de abajo ya bloquea a anon (sin JWT)
  -- antes de llegar aquí (42501), pero un caller "authenticated" sin claims
  -- válidos tampoco debe obtener nada.
  if auth.uid() is null then
    return null;
  end if;

  select u.phone
    into v_phone
    from public.users u
   where u.id = p_user_id
     and u.deleted_at is null
     and u.role in ('agent', 'admin')
     and u.phone is not null;

  return v_phone;
end;
$$;

comment on function public.whatsapp_phone_for_profile(uuid) is
  'Resuelve el teléfono E.164 de un publicador (role agent/admin, vivo, con '
  'teléfono capturado) para el botón "Contactar por WhatsApp" del perfil '
  'público (#255). Devuelve NULL en cualquier otro caso (destino buscador, '
  'borrado, sin teléfono, o no encontrado) -- nunca expone otra columna de '
  '`users`. Bypassa RLS deliberadamente (SECURITY DEFINER), acotado a esta '
  'única columna y a esta única decisión.';

revoke all on function public.whatsapp_phone_for_profile(uuid) from anon, public;
grant execute on function public.whatsapp_phone_for_profile(uuid) to authenticated;
