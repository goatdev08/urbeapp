-- Migración 20260828000005 — GREEN de user_reports (subtarea #220.6, tarea
-- 220 "reportes de usuarios y auto-moderación", exploración 041-M3, PRD
-- §24.2). ÚNICA migración que crea esta tabla: el STUB que usó el RED
-- (misma fecha, mismo nombre de archivo sin sufijo `_stub`) se eliminó del
-- árbol antes de integrar — era andamio de test, no un artefacto que deba
-- viajar a producción — así que este archivo crea la tabla COMPLETA desde
-- cero (mismo criterio de consolidación que 220.3/20260828000004).
--
-- ── Alcance MÍNIMO (decisión Abraham 2026-08-28, subtarea 220.6) ────────────
-- Reporte de PERFIL de publicador (agente/premium). Misma forma que
-- property_reports (migración 20260604000007 + 20260828000001), SIN cola de
-- acciones admin ni auto-suspensión de cuentas (§28.3-4 es tarea futura) —
-- por eso NO hay trigger de auto-moderación sobre esta tabla, a diferencia de
-- property_reports_autosuspend (20260828000002). Tampoco hay policies de
-- update/delete: sin cola de acciones, un reporte insertado no se edita ni
-- se borra desde el cliente en este alcance.
--
-- ── Reuso del enum property_report_reason (decisión, NO se crea un gemelo) ──
-- Los 7 valores (not_exist_fraud, misleading, false_price, wrong_address,
-- inappropriate, duplicate, other) fueron pensados para propiedades — 2 de
-- ellos (false_price, wrong_address) leen raro para un perfil de persona,
-- pero el PRD §24.2 no define un catálogo de motivos propio para perfiles
-- (una sola línea: "disponibles desde la pantalla de perfil") y crear un
-- ENUM gemelo idéntico en valores sería duplicación de esquema sin ningún
-- beneficio real (mismo CHECK "reason='other' exige texto", mismo tipo
-- reusable en RPCs/EFs futuras). Si producto decide un catálogo de motivos
-- propio para perfiles, se extiende con `ALTER TYPE ... ADD VALUE` (aditivo,
-- no rompe property_reports) — tarea derivada futura si hay volumen. Los
-- LABELS en español sí pueden diferir por target en la capa de UI (móvil,
-- 220.6) sin tocar el enum de dominio.
--
-- ── Contrato completo que este archivo implementa ────────────────────────────
--   - Tabla + columnas/tipos/defaults (misma forma que property_reports).
--   - FK reported_user_id / reported_by_user_id -> public.users; FK
--     reviewed_by_admin_id -> public.users (mecánico, mirror exacto).
--   - CHECK user_reports_other_requires_text: mismo patrón que
--     property_reports_other_requires_text (220.1): `reason <> 'other' or
--     (reason_text is not null and reason_text ~ '\S')`. Se usa la clase
--     regex \S y NUNCA trim() — trim() en Postgres solo recorta el espacio
--     ASCII y deja pasar tabuladores/saltos de línea (hallazgo 220.1). El
--     `is not null` explícito es obligatorio: un CHECK que evalúa a NULL se
--     considera CUMPLIDO y la fila entra.
--   - CHECK user_reports_no_self_report: `reported_user_id <>
--     reported_by_user_id` — invariante NUEVA sin equivalente en
--     property_reports (una propiedad no tiene identidad de usuario
--     comparable 1:1 con auth.uid(); un perfil sí).
--   - Índice único user_reports_one_per_user (reported_user_id,
--     reported_by_user_id) — mismo patrón que property_reports_one_per_user
--     (20260604000007): un usuario, un reporte por publicador.
--   - Índice user_reports_target_idx (reported_user_id) para listar reportes
--     por publicador reportado.
--   - Trigger set_updated_at (función ya existente, reuso puro).
--   - RLS habilitado con policies (patrón private.is_admin() /
--     (select auth.uid()), 0008→0010):
--       user_reports_insert: with check reported_by_user_id = (select
--         auth.uid()) — solo se inserta a nombre propio.
--       user_reports_select: using reported_by_user_id = (select auth.uid())
--         or private.is_admin() — el reportante ve lo suyo, el admin ve todo.
--     SIN policies de update/delete (alcance mínimo, sin cola de acciones).
--   - Grant de tabla (mecánico): tablas nuevas en public NO heredan el GRANT
--     blanket de 0008 (solo cubrió las tablas que existían entonces, patrón
--     documentado en 20260809000004_property_video_slots.sql) — sin GRANT,
--     hasta un SELECT impersonado revienta con "permission denied for table"
--     (nivel de PRIVILEGIO, no de RLS). select+insert a `authenticated`
--     (sin update/delete: no hay policy que los respalde y sin cola de
--     acciones el cliente no debe poder mutar ni borrar un reporte).
--
-- Contrato de test completo (edge cases DELTA/COINCIDE/INVARIANTE): ver
-- cabecera de supabase/tests/76_user_reports_test.sql — todas esas
-- decisiones ya estaban FIJADAS por el test-author; este archivo solo las
-- implementa.
--
-- 🔴 SIN trigger de auto-suspensión de cuentas (decisión de alcance: §28.3-4
-- es trabajo futuro). El RED ancla explícitamente esa ausencia (sección 8,
-- ABSENCE1-3) — no se implementa aquí.
--
-- Rollback: supabase/migrations/rollbacks/20260828000005_user_reports.sql
-- (DROPEA la tabla completa — un rollback a una tabla a medias fallaría en
-- silencio: RLS quedaría deny-total o, peor, sin RLS, exponiendo filas).

create table if not exists public.user_reports (
  id                   uuid primary key default gen_random_uuid(),
  reported_user_id     uuid not null references public.users (id) on delete cascade,
  reported_by_user_id  uuid not null references public.users (id) on delete cascade,
  reason               property_report_reason not null,
  reason_text          text,
  status               property_report_status not null default 'new',
  reviewed_by_admin_id uuid references public.users (id) on delete set null,
  reviewed_at          timestamptz,
  resolution           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint user_reports_other_requires_text
    check (reason <> 'other' or (reason_text is not null and reason_text ~ '\S')),
  constraint user_reports_no_self_report
    check (reported_user_id <> reported_by_user_id)
);
comment on table public.user_reports is
  'Reportes de PERFIL de publicador (agente/premium), alcance mínimo (PRD '
  '§24.2, subtarea 220.6). Un usuario no reporta dos veces al mismo '
  'publicador (user_reports_one_per_user) ni puede reportarse a sí mismo '
  '(CHECK user_reports_no_self_report). Reusa property_report_reason (ver '
  'cabecera de esta migración) y property_report_status. SIN cola de '
  'acciones admin ni auto-suspensión de cuentas — §28.3-4 es tarea futura.';

create unique index if not exists user_reports_one_per_user
  on public.user_reports (reported_user_id, reported_by_user_id);
create index if not exists user_reports_target_idx
  on public.user_reports (reported_user_id);

alter table public.user_reports enable row level security;

drop trigger if exists set_updated_at on public.user_reports;
create trigger set_updated_at before update on public.user_reports
  for each row execute function public.set_updated_at();

-- Grant mecánico (ver nota en la cabecera) — sin update/delete: no hay
-- policy que los respalde (alcance mínimo, sin cola de acciones).
revoke all on public.user_reports from anon, authenticated;
grant select, insert on public.user_reports to authenticated;

-- Policies: insert propio (reported_by_user_id = auth.uid()) y select del
-- reportante sobre lo suyo o del admin sobre todo. Mismo patrón que
-- reports_select/reports_insert de property_reports (20260604000010).
drop policy if exists user_reports_insert on public.user_reports;
create policy user_reports_insert on public.user_reports for insert to authenticated
  with check (reported_by_user_id = (select auth.uid()));

drop policy if exists user_reports_select on public.user_reports;
create policy user_reports_select on public.user_reports for select to authenticated
  using (reported_by_user_id = (select auth.uid()) or private.is_admin());
