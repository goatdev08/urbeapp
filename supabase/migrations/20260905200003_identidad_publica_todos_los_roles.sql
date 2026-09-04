-- Migración 20260905200001 — identidad pública del publicador para TODOS los roles (#250 + #254)
--
-- ── El hueco (smoke de producción #222, 2026-09-03) ─────────────────────────
-- Vladimir es role='admin' y dueño de las 8 propiedades activas de producción.
-- Para cualquier NO-admin su fila de public.users es invisible (la rama pública
-- de users_select solo abre role='agent' verificado), y el cliente leía el
-- teléfono de users.phone y la identidad ANIDADA bajo el embed de users → los
-- dos buscadores reales nunca vieron quién publica ni pudieron contactarlo.
-- Además la vista agent_public_profiles excluía role='user', así que Andrea
-- (buscadora con nombre puesto en «Editar perfil») salía como «Agente Urbea»,
-- y ni register_user_atomic ni redeem_invitation_atomic sembraban
-- user_preferences.full_name: los registros nuevos nacían sin nombre público.
--
-- ── Decisión (#116, «registrar ≠ exponer») ──────────────────────────────────
-- NO se toca users_select. Esa policy expone la fila COMPLETA de users
-- (date_of_birth, phone, email…) y abrirla a «quien publica» —o a todos, que es
-- lo que #254 pide— sería exponer mucho más de lo que la pantalla necesita.
-- La vista agent_public_profiles (security_invoker=false) ya era la ÚNICA
-- puerta de la identidad pública; aquí pasa a cubrir a todos los roles y gana
-- un has_phone DERIVADO para que el botón de WhatsApp no necesite el número:
-- lo resuelve la EF contact-agent server-side. Resultado neto: el cliente deja
-- de recibir el teléfono crudo en el feed y en el detalle (MENOS exposición que
-- hoy, no más), y ninguna columna nueva de users se abre.
--
-- Compatibilidad §0.5: todo es ADITIVO. La vista conserva sus 3 columnas en el
-- mismo orden (los builds instalados piden `full_name, profile_photo_url`) y
-- solo suma filas (role='user') y una columna al final. Ninguna RPC cambia su
-- firma ni sus errores. Orden de deploy: esta migración PRIMERO, el cliente por
-- OTA después.
--
-- Idempotente: create or replace + upsert condicional (nunca pisa un nombre
-- elegido por el usuario) + backfill re-ejecutable.
-- Rollback: supabase/migrations/rollbacks/20260905200003_identidad_publica_todos_los_roles.sql
-- Tests: supabase/tests/96_identidad_publica_test.sql (+ 41_agent_public_profiles_view_test.sql)

-- ════════════════════════════════════════════════════════════════════════════
-- (1) Helper de siembra del nombre público
-- ════════════════════════════════════════════════════════════════════════════
-- Vive en `private` (schema no expuesto por PostgREST) porque lo llaman las dos
-- RPCs de alta y el backfill — la misma expresión repetida en 3 lugares es
-- justo lo que el helper evita.
--
-- Invariante 🔒: NUNCA pisa un full_name existente. El nombre público es el que
-- el usuario pone en «Editar perfil»; esto solo lo SIEMBRA cuando aún no hay
-- ninguno (`where user_preferences.full_name is null` en el DO UPDATE).
create or replace function private.seed_public_full_name(p_user_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.user_preferences (user_id, full_name)
  select u.id, btrim(concat_ws(' ', u.first_name, u.last_name))
    from public.users u
   where u.id = p_user_id
     and coalesce(btrim(u.first_name), '') <> ''
  on conflict (user_id) do update
     set full_name = excluded.full_name
   where user_preferences.full_name is null;
$$;

comment on function private.seed_public_full_name(uuid) is
  'Siembra user_preferences.full_name con users.first_name + last_name (#254). '
  'Idempotente y NO destructiva: nunca pisa un nombre ya elegido por el usuario '
  'ni inventa uno si first_name está vacío. La llaman register_user_atomic, '
  'redeem_invitation_atomic y el backfill de esta migración.';

-- ════════════════════════════════════════════════════════════════════════════
-- (2) La vista: identidad pública de CUALQUIER rol + has_phone derivado
-- ════════════════════════════════════════════════════════════════════════════
-- Se quita `where u.role in ('agent','admin')`: el nombre y la foto son la
-- identidad que el usuario ELIGE mostrar (#254, decisión de producto de Abraham
-- 2026-09-03). Lo que sigue privado es el COMPORTAMIENTO del buscador
-- (presupuesto, ubicación, filtros): esas columnas nunca salen de la vista.
-- has_phone: booleano derivado. El check users_phone_e164_mx garantiza que
-- phone es NULL o un E.164 válido, así que `is not null` basta.
create or replace view public.agent_public_profiles
with (security_invoker = false) as
  select up.user_id,
         up.full_name,
         up.profile_photo_url,
         (u.phone is not null) as has_phone
  from public.user_preferences up
  join public.users u on u.id = up.user_id;

comment on view public.agent_public_profiles is
  'Identidad pública de CUALQUIER usuario (nombre + foto R2 key + has_phone derivado) '
  'legible por cualquier sesión autenticada. Brinca la RLS de user_preferences SOLO en '
  'estas columnas (#145, #250, #254). El teléfono crudo NO sale de aquí: el botón de '
  'WhatsApp se decide con has_phone y el número lo resuelve la EF contact-agent.';

revoke all on public.agent_public_profiles from anon, public;
grant select on public.agent_public_profiles to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- (3) Las dos puertas de alta siembran el nombre público
-- ════════════════════════════════════════════════════════════════════════════
-- Copia fiel de 20260729000001_register_user_atomic_rpc.sql + el paso (3).
-- Misma firma, mismos errores, mismos grants.
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
  -- (1) Completitud defensiva del perfil de §5.1.
  select phone, date_of_birth, state_id, municipality_id
    into v_phone, v_date_of_birth, v_state_id, v_municipality_id
    from public.users
   where id = p_user_id;

  if v_phone is null or v_date_of_birth is null or v_state_id is null or v_municipality_id is null then
    raise exception 'FIELDS_INCOMPLETE' using errcode = 'P0001';
  end if;

  -- (2) Consentimientos legales (auditoría LFPDPPP).
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

  -- (3) Nombre público (#254): el registro ya pidió first_name/last_name, así que
  -- la identidad nace visible en lugar de quedarse NULL hasta que el usuario
  -- entre a «Editar perfil». No pisa nada si ya hay nombre.
  perform private.seed_public_full_name(p_user_id);
end;
$$;

comment on function public.register_user_atomic(uuid, inet) is
  'Registro atómico §5.1/§5.5: valida completitud del perfil (phone/date_of_birth/state_id/municipality_id) + inserta 4 consentimientos + siembra el nombre público (#254), en una transacción. Errores (SQLSTATE P0001): FIELDS_INCOMPLETE, NO_ACTIVE_TERMS, NO_ACTIVE_PRIVACY. Llamar SOLO con service_role.';

revoke all on function public.register_user_atomic(uuid, inet) from public;
revoke all on function public.register_user_atomic(uuid, inet) from anon, authenticated;
grant execute on function public.register_user_atomic(uuid, inet) to service_role;

-- Copia fiel de 20260604000013_redeem_invitation_rpc.sql + el paso (5).
create or replace function public.redeem_invitation_atomic(
  p_token_id uuid,
  p_user_id  uuid,
  p_ip       inet default null
)
returns table (agency_id uuid, agency_member_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agency_id  uuid;
  v_member_id  uuid;
  v_terms_id   uuid;
  v_privacy_id uuid;
begin
  -- (1) Consumo atómico del token.
  update public.agency_invitation_tokens
     set current_uses = current_uses + 1
   where id = p_token_id
     and (max_uses is null or current_uses < max_uses)
  returning agency_invitation_tokens.agency_id into v_agency_id;

  if not found then
    raise exception 'TOKEN_MAX_USES_REACHED' using errcode = 'P0001';
  end if;

  -- (2) Membresía activa.
  begin
    insert into public.agency_members
      (agency_id, user_id, member_role, status, invitation_token_id)
    values
      (v_agency_id, p_user_id, 'agent', 'active', p_token_id)
    returning id into v_member_id;
  exception when unique_violation then
    raise exception 'ALREADY_ACTIVE_MEMBER' using errcode = 'P0001';
  end;

  -- (3) Denormalización del perfil: rol agente + agencia.
  update public.users
     set role = 'agent', agency_id = v_agency_id
   where id = p_user_id;

  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- (4) Consentimientos legales (auditoría LFPDPPP).
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

  -- (5) Nombre público (#254): mismo trato que el alta por registro. El agente
  -- invitado publica propiedades, así que su identidad debe existir desde el
  -- canje y no depender de que pase por «Editar perfil».
  perform private.seed_public_full_name(p_user_id);

  agency_id := v_agency_id;
  agency_member_id := v_member_id;
  return next;
end;
$$;

comment on function public.redeem_invitation_atomic(uuid, uuid, inet) is
  'Canje atómico de invitación de agente: consumo de token (UPDATE condicional) + agency_members + denormalización users + 4 consentimientos + siembra del nombre público (#254), en una transacción. Errores (SQLSTATE P0001): TOKEN_MAX_USES_REACHED, ALREADY_ACTIVE_MEMBER, USER_NOT_FOUND, NO_ACTIVE_TERMS, NO_ACTIVE_PRIVACY. Llamar SOLO con service_role.';

revoke all on function public.redeem_invitation_atomic(uuid, uuid, inet) from public;
revoke all on function public.redeem_invitation_atomic(uuid, uuid, inet) from anon, authenticated;
grant execute on function public.redeem_invitation_atomic(uuid, uuid, inet) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- (4) Backfill de los usuarios ya registrados
-- ════════════════════════════════════════════════════════════════════════════
-- Solo AGREGA: toca únicamente a quien tiene first_name y aún no tiene nombre
-- público (o ni siquiera fila de preferencias). Re-ejecutable: la segunda vez no
-- encuentra a nadie. No borra ni sobreescribe nada.
do $$
declare
  v_afectados int;
begin
  perform private.seed_public_full_name(u.id)
     from public.users u
     left join public.user_preferences up on up.user_id = u.id
    where coalesce(btrim(u.first_name), '') <> ''
      and (up.user_id is null or up.full_name is null);

  get diagnostics v_afectados = row_count;
  if v_afectados > 0 then
    raise notice '#254: nombre público sembrado para % usuarios ya registrados.', v_afectados;
  end if;
end $$;
