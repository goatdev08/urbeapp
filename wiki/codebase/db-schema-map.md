---
tipo: codebase
actualizado: 2026-06-17
---

# Mapa del esquema de datos

Cada tabla → migración que la crea → concepto del vault. Fuente: `supabase/migrations/`.
Proyecto live `urbea-app` (`mvpvqmyhrrkwbnpctpuq`). 20 tablas, migraciones `0001`–`0010`.

## Migraciones
| # | Archivo | Qué hace |
|---|---------|----------|
| 0001 | `..._extensions_and_enums.sql` | extensiones (postgis, pg_trgm, citext) + ~20 enums + `set_updated_at()` |
| 0002 | `..._identity_users.sql` | `users` + trigger `handle_new_user` |
| 0003 | `..._agencies_and_agents.sql` | `agencies`, `agency_invitation_tokens`, `agency_members`, `agent_applications`, `agent_interest_submissions` |
| 0004 | `..._user_profile_legal.sql` | `user_preferences`, `terms_versions`, `user_consents`, `account_deletion_requests` |
| 0005 | `..._properties_and_videos.sql` | `properties`, `property_videos` + triggers (máx 5 videos, cascade soft-delete) |
| 0006 | `..._engagement_crm.sql` | `likes`, `saves`, `leads`, `lead_origin_properties` |
| 0007 | `..._analytics_moderation_audit.sql` | `events_raw`, `property_reports`, `notifications`, `admin_actions` |
| 0008 | `..._rls_helpers_and_policies.sql` | helpers RLS en `public` + ~65 políticas |
| 0009 | `..._seed_terms.sql` | seed de términos/privacidad v1 |
| 0010 | `..._security_perf_hardening.sql` | helpers a schema `private`, re-políticas con `(select auth.uid())`, blindaje de triggers, +11 índices FK |

## Tablas por dominio
| Tabla | Migración | Concepto | Demo |
|-------|-----------|----------|------|
| `users` | 0002 | [[roles-y-permisos]] | vivo |
| `user_preferences` | 0004 | [[onboarding-y-preferencias]] | vivo |
| `terms_versions`, `user_consents` | 0004 | [[legal-consentimientos]] | vivo (mínimo) |
| `account_deletion_requests` | 0004 | [[legal-consentimientos]] | diferido |
| `agencies` | 0003 | [[inmobiliarias-y-agentes]] | vivo |
| `agency_members` | 0003 | [[inmobiliarias-y-agentes]] | vivo |
| `agency_invitation_tokens` | 0003 | [[inmobiliarias-y-agentes]] | vivo (código de invitación) |
| `agent_applications` | 0003 | [[inmobiliarias-y-agentes]] | diferido |
| `agent_interest_submissions` | 0003 | [[inmobiliarias-y-agentes]] | diferido |
| `properties` | 0005 | [[propiedades-y-video]] | vivo |
| `property_videos` | 0005, 0011 (`storage_path`) | [[propiedades-y-video]] | vivo |
| `likes` | 0006 | [[feed-vertical-video]] | vivo |
| `saves` | 0006 | [[propiedades-y-video]] | vivo |
| `leads` | 0006 | [[crm-leads]] | vivo |
| `lead_origin_properties` | 0006 | [[crm-leads]] | vivo |
| `events_raw` | 0007 | [[rls-seguridad]] | latente |
| `property_reports` | 0007 | [[moderacion]] | diferido |
| `notifications` | 0007 | [[notificaciones]] | diferido |
| `admin_actions` | 0007 | [[rls-seguridad]] | latente |

## Enums clave (0001)
- `user_role`: user, agent, admin
- `agency_status`: pending_approval, approved, active, suspended, rejected
- `agency_member_role`: owner, agent
- `property_type`: casa, departamento, local, oficina, terreno
- `operation_type`: rent, sale, both
- `property_status`: draft, pending_review, needs_changes, active, paused, closed, suspended
- `property_video_status`: uploading, processing, ready, failed
- `lead_status`: new, contacted, in_progress, visit_scheduled, closed_won, closed_lost, discarded

## Nota para la demo (video en Storage)
`property_videos` referencia Cloudflare Stream (`cloudflare_uid`, legacy). La demo usa **Supabase Storage** sin transcoding ([[0005-demo-cerrada-3-semanas]]): migración **0011** añadió el bucket `property-videos` + la columna `storage_path` + RLS INSERT/SELECT en `storage.objects` (ver [[propiedades-y-video]] §Storage). **No** se aplica la migración de billing.

## Seguridad
Ver [[rls-seguridad]]: RLS 2ª capa, helpers en schema `private`, grants column-level, `events_raw`/`admin_actions` solo `service_role`.
