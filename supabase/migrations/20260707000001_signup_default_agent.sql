-- Migración 0011 — Registro libre publica: handle_new_user crea perfiles con role='agent'
--
-- Contexto (flash 2026-07-06, demo cerrada): TODO usuario registrado debe poder
-- subir video/publicar propiedades. El gate de publicación tiene 3 capas que ya
-- exigen role agent|admin (FAB del feed, RLS properties_insert, EF publish-property).
-- En vez de relajar las 3, los registros del signup libre nacen 'agent'.
--
-- ponytail: decisión de demo — cuando exista un alta de agente formal (KYC,
-- vetting), revertir a 'user' con el rollback y reintroducir el flujo de roles.
--
-- Idempotente: create or replace. Rollback: rollbacks/20260707000001_*.sql

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, phone, first_name, last_name, role)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(new.raw_user_meta_data ->> 'first_name', null),
    coalesce(new.raw_user_meta_data ->> 'last_name', null),
    'agent'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'AFTER INSERT en auth.users: crea perfil espejo en public.users con role=agent (demo: todo registro puede publicar). Idempotente.';
