---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §19, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/0006_engagement_crm.sql, supabase/functions/contact-agent/, supabase/functions/update-lead-status/, mobile/src/components/ContactAgentButton.tsx, mobile/src/features/property-detail/utils/whatsapp.ts, mobile/src/features/leads/]
actualizado: 2026-06-30
---

# CRM y leads

> Contactar a un agente crea un lead; el agente lo gestiona por un embudo de estados. Gancho clave para inmobiliarias.

## Modelo de datos (migración 0006)
- **`leads`** — `agent_id`, `user_id`, `status` (`lead_status`: **new, contacted, in_progress, visit_scheduled, closed_won, closed_lost, discarded**), `deleted_at`.
  - 🔒 `agent_id ≠ user_id` (CHECK, no self-lead).
  - 🔒 **1 lead por par (agent_id, user_id)** activo → índice único parcial `WHERE deleted_at IS NULL` (reutilizable tras soft-delete).
  - 🔒 **El buscador NO ve el lead** (RLS): solo el agente dueño y el owner de su inmobiliaria.
- **`lead_origin_properties`** — de qué vino el contacto: `lead_id`, `property_id`, `property_video_id` (nullable).

## Flujo (demo) — vivo (#14)
Contacto desde el **detalle** de una propiedad → CTA sticky **"Contactar por WhatsApp"** (`ContactAgentButton`) llama la **Edge Function `contact-agent`**, que: valida (JWT, propertyId UUID) → resuelve propiedad+agente → corta self-contact → crea/recupera el lead (idempotente por par) → inserta `lead_origin_properties` → incrementa `contact_count` **solo si el origin fue nuevo** → devuelve `{ success, phone, message, lead_id, property_id }`. El cliente abre el **deep link** `whatsapp://send?phone=&text=` (fallback `wa.me`) y confirma con `Alert` nativo.

## Pantalla CRM del agente — vivo (#15)
El agente abre el **tab CRM** (oculto a no-agentes vía `user.role === 'agent'` + `<Redirect>` en la ruta — RLS/EF son la capa real de seguridad) y ve la **lista de sus leads** (`useAgentLeads`: query `from('leads')` con embeds `users(phone, user_preferences(full_name, profile_photo_url))` + `lead_origin_properties→properties→property_videos`; RLS filtra `agent_id`; `.is('deleted_at', null)`; orden `updated_at` DESC). Cada **`LeadCard`** muestra avatar+nombre del interesado, **badge de estado** (color por estado del enum), thumbnail de la propiedad de origen y tiempo relativo. **Filtros** (tabs: Todos / Nuevos / En progreso / Cerrados) y **búsqueda por nombre** son **client-side** (`useMemo` en cascada sobre los leads ya cargados — sin re-query). Tap en un card → **`LeadExpandedView`** (Modal bottom-sheet RN nativo) con: **selector de los 7 estados** (ofrece todos; la EF valida la transición y muestra el error inline), **textarea de notas internas**, botón **"Ver propiedad"** (`router.push('/property/[id]')`) y botón **WhatsApp** (reusa `open_whatsapp(phone, address)` con el `lead.phone`). Al elegir un estado, `useUpdateLeadStatus` llama la **EF `update-lead-status`** (`{lead_id, new_status, note?}`); en éxito → `refetch` + cierra el modal.

## Reglas / gotchas
- **EF es `contact-agent/`** (no `leads/` como decía el PRD). Desplegada al remoto con `--import-map` (gotcha de [[mapa-codebase]]). Auth obligatoria (401 sin JWT).
- **Idempotencia en 2 capas:** índice único parcial en `leads` (par activo) + `ON CONFLICT (lead_id,property_id) DO NOTHING` en `lead_origin_properties`. El `contact_count` cuenta **contactos únicos lead↔propiedad, no taps** (increment solo si el origin fue fila nueva). Race de insert lead → 23505 → recuperar el existente, no 500.
- **Self-contact** (`caller == owner`) → 400 `CANNOT_CONTACT_SELF` (respalda el CHECK `agent_id ≠ user_id`). `agent_id ≡ owner_user_id` (alias sintético del resolver: `u.id AS agent_id ON owner_user_id = u.id`).
- **Teléfono obligatorio:** agente sin `users.phone` → 400 `AGENT_PHONE_MISSING`; el CTA se oculta si ya se sabe que no hay phone. Los agentes demo se sembraron con phone en migración `20260630000001` (#14.8).
- **`increment_contact_count` es read-then-write** (2 queries, no atómico) — `// ponytail:` con RPC como alternativa para prod (PostgREST no admite `col = col + 1` en PATCH).
- **Sin scoring automático** en la demo (el PRD lo contempla; aquí va diferido).
- **EF `update-lead-status` (#15.6, desplegada 2026-06-30)** — POST `{lead_id, new_status, note?}` (JWT del agente). Smoke remoto OK (401 sin auth, 200 OPTIONS). Valida que `new_status` ∈ enum y que la **transición** sea válida; persiste `status`+`updated_at`, y `internal_notes` **solo si viene `note`** (spread condicional, no sobrescribe con null). Ownership por doble query (`LEAD_NOT_FOUND` vs `UNAUTHORIZED_AGENT`). Códigos: `INVALID_INPUT`/`INVALID_TRANSITION`/`UNAUTHENTICATED`/`UNAUTHORIZED_AGENT`/`LEAD_NOT_FOUND`/`DB_ERROR`. Patrón DI clonado de `update-property-status/` (handler + `make_lead_status_updater` + 55 Deno tests). Deploy con `--import-map`.
- **Transiciones válidas del embudo:** `new→{contacted,discarded}` · `contacted→{in_progress,closed_lost,discarded}` · `in_progress→{visit_scheduled,closed_won,closed_lost,discarded}` · `visit_scheduled→{in_progress,closed_won,closed_lost,discarded}` · `closed_won`/`closed_lost`/`discarded` = **terminales** (sin salidas).
- ⚠️ **La nota viaja ACOPLADA a una transición de estado** (la EF `update-lead-status` toma `note` junto a `new_status`). No hay aún forma de editar `internal_notes` sin cambiar estado → diferido a **tarea #29** (`update-lead-note`).
- **Filtros y búsqueda son client-side** (la lista completa del agente se carga una vez por `useAgentLeads`; tabs+search filtran con `useMemo`, no re-query). El filtro "En progreso" agrupa `{contacted, in_progress, visit_scheduled}`; "Cerrados" agrupa `{closed_won, closed_lost, discarded}`.
- **Owner ve los leads de sus agentes** — alcance **diferido a tarea #28** (la RLS `can_view_lead` ya lo permite a nivel DB; la UI de #15 muestra solo los leads propios del agente).
- ✅ **E2E happy-path verificado en remoto (2026-06-30):** con un 2º agente sembrado (propiedad activa propia), el agente principal la contactó → lead `new` creado; 2º tap → mismo `lead_id`, `contact_count=1` (no 2). Antes solo se cubría por los 79 unit tests + negativos, porque el único `auth.users` era dueño de todas las propiedades (todo daba self-contact).
- Visibilidad por RLS: helpers `can_view_lead` / `can_edit_lead` ([[rls-seguridad]]).
- ⚠️ Existe un 2º camino de WhatsApp **sin CRM**: el icono de `AgentCard` (`open_whatsapp`) es contacto rápido directo; el canal CRM es el CTA sticky.

## En el código
- Backend: `0006_engagement_crm.sql` + EF `supabase/functions/contact-agent/` (`index.ts` cablea resolvers reales; `handler.ts` lógica pura con DI; `handler.test.ts` **79 tests**). Seed phone `20260630000001_seed_demo_agent_phone.sql`.
- App contacto: `mobile/src/components/ContactAgentButton.tsx` (reusa `PrimaryButton`, mapea errores ES) + `mobile/src/features/property-detail/utils/whatsapp.ts` (`open_whatsapp_ef`) cableado en `PropertyDetailScreen.tsx`.
- App CRM (#15, vivo): `mobile/src/features/leads/` — `screens/CRMScreen.tsx` (lista + tabs + búsqueda + modal), `hooks/useAgentLeads.ts` (query+transform, 10 tests), `hooks/useUpdateLeadStatus.ts` (**CRÍTICA**, invoca la EF, 13 tests, patrón `usePropertyActions`), `components/LeadCard.tsx`, `components/LeadExpandedView.tsx`, `lead_status_meta.ts` (mapa compartido estado→etiqueta/color), `types.ts` (`AgentLead`/`LeadStatus`). Ruta: `mobile/app/(protected)/(tabs)/crm.tsx` + tab en `_layout.tsx`. Genérico reutilizado: `mobile/src/components/FilterTabs.tsx` (extraído de profile). Backend CRM: `supabase/functions/update-lead-status/` (handler DI + `make_lead_status_updater`, 55 Deno tests).

## Detalle exhaustivo
- `docs/PRD.md` §19 (embudo de 9 estados + scoring, para fases futuras) · migración `0006` · [[db-schema-map]]

## Relacionados
[[feed-vertical-video]] · [[propiedades-y-video]] · [[inmobiliarias-y-agentes]] · [[rls-seguridad]]
