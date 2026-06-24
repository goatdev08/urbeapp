---
tipo: estado
actualizado: 2026-06-24
---

# Estado actual

> Narrativa de "dónde estamos hoy". El **qué sigue / qué está hecho** vive en **Taskmaster** (`task-master list`), no aquí.

## Hoy (2026-06-24)

- **Documentación:** madura (`docs/`), incluido el [[0001-alcance-mvp-recomendado|MVP recomendado]] y el PRD oficial completo. Alcance de la demo en `docs/PRD-MVP-demo.md`.
- **Base de datos:** Supabase migrada y endurecida — 20 tablas, RLS, tests pgTAP; migraciones `0001`–`0014` aplicadas al proyecto live `urbea-app` (`mvpvqmyhrrkwbnpctpuq`). **0011 (#3): bucket Storage `property-videos` + columna `storage_path` + RLS de Storage.** **0012 (#4): CHECK `property_videos_ready_requires_storage` — un video `ready` exige `storage_path` o `cloudflare_uid`.** **0013 (#5): RPC `redeem_invitation_atomic` de canje atómico.** **0014 (#5): grants DML de `service_role` (gotcha en [[rls-seguridad]]).** Ver [[db-schema-map]] y [[propiedades-y-video]].
- **Código de app:** Tareas **#1, #2, #3, #4 y #5 cerradas**. `mobile/` inicializada (Expo SDK 56, dev build, Expo Router, TS strict) + cliente Supabase tipado. **Auth email/password vivo** (#2): AuthContext, login, validación, mapeo de errores ES, rutas protegidas. **Storage de video listo** (#3/#4): bucket privado + RLS (agente sube a su path, lectura pública de activos), TDD pgTAP contra remoto. **Canje de invitación + registro de agente vivo** (#5): Edge Functions `validate-invitation` y `redeem-invitation` (Deno, patrón DI handler/index, desplegadas y smoke-E2E OK contra remoto) + pantalla `mobile/app/register.tsx` (2 fases, auto-login). Tests: jest-expo (mobile) + `deno test` (65 verdes en Edge Functions). Detalle en [[mapa-codebase]], [[inmobiliarias-y-agentes]], [[propiedades-y-video]]. **Stack #1→#2→#3→#5 consolidado en `main`** (ramas borradas).
- **EAS:** proyecto `@deabratech/urbea` registrado; `eas.json` listo. **✅ Primer `eas build` (development, Android) hecho** — `.apk` instalado en device del cliente y **Urbea corriendo nativo** (Metro `--dev-client` + Supabase activo). Comandos en [[comandos]].
- **Sistema de trabajo:** vault Obsidian densificado ([[0003-vault-obsidian-como-memoria]]); **Taskmaster** con backlog de **20 tareas** (5 done, 15 pending), provider `claude-code/sonnet` ([[0004-taskmaster-motor-de-ejecucion]]).
- **Primer hito:** [[0005-demo-cerrada-3-semanas|demo cerrada de 3 semanas]].

## Decisiones recientes
- Alcance = demo cerrada (inmobiliarias/agentes, sin pagos). Ver [[0005-demo-cerrada-3-semanas]].
- Monetización elegida pero **latente**: [[0002-monetizacion-pago-por-video]].
- Auth: login + **registro por invitación de agente** ya vivos (#2, #5). El alta de inmobiliarias/owner (panel admin) sigue pendiente.
- Storage de video (#3): bucket privado + RLS dueño/lectura-pública; CORS no aplica (Supabase lo sirve a nivel gateway; nativo no lo exige).
- Patrón de canje: la **atomicidad vive en una RPC `SECURITY DEFINER`** (0013), la Edge Function orquesta y compensa. `service_role` requiere grants DML explícitos (0014) — gotcha durable en [[rls-seguridad]].

## Pendiente inmediato (detalle en Taskmaster)
- **Next:** `task-master next` (siguiente tarea del backlog).
- **Branding (#19): en pausa** hasta indicación del cliente.
