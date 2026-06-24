---
tipo: feature        # feature | fix | refactor | chore | proyecto
nivel: M             # reconciliación de dirección + kit de 3 componentes (artefacto de diseño, no app code)
fecha: 2026-06-23
estado: borrador      # borrador → en-revision → aprobado | descartado
tarea_id:             # vacío: NO promovido. Toca la #19 (branding) — gated.
motivo_descarte:
gate_branding: si     # ⚠️ #19 EN PAUSA hasta visto bueno expreso del cliente (CLAUDE.md §8).
reconcilia: [001-branding-design-system-urbea.md, 002-direccion-visual-terracota-editorial.md]
origen: prototipo Cloud Design del cliente (~/Downloads/Urbea Prototipo.html) + sesión de iteración 2026-06-23
---

# Reconciliación de marca + Kit de personalidad (componentes)

> Documento de exploración. Registra que el **prototipo de Cloud Design** del cliente **reconcilió**
> de facto el conflicto `001` vs `002`, fija las decisiones de la sesión del 2026-06-23, y entrega un
> **kit HTML de componentes** ([003-kit/urbea-personality-kit.html](./003-kit/urbea-personality-kit.html))
> para inyectar personalidad sin cambiar la paleta.
> NO edita PRD maestros, `mobile/**` ni `supabase/**`. **Branding gated (#19).**

## Idea original
El cliente generó en Cloud Design un prototipo completo (~16 pantallas) a partir de los docs de marca.
Le gustan **colores y layout** pero lo ve **plano y genérico**; quiere **personalidad vía componentes
personalizados** (mantener colores, cambiar fuentes permitido).

## La reconciliación 001 ↔ 002 (ya ocurrió en el prototipo)
El prototipo no eligió un doc sobre el otro: **fusionó** ambos. Esto resuelve el conflicto que `002`
dejó abierto.

| Eje | 001 | 002 | **Prototipo = 003 (reconciliación)** |
|---|---|---|---|
| Tema | Dual-mode (feed oscuro + gestión clara) | Claro en todo | **Dual-mode** (toma de 001) |
| Color **primario** | Verde bosque | Terracota | **Salvia `#5A8A5E`** (verde aclarado; toma el rol primario de 001) |
| Color **acento** | Cobre/tierra | — | **Arcilla `#9A7150`** (marrón; hereda el rol de la terracota/arcilla de 002) |
| Logo | Derivado URBEARG | Lettering serif a medida | Wordmark + **isotipo "U+play"** |
| Tipografía | Fraunces + Inter | Fraunces/Canela + sans | **Fraunces + Hanken** (ver nota) |

**Recomendación:** adoptar `003` como dirección vigente. Marcar `001` y `002` como `en-revision` o
`descartado` (decisión del cliente, gated). Sin promover hasta luz verde de #19.

## Diagnóstico — por qué el prototipo se veía "plano" (evidencia del bundle)
1. **Tipografía 100% sans** (Bricolage Grotesque + Hanken) — ignoró el **serif editorial** que pedían
   ambos docs. *Causa #1.*
2. **Componentes sin firma:** rectángulos + sombra suave; `::before/::after`=0, `transition`=0 (sin
   motion), iconos SVG genéricos, escala de radios inconsistente (3/11/13/14/18/20/46px).
3. **Isotipo sin uso:** el styleguide lo cita ("es un play") pero no aparece en ninguna pantalla.

## Decisiones de la sesión (2026-06-23)
1. **Tipografía →** Fraunces (serif editorial: titulares, precios, zonas) + **Hanken Grotesk** (sans:
   UI, datos, forms). Se conserva la sans del prototipo; el serif es la inyección nueva.
2. **Entrega →** kit HTML navegable autocontenido (no app code).
3. **Componentes priorizados →** (1) tarjeta de propiedad editorial (con precio-héroe), (2) isotipo
   "U+play" como motivo, (3) embudo de leads de 7 estados.
4. **Colores (confirmados por el cliente 2026-06-23):** **primario Salvia `#5A8A5E`** (verde),
   **acento Arcilla `#9A7150`** (marrón), gestión `#F6F2EB`, feed `#17140F`. El verde pasa a ser
   la marca dominante; la arcilla queda como secundario cálido (progreso del embudo, avatares, etc.).

## Entregable: kit de personalidad
`003-kit/urbea-personality-kit.html` — un archivo, sin build, fuentes vía Google Fonts. Contiene:
- **Tokens** `snake_case` (paleta actual + Arcilla, tipo Fraunces/Hanken, escalas de radio/sombra).
- **C01 · Tarjeta de propiedad editorial:** precio-héroe serif con tick Arcilla, specs con iconos a
  medida + hairlines de plata, overlay glass; variantes **oscura** (feed/detalle) y **clara** (gestión).
- **C02 · Isotipo "U+play":** SVG único + aplicaciones (play, anillo de avatar, pin de mapa, loader,
  estado vacío, ícono de app).
- **C03 · Embudo de leads (7 estados):** barra segmentada (Arcilla progreso / Salvia ganado) +
  chip de fila; mapea los `lead_status` reales.
- **Anti-flatness transversal:** hairlines de plata, eyebrows con tick, textura de grano/viñeta,
  micro-motion (el like "respira").

## Datos verificados contra el esquema
- **7 `lead_status`** (enum real, migración `0006` / [[crm-leads]]): `new, contacted, in_progress,
  visit_scheduled, closed_won, closed_lost, discarded` → embudo de 5 pasos + Ganado, con Perdido/
  Descartado como terminales.

## Abierto
- ~~Hex de "Arcilla"~~ → **resuelto 2026-06-23**: primario Salvia `#5A8A5E`, acento Arcilla `#9A7150`.
- ¿Se formaliza `003` como dirección y se descartan/archivan `001`/`002`? (decisión del cliente, gated).

## Próximos pasos (cuando se levante el gate de #19 y exista `mobile/`)
- Portar estos tokens y componentes a `mobile/src/theme/theme.ts` + `mobile/src/components/`
  (`PropertyCard`, `Isotype`, `LeadFunnel`), según el skill `urbea-design`.
- Opcional: reimportar el kit a Cloud Design para regenerar las pantallas con los componentes nuevos.
