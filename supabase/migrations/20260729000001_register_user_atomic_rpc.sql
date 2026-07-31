-- Migración — RPC atómica de registro (register_user_atomic), subtarea 93.1
-- Propósito: dado un user_id ya creado por la Edge Function de registro (subtarea 93.2,
-- via auth.admin.createUser), verificar DEFENSIVAMENTE que el perfil de §5.1
-- (phone, date_of_birth, state_id, municipality_id) no quedó NULL -- protege contra typos
-- en las claves de raw_user_meta_data, que handle_new_user (migración 0002) ignora
-- silenciosamente guardando NULL -- e insertar ATÓMICAMENTE los 4 consentimientos legales
-- (terms, privacy, age, whatsapp) de §5.5, en la misma transacción que la validación.
-- NO toca handle_new_user, NO escribe en public.users (solo lee), NO agrega NOT NULL
-- (deuda documentada en 20260727000002_registro_constraints.sql, fuera de alcance).
-- Se llama SOLO con service_role (la Edge Function); NO se expone a anon/authenticated.
-- Idempotente (create or replace + grants repetibles). Rollback en rollbacks/.

create or replace function public.register_user_atomic(
  p_user_id uuid,
  p_ip      inet default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone           text;
  v_date_of_birth   date;
  v_state_id        text;
  v_municipality_id text;
  v_terms_id        uuid;
  v_privacy_id      uuid;
begin
  -- (1) Completitud defensiva del perfil de §5.1. Una fila inexistente en public.users
  -- deja las 4 variables en NULL igual que un perfil incompleto -- mismo código de error
  -- (ver contrato documentado en el test 19_register_user_atomic_test.sql).
  select phone, date_of_birth, state_id, municipality_id
    into v_phone, v_date_of_birth, v_state_id, v_municipality_id
    from public.users
   where id = p_user_id;

  if v_phone is null or v_date_of_birth is null or v_state_id is null or v_municipality_id is null then
    raise exception 'FIELDS_INCOMPLETE' using errcode = 'P0001';
  end if;

  -- (2) Consentimientos legales (auditoría LFPDPPP). terms/privacy exigen la versión
  --     vigente; age/whatsapp van con terms_version_id NULL (constraint consent_version_presence).
  select id into v_terms_id
    from public.terms_versions
   where doc_type = 'terms' and is_current;
  if v_terms_id is null then
    raise exception 'NO_ACTIVE_TERMS' using errcode = 'P0001';
  end if;

  select id into v_privacy_id
    from public.terms_versions
   where doc_type = 'privacy' and is_current;
  if v_privacy_id is null then
    raise exception 'NO_ACTIVE_PRIVACY' using errcode = 'P0001';
  end if;

  insert into public.user_consents (user_id, consent_type, terms_version_id, ip_address)
  values
    (p_user_id, 'terms',    v_terms_id,   p_ip),
    (p_user_id, 'privacy',  v_privacy_id, p_ip),
    (p_user_id, 'age',      null,         p_ip),
    (p_user_id, 'whatsapp', null,         p_ip);
end;
$$;

comment on function public.register_user_atomic(uuid, inet) is
  'Registro atómico §5.1/§5.5: valida completitud del perfil (phone/date_of_birth/state_id/municipality_id) + inserta 4 consentimientos, en una transacción. Errores (SQLSTATE P0001): FIELDS_INCOMPLETE, NO_ACTIVE_TERMS, NO_ACTIVE_PRIVACY. Llamar SOLO con service_role.';

-- Seguridad: la lógica de negocio sale por la Edge Function (service_role). No exponer al cliente.
revoke all on function public.register_user_atomic(uuid, inet) from public;
revoke all on function public.register_user_atomic(uuid, inet) from anon, authenticated;
grant execute on function public.register_user_atomic(uuid, inet) to service_role;
