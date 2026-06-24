---
tipo: estado
actualizado: 2026-06-24
---

# Estado actual

> Narrativa de "dónde estamos hoy". El **qué sigue / qué está hecho** vive en **Taskmaster** (`task-master list`), no aquí.

## Hoy (2026-06-24)

- **Documentación:** madura (`docs/`), incluido el [[0001-alcance-mvp-recomendado|MVP recomendado]] y el PRD oficial completo. Alcance de la demo en `docs/PRD-MVP-demo.md`.
- **Base de datos:** Supabase migrada y endurecida — 20 tablas, RLS, tests pgTAP; migraciones `0001`–`0011` aplicadas al proyecto live `urbea-app` (`mvpvqmyhrrkwbnpctpuq`). **0011 (#3): bucket Storage `property-videos` + columna `storage_path` + RLS de Storage.** Ver [[db-schema-map]] y [[propiedades-y-video]]. **Verificada: cubre el Auth de la demo sin migración nueva.**
- **Código de app:** Tareas **#1, #2 y #3 cerradas**. `mobile/` inicializada (Expo SDK 56, dev build, Expo Router, TS strict) + cliente Supabase tipado. **Auth email/password vivo** (#2): AuthContext, login, validación, mapeo de errores ES, rutas protegidas. **Solo login** (cuentas sembradas). Harness de tests jest-expo: **60 tests verdes**, TDD+guardian en las críticas. **Storage de video listo** (#3): bucket privado + RLS (agente sube a su path, lectura pública de activos), TDD pgTAP verificado contra remoto. Detalle en [[mapa-codebase]], [[roles-y-permisos]] y [[propiedades-y-video]]. Ramas `tarea/2-auth-supabase` y `tarea/3-storage-videos` (commits locales, sin push).
- **EAS:** proyecto `@deabratech/urbea` registrado; `eas.json` listo. **✅ Primer `eas build` (development, Android) hecho** — `.apk` instalado en device del cliente y **Urbea corriendo nativo** (Metro `--dev-client` + Supabase activo). Comandos en [[comandos]].
- **Sistema de trabajo:** vault Obsidian densificado ([[0003-vault-obsidian-como-memoria]]); **Taskmaster** con backlog de **20 tareas** (3 done, 17 pending), provider `claude-code/sonnet` ([[0004-taskmaster-motor-de-ejecucion]]).
- **Primer hito:** [[0005-demo-cerrada-3-semanas|demo cerrada de 3 semanas]].

## Decisiones recientes
- Alcance = demo cerrada (inmobiliarias/agentes, sin pagos). Ver [[0005-demo-cerrada-3-semanas]].
- Monetización elegida pero **latente**: [[0002-monetizacion-pago-por-video]].
- Auth: **solo login** en la app (cuentas sembradas); registro por invitación pendiente (tarea futura del backlog).
- Storage de video (#3): bucket privado + RLS dueño/lectura-pública; CORS no aplica (Supabase lo sirve a nivel gateway; nativo no lo exige).

## Pendiente inmediato (detalle en Taskmaster)
- **Next: #4** — `task-master next`.
- **Branding (#19): en pausa** hasta indicación del cliente.
