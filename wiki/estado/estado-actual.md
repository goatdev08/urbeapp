---
tipo: estado
actualizado: 2026-06-24
---

# Estado actual

> Narrativa de "dónde estamos hoy". El **qué sigue / qué está hecho** vive en **Taskmaster** (`task-master list`), no aquí.

## Hoy (2026-06-24)

- **Documentación:** madura (`docs/`), incluido el [[0001-alcance-mvp-recomendado|MVP recomendado]] y el PRD oficial completo. Alcance de la demo en `docs/PRD-MVP-demo.md`.
- **Base de datos:** Supabase migrada y endurecida — 20 tablas, RLS, tests pgTAP; migraciones `0001`–`0014` aplicadas al proyecto live `urbea-app` (`mvpvqmyhrrkwbnpctpuq`) — incluye `0013` (RPC de canje atómico) y `0014` (grants DML de `service_role`, ver [[rls-seguridad]]). Ver [[db-schema-map]].
- **Código de app:** Tareas **#1, #2 y #5 cerradas** (#3/#4 Storage en su propia rama). **Canje de invitación + registro de agente vivo** (#5): Edge Functions `validate-invitation` y `redeem-invitation` (Deno, patrón DI handler/index, desplegadas y smoke-E2E OK contra remoto) + pantalla `mobile/app/register.tsx` (2 fases, auto-login). Auth email/password (#2) ya estaba vivo. Detalle en [[mapa-codebase]], [[inmobiliarias-y-agentes]]. Tests: jest-expo (mobile) + `deno test` (65 verdes en Edge Functions). Rama `tarea/5-invitation-redemption`.
- **EAS:** proyecto `@deabratech/urbea` registrado; `eas.json` listo. **✅ Primer `eas build` (development, Android) hecho** — `.apk` instalado en device del cliente y **Urbea corriendo nativo** (Metro `--dev-client` + Supabase activo). Comandos en [[comandos]].
- **Sistema de trabajo:** vault Obsidian densificado ([[0003-vault-obsidian-como-memoria]]); **Taskmaster** con backlog de **20 tareas** (2 done, 18 pending), provider `claude-code/sonnet` ([[0004-taskmaster-motor-de-ejecucion]]).
- **Primer hito:** [[0005-demo-cerrada-3-semanas|demo cerrada de 3 semanas]].

## Decisiones recientes
- Alcance = demo cerrada (inmobiliarias/agentes, sin pagos). Ver [[0005-demo-cerrada-3-semanas]].
- Monetización elegida pero **latente**: [[0002-monetizacion-pago-por-video]].
- Auth: login + **registro por invitación de agente** ya vivos (#2, #5). El alta de inmobiliarias/owner (panel admin) sigue pendiente.
- Patrón de canje: la **atomicidad vive en una RPC `SECURITY DEFINER`** (0013), la Edge Function orquesta y compensa. `service_role` requiere grants DML explícitos (0014) — gotcha durable en [[rls-seguridad]].

## Pendiente inmediato (detalle en Taskmaster)
- **Consolidar ramas** (pendiente, pedido del cliente): mergear el stack `#1→#2→#3→#5` a `main` y borrar ramas para limpiar el worktree.
- **Branding (#19): en pausa** hasta indicación del cliente.
