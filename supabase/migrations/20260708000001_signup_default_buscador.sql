-- Migración 0012 — Revertir registro libre a role='user' (buscador)
--
-- Contexto: PR #15 introdujo la regresión role='agent' universal
-- (20260707000001_signup_default_agent.sql). Restaurar el modelo de negocio
-- correcto: registro libre → buscador (role='user'); alta de agente → SOLO
-- vía invitación (redeem_invitation_atomic la sube a 'agent' explícitamente).
--
-- ponytail: decisión cerrada (post-demo) — el flujo de roles descrito arriba
-- es la arquitectura final, no un ajuste temporal de demo.
--
-- Idempotente: create or replace. Rollback: rollbacks/20260708000001_*.sql

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
  'AFTER INSERT en auth.users: crea perfil espejo en public.users con role=user (default de la columna). Alta de agente solo vía redeem_invitation_atomic. Idempotente.';
