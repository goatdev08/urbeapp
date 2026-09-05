---
tipo: feature        # feature | fix | refactor | chore | proyecto
nivel: M             # XS | S | M | L | XL — tamaño estimado; define la profundidad del doc
fecha: 2026-09-05     # absoluta
estado: borrador      # borrador → en-revision → aprobado | descartado
tarea_id:             # id(s) de Taskmaster; se llena SOLO al promover (estado: aprobado)
motivo_descarte:      # se llena SOLO si estado: descartado
---

# Rediseño del pin del mapa

> Documento de exploración/planeación de `/tm-explore`. Un archivo por idea.
> Puede **APROBARSE** (→ se promueve a tarea[s] en Taskmaster) o **DESCARTARSE**
> (queda en el repo como registro de decisión, sin crear tarea).
> NO edita los PRD maestros (`docs/PRD-MVP-demo.md`, `docs/PRD.md`); "Impacto en PRD" es solo referencia.

## Idea original

> "rediseño del pin del mapa" — pendiente de producto ya anunciado por Abraham (2026-09-05, junto
> con remodelación del feed, comentarios, follow y CRM visual). El pin actual del mapa de propiedades
> se siente pobre y no comunica lo que debería (precio, tipo, estado de la propiedad, si ya la viste).

Registrado en memoria como [[roadmap_pendientes_sep_2026]].

## Lluvia de ideas (solo si la idea era abstracta)

La idea llegó **abstracta** ("se siente pobre") con una lista de deseos que no cabe entera en un
marcador de 38 px. Cuatro direcciones reales, con su trade-off:

### A — Volver al mockup: pin canónico + price tag + estado seleccionado
El marcador se queda como está (`MapPinIcon` duotone, color por operación) y **recupera la pastilla
de precio** que el mockup canónico sí dibuja (`.mpriceTag`, `urbea-identidad-visual.html:444` y
pantalla 6, línea 930) y que el código perdió en el flash del 2026-07-06. Se añade estado
seleccionado (hoy tocar un pin no cambia el pin). El cluster se alinea o no con el mockup (ver P7).

- **A favor:** es la dirección con menos riesgo de diseño — el price tag **ya está aprobado** en el
  mockup y en el componente de firma "Pin de mapa" (`:701`). Reusa `format_compact_price`, que existe
  desde #11.4 y hoy está **huérfano** (0 llamadores en producción tras el flash).
- **En contra:** no resuelve "ya la viste" ni "tipo" ni "estado" — solo el precio. Y cada pastilla
  es un marcador custom más pesado → riesgo directo sobre #64 (ver Riesgos).
- **Encaje:** perfecto con el stack (JS puro, OTA-safe, sin dependencia nueva).

### B — La pastilla de precio ES el marcador (estilo Zillow / Idealista)
Se abandona la gota/pin y el marcador pasa a ser una píldora con el precio, con fondo por operación
(salvia renta / arcilla venta); punto pequeño cuando el precio no aplica.

- **A favor:** máxima densidad legible; es el patrón que el usuario ya conoce de portales
  inmobiliarios; el color de operación gana muchísima más superficie que hoy.
- **En contra:** **tira una decisión de hace tres semanas.** Abraham eligió `MapPinSimple` sobre la
  gota el 2026-08-16 (#185) y pidió los dos tonos el mismo día (#186); `MapPinIcon` es hoy el pin
  ÚNICO de la app (mapa global, `MapPicker` del wizard, mapa del detalle, tab de Mapa). Cambiarlo
  solo en el mapa global rompe esa consistencia recién construida.
- **Encaje:** técnico bueno, de producto caro. Solo tiene sentido si Abraham quiere revisitar #185.

### C — [REC] Pin de dos niveles por zoom (progressive disclosure)
Un solo componente con dos presentaciones que decide el **zoom que el mapa ya tiene en estado**
(`region.longitudeDelta`, `MapScreen.tsx`):
- **lejos** → el pin de hoy, solo color de operación (idéntico a producción, cero regresión);
- **cerca** (delta < umbral) → pin + pastilla de precio + marca discreta de "visto/guardado";
- **seleccionado** → pin ampliado y elevado, en cualquier nivel.

- **A favor:** resuelve las dos quejas a la vez sin elegir entre ellas — el pin comunica más cuando
  hay espacio y no satura cuando no lo hay. **Reusa el estado que ya existe** (`region` ya vive en
  `MapScreen` y ya alimenta `cluster_properties`), no añade estado nuevo ni dependencias. Y acota el
  riesgo de perf: las pastillas solo se montan cuando quedan pocos pines en pantalla.
- **En contra:** un umbral que hay que **calibrar en dispositivo físico**, no en emulador; y dos
  presentaciones = más superficie que verificar. El cambio de presentación al cruzar el umbral obliga
  a reactivar `tracksViewChanges` (contenido que cambia después del mount) — exactamente el punto
  ciego de #64.
- **Encaje:** el mejor con las reglas del proyecto: respeta el mockup (el nivel cercano ES el mockup),
  respeta #185/#186 (el pin no cambia de forma) y es 100 % JS → viaja por OTA.

### D — No tocar el pin; mover la carga al mini-card y a una lista de resultados
El marcador se queda intacto y toda la información nueva (precio con divisa, tipo, estado, visto)
entra al `PropertyMiniCard` y/o a un carrusel horizontal de resultados sobre el mapa.

- **A favor:** riesgo cero sobre el marcador (perf y #64 intactos) y espacio de sobra para cualquier
  señal. Cierra de paso la deuda conocida del mini-card (no muestra divisa).
- **En contra:** **no responde a la queja literal.** Abraham dijo "el pin se siente pobre"; esto deja
  el pin igual de pobre y agranda el alcance a otra pantalla.
- **Encaje:** bueno, pero es otra tarea (mejora del mini-card), no ésta.

**Recomendación: C**, con el contenido de A como nivel cercano. **A** es el fallback digno si se
quiere el cambio más chico posible. **B** solo si se reabre #185. **D** debería existir igual, pero
como tarea aparte.

## Problema / Motivación

El mapa (`(tabs)/map.tsx` → `MapScreen`) es una de las ~13 pantallas canónicas de la demo
("6 · MAPA global"). Hoy el marcador transmite **exactamente un bit de información**: el color del
disco (salvia = renta, arcilla = venta o ambos). Todo lo demás — precio, tipo, dirección — exige
**tocar el pin** para que aparezca el `PropertyMiniCard`. En un mapa con hasta 64 marcadores en
pantalla (el grid de `cluster_properties` es 8×8), eso convierte la comparación de opciones en una
secuencia de taps, que es justo lo que un mapa debería evitar.

Hay además una **divergencia real y no documentada como decisión** entre el mockup canónico y el
código: el mockup dibuja `mpriceTag` bajo cada pin ("$15k", "$2.4M"), y el código lo quitó en la
sesión flash del 2026-07-06. La consecuencia mecánica es que `format_compact_price`
(`features/map/lib/formatPrice.ts`, escrita con TDD en #11.4) **no tiene un solo llamador de
producción hoy** — es código vivo sin consumidor. Recuperar el price tag no es "agregar UI nueva":
es volver al mockup y darle uso a algo que ya está escrito y probado.

Encaje con el hito: la demo cerrada ya pasó; esto es **producción viva** (CLAUDE.md §0.5) con
personas reales probando la app, así que el listón es "no romper builds instalados", no "llegar a la
demo".

## Resultado esperado

Abriendo el tab **Mapa** con propiedades cerca:

1. A zoom de ciudad, los marcadores se ven como hoy — color de operación, sin ruido.
2. Al acercarse a nivel colonia/calle, cada marcador muestra su **precio compacto** legible sin
   tocarlo, y las propiedades que la persona ya vio se distinguen de las que no.
3. Al tocar un marcador, **el marcador mismo responde** (se agranda / se eleva) además de abrir el
   mini-card; al tocar el mapa, vuelve a su estado normal.
4. El precio que muestra el pin **coincide con el del detalle** — misma divisa, y "Precio a consultar"
   cuando el agente ocultó el precio.
5. Nada de esto exige un rebuild nativo: viaja por `pnpm ota`.

## Alcance

- **SÍ entra:**
  - `PropertyMarker.tsx` — presentación nueva del marcador de propiedad.
  - `ClusterMarker.tsx` — solo si se decide alinear su color al mockup (P7).
  - `MAP_SELECT` en `lib/mapProperties.ts` + `MapProperty` en `types.ts` — columnas que el pin
    necesite (`currency`, `price_visible`; ver P6).
  - La fuente de "ya la viste" que se elija en P4 (hook nuevo en `features/map/hooks/` o reuso).
  - Estado seleccionado del pin (`MapScreen.tsx` ya tiene `selected`; hoy no se lo pasa al marcador).
  - Preview HTML aprobable del pin nuevo (es componente de firma, ver §8).
- **NO entra (out of scope):**
  - Rediseño del `PropertyMiniCard` (dirección D) — tarea aparte.
  - `MapPicker.tsx` (wizard paso 3) y el mapa del detalle — salvo que P9 diga lo contrario.
  - Cambiar `MapPinIcon` de forma / volver a la gota (eso reabre #185 — decisión de Abraham, no de
    esta exploración).
  - Cambiar qué propiedades trae el mapa (hoy `status='active'` + `deleted_at is null`).
  - El algoritmo de clustering (`cluster_properties`) — sigue igual.

## Roles afectados

- **Comprador / buscador** — es quien recibe todo el valor: comparar precios sin tocar cada pin y
  saber qué ya vio. Único rol con cambio de experiencia real.
- **Inmobiliaria + agente** — indirecto: su propiedad se vuelve más comparable en el mapa (el precio
  queda expuesto de un vistazo). Si se decide mostrar un badge de "promocionada" (#213), el agente
  gana visibilidad; eso es una decisión de producto, no de diseño (P5).
- **Admin de plataforma** — sin cambio.

## Impacto en datos

**Sin migración, sin Edge Function, sin RLS nueva** en las direcciones A/C/D con las fuentes
recomendadas. Lo que se toca es la **proyección** del cliente, no el schema:

- `MAP_SELECT` (`lib/mapProperties.ts:85`) hoy es
  `id, price, address, property_type, operation_type, bedrooms, bathrooms, location`.
  Le faltan **`currency`** y **`price_visible`** — ambas existen en `properties` en producción desde
  el 2026-08-15 y el detalle ya las lee (`usePropertyDetail.ts:127`). Añadirlas al select es
  aditivo y seguro (§0.5.2: leer una columna que ya existe no rompe ningún build instalado).
- "Ya la viste" — `events_raw` (0007) ya guarda `video_view` / `video_completed` con `property_id`
  (`features/feed/lib/videoEngagementDedupe.ts:52-58`), y su policy de SELECT desde
  `20260809000001` incluye la rama **`user_id = auth.uid()`** → **la persona puede leer sus propios
  eventos sin migración ni RPC nueva.**
  🔒 Ojo con [[privacidad-registrar-no-es-exponer]]: aquí NO se cruza la línea porque el usuario lee
  **sus propias filas**, no el comportamiento de terceros. Cualquier variante que muestre "otras N
  personas la vieron" sí la cruzaría y sería otra conversación.
- "Guardada" — `saves` (0006) ya se lee desde el cliente por dueño
  (`features/saved/hooks/useSavedProperties.ts:92`). Reuso directo.
- {? P5 — si "estado" resultara significar vendida/rentada, sí habría cambio de datos: el mapa hoy
  filtra `status='active'` y esas propiedades ni siquiera llegan. Eso convertiría la tarea en L.}

## Impacto en UI

Pantalla **6 · Mapa global** (`app/(protected)/(tabs)/map.tsx` → `MapScreen.tsx`).

- `PropertyMarker.tsx` — el componente que se rediseña.
- `ClusterMarker.tsx` — condicional a P7.
- `PropertyMiniCard.tsx` — **no se rediseña**, pero arrastra la misma deuda de divisa
  (`format_full_price` es MXN implícito); si P6 añade `currency` al select, cerrarla aquí sale casi
  gratis y evita que el pin y el mini-card muestren precios distintos en la misma pantalla.

⚠️ **El "Pin de mapa" ES un componente de firma del kit** — tiene su propia celda en la galería de
componentes de `urbea-identidad-visual.html:701` (junto a "Play · feed", "Anillo de avatar" y
"Loader"). Por CLAUDE.md §8 y [[design-system]], eso significa **preview HTML aprobable por el
cliente antes de portar a RN**, no mini-spec escrito. El gate global de branding está LEVANTADO
(2026-06-26); lo que aplica es la aprobación **por pantalla/componente**.

Nota de coherencia: `CLAUDE.md` §8 dice Salvia `#5A8A5E`, pero `theme.ts:23` tiene
`primary: '#1A5E44'`. El preview debe montarse con el valor de `theme.ts` (fuente de verdad del
código), no con el del texto de §8.

## UI/interacción fuera del mockup

`urbea-identidad-visual.html` **abierto y comparado** (galería de componentes `:694-712`, CSS del
mapa `:428-445`, pantalla 6 `:923-946`). Resultado de la comparación:

**Lo que el mockup SÍ dibuja y el código NO tiene** (esto NO es UI fuera del mockup — es volver a él):
- Pastilla de precio bajo el pin (`.mpriceTag`: display 600, 11 px, fondo blanco, borde `silver`,
  `r_pill`, sombra `sh_sm`, `margin-top:3px`). El mockup la pinta en 2 de sus 4 pines, y la deja
  fuera del tercero — es decir, el propio mockup ya contempla un pin **sin** precio.
- Cluster en **arcilla** (`.mclus` → `var(--color_accent)`); el código usa `colors.ink`.

**Lo que el mockup NO dibuja y esta idea pide** — UI fuera del mockup, se declara:

1. **Marca de "ya la viste"** · el mockup no tiene ningún estado de visitado en ningún pin · **costo S**
   (fuente de datos + hook + presentación + su verificación).
   - opción 1 (en conjunto): entra en esta tarea; implica decidir P3/P4 antes de diseñar el preview,
     porque la marca cambia la anatomía del pin y el preview tiene que mostrarla.
   - opción 2 (**DEFAULT**): derivada → `producto(<origen>): marca de "ya la viste" en el pin del mapa`
     · *Origen: tarea de rediseño del pin · Detectado por: /tm-explore (comparación contra
     `urbea-identidad-visual.html`, pantalla 6)*. El pin se rediseña primero con lo que el mockup ya
     aprueba (precio + seleccionado) y la marca de visto llega después con su propio preview.

2. **Estado seleccionado del pin** · el mockup dibuja los 4 pines idénticos, ninguno "activo", pese a
   que la pantalla 6 muestra el mini-card abierto — o sea, el mockup tiene una propiedad seleccionada
   y su pin no lo refleja · **costo XS**.
   - opción 1 (en conjunto): entra en esta tarea. Es la pieza más barata y la que más se nota: hoy
     `MapScreen` ya sabe cuál está `selected` (`:170`) y simplemente no se lo pasa al marcador.
   - opción 2 (DEFAULT formal): derivada `producto(<origen>): estado seleccionado del pin`. Aquí el
     default es discutible — separarlo cuesta un PR entero para ~10 líneas.

3. **Badge de estado ("nuevo" / "promocionada")** · el mockup no dibuja badges sobre los pines ·
   **costo S**.
   - opción 1 (en conjunto): entra, pero solo tiene sentido si P5 se resuelve primero — hoy "estado"
     no tiene un significado unívoco en el mapa (todo lo que llega ya es `active`).
   - opción 2 (**DEFAULT**): derivada → `producto(<origen>): badge de estado en el pin del mapa`,
     dependiente de la decisión de P5.

## Reglas no obvias aplicables

- 🔴 **`tracksViewChanges` no se puede fijar en `false` desde el primer render** — Android toma un
  snapshot nativo del marcador custom y, si se congela antes de que el SVG pinte, deja su **pin rojo
  default visible y duplicado**. Fix vigente: arranca `true`, congela a `false` a los 300 ms
  (`PropertyMarker.tsx:58,67-73`). **Cualquier contenido que cambie DESPUÉS del mount (precio que
  aparece al cruzar un umbral de zoom, marca de visto que llega por red, estado seleccionado) obliga
  a reactivarlo** — es decir, este rediseño pisa exactamente la trampa de #64.
  — [[mapa-y-ubicacion]] §"Fix: pin rojo default duplicado en Android"
- 🔴 **Un componente nuevo se valida en build de producción sobre dispositivo FÍSICO, no en emulador.**
  #244 (Reanimated sobre props de SVG animó en ambos emuladores y quedó muerto en el Android real) y
  #245 (el loader colapsado a la esquina) tuvieron el mismo punto ciego, seguidos. Si el pin nuevo se
  anima, **`Animated` clásico con `useNativeDriver:false`**, no Reanimated sobre SVG.
  — [[reanimated_svg_muere_en_build_produccion]] · [[design-system]] · `wiki/estado/estado-actual.md`
- 🔒 **`events_raw` fue reescrito dos veces en 24 h; leer [[privacidad-datos]] antes de tocarlo.** La
  condición correcta para una tabla de comportamiento **no es "soy dueño del objeto" sino "tengo una
  relación vigente con la persona"**. Aquí el caso es el más simple posible (leer las propias filas),
  pero la regla manda que se declare explícitamente.
  — [[rls-seguridad]] §🔒 `events_raw` · `supabase/migrations/20260809000001_events_raw_lead_gate.sql`
- **Criticidad TDD determinista por path** — `components/**` es **NO crítica** → verificación ligera
  (`pnpm tsc --noEmit` + `pnpm lint` + smoke). Pero si el rediseño toca `features/map/lib/**` (p. ej.
  un `pin_presentation(region, property)` puro) eso **sí es crítico → TDD estricto**. Diseñar la
  lógica de "qué muestra el pin" como función pura en `lib/` es la forma de ganar red de seguridad
  real en un cambio que de otro modo solo tendría tsc+lint. — CLAUDE.md §5
- **Componente de firma → preview HTML aprobable antes de portar a RN**; ReactBits/galerías web son
  referencia, NO import; recrear con primitivas RN. — CLAUDE.md §8 · [[design-system]] §"Elementos de
  firma"
- **Producción viva §0.5**: cambio 100 % JS → viaja por `pnpm ota` desde `main` ya mergeado; ninguna
  dependencia nativa nueva (si el diseño pidiera una, deja de ser OTA y exige rebuild + subir
  `version`). Verificar entrega real del OTA, no NO-OP. — CLAUDE.md §3, §0.5.3
- **El contorno del pin sigue el tema del dispositivo solo en iOS** — en Android los tiles de Google
  no oscurecen, un contorno marfil sería un pin invisible (`MapPinIcon.tsx:22-27`). El diseño nuevo
  hereda este guard: cualquier color nuevo del pin necesita contraste sobre tiles **claros** en
  Android y sobre claros **y** oscuros en iOS.
- **Deuda conocida vigente:** "el mini-card del mapa aún no muestra divisa" y hay **dos**
  `formatPrice` distintos (`src/lib/formatPrice.ts` global vs `features/map/lib/formatPrice.ts`
  compacto). No confundirlos. — `wiki/codebase/mapa-codebase.md` §quick fixes 2026-08-15

## Arquitectura / enfoque técnico  (L/XL — n/a para fixes)

n/a como arquitectura de capas (no hay Edge Function, RPC ni migración). Nota de diseño de código,
que sí importa por la regla de criticidad de arriba:

La decisión de "qué muestra este pin" (nivel de zoom, precio formateado, visto, seleccionado) debería
vivir como **función pura en `features/map/lib/`** — p. ej. `pin_presentation(...)` → un objeto de
presentación — y `PropertyMarker.tsx` limitarse a pintarlo. Precedente directo en esta misma feature:
`viewportToArea.ts` y `clusterMarkers.ts` son lógica pura con TDD, y los componentes quedaron finos.
Eso mueve la parte falible del cambio a un path **crítico** (`lib/**` → TDD estricto + guardian) en
vez de dejarla en `components/**`, donde la única red es tsc/lint.

Se reusa (rutas reales):
- `features/map/lib/formatPrice.ts` — `format_compact_price` (hoy sin llamadores; ver Motivación).
- `src/lib/formatPrice.ts` — `format_price(price, currency)` si se decide mostrar divisa.
- `src/components/MapPinIcon.tsx` — el pin canónico, sin cambiar su forma.
- `MapScreen.tsx:170` — el estado `selected` ya existe.
- `MapScreen.tsx` `region` — el zoom ya está en estado y ya alimenta `cluster_properties`.
- `features/saved/hooks/useSavedProperties.ts` — patrón de lectura de `saves`.
- `features/feed/lib/videoEngagementDedupe.ts` — los strings exactos `video_view`/`video_completed`
  (un typo de un lado da 0 resultados en silencio; el archivo lo advierte).

## Fases / épicas  (L/XL — n/a para cambios chicos)

n/a — es una tarea M. Orden natural de subtareas al promover (lo fija `/tm-plan`, no esta
exploración): decisiones de P1–P9 → preview HTML aprobable → `lib/` con TDD → `components/` →
`MAP_SELECT`/tipos → smoke en dispositivo físico → OTA.

## Criterios de aceptación

- [ ] El preview HTML del pin rediseñado está **aprobado por el cliente** antes de escribir RN
      (componente de firma, §8).
- [ ] A zoom lejano el mapa se ve **sin regresión** respecto a producción (misma densidad, sin
      solapes nuevos).
- [ ] {? P1/P2 — el criterio "el pin muestra X" no se puede cerrar sin decidir qué señales van EN el
      pin y en qué dirección visual (A/B/C/D).}
- [ ] El precio del pin **coincide con el del detalle** para la misma propiedad: misma divisa, y
      "precio oculto" respetado cuando `price_visible = false`.
- [ ] Tocar un pin cambia el pin (no solo abre el mini-card); tocar el mapa lo revierte.
- [ ] {? P3/P4 — el criterio de "ya la viste" no se puede redactar sin definir qué cuenta como
      "vista" y de dónde sale el dato.}
- [ ] **Verificado en Android FÍSICO sobre build de producción** (no emulador): sin pin rojo default
      duplicado, sin marcadores en blanco, animación (si la hay) viva. Precedente #244/#245.
- [ ] Verificado en simulador iOS en tema claro **y oscuro** (el contorno del pin cambia solo ahí).
- [ ] `pnpm tsc --noEmit` y `pnpm lint` en 0; suite Jest completa verde; si hubo `lib/**`, guardian PASS.
- [ ] Sin dependencia nativa nueva → el cambio sale por `pnpm ota` y se verifica **entrega real** del
      runtime, no NO-OP.

## Dependencias

- Código existente a reusar: `mobile/src/features/map/` (componentes, `lib/formatPrice.ts`,
  `MapScreen.tsx`), `mobile/src/components/MapPinIcon.tsx`, `mobile/src/lib/formatPrice.ts`,
  `mobile/src/features/saved/hooks/useSavedProperties.ts`.
- Decisiones previas que **acotan** esta tarea (no se reabren aquí): **#185** (pin `MapPinSimple`),
  **#186** (dos tonos + guard de tema iOS), **#64** (`tracksViewChanges`), **#11** (cluster en `ink`
  por decisión del grilling).
- Migraciones: ninguna nueva. Depende de que `properties.currency` / `price_visible` existan en
  remoto — **ya aplicadas** (2026-08-15) y ya consumidas por el detalle.
- `events_raw` con la policy de `20260809000001` (solo si se elige esa fuente en P4).
- No depende de ninguna tarea abierta. **Nota de estado:** hay dos migraciones (#255, #257/#258) y un
  OTA pendientes de aplicar a producción; esta tarea no los toca, pero su propio OTA debe ir
  **después** de que ese backlog se resuelva, para no mezclar verificaciones.

## Edge cases / riesgos

- 🔴 **Regresión de #64 (pin rojo duplicado en Android).** Es el riesgo mayor y es específico: el fix
  vigente congela `tracksViewChanges` a los 300 ms asumiendo que **el contenido del marcador no cambia
  después del mount**. Este rediseño rompe ese supuesto por diseño (precio que aparece al cruzar el
  umbral de zoom, marca de visto que llega por red, estado seleccionado). Si no se reactiva, el pin
  se queda congelado en su presentación vieja; si se deja siempre en `true`, se pierde el perf win y
  el mapa re-renderiza por frame con decenas de marcadores.
- 🔴 **Precio incorrecto en producción viva.** `MAP_SELECT` no trae `currency` ni `price_visible`. Un
  price tag hoy escribiría "$15k" sobre una propiedad en **USD** y sobre una con **precio oculto** —
  dos mentiras visibles al cliente y a los testers reales, en la pantalla más comparativa de la app.
  Bloqueante para cualquier dirección que muestre precio.
- **Saturación visual.** El grid de `cluster_properties` es 8×8 → hasta **64 marcadores** por
  viewport; el mockup dibuja 4. Con pastilla de precio en todos, el mapa se vuelve ilegible justo
  donde hay más oferta. Es el argumento central a favor de la dirección C.
- **La red de seguridad es débil por path.** `components/**` es NO crítica → solo tsc/lint/smoke. Y
  los tests RNTL **no ven layout** ([[rntl_no_ve_layout]]): un pin que se colapsa o se solapa deja la
  suite entera en verde. Mitigación: mover la lógica a `lib/` (crítica) + smoke obligatorio en
  dispositivo físico.
- **`format_compact_price` no maneja divisa ni precio oculto** — fue escrita para MXN implícito en
  #11.4. Si se usa tal cual con `currency`, hay que extenderla (y es `lib/**` → TDD).
- **Marcadores sin precio útil**: propiedades con `price_visible=false` o precio 0/nulo. El mockup ya
  contempla un pin sin pastilla, así que hay precedente visual — pero hay que decidirlo, no
  descubrirlo.
- **Coste de red de "ya la viste"** si se resuelve por consulta al montar el mapa: una query más en
  una pantalla que ya hace RPC + PostgREST + (a veces) polígono de colonia.

## Plan de pruebas (alto nivel)

- **CRÍTICO (TDD estricto → fase RED)**: cualquier archivo nuevo o modificado bajo
  `mobile/src/features/map/lib/**` — la función pura de presentación del pin y, si se extiende,
  `format_compact_price` con divisa y precio oculto. Casos: precio en MXN / USD / oculto / cero,
  umbral de zoom justo por encima y por debajo, propiedad vista vs. no vista, seleccionada vs. no.
- **CRÍTICO** si se toca `mapProperties.ts` (es `lib/**`): que las columnas nuevas del select no
  alteren ninguna de las cuatro ramas existentes (colonia → `area` → radio → sin radio). Ya hay
  candados escritos para esas ramas (EC-N1..N7, EC-ZM1..ZM5, EC-MAP-NULL-1..3) — no romperlos.
- **NO crítico (verificación ligera)**: `PropertyMarker.tsx`, `ClusterMarker.tsx`, `MapScreen.tsx`
  → `pnpm tsc --noEmit` + `pnpm lint` + smoke.
- **pgTAP**: n/a (sin migración) — salvo que P5 abra la puerta a cambiar qué propiedades trae el mapa.
- **Deno**: n/a (sin Edge Function).
- **Smoke manual, CON Abraham** ([[testing_manual_juntos_automatizado_solo]]): Android **físico**
  sobre build de producción + simulador iOS en claro y oscuro. Recorrido: abrir Mapa → zoom out /
  zoom in cruzando el umbral → tocar un pin → tocar el mapa → panear → "Buscar en esta zona" →
  seleccionar una colonia (que el polígono y los pines convivan).
- ⚠️ **Cuota real**: si el smoke pasa por el feed para generar el evento de "visto", verificar que
  reproduce y **PARAR** — son minutos facturados de Cloudflare Stream (CLAUDE.md §0.5.5).
- Datos de prueba: el remoto ya tiene propiedades reales de los testers; **no** sembrar ni truncar
  nada en remoto (§0.5.1).

## Impacto en PRD (solo referencia — NO se edita)

`docs/PRD.md` §9 (mapa, radio, dirección exacta) es la sección que una eventual actualización
tocaría, y solo si se aprueba mostrar precio en el marcador como comportamiento de producto. La
promoción al PRD es decisión del dueño, fuera de esta exploración.

## Decisiones del intake

Ninguna todavía — este doc es la **primera pasada** y corrió sin poder preguntar. Las 9 preguntas
abiertas (P1–P9) están en la salida estructurada de `/tm-explore` para resolverse con
`AskUserQuestion`. Al responderlas, este bloque se llena con `pregunta → opción elegida` y las
secciones marcadas `{? …}` se cierran.

## Promoción / descarte

Pendiente. **No promover todavía**: quedan criterios de aceptación abiertos por ambigüedad (P1/P2 y
P3/P4) y una aprobación de diseño sin resolver (el pin es componente de firma → preview HTML
aprobable). Al aprobar: `/tm-plan <id>` con el desglose de subtareas.
