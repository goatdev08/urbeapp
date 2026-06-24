---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §9, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/0005_properties_and_videos.sql]
actualizado: 2026-06-17
---

# Mapa y ubicación

> Dirección exacta SIEMPRE visible (decisión de cliente) + mapa interactivo con clustering.

## Cómo funciona
- `properties.location` = PostGIS `Point(4326)`; `address` exacto y público (diferenciador vs competencia, que muestra ubicación aproximada).
- En la demo: **mapa global** con pines + **clustering**; tocar un pin → detalle de la propiedad.

## Reglas / gotchas (técnico)
- ⚠️ `react-native-maps` con **Google Maps nativo** → requiere **development build** (`expo-dev-client`), **no** Expo Go. Esta es la razón principal del dev build ([[0005-demo-cerrada-3-semanas]]).
- Clustering en cliente (agrupar pines por zoom).
- **Fallback** si aprieta el tiempo: mini-mapa solo en el detalle (sin pantalla global).

## Detalle exhaustivo
- `docs/PRD.md` §9 (mapa, radio, dirección exacta) · migración `0005` (`properties.location`) · [[db-schema-map]]

## Relacionados
[[feed-vertical-video]] · [[propiedades-y-video]] · [[busqueda-y-filtros]]
