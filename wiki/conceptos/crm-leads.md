---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §19, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/0006_engagement_crm.sql]
actualizado: 2026-06-17
---

# CRM y leads

> Contactar a un agente crea un lead; el agente lo gestiona por un embudo de estados. Gancho clave para inmobiliarias.

## Modelo de datos (migración 0006)
- **`leads`** — `agent_id`, `user_id`, `status` (`lead_status`: **new, contacted, in_progress, visit_scheduled, closed_won, closed_lost, discarded**), `deleted_at`.
  - 🔒 `agent_id ≠ user_id` (CHECK, no self-lead).
  - 🔒 **1 lead por par (agent_id, user_id)** activo → índice único parcial `WHERE deleted_at IS NULL` (reutilizable tras soft-delete).
  - 🔒 **El buscador NO ve el lead** (RLS): solo el agente dueño y el owner de su inmobiliaria.
- **`lead_origin_properties`** — de qué vino el contacto: `lead_id`, `property_id`, `property_video_id` (nullable).

## Flujo (demo)
Contacto desde una propiedad → botón **"WhatsApp"** abre el deep link con mensaje prellenado **y** crea el lead (+ `lead_origin_properties`) vía **Edge Function** `leads/` (idempotente por par). El agente ve **lista + estados** y puede mover cada lead por el embudo.

## Reglas / gotchas
- **Sin scoring automático** en la demo (el PRD lo contempla; aquí va diferido).
- Visibilidad por RLS: helpers `can_view_lead` / `can_edit_lead` ([[rls-seguridad]]).

## En el código
- Backend: `0006_engagement_crm.sql`. App: `mobile/src/features/leads/` (pendiente). Edge Function `leads/`.

## Detalle exhaustivo
- `docs/PRD.md` §19 (embudo de 9 estados + scoring, para fases futuras) · migración `0006` · [[db-schema-map]]

## Relacionados
[[feed-vertical-video]] · [[propiedades-y-video]] · [[inmobiliarias-y-agentes]] · [[rls-seguridad]]
