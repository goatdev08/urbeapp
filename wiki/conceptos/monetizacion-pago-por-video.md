---
tipo: concepto
dominio: negocio
estado: latente
fuentes: [docs/PRD.md §17]
codigo: []
actualizado: 2026-06-17
---

# Monetización: pago por video

> El modelo de negocio elegido: pagar por publicar video / créditos. **Apagado** en la demo.

## El modelo (PRD §17)
- **Planes:** Premium **$399 MXN/mes** (1 video); Agente **3m $1,197**; **6m $1,194**.
- **Crédito caduca a 90 días.** Precios en **tabla configurable**, no en código.
- **Métodos de pago** (PRD): card, apple_pay, google_pay, oxxo, spei. **Stripe post-beta**.
- **Modelo de datos (PRD §17.7):** `purchase` + `video_slot` + enlace a `property_video`. Idempotencia de webhooks Stripe vía `external_events_received`.

## En la demo
- **latente.** La demo es **gratis**; no hay pagos. La **migración de billing (`0011`) NO se diseña ni aplica** todavía (decisión [[0002-monetizacion-pago-por-video]]). Se retoma post-validación.

## Por qué este modelo (no suscripción)
El análisis de mercado sugería suscripción híbrida; se **rechazó** por decisión de negocio a favor del pago-por-video original. Ver [[0002-monetizacion-pago-por-video]] y `docs/propuesta-cliente/02-...`.

## Detalle exhaustivo
- `docs/PRD.md` §17 (planes, créditos, modelo de datos) · [[MOC-negocio]]

## Relacionados
[[0002-monetizacion-pago-por-video]] · [[propiedades-y-video]] · [[roles-y-permisos]]
