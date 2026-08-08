-- Migración 20260807000003 — Reconciliación del embudo de lead_status (subtarea 75.1, PRD §19.8)
-- Requiere que 20260807000002 ya haya committeado los 4 valores nuevos del enum (corre
-- después, migración separada por el ADD VALUE gotcha — ver header de esa migración).
--
-- Contenido:
--   1) Data-fix: los leads legacy en 'new' pasan a 'whatsapp_opened' (estado inicial real
--      tras contactar por WhatsApp, PRD §19.2/§19.8). Los 'closed_won' legacy NO se migran
--      a closed_won_rent/closed_won_sale — adivinar el tipo de operación es peor que dejarlos
--      legacy (decisión del usuario).
--   2) leads.is_follow_up: bandera ORTOGONAL al estado (§19.8) — convive con cualquier
--      status, no es un estado más.
--   3) lead_status_history: timeline append-only del embudo (mismo patrón que
--      public.admin_actions, migración 20260604000007:78-95), poblado por un trigger
--      AFTER INSERT OR UPDATE OF status — ninguna Edge Function escribe aquí a mano, así
--      ninguna ruta de escritura futura se olvida de loguear el cambio.
--   4) RLS de lead_status_history: SELECT vía private.can_view_lead(lead_id); CERO
--      INSERT/UPDATE/DELETE para authenticated — solo el trigger SECURITY DEFINER escribe.
--
-- Idempotente: create table/policy if not exists, drop trigger/policy if exists + create,
-- add column if not exists, revoke/grant repetibles.
-- Rollback: supabase/migrations/rollbacks/20260807000003_lead_status_reconcile.sql

-- ════════════════════════════════════════════════════════════════════════════
-- 1) Data-fix: 'new' (legacy) → 'whatsapp_opened' (estado inicial real)
-- ════════════════════════════════════════════════════════════════════════════
-- Usa 'whatsapp_opened', ya committeado por 20260807000002. Los leads en 'new' de
-- ANTES de esta migración representan el mismo momento del embudo (recién contactado,
-- sin respuesta aún) que hoy se llama whatsapp_opened — no hay ambigüedad en este mapeo
-- (a diferencia de closed_won, que si se dejó sin split rent/sale).
update public.leads set status = 'whatsapp_opened' where status = 'new';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) leads.is_follow_up — bandera ORTOGONAL al estado (§19.8)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.leads
  add column if not exists is_follow_up boolean not null default false;

comment on column public.leads.is_follow_up is
  'Bandera de seguimiento pendiente (PRD §19.8). ORTOGONAL al status: convive con '
  'cualquier estado (contacted, interested, visit_scheduled, ...) sin cambiarlo.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3) lead_status_history — timeline append-only (patrón public.admin_actions)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.lead_status_history (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references public.leads (id) on delete cascade,
  old_status lead_status,              -- NULL en la fila de creación (no hay "anterior")
  new_status lead_status not null,
  changed_by uuid references public.users (id) on delete set null,
  changed_at timestamptz not null default now()
);
comment on table public.lead_status_history is
  'Timeline append-only del embudo de un lead (PRD §19.8). Poblada SOLO por el trigger '
  'trg_lead_status_history (SECURITY DEFINER) — ninguna Edge Function ni cliente escribe '
  'aquí directo. Mismo patrón que public.admin_actions (20260604000007:78-95).';

create index if not exists lead_status_history_lead_idx
  on public.lead_status_history (lead_id, changed_at desc);

-- ── Trigger: puebla el historial en cada INSERT o cambio de status ───────────
-- SECURITY DEFINER + search_path vacío + nombres calificados: mismo patrón que
-- public.update_like_count (20260701000001) y public.handle_new_user (0002). Necesario
-- porque lead_status_history NO tiene policy de INSERT para authenticated (fail-closed,
-- sección 4) — sin DEFINER el INSERT del trigger sería bloqueado por RLS igual que
-- cualquier escritura directa del agente.
--
-- Guarda interna (TG_OP): "AFTER UPDATE OF status" ya solo dispara cuando la columna
-- status aparece en el SET del UPDATE (un UPDATE que solo toca internal_notes nunca llega
-- aquí), pero un SET status = status (mismo valor) sí dispararía el trigger — la guarda
-- evita una fila de historial ruidosa para un no-op. No se puede expresar como WHEN del
-- CREATE TRIGGER porque Postgres prohíbe referenciar OLD en el WHEN de un trigger que
-- incluye INSERT ("INSERT trigger's WHEN condition cannot reference OLD values"),
-- verificado en local antes de escribir esta migración.
create or replace function public.log_lead_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'UPDATE' and OLD.status is not distinct from NEW.status then
    return new;
  end if;

  insert into public.lead_status_history (lead_id, old_status, new_status, changed_by)
  values (
    new.id,
    case when TG_OP = 'INSERT' then null else old.status end,
    new.status,
    auth.uid()
  );
  return new;
end;
$$;

comment on function public.log_lead_status_change() is
  'AFTER INSERT OR UPDATE OF status en public.leads: puebla lead_status_history. '
  'SECURITY DEFINER: la tabla no tiene policy de INSERT para authenticated (sección 4 de '
  'esta migración) — solo este trigger escribe. Transiciones libres (75.1): no valida '
  'nada, solo registra old_status→new_status.';

drop trigger if exists trg_lead_status_history on public.leads;
create trigger trg_lead_status_history
  after insert or update of status on public.leads
  for each row
  execute function public.log_lead_status_change();

-- ════════════════════════════════════════════════════════════════════════════
-- 4) RLS de lead_status_history — SELECT vía can_view_lead; fail-closed en escritura
-- ════════════════════════════════════════════════════════════════════════════
alter table public.lead_status_history enable row level security;

drop policy if exists lead_status_history_select on public.lead_status_history;
create policy lead_status_history_select on public.lead_status_history
  for select to authenticated
  using (private.can_view_lead(lead_id));

-- Fail-closed con dientes (patrón public.user_consents, 20260727000003): el GRANT de
-- tabla por default de Supabase (anon/authenticated reciben SELECT/INSERT/UPDATE/DELETE
-- de fábrica en toda tabla nueva de public) se revoca primero; solo se re-otorga lo que
-- la tabla necesita. Sin política de INSERT/UPDATE/DELETE para authenticated Y sin el
-- GRANT correspondiente: ni siquiera el agente dueño del lead puede escribir directo,
-- solo el trigger SECURITY DEFINER (que corre como el owner de la función, no como
-- authenticated, y por lo tanto no necesita estos grants).
revoke all on public.lead_status_history from anon, authenticated;
grant select on public.lead_status_history to authenticated;
grant select, insert, update, delete on public.lead_status_history to service_role;
