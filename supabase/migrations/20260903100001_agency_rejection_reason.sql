-- Migración 20260903100001 — public.agencies.rejection_reason: el motivo del
-- rechazo de un REGISTRO de inmobiliaria le llega al solicitante (tarea #234,
-- derivada de la subtarea 221.2).
-- Rollback: supabase/migrations/rollbacks/20260903100001_agency_rejection_reason.sql
-- Tests: supabase/tests/85_agency_rejection_reason_test.sql (contrato nuevo)
--        supabase/tests/84_resolve_agency_registration_test.sql (REJ5 invertido)
--
-- ════════════════════════════════════════════════════════════════════════════
-- EL HUECO (limitación que la propia 20260902100003 dejó anclada por el assert
-- REJ5 de la suite 84): al rechazar un registro, el motivo quedaba SOLO en
-- admin_actions —tabla que el solicitante no puede leer— y el espejo
-- 'agency_rejected' de #219.2 llegaba con «Tu inmobiliaria "X" fue rechazada.»
-- y nada más. La persona veía la puerta cerrada sin saber qué corregir.
--
-- ADITIVA: 1 columna nullable + create-or-replace de 2 funciones cuyas FIRMAS,
-- grants y códigos de error quedan IDÉNTICOS. Ningún contrato publicado cambia
-- (§0.5): los builds instalados siguen llamando
-- `resolve_agency_registration(uuid, boolean, text)` con la misma respuesta y
-- el mismo vocabulario de errores; `select('*')` sobre agencies sigue
-- funcionando (ver 🔒 GRANTS abajo). Nada destructivo, nada que perder datos.
--
-- ── Calca del patrón que ads ya usa ─────────────────────────────────────────
-- ads.rejection_reason + moderate_ad_atomic + espejo 'ad_rejected' resuelven
-- exactamente este problema para anuncios (20260826000001/20260827000001).
-- Aquí se reusa la MISMA forma —columna text en la entidad, poblada por la
-- puerta, leída por el escritor del espejo, `data.rejection_reason` en el
-- payload— con dos desviaciones deliberadas, ambas por producción viva:
--
--   (1) 🔴 SIN el CHECK bidireccional de ads
--       (`(status='rejected') = (rejection_reason is not null)`). En el remoto
--       ya existen agencias 'rejected' históricas —rechazadas por Studio antes
--       de que #221.2 abriera la puerta— que NO tienen motivo, y un CHECK así
--       no valida contra esas filas: la migración fallaría al aplicarse, o
--       exigiría un backfill inventando texto. El invariante lo sostiene la
--       PUERTA (resolve_agency_registration exige `p_reason ~ '\S'` al
--       rechazar), no una constraint. TECHO CONOCIDO: un UPDATE directo por
--       Studio puede dejar una agencia 'rejected' sin motivo (se comporta como
--       hoy, sin romper nada) o un motivo colgando en una agencia que después
--       se aprueba (imposible por la puerta: aprobar escribe null en el mismo
--       UPDATE). Si algún día se limpian las filas históricas, el CHECK de ads
--       es el destino natural.
--   (2) 🔴 El motivo va en el `body` del espejo, no solo en `data`. El lector
--       vivo (mobile/src/features/notifications/components/NotificationCard.tsx)
--       renderiza EXCLUSIVAMENTE `title` y `body`; `data` no lo lee ninguna
--       superficie. ad_rejected y property_revision_rejected meten el motivo
--       solo en `data.rejection_reason`, así que ahí TAMPOCO llega a la persona
--       (hallazgo reportado como derivada, no se toca aquí). Este espejo
--       escribe en AMBOS: `body` para que se LEA hoy sin necesidad de OTA, y
--       `data.rejection_reason` para conservar la forma exacta del catálogo
--       #219 (un lector futuro —pantalla de detalle, push— lo encuentra donde
--       ya lo busca).
--
-- ── 🔒 GRANTS: cero líneas, y no es un olvido ───────────────────────────────
-- En agencies el SELECT es de TABLA (relacl `anon=rDxtm`,
-- `authenticated=ardDxtm`, `service_role=arwdDxtm`) y solo el UPDATE de
-- `authenticated` es de COLUMNA (attacl sobre las 7 escribibles: name, slug,
-- logo_url, contact_{name,phone,email}, deleted_at — 0008). Un grant de tabla
-- se extiende SOLO a las columnas futuras, así que:
--   · `select('*')` de los builds YA INSTALADOS no truena con «permission
--     denied for column rejection_reason» (§0.5) — sin tocar nada;
--   · la columna nace FUERA de la whitelist de UPDATE, así que un agente o un
--     owner NO puede reescribir el motivo por el que lo rechazaron (mismo
--     patrón anti-escalación que users.role).
-- Ese doble efecto es afortunado, no obvio: se ANCLA en los asserts RR26/RR27
-- de la suite 85 para que un `grant update` descuidado rompa un test en vez de
-- la app.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1) La columna. Aditiva, nullable, sin default.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.agencies
  add column if not exists rejection_reason text;

comment on column public.agencies.rejection_reason is
  'Motivo por el que un admin de plataforma rechazó el REGISTRO de esta '
  'inmobiliaria (#234). Lo escribe public.resolve_agency_registration en el '
  'mismo UPDATE que mueve el status, y el trigger handle_agency_status_change '
  'lo copia al body y al data del espejo ''agency_rejected'' que recibe el '
  'solicitante. Se limpia (null) al aprobar. 🔴 SIN el CHECK bidireccional '
  'status<->reason que sí tiene ads.rejection_reason: en el remoto ya hay '
  'agencias ''rejected'' históricas sin motivo (rechazadas por Studio antes de '
  '#221.2) y ese CHECK no validaría contra ellas. El invariante lo sostiene la '
  'PUERTA, no una constraint — un UPDATE directo por Studio puede dejar una '
  'agencia rechazada sin motivo (se comporta como antes de #234). Legible por '
  'el solicitante, quien administra la agencia y el admin: la policy '
  'agencies_select ya deja las filas ''rejected'' fuera del público. NO '
  'escribible por authenticated (fuera de la whitelist de UPDATE de 0008).';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) public.resolve_agency_registration — VERBATIM 20260902100003 (la
--    definición vigente, verificada con pg_get_functiondef contra el stack
--    local — gotcha #168 "nunca del cuerpo viejo") con UN solo delta: el
--    UPDATE ahora escribe también `rejection_reason`.
--    FIRMA, grants, guards y códigos de error P0001 IDÉNTICOS: los builds
--    instalados que ya llaman esta RPC no notan nada.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.resolve_agency_registration(
  p_agency_id uuid,
  p_approve   boolean,
  p_reason    text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
  v_status   public.agency_status;
begin
  -- Primero QUIÉN: JWT de admin real o GUC urbea.admin_actor_id (71.5/D4).
  -- Antes de leer la fila: un no-admin no descubre ni si la agencia existe.
  v_admin_id := private.resolve_admin_actor();

  -- El trigger vuelve a resolver el actor dentro del UPDATE; el GUC local
  -- garantiza el MISMO admin incluso si el caller es service_role (auth.uid()
  -- NULL) — mismo mecanismo que set_agency_status_atomic (20260823000003).
  perform set_config('urbea.admin_actor_id', v_admin_id::text, true);

  -- deleted_at compuesto en el MISMO código que "no existe": para la cola, una
  -- organización borrada no está ahí (criterio de set_org_advertising_atomic).
  select status into v_status
    from public.agencies
   where id = p_agency_id
     and deleted_at is null
   for update;

  if not found then
    raise exception 'AGENCY_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Verbo UNIFORME con los otros dos carriles de la cola. Cubre active,
  -- rejected y suspended: cualquiera de los tres significa "esto ya no es un
  -- registro pendiente". El trigger diría INVALID_STATUS_TRANSITION.
  if v_status <> 'pending_approval' then
    raise exception 'ALREADY_RESOLVED' using errcode = 'P0001';
  end if;

  -- Motivo con contenido real: `~ '\S'`, NUNCA trim() (trim() solo recorta el
  -- espacio ASCII y deja pasar tabuladores/saltos de línea — hallazgo 220.1).
  if not p_approve and (p_reason is null or p_reason !~ '\S') then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  -- EL update. Todo el efecto de negocio lo aplica el trigger, en esta misma
  -- transacción (si algo de eso revienta —p.ej. MEMBER_OF_OTHER_AGENCY—, este
  -- update y la fila de auditoría de abajo se revierten con él).
  --
  -- #234: `rejection_reason` viaja en el MISMO UPDATE que el status, no en un
  -- statement aparte, por dos razones:
  --   · el trigger es BEFORE UPDATE, así que lee el motivo en `new` y lo puede
  --     meter en el espejo sin una segunda pasada ni una tabla intermedia;
  --   · aprobar escribe `null` en la misma expresión (cero statements extra):
  --     la columna refleja la decisión VIGENTE y nunca queda un motivo
  --     colgando en una agencia activa. Hoy 'rejected' es terminal para el
  --     trigger, así que aprobar-después-de-rechazar no es un camino
  --     alcanzable; el `null` es el valor correcto del caso normal
  --     (pending_approval -> active), no una defensa especulativa.
  update public.agencies
     set status           = case when p_approve then 'active' else 'rejected' end::public.agency_status,
         rejection_reason = case when p_approve then null else p_reason end
   where id = p_agency_id;

  -- D-REASON: la fila de auditoría SE MANTIENE aunque la columna ya exista.
  -- No es duplicación: admin_actions es la historia append-only de QUIÉN
  -- rechazó y por qué (D9 de 71.5) y sobrevive a que la columna cambie;
  -- agencies.rejection_reason es el estado VIGENTE que lee el solicitante.
  -- Anclado por REJ3 de la suite 84 y RR10 de la 85.
  if not p_approve then
    insert into public.admin_actions (
      admin_id, action_type, entity_type, entity_id, old_values, new_values, reason
    )
    values (
      v_admin_id, 'reject_agency_registration', 'agency', p_agency_id,
      jsonb_build_object('status', v_status::text),
      jsonb_build_object('status', 'rejected'),
      p_reason
    );
  end if;
end;
$$;

comment on function public.resolve_agency_registration(uuid, boolean, text) is
  'Puerta ÚNICA para que el admin de plataforma resuelva un REGISTRO de '
  'inmobiliaria (pending_approval -> active|rejected) desde el panel (#221.2). '
  'Cierra el hueco de 71.5/D3: agencies.status está fuera del grant de columna '
  'a authenticated y la EF suspend-agency solo expone suspend|reactivate. '
  'WRAPPER DELGADO: valida al actor (private.resolve_admin_actor), 3 guards de '
  'puerta y UN update — la membresía owner, la promoción de role, '
  'approved_by_admin_id, la auditoría del cambio de estado y el espejo a '
  'notifications los aplica ENTERO el trigger handle_agency_status_change. '
  'Errores P0001: STATUS_CHANGE_REQUIRES_ADMIN, AGENCY_NOT_FOUND (inexistente '
  'o soft-deleted), ALREADY_RESOLVED, REASON_REQUIRED. #234: el mismo UPDATE '
  'escribe agencies.rejection_reason (null al aprobar) y el trigger lleva ese '
  'motivo al body y al data del espejo ''agency_rejected'' — el solicitante ya '
  'lee POR QUÉ lo rechazaron. La fila extra de admin_actions '
  '(reject_agency_registration) se mantiene: es la historia append-only, la '
  'columna es el estado vigente.';

revoke execute on function public.resolve_agency_registration(uuid, boolean, text) from public, anon;
grant execute on function public.resolve_agency_registration(uuid, boolean, text)
  to authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) public.handle_agency_status_change — VERBATIM la definición VIGENTE
--    (20260826000001; 20260827000001 corrigió moderate_property_atomic y
--    moderate_ad_atomic pero NO tocó esta función — verificado con
--    pg_get_functiondef contra el stack local, gotcha #168) con UN solo delta:
--    la rama de RECHAZO lee `new.rejection_reason` y lo lleva al espejo.
--    Ninguna otra rama cambia: aprobación, suspensión y reactivación quedan
--    byte por byte como estaban, y el disparador `agencies_status_change` NO
--    se recrea (sigue siendo BEFORE UPDATE ... WHEN old.status IS DISTINCT
--    FROM new.status).
--
--    🔴 Por qué funciona sin una segunda pasada: la función corre BEFORE
--    UPDATE y la puerta escribe status y rejection_reason en el MISMO
--    statement, así que el motivo ya está en `new` cuando se arma el espejo.
--    Un rechazo hecho por SQL directo que NO escriba la columna (el camino
--    Studio de siempre) deja `new.rejection_reason` en null y produce
--    EXACTAMENTE el body de antes de #234 — compatibilidad hacia atrás sin
--    ramas especiales.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.handle_agency_status_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_admin_id uuid;
  -- #234: motivo del rechazo NORMALIZADO una sola vez y reusado por el body y
  -- por el data (una expresión, dos consumidores — no se repite el guard).
  v_reason text;
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

    -- #219.2: espejo de resolución al solicitante. Nunca el admin actor.
    if old.created_by_user_id is distinct from v_admin_id then
      insert into public.notifications (
        user_id, type, title, body, deep_link,
        related_entity_type, related_entity_id, data
      )
      values (
        old.created_by_user_id, 'agency_approved',
        'Tu inmobiliaria fue aprobada',
        'Tu inmobiliaria "' || new.name::text || '" fue aprobada.',
        '/profile', 'agency', new.id,
        jsonb_build_object('agency_name', new.name::text)
      );
    end if;
  elsif old.status = 'pending_approval' and new.status = 'rejected' then
    insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values)
    values (
      v_admin_id, 'reject_agency', 'agency', new.id,
      jsonb_build_object('status', old.status::text),
      jsonb_build_object('status', new.status::text)
    );

    -- #234: el motivo del rechazo (agencies.rejection_reason, que escribe la
    -- puerta resolve_agency_registration en este mismo UPDATE) VIAJA al
    -- solicitante. Antes solo vivía en admin_actions, que la persona no puede
    -- leer, y el espejo llegaba sin el porqué (limitación anclada por REJ5 de
    -- la suite 84, ahora invertido).
    --
    -- `~ '\S'` y NUNCA trim(): trim() solo recorta el espacio ASCII y deja
    -- pasar tabuladores y saltos de línea (hallazgo 220.1). La puerta ya exige
    -- lo mismo, pero un UPDATE directo por Studio es otra frontera de
    -- confianza y un motivo en blanco produciría un body con «Motivo: » vacío.
    -- El null resultante recorre el mismo camino que "sin motivo".
    v_reason := case when new.rejection_reason ~ '\S' then new.rejection_reason end;

    -- #219.2: espejo de resolución al solicitante. Nunca el admin actor.
    if old.created_by_user_id is distinct from v_admin_id then
      insert into public.notifications (
        user_id, type, title, body, deep_link,
        related_entity_type, related_entity_id, data
      )
      values (
        old.created_by_user_id, 'agency_rejected',
        'Tu inmobiliaria fue rechazada',
        -- El motivo va en el BODY porque es lo ÚNICO que NotificationCard
        -- renderiza; sin motivo, el texto queda byte por byte como antes.
        'Tu inmobiliaria "' || new.name::text || '" fue rechazada.'
          || coalesce(' Motivo: ' || v_reason, ''),
        '/profile', 'agency', new.id,
        -- Y también en data.rejection_reason: forma EXACTA de ad_rejected
        -- (#219.2), para el lector estructurado que venga después.
        jsonb_build_object('agency_name', new.name::text)
          || case when v_reason is not null
               then jsonb_build_object('rejection_reason', v_reason)
               else '{}'::jsonb
             end
      );
    end if;
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
$function$;

comment on function public.handle_agency_status_change() is
  'Corre BEFORE UPDATE en agencies (WHEN old.status IS DISTINCT FROM '
  'new.status): valida el grafo de estados, y según la transición aplica la '
  'membresía owner + promoción de role + approved_by_admin_id (aprobación, '
  '71.5), la cascada de pausa/reactivación de anuncios (#169.2/#210.1), la '
  'auditoría en admin_actions y el espejo a notifications hacia el '
  'SOLICITANTE (#219.2) — nunca al admin actor, y solo en '
  'pending_approval->active|rejected (active<->suspended NO es una '
  'resolución, no espeja). #234: la rama de rechazo lleva '
  'agencies.rejection_reason al `body` del espejo (lo único que el centro de '
  'notificaciones renderiza) y a `data.rejection_reason` (forma de '
  'ad_rejected); un motivo nulo o en blanco (`~ ''\S''`, nunca trim) produce '
  'EXACTAMENTE el body de antes de #234 — el camino Studio no se rompe.';
