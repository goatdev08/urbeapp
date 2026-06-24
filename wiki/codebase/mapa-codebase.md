---
tipo: codebase
actualizado: 2026-06-17
---

# Mapa del codebase

**Pieza clave del vault:** dominio/concepto → archivos exactos. Consultar ANTES de escribir código (¿ya existe algo reutilizable?). Reemplaza `grep`.

## Backend — Supabase (existe)
Detalle de tablas/migraciones en [[db-schema-map]].

| Dominio | Archivos | Concepto |
|---------|----------|----------|
| Identidad | `supabase/migrations/..._identity_users.sql` | [[roles-y-permisos]] |
| Inmobiliarias/Agentes | `..._agencies_and_agents.sql` | [[inmobiliarias-y-agentes]] |
| Propiedades/Video | `..._properties_and_videos.sql` | [[propiedades-y-video]] |
| Engagement/CRM | `..._engagement_crm.sql` | [[crm-leads]], [[feed-vertical-video]] |
| Moderación/Analítica | `..._analytics_moderation_audit.sql` | [[moderacion]], [[notificaciones]] |
| RLS/Seguridad | `..._rls_helpers_and_policies.sql`, `..._security_perf_hardening.sql` | [[rls-seguridad]] |
| Legal | `..._user_profile_legal.sql` | [[legal-consentimientos]] |
| Tests | `supabase/tests/01_constraints_test.sql`, `02_rls_test.sql` | [[rls-seguridad]] |

## Documentación de producto
| Concepto | Fuente |
|----------|--------|
| [[feed-vertical-video]] | `docs/PRD.md` §9 |
| [[propiedades-y-video]] | `docs/PRD.md` §12-13 |
| [[roles-y-permisos]] | `docs/PRD.md` §4 |
| [[crm-leads]] | `docs/PRD.md` §19 |
| [[monetizacion-pago-por-video]] | `docs/PRD.md` §17 |
| Alcance demo | `docs/PRD-MVP-demo.md` |
| Lineamientos | `docs/lineamientos-desarrollo.md` |

## App móvil — `mobile/` (inicializada · tarea #1)
Base **existe** (Expo SDK 56, dev build, Expo Router, TS strict, standalone). Lo ya construido:
- `mobile/app.config.ts` — config dinámica: `com.urbea.app` (iOS+Android), slug/scheme `urbea`, owner EAS `deabratech`, Google Maps vía `process.env.GOOGLE_MAPS_API_KEY`, plugins (expo-dev-client/router/video). projectId EAS `85c7157a-…`.
- `mobile/eas.json` — perfiles `development`/`preview`/`production`. Proyecto EAS: `@deabratech/urbea`.
- `mobile/.npmrc` — `node-linker=hoisted` (gotcha Metro+pnpm). `mobile/.env.local` (gitignored) con credenciales Supabase; `.env.example` con nombres.
- `mobile/app/_layout.tsx` (Stack + SafeAreaProvider) · `mobile/app/index.tsx` (placeholder "Urbea").
- `mobile/src/lib/supabase/client.ts` — **cliente Supabase tipado** `createClient<Database>` + AsyncStorage (hotspot global; smoke test 200 OK contra remoto) → [[rls-seguridad]].
- `mobile/src/types/database.ts` — re-export de `supabase/types/database.types.ts`.
- `mobile/tsconfig.json` — strict (+ noUncheckedIndexedAccess, exactOptionalPropertyTypes), alias `@/*`→`src/*`.

Estructura prevista por feature (carpetas `src/{features,components,theme,hooks}` ya creadas, vacías):
- `src/features/auth/` — login, canje de código → [[roles-y-permisos]], [[inmobiliarias-y-agentes]]
- `src/features/onboarding/` → [[onboarding-y-preferencias]]
- `src/features/feed/` — feed vertical → [[feed-vertical-video]]
- `src/features/search/` — filtros → [[busqueda-y-filtros]]
- `src/features/map/` — mapa → [[mapa-y-ubicacion]]
- `src/features/publish/` — wizard 3 pasos + subida video → [[propiedades-y-video]]
- `src/features/leads/` — CRM → [[crm-leads]]
- `src/features/profile/` — perfil
- `src/features/admin/` — alta de inmobiliarias → [[inmobiliarias-y-agentes]]
- `src/lib/supabase/` — cliente tipado · `src/components/` · `src/theme/`

## Edge Functions — `supabase/functions/` (pendiente)
- `invitations/` — canje atómico de código → [[inmobiliarias-y-agentes]]
- `properties/` — publicación (validación) → [[propiedades-y-video]]
- `leads/` — contacto → creación de lead → [[crm-leads]]
- `_shared/` — auth, validación, respuestas, logging con correlation_id → [[rls-seguridad]]
