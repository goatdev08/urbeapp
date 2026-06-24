---
tipo: feature        # feature | fix | refactor | chore | proyecto
nivel: L             # impacto en TODA la identidad (color, tipo, logo, motion, 13 pantallas); deliverable inmediato acotado a auth
fecha: 2026-06-22
estado: borrador      # borrador → en-revision → aprobado | descartado
tarea_id:             # vacío: NO promovido. Toca la #19 (branding) pero entra en CONFLICTO con 001 — resolver antes de promover.
motivo_descarte:
gate_branding: si     # ⚠️ #19 EN PAUSA hasta visto bueno expreso del cliente (CLAUDE.md §8). Esto es solo planeación.
conflicto_con: 001-branding-design-system-urbea.md   # ⚠️ direcciones de marca INCOMPATIBLES — ver sección "Conflicto con 001"
origen: sesión /grill-me (10 preguntas, una a la vez) con el cliente (Abraham), 2026-06-22
---

# Dirección visual de Urbea — Editorial cálido + Terracota (grilling)

> Documento de exploración/planeación. Captura la dirección de marca que salió de una sesión
> de **grilling** (`/grill-me`) con el cliente el 2026-06-22, y un **prompt de Cloud Design**
> listo para disparar (acotado a Login + Auth + Onboarding).
> NO edita los PRD maestros ni `mobile/**` ni `supabase/**`.
> ⚠️ **GATE DE BRANDING (#19, CLAUDE.md §8):** dirección **aprobable**; el inicio del diseño formal
> y su implementación requiere **visto bueno expreso del cliente**.
> ⚠️ **CONFLICTO:** esta dirección es **incompatible** con `001` (aprobado). Ver sección al final.

## Idea original
El cliente pidió una entrevista de diseño ("grilling") sobre Urbea para (a) afinar la intención
visual de la app y (b) producir un **prompt reutilizable para Cloud Design**. Se recorrió el árbol
de decisiones de diseño una pregunta a la vez, con recomendación en cada nodo. Punto de partida:
branding **desde cero** (no se ofreció URBEARG como insumo en la sesión), estética híbrida del
PRD-MVP (feed inmersivo + gestión clara).

## Lluvia de ideas (la sesión = el árbol de decisiones resuelto)
Cada nodo se cerró con elección explícita del cliente. Lo registrado es la **decisión**, no las
alternativas (esas están en el historial del grilling).

1. **Personalidad** → Premium + cálido-humano + editorial de lujo. Aspiracional y confiable, pero
   humano (nunca frío/corporativo). **Sin dorado**; plata/platino en micro-acentos.
2. **Color firma** → **Terracota / arcilla** apagada (no naranja brillante). Sobre base neutra.
3. **Dos mundos (oscuro/claro)** → Giro clave: la app es **clara/editorial en todo**; la inmersión
   del feed NO viene de un tema oscuro sino del **video full-bleed**. "Un TikTok claro."
4. **Feed claro pero inmersivo** → Mecánica familiar TikTok/Reels (swipe vertical, autoplay, riel de
   acciones) con **piel premium propia**: tarjetas *glass* claras, **iconos a medida**, acento
   terracota. **Blur-fill** del propio video detrás cuando no llena la pantalla.
5. **Tipografía** → **Serif editorial** (titulares/precios/zonas) + **sans limpia** (UI/datos/forms).
6. **Logo** → **Lettering a medida** del wordmark "Urbea" con detalle de firma + monograma "U".
   (Wordmark serif de catálogo queda como red de seguridad si aprieta el tiempo.)
7. **Formas + iconos** → Esquinas amplias (~20–24px), mucho aire; set de iconos **a medida, trazo
   fino y uniforme**, detalle plata. Nunca rellenos tipo TikTok.
8. **Movimiento** → Suave y premium (lento-elegante); paneles que suben con calma; el like "respira".
   Swipe del feed ágil.
9. **Datos densos (CRM/publicaciones/admin)** → Lista scrolleable de **tarjetas aireadas-pero-compactas,
   varias por pantalla**, cada lead/propiedad su tarjeta, estado como **chip terracota/plata**.
10. **Alcance del primer Cloud Design** → **Login + Auth (canje) + Onboarding** (entró por `design-login`).

## Problema / Motivación
La demo de 3 semanas ([[0005-demo-cerrada-3-semanas]]) necesita una identidad visual coherente para
construir las 13 pantallas. Faltaba una dirección de marca **decidida por el cliente** (no propuesta
por IA en abstracto). El grilling la fija y la deja accionable como prompt de Cloud Design.

## Resultado esperado
- Un **sistema de marca** claro (tabla abajo) que aplica a las 13 pantallas.
- Un **prompt de Cloud Design** que genere primero el flujo de auth con ese sistema + una hoja de
  design tokens reutilizable.

## Alcance
- **SÍ entra:** dirección de marca (personalidad, color, tipografía, logo, formas, iconos, motion);
  prompt de Cloud Design para Welcome + Login + Canje de código + Onboarding; hoja de tokens.
- **NO entra (out of scope):** dibujo final del lettering del logo (trabajo de type/logo designer,
  fuera de Cloud Design); implementación en `mobile/**` (gated por #19); pantallas feed/mapa/detalle
  (se generan después, ya con el sistema fijado).

## Roles afectados
- **Comprador / consumo del feed** (en la demo lo usan los propios agentes): feed claro-inmersivo.
- **Inmobiliaria + agente:** auth, onboarding, publicación, CRM con tarjetas aireadas.
- **Admin de plataforma:** panel utilitario claro, mismos componentes.

## Sistema de marca — síntesis

| Eje | Decisión |
|---|---|
| Personalidad | Premium + cálido-humano + editorial de lujo. |
| Tema global | **Claro** en toda la app (marfil cálido, aireado). Inmersión del feed = video full-bleed, no tema oscuro. |
| Color firma | **Terracota/arcilla** apagada (CTAs, estados activos, chips). |
| Neutros | Marfil cálido (fondo) + carbón cálido (texto) + grises cálidos. |
| Micro-acento | **Plata/platino**. **Sin dorado.** |
| Tipografía | Serif editorial (titulares) + sans limpia (UI/datos). |
| Logo | Lettering serif a medida "Urbea" + monograma "U". |
| Formas | Esquinas amplias (~22px), aire generoso. |
| Iconos | A medida, trazo fino y uniforme, detalle plata. |
| Movimiento | Suave, lento-elegante; swipe del feed ágil. |
| Feed | Mecánica TikTok/Reels + piel premium (glass claro, iconos finos, blur-fill). |
| CRM/datos | Lista de tarjetas aireadas-compactas, varias por pantalla, estado = chip. |

### Paleta propuesta (hex de arranque — a validar)
| Rol | Hex | Nota |
|---|---|---|
| Fondo marfil | `#F7F3EE` | warm off-white, base |
| Tinta carbón | `#1E1B17` | texto base, cálido |
| Texto secundario | `#6E665C` | gris cálido |
| Terracota (firma) | `#B86B4B` | CTAs, activos, links, chips |
| Tinte arcilla | `#EADBCE` | rellenos / seleccionado |
| Plata / platino | `#C2C2BD` | hairlines, detalle |

### Tipografía propuesta (a validar)
- Serif editorial: **Fraunces** o **Canela** (titulares, precios, zonas, base del lettering).
- Sans limpia: **Inter** o **General Sans** (UI, datos, formularios).

## Prompt de Cloud Design — Login + Auth + Onboarding
> En inglés a propósito (mejor rendimiento del generador); copy de UI en español de México.

```text
Design a high-fidelity mobile authentication flow for "Urbea", a premium real-estate
platform (closed beta, Mexico). Output vertical iPhone frames (390×844). All UI copy in
Mexican Spanish.

BRAND SYSTEM — apply consistently to every screen:
• Mood: premium, warm, editorial-luxury. Aspirational and trustworthy (people are choosing
  a home), but human and warm — never cold or corporate. Think architecture magazine meets
  a refined product app.
• Theme: LIGHT throughout. Warm ivory backgrounds, generous white space, airy editorial
  layout, one clear primary action per screen.
• Colors:
  - Background: warm ivory/cream #F7F3EE
  - Ink/text: warm near-black charcoal #1E1B17; secondary warm gray #6E665C
  - Signature accent (primary buttons, active states, links, highlights): muted terracotta
    clay #B86B4B — sophisticated, NEVER bright orange
  - Soft clay tint for fills/selected states: #EADBCE
  - Micro-accent: silver/platinum #C2C2BD for thin dividers, hairlines, small detailing.
    NO gold anywhere.
• Typography:
  - Headlines, titles and the logotype: an editorial serif with character (Fraunces / Canela
    style), used large with elegant tight spacing.
  - Body, labels, inputs, buttons: a clean neutral sans (Inter / General Sans).
• Logo: a bespoke serif wordmark "Urbea" with one subtle distinctive letter detail; a serif
  "U" monogram as the compact mark/app icon.
• Shapes: generous corner radii — cards ~22px, inputs/buttons ~14px. Soft, rounded, airy.
• Icons: CUSTOM thin, uniform line-weight icons (editorial, elegant) with subtle silver line
  detailing — never filled or heavy.
• Motion intent (annotate): smooth, slow, premium easing; calmly rising sheets; subtle
  micro-interactions.

SCREENS:

1) Welcome — centered "Urbea" serif wordmark on warm ivory with a faint silver hairline
   detail. One terracotta primary button "Iniciar sesión" and a quieter text link
   "Tengo un código de invitación". Minimal, editorial, lots of air.

2) Iniciar sesión (email + password) — serif headline "Bienvenido de vuelta". Two clean
   inputs (rounded ~14px, thin silver border, thin-line custom icons), labels "Correo" and
   "Contraseña". Primary terracotta button "Entrar". A subtle warm-gray link
   "¿Olvidaste tu contraseña?". Footer link "Soy agente nuevo · Canjear código".

3) Canjear código de invitación — serif headline "Únete a tu inmobiliaria", short warm-gray
   helper line. A prominent 6-character segmented code input (rounded boxes, thin silver
   borders, terracotta active box). Primary terracotta button "Canjear código". Calm, editorial.

4) Tu perfil (onboarding mínimo) — serif headline "Tu perfil". A circular avatar upload
   control with a thin-line camera icon inside a silver ring, caption "Agregar foto". One text
   input "Nombre completo". A read-only chip with clay-tint fill showing "Inmobiliaria: ___".
   Primary terracotta button "Listo".

ALSO output a compact design-token sheet: color swatches (name + hex), type scale (serif +
sans, sizes), corner radii, and a row of sample custom thin-line icons — so the system is
reusable across the rest of the app (feed, mapa, CRM, publicación).
```

## ⚠️ Conflicto con `001-branding-design-system-urbea.md` (aprobado)
Esta dirección y la de `001` son **incompatibles**; promover ambas crearía dos identidades. Choques:

| Eje | `001` (aprobado, re-planifica #19) | `002` (esta, grilling 2026-06-22) |
|---|---|---|
| Origen de marca | Deriva de **URBEARG** (proyecto hermano shipeado) | Marca **nueva** desde cero (URBEARG no se mencionó en la sesión) |
| Tema | **Dual-mode**: feed **oscuro** + gestión clara | **Claro en todo**; feed inmersivo por video full-bleed |
| Color primario/firma | Verde bosque `#1F3B2D` + cobre `#B08968` + arena `#EEE5DA` | **Terracota** `#B86B4B` + plata, **sin** verde |
| Logo/tipo | Tipografía derivada de URBEARG | **Lettering serif a medida** |
| Modelo de tokens | `theme.ts` dual-mode (`light`/`dark`) | Tokens single-mode (claro) |

**Decisión pendiente del cliente (bloquea promover #19):**
1. ¿`002` **reemplaza** a `001` (rebrand desde cero, descartar la ruta URBEARG)? → marcar `001` como
   `descartado` con motivo, y `002` pasa a `en-revision`.
2. ¿Se **reconcilian** (p. ej. mantener terracota/editorial pero recuperar el dual-mode dark del feed
   de `001`)? → fusionar en un `003`.
3. ¿`001` sigue siendo la verdad y `002` se **descarta** como ejercicio? 

Hasta resolver esto, **ninguno de los dos se promueve** a la #19.

## Preguntas abiertas
- ¿Existe aún la dependencia con la marca URBEARG (negocio), o Urbea va con identidad propia?
- Validar hex de terracota/marfil y las dos familias tipográficas concretas.
- ¿El feed renuncia de verdad al fondo oscuro? (es el punto más fuerte de divergencia con `001` y con
  el patrón TikTok/IG; conviene prototipar legibilidad del glass claro sobre video real).
