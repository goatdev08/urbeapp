---
tipo: concepto
dominio: producto
estado: diferido
fuentes: [docs/PRD.md §15 §18, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/0007_analytics_moderation_audit.sql]
actualizado: 2026-06-17
---

# Moderación

> Cola de revisión y reportes de contenido. En la demo se simplifica a **auto-aprobar**.

## En el PRD (diferido)
- Estados de publicación con revisión: `pending_review` → `needs_changes` / `active`; **re-revisión** cuando cambian campos críticos (dirección, tipo de operación, tipo de propiedad, video, descripción, precio).
- **`property_reports`** — `reason` (not_exist_fraud, misleading, false_price, wrong_address, inappropriate, duplicate, other), `status` (new, reviewing, resolved, dismissed); 🔒 1 reporte por (property, user). Auto-suspensión a 3 reportes/24h (PRD; **no** en MVP).

## En la demo
- **diferido.** **Auto-aprobar**: la propiedad queda `active` al publicar; sin cola de revisión ni reportes. La infra (`property_reports`, estados de `properties`) existe pero no se usa el flujo.

## Detalle exhaustivo
- `docs/PRD.md` §15 (estados, re-revisión), §18 (reportes) · migración `0007` (`property_reports`) · [[db-schema-map]]

## Relacionados
[[propiedades-y-video]] · [[rls-seguridad]] · [[notificaciones]]
