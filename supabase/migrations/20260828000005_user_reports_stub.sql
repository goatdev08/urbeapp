-- Migración 20260828000005 — STUB (RED, subtarea #220.6, tarea 220 "reportes de
-- usuarios y auto-moderación", exploración 041-M3, PRD §24.2).
--
-- 🔴 ESTE ES UN STUB DE LA FASE RED — sin las 2 invariantes de negocio nuevas
-- (CHECK "other exige texto" y CHECK "no auto-reportarse") ni las policies RLS.
-- Existe SOLO para que la tabla exista con la forma correcta (columnas/tipos/FK)
-- y la suite pgTAP supabase/tests/76_user_reports_test.sql pueda ejecutar sus
-- INSERT/SELECT sin abortar por error de catálogo (42P01 "relation does not
-- exist" / 42703 "column does not exist" tumbarían la transacción entera y
-- romperían el patrón `begin;...rollback;` de una sola transacción que usan
-- todas las suites de este repo) — y así falle por ASERCIÓN, no por catálogo.
--
-- ── Alcance MÍNIMO (decisión Abraham 2026-08-28, subtarea 220.6) ────────────
-- Reporte de PERFIL de publicador (agente/premium). Misma forma que
-- property_reports (migración 20260604000007 + 20260828000001), SIN cola de
-- acciones admin ni auto-suspensión de cuentas (§28.3-4 es tarea futura) —
-- por eso NO hay trigger de auto-moderación sobre esta tabla, a diferencia de
-- property_reports_autosuspend (20260828000002).
--
-- ── Reuso del enum property_report_reason (decisión, NO se crea un gemelo) ──
-- Los 7 valores (not_exist_fraud, misleading, false_price, wrong_address,
-- inappropriate, duplicate, other) fueron pensados para propiedades — 2 de
-- ellos (false_price, wrong_address) leen raro para un perfil de persona,
-- pero el PRD §24.2 no define un catálogo de motivos propio para perfiles
-- (una sola línea: "disponibles desde la pantalla de perfil") y crear un
-- ENUM gemelo idéntico en valores sería duplicación de esquema sin ningún
-- beneficio real (mismo `check` que ya expresa "reason='other' exige texto",
-- mismo tipo reusable en RPCs/EFs futuras). Si producto decide un catálogo de
-- motivos propio para perfiles, se extiende con `ALTER TYPE ... ADD VALUE`
-- (aditivo, no rompe property_reports) — tarea derivada futura si hay volumen.
-- Los LABELS en español sí pueden diferir por target en la capa de UI (móvil,
-- 220.6) sin tocar el enum de dominio.
--
-- ── Lo que este STUB SÍ crea (mecánico, no es la invariante bajo prueba) ────
--   - Tabla + columnas/tipos/defaults (misma forma que property_reports).
--   - FK reported_user_id / reported_by_user_id -> public.users.
--   - Trigger set_updated_at (función ya existente, reuso puro).
--
-- ── Lo que este STUB NO crea (es la invariante nueva — DEBE fallar hoy) ─────
--   - CHECK user_reports_other_requires_text.
--   - CHECK user_reports_no_self_report.
--   - Índice único de dedupe (reported_user_id, reported_by_user_id).
--   - RLS: la tabla queda con ROW LEVEL SECURITY ENABLED y CERO policies ->
--     deny-total para cualquier rol no-superusuario (ni el propio reportante
--     puede insertar/leer todavía). Ver cabecera de 76_user_reports_test.sql
--     para el detalle de qué asserts son DELTA vs cuáles coinciden hoy con el
--     resultado correcto por la razón incorrecta (deny-total en vez del check
--     real por fila) y deben re-verificarse tras el GREEN.
--
-- ── Nota sobre el GRANT (mecánico, no es la invariante bajo prueba) ─────────
-- Tablas nuevas en public NO heredan el GRANT blanket de 0008 (solo cubrió
-- las tablas que existían entonces, patrón documentado en
-- 20260809000004_property_video_slots.sql) — sin GRANT, hasta un SELECT
-- impersonado revienta con "permission denied for table" (nivel de PRIVILEGIO,
-- no de RLS) FUERA de cualquier throws_ok/lives_ok, lo que abortaría la
-- transacción completa de la suite. Se otorga select+insert a `authenticated`
-- aquí (privilegio de tabla, mecánico) para que sea la ausencia de POLICIES
-- (RLS, la invariante real) la que produzca deny-total, no un error de
-- catálogo/privilegio que tumbe el resto de la suite.
--
-- GREEN (siguiente migración, alter table sobre esta misma tabla, patrón
-- idéntico a 20260828000001 sobre property_reports) debe añadir:
--   - Los 2 CHECK de arriba (mismo patrón `reason_text ~ '\S'`, NUNCA trim()
--     — trim() en Postgres solo recorta el espacio ASCII, hallazgo 220.1).
--   - El índice único de dedupe.
--   - Policies user_reports_insert (with check reported_by_user_id = auth.uid())
--     y user_reports_select (using reported_by_user_id = auth.uid() or is_admin()).
--     SIN policies de update/delete (sin cola de acciones, alcance mínimo).
--
-- Rollback: supabase/migrations/rollbacks/20260828000005_user_reports_stub.sql

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
  updated_at           timestamptz not null default now()
);
comment on table public.user_reports is
  '🔴 STUB RED (subtarea 220.6) — faltan los 2 CHECK, el índice único de dedupe '
  'y las policies RLS. Ver cabecera de esta migración y '
  'supabase/tests/76_user_reports_test.sql para el contrato completo que el '
  'GREEN debe implementar. Reporte de perfil de publicador, alcance mínimo '
  '(PRD §24.2) — sin cola de acciones ni auto-suspensión de cuentas.';

create index if not exists user_reports_target_idx
  on public.user_reports (reported_user_id);

-- RLS enabled sin policies (deny-total para no-superusuario) — deliberado, es
-- parte del RED (ver cabecera).
alter table public.user_reports enable row level security;

drop trigger if exists set_updated_at on public.user_reports;
create trigger set_updated_at before update on public.user_reports
  for each row execute function public.set_updated_at();

-- Grant mecánico (ver nota arriba) — SIN policies todavía, así que RLS sigue
-- siendo deny-total pese al grant de tabla.
revoke all on public.user_reports from anon, authenticated;
grant select, insert on public.user_reports to authenticated;
