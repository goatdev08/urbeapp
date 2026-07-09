-- Rollback 0012 — restaura handle_new_user a role='agent' explícito (versión 0011)
-- Nunca debería aplicarse en circunstancias normales: la migración forward
-- 20260708000001 corrige una regresión. Se provee por convención del repo.

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
