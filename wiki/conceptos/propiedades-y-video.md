---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §12-13, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/20260604000005_properties_and_videos.sql, supabase/migrations/20260604000011_storage_property_videos.sql, supabase/migrations/20260604000012_property_videos_ready_requires_storage.sql, supabase/tests/01_constraints_test.sql, supabase/tests/03_storage_test.sql]
actualizado: 2026-06-24
---

# Propiedades y video

> Una publicación = una propiedad con dirección exacta + hasta 5 videos verticales.

## Modelo de datos (migración 0005)
- **`properties`** — `owner_user_id`, `address` (texto exacto, **NOT NULL**, público), `location` (PostGIS `Point,4326`), `property_type` (casa, departamento, local, oficina, terreno), `operation_type` (rent, sale, both), `status` (`property_status`: **draft, pending_review, needs_changes, active, paused, closed, suspended**), `closed_reason` (rented, sold, withdrawn, expired), filtros nicho booleanos (`pet_friendly`, `allows_no_guarantor`, `student_friendly`), contadores denormalizados (like/view/save/contact), `deleted_at`.
- **`property_videos`** — refs a video. `status` (uploading, processing, ready, failed), `position` (1-5), `cloudflare_uid` (HASH), **`storage_path`** (path del objeto en el bucket `property-videos`; único parcial cuando no es nulo — migración 0011), `deleted_at`.

## Invariantes (probadas en 01_constraints_test)
- 🔒 Máx **5 videos** por propiedad → trigger atómico `enforce_max_videos_per_property()` (rechaza el 6º).
- 🔒 Una `position` única por propiedad → índice único parcial `(property_id, position) WHERE deleted_at IS NULL`.
- 🔒 `status='closed'` exige `closed_reason` (CHECK).
- 🔒 Video `status='ready'` exige **al menos una** referencia de storage — CHECK `property_videos_ready_requires_storage` (`status <> 'ready' OR storage_path IS NOT NULL OR cloudflare_uid IS NOT NULL`, migración **0012**). Condicional al status (espeja `property_closed_requires_reason`): `uploading`/`processing`/`failed` pueden no tener referencia (la fila existe antes de subir el binario; el `video_id` del path es el `id` de la fila), pero marcar `ready` exige `storage_path` o `cloudflare_uid`. Aplica también en UPDATE (transición a `ready`). Asserts 14-18 en `01_constraints_test.sql`.
- 🔒 Soft-delete de propiedad **cascadea** a sus videos (trigger `cascade_soft_delete_property_videos`).
- Dirección exacta **siempre visible** (decisión de cliente, no aproximada).

## Storage de video (migración 0011)
- **Bucket `property-videos`** — privado (`public=false`), `file_size_limit=104857600` (100 MB), MIME `video/mp4` · `video/quicktime` · `video/webm`.
- **Convención de path**: `{user_id}/{property_id}/{video_id}.mp4` → `foldername[1]`=dueño, `foldername[2]`=propiedad. `property_videos.storage_path` guarda este path.
- 🔒 **RLS INSERT** (`property_videos_storage_insert`, `to authenticated`): el agente dueño sube **solo a su propio path** — `foldername[1] = auth.uid()` **y** `current_user_role() ∈ {agent, admin}`. Mismo gate dueño+rol que `properties_insert`; **no** hay "admin escribe en cualquier path".
- 🔒 **RLS SELECT** (`property_videos_storage_select`, `to anon, authenticated`): lectura pública si la propiedad está activa (`private.property_is_public(foldername[2])`, helper SECURITY DEFINER de 0010 — **evita JOIN inline** que colisiona con la RLS de `properties` en anon) **o** si eres el dueño (`foldername[1]=auth.uid()`, lee aunque esté en draft).
- **CORS**: Supabase Storage **no expone CORS por bucket** (Kong/gateway lo sirve permisivo a nivel plataforma); las subidas nativas (Expo/RN) **no aplican CORS**. No hay nada que configurar para la demo.
- Tests: `supabase/tests/03_storage_test.sql` (pgTAP, 16 asserts). Verificado contra remoto vía MCP (RED→GREEN).

## Flujo (demo)
Wizard **3 pasos**: (1) operación + tipo → (2) detalles (precio, recámaras, baños, m², dirección + ubicación) → (3) video + publicar. **Auto-aprobar**: `status='active'` al publicar (sin cola, ver [[moderacion]]).

## Reglas / gotchas
- Video en la demo: **subida real → Supabase Storage** (sin transcoding), bucket `property-videos`. La columna de ruta de Storage (`storage_path`) ya existe (migración 0011). `cloudflare_uid` queda como ref legacy/futuro (coexisten; cada uno único cuando no es nulo).
- Validación de publicación en **Edge Function** (`properties/`), no en cliente.

## Detalle exhaustivo
- `docs/PRD.md` §12-13 · migración `0005` · [[db-schema-map]]

## Relacionados
[[feed-vertical-video]] · [[mapa-y-ubicacion]] · [[busqueda-y-filtros]] · [[moderacion]] · [[inmobiliarias-y-agentes]]
