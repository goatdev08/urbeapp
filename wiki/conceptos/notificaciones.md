---
tipo: concepto
dominio: producto
estado: diferido
fuentes: [docs/PRD.md, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/0007_analytics_moderation_audit.sql]
actualizado: 2026-06-17
---

# Notificaciones

> Centro in-app + push. En la demo, fuera de alcance.

## En el PRD (diferido)
- **19 tipos** de notificaciones push (FCM Android / APNs iOS): aprobación/rechazo de publicación, nuevos leads, expiración de crédito/video, etc.
- **`notifications`** — centro in-app. `type` (text, catálogo evolutivo), retención 30 días, contenido **inmutable** por el usuario (solo `read_at`).

## En la demo
- **diferido.** Sin push (el dev build podría soportarlo, pero queda fuera por tiempo).
- **Posible stretch:** aviso in-app de "nuevo lead" al agente, si sobra tiempo en la semana 3.

## Detalle exhaustivo
- `docs/PRD.md` (catálogo de 19 tipos) · migración `0007` (`notifications`) · [[db-schema-map]]

## Relacionados
[[crm-leads]] · [[moderacion]]
