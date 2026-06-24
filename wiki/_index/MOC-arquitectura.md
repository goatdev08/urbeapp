---
tipo: moc
dominio: arquitectura
---

# 🧭 MOC Arquitectura

Stack, capas y lineamientos. Fuente: `docs/lineamientos-desarrollo.md`. Schema operativo: `CLAUDE.md` (raíz).

## Stack (demo)
- 🔴 **Gestor de paquetes y dev server: PNPM siempre** (nunca npm/yarn).
- App: React Native + Expo, **development build** (`expo-dev-client`), Expo Router, TS strict.
- Backend: **Supabase** remoto (`urbea-app`).
- Video: **Supabase Storage** (sin transcoding en la demo).
- Mapas: `react-native-maps` + Google Maps. Video: `expo-video`.

## Capas (lineamientos)
- Lógica de negocio → **Edge Functions** (validación → autorización → lógica → persistencia).
- RLS → 2ª capa de seguridad, no la primera. Ver [[rls-seguridad]].
- Triggers → solo atómicos (updated_at, integridad). Nada de orquestación.
- Cliente → UI, validaciones UX, navegación.

## Puente al código
- [[mapa-codebase]] — concepto → archivos
- [[db-schema-map]] — tabla → migración

## Ejecución
- [[0004-taskmaster-motor-de-ejecucion]] — Taskmaster + CLI · schema en `CLAUDE.md`
- [[0006-workflow-ejecucion-tareas]] — el loop de ejecución (update-subtask como bitácora) + PNPM
- [[0007-workflow-multiagente]] — agentes por dominio (mobile/supabase/design), TDD (test-author/guardian), comandos `/tm-plan`·`/tm-tarea`·`/tm-status`

Ver también: [[MOC-producto]] · [[MOC-datos]] · [[MOC-fuentes]]
