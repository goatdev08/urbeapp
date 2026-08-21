-- Migración 20260822000001 — public.notify_ads_expiring_soon() (subtarea
-- #171.4, exploración 039 "Tarea D", panel del anunciante). Aditiva pura:
-- función nueva + índice único nuevo + job de pg_cron nuevo. Ninguna tabla
-- creada (public.notifications YA existe, 20260604000007), ningún contrato
-- publicado tocado (§0.5 producción viva).
-- Contrato completo (firma, edge cases, invariantes 🔒, las decisiones D-KEY
-- / D-BORDE del test-author): ver cabecera de
-- supabase/tests/63_notify_ads_expiring_soon_test.sql (RED, 2026-08-21).
-- Rollback: supabase/migrations/rollbacks/20260822000001_notify_ads_expiring_soon.sql
--
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ: un job diario que avisa a los miembros ACTIVOS con rol owner/admin de
-- la organización dueña de un anuncio cuando ese anuncio está por expirar
-- (ends_at dentro de los próximos 7 días). Nunca a agent/viewer/suspended, y
-- nunca vía ads.created_by_user_id (esa columna no existe -- la organización
-- es la dueña, no una persona). Inserta una fila en public.notifications por
-- destinatario, patrón EXACTO de public.purge_ad_impressions
-- (20260817000002): security definer, set search_path = '' (cuerpo entero
-- calificado por schema), revoke execute from public/anon/authenticated +
-- grant a service_role, programada vía pg_cron REUSADO (la extensión ya la
-- instaló 170.5 -- `create extension if not exists` de abajo es el no-op de
-- reutilización, NO un segundo mecanismo).
--
-- ── Por qué SOLO status='active' ─────────────────────────────────────────────
-- La exploración 039 dejó abierta la pregunta "¿la vigencia pagada se pausa o
-- se pierde cuando se suspende el negocio?". D2 (169.2) ya resuelve el reloj
-- de un ad pausado por suspensión de la organización, pero NO resuelve si un
-- ad pausado debería seguir avisando a su dueño que "está por expirar"
-- mientras está paused. Este job avisa del caso INDISCUTIBLE ('active',
-- vigente, corriendo) y deja 'paused' (y el resto del enum) fuera hasta que
-- Abraham lo resuelva -- ver 63_notify_ads_expiring_soon_test.sql,
-- STATUS3_paused.
--
-- ── Destinatarios: consulta directa, no private.agency_role_of ──────────────
-- agency_role_of (20260805000003) resuelve el rol del CALLER actual
-- (auth.uid()) contra una agencia -- útil para autorización de una request,
-- inservible para un job batch que necesita enumerar a TODOS los owners/
-- admins de N agencias distintas en una sola pasada. Este job consulta
-- public.agency_members directo (status='active' and member_role in
-- ('owner','admin')), que es exactamente el mismo criterio que agency_role_of
-- aplica fila por fila (20260805000003:14-23) -- misma fuente de verdad, sin
-- reescribir un helper pensado para otro caso de uso.
--
-- ── D-KEY (fijada por el test-author, 63_notify_ads_expiring_soon_test.sql
--    líneas 40-45): la llave del título del anuncio dentro de `data` es
--    `ad_title` (snake_case, no colisiona con `title`, que es el título DEL
--    AVISO, no del anuncio).
--
-- ── D-BORDE (test-author, líneas 47-51): ventana [now(), now()+7d] con AMBOS
--    corchetes inclusivos -- ends_at = now() exacto es el caso MÁS urgente de
--    avisar, no el más discutible de excluir por un `>` estricto.
--
-- ── 🔴 Idempotencia (el punto fino de la subtarea) ───────────────────────────
-- El job corre a diario; un anuncio a 7 días de expirar cumple la condición
-- de ventana durante varios días seguidos si no se ancla, y generaría hasta 7
-- avisos idénticos para la misma persona. Índice único PARCIAL sobre
-- (user_id, related_entity_id, type, (data->>'ends_at')) where
-- type='ad_expiring_soon', + `on conflict ... do nothing`. El ends_at va
-- DENTRO del ancla a propósito: sin él, un anuncio cuya vigencia se EXTIENDE
-- (UPDATE ends_at a una fecha posterior, ver #6 en el RED) quedaría mudo para
-- siempre -- la primera fila insertada bloquearía cualquier aviso futuro
-- aunque la nueva fecha de expiración sea una ventana genuinamente distinta.
-- El literal se escribe con to_char(... at time zone 'UTC',
-- 'YYYY-MM-DD"T"HH24:MI:SS"Z"') -- NUNCA to_jsonb(timestamptz) directo, que
-- depende de DateStyle/timezone de la SESIÓN (no del servidor) y volvería el
-- ancla inestable entre corridas del mismo cron job si esa configuración
-- cambiara.
--
-- ── 🔴 Gotcha de zona de pg_cron (ya pagado por el guardián de 170.5,
--    horario distinto a propósito) ────────────────────────────────────────
-- El schedule de pg_cron se interpreta en la ZONA DEL SERVIDOR -- `show
-- timezone` en este proyecto (local y remoto) es UTC, pg_cron NO usa la zona
-- de Ciudad de México aunque el negocio sea mexicano. México central es
-- UTC-6 FIJO todo el año (sin horario de verano desde 2022): 9:00 CDMX =
-- 15:00 UTC, de ahí el literal '0 15 * * *'. Se elige un horario DISTINTO del
-- '0 9 * * *' de purge_ad_impressions_daily (170.5) a propósito -- correr dos
-- jobs pesados en la misma ventana de UTC compite por I/O sin necesidad; 9am
-- CDMX es horario hábil (el anunciante ya está despierto para actuar sobre el
-- aviso) y lejos de la purga nocturna.
--
-- cron.schedule() con el MISMO jobname actualiza el job existente in-place
-- (verificado empíricamente en 170.5: no duplica en cron.job al reaplicar) --
-- la migración es re-aplicable sin generar jobs huérfanos.
--
-- Idempotente: create unique index if not exists, create or replace function,
-- create extension if not exists (no-op si 170.5 ya la instaló),
-- cron.schedule idempotente por jobname (confirmado arriba).
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Ancla de idempotencia — índice único parcial sobre notifications
-- ════════════════════════════════════════════════════════════════════════════

create unique index if not exists notifications_ad_expiring_soon_anchor_idx
  on public.notifications (user_id, related_entity_id, type, ((data ->> 'ends_at')))
  where type = 'ad_expiring_soon';

-- 🔴 El índice es parcial SOLO por `type`, nunca por `deleted_at`: un aviso que
-- la persona BORRÓ sigue ocupando la llave y bloquea uno nuevo con el mismo
-- ends_at. Es la decisión querida (171.4, a raíz de la obs. 4 del guardián), no
-- un descuido: el job corre a DIARIO, así que anclar solo los vivos haría que
-- borrar el aviso lo trajera de vuelta mañana, y pasado, hasta que el anuncio
-- expirara. "Ya te avisé, tú lo borraste". Clavado en RUN5 del pgTAP; #77 (UI
-- de notificaciones) hereda esta decisión.
comment on index public.notifications_ad_expiring_soon_anchor_idx is
  'Ancla de idempotencia de notify_ads_expiring_soon() (#171.4). El ends_at '
  'va DENTRO de la llave a propósito: sin él, extender la vigencia de un '
  'anuncio (UPDATE ends_at) dejaría a su dueño sin avisos futuros -- la '
  'primera fila ya insertada bloquearía la ventana nueva.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) public.notify_ads_expiring_soon() — el job
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.notify_ads_expiring_soon()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with candidates as (
    -- Destinatarios: miembros ACTIVOS owner/admin de la organización dueña
    -- del anuncio -- nunca agent/viewer/suspended, nunca vía una columna de
    -- persona creadora (ads no tiene created_by_user_id: la dueña es la
    -- organización). Solo anuncios status='active' con ends_at en
    -- [now(), now()+7d] (ambos corchetes inclusivos, D-BORDE).
    select
      am.user_id,
      a.id as ad_id,
      a.title as ad_title,
      a.ends_at
    from public.ads a
    join public.agency_members am
      on am.agency_id = a.agency_id
     and am.status = 'active'
     and am.member_role in ('owner', 'admin')
    where a.status = 'active'
      and a.ends_at >= now()
      and a.ends_at <= now() + interval '7 days'
  ),
  inserted as (
    insert into public.notifications (
      user_id, type, title, body, deep_link,
      related_entity_type, related_entity_id, data
    )
    select
      c.user_id,
      'ad_expiring_soon',
      'Tu anuncio está por expirar',
      'Tu anuncio "' || c.ad_title || '" expira pronto.',
      '/ads',
      'ad',
      c.ad_id,
      jsonb_build_object(
        -- Literal determinista en UTC, NUNCA to_jsonb(timestamptz) directo
        -- (depende de DateStyle/timezone de sesión, ver cabecera).
        'ends_at', to_char(c.ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        -- D-KEY: 'ad_title', no colisiona con la columna 'title' de la fila
        -- (título DEL AVISO, no del anuncio).
        'ad_title', c.ad_title
      )
    from candidates c
    on conflict (user_id, related_entity_id, type, ((data ->> 'ends_at')))
      where type = 'ad_expiring_soon'
      do nothing
    returning 1
  )
  select count(*)::integer into v_count from inserted;

  return v_count;
end;
$$;

comment on function public.notify_ads_expiring_soon() is
  'Avisa a los miembros activos owner/admin de la organización dueña de un '
  'anuncio cuando ends_at cae en [now(), now()+7d] y status=active (#171.4). '
  'Retorna cuántas filas insertó (idempotente por notifications_ad_expiring_'
  'soon_anchor_idx: correr el job dos veces seguidas no duplica). Programada '
  'diario vía pg_cron (jobname notify_ads_expiring_soon_daily, '
  '0 15 * * * UTC = 9am CDMX, extensión REUSADA de 170.5).';

revoke execute on function public.notify_ads_expiring_soon() from public, anon, authenticated;
grant execute on function public.notify_ads_expiring_soon() to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) pg_cron — REUSA la extensión de 170.5, programa el job nuevo
-- ════════════════════════════════════════════════════════════════════════════

-- No-op de reutilización si 170.5 ya la instaló (siempre el caso en el orden
-- real de migraciones); nunca un segundo mecanismo.
create extension if not exists pg_cron with schema cron;

select cron.schedule(
  'notify_ads_expiring_soon_daily',
  '0 15 * * *',
  'select public.notify_ads_expiring_soon();'
);
