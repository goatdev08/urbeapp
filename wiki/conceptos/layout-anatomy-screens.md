---
tipo: concepto
dominio: ui
estado: vivo
fuentes: ["Urbea Prototipo (standalone).html", .taskmaster/docs/exploraciones/026-layout-system-extraction.md]
codigo: [mobile/src/theme/theme.ts]
actualizado: 2026-06-28
---

# Anatomía de layout por pantalla

> Esqueleto estructural de cada pantalla de la demo, extraído del **prototipo de layout** (#26). Da el punto de partida de acomodo/espaciado a cada tarea de pantalla; **cada tarea lo refina** con sus propias mediciones. Solo layout — color y tipografía los manda [[design-system]] (identidad canónica).

## Tokens de layout (de `theme.ts`, grupo `layout`)
- `screen_inset = 20` — padding horizontal de página (prototipo midió 18 → base-4 20).
- `grid_gutter = 14` — separación de columnas del grid de tarjetas.
- `grid_cols = 2` — grid de propiedades por defecto.
- Frame lógico: **390×844**. El bezel r46 es del device, no se porta. Contenido ancho 354 = 390 − 2×20 (≈ 354 medido con inset 18; con inset 20 el contenido es 350).
- Spacing vertical: escala base-4 (`s_8`/`s_12`/`s_16`/`s_24`/`s_32`/`s_40`). Secciones grandes = `s_40`; bloques = `s_24`/`s_32`; dentro de bloque = `s_8`/`s_12`.

> ⚠️ El prototipo es **off-grid** (11/13/18/30 px). Aquí ya está mapeado a la escala base-4. Al implementar, usa los tokens, no los px crudos del prototipo.

## Convenciones transversales
- **Inset de página:** `layout.screen_inset` a izq/der de todo el contenido scrolleable. Excepción: media **full-bleed** (feed, hero de detalle) sin inset.
- **Barra inferior** (tab/acciones): anclada, sobre el contenido; respetar safe-area inferior.
- **Header:** anclado arriba; respetar safe-area superior (notch).
- **Grid de tarjetas:** `numColumns=2`, gutter `layout.grid_gutter`, celda = `(ancho_contenido − gutter) / 2`.

## Pantallas (descubrimiento — oscuro/inmersivo)
### Feed vertical (#9)
- Superficie **full-bleed** 390×844, sin inset lateral (video vertical 9:16).
- Overlays anclados a bordes con padding `s_20`: meta del agente/propiedad (abajo-izq), columna de acciones like/save/contacto (abajo-der).
- Barra de navegación inferior sobre el video.
- Sin scroll interno por tarjeta; paginación vertical pantalla-a-pantalla.

### Detalle de propiedad (#10)
- **Hero media full-bleed** arriba (sin inset); resto con inset `s_20`.
- Cuerpo scroll: bloques separados `s_24`–`s_32` (precio-héroe, specs/hairlines, descripción, ubicación/mapa, agente).
- **CTA de contacto anclado** abajo (WhatsApp), sobre safe-area.

### Mapa global (backlog)
- Mapa full-bleed; controles/chips flotantes con inset `s_20`; bottom-sheet de resultados.

## Pantallas (gestión — claro/editorial)
### Wizard publicar (#8, vivo)
- Header con StepIndicator arriba; contenido con inset `s_20`.
- Campos apilados con gap `s_12`–`s_16`; grupos separados `s_24`.
- Botón primario al pie (anclado o al final del scroll).

### Perfil del agente (#16, vivo)
- `ProfileHeader` (avatar + identidad + agencia) con inset `s_20`, separado `s_24` del grid.
- **Grid 2-col** de `PropertyGridCard` (`grid_cols`, `grid_gutter`), inset de página.
- `EmptyState` centrado cuando no hay propiedades.

### Mis publicaciones (#17, vivo)
- FilterTabs arriba (inset `s_20`); lista vertical de `PropertyListItem`.
- Filas con padding interno `s_12`–`s_16`, separadas por hairline o gap `s_8`.

### CRM / leads (#15, backlog)
- Embudo segmentado arriba (7 estados); lista de leads.
- Filas con padding `s_12`; agrupación por estado; gaps `s_8`–`s_12`.

### Guardados / cuadrícula (falta tarea)
- Grid 2-col idéntico a perfil (`grid_cols`/`grid_gutter`, inset `s_20`).

## Relacionados
[[design-system]] · [[perfil-agente]] · [[propiedades-y-video]]
