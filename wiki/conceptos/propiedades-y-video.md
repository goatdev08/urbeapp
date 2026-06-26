---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §12-13, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/20260604000005_properties_and_videos.sql, supabase/migrations/20260604000011_storage_property_videos.sql, supabase/migrations/20260604000012_property_videos_ready_requires_storage.sql, supabase/migrations/20260625000001_publish_property_rpc.sql, supabase/functions/publish-property/, supabase/tests/01_constraints_test.sql, supabase/tests/03_storage_test.sql, supabase/tests/06_publish_property_rpc_test.sql, mobile/src/features/publish/]
actualizado: 2026-06-26
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
- **Convención de path**: el esquema RLS asume `{user_id}/{property_id}/{video_id}.mp4` → `foldername[1]`=dueño, `foldername[2]`=propiedad. `property_videos.storage_path` guarda este path.
- ⚠️ **GOTCHA path 2-seg vs RLS SELECT (tarea #8):** el wizard sube con path de **2 segmentos** `{user_id}/{video_id}.mp4` (Opción C — el `property_id` aún no existe en el cliente al momento de subir, porque la propiedad se crea después en la EF). Esto satisface la **RLS INSERT** (`foldername[1]=auth.uid()`) y la lectura del **dueño**, pero **rompe la RLS SELECT pública**: `property_videos_storage_select` concede lectura anon via `private.property_is_public((foldername)[2]::uuid)`, y con 2 segmentos `foldername[2]='{video_id}.mp4'` (el cast `::uuid` falla) → un usuario que **no es el dueño no puede leer el video**. **Decisión (orquestador+usuario):** NO tocar RLS ni path; el **feed (#9) minta signed URLs vía una Edge Function con `service_role`** (`createSignedUrl(storage_path)`, bypassa la RLS SELECT anon — el path da igual), mismo patrón que la futura migración a **Cloudflare R2** (presigned server-side). → tarea **#21** (dep de #9).
- 🔒 **RLS INSERT** (`property_videos_storage_insert`, `to authenticated`): el agente dueño sube **solo a su propio path** — `foldername[1] = auth.uid()` **y** `current_user_role() ∈ {agent, admin}`. Mismo gate dueño+rol que `properties_insert`; **no** hay "admin escribe en cualquier path".
- 🔒 **RLS SELECT** (`property_videos_storage_select`, `to anon, authenticated`): lectura pública si la propiedad está activa (`private.property_is_public(foldername[2])`, helper SECURITY DEFINER de 0010 — **evita JOIN inline** que colisiona con la RLS de `properties` en anon) **o** si eres el dueño (`foldername[1]=auth.uid()`, lee aunque esté en draft).
- **CORS**: Supabase Storage **no expone CORS por bucket** (Kong/gateway lo sirve permisivo a nivel plataforma); las subidas nativas (Expo/RN) **no aplican CORS**. No hay nada que configurar para la demo.
- Tests: `supabase/tests/03_storage_test.sql` (pgTAP, 16 asserts). Verificado contra remoto vía MCP (RED→GREEN).

## Flujo (demo) — **implementado, tarea #8 (vivo)**
Wizard **3 pasos** en `mobile/app/(protected)/publish/` (estado compartido `PublishFormContext`): (1) operación + tipo → (2) detalles (precio, recámaras/baños via stepper, m², descripción, dirección via **Google Places API New** REST+fetch, ubicación exacta via **react-native-maps** marker draggable, toggles nicho) → (3) video (expo-image-picker → preview expo-video) + publicar. **Auto-aprobar**: `status='active'` al publicar (sin cola, ver [[moderacion]]).

**Upload + publicación (decisión #8, "Opción C"):** el cliente genera el `video_id` (UUID) **antes** de subir y sube a `{user_id}/{video_id}.mp4` (path de **2 segmentos**, ver gotcha abajo); en éxito guarda `video_id`+`storage_path` en el form. Solo entonces el botón Publicar invoca la **Edge Function `publish-property`** que vía la RPC `publish_property_atomic` (SECURITY DEFINER) inserta `properties`(active)+`property_videos`(ready, id=video_id) en **una tx atómica**. Así la propiedad **solo se crea si el upload tuvo éxito** (sin filas huérfanas). La EF exige rol `agent`/`admin` (401/403). Hooks `useVideoUpload`/`usePublish` son críticos (TDD: RED→GREEN→guardian). Tras éxito → `router.replace('/')` al feed + Alert de confirmación.

## Reglas / gotchas
- Video en la demo: **subida real → Supabase Storage** (sin transcoding), bucket `property-videos`. La columna de ruta de Storage (`storage_path`) ya existe (migración 0011). `cloudflare_uid` queda como ref legacy/futuro (coexisten; cada uno único cuando no es nulo).
- Validación de publicación en **Edge Function** (`supabase/functions/publish-property/`, #8), **no** en cliente (el cliente valida UX con `validate_step1/2/3` pero la EF revalida + aplica RLS/rol).

## Detalle exhaustivo
- `docs/PRD.md` §12-13 · migración `0005` · [[db-schema-map]]

## Relacionados
[[feed-vertical-video]] · [[mapa-y-ubicacion]] · [[busqueda-y-filtros]] · [[moderacion]] · [[inmobiliarias-y-agentes]]
