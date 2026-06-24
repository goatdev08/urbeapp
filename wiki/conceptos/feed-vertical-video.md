---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §9, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/0006_engagement_crm.sql]
actualizado: 2026-06-17
---

# Feed vertical de video

> El diferenciador central de Urbea: descubrir propiedades como en TikTok — video a pantalla completa, swipe vertical.

## Cómo funciona
- Feed inmersivo de videos verticales de propiedades activas; reproducción automática al entrar en pantalla.
- **Reglas del PRD §9:**
  - **Radio progresivo:** 2 → 5 → 10 → 20 km (se expande si no hay resultados).
  - 🔒 **Anti-clustering:** mínimo **5 videos de otras propiedades** entre dos videos de la misma propiedad.
  - Métricas: "video visto" (criterio definido) y "video completado" (100% reproducido) alimentan el scoring (diferido en demo).

## En la demo
- **vivo.** Feed vertical con `expo-video`, swipe, autoplay. Lo consumen los propios agentes. Filtros básicos ([[busqueda-y-filtros]]). Interacción: like + guardar.
- El radio progresivo y el anti-clustering se simplifican (pocas propiedades semilla); se respetan si el orden lo permite.

## Datos / técnico
- `likes` (`user_id`, `property_video_id`, único). Videos de [[propiedades-y-video]] (`status='ready'`).
- ⚠️ **Lo más delicado del front:** reproducción fluida al swipe → precargar el siguiente, pausar/liberar los fuera de pantalla; lista paginada (FlashList) + `expo-video`. Requiere **dev build** ([[0005-demo-cerrada-3-semanas]]).

## Detalle exhaustivo
- `docs/PRD.md` §9 (feed, radio, anti-clustering) · migración `0006` (`likes`) · [[db-schema-map]]

## Relacionados
[[propiedades-y-video]] · [[busqueda-y-filtros]] · [[mapa-y-ubicacion]] · [[crm-leads]]
