-- Rollback de 20260727000002_registro_constraints.sql (#72.2)
--
-- ⚠️ NO ES TOTALMENTE REVERSIBLE. Dos pérdidas conscientes:
--   1. Los teléfonos que el de-dup puso en NULL no se pueden restaurar (no se guardó
--      el valor previo). Eran duplicados exactos del teléfono de otra fila, así que no
--      identificaban a nadie, pero el dato se fue.
--   2. El backfill de state_id/municipality_id se pierde al dropear las columnas. Es
--      recuperable: basta re-aplicar la migración, que lo recalcula desde city/state
--      (por eso city/state se quedan y solo se marcan como deprecadas).

drop index if exists public.users_phone_unique_active;

alter table public.users drop constraint if exists users_municipio_del_estado;
alter table public.users drop constraint if exists users_mayoria_de_edad;
alter table public.users drop constraint if exists users_phone_e164_mx;

-- Restaura el CHECK original de 0002 que reemplazamos. El `drop if exists` previo es
-- lo que hace este rollback RE-EJECUTABLE: sin él, una segunda pasada truena porque
-- la constraint ya existe. Misma convención que
-- rollbacks/20260721000003_property_videos_duration.sql.
alter table public.users drop constraint if exists users_dob_not_future;
alter table public.users add constraint users_dob_not_future check (
  date_of_birth is null or date_of_birth <= current_date
);

-- El grant por columna que añadimos. Dropear la columna ya se lleva su ACL, pero
-- revocarlo antes deja la intención escrita y deja el rollback correcto aunque se
-- corra sin dropear columnas.
-- El guard de existencia es lo que lo hace RE-EJECUTABLE: en la segunda pasada las
-- columnas ya no están y un `revoke` a secas truena con 42703.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'state_id'
  ) then
    execute 'revoke update (state_id, municipality_id) on public.users from authenticated';
  end if;
end $$;

alter table public.users
  drop column if exists municipality_id,
  drop column if exists state_id;

comment on column public.users.city  is null;
comment on column public.users.state is null;

-- handle_new_user vuelve a la versión de 0002 (sin los campos de #72.2).
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
