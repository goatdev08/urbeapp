-- ════════════════════════════════════════════════════════════════════════════
-- #252 — El CREADOR de un anuncio o promoción recibe SIEMPRE el resultado de
-- la moderación, no solo el owner/admin de su agencia.
-- Origen: subtarea 219.2 · Detectado por: usuario (smoke en producción #222
-- paso 6, 2026-09-03).
--
-- ── EL HUECO, REPRODUCIDO EN PRODUCCIÓN ─────────────────────────────────────
-- El agente de prueba (agency_members.member_role = 'agent') promocionó su
-- propia propiedad; el admin la aprobó; la notificación ad_approved SÍ se
-- generó… y llegó ÚNICAMENTE a Vladimir, owner de la agencia. Quien tomó la
-- acción no recibió ningún aviso. No era un bug de ejecución: la lista de
-- destinatarios vigente (20260905100001, heredada de 20260826000001/#219.2) es
-- literalmente `join agency_members … member_role in ('owner','admin')`, y
-- ads.created_by_user_id nunca se consultaba.
--
-- DECISIÓN (Abraham, 2026-09-03, smoke #222) — deja de ser duda de producto:
--     destinatarios = (owner/admin ACTIVOS de la agencia)
--                   ∪ (ads.created_by_user_id)
--                   − (el admin actor)
-- con dedupe por user_id. El UNION sobre el creador es INCONDICIONAL: no se
-- re-verifica su membresía (quien envió algo a moderación merece saber en qué
-- acabó, aunque su membresía haya cambiado desde entonces). Es el complemento
-- —no la contradicción— de AD2/AD3 de la suite 72: un miembro suspendido o un
-- 'agent' que NO es el creador sigue sin recibir nada.
--
-- ── FORMA DEL DELTA (lo único que cambia) ───────────────────────────────────
-- El `from public.ads a join public.agency_members am …` del INSERT hacia
-- notifications pasa a ser un subquery con UNION (el UNION es el dedupe: el
-- owner que promociona lo suyo aparece en ambas ramas y recibe UN aviso), y el
-- `am.user_id is distinct from p_admin_id` sube al WHERE exterior para excluir
-- al actor de las DOS ramas, no solo de la de miembros.
-- ponytail: UNION sobre dos SELECT del mismo `ads`, sin CTE ni helper en
-- `private`. Es una sola lista de destinatarios usada en un solo lugar —
-- extraerla sería Speculative Generality. Techo conocido: si un segundo
-- escritor de espejos necesitara la misma lista, ahí sí toca el helper.
--
-- 🔴 GOTCHA #168 ("nunca del cuerpo viejo"): el cuerpo de abajo es VERBATIM la
-- definición VIGENTE verificada con pg_get_functiondef contra la base
-- (20260905100001_motivo_en_espejos_de_rechazo, la que pega « Motivo: » en el
-- body del rechazo) con SOLO el delta descrito. Firma, `returns`, `security
-- definer`, `set search_path`, textos de title/body, deep_link, `type`,
-- related_entity_* y `data`: IDÉNTICOS.
--
-- ── 🔴 PRODUCCIÓN VIVA (§0.5) ───────────────────────────────────────────────
--   · ADITIVO en lo observable: solo AÑADE filas de notifications para un
--     destinatario que hoy no recibe ninguna. Ningún aviso deja de emitirse:
--     con created_by_user_id null (todo ad previo a #217 y todo ad de Studio)
--     el reparto queda BYTE POR BYTE como hoy (CRE11).
--   · Ningún contrato publicado se rompe: misma firma, mismos `type`/
--     deep_link/`data`. El cliente ya pinta estas filas — SIN OTA, esta
--     migración se puede desplegar sola.
--   · Nada destructivo: create-or-replace de UNA función. Ni tablas, ni
--     columnas, ni policies, ni grants, ni triggers.
--   · Idempotente (create or replace) y con rollback en
--     supabase/migrations/rollbacks/20260905200001_creador_recibe_espejo_moderacion.sql
--
-- Tests: supabase/tests/94_creador_recibe_espejo_moderacion_test.sql (13
-- asserts) + la suite 72 completa (109) como contrato base intacto.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.moderate_ad_atomic(
  p_ad_id uuid, p_next_status text, p_rejection_reason text, p_admin_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rows integer;
  v_old_status public.ad_status;
  v_mirror_type text;
  v_ad_title text;
  v_title text;
  v_body text;
  v_reason text;
begin
  if p_next_status is null or p_next_status not in ('active', 'rejected', 'paused') then
    raise exception 'INVALID_NEXT_STATUS' using errcode = 'P0001';
  end if;

  -- #237: motivo normalizado SOLO para lo que se comunica. Lo que se persiste
  -- abajo sigue siendo p_rejection_reason crudo (el CHECK
  -- ads_rejection_reason_matches_status exige NOT NULL exactamente cuando el
  -- estado es 'rejected', y un motivo en blanco lo satisface: por eso este
  -- caso es alcanzable y hay que atajarlo aquí).
  v_reason := case when p_rejection_reason ~ '\S' then p_rejection_reason end;

  perform set_config('urbea.admin_actor_id', p_admin_id::text, true);
  select status into v_old_status from public.ads where id = p_ad_id;
  update public.ads
     set status           = p_next_status::public.ad_status,
         rejection_reason = p_rejection_reason
   where id = p_ad_id;
  get diagnostics v_rows = row_count;
  if v_rows > 0
     and v_old_status is distinct from p_next_status::public.ad_status
     and (p_next_status <> 'active' or v_old_status = 'pending_review')
  then
    v_mirror_type := case p_next_status
      when 'active' then 'ad_approved'
      when 'rejected' then 'ad_rejected'
      when 'paused' then 'ad_paused'
    end;
    select title into v_ad_title from public.ads where id = p_ad_id;
    v_title := case p_next_status
      when 'active' then 'Tu anuncio fue aprobado'
      when 'rejected' then 'Tu anuncio fue rechazado'
      when 'paused' then 'Tu anuncio fue pausado'
    end;
    -- El motivo se pega SOLO en la rama de rechazo: es la única en la que el
    -- CHECK permite que exista uno.
    v_body := case p_next_status
      when 'active' then 'Tu anuncio "' || v_ad_title || '" fue aprobado y ya está activo.'
      when 'rejected' then 'Tu anuncio "' || v_ad_title || '" fue rechazado.'
        || coalesce(' Motivo: ' || v_reason, '')
      when 'paused' then 'Tu anuncio "' || v_ad_title || '" fue retirado (pausado) por un administrador.'
    end;
    insert into public.notifications (
      user_id, type, title, body, deep_link,
      related_entity_type, related_entity_id, data
    )
    select
      d.user_id, v_mirror_type, v_title, v_body, '/ads',
      'ad', p_ad_id,
      jsonb_build_object('ad_title', v_ad_title)
        || case when v_reason is not null
             then jsonb_build_object('rejection_reason', v_reason)
             else '{}'::jsonb
           end
    -- #252: los owner/admin ACTIVOS de la agencia UNION el creador del ad. El
    -- UNION (no UNION ALL) es el dedupe -- un owner que promociona lo suyo
    -- aparece en las dos ramas y recibe UN solo aviso.
    from (
      select am.user_id
        from public.ads a
        join public.agency_members am
          on am.agency_id = a.agency_id
         and am.status = 'active'
         and am.member_role in ('owner', 'admin')
       where a.id = p_ad_id
      union
      select a.created_by_user_id
        from public.ads a
       where a.id = p_ad_id
         and a.created_by_user_id is not null
    ) d
    -- La exclusión del actor se aplica a la lista YA unida: un admin de
    -- plataforma que modera su propio anuncio no se autonotifica por ninguna
    -- de las dos vías.
    where d.user_id is distinct from p_admin_id;
  end if;
  return v_rows;
end;
$function$;

comment on function public.moderate_ad_atomic(uuid, text, text, uuid) is
  'Modera un anuncio (active/rejected/paused) y escribe el espejo '
  'ad_approved/ad_rejected/ad_paused en public.notifications. Destinatarios '
  '(#252): los miembros ACTIVOS owner/admin de la agencia UNION '
  'ads.created_by_user_id (el agente que lo envió), menos el admin actor. El '
  'UNION deduplica al owner que promociona lo suyo y es incondicional sobre '
  'el creador -- su membresía no se re-verifica. El motivo del rechazo viaja '
  'en el body y en data.rejection_reason (#237).';
