---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §12-13, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/0005_properties_and_videos.sql]
actualizado: 2026-06-17
---

# Propiedades y video

> Una publicación = una propiedad con dirección exacta + hasta 5 videos verticales.

## Modelo de datos (migración 0005)
- **`properties`** — `owner_user_id`, `address` (texto exacto, **NOT NULL**, público), `location` (PostGIS `Point,4326`), `property_type` (casa, departamento, local, oficina, terreno), `operation_type` (rent, sale, both), `status` (`property_status`: **draft, pending_review, needs_changes, active, paused, closed, suspended**), `closed_reason` (rented, sold, withdrawn, expired), filtros nicho booleanos (`pet_friendly`, `allows_no_guarantor`, `student_friendly`), contadores denormalizados (like/view/save/contact), `deleted_at`.
- **`property_videos`** — refs a video. `status` (uploading, processing, ready, failed), `position` (1-5), `cloudflare_uid` (HASH), `deleted_at`.

## Invariantes (probadas en 01_constraints_test)
- 🔒 Máx **5 videos** por propiedad → trigger atómico `enforce_max_videos_per_property()` (rechaza el 6º).
- 🔒 Una `position` única por propiedad → índice único parcial `(property_id, position) WHERE deleted_at IS NULL`.
- 🔒 `status='closed'` exige `closed_reason` (CHECK).
- 🔒 Soft-delete de propiedad **cascadea** a sus videos (trigger `cascade_soft_delete_property_videos`).
- Dirección exacta **siempre visible** (decisión de cliente, no aproximada).

## Flujo (demo)
Wizard **3 pasos**: (1) operación + tipo → (2) detalles (precio, recámaras, baños, m², dirección + ubicación) → (3) video + publicar. **Auto-aprobar**: `status='active'` al publicar (sin cola, ver [[moderacion]]).

## Reglas / gotchas
- Video en la demo: **subida real → Supabase Storage** (sin transcoding). `property_videos` hoy referencia Cloudflare (`cloudflare_uid`) → **revisar si falta una columna de ruta de Storage** (posible migración menor).
- Validación de publicación en **Edge Function** (`properties/`), no en cliente.

## Detalle exhaustivo
- `docs/PRD.md` §12-13 · migración `0005` · [[db-schema-map]]

## Relacionados
[[feed-vertical-video]] · [[mapa-y-ubicacion]] · [[busqueda-y-filtros]] · [[moderacion]] · [[inmobiliarias-y-agentes]]
