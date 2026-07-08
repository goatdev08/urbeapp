---
titulo: Brechas — demo actual vs PRD final
estado: vivo
actualizado: 2026-07-07
tags: [estado, alcance, prd]
---

# Brechas: demo → versión del PRD

Síntesis de la distancia entre lo que la demo hace **hoy** y lo que exige `docs/PRD.md` (v1.0, 35 secciones). Documento visual compartible: **Artifact "Urbea — De la demo al PRD"** (2026-07-07). Fuente de contraste: `docs/PRD-MVP-demo.md`, `docs/analisis-alcance.md`.

## Veredicto
- **Base reutilizable, no rewrite.** El backend de la demo ya es el stack objetivo (Supabase + PostGIS + RLS + Edge Functions) y el schema ya reserva las tablas faltantes (`notifications`, `property_reports`, `events_raw`, legal, VOH). `cloudflare_uid` ya coexiste con `storage_path` en `property_videos`.
- **Migración = aditiva (expand-contract).** Ver [[estrategia-releases]].
- **6 módulos sin construir** (solo schema): notificaciones, pagos, moderación/reportes, analítica/eventos, comentarios/follow, landing+admin web.
- **4 saltos de infra grandes:** video→Cloudflare Stream · pagos (Stripe+OXXO+SPEI) · admin web Next.js separada · push FCM/APNs.

## Brecha por área (resumen)
| Área | Hoy | Falta para PRD | Esf. |
|---|---|---|---|
| Video/feed | parcial (Storage + expo-video) | Cloudflare Stream, subida resumible, ≤5 videos/prop, anti-clustering, ranking §9.8 | XL |
| Descubrimiento/mapa | parcial (global + clustering) | radio PostGIS (RPC #40 ya existe, sin consumir), "buscar en esta zona", búsqueda por código/agente | M |
| Roles/multi-tenant | parcial (todo entra `agent`) | jerarquía registrado→premium→agente, inmobiliaria-entidad, upgrade self-service A/B | L |
| Publicación | parcial (3 pasos, auto-`active`) | 5 pasos, 16 estados, moderación manual, versionado dual, `draft`, cierre | L |
| CRM/leads | parcial (7 estados, lead auto) | 9 estados, scoring frío/tibio/caliente, historial retroactivo, CSV | M |
| Registro/auth | parcial (email+pass) | Google/Apple OAuth, OTP teléfono, LFPDPPP versionado, beta de códigos admin→usuario | L |
| Notificaciones | ❌ solo schema | centro in-app + push FCM/APNs vía Expo, catálogo ~18 eventos | L |
| Pagos | ❌ excluido | pago por video/créditos, Stripe+OXXO+SPEI, slots vigencia 90d | XL |
| Moderación/reportes | ❌ solo schema | cola manual, 3 reportes/24h→`suspended`, antifraude | M |
| Analítica | ❌ (solo contadores trigger) | `events_raw`, evento `view` ≥3s, dashboards | M |
| Admin | parcial (panel en-app, CRUD agencias) | web Next.js separada (10 pantallas), `admin_actions` inmutable | XL |
| Comentarios/follow/share | ❌ | comentarios moderados, follow a agentes, share deep link | M |
| Infra/landing | parcial | landing Astro, deep links `urbea.com/v/[id]`, Sentry/Logflare | L |

## Cabo suelto de proceso
**No existe aún el ADR** que formaliza "construir la versión del PRD / arquitectura real" (el último es `wiki/decisiones/0007`; el `0001` todavía dice que el norte es el MVP-demo). El vault y los MOC siguen describiendo el mundo "demo". → Crear `wiki/decisiones/0008-arquitectura-real-prd.md` cuando se asiente la decisión.

Relacionado: [[estrategia-releases]] · [[mapa-codebase]] · [[estado-actual]].
