-- Migración 20260823000002 — takedown de anuncios activos (tarea #210, subtarea 210.1).
-- Aditiva/permisiva (RPC) + endurecimiento (trigger). Idempotente.
-- Rollback: rollbacks/20260823000002_ad_takedown_admin.sql
-- Tests: supabase/tests/66_ad_takedown_test.sql (27/27)
--
-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 POR QUÉ EXISTE. moderate_ad_atomic (208.1) solo deja pasar
-- p_next_status en {'active','rejected'} — un admin puede aprobar/rechazar en
-- revisión, pero NO puede retirar (pausar) un anuncio YA activo. El trigger
-- handle_ad_status_change() YA acepta active→paused y paused→active en su
-- matriz (169.2, D2 "pausar el reloj"): el único bloqueo es el guard de la
-- RPC. Esta migración amplía ESE guard, nada más — no toca el grafo del
-- trigger para esas dos aristas, que ya existían.
--
-- 🔴 GAP DE SEGURIDAD que se cierra en el mismo cambio. La columna
-- ads.paused_by_suspension (#169.2) existe EXACTAMENTE para distinguir "un
-- admin pausó este anuncio a mano" de "la cascada de suspensión de la
-- organización lo pausó". Sin guard, abrir paused→active a un click aislado
-- sobre un ad individual permitiría resucitar un anuncio cuya organización
-- SIGUE suspendida — ese caso solo debe resolverlo la cascada de reactivación
-- de la organización (tarea #211), nunca la moderación de un ad suelto. El
-- guard vive en el TRIGGER (handle_ad_status_change), no solo en la RPC: es
-- la única autoridad del grafo, y un UPDATE directo bypaseando la RPC debe
-- quedar igual de bloqueado (mismo patrón de defensa en profundidad que el
-- resto del trigger).
--
-- 🔴 HALLAZGO durante el GREEN (no estaba en el plan de 210.1): la cascada de
-- reactivación de organización YA EXISTE desde 169.2
-- (public.handle_agency_status_change, rama suspended→active en
-- 20260816000006) y hace EXACTAMENTE paused→active con
-- paused_by_suspension=true — es el flujo legítimo que 48
-- (CASCADAREACT/DISCRIMINADOR) ya cubre en verde. El plan de 210.1 asumía
-- "nada hoy pone paused_by_suspension=true todavía" — falso: 169.2 ya lo hace
-- al SUSPENDER, y ya lo consume al REACTIVAR. Un guard ciego en
-- handle_ad_status_change() bloquearía también esa cascada legítima
-- (regresión confirmada: 9 asserts de 48 rompen). Se resuelve con un GUC de
-- transacción — mismo patrón que urbea.admin_actor_id — que la cascada
-- instala ANTES de su UPDATE y limpia inmediatamente después: el guard nuevo
-- solo bloquea paused→active cuando NADIE marcó "esto es la cascada de
-- reactivación de organización", que es exactamente el caso de un click
-- aislado sobre un ad (RPC o UPDATE directo).
--
-- 🔴 LO QUE ESTA MIGRACIÓN NO HACE:
--   · NO reabre ninguna arista del grafo — active→paused y paused→active ya
--     estaban en la matriz del trigger desde 169.2. Solo se amplía qué
--     p_next_status deja pasar la RPC.
--   · NO cambia el WHERE de la cascada de reactivación (agency_id + status
--     'paused' + paused_by_suspension=true) — sigue siendo el ÚNICO
--     mecanismo que resume un ad pausado por suspensión.
--   · NO toca D2 (recorrer ends_at al pausar/resumir) — el cuerpo se copia
--     verbatim de 20260822000003 salvo el guard nuevo.
--
-- Producción viva (§0.5): la RPC es SOLO service_role (ningún cliente
-- instalado la invoca desde fuera de una Edge Function), así que ampliar su
-- guard a 'paused' es puramente permisivo. El guard nuevo en el trigger es un
-- endurecimiento sobre un caso ALCANZABLE hoy (corrección del guardian de
-- 210.1): la cascada de suspensión de organización (169.2, 20260816000006) YA
-- pone paused_by_suspension=true al suspender, y suspender una organización es
-- alcanzable por SQL/Studio desde entonces (#211 solo le pondrá interfaz). El
-- endurecimiento es SEGURO precisamente por eso: convierte una reactivación
-- accidental (bug silencioso) en un P0001 tipado. La EF moderate-ad aprende a
-- traducirlo a 409 en 210.2 (hasta entonces caería como DB_ERROR 500 — caso de
-- baja probabilidad: la cola admin solo lista pending_review).
-- ════════════════════════════════════════════════════════════════════════════

-- 1) moderate_ad_atomic: el guard admite 'paused' además de active/rejected.
create or replace function public.moderate_ad_atomic(
  p_ad_id            uuid,
  p_next_status      text,
  p_rejection_reason text,
  p_admin_id         uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  -- Frontera de confianza: `ads.status` tiene 6 valores y solo tres son un
  -- resultado de moderación (210.1 suma 'paused' — retirar un anuncio
  -- activo). Sin este guard, un caller podría empujar 'expired' —una
  -- transición que el trigger sí acepta desde 'active'— saltándose la
  -- semántica de "moderar". Se valida ANTES de tocar la fila para que no
  -- queden efectos parciales.
  if p_next_status is null or p_next_status not in ('active', 'rejected', 'paused') then
    raise exception 'INVALID_NEXT_STATUS' using errcode = 'P0001';
  end if;

  -- Instala el admin para private.resolve_admin_actor(). `true` = is_local:
  -- vive solo dentro de esta transacción, así que no contamina la conexión
  -- del pool para la siguiente petición.
  perform set_config('urbea.admin_actor_id', p_admin_id::text, true);

  update public.ads
     set status           = p_next_status::public.ad_status,
         rejection_reason = p_rejection_reason
   where id = p_ad_id;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function public.moderate_ad_atomic(uuid, text, text, uuid) is
  'Modera un anuncio (208.1, ampliada en 210.1): instala p_admin_id en el GUC '
  'urbea.admin_actor_id (transacción local) y hace UN update sobre public.ads. '
  'La validez de la transición, el guard de organización suspendida, el guard '
  'AD_PAUSED_BY_SUSPENSION y la auditoría en admin_actions los aplica el '
  'trigger handle_ad_status_change() — esta RPC NO los duplica. p_next_status '
  'admite active|rejected|paused (INVALID_NEXT_STATUS si no). Devuelve las '
  'filas afectadas: 0 = el anuncio no existe (sin excepción, para que el '
  'caller responda 404), 1 = moderado. SOLO service_role: instala un '
  'admin_actor arbitrario.';

revoke execute on function public.moderate_ad_atomic(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.moderate_ad_atomic(uuid, text, text, uuid)
  to service_role;

-- 2) handle_ad_status_change(): mismo cuerpo vigente de 20260822000003, más
-- el guard AD_PAUSED_BY_SUSPENSION en paused→active. El grafo de aristas NO
-- cambia (paused→active ya estaba permitido) — lo que cambia es que esa
-- arista específica ahora exige paused_by_suspension = false.
create or replace function public.handle_ad_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
begin
  if not (
    (old.status = 'draft' and new.status = 'pending_review')
    or (old.status = 'pending_review' and new.status in ('active', 'rejected'))
    or (old.status = 'active' and new.status in ('paused', 'expired', 'rejected', 'pending_review'))
    or (old.status = 'paused' and new.status = 'active')
  ) then
    raise exception 'INVALID_AD_STATUS_TRANSITION' using errcode = 'P0001';
  end if;

  -- 210.1: guard de suspensión. paused_by_suspension=true significa "la
  -- cascada de suspensión de la organización pausó este ad" — solo la
  -- cascada de REACTIVACIÓN de esa misma organización (169.2,
  -- handle_agency_status_change) puede resumirlo. Un click aislado sobre el
  -- ad (RPC moderate_ad_atomic o UPDATE directo) NO basta. El discriminador
  -- es el GUC urbea.ad_cascade_reactivation, que la cascada instala
  -- SOLO alrededor de su propio UPDATE (mismo patrón que
  -- urbea.admin_actor_id) — así el guard distingue "resume por la cascada
  -- legítima" de "resume aislado" sin depender de quién sea el admin. Se
  -- valida antes de resolver el admin porque es un guard de DATOS, no de
  -- identidad.
  if old.status = 'paused' and new.status = 'active' and old.paused_by_suspension
     and coalesce(nullif(current_setting('urbea.ad_cascade_reactivation', true), ''), 'false') <> 'true'
  then
    raise exception 'AD_PAUSED_BY_SUSPENSION' using errcode = 'P0001';
  end if;

  -- Democión de SISTEMA (tarea #192): editar la descripción de un ad activo lo
  -- regresa a revisión. Sin admin y sin auditoría, a propósito.
  if old.status = 'active' and new.status = 'pending_review' then
    if old.description is distinct from new.description then
      return new;
    else
      raise exception 'INVALID_AD_STATUS_TRANSITION' using errcode = 'P0001';
    end if;
  end if;

  v_admin_id := private.resolve_admin_actor();

  if old.status = 'pending_review' and new.status = 'active' then
    if exists (
      select 1 from public.agencies where id = new.agency_id and status = 'suspended'
    ) then
      raise exception 'ORGANIZATION_SUSPENDED' using errcode = 'P0001';
    end if;
  end if;

  if old.status = 'active' and new.status = 'paused' then
    new.paused_at := now();
  elsif old.status = 'paused' and new.status = 'active' then
    new.ends_at := old.ends_at + (now() - old.paused_at);
    new.paused_at := null;
    new.paused_by_suspension := false;
  end if;

  insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values)
  values (
    v_admin_id, 'change_ad_status', 'ad', new.id,
    jsonb_build_object('status', old.status::text),
    jsonb_build_object('status', new.status::text)
  );

  return new;
end;
$$;

comment on function public.handle_ad_status_change() is
  'Trigger BEFORE UPDATE en ads (169.2 + #192 + 208.1 + 210.1): ÚNICA '
  'autoridad de la máquina de estados {draft→pending_review, '
  'pending_review→{active,rejected}, active→{paused,expired,rejected, '
  'pending_review}, paused→active}, más active→pending_review SOLO como '
  'democión de SISTEMA (la descripción cambió en el mismo UPDATE — sin '
  'admin, sin auditoría). 210.1 agregó el guard AD_PAUSED_BY_SUSPENSION: '
  'paused→active con paused_by_suspension=true lanza SIEMPRE, salvo cuando '
  'el GUC urbea.ad_cascade_reactivation está en ''true'' — lo instala '
  'ÚNICAMENTE public.handle_agency_status_change() alrededor de su propia '
  'cascada de reactivación (169.2). Un click aislado sobre el ad (RPC '
  'moderate_ad_atomic o UPDATE directo) nunca lo instala, así que siempre '
  'queda bloqueado. Para las demás transiciones exige un admin identificado '
  '(private.resolve_admin_actor), bloquea activar bajo una organización '
  'suspendida (ORGANIZATION_SUSPENDED), aplica D2 "pausar el reloj" y '
  'registra SIEMPRE en admin_actions en la misma transacción.';

-- 3) handle_agency_status_change(): mismo cuerpo vigente de 20260816000006,
-- salvo que la cascada de reactivación (rama suspended→active) ahora instala
-- el GUC urbea.ad_cascade_reactivation alrededor de su propio UPDATE, para
-- que el guard nuevo del punto 2 la reconozca como legítima. Ninguna otra
-- rama cambia.
create or replace function public.handle_agency_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
begin
  if not (
    (old.status = 'pending_approval' and new.status in ('active', 'rejected'))
    or (old.status = 'active' and new.status = 'suspended')
    or (old.status = 'suspended' and new.status = 'active')
  ) then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
  end if;

  v_admin_id := private.resolve_admin_actor();

  if old.status = 'pending_approval' and new.status = 'active' then
    begin
      insert into public.agency_members (agency_id, user_id, member_role, status)
      values (new.id, old.created_by_user_id, 'owner', 'active');
    exception
      when unique_violation then
        raise exception 'MEMBER_OF_OTHER_AGENCY' using errcode = 'P0001', hint =
          'El creador ya tiene una membresía activa en otra agencia. Remuévelo o '
          'cámbialo de esa agencia (EF manage-agency-member o Studio) antes de '
          'volver a intentar esta aprobación.';
    end;

    update public.users
       set role      = case when role = 'admin' then role else 'agent' end,
           agency_id = new.id
     where id = old.created_by_user_id;

    new.approved_by_admin_id := v_admin_id;

    insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values)
    values (
      v_admin_id, 'approve_agency', 'agency', new.id,
      jsonb_build_object('status', old.status::text),
      jsonb_build_object('status', new.status::text)
    );
  elsif old.status = 'pending_approval' and new.status = 'rejected' then
    insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values)
    values (
      v_admin_id, 'reject_agency', 'agency', new.id,
      jsonb_build_object('status', old.status::text),
      jsonb_build_object('status', new.status::text)
    );
  elsif old.status = 'active' and new.status = 'suspended' then
    update public.ads
       set status = 'paused', paused_by_suspension = true
     where agency_id = new.id and status = 'active';

    insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values)
    values (
      v_admin_id, 'suspend_agency', 'agency', new.id,
      jsonb_build_object('status', old.status::text),
      jsonb_build_object('status', new.status::text)
    );
  elsif old.status = 'suspended' and new.status = 'active' then
    -- 210.1: marca esta UPDATE como "la cascada legítima" para el guard
    -- AD_PAUSED_BY_SUSPENSION del punto 2 — `true` = is_local, vive solo en
    -- esta transacción. Se limpia justo después del UPDATE para no dejar el
    -- GUC en 'true' por el resto de la transacción (p. ej. si el mismo
    -- caller hiciera otra operación sobre ads después, en la misma request).
    perform set_config('urbea.ad_cascade_reactivation', 'true', true);

    update public.ads
       set status = 'active'
     where agency_id = new.id and status = 'paused' and paused_by_suspension = true;

    perform set_config('urbea.ad_cascade_reactivation', 'false', true);

    insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values)
    values (
      v_admin_id, 'reactivate_agency', 'agency', new.id,
      jsonb_build_object('status', old.status::text),
      jsonb_build_object('status', new.status::text)
    );
  end if;

  return new;
end;
$$;

comment on function public.handle_agency_status_change() is
  'Trigger BEFORE UPDATE en agencies (71.5, fix 99, 169.2, 210.1): valida la '
  'máquina de estados {pending_approval->active, pending_approval->rejected, '
  'active->suspended, suspended->active}, exige un admin identificado (D3/D4), '
  'aplica D5 (aprobar: membresía owner + promoción SOLO si no era admin + '
  'agency_id, SOLO en pending_approval->active) / D6 (rechazar: solo '
  'auditoría) / cascada D2 169.2 (suspender: pausa los ads active de la '
  'agencia; reactivar: revive SOLO los que pausó esa cascada). 210.1: la '
  'cascada de reactivación instala el GUC urbea.ad_cascade_reactivation '
  'alrededor de su UPDATE para que handle_ad_status_change() la reconozca '
  'como legítima frente al guard AD_PAUSED_BY_SUSPENSION. '
  'pending_approval->suspended sigue fuera de alcance -- INVALID_STATUS_TRANSITION.';
