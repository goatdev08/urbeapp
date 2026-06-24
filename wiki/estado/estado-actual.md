---
tipo: estado
actualizado: 2026-06-23
---

# Estado actual

> Narrativa de "dónde estamos hoy". El **qué sigue / qué está hecho** vive en **Taskmaster** (`task-master list`), no aquí.

## Hoy (2026-06-24)

- **Documentación:** madura (`docs/`), incluido el [[0001-alcance-mvp-recomendado|MVP recomendado]] y el PRD oficial completo. Alcance de la demo en `docs/PRD-MVP-demo.md`.
- **Base de datos:** Supabase migrada y endurecida — 20 tablas, RLS, tests pgTAP; migraciones `0001`–`0010` aplicadas al proyecto live `urbea-app` (`mvpvqmyhrrkwbnpctpuq`). Ver [[db-schema-map]]. **Verificada: cubre el Auth de la demo sin migración nueva.**
- **Código de app:** Tareas **#1 y #2 cerradas**. `mobile/` inicializada (Expo SDK 56, dev build, Expo Router, TS strict) + cliente Supabase tipado. **Auth email/password vivo** (#2): AuthContext, login, validación, mapeo de errores ES, rutas protegidas. **Solo login** (cuentas sembradas; signup/invitación → #3). Harness de tests jest-expo: **60 tests verdes**, TDD+guardian en las críticas. Detalle en [[mapa-codebase]] y [[roles-y-permisos]]. Rama `tarea/2-auth-supabase` (commits locales, sin push).
- **EAS:** proyecto `@deabratech/urbea` registrado; `eas.json` listo. **✅ Primer `eas build` (development, Android) hecho** — `.apk` instalado en device del cliente y **Urbea corriendo nativo** (Metro `--dev-client` + Supabase activo). Comandos en [[comandos]].
- **Sistema de trabajo:** vault Obsidian densificado ([[0003-vault-obsidian-como-memoria]]); **Taskmaster** con backlog de **20 tareas** (2 done, 18 pending), provider `claude-code/sonnet` ([[0004-taskmaster-motor-de-ejecucion]]).
- **Primer hito:** [[0005-demo-cerrada-3-semanas|demo cerrada de 3 semanas]].

## Decisiones recientes
- Alcance = demo cerrada (inmobiliarias/agentes, sin pagos). Ver [[0005-demo-cerrada-3-semanas]].
- Monetización elegida pero **latente**: [[0002-monetizacion-pago-por-video]].
- Auth: **solo login** en la app (cuentas sembradas); registro por invitación queda en tarea #3.

## Pendiente inmediato (detalle en Taskmaster)
- **Next: #3** (Supabase Storage bucket para videos + RLS) — `task-master next`.
- **Branding (#19): en pausa** hasta indicación del cliente.
