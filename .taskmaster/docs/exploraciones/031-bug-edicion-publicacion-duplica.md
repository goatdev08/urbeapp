---
tipo: fix          # feature | fix | refactor | chore | proyecto
nivel: S           # XS | S | M | L | XL
fecha: 2026-07-09
estado: aprobado      # borrador → en-revision → aprobado | descartado
tarea_id: 53
motivo_descarte:
---

# Bug: editar una publicación reinicia el wizard y duplica la propiedad

> Documento de exploración/planeación de `/tm-explore`. Un archivo por idea.
> Puede **APROBARSE** (→ tarea[s] en Taskmaster) o **DESCARTARSE** (registro de decisión).
> NO edita los PRD maestros. "Impacto en PRD" es solo referencia.

## Idea original
En Urbea, el flujo de EDICIÓN de una publicación ya subida está roto: al editar, se reinicia
el wizard completo de publicación (3 pasos) y termina SUBIENDO LA PUBLICACIÓN DE NUEVO → queda
duplicada. Lo esperado: editar los campos de una publicación existente (título, precio,
descripción, etc.) SIN re-subir el video ni crear una property nueva. Definir si la edición
reutiliza el wizard en "modo edición" (update en vez de insert, video existente intacto) o una
pantalla de edición dedicada.

## Lluvia de ideas (solo si la idea era abstracta)
La causa raíz es concreta (abajo), pero la **forma del fix** admite 3 direcciones:

- **[REC] A — Propagar el "modo edición" por contexto/layout, no por URL param.**
  El `propertyId` se lee una sola vez en `publish/_layout.tsx` (ya lo hace para el prefill) y se
  expone `edit_mode` + `property_id` a los 3 pasos vía `PublishFormContext` (o un contexto hermano).
  `step3` lee `is_edit_mode` del contexto, no de `useLocalSearchParams`. **Inmune a la pérdida del
  param** entre `router.push`. Diff pequeño, robusto ante nuevas rutas de navegación. Encaje total con
  el stack (Context ya existe). Trade-off: toca el contexto (footprint "crítico" por `hooks/**`).
- **B — Reenviar el param en cada `router.push`.** Añadir `params: { propertyId }` en
  `step1.tsx:78` y `step2.tsx:109`. **Diff de 2 líneas**, el más pequeño. Trade-off: **frágil** —
  cualquier nueva ruta de navegación que olvide el param reintroduce el bug; deja la lógica de edición
  acoplada a la URL.
- **C — Pantalla de edición dedicada (un solo formulario, sólo UPDATE, sin paso de video).**
  UX más limpia para editar (no re-recorres 3 pasos), desacopla edición de creación. Trade-off:
  **más código nuevo** (una pantalla + su navegación), contradice "reusar > reescribir" para una demo;
  duplica los inputs que ya viven en step1/step2.

**Recomendación: A** (robusto + reusa el wizar existente). B queda como hotfix mínimo si se busca
el menor riesgo posible; C sólo si el cliente pide explícitamente separar la UX de edición.

## Problema / Motivación
El "modo edición" fue construido en la subtarea **17.8** (my-listings → wizard con `propertyId`), y el
hook `usePublish` YA distingue create vs edit (UPDATE directo con RLS en vez de la Edge Function). Pero
la señal de "estás editando" **se pierde en la navegación entre pasos**, así que al guardar el wizard
cae en modo creación e inserta una propiedad + video nuevos. Resultado: el owner ve su publicación
**duplicada** en "Mis publicaciones" y en el feed, con el video re-subido. Rompe una acción básica de
gestión justo en el hito de la demo cerrada (ver [[0005-demo-cerrada-3-semanas]]).

## Resultado esperado
Desde "Mis publicaciones" → menú (⋯) → "Editar": el wizard abre **prellenado** con los datos reales, el
owner ajusta campos (precio, descripción, recámaras, toggles, etc.) y al tocar **"Guardar cambios"** se
hace **UPDATE** de la MISMA property (mismo `id`), **sin** re-subir el video ni crear una fila nueva. La
lista y el feed muestran la propiedad actualizada, sin duplicados.

## Alcance
- **SÍ entra:** corregir la propagación del modo edición para que `step3` guarde con UPDATE sobre la
  property existente. Que el video existente quede intacto. Verificación de que la policy RLS UPDATE del
  owner permite el guardado (ya existe — ver Impacto en datos).
- **NO entra (out of scope, salvo decisión):** reemplazo/re-subida del video en modo edición
  ({? pregunta abierta 2}); pantalla de edición dedicada (opción C); limpieza de duplicados ya
  generados en datos de demo ({? pregunta abierta 5}).

## Roles afectados
- **Inmobiliaria + agente (owner):** único rol que publica y edita. Es quien sufre el bug.
- Comprador / Admin: sin cambios (el admin ya puede editar por RLS `is_admin`, no en alcance de UI).

## Impacto en datos
**n/a para el fix principal** (es un bug de cliente/navegación). Nota de verificación importante:
- La policy **`properties_update` YA existe** — `supabase/migrations/20260604000008_rls_helpers_and_policies.sql:280-283`
  (re-declarada endurecida con esquema `private.` en `..._security_perf_hardening.sql:275-278`):
  `for update to authenticated using (owner_user_id = auth.uid() or is_admin()) with check (…)`.
  → El UPDATE directo desde el cliente (`supabase.from('properties').update().eq('id', …)`) que hace
  `usePublish` en edit mode **está permitido por RLS**. La RLS NO es parte del bug.
- `videos_update`/`videos_insert` también existen (0008:296-301) — relevantes sólo si se decide permitir
  reemplazo de video (fuera de alcance v1).
- Si se genera migración por algún motivo (no previsto): idempotente + rollback + pgTAP (2ª capa RLS).

## Impacto en UI
Pantallas Expo Router involucradas (sin rediseño visual):
- `app/(protected)/profile/my-listings.tsx:126-133` — entry point "Editar" (pasa `propertyId` a step1). OK.
- `app/(protected)/publish/_layout.tsx` — `FormPrefiller` lee `propertyId` y prellena el contexto. OK.
- `app/(protected)/publish/step1.tsx:78` y `step2.tsx:109` — **navegan SIN reenviar `propertyId`** (bug).
- `app/(protected)/publish/step3.tsx:56-60` — deriva `is_edit_mode` de `useLocalSearchParams`, que en
  step3 llega vacío → CREATE mode. Copy ya diferencia "Guardar cambios" vs "Publicar" (step3.tsx:268-270).
- ⚠️ Branding: **no** toca lenguaje visual (sólo lógica de navegación y copy ya existente). Gate #19 no aplica.

## Reglas no obvias aplicables
- **Criticidad TDD determinista por path (CLAUDE.md §5):** si el fix toca `mobile/**/hooks/**` o
  `mobile/**/store/**`-lógica → **crítica** (TDD estricto). Si queda sólo en screens (navegación) →
  no crítica (tsc+lint+smoke). Mezcla/duda → **crítica** (desempate). La opción A toca contexto → crítica.
- **RLS = 2ª capa; lógica de negocio en Edge Functions (`docs/lineamientos-desarrollo.md`,
  [[rls-seguridad]]).** El edit mode hace UPDATE directo por RLS (no EF) — es un caso deliberado
  documentado en `usePublish.ts:12-16`; el fix no lo cambia, sólo asegura que se active.
- **Atomicidad de creación:** el create usa el RPC `publish_property_atomic` (property+video en 1 tx,
  migración `20260625000001`) — [[propiedades-y-video]]. El edit NO debe volver a invocarlo (ese es el bug).
- **snake_case** en identificadores propios; **PNPM** para cualquier comando.

## Arquitectura / enfoque técnico  (L/XL — n/a para fixes)
n/a (fix localizado). Ver "Lluvia de ideas" para las 3 formas del fix y la recomendada (A).

## Fases / épicas  (L/XL — n/a para cambios chicos)
n/a.

## Criterios de aceptación
- [ ] Editar desde "Mis publicaciones" y guardar hace **UPDATE** de la MISMA property (mismo `id`); **no**
      se crea una fila nueva en `properties` ni en `property_videos`.
- [ ] El video existente permanece intacto (no se re-sube) al guardar cambios sólo de texto/campos.
- [ ] Todos los campos del wizard son editables y se persisten: **tipo de operación** y **tipo de propiedad**
      (step1), precio, descripción, recámaras/baños, m², dirección/ubicación, toggles (step2); se reflejan
      en la lista y el feed.
- [ ] `is_edit_mode` se resuelve desde el `PublishFormContext` (propagado desde el `_layout`), de modo que
      sigue siendo verdadero en step3 aunque se navegue step1→step2→step3 (ya NO depende de la URL).
- [ ] En modo edición el **picker de video queda oculto/deshabilitado** (sin reemplazo de video en v1) →
      no se generan uploads huérfanos en Storage.
- [ ] El **prefill no pisa las ediciones del usuario**: al volver a step1 tras editar campos, los cambios
      se conservan (prefill corre una sola vez).
- [ ] **Regresión:** publicar una propiedad nueva sigue cayendo en **create mode** (invoca la EF
      `publish-property`, crea exactamente 1 property + 1 video); el fix no lo altera.
- [ ] Verificación: `pnpm tsc --noEmit` + `pnpm lint` verdes; smoke en emulador por CLI (editar → 1 sola fila).

## Dependencias
- **#17** (my-listings + subtarea 17.8 edit mode) — donde se introdujo el modo edición.
- **#8** (wizard de 3 pasos) y **#52** (upload por streaming, `useVideoUpload`).
- Código a reusar (rutas reales): `usePublish.ts` (ya tiene edit mode), `useLoadProperty.ts` (prefill),
  `PublishFormContext.tsx`. Migración `20260604000008` (policy `properties_update`, ya desplegada).
- Sin dependencia de migraciones nuevas.

## Edge cases / riesgos
- **Reemplazo de video en edit mode (bug latente adicional):** step3 en edit mode aún permite "Cambiar
  video" (step3.tsx:217-226) y lo sube con `useVideoUpload`, **pero** el `edit_payload` de `usePublish`
  **no incluye campos de video** (usePublish.ts:92-107) → el video re-subido quedaría **huérfano** en
  Storage sin ligarse a la property. Decidir v1 (recomendado: ocultar/deshabilitar el picker en edit).
- **Prefill que pisa ediciones:** `FormPrefiller` corre en cada montaje con `propertyId`; si al volver a
  step1 se re-monta, podría re-prellenar y **borrar cambios** del usuario. La opción A debe prellenar
  **una sola vez** (guard de "ya prellenado").
- **Duplicados ya existentes:** por el bug, la demo/remoto puede tener publicaciones duplicadas →
  posible limpieza de datos ({? pregunta abierta 5}).
- **Regresión de creación:** el fix no debe hacer que un "publicar nuevo" caiga en edit mode.

## Plan de pruebas (alto nivel)
- **Crítico (TDD si toca hooks/contexto):** test de `usePublish` en edit mode → sólo UPDATE, no invoca
  `functions.invoke`; test de que step3 resuelve `is_edit_mode` desde el contexto propagado.
- **Smoke (Expo, emulador por CLI):** login owner demo (Ramos/Vlad) → Mis publicaciones → Editar → cambiar
  precio/descripción → Guardar → verificar 1 sola fila (misma `id`) y feed actualizado.
- Datos: cuentas demo (`urbea2026`) con al menos 1 propiedad. Nota: el remoto quedó vacío tras #52;
  sembrar 1 propiedad de owner para el smoke (o probar en local).
- Regresión: publicar propiedad nueva sigue creando exactamente 1 property + 1 video.

## Impacto en PRD (solo referencia — NO se edita)
n/a (fix de comportamiento, sin feature nueva). La gestión de publicaciones del owner ya está en
`docs/PRD-MVP-demo.md`.

## Decisiones del intake
Ronda de `AskUserQuestion` resuelta (2026-07-09) — todas las recomendadas:
1. **Forma del fix → A.** Propagar `edit_mode` + `property_id` por el `PublishFormContext` (leído una vez
   en `publish/_layout.tsx`, igual que el prefill); step3 lee del contexto, no de `useLocalSearchParams`.
   Se **mantiene el wizard de 3 pasos** en modo edición (NO pantalla dedicada; opción C descartada).
2. **Video en v1 → NO reemplazable.** Ocultar/deshabilitar el picker de video en modo edición para evitar
   uploads huérfanos. El reemplazo de video queda como trabajo futuro (fuera de alcance).
3. **Campos editables → TODOS** los del wizard, incluidos tipo de operación y tipo de propiedad.
4. **Duplicados existentes → NO se limpian.** Solo prevenir a futuro (el remoto quedó vacío tras #52; no
   hay datos que limpiar).

## Promoción / descarte
Al aprobar: 1 tarea `fix` nivel S, prioridad **high** (rompe una acción básica de gestión en el hito de
demo) → `/tm-plan {id}`. Footprint: navegación en screens (`step1.tsx`, `step2.tsx`, `step3.tsx`) +
propagación de edit mode por `PublishFormContext.tsx` (store/lógica → **crítico**, TDD estricto). Sin
migraciones (la policy `properties_update` ya existe y está desplegada). Ocultar el picker de video en
edit mode en `step3.tsx`.
