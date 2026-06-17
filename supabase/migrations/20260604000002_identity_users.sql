-- Migración 0002 — Identidad: public.users (perfil espejo de auth.users) + handle_new_user
-- Propósito: tabla de perfil de aplicación enlazada 1:1 con auth.users. El rol del usuario
-- (user/agent/admin) vive aquí. agency_id se agrega como FK en 0003 (dependencia circular con agencies).
-- Supabase Auth es dueño de auth.users; el perfil se crea automáticamente vía trigger handle_new_user.

create table if not exists public.users (
  id                  uuid primary key references auth.users (id) on delete cascade,
  email               citext not null,
  phone               text,
  first_name          text,
  last_name           text,
  date_of_birth       date,
  city                text,
  state               text,
  bio                 text,
  avatar_url          text,
  role                user_role not null default 'user',
  agency_id           uuid,          -- FK a agencies se agrega en 0003 (denormalización de membresía activa)
  is_verified_agent   boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  last_login_at       timestamptz,
  deleted_at          timestamptz,
  deletion_pending_at timestamptz,
  constraint users_dob_not_future check (date_of_birth is null or date_of_birth <= current_date)
);

comment on table public.users is
  'Perfil de aplicación, espejo 1:1 de auth.users. role: user|agent|admin. agency_id es denormalización; la verdad de la membresía es agency_members.';

-- Email único solo entre usuarios no borrados (soft delete permite reusar email tras baja definitiva).
create unique index if not exists users_email_unique_active
  on public.users (email) where deleted_at is null;
create index if not exists users_role_idx
  on public.users (role) where deleted_at is null;
create index if not exists users_agency_id_idx
  on public.users (agency_id);

-- Trigger updated_at
drop trigger if exists set_updated_at on public.users;
create trigger set_updated_at before update on public.users
  for each row execute function public.set_updated_at();

-- ── handle_new_user: crea el perfil espejo al registrarse en auth.users ──────────
-- Patrón canónico de Supabase, explícitamente permitido (lineamientos §9.1). SECURITY DEFINER
-- porque escribe en public.users desde el contexto de auth. Idempotente con ON CONFLICT.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, phone, first_name, last_name)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(new.raw_user_meta_data ->> 'first_name', null),
    coalesce(new.raw_user_meta_data ->> 'last_name', null)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'AFTER INSERT en auth.users: crea perfil espejo en public.users con role=user. Idempotente.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
