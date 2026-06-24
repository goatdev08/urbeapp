---
tipo: estado
actualizado: 2026-06-23
---

# Estado actual

> Narrativa de "dónde estamos hoy". El **qué sigue / qué está hecho** vive en **Taskmaster** (`task-master list`), no aquí.

## Hoy (2026-06-23)

- **Documentación:** madura (`docs/`), incluido el [[0001-alcance-mvp-recomendado|MVP recomendado]] y el PRD oficial completo. Alcance de la demo en `docs/PRD-MVP-demo.md`.
- **Base de datos:** Supabase migrada y endurecida — 20 tablas, RLS, tests pgTAP; migraciones `0001`–`0010` aplicadas al proyecto live `urbea-app` (`mvpvqmyhrrkwbnpctpuq`). Ver [[db-schema-map]].
- **Código de app:** **¡arrancó!** Tarea **#1 cerrada** — `mobile/` inicializada (Expo SDK 56, dev build, Expo Router, TS strict), deps nativas (maps, video), y **cliente Supabase tipado conectado al remoto** (smoke test 200 OK). Detalle en [[mapa-codebase]]. Rama `tarea/1-init-expo-mobile` (commits locales, sin push).
- **EAS:** proyecto `@deabratech/urbea` registrado; `eas.json` listo. **✅ Primer `eas build` (development, Android) hecho** — `.apk` instalado en device del cliente y **Urbea corriendo nativo** (Metro `--dev-client` + Supabase activo). Comandos en [[comandos]].
- **Sistema de trabajo:** vault Obsidian densificado ([[0003-vault-obsidian-como-memoria]]); **Taskmaster** con backlog de **20 tareas** (1 done, 19 pending), provider `claude-code/sonnet` ([[0004-taskmaster-motor-de-ejecucion]]).
- **Primer hito:** [[0005-demo-cerrada-3-semanas|demo cerrada de 3 semanas]].

## Decisiones recientes
- Alcance = demo cerrada (inmobiliarias/agentes, sin pagos). Ver [[0005-demo-cerrada-3-semanas]].
- Monetización elegida pero **latente**: [[0002-monetizacion-pago-por-video]].

## Pendiente inmediato (detalle en Taskmaster)
- **Next: #2** (Supabase Auth en mobile) — desbloqueada al cerrar #1. `task-master next`.
- **Branding (#19): en pausa** hasta indicación del cliente.
