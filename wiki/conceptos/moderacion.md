---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §14-16, .taskmaster (tarea #73)]
codigo: [supabase/migrations/20260809000002_property_status_operational_values.sql, supabase/migrations/20260809000003_property_revisions.sql, supabase/migrations/20260809000004_property_video_slots.sql, supabase/migrations/20260809000005_publish_property_atomic_video_slot.sql, supabase/functions/publish-property/, supabase/functions/edit-property/, supabase/functions/moderate-property/, supabase/functions/update-property-status/, supabase/tests/36_property_status_operational_test.sql, supabase/tests/37_property_revisions_test.sql, supabase/tests/38_property_video_slots_test.sql, mobile/app/(protected)/publish/step{1..5}.tsx, mobile/src/features/publish/hooks/useDraftAutosave.ts, mobile/src/features/profile/components/PropertyListItem.tsx]
actualizado: 2026-08-09
---

# Moderación

> En beta, **toda publicación pasa por revisión manual** de un admin antes de ser pública. Sin cola/panel visual todavía — el admin transiciona por Supabase Studio o SQL directo (el panel web es Ola 3). El pipeline y la máquina de estados sí son código real (tarea #73, PRD §14-16).

## Máquina de estados (`property_status`, 17 valores)
Enum extendido en `20260809000002` (aditivo puro, migración SOLA por el gotcha `ALTER TYPE ADD VALUE` + uso en la misma transacción). Los 7 originales del MVP (`draft, pending_review, needs_changes, active, paused, closed, suspended`) + 10 operativos del PRD §15.4: `uploading_media, media_failed, pending_payment, approved, expired, rented, sold, rejected, deleted_soft, deleted_hard`. `closed` se mantiene vivo solo para filas históricas (`closed_reason` incluye `withdrawn`, que el modelo nuevo no contempla); código nuevo ya no lo escribe.

Solo una parte del grafo completo del PRD está cableada hoy (lo que #73 implementó):
- `draft → pending_review` (publicar, EF `publish-property`) → `active | needs_changes | rejected` (EF `moderate-property`, sin revisión activa).
- `active → suspended` (fraude/reporte, inmediato, EF `moderate-property` acción `suspend`) — bloqueado si el estado ya es terminal (`sold`, `rented`, `deleted_hard`, `deleted_soft`).
- `active | paused | approved → rented | sold` (cierre manual, EF `update-property-status`) — **terminales, sin reapertura en MVP** (`VALID_TRANSITIONS[rented] = []`).
- `active → paused → active` (pausar/reanudar, sin re-revisión).
- Edición de una propiedad `active` con campo crítico → crea `property_revisions` (pending), la propiedad viva NO cambia hasta que se apruebe (ver abajo).

Estados como `uploading_media`, `media_failed`, `pending_payment`, `expired`, `deleted_soft`, `deleted_hard` quedan **en el enum pero sin código que los escriba todavía** — semilla para las olas de pagos (#76) y baja de cuenta.

## Pipeline de validación previa a publicar (PRD §15.2, EF `publish-property`)
Antes de invocar al publisher, dos checkers en orden fijo (si el primero falla, el segundo y el publisher NUNCA se invocan — no se gasta el slot en una publicación que se va a rechazar):
1. **`videoStatusChecker`** — el video (`cloudflare_uid` + `agent_id` del caller verificado, nunca del payload) debe existir, estar `status='ready'` y durar entre **60 y 120 segundos INCLUSIVE**. Códigos: `VIDEO_NOT_FOUND`=404, `VIDEO_NOT_READY`=409, `VIDEO_DURATION_INVALID`=400.
2. **`duplicatePropertyChecker`** — firma de duplicado: mismo `owner_user_id` + misma `address` normalizada (`lower(trim())` en ambos lados, evita comportamiento raro de `ilike`) ya publicada con `status NOT IN (rejected, deleted_soft, deleted_hard)` (una rechazada o eliminada no cuenta — el agente puede resubir). `DUPLICATE_PROPERTY`=409.

Si ambos pasan, `propertyPublisher.publish()` llama la RPC `publish_property_atomic` (SECURITY DEFINER) que en una sola transacción: inserta `properties` con `status='pending_review'` (parámetro `p_property_status`, ya no hardcodeado), enlaza el video en vuelo (`property_videos.property_id`) y crea la fila en `property_video_slots` (abstracción de vigencia, ver [[propiedades-y-video]] §Ola 1). 201 → `{property_id}`.

## `property_revisions` — doble versión (PRD §15.6, migración `20260809000003`)
La propiedad **viva** (`properties`, lo que el feed/detalle público lee) y su **revisión pendiente** (`property_revisions`) coexisten sin pisarse. Invariante 🔒: a lo más **una** revisión activa (`status IN pending, needs_changes`) por propiedad — índice único parcial. `changed_fields` guarda el payload COMPLETO del editor (críticos y no-críticos juntos, se aplican todos al aprobar). Escritura exclusiva de `service_role` — sin policies de INSERT/UPDATE para `authenticated`, la única puerta de entrada es la EF `edit-property`.

### Campos que disparan re-revisión (§15.5) — EF `edit-property`
Reemplaza el UPDATE directo por RLS que `usePublish.ts` hacía en editMode (decisión de #53). Diff campo-a-campo contra el snapshot actual (`operation_type`, `property_type`, `address` normalizada, `location` — EWKB hex vs EWKT via `location.ts`, `price` comparación exacta, `description`):
- **Disparan** (crítico): dirección/coordenadas, operación, tipo, precio, descripción, video (el video no se edita hoy en el wizard de edición, así que en la práctica no aplica aún), cambio de agente → **crea/actualiza `property_revisions`** (upsert: si ya hay una `pending`/`needs_changes` activa, la reemplaza en vez de duplicar), `properties` (current_published) **NUNCA se toca**.
- **NO disparan** (aplican directo a `properties`): pausar/reactivar, ocultar/mostrar precio (`price_visible` sin cambiar el precio interno), recámaras/baños/m², amenidades nicho, redes/contacto.
- Ownership: owner de la propiedad O admin (mismo criterio que la RLS `properties_update` que esta EF reemplaza).

### Excepción §15.6 — suspensión inmediata
`suspend` (fraude/reporte) es la ÚNICA transición que **oculta de inmediato**, sin pasar por revisión: va directo a `properties.status='suspended'` y **nunca toca `property_revisions`** (ni lectura ni escritura) — una revisión pendiente existente queda intacta para cuando se reactive el caso.

## EF `moderate-property` (73.9) — 1 sola EF unificada, PRD §15.6
Decisión de diseño: **no** 4 EFs separadas (`approve`/`needs_changes`/`reject`/`suspend`) — una EF con `action` parametrizada, patrón compacto de `update-property-status`. Solo admin (`AdminVerifier`, 401/403). Orquestación:
- **`suspend`** → directo a `properties.status='suspended'`, bloqueado en estados terminales `{sold, rented, deleted_hard, deleted_soft}` (400 `INVALID_TRANSITION`).
- **`approve`/`needs_changes`/`reject`**, con revisión activa (`property_revisions.status IN pending, needs_changes`):
  - `approve` → aplica `changed_fields` sobre `properties` vía un **whitelist explícito** de columnas editables (`project_property_snapshot_fields` en `_shared/clients.ts` — 12 campos + `location` condicional; **nunca spread crudo**, ver defecto #3 abajo), `properties.status` **no cambia** (sigue `active`); revisión → `approved`.
  - `needs_changes`/`reject` → solo tocan la revisión (`status` + `rejection_reason`), `properties` intacta.
- **Sin revisión activa** (publicación inicial): exige `properties.status='pending_review'` (si no, `NOTHING_TO_MODERATE` 400) y transiciona `properties.status` directo: `approve→active`, `needs_changes→needs_changes`, `reject→rejected`.
- **TODAS** las ramas exitosas registran en `admin_actions` (append-only, inmutable, migración 0007) — `action_type`=la acción, `old_values`/`new_values`={status} o {revision_status} según la rama, nunca ambos. El fallo de auditoría también es 500 (no best-effort — si no se pudo auditar, la operación no cuenta como completa).

## Cierre y baja (§16.1, EF `update-property-status`, tarea 73.8)
`rented`/`sold` son `new_status` **directo** (autodescriptivo, sin `closed_reason`) desde `active`/`paused`/`approved` — **terminales, sin reapertura en MVP** (`VALID_TRANSITIONS[rented] = VALID_TRANSITIONS[sold] = []`). El camino viejo `closed`+`closed_reason` (`rented`/`sold`/`withdrawn`/`expired`) sigue vivo para no-regresión pero código nuevo usa directamente `rented`/`sold`.

## Reportes (`property_reports`) — sigue diferido
No forma parte de la Ola 1 (#73). La tabla existe desde migración `0007` (`reason`: not_exist_fraud, misleading, false_price, wrong_address, inappropriate, duplicate, other; `status`: new, reviewing, resolved, dismissed; 🔒 1 reporte por (property, user)) pero sin flujo ni auto-suspensión a 3 reportes/24h. Pendiente de ola futura.

## 🔴 Los 3 defectos críticos que el guardian encontró contra la DB real (tarea #73, lección de proceso)
Los tres pasaron TODA la suite mockeada en verde y solo aparecieron al verificar contra el stack local real — ninguno lo hubiera cazado un test contra dobles/fakes:
1. **`publish-property`/`index.ts` nunca reenviaba `property_status` a la RPC** (73.4) — `handler.ts` ya mandaba `'pending_review'` (57 tests DI en verde lo confirmaban), pero el adapter real nunca lo pasaba como parámetro y la RPC seguía hardcodeando `'active'`. En producción **ninguna propiedad habría llegado jamás a `pending_review`**. Fix: parámetro `p_property_status` en la RPC + 3 asserts pgTAP end-to-end que verifican la fila REAL, no un mock.
2. **`edit-property`/`location.ts` sin cobertura real** (73.6) — los tests del handler mockeaban EWKT en ambos lados del diff, así que `parse_ewkb_point` (el parser del formato real que PostgREST devuelve) nunca se había ejercitado. Mutation testing del guardian expuso el hueco (no era un bug genuino, pero sí un riesgo real sin red). Cerrado con 11 tests contra fixtures NDR/XDR verificadas contra PostGIS real.
3. **`moderate-property`/`apply_revision_snapshot` hacía spread crudo de `changed_fields`** (73.9) — ese objeto es el `EditPropertyInput` completo que `property_revisions` guarda, y `property_id` es una de sus keys; `properties` usa `id`, no `property_id`. Resultado: **`approve` con revisión SIEMPRE fallaba 500** ("Could not find the property_id column") en la DB real, pese a 39 tests DI en verde. Fix: función `project_property_snapshot_fields` con whitelist explícito (mismo criterio que `edit-property/index.ts`), 6 tests nuevos contra el adaptador real.

**Heurística que deja la lección** (aplicable a futuros adaptadores "delgados"): la pregunta correcta para decidir si un adaptador necesita test contra schema real no es *"¿es una sola sentencia SQL?"* sino *"¿transforma o proyecta datos cuyo shape define otro componente?"* — los adaptadores que solo pasan parámetros tal cual (wrappers de una query obvia) estuvieron siempre correctos; los que proyectaban/transformaban (el cableo params→RPC de #1, el parser EWKB de #2, el whitelist de #3) fueron exactamente los que tenían el bug.

## Detalle exhaustivo
- `docs/PRD.md` §14 (wizard+autosave), §15 (moderación, pipeline, estados, re-revisión, visibilidad), §16 (cierre) · migraciones `20260809000002`-`20260809000005` · [[db-schema-map]]

## Relacionados
[[propiedades-y-video]] · [[rls-seguridad]] · [[notificaciones]]
