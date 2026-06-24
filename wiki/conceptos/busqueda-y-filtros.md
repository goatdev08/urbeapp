---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §9-12, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/0005_properties_and_videos.sql]
actualizado: 2026-06-17
---

# Búsqueda y filtros

> Encontrar propiedades por criterios; en la demo, filtros básicos sobre el feed/mapa.

## En la demo (filtros básicos)
- **operación** (rent/sale/both) · **tipo** (casa, departamento, local, oficina, terreno) · **zona/ciudad** · **rango de precio**.
- Mapean directo a columnas de `properties` (`operation_type`, `property_type`, `price`, `location`/ciudad).

## Diferido (PRD completo)
Recámaras, baños, m², amueblado, `pet_friendly`, `allows_no_guarantor`, `student_friendly`, búsqueda fuzzy por texto (pg_trgm).

## Reglas / gotchas
- 🔒 Lineamiento: **no `ILIKE '%texto%'` sin índice**; usar índices apropiados (pg_trgm ya está habilitado en `0001`).
- Filtrar siempre sobre `status='active'` (visibilidad pública vía [[rls-seguridad]]).
- Paginación cursor-based en listados.

## Detalle exhaustivo
- `docs/PRD.md` §9-12 (filtros completos) · migración `0005` (columnas de `properties`) · [[db-schema-map]]

## Relacionados
[[feed-vertical-video]] · [[mapa-y-ubicacion]] · [[propiedades-y-video]]
