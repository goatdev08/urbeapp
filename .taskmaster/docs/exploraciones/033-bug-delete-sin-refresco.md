---
tipo: fix           # feature | fix | refactor | chore | proyecto
nivel: S            # XS | S | M | L | XL
fecha: 2026-07-09
estado: aprobado
tarea_id: 55
motivo_descarte:
---

# Bug: eliminar publicación no refresca la UI (my-listings + feed)

> Documento de exploración/planeación de `/tm-explore`. Un archivo por idea.
> NO edita los PRD maestros; "Impacto en PRD" es solo referencia.

## Idea original
En Urbea, al ELIMINAR una publicación (property) desde el perfil/gestión del owner, la UI
no se refresca: la publicación eliminada sigue apareciendo en el perfil (my-listings) y en
el feed hasta que se cierra y reabre la app. Lo esperado: al eliminar, la lista del perfil
(y el feed) reflejan la eliminación de inmediato, sin recargar la app.

## Lluvia de ideas (solo si la idea era abstracta)
La causa es concreta pero el **enfoque del fix** tiene opciones. Tres direcciones:

- **A — `useFocusEffect` refetch en las pantallas afectadas (RECOMENDADA).**
  Reusa un patrón que YA existe en el repo (`useAgentProfile.ts:68`, `useAgentLeads.ts`
  expone `refetch`). El feed re-consulta al recuperar foco de tab; my-listings ya
  refetch-ea tras la mutación. Trade-off: refetch completo del feed al enfocar → pierde
  posición de scroll y re-mint de signed URLs (costo EF `mint-video-url`); puede
  re-reproducir el video del ítem visible. Encaje con stack: alto (sin dependencia nueva,
  sin estado global nuevo — respeta ponytail/YAGNI).

- **B — Remoción optimista local + señal compartida de "propiedad eliminada".**
  Un event emitter / mini-store que, al borrar, quita ese `id` del estado de todas las
  listas montadas al instante (sin refetch). Trade-off: introduce estado compartido nuevo
  (más plumbing, roza el principio de "no acumular código"); a cambio da UX instantánea y
  conserva scroll del feed. Encaje: medio.

- **C — Adoptar React Query/SWR como cache compartida con invalidación por queryKey.**
  Resolvería la clase entera de bugs de sincronización cross-screen. Trade-off:
  dependencia nueva + refactor de TODOS los hooks de datos → sobredimensionado para un fix
  S; contradice ponytail. Descartada para este fix; anotar como posible deuda si el patrón
  se repite.

**Elección propuesta:** A como base. Si en dispositivo el refetch del feed se siente
brusco (scroll/reproducción), escalar a una remoción optimista puntual (parte de B) solo
para el feed. Ver preguntas abiertas.

## Problema / Motivación
Un owner que borra una publicación sigue viéndola en su lista de gestión y en el feed
público hasta reiniciar la app. Da la impresión de que el borrado "no funcionó" y rompe la
confianza en la gestión de publicaciones — justo el flujo que la demo cerrada de 3 semanas
([[0005-demo-cerrada-3-semanas]]) pone frente al cliente.

## Resultado esperado
Al confirmar la eliminación de una publicación:
1. La fila desaparece de **Mis publicaciones** (my-listings) de inmediato.
2. La propiedad desaparece del **feed** sin reiniciar la app (a más tardar al volver a
   enfocar la tab del feed).
3. La mutación persiste en BD (`deleted_at` seteado) — verificado, ya ocurre hoy.

## Alcance
- **SÍ entra:** refresco de la UI del feed tras un soft-delete hecho en otra pantalla;
  confirmar/afianzar el refetch de my-listings.
- **NO entra (out of scope):** cambiar el mecanismo de borrado (sigue siendo soft-delete
  vía update directo + RLS), rediseñar la capa de datos con React Query, invalidación de
  favoritos/saved (a evaluar como pregunta abierta), delete físico.

## Roles afectados
- **Inmobiliaria + agente (owner):** es quien borra desde my-listings; hoy ve estado stale.
- **Comprador (feed):** ve en el feed una propiedad ya eliminada hasta reiniciar.
- **Admin de plataforma:** n/a directo (mismo patrón de listas si borrara, no prioritario).

## Impacto en datos
n/a. **La mutación y el schema ya funcionan.** El soft-delete
(`properties.deleted_at = now()`) persiste porque la política RLS
`properties_update` permite al dueño actualizar
(`supabase/migrations/20260604000008_rls_helpers_and_policies.sql:280-283`). El feed y las
listas ya filtran `deleted_at is null`. **El bug es 100% de refresco de UI, no de datos.**

## Impacto en UI
Tres superficies quedan stale tras un soft-delete hecho en otra pantalla (todas por falta
de refetch al recuperar foco; la tab/pantalla permanece montada):

- **Feed** — `src/features/feed/FeedScreen.tsx` carga solo en mount vía
  `useEffect(loadInitial, [loadInitial])` (líneas ~52-56); sin `useFocusEffect`. El hook
  `useFeedProperties.ts` ya expone `refetch`. **En alcance.**
- **Grid del perfil** — `src/features/profile/hooks/usePropertiesGrid.ts` **NO expone
  `refetch`** y carga con `useEffect([owner_user_id])`. Necesita exponer `refetch` (tick,
  como `useMyProperties`) y que la pantalla del perfil lo dispare al foco. **En alcance
  (superficie confirmada por el usuario como la que queda stale).**
- **Guardados/Favoritos** — `src/features/saved/SavedScreen.tsx` + hook
  `useSavedProperties.ts`. Hallazgos de la investigación:
  - El hook **ya expone `refetch`**, pero `SavedScreen` **NO** usa `useFocusEffect` → solo
    carga en mount → stale igual que las otras. **En alcance.**
  - La query embebe `properties(...)` **sin filtro `deleted_at`/`status`**, pero la **RLS
    `properties_select` protege**: para un buscador (no dueño) una propiedad soft-deleted
    cae del branch público → el embed llega `null` → el filtro `EC-5`
    (`useSavedProperties.ts:~110`) la descarta. Es decir, al refetch-ear, desaparece sola.
  - ⚠️ **Edge case menor:** si el que guardó es el **dueño/owner** de la propiedad, la RLS
    (branch owner) sí devuelve la propiedad aun soft-deleted → seguiría apareciendo en SU
    lista de guardados. Fuera del camino común de demo (buscador guarda prop de un agente);
    se documenta, no se ataca en este fix salvo que se pida.
- **my-listings** (`app/(protected)/profile/my-listings.tsx:~975-978`) — **ya llama
  `refetch()`** tras un delete OK → NO es el problema (confirmado por el usuario). Sin
  cambios.
- Sin cambios visuales/branding → **sin gate #19**.

## Reglas no obvias aplicables
- **Soft-delete, nunca DELETE físico:** eliminar = `deleted_at`; trigger de cascada a
  `property_videos`; el feed/grids filtran `deleted_at is null` — `wiki/conceptos/propiedades-y-video`.
- **RLS = 2ª capa:** el borrado se hace con `update` directo desde el cliente (no EF)
  protegido por `properties_update` (owner/admin) — `wiki/conceptos/rls-seguridad.md` ·
  migración `20260604000008:280-283`. NO introducir una EF nueva para el delete: el patrón
  actual (update + RLS) es el elegido. Reusar > reescribir.
- **Patrón de refetch al foco YA existe:** `useFocusEffect` en
  `src/features/profile/hooks/useAgentProfile.ts:68` y `refetch()` por tick en
  `useMyProperties.ts` / `useAgentLeads.ts`. Espejar, no inventar.
- **ponytail/YAGNI:** preferir el patrón existente (A) antes que estado global nuevo (B/C).

## Arquitectura / enfoque técnico  (L/XL — n/a para fixes)
n/a (fix S). Nota breve: cada lista es un hook `useState + useEffect` aislado, sin cache
compartida; por eso una mutación en una pantalla no invalida el estado de otra. El fix
mínimo respeta esa arquitectura (refetch al foco) en vez de introducir una cache global.

## Fases / épicas  (L/XL — n/a para cambios chicos)
n/a.

## Criterios de aceptación
- [ ] Tras eliminar una publicación, el **grid del perfil** deja de mostrarla al volver a
      enfocarse (sin reiniciar la app).
- [ ] Tras eliminar, la propiedad ya no aparece en el **feed** al volver a enfocar la tab
      (sin reiniciar la app).
- [ ] **Guardados/favoritos** tampoco muestran properties eliminadas tras refocus (RLS ya
      las oculta al refetch-ear; el fix añade el refetch al foco que faltaba).
- [ ] **Sin doble fetch** en el primer mount: `useFocusEffect` con guardia para no
      duplicar la carga inicial (patrón de `useAgentProfile.ts:68`).
- [ ] `usePropertiesGrid` expone `refetch` (tick), consumido al foco por la pantalla del
      perfil.
- [ ] La mutación sigue persistiendo `deleted_at` (sin regresión en el borrado — ya funciona).
- [ ] Test(s) del/los hook(s) tocado(s) en verde (footprint crítico: `mobile/**/hooks/**`).

## Dependencias
- Código a reusar: `useFocusEffect` de `useAgentProfile.ts:68`; `refetch` de
  `useMyProperties.ts` / `useAgentLeads.ts`. Componentes de borrado ya existentes
  (`usePropertyActions.ts`, `DeletePropertyDialog.tsx`). Ninguna migración nueva.

## Edge cases / riesgos
- **Feed:** refetch al foco pierde posición de scroll + re-reproduce video + re-mintea
  signed URLs (costo EF). Mitigar según pregunta abierta 1.
- **Doble disparo:** `useFocusEffect` dispara también en el primer foco (== mount) →
  evitar doble carga inicial (el patrón de `useAgentProfile` ya lo contempla).
- **my-listings ya refetch-ea:** si en dispositivo igual se ve stale, hay una causa
  secundaria a reproducir (no evidente en el código).

## Plan de pruebas (alto nivel)
- **Crítico (TDD estricto):** los hooks tocados viven en `mobile/**/hooks/**` → fase RED
  antes de GREEN. Test del hook del feed: al re-enfocar (o recibir la señal) se dispara
  `loadInitial`/remoción del `id`. Vitest/jest con cliente Supabase inyectado (patrón DI ya
  usado en `feedProperties.test.ts`).
- **Smoke en app (Expo, por CLI):** borrar una publicación de la cuenta demo owner →
  verificar que desaparece de my-listings y del feed sin reiniciar. Testing en
  emulador/simulador SOLO por CLI (CLAUDE.md §3).
- Datos: cuenta demo owner (Ramos/Vlad) con ≥1 publicación activa con video ready.

## Impacto en PRD (solo referencia — NO se edita)
n/a (fix de comportamiento, no feature nueva).

## Decisiones del intake
1. **Enfoque:** A — refetch al recuperar foco (`useFocusEffect` + `refetch()`, reusando el
   patrón de `useAgentProfile.ts:68`), con **guardia contra el doble disparo** en el primer
   foco (mount == foco). Sin remoción optimista, sin React Query (B y C descartadas por
   ponytail/YAGNI).
2. **Superficie real del bug (respuesta del usuario: "el grid del perfil, en el feed si se
   elimina"):** lo que queda stale es el **grid del perfil** (`usePropertiesGrid`) y el
   **feed**. my-listings ya refetch-ea → no es el problema.
3. **Alcance (respuesta del usuario: "revisa grid y guardados"):** feed + grid del perfil +
   **guardados/favoritos**. Investigación hecha (ver "Impacto en UI"): `SavedScreen` no
   refetch-ea al foco (mismo bug); la RLS ya oculta las soft-deleted a los buscadores al
   refetch-ear; queda un edge case menor si el que guardó es el dueño (documentado, fuera de
   este fix salvo petición).

## Promoción / descarte
Listo para promover. Al aprobar: crear una tarea `fix` (prioridad **media**) y sugerir
`/tm-plan {id}`. Footprint previsto (todo `mobile/**`, sin migraciones):
`src/features/feed/FeedScreen.tsx`, `src/features/profile/hooks/usePropertiesGrid.ts`
(+ pantalla del perfil que lo consume), `src/features/saved/SavedScreen.tsx`. Hooks =
footprint TDD-crítico → fase RED antes de GREEN.
