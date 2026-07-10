---
tipo: fix           # feature | fix | refactor | chore | proyecto
nivel: S            # XS | S | M | L | XL
fecha: 2026-07-09
estado: aprobado
tarea_id: 54
motivo_descarte:
---

# Filtros inaccesibles cuando el feed queda vacío por un filtro

> Documento de exploración/planeación de `/tm-explore`. Un archivo por idea.

## Idea original
En Urbea, el selector de filtros tiene una trampa de UX: si el usuario aplica un filtro que
no arroja resultados, cae en la pantalla del feed con "no hay videos disponibles", y en ese
empty state NO hay botón de filtros — el usuario queda atrapado y tiene que irse al mapa para
cambiar/quitar el filtro. Lo esperado: los filtros (o al menos limpiar/cambiar filtros) deben
ser accesibles desde el feed SIEMPRE, incluso cuando no hay resultados. Probablemente el empty
state deba decir "no hay videos con estos filtros" + acción de limpiar filtros.

## Lluvia de ideas (solo si la idea era abstracta)
n/a — la idea llegó concreta y la causa raíz es inequívoca (ver abajo).

## Problema / Motivación
**Causa raíz confirmada** (lectura de `mobile/src/features/feed/FeedScreen.tsx`):
el botón flotante de filtros (`SlidersHorizontal`, top-right) **y** el `<FilterSheet>` SÍ existen
y ya funcionan — pero **solo se renderizan en el return del "Feed principal"** (a partir de la
línea 116). Los estados de carga/error/vacío hacen **early-return antes** de llegar a ellos:
- `FeedScreen.tsx:99-112` → si `data.length === 0` tras carga exitosa, retorna un `<EmptyState>`
  con copy fijo "Aún no hay propiedades" + CTA "Publicar propiedad" y **nada más**. No hay botón
  de filtros ni FilterSheet en este subárbol.
- Ese empty state **no distingue** entre "la BD está vacía" (0 propiedades) y "hay propiedades
  pero ningún resultado con estos filtros" (`active_filter_count > 0`). Trata ambos como
  "sé el primero en publicar", lo cual es engañoso cuando el problema es un filtro.
- Resultado: el usuario que filtró demasiado queda atrapado; la única salida es cambiar de tab
  (mapa) para tocar los filtros allá — que comparten el mismo `FilterState` vía `FilterProvider`.

Encaje con el hito demo (`[[0005-demo-cerrada-3-semanas]]`): es un bug de UX visible en cualquier
demo donde el evaluador juegue con filtros; barato de arreglar y alto en percepción de pulido.

## Resultado esperado
1. El control de filtros es **alcanzable desde el feed en todos los estados**, incluido el vacío.
2. Cuando el feed queda vacío **por filtros** (`active_filter_count > 0`), el empty state comunica
   la causa real: copy tipo "No hay propiedades con estos filtros" + acción **"Limpiar filtros"**
   que llama `clear_filters()` y re-consulta.
3. Cuando el feed está vacío **sin filtros activos** (BD vacía), se conserva el copy/CTA actual
   ("Aún no hay propiedades" → "Publicar propiedad").

## Alcance
- **SÍ entra:**
  - Ramificar el empty state de `FeedScreen.tsx` por `active_filter_count > 0`.
  - Copy + CTA "Limpiar filtros" (reusa `EmptyState.cta_label`/`onPressCta`, ya existentes) → `clear_filters()`.
  - Hacer el botón flotante de filtros **+ `<FilterSheet>`** visibles también en el estado vacío
    (para *cambiar* filtros, no solo limpiarlos).
- **NO entra (out of scope):**
  - Proximidad / `radius_m` / expansión de radio → eso es la tarea **#42** (ver Dependencias).
  - Tocar la lógica de `lib/feedProperties.ts` o `lib/filterQuery.ts` (el fix es 100% de UI/estado).
  - Exponer filtros en el estado de **error** de red (causa distinta; {? ver Pregunta 3}).
  - Cambios en el mapa (ya expone filtros hoy vía `MapSearchBar`).

## Roles afectados
Comprador / buscador (el que usa el feed y los filtros). Agente/inmobiliaria y admin: sin cambios.

## Impacto en datos
n/a — no toca BD, RLS, migraciones ni Storage. El `FilterState` ya es cliente-only.

## Impacto en UI
`mobile/src/features/feed/FeedScreen.tsx` (pantalla, NO lógica pura). Reusa:
- `EmptyState` (`src/features/profile/components/EmptyState.tsx`) — ya soporta `dark`, `icon`,
  `message`, `subtitle`, `cta_label`, `onPressCta`. No requiere cambios.
- `useFilters()` (`src/features/search/filterStore.tsx`) — ya expone `clear_filters` y
  `active_filter_count`. No requiere cambios.
- Botón flotante de filtros + `<FilterSheet>` — ya montados en el mismo archivo; solo hay que
  moverlos/duplicarlos para que rendericen en el subárbol del empty state.

⚠️ Branding: gate **LEVANTADO** (CLAUDE.md §8). El botón de filtros del feed **ya está shippeado**
(#12, es una desviación aceptada del mockup, que en `urbea-identidad-visual.html` solo muestra
`op-badge` + `vid-count` en `.feed-top`, sin control de filtros in-feed). Este fix **no introduce
lenguaje visual nuevo**: reusa el CTA de píldora de `EmptyState` y el botón de filtros existente.
El mockup **no tiene** una pantalla "feed vacío con filtros", así que la composición exacta es una
**decisión menor de alcance**, no un bloqueo. Ver Pregunta 2.

## Reglas no obvias aplicables
- **Un solo `FilterState` compartido feed↔mapa** vía `FilterProvider` en
  `app/(protected)/_layout.tsx` — `clear_filters()` en el feed también limpia el mapa (deseable
  aquí). — `[[busqueda-y-filtros]]`, `[[feed-vertical-video]]` · `wiki/codebase/mapa-codebase.md` L59.
- **Criticidad TDD determinista por path**: `FeedScreen.tsx` es pantalla (`features/**/*.tsx` de UI,
  NO `lib/**`/`hooks/**`/`utils/**`) → **NO crítica** → verificación ligera (`pnpm tsc --noEmit` +
  `pnpm lint` + smoke). No requiere ciclo RED/GREEN. — CLAUDE.md §5.
- **PNPM siempre** para tsc/lint. — CLAUDE.md §3.

## Arquitectura / enfoque técnico  (L/XL — n/a para fixes)
n/a (fix de UI localizado en un archivo).

## Fases / épicas  (L/XL — n/a para cambios chicos)
n/a.

## Criterios de aceptación
- [x] Con ≥1 filtro activo y 0 resultados, el feed muestra el copy **"No hay propiedades con estos
      filtros"** y un CTA **"Limpiar filtros"** que ejecuta `clear_filters()` y recarga el feed.
      *(decidido: P1 ambas acciones, P2 copy exacto)*
- [x] Con 0 filtros activos y BD vacía, el feed conserva el copy/CTA actual ("Aún no hay
      propiedades" → "Publicar propiedad"). *(decidido: P2)*
- [x] El botón flotante de filtros y el `FilterSheet` son alcanzables desde el estado vacío
      (el usuario puede *cambiar* filtros, no solo limpiarlos), sin salir al mapa.
      **Renderizarlos UNA sola vez fuera de los early-returns** (evita drift de JSX). *(decidido: P1)*
- [x] El estado de **error de red** NO expone filtros: conserva solo "Reintentar". *(decidido: P3)*
- [x] Tras limpiar/cambiar filtros, el feed re-consulta sin reinicio manual (el `useEffect` por
      identidad de `filters` ya lo cubre).
- [x] `pnpm tsc --noEmit` y `pnpm lint` en verde.
- [ ] **Nota para coordinar con #42** (no bloquea este fix): cuando aterrice `radius_m`, el default
      (5000) NO debe contar como filtro activo en `get_active_filter_count` — solo si el usuario lo
      cambia — para que el copy "con estos filtros" no aparezca de forma espuria. *(decidido: P4)*

## Dependencias
- Código a reusar (rutas reales): `FeedScreen.tsx`, `EmptyState.tsx`, `filterStore.tsx`
  (`useFilters`/`clear_filters`/`active_filter_count`), `FilterSheet.tsx`. Todo ya existe.
- **Interacción con tarea #42** (proximity + filters, *pending*, dep 40/41): #42 añade `radius_m`
  a `FilterState` y una **expansión progresiva de radio** cuando el resultado sale vacío, además
  de rediseñar la paginación. **No hay conflicto de alcance** (#42 toca `lib/feedProperties.ts`,
  `lib/mapProperties.ts`, `FilterSheet.tsx`, `MapScreen.tsx` — **no** el empty state de FeedScreen).
  Este fix es **independiente y más pequeño**; puede shippear antes de #42. Nota de secuenciación:
  cuando #42 aterrice, `EMPTY_FILTERS` incluirá `radius_m: 5000`, por lo que "Limpiar filtros"
  reseteará el radio automáticamente (comportamiento correcto, sin trabajo extra). Ver Pregunta 4.

## Edge cases / riesgos
- **Falso "vacío"**: distinguir bien `active_filter_count > 0` de BD-vacía; si `active_filter_count`
  no contempla algún grupo, un filtro activo podría leerse como BD-vacía (mostraría el copy
  equivocado). Mitigación: `get_active_filter_count` ya cubre todos los grupos del `FilterState` hoy.
- **Zona muerta futura**: si #42 añade `radius_m` al conteo de `active_filter_count`, el default
  5000 no debe contar como "filtro activo" o el empty state siempre diría "con estos filtros".
- **Duplicación de JSX** del botón/sheet entre subárboles: preferir refactor mínimo que renderice
  el botón+sheet una sola vez fuera de los early-returns (evita drift). Riesgo bajo.

## Plan de pruebas (alto nivel)
- **NO crítico** (pantalla) → sin TDD estricto. Verificación ligera:
  - `pnpm tsc --noEmit` + `pnpm lint`.
  - Smoke manual/Maestro: aplicar un filtro imposible (p.ej. zona inexistente) → verificar copy
    "con estos filtros" + CTA "Limpiar filtros" → tocar → feed vuelve a poblarse. Reusar/extender
    `mobile/e2e/*` (ver `botonera.yaml`/`feed-interaccion.yaml`) si se quiere cobertura E2E.
  - Verificar que con BD vacía y sin filtros el copy sigue siendo el de "sé el primero en publicar".

## Impacto en PRD (solo referencia — NO se edita)
Fix de UX; no cambia contrato de producto. Toca la experiencia de "búsqueda/filtros" descrita en
`docs/PRD.md` §9 (feed) sin alterar su alcance.

## Decisiones del intake
Todas resueltas por el usuario (2026-07-09), opciones recomendadas:
1. **Acciones en el empty state filtrado → AMBAS.** CTA "Limpiar filtros" (`clear_filters()`) +
   botón flotante de filtros/`FilterSheet` visible para *cambiar* filtros. Renderizar el
   botón+sheet **UNA sola vez fuera de los early-returns** para evitar drift de JSX.
2. **Copy del estado filtrado-vacío → "No hay propiedades con estos filtros".** El estado de
   BD-vacía conserva su copy/CTA actual ("Aún no hay propiedades" → "Publicar propiedad").
3. **Error de red → NO se exponen filtros;** se mantiene solo "Reintentar".
4. **`radius_m` (#42) → NO cuenta como filtro activo con su default (5000);** solo si el usuario lo
   cambia. Queda como nota/criterio de coordinación con #42, no bloquea este fix.

## Promoción / descarte
Listo para promover a **UNA tarea `fix` nivel S (no crítica)**. Sin huecos ni gate de branding.
Comando sugerido tras `add-task`: `/tm-plan <id>`.
