# Bitácora del proyecto

Append-only. Prefijo: `## [YYYY-MM-DD] tipo | título`.
Tipos: `fundacion`, `decision`, `ingest`, `query`, `lint`, `tarea`, `explore`.
Tip: `grep "^## \[" log.md | tail -5` → últimas 5 entradas.

## [2026-06-17] fundacion | vault inicializado
- Estructura del vault creada (MOCs, conceptos, codebase, decisiones, estado).
- Sembrado desde `docs/` y `supabase/` (DB migrada 0001–0010).

## [2026-06-17] decision | alcance del primer hito = demo cerrada de 3 semanas
- Sesión de preguntas (7 rondas) con el cliente. Ver [[0005-demo-cerrada-3-semanas]].
- PRD destilado en `docs/PRD-MVP-demo.md`.
- Demo: inmobiliaria+agentes, código de invitación, email+contraseña, wizard 3 pasos, video real a Supabase Storage (sin transcoding), feed vertical, filtros básicos, mapa con clustering, CRM lista+estados, contacto WhatsApp+lead. Dev build (expo-dev-client). Backend = Supabase remoto. Sin pagos.

## [2026-06-17] decision | ADRs 0001–0004 aceptadas
- [[0001-alcance-mvp-recomendado]], [[0002-monetizacion-pago-por-video]], [[0003-vault-obsidian-como-memoria]], [[0004-taskmaster-motor-de-ejecucion]].

## [2026-06-17] ingest | vault densificado a síntesis densa
- Los 13 conceptos reescritos con modelo de datos, invariantes, flujos y reglas + punteros precisos a las fuentes.
- Añadido [[MOC-fuentes]] (catálogo de docs/ y supabase/) — la capa que dice "a dónde ir por el detalle".
- Decisión del nivel de profundidad: síntesis densa (Karpathy), no espejo de los docs.

## [2026-06-17] fundacion | Taskmaster inicializado + backlog generado
- `task-master init` en la raíz; provider **claude-code/sonnet** (sin API key, $0). Canal: **CLI** (no MCP).
- `parse-prd` sobre `docs/PRD-MVP-demo.md` → **20 tareas** (tag `master`).
- `analyze-complexity` → 6 alta / 11 media / 3 baja. Reporte en `.taskmaster/reports/task-complexity-report.json`.
- Next: **#1** init Expo + dev build. Branding (#19) en pausa por decisión del cliente.

## [2026-06-17] decision | CLAUDE.md + workflow de ejecución (ADR 0006)
- Creado `CLAUDE.md` (schema operativo): principio rector, inicio de sesión, stack, Taskmaster CLI, workflow de ejecución, cierre, mantenimiento del vault.
- **PNPM siempre** como gestor de paquetes y dev server (nunca npm/yarn).
- Workflow: Taskmaster como bitácora viva vía `update-subtask`; verificación con `pnpm`; ingest al vault al cerrar. Ver [[0006-workflow-ejecucion-tareas]].

## [2026-06-17] fundacion | tareas expandidas a subtareas (Opus)
- `task-master expand --all` con provider claude-code/**opus** → 20 tareas, **144 subtareas** (0 fallos, $0).
- Modelo devuelto a `sonnet` para la operación diaria.
- Backlog listo para ejecución fina con el workflow ([[0006-workflow-ejecucion-tareas]]). Next: **#1**.

## [2026-06-17] fundacion | workflow multi-agente construido (ADR 0007)
- `.claude/agents/`: analista-subtareas, mobile, supabase, design, test-author, guardian.
- `.claude/skills/`: urbea-context, urbea-expo, urbea-supabase, urbea-design, urbea-testing.
- `.claude/commands/`: tm-plan, tm-tarea (modo auto), tm-status. Hooks: tdd-guard.sh (pragmático), close-reminder.sh. settings.json con permisos + hooks.
- TDD pragmático por criticidad, serie con checkpoints, manejo de bloqueantes, convención de nombres snake_case. graphify contemplado a futuro. Ver [[0007-workflow-multiagente]].

## [2026-06-21] explore | aprobado tarea 19 — Branding + Design System de Urbea

## [2026-06-23] tarea | #1 init Expo + dev build — app móvil inicializada
- `mobile/` scaffold Expo SDK 56 (blank-typescript, standalone, `.npmrc` hoisted), Expo Router, TS strict.
- EAS configurado: `app.config.ts` (`com.urbea.app`, owner `deabratech`), `eas.json` (development/preview/production); proyecto `@deabratech/urbea` registrado (projectId 85c7157a-…).
- Deps nativas: expo-dev-client, expo-router, react-native-maps@1.27.2 (sin fricción en SDK 56), expo-video, screens, safe-area-context.
- Cliente Supabase tipado `src/lib/supabase/client.ts` (createClient<Database> + AsyncStorage); smoke test **200 OK** contra remoto `mvpvqmyhrrkwbnpctpuq`. Credenciales en `.env.local` (gitignored).
- Mapa-codebase actualizado (sección móvil → archivos reales). Rama `tarea/1-init-expo-mobile` (commits locales). Pendiente humano: primer `eas build` para ver la app en device.

## [2026-06-23] hito | #1 dev build instalado en device
- Primer `eas build` (development, Android) exitoso tras resolver cascada: `npx eas-cli` (no pnpm-global), `app.config.js` (no `.ts`), y `mobile/` self-contained (sin `pnpm-workspace.yaml` raíz que hoisteaba deps nativas fuera de EAS).
- `.apk` instalado; Urbea corriendo nativo en device vía `pnpm expo start --dev-client` (Supabase activo).
- Nuevo: `wiki/codebase/comandos.md` (referencia de comandos dev/EAS/verificación/Taskmaster).

## [2026-06-24] tarea | #2 Auth Supabase email/password en mobile
- BD verificada para la demo: tabla public.users + trigger handle_new_user + RLS + column-grants YA cubren el flujo (sin migración nueva). Hueco menor: last_login_at no se auto-actualiza (cosmético).
- AuthContext (src/features/auth/context.tsx): useAuth {session,user(perfil public.users),isLoading,signIn,signOut} + onAuthStateChange. Login solo (cuentas sembradas; signup/invitación → #3).
- Pantalla login (app/login.tsx) + validación pura (validation.ts) + mapeo de errores ES (auth-errors.ts) + guard de rutas (protected-layout.tsx → app/(protected)/) + AuthProvider en root.
- Persistencia AsyncStorage ya estaba en client.ts (tarea #1); añadido listener AppState para start/stopAutoRefresh.
- Harness de tests jest-expo + testing-library (nuevo). TDD en críticas (2.1, 2.4, 2.5) con guardian (3 mutantes verificados por subtarea). Total: 60 tests verdes, tsc strict limpio.
- Estructura feature-based confirmada (src/features/auth/). Rama tarea/2-auth-supabase (commits locales).

## [2026-06-24] tarea | #5 Canje de invitación + registro de agente
- Edge Functions (Deno, patrón DI handler.ts puro / index.ts entry): `validate-invitation` (POST {invitationCode}→200 {agency_name}) y `redeem-invitation` (orquesta validar token→auth.admin.createUser→RPC canje→200; compensa deleteUser si falla). `_shared/` con cors/response/crypto(sha256)/validation/invitation/auth_user/redeem/clients (clients.ts = único import de supabase-js). Import map en deno.json; correr deno DESDE supabase/functions/.
- Atomicidad: migración 0013 RPC `redeem_invitation_atomic` (SECURITY DEFINER): consumo token + agency_members + denorm users + 4 user_consents; errores P0001→HTTP. user_preferences NO (es onboarding de buyer).
- Mobile: `app/register.tsx` en 2 fases (valida código→muestra agencia→datos+canje→auto-login signInWithPassword) + `src/features/registration/` (validation, registration-errors, api). 17 tests Jest.
- **Bug sistémico hallado en despliegue real:** `service_role` sin grants DML en `public` (0008 solo otorgó a authenticated/anon) → supabase-js service_role recibía 403 de PostgREST. Las RPC SECURITY DEFINER no se veían afectadas (corren como postgres). Fix: **migración 0014_service_role_grants**. Documentado en [[rls-seguridad]].
- Otros 2 fixes de integración: filtro embebido PostgREST `.is("agencies.deleted_at",null)` descartaba la fila padre (→ validar en JS); `x-forwarded-for` lista CSV rompía el param `inet` (→ 1ª IP).
- Verificación: smoke E2E contra remoto (validate 200/404/400; redeem 200 con efectos atómicos + compensación verificados; datos limpiados). deno fmt/lint/test: 65 verdes. Advisors security sin WARN/ERROR nuevos. Migraciones 0011–0014 aplicadas en `urbea-app`.
- Pendiente (cliente): consolidar ramas #1→#2→#3→#5 a main.
