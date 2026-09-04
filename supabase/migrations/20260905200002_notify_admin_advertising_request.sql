-- ════════════════════════════════════════════════════════════════════════════
-- #246 — La solicitud de CUENTA COMERCIAL avisa a los admins de plataforma.
-- Origen: subtarea 221.1 · Detectado por: usuario (smoke en producción #222,
-- bitácora paso 2, 2026-09-03).
--
-- ── EL HUECO, VERIFICADO EN PRODUCCIÓN ──────────────────────────────────────
-- El owner mandó «Quiero anunciar» (create_advertising_request creó la
-- solicitud 2c901010) y NINGÚN admin se enteró: las únicas notificaciones
-- nuevas fueron para el propio owner. El catálogo de escritores admin de
-- #219.1 (20260825000001, corregido por 20260827000002 y 20260902100004)
-- cubre admin_ad_pending, admin_agency_pending, admin_agent_application y
-- admin_revision_pending — public.advertising_requests nació en #221.1 SIN
-- escritor, así que su cola era invisible hasta que un admin entrara a
-- /admin/requests por su cuenta.
--
-- ── QUÉ AÑADE (5º evento del catálogo, patrón calcado de #219.1) ────────────
-- ADITIVA PURA: 1 índice único parcial nuevo + 1 función nueva + 1 trigger
-- nuevo. Ninguna tabla, columna, policy, grant o función existente se toca.
-- public.notifications.type es TEXT a propósito ("catálogo crece -> text, no
-- enum", 20260604000007:59) — un `type` nuevo NO necesita ALTER TYPE.
--
--   admin_advertising_request_pending
--     · deep_link '/admin/requests' — la cola unificada EXISTE desde #221
--       (20260902100004), así que este type nace apuntando a la ruta real y
--       nunca necesita el interino '/admin' que sí necesitaron
--       admin_agency_pending y admin_agent_application (#223.2b).
--     · related_entity_type 'advertising_request' · related_entity_id = la
--       solicitud · data->>'agency_name' (snake_case, sin colisionar con
--       title/body de la fila, que son del AVISO).
--     · destinatarios: TODOS los public.users.role='admin' VIVOS
--       (`deleted_at is null`, #223.2a — semántico y de performance: sin ese
--       predicado el índice PARCIAL users_role_idx no se puede usar y la
--       consulta cae en seq scan DENTRO de la transacción del evento).
--
-- ── Idempotencia: índice único parcial + ON CONFLICT DO NOTHING ─────────────
-- Como admin_ad_pending / admin_agency_pending / admin_agent_application, y a
-- diferencia de admin_revision_pending: una solicitud solo NACE una vez, y
-- advertising_requests_one_pending_per_agency (20260902100001) ya impide una
-- segunda fila abierta por agencia. Índice propio por `type`, no una lista
-- `IN`: el `on conflict … where` debe machear EXACTAMENTE el predicado del
-- índice arbiter (mismo criterio literal que 20260822000001/20260825000001).
--
-- ── 🔒 Semántica BLOQUEANTE (DECISIÓN ABRAHAM 2026-08-25, #219.1) ───────────
-- El INSERT vive en la MISMA transacción del evento, SIN bloque EXCEPTION: si
-- el escritor truena, la solicitud tampoco se crea. El ON CONFLICT DO NOTHING
-- no es una excepción capturada — es un camino sin error.
--
-- ── Purga ───────────────────────────────────────────────────────────────────
-- public.purge_notifications() (30 días por created_at, 20260825000001) ya
-- cubre este type: es global por tabla, no por catálogo. Nada nuevo que
-- programar — ningún job de pg_cron se toca.
--
-- ── 🔴 PRODUCCIÓN VIVA (§0.5) ───────────────────────────────────────────────
--   · Aditivo puro: solo crea objetos nuevos. Nada destructivo, ningún
--     contrato publicado modificado. Los builds instalados siguen leyendo
--     notifications igual — un `type` que no conocen se pinta con title/body,
--     que es lo único que NotificationCard renderiza (#237).
--   · Orden de deploy: la MIGRACIÓN PUEDE IR PRIMERA. El aviso aparece en la
--     campana del admin sin ningún cambio de cliente; el OTA que suma la 6ª
--     cola al globo del home es independiente y puede ir después.
--   · Idempotente: create unique index if not exists · create or replace
--     function · drop trigger if exists + create trigger.
--   · Rollback: supabase/migrations/rollbacks/20260905200002_notify_admin_advertising_request.sql
--
-- Tests: supabase/tests/95_notify_admin_advertising_request_test.sql (14
-- asserts) + la suite 79 (advertising_requests, 73 asserts) y la 71 (catálogo
-- admin, 91) como contratos base intactos.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Ancla de idempotencia. Parcial SOLO por `type`, nunca por deleted_at: un
--    aviso BORRADO por el admin sigue ocupando la llave (mismo criterio que
--    notifications_admin_ad_pending_anchor_idx).
-- ════════════════════════════════════════════════════════════════════════════

create unique index if not exists notifications_admin_advertising_request_anchor_idx
  on public.notifications (user_id, related_entity_id, type)
  where type = 'admin_advertising_request_pending';

comment on index public.notifications_admin_advertising_request_anchor_idx is
  'Ancla de idempotencia de admin_advertising_request_pending (#246). Parcial '
  'SOLO por type -- un aviso BORRADO por el admin sigue ocupando la llave '
  '(mismo criterio que notifications_admin_ad_pending_anchor_idx, #219.1).';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) El escritor — AFTER INSERT en advertising_requests, solo `pending`.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.notify_admin_advertising_request_pending()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency_name text;
begin
  select a.name::text into v_agency_name
  from public.agencies a
  where a.id = new.agency_id;

  insert into public.notifications (
    user_id, type, title, body, deep_link,
    related_entity_type, related_entity_id, data
  )
  select
    u.id,
    'admin_advertising_request_pending',
    'Nueva solicitud de cuenta comercial',
    'La inmobiliaria "' || v_agency_name || '" solicitó una cuenta comercial.',
    '/admin/requests',
    'advertising_request',
    new.id,
    jsonb_build_object('agency_name', v_agency_name)
  from public.users u
  where u.role = 'admin'
    and u.deleted_at is null
  on conflict (user_id, related_entity_id, type)
    where type = 'admin_advertising_request_pending'
    do nothing;

  return new;
end;
$$;

comment on function public.notify_admin_advertising_request_pending() is
  'AFTER INSERT en advertising_requests (#246): avisa a los admin de '
  'plataforma VIVOS (deleted_at is null) cuando una solicitud de cuenta '
  'comercial nace en pending -- el canal «Quiero anunciar» de #221.1, que '
  'hasta ahora no avisaba a nadie. WHEN clause: un INSERT directo con status '
  'distinto (p.ej. approved, camino de Studio/service_role) NO dispara, y '
  'resolverla tampoco (es AFTER INSERT, no AFTER UPDATE). deep_link '
  '''/admin/requests'' -- la cola unificada ya existe desde #221.';

drop trigger if exists advertising_requests_notify_admin_pending on public.advertising_requests;
create trigger advertising_requests_notify_admin_pending
  after insert on public.advertising_requests
  for each row
  when (new.status = 'pending')
  execute function public.notify_admin_advertising_request_pending();
