-- Migración 20260816000006 — máquina de estados de public.ads por TRIGGER +
-- auditoría obligatoria en admin_actions (subtarea 169.2, exploración 039
-- "Tarea B"). Extiende también la máquina de estados de public.agencies
-- (20260805000010) con active<->suspended, porque D2 ("suspender la
-- organización pausa el reloj de sus ads") presupone un estado alcanzable que
-- hoy no existe -- decisión de Abraham escalada durante el RED de esta
-- subtarea (ver bitácora 169.2, 2026-08-16).
--
-- Numeración: el plan original decía 20260815000011, pero eso correría ANTES
-- de 20260816000005_ads_schema.sql (169.1, quien crea la tabla public.ads) --
-- corregido a 20260816000006.
--
-- ── Alcance ──────────────────────────────────────────────────────────────────
-- 1) public.ads gana 2 columnas (D2 "pausar el reloj"): paused_at
--    timestamptz null, paused_by_suspension boolean not null default false
--    (el discriminador -- sin él, reactivar una organización resucitaría un
--    ad que un admin apagó a mano por moderación).
-- 2) Trigger BEFORE UPDATE public.handle_ad_status_change() sobre public.ads,
--    ÚNICA autoridad de la máquina de estados (mismo patrón que
--    handle_agency_status_change, 20260805000007/20260805000010):
--      - Matriz: draft->pending_review, pending_review->active,
--        active->{paused,expired,rejected}, paused->active. Cualquier otra
--        combinación (incluida draft->active DIRECTO) -> P0001
--        'INVALID_AD_STATUS_TRANSITION'. rejected/expired son TERMINALES.
--      - Exige un admin identificado (private.resolve_admin_actor(), reuso
--        literal del helper de 71.5) ANTES de aplicar cualquier efecto.
--      - pending_review->active FALLA con P0001 'ORGANIZATION_SUSPENDED' si
--        la agencia dueña del ad está 'suspended' EN ESE MOMENTO (no
--        reactivo a una suspensión futura).
--      - Auditoría SIEMPRE, en la MISMA transacción, en admin_actions
--        (entity_type='ad') -- si el INSERT falla, TODA la transición se
--        revierte (patrón moderate_property_atomic, 20260809000007:7,22,143,155).
--      - D2: active->paused estampa paused_at:=now() sin tocar ends_at;
--        paused->active recalcula ends_at:=ends_at+(now()-paused_at) y limpia
--        paused_at.
--      - WHEN (old.status IS DISTINCT FROM new.status): un UPDATE que
--        reescribe el mismo status es un no-op benigno, ni exige admin ni
--        audita (mismo criterio que 71.5).
--    El CHECK ads_rejection_reason_matches_status (169.1) sigue vivo sin que
--    el trigger lo enmascare -- es un constraint de tabla, se evalúa después
--    de que el BEFORE trigger retorna NEW.
-- 3) create or replace public.handle_agency_status_change() (hoy en
--    20260805000010:30-102, NO se edita ese archivo -- create or replace es
--    el patrón del repo): matriz += active->suspended, suspended->active
--    (ambas exigen admin + auditan 'agency'); pending_approval->{active,
--    rejected} sigue exactamente igual, mismo P0001 'INVALID_STATUS_TRANSITION'
--    reusado literal. pending_approval->suspended SIGUE FALLANDO (asertado
--    también en 25_admin_approvals_test.sql:319-323, esa suite no se toca).
--    🔴 La trampa: el branch que crea agency_members(owner,active) + promueve
--    al usuario (D5 de 71.5) queda gateado a
--    old.status='pending_approval' explícito -- en suspended->active NO
--    debe volver a correr (RED sección 12).
--    Cascadas (D2, en la MISMA transacción que el UPDATE de agencies):
--      active->suspended:  ads 'active' de esa agencia -> 'paused',
--        paused_by_suspension=true (pasa por el trigger de ads, que estampa
--        paused_at, no toca ends_at, y audita 'ad'). Aislada por agency_id.
--      suspended->active:  ads 'paused' de esa agencia CON
--        paused_by_suspension=true -> 'active' (pasa por el trigger de ads,
--        que recalcula ends_at y limpia el discriminador). Un ad pausado a
--        mano (paused_by_suspension=false) queda FUERA del WHERE -- el
--        discriminador es justo lo que evita resucitarlo.
--
-- Contrato completo y los 75 asserts pgTAP:
-- supabase/tests/48_ads_state_machine_test.sql (archivo propio, no se
-- agregan asserts a 47_ads_schema_test.sql -- precedente 39 vs 37/38).
--
-- Idempotente: alter table add column if not exists, create or replace
-- function, drop trigger if exists + create trigger.
-- Rollback: supabase/migrations/rollbacks/20260816000006_ads_state_machine.sql

-- ════════════════════════════════════════════════════════════════════════════
-- 1) public.ads — columnas de contabilidad para D2 "pausar el reloj".
-- ════════════════════════════════════════════════════════════════════════════

alter table public.ads add column if not exists paused_at timestamptz null;
alter table public.ads add column if not exists paused_by_suspension boolean not null default false;

comment on column public.ads.paused_at is
  'D2 (169.2) "pausar el reloj": timestamp en que el ad entró a paused. NULL '
  'mientras no está pausado. Al reactivar (paused->active) se usa para '
  'recalcular ends_at y luego se limpia a NULL.';
comment on column public.ads.paused_by_suspension is
  '🔒 Discriminador (169.2): true cuando la cascada de suspensión de la '
  'organización pausó este ad (no un admin a mano por moderación). Solo los '
  'ads con este valor en true reviven al reactivar la organización -- sin '
  'esta columna, reactivar resucitaría un ad que un admin apagó a propósito.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Trigger: public.ads — máquina de estados + auditoría obligatoria.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.handle_ad_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
begin
  -- Matriz de transiciones válidas (D2, 169.2). draft->active DIRECTO queda
  -- deliberadamente fuera: "jamás se sirve sin moderación". rejected/expired
  -- son TERMINALES (ninguna transición de salida).
  if not (
    (old.status = 'draft' and new.status = 'pending_review')
    or (old.status = 'pending_review' and new.status = 'active')
    or (old.status = 'active' and new.status in ('paused', 'expired', 'rejected'))
    or (old.status = 'paused' and new.status = 'active')
  ) then
    raise exception 'INVALID_AD_STATUS_TRANSITION' using errcode = 'P0001';
  end if;

  -- Defensa en profundidad: exige un admin identificado ANTES de aplicar
  -- cualquier efecto, aunque el caller ya tenga GRANT de tabla (service_role).
  v_admin_id := private.resolve_admin_actor();

  -- Bloquea activar bajo una organización YA suspendida EN ESE MOMENTO (no
  -- reactivo a una suspensión futura -- decisión de Abraham, hueco que
  -- detectó el analista sobre el plan original).
  if old.status = 'pending_review' and new.status = 'active' then
    if exists (
      select 1 from public.agencies where id = new.agency_id and status = 'suspended'
    ) then
      raise exception 'ORGANIZATION_SUSPENDED' using errcode = 'P0001';
    end if;
  end if;

  -- D2 "pausar el reloj": conserva los días restantes en vez de perderlos.
  if old.status = 'active' and new.status = 'paused' then
    new.paused_at := now();
  elsif old.status = 'paused' and new.status = 'active' then
    -- coalesce: un ad sembrado DIRECTO en 'paused' (fixture de test, nunca
    -- pasó por la rama active->paused de este trigger) puede traer
    -- paused_at NULL -- sin días que devolver, ends_at queda intacto en vez
    -- de propagar NULL y violar el NOT NULL de la columna.
    new.ends_at := old.ends_at + coalesce(now() - old.paused_at, interval '0');
    new.paused_at := null;
    new.paused_by_suspension := false;
  end if;

  -- Auditoría SIEMPRE, en la MISMA transacción. Si este INSERT falla, TODO lo
  -- anterior se revierte (patrón moderate_property_atomic, 20260809000007).
  -- Sin bloque EXCEPTION a propósito -- cualquier fallo debe propagar.
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
  'Trigger BEFORE UPDATE en ads (subtarea 169.2): ÚNICA autoridad de la '
  'máquina de estados {draft->pending_review, pending_review->active, '
  'active->{paused,expired,rejected}, paused->active}. Exige un admin '
  'identificado (private.resolve_admin_actor), bloquea activar bajo una '
  'organización suspendida (ORGANIZATION_SUSPENDED), aplica D2 "pausar el '
  'reloj" y registra SIEMPRE en admin_actions en la misma transacción. Solo '
  'se dispara si status realmente cambia (WHEN clause del CREATE TRIGGER).';

drop trigger if exists ads_status_change on public.ads;
create trigger ads_status_change
  before update on public.ads
  for each row
  when (old.status is distinct from new.status)
  execute function public.handle_ad_status_change();

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Extensión de public.handle_agency_status_change() (hoy en
--    20260805000010:30-102, no se edita ese archivo) -- += active<->suspended
--    con cascada hacia ads.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.handle_agency_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
begin
  -- Matriz vigente (71.5/fix 99) += active->suspended, suspended->active
  -- (169.2). pending_approval->suspended SIGUE FALLANDO -- no se amplía a esa
  -- combinación (25_admin_approvals_test.sql:319-323 lo asserta, sin tocarla).
  if not (
    (old.status = 'pending_approval' and new.status in ('active', 'rejected'))
    or (old.status = 'active' and new.status = 'suspended')
    or (old.status = 'suspended' and new.status = 'active')
  ) then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
  end if;

  v_admin_id := private.resolve_admin_actor();

  if old.status = 'pending_approval' and new.status = 'active' then
    -- D5 (71.5): aprobar -> membresía owner activa + promoción/denormalización
    -- del creador. 🔴 Gateado a old.status='pending_approval' EXPLÍCITO -- en
    -- suspended->active esto NO debe volver a correr (RED sección 12: la
    -- membresía no se duplica ni se re-promueve al owner).
    begin
      insert into public.agency_members (agency_id, user_id, member_role, status)
      values (new.id, old.created_by_user_id, 'owner', 'active');
    exception
      when unique_violation then
        -- fix 99: MEMBER_OF_OTHER_AGENCY con hint operativo (antes
        -- ALREADY_ACTIVE_MEMBER sin guía).
        raise exception 'MEMBER_OF_OTHER_AGENCY' using errcode = 'P0001', hint =
          'El creador ya tiene una membresía activa en otra agencia. Remuévelo o '
          'cámbialo de esa agencia (EF manage-agency-member o Studio) antes de '
          'volver a intentar esta aprobación.';
    end;

    -- fix 99: nunca degradar a un admin. agency_id SÍ se denormaliza siempre.
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
    -- D6: rechazar -> solo status + auditoría. approved_by_admin_id intacto.
    insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values)
    values (
      v_admin_id, 'reject_agency', 'agency', new.id,
      jsonb_build_object('status', old.status::text),
      jsonb_build_object('status', new.status::text)
    );
  elsif old.status = 'active' and new.status = 'suspended' then
    -- Cascada D2 (169.2): los ads 'active' de esta agencia pasan a 'paused'
    -- con paused_by_suspension=true, en la MISMA transacción -- pasa por el
    -- trigger de ads (estampa paused_at, no toca ends_at, audita 'ad').
    -- Aislada por agency_id (no toca ads de otras organizaciones ni ads que
    -- no estén 'active').
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
    -- Cascada de reactivación: SOLO los ads que la cascada de suspensión
    -- pausó (paused_by_suspension=true) vuelven a 'active' -- el discriminador
    -- 🔒 evita resucitar un ad que un admin apagó a mano por moderación
    -- (paused_by_suspension=false queda fuera del WHERE). Pasa por el trigger
    -- de ads, que recalcula ends_at y limpia el discriminador.
    update public.ads
       set status = 'active'
     where agency_id = new.id and status = 'paused' and paused_by_suspension = true;

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
  'Trigger BEFORE UPDATE en agencies (71.5, fix 99, 169.2): valida la máquina '
  'de estados {pending_approval->active, pending_approval->rejected, '
  'active->suspended, suspended->active}, exige un admin identificado (D3/D4), '
  'aplica D5 (aprobar: membresía owner + promoción SOLO si no era admin + '
  'agency_id, SOLO en pending_approval->active) / D6 (rechazar: solo '
  'auditoría) / cascada D2 169.2 (suspender: pausa los ads active de la '
  'agencia; reactivar: revive SOLO los que pausó esa cascada). '
  'pending_approval->suspended sigue fuera de alcance -- INVALID_STATUS_TRANSITION.';
