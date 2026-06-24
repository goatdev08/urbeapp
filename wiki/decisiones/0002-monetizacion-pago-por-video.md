---
tipo: decision
estado: aceptada
fecha: 2026-06-17
---

# 0002 — Monetización: pago por video / créditos

## Contexto
El análisis de mercado (`docs/propuesta-cliente/02-analisis-de-mercado-y-modelo-de-negocio.md`) sugería un modelo de suscripción híbrido. El PRD §17 define el modelo original: pago por video / créditos.

## Decisión
La monetización es **pago por video / créditos** (PRD §17), **no** suscripción. Planes: Premium $399 MXN/mes (1 video); Agente 3m $1,197; 6m $1,194; crédito caduca a 90 días; Stripe **post-beta**. El modelo de datos (PRD §17.7): `purchase` + `video_slot` + enlace a `property_video`.

## Estado en la demo
**Latente / diferido.** La demo NO incluye pagos. La migración de billing (`0011`) NO se diseña ni aplica en el hito actual ([[0005-demo-cerrada-3-semanas]]); se retomará post-validación.

## Alternativas consideradas
- Suscripción híbrida (análisis de mercado) — rechazada por decisión de negocio.

## Consecuencias
- Infra de pagos queda como fase posterior; la DB actual ya excluye pagos a propósito.

## Enlaces
- Conceptos: [[monetizacion-pago-por-video]]
- Fuente: docs/PRD.md §17
