# 026 — Extracción del sistema de LAYOUT (tarea #26.2)

> Fuente: `Urbea Prototipo (standalone).html` (raíz, export Claude Design, bundle React).
> Método: render en navegador (Chrome MCP) + `getComputedStyle` sobre los frames de teléfono reales.
> ⚠️ **Solo layout.** Color y tipografía los manda la identidad canónica (`theme.ts` + `urbea-identidad-visual.html`). No se extrae nada visual de aquí.

## 0. Hallazgo transversal (leer primero)
El prototipo **no sigue una rejilla base-4 estricta**: usa valores off-grid (11, 13, 18, 30 px) mezclados con 8/12/16. Por eso la regla de adopción es:

> **Mapear la _intención_ de layout del prototipo a la escala base-4 ya viva en `theme.ts`** — no copiar los px sucios. Solo se agregan los escalones genuinamente faltantes y los tokens de grid/inset que hoy no existen.

Confianza de los valores: **alta** en geometría estructural (frame, grid, inset de página, gutters); **media** en micro-spacing (gaps internos, varían por pantalla).

## 1. Frame / lienzo de pantalla
| Token | Valor medido | Confianza | Nota |
|---|---|---|---|
| Ancho lógico de pantalla | **390 px** | alta | iPhone 14/15 logical. En RN = ancho del device, no token. |
| Alto lógico | 844 px | alta | idem |
| Radio de bezel del device | 46 px | alta | **No portar** — es el marco del teléfono, no UI de la app. |
| **Inset horizontal de página** | **18 px / lado** | alta | Confirmado por geometría del grid (390 − 354 = 36 → 18). Padding lateral del contenido scrolleable. |
| Ancho de contenido | 354 px | alta | 390 − 2×18. |

## 2. Grid / columnas / gutters
| Caso | Columnas | Gutter | Confianza |
|---|---|---|---|
| **Grid 2-col** (PropertyGridCard — perfil/mis-publicaciones) | `170px · 170px` (en 354 de ancho) | **14 px** | alta |
| Grid 3-col (chips / stats / contadores) | `112px ×3` | ~10 px | media |

> Col de 2-col = `(content_width − gutter) / 2` = `(354 − 14)/2` = 170. Derivable; no hace falta tokenizar el ancho de columna, solo el **gutter** y el **inset**.

## 3. Escala de espaciado observada → mapeo base-4
Histograma dentro de los frames (px → veces), mapeado a la escala de `theme.ts`:

| Prototipo (px) | Rol observado | → token theme.ts | Acción |
|---|---|---|---|
| 4 | micro gap | `s_4` | existe |
| 6, 10 | gaps off-grid | `s_8` (redondeo) | mapear, no agregar |
| 8 | gap base | `s_8` | existe |
| 12, 13 | gap / padding tarjeta | `s_12` | existe (13→12) |
| 14 | **gutter de grid** | nuevo `gutter` | **agregar** (§5) |
| 16 | padding contenedor | `s_16` | existe |
| 18 | **inset de página** | nuevo `s_20` ó `s_16` | **agregar `s_20`** (§5) |
| 22 | separación media | `s_24` | mapear |
| 30 | separación de sección | `s_32` | mapear |
| 40 | gap grande (showcase/secciones) | nuevo `s_40` | **agregar** (§5) |

## 4. Anatomía de layout por pantalla (estructura, sin color/tipo)
- **Feed (oscuro):** superficie full-bleed 390×844 (sin inset lateral en el video); overlays de acción anclados a bordes con padding ~18; barra inferior de navegación sobre el contenido. Gap vertical de sección ~40 entre bloques de showcase.
- **Detalle:** scroll vertical; media arriba full-bleed; cuerpo con inset de página 18; secciones separadas ~24–30; CTAs anclados abajo.
- **Wizard (claro):** pasos con inset 18; campos apilados con gap ~12–16; barra de progreso arriba; botón primario al pie.
- **Perfil (claro):** header de identidad + **grid 2-col** de PropertyGridCard (gutter 14, inset 18); ya implementado en #16, este doc lo confirma.
- **CRM (claro):** lista vertical de leads; filas con padding interno ~13; separadores; gaps ~8–12.

> La anatomía fina por pantalla se profundiza en `wiki/conceptos/layout-anatomy-screens.md` (26.5) y se ajusta en cada tarea de pantalla (Feed #9, Detalle #10, CRM #15) con sus propias mediciones.

## 5. Tokens a agregar en `theme.ts` (insumo para 26.3)
Operación **aditiva** sobre `mobile/src/theme/theme.ts` (no romper exports).

**Spacing — escalones faltantes (MEDIDOS del prototipo):**
- `s_20: 20` ← inset de página 18px, redondeado a base-4 (medido).
- `s_40: 40` ← gaps de sección grandes (medido).

**Spacing — inferidos por escala (INFERIDOS, marcar `// ponytail:`):**
- `s_48: 48`, `s_64: 64` — solo si una pantalla futura los necesita. **No agregar ahora** (YAGNI); se añaden cuando aparezcan.

**Nuevo grupo `layout` (MEDIDO):**
```ts
export const layout = {
  screen_inset: 20,   // inset horizontal de página (prototipo 18 → base-4 20)
  grid_gutter: 14,    // separación entre columnas del grid de tarjetas (medido)
  grid_cols: 2,       // grid de propiedades por defecto
};
```
- `screen_inset`: prototipo midió 18; se adopta **20** para alinear a base-4 (decisión de 26.3; alternativa: respetar 18 exacto — anotar en el commit).
- `grid_gutter: 14`: medido exacto; se respeta (no hay escalón base-4 intermedio limpio y el grid depende de él).

**Radios:** el prototipo usa 13–20px en tarjetas. `theme.ts` ya tiene `r_12/r_16/r_24`. Mapear card→`r_16`. **No agregar** `r_20` salvo que una pantalla lo exija (YAGNI).

## 6. Resumen para el ejecutor de 26.3
Agregar a `theme.ts`, solo aditivo: `spacing.s_20`, `spacing.s_40`, y `export const layout = { screen_inset, grid_gutter, grid_cols }` (incluirlo en el `default export`). Nada más. Gate: `pnpm tsc --noEmit` + `pnpm lint`.
