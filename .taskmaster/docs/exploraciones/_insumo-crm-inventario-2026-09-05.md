# Insumo — Inventario del CRM actual (2026-09-05)

Preparado para el `/tm-explore` del rediseño visual del CRM (diseño de Santiago, artifact `986b0ab8…`, HTML pendiente de bajar).
No es una exploración: es la foto del código y del backend que la exploración debe cruzar contra el diseño.

## 1. Pantallas
| Ruta | Archivo | Contenido |
|---|---|---|
| `/(protected)/(tabs)/crm` | `mobile/app/(protected)/(tabs)/crm.tsx:17-35` | Guard de rol (agent/admin) → `CRMScreen` |
| — | `mobile/src/features/leads/screens/CRMScreen.tsx` (575 L) | Header · buscador client-side · `AgentSelector` (si canViewTeam) · `FilterTabs` Todos/Nuevos/En progreso/Cerrados (L91-96) · sección fija "En seguimiento" capada a 5 (L137, 352-371) · `FlatList` de `LeadCard` sin paginación (L330-405) · vacíos L374-390 |
| Detalle | `mobile/src/features/leads/components/LeadExpandedView.tsx` (1025 L) | Bottom-sheet: Actividad (`ActionStatsBar`) · Cambiar estado (8 vigentes, L436-480) · Notas + Guardar (L500-536) · Historial capado a 5 (L79, 543-572) · Ver propiedad / WhatsApp (L576-610) |
| Fila | `LeadCard.tsx` | avatar · nombre · dirección origen · badge estado · `format_relative_time(updated_at)` · `ActionStatsBar` compacta · thumbnail 56px |
| Perfil (stats) | `profile.tsx` → `ProfessionalStats.tsx` | 3 números |
| Mis publicaciones | `profile/my-listings.tsx` → `useMyProperties.ts` | contadores por publicación |
| Dashboard anuncios | `ads/[id].tsx` + `useAdStats.ts` | referencia visual de dashboard (no es CRM) |

## 2. Hooks
| Hook | Fuente | Paginación | Agregados en cliente | Deps |
|---|---|---|---|---|
| `useAgentLeads.ts` | `leads` + embeds users / lead_origin_properties→properties→property_videos (L249-258) | ninguna | `pick_thumbnail` (L113-118) | L311 |
| `useLeadStats.ts` | RPC `get_lead_stats(uuid[])` (L85-87) | batch único | mapa by_lead_id | `[lead_ids_key]` |
| `useLeadStatusHistory.ts` | `lead_status_history.select('*')` (L47) | ninguna | — | query por lead abierto, sin caché |
| `useAgencyRole.ts` / `useAgencyAgents.ts` | `agency_members` | — | orden en JS | — |
| `useUpdateLeadStatus.ts` / `useUpdateLeadNote.ts` | EFs | — | — | `refetch()` completo al éxito |
| `useAgentStats.ts` | 2× `properties` | ninguna | `reduce` de save/like_count (L105-111) | — |
| `useMyProperties.ts` | `properties` + videos | ninguna | `video_count` | mount |

## 3. Backend
- `leads` (`20260604000006` + is_follow_up `20260807000003`, score/level `…000004`, agency_id `…000006`): RLS select `agent_id = uid OR agency_role_of IN (owner, admin)` (`20260901000001:45-50`). Índices: `leads_agent_crm_idx (agent_id,status,last_contact_at desc)`, `leads_agency_idx`, `leads_user_active_idx`. **Ninguno sirve `order by score desc`** (el default de `useAgentLeads.ts:283`).
- `lead_origin_properties`, `lead_status_history` (append-only por trigger; `changed_by` siempre NULL, deuda #108), `events_raw` (video_view / video_completed; select vía `can_view_user_events`), `likes`, `saves`, `properties.{like,save,view,contact}_count`.
- RPC `get_lead_stats` (`20260808000002`): `{vio_completo, veces_visto, guardo, ultima_actividad}`; gate = like sobre la propiedad de origen.
- EFs: `contact-agent` (crea lead; `increment_contact_count` read-then-write no atómico, `index.ts:85-100`), `update-lead-status`, `update-lead-note`.

## 4. Métricas: dónde se calculan
Backend: score, level, vio_completo/veces_visto/guardo/ultima_actividad, like_count/save_count, contact_count (no atómico), publications (count head).
Cliente: conteo por tab (`CRMScreen.tsx:126-132`), búsqueda (177-180), "En seguimiento" (+N) (186-200), "hace X" (`utils/relative_time.ts`), "Volvió a ver" (`ActionStatsBar.tsx:75`), saves/likes del perfil (`useAgentStats.ts:105-111`), video_count.
Muerto: `properties.view_count` — nadie lo escribe (`20260604000005:35`; se pinta en `PropertyListItem.tsx:242`).

## 5. Señales de comportamiento disponibles
- `events_raw.video_view` (sin umbral de tiempo; dedupe por sesión+propiedad) → "veces que volvió" por sesión.
- `events_raw.video_completed` (≥0.95 de duración) → intención fuerte.
- `likes`, `saves` (con created_at) · `leads`+`lead_origin_properties.contacted_at` · `lead_status_history` → tiempos de ciclo.
- `events_raw.payload/device/agent_id` sin escritores ni lectores.
- NO existe: watch-time acumulado, `last_contact_at` real (nadie lo escribe), aperturas de detalle, eventos de búsqueda/filtros, retención/rollup de `events_raw` (ad_impressions sí lo tiene).

## 6. Deuda de eficiencia (cita)
1. Sin paginación: `useAgentLeads.ts:249-288`, `CRMScreen.tsx:330`.
2. Filtros/agregados en cliente sobre lista completa: `CRMScreen.tsx:126-132, 177-180, 186-193`.
3. `select('*')` + query por lead sin caché: `useLeadStatusHistory.ts:47,69`.
4. `reduce` en cliente: `useAgentStats.ts:92,105-111`.
5. `useMyProperties.ts:82-100` sin paginación.
6. Refetch completo tras cada escritura: `CRMScreen.tsx:219-222, 419` (cascada a `useLeadStats`).
7. Sin refetch por foco (`useAgentLeads.ts:37`), inconsistente con `useAgentProfile.ts:73`.
8. `view_count` muerto. 9. `increment_contact_count` no atómico. 10. score/level escribibles por REST (#108).
11. Índice para `score desc` ausente. 12. `events_raw` sin retención. 13. `level`/`score` viajan en payload sin UI (#112).

## 7. Tests
Jest: `features/leads/__tests__/{useAgentLeads,useUpdateLeadNote,useUpdateLeadStatus,useAgencyRole,useAgencyAgents,useLeadStats,useLeadStatusHistory}.test.ts`; `components/__tests__/{LeadExpandedView,ActionStatsBar}.test.tsx`; `app/(protected)/(tabs)/__tests__/crm.test.tsx`. **Sin test de `CRMScreen` ni `LeadCard`.**
pgTAP: 08, 28, 29, 30, 31, 32, 33, 34, 35, 77, 91. Deno: contact-agent (handler/lead_repo/property_resolver), update-lead-status, update-lead-note.

## 8. Taskmaster relacionado
done: 14, 15, 28, 29, 30, 112, 113, 202, 203, 224, 226 · cancelled: 31 · **in-progress: 75** (Ola 1 CRM) · pending: **80** (Ola 3 métricas/events_raw/dashboards), 85 (avatares R2), 108, 109, 110, 116.
Exploraciones cercanas: `040-comercial-completo-stats-y-promocion.md` (dashboard estilo Meta), `039-cuenta-comercial-anunciantes.md`. Concepto: `wiki/conceptos/crm-leads.md`.
