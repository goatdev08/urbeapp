-- Migración 20260902100001 — GREEN del canal «Quiero anunciar» (subtarea
-- #221.1, tarea 221 "cola de solicitudes", exploración 041-M4). Cierra el
-- hueco de 039:133: la solicitud de cuenta comercial se prometió y nunca se
-- construyó — #209 solo hizo el lado del admin (la EF set-org-advertising y
-- su RPC), sin ninguna forma de que el owner la PIDIERA.
-- ADITIVA PURA (§0.5 producción viva): 1 tabla nueva, 2 funciones nuevas, 1
-- índice nuevo, 1 policy nueva. NINGÚN contrato publicado se toca — en
-- particular NO se modifican public.set_org_advertising_atomic (se REUSA tal
-- cual) ni public.notifications (solo se le insertan filas con 2 `type`
-- nuevos: la columna es TEXT a propósito, "catálogo crece -> text, no enum",
-- 20260604000007:59).
--
-- ÚNICA migración que crea estos objetos: el STUB que usó el RED (misma fecha,
-- mismo nombre de archivo con sufijo `_stub`) se eliminó del árbol antes de
-- integrar — era andamio de test, no un artefacto que deba viajar a
-- producción — así que este archivo los crea COMPLETOS desde cero (mismo
-- criterio de consolidación que 220.3/20260828000004 y 220.6/20260828000005).
--
-- Contrato completo (SEAM, decisiones D-JWT/D-CAT/D-ONE/D-CREATE/D-READ/
-- D-ADMIN/D-REUSE/D-AUDIT/D-REASON/D-STATE/D-NOTIF/D-ATOM y los 73 asserts):
-- ver cabecera de supabase/tests/79_advertising_requests_test.sql — esas
-- decisiones ya estaban FIJADAS por el RED; este archivo solo las implementa.
-- Rollback: supabase/migrations/rollbacks/20260902100001_advertising_requests.sql
--
-- ── Resumen del flujo ───────────────────────────────────────────────────────
--   owner  --create_advertising_request(categoría)-->  fila 'pending'
--   admin  --resolve_advertising_request(id, true)-->  set_org_advertising_atomic
--                                                      (can_advertise + categoría
--                                                       + auditoría de agencia)
--                                                    + fila 'approved'
--                                                    + auditoría de la resolución
--                                                    + aviso al solicitante
--   admin  --resolve_advertising_request(id,false,motivo)--> fila 'rejected'
--                                                    + auditoría con motivo
--                                                    + aviso al solicitante

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Tabla
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.advertising_requests (
  id                   uuid primary key default gen_random_uuid(),
  agency_id            uuid not null references public.agencies (id) on delete cascade,
  requested_by_user_id uuid not null references public.users (id) on delete cascade,
  -- D-CAT: el ENUM del dominio (20260815000001), no text libre — es
  -- EXACTAMENTE el valor que set_org_advertising_atomic escribirá en
  -- agencies.advertiser_category al aprobar. Una categoría inválida rebota al
  -- CREARSE (INVALID_CATEGORY), nunca al aprobarse.
  proposed_category    public.advertiser_category not null,
  status               text not null default 'pending'
    constraint advertising_requests_status_check
      check (status in ('pending', 'approved', 'rejected')),
  rejection_reason     text,
  created_at           timestamptz not null default now(),
  resolved_at          timestamptz,
  -- set null y no cascade: si el admin se va, la solicitud conserva su
  -- historia (mismo criterio que agent_applications.reviewed_by_admin_id).
  resolved_by_user_id  uuid references public.users (id) on delete set null
);

-- Idempotencia del CHECK para una base donde la tabla YA existía sin él (el
-- STUB del RED en local): `create table if not exists` no aplica constraints a
-- una tabla preexistente. Mismo patrón que 20260816000003.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'advertising_requests_status_check'
  ) then
    alter table public.advertising_requests
      add constraint advertising_requests_status_check
      check (status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

comment on table public.advertising_requests is
  'Solicitudes de CUENTA COMERCIAL del owner de una organización (canal '
  '«Quiero anunciar», PRD §22/exploración 041-M4). Se crean SOLO vía '
  'public.create_advertising_request (sin grant ni policy de INSERT) y las '
  'resuelve el admin de plataforma con public.resolve_advertising_request. '
  'Aprobar delega el encendido en set_org_advertising_atomic — misma '
  'semántica que la EF set-org-advertising.';

-- D-ONE: UNA solicitud abierta por agencia. Parcial por status: un estado
-- final libera la llave, así que tras un RECHAZO la agencia puede volver a
-- solicitar (mismo patrón que agent_app_one_pending_per_user, 20260604000003).
create unique index if not exists advertising_requests_one_pending_per_agency
  on public.advertising_requests (agency_id) where status = 'pending';

-- ponytail: SIN índice de cola (status, created_at). La cola del admin es
-- `where status='pending' order by created_at` sobre una tabla que crece a
-- ritmo de "una fila por organización que quiere anunciar" — un seq scan de
-- decenas de filas no es un problema. Techo conocido: si la tabla pasa de
-- unos miles de filas, agregar advertising_requests_queue_idx.

alter table public.advertising_requests enable row level security;

-- Grant mecánico: las tablas nuevas en public NO heredan el GRANT blanket de
-- 0008 (solo cubrió las que existían entonces — patrón documentado en
-- 20260809000004_property_video_slots.sql). Sin GRANT, hasta un SELECT
-- impersonado revienta con "permission denied for table" (nivel de
-- PRIVILEGIO, no de RLS).
-- D-CREATE: SOLO select. Sin insert/update/delete a propósito — la creación
-- es exclusiva de la RPC (mismo criterio que public.ads, 20260816000005) y la
-- resolución es exclusiva del admin vía RPC; un INSERT directo del owner
-- saltaría NOT_OWNER/ALREADY_ADVERTISER/ALREADY_PENDING y un UPDATE directo
-- saltaría toda la máquina de estados + la auditoría.
revoke all on public.advertising_requests from anon, authenticated;
grant select on public.advertising_requests to authenticated;

-- D-READ: el owner ve las de SU agencia; el admin de plataforma ve TODAS
-- (a diferencia de los leads de #226, esta SÍ es su cola de trabajo).
-- private.agency_role_of ya existe (20260805000003) — reuso, no helper nuevo;
-- resuelve el rol ACTIVO del (select auth.uid()) en esa agencia, así que una
-- membresía suspendida o un miembro 'agent'/'admin' de la organización NO ve
-- la solicitud (es una decisión comercial del owner).
drop policy if exists advertising_requests_select on public.advertising_requests;
create policy advertising_requests_select on public.advertising_requests for select to authenticated
  using (private.is_admin() or private.agency_role_of(agency_id) = 'owner');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) create_advertising_request — la agencia sale del JWT (D-JWT)
-- ════════════════════════════════════════════════════════════════════════════
-- 🔒 LA AGENCIA NO ES UN PARÁMETRO: se resuelve de la membresía ACTIVA `owner`
-- del caller. Mismo criterio que create_ad_campaign_atomic (20260820000005):
-- "no se blinda un dato que el cliente controla, se deja de aceptar".
-- 🔒 SECURITY DEFINER con search_path fijo (un definer sin search_path fijo es
-- escalada de privilegios) — es el único camino de INSERT a la tabla.

create or replace function public.create_advertising_request(p_proposed_category text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_id  uuid;
  v_agency_id  uuid;
  v_category   public.advertiser_category;
  v_request_id uuid;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null then
    raise exception 'NOT_OWNER' using errcode = 'P0001';
  end if;

  -- Owner ACTIVO de una agencia VIVA. Las 4 causas (sin membresía, miembro no
  -- owner, membresía suspendida, agencia soft-deleted) comparten código a
  -- propósito: no se revela cuál falló.
  select m.agency_id into v_agency_id
    from public.agency_members m
    join public.agencies a on a.id = m.agency_id and a.deleted_at is null
   where m.user_id     = v_caller_id
     and m.status      = 'active'
     and m.member_role = 'owner'
   limit 1;

  if v_agency_id is null then
    raise exception 'NOT_OWNER' using errcode = 'P0001';
  end if;

  -- D-CAT: validación de frontera. El parámetro es text (contrato con el
  -- cliente) pero la columna es el enum del dominio: se traduce aquí y un
  -- valor fuera del catálogo sale como P0001 accionable, nunca como un 22P02
  -- crudo del cast.
  begin
    v_category := p_proposed_category::public.advertiser_category;
  exception
    when invalid_text_representation then
      v_category := null;
  end;

  if v_category is null then
    raise exception 'INVALID_CATEGORY' using errcode = 'P0001';
  end if;

  if (select a.can_advertise from public.agencies a where a.id = v_agency_id) then
    raise exception 'ALREADY_ADVERTISER' using errcode = 'P0001';
  end if;

  insert into public.advertising_requests (agency_id, requested_by_user_id, proposed_category)
  values (v_agency_id, v_caller_id, v_category)
  returning id into v_request_id;

  return v_request_id;
exception
  -- D-ONE: el índice único parcial es la ÚNICA autoridad de "una pending por
  -- agencia" — no se duplica con un `if exists` previo (que además tendría
  -- una carrera entre el check y el insert). Solo el INSERT de arriba puede
  -- levantar unique_violation en este cuerpo.
  when unique_violation then
    raise exception 'ALREADY_PENDING' using errcode = 'P0001';
end;
$$;

comment on function public.create_advertising_request(text) is
  'Alta SELF-SERVICE de una solicitud de cuenta comercial por el OWNER de su '
  'propia organización (#221.1). La agencia se resuelve del JWT, NUNCA es un '
  'parámetro. Errores P0001: NOT_OWNER (sin membresía / no owner / membresía '
  'suspendida / agencia borrada — un solo código para las 4), '
  'INVALID_CATEGORY (fuera de public.advertiser_category o NULL), '
  'ALREADY_ADVERTISER (la agencia ya tiene can_advertise), ALREADY_PENDING '
  '(ya hay una solicitud abierta). Es el ÚNICO camino de INSERT a '
  'public.advertising_requests.';

revoke execute on function public.create_advertising_request(text) from public, anon;
grant execute on function public.create_advertising_request(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) resolve_advertising_request — resolución ATÓMICA del admin
-- ════════════════════════════════════════════════════════════════════════════
-- D-ATOM: una sola transacción, SIN bloques EXCEPTION que traguen errores
-- (semántica BLOQUEANTE de Abraham 2026-08-25, #219.1): si cualquier paso
-- revienta, la solicitud sigue 'pending' y no queda auditoría ni aviso.

create or replace function public.resolve_advertising_request(
  p_request_id uuid,
  p_approve    boolean,
  p_reason     text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id     uuid;
  v_req          public.advertising_requests;
  v_agency_name  text;
  v_new_status   text;
begin
  -- D-ADMIN: primero QUIÉN. private.resolve_admin_actor() (71.5/D4) acepta el
  -- JWT de un admin real o el GUC urbea.admin_actor_id (Studio/service_role) y
  -- lanza P0001 STATUS_CHANGE_REQUIRES_ADMIN si no hay ninguno. Va ANTES de
  -- leer la solicitud para no revelar su existencia a un no-admin.
  v_admin_id := private.resolve_admin_actor();

  -- for update: toma el lock de fila antes de mutar (dos admins resolviendo la
  -- misma solicitud a la vez -> el segundo ve 'approved'/'rejected' y rebota).
  select * into v_req from public.advertising_requests where id = p_request_id for update;
  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- D-STATE: pending -> approved | rejected, y nada más. Nunca un no-op
  -- silencioso: el admin necesita saber que otro ya la tomó.
  if v_req.status <> 'pending' then
    raise exception 'ALREADY_RESOLVED' using errcode = 'P0001';
  end if;

  -- D-REASON: motivo con contenido real. `~ '\S'` y NUNCA trim(): trim() en
  -- Postgres solo recorta el espacio ASCII y deja pasar tabuladores/saltos de
  -- línea (hallazgo 220.1).
  if not p_approve and (p_reason is null or p_reason !~ '\S') then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_new_status := case when p_approve then 'approved' else 'rejected' end;

  if p_approve then
    -- D-REUSE: el encendido NO se reescribe aquí. Se delega en el overload de
    -- 4 argumentos de set_org_advertising_atomic (20260823000001), que instala
    -- el admin en el GUC y llama a la RPC de 3 argumentos ya probada:
    -- valida agencia viva (AGENCY_NOT_FOUND), exige categoría
    -- (ADVERTISER_CATEGORY_REQUIRED), hace el UPDATE de can_advertise +
    -- advertiser_category y audita 'enable_org_advertising' sobre la entidad
    -- `agency` — todo en ESTA misma transacción. Es EXACTAMENTE lo que hace la
    -- EF set-org-advertising, por el mismo camino.
    perform public.set_org_advertising_atomic(
      v_req.agency_id, true, v_req.proposed_category, v_admin_id
    );
  end if;

  update public.advertising_requests
     set status              = v_new_status,
         rejection_reason    = case when p_approve then rejection_reason else p_reason end,
         resolved_at         = now(),
         resolved_by_user_id = v_admin_id
   where id = p_request_id;

  -- D-AUDIT: la RESOLUCIÓN audita su propia entidad. En la rama aprobar esto
  -- convive con el 'enable_org_advertising' que escribió la RPC reusada: son
  -- entidades DISTINTAS (la capacidad de la agencia vs. la resolución de esta
  -- solicitud), no una fila duplicada.
  insert into public.admin_actions (
    admin_id, action_type, entity_type, entity_id, old_values, new_values, reason
  )
  values (
    v_admin_id,
    case when p_approve then 'approve_advertising_request' else 'reject_advertising_request' end,
    'advertising_request',
    p_request_id,
    jsonb_build_object('status', v_req.status),
    jsonb_build_object('status', v_new_status,
                       'advertiser_category', v_req.proposed_category::text),
    case when p_approve then null else p_reason end
  );

  -- D-NOTIF: espejo al SOLICITANTE, nunca al admin actor (guard SELF, mismo
  -- criterio que los 4 espejos de #219.2). Sin índice de idempotencia: el
  -- guard ALREADY_RESOLVED garantiza que una solicitud se resuelve UNA vez.
  if v_req.requested_by_user_id is distinct from v_admin_id then
    select a.name::text into v_agency_name from public.agencies a where a.id = v_req.agency_id;

    insert into public.notifications (
      user_id, type, title, body, deep_link, related_entity_type, related_entity_id, data
    )
    values (
      v_req.requested_by_user_id,
      case when p_approve then 'advertising_request_approved'
           else 'advertising_request_rejected' end,
      case when p_approve then 'Tu cuenta comercial fue aprobada'
           else 'Tu solicitud de cuenta comercial fue rechazada' end,
      case when p_approve
           then 'Ya puedes publicar anuncios con ' || coalesce(v_agency_name, 'tu organización') || '.'
           else 'Motivo: ' || p_reason end,
      '/ads',  -- ruta viva: mobile/app/(protected)/ads/index.tsx
      'advertising_request',
      p_request_id,
      jsonb_build_object('agency_name', v_agency_name,
                         'advertiser_category', v_req.proposed_category::text)
        || case when p_approve then '{}'::jsonb
                else jsonb_build_object('rejection_reason', p_reason) end
    );
  end if;
end;
$$;

comment on function public.resolve_advertising_request(uuid, boolean, text) is
  'Resolución ATÓMICA de una solicitud de cuenta comercial por el admin de '
  'plataforma (#221.1): aprobar = set_org_advertising_atomic (can_advertise + '
  'categoría propuesta + auditoría de la agencia, RPC REUSADA) + '
  'status/resolved_* + auditoría de la resolución + aviso al solicitante; '
  'rechazar = motivo obligatorio + status/resolved_* + auditoría + aviso. '
  'Todo en UNA transacción, sin bloques EXCEPTION. Errores P0001: '
  'STATUS_CHANGE_REQUIRES_ADMIN (private.resolve_admin_actor), '
  'REQUEST_NOT_FOUND, ALREADY_RESOLVED, REASON_REQUIRED, más los de la RPC '
  'reusada (AGENCY_NOT_FOUND).';

revoke execute on function public.resolve_advertising_request(uuid, boolean, text) from public, anon;
grant execute on function public.resolve_advertising_request(uuid, boolean, text)
  to authenticated, service_role;
