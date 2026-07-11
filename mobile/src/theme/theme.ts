/**
 * theme.ts — Design system de Urbea.
 *
 * Fuente única de tokens de diseño. Sembrado en subtarea #16.3 a partir
 * del kit 003 (.taskmaster/docs/exploraciones/003-kit/urbea-personality-kit.html).
 *
 * ponytail: objeto plano sin theming engine — dual-mode feed/oscuro vendrá
 * cuando lo toque el feed (#9). Por ahora solo modo gestión (claro).
 */

// ─────────────────────────────────────────────────────────────────────────────
// COLORES
// ─────────────────────────────────────────────────────────────────────────────

export const colors = {
  // Primario — verde Urbea del logo (flash 2026-07-06: el acento de TODA la
  // interfaz es el verde del logo, no la salvia del kit; cohesión con la marca).
  primary:      '#1A5E44',
  primary_soft: '#5E9379',
  primary_tint: '#DCE8E1',
  primary_deep: '#123A2C',

  // Contraste / superficies blancas
  on_primary:   '#FFFFFF', // texto/iconos sobre primary
  surface:      '#FFFFFF', // superficie blanca de modal/card

  // Acento (arcilla / marrón cálido)
  accent:       '#9A7150',
  accent_soft:  '#C2A07C',
  accent_tint:  '#EADBCE',
  accent_deep:  '#5E4226',

  // Tintas / neutrales cálidos
  ink_feed:     '#17140F', // fondo feed oscuro inmersivo
  ink:          '#1E1A15', // texto base cálido
  paper:        '#F6F2EB', // fondo gestión (modo claro)
  paper_2:      '#EEE7DC', // superficie marfil
  paper_3:      '#E3DCCF', // superficie marfil 2 / bordes cálidos
  gray_1:       '#A39A8C', // gris cálido claro
  gray_2:       '#857C70', // gris cálido medio
  gray_3:       '#6B6256', // gris cálido oscuro

  // Plata / hairlines
  silver:       '#C2C2BD',
  silver_dk:    '#8C8E8A', // plata sobre fondos oscuros

  // Semánticos
  /** Rojo cálido para acciones destructivas. Encaja con la paleta arcilla/tierra. */
  danger:       '#C94B3E',

  // Integraciones
  whatsapp:     '#25D366',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// GLASS — tokens del efecto "liquid glass" (exploración 035, tarea #65)
//
// Reuso entre GlassTabBar, MapSearchBar y PropertyMiniCard. Overlays/bordes
// derivados de `colors` (verificados byte a byte contra los hex reales):
//   overlay_light        = colors.paper    (#F6F2EB) @ 0.35
//   overlay_dark         = colors.ink_feed (#17140F) @ 0.40
//   border_highlight_light = colors.paper_3 (#E3DCCF) @ 0.60
//
// Opacidad bajada en #65.7 (feedback del dueño, screenshot 2026-07-11): la
// pill se veía casi opaca vs. la referencia deseada (dock liquid glass de
// iOS 26 Home) — 0.72/0.82 apenas dejaban ver el contenido detrás. Iterado
// visualmente con capturas adb sobre Mapa (claro) y feed (oscuro) hasta
// distinguir el fondo sin perder legibilidad de íconos.
//
// Bajada de nuevo en #65.8 (2ª ronda de feedback, referencia: tab bar de
// WhatsApp en iOS 26 — pill MUY translúcida, se distingue el contenido
// detrás claramente). 0.50/0.60 → 0.35/0.40, iterado visualmente hasta el
// límite en el que los íconos siguen siendo legibles.
// ─────────────────────────────────────────────────────────────────────────────

export const glass = {
  // Intensidad de BlurView (expo-blur). Reducida en dark: el blur sobre video
  // en reproducción (feed Android) cuesta FPS en gama media.
  blur_intensity_light: 30, // superficies claras/gestión — mismo valor que MapSearchBar
  blur_intensity_dark: 20,  // feed oscuro — reducida a propósito por rendimiento

  overlay_light: 'rgba(246, 242, 235, 0.35)', // colors.paper @ 0.35 (antes 0.50, #65.8)
  overlay_dark: 'rgba(23, 20, 15, 0.40)',     // colors.ink_feed @ 0.40 (antes 0.60, #65.8)

  border_highlight_light: 'rgba(227, 220, 207, 0.60)', // colors.paper_3 @ 0.60
  border_highlight_dark: 'rgba(255, 255, 255, 0.12)',

  // pill_radius = mitad de la altura REAL de la pill (semicírculo perfecto en
  // los extremos, #65.7) — debe recalcularse si cambia cualquier padding de
  // GlassTabBar.tsx. Altura actual: borde (1×2=2) + fila (paddingVertical
  // s_4×2=8) + tab_item (paddingVertical s_8×2=16) + ícono (24) = 50 → 25.
  pill_radius: 25,
  pill_horizontal_inset: 16,
  pill_bottom_offset: 6, // antes 12 — más pegada al borde inferior (#65.7)

  // Despeje mínimo para CUALQUIER contenido flotante inferior (pills, mini-cards)
  // sobre las pantallas de (tabs) — ya no basta con spacing.s_24 a secas (#65.4):
  // la GlassTabBar ahora flota ENCIMA del contenido (position:absolute, ya no
  // reserva su propio alto en el layout). Debe sumarse a `insets.bottom`.
  // Matemática (debe coincidir con los estilos de GlassTabBar.tsx, recalculada
  // en #65.7 tras compactar la pill):
  //   pill_bottom_offset (6) + fila (paddingVertical s_4×2 = 8)
  //   + tab_item (paddingVertical s_8×2 = 16) + ícono (24) = 54
  //   + margen visual (s_12 = 12) = 66.
  floating_content_bottom_offset: 66,

  // ───────────────────────────────────────────────────────────────────────
  // LENS — "lupa" deslizante sobre la tab activa (#65.8, referencia: tab bar
  // de WhatsApp iOS 26). Diseño ÚNICO en ambas plataformas (dirección
  // explícita del dueño: Android NO es un fallback degradado, debe verse
  // casi igual que iOS) — la única diferencia aceptada es la refracción
  // física real, que solo existe en GlassView (iOS 26+); todo lo demás
  // (geometría, blur más intenso, overlay, rim, spring) es idéntico.
  // ───────────────────────────────────────────────────────────────────────

  // Blur de la cápsula ~2x más intenso que el de la pill base (Android/iOS<26,
  // GlassBackground no aplica aquí — la lupa iOS 26+ usa GlassView real).
  lens_blur_intensity_light: 60,
  lens_blur_intensity_dark: 40,

  // Overlay muy sutil, idéntico en ambas variantes (simula luz sobre vidrio,
  // no un tinte del fondo — a diferencia de overlay_light/overlay_dark).
  lens_overlay: 'rgba(255, 255, 255, 0.15)',

  // Borde-rim con gradiente: destello arriba, se desvanece abajo.
  lens_rim_color_top: 'rgba(255, 255, 255, 0.9)',
  lens_rim_color_bottom: 'rgba(255, 255, 255, 0)',
  lens_border_width: 1.5,

  // Inset horizontal: la cápsula no ocupa el ancho completo del slot de tab
  // (se ve más "lupa" alrededor del ícono que una barra ancha).
  lens_horizontal_inset: 8, // = spacing.s_8

  // Spring de traslación al cambiar de tab (idioma de animación del repo,
  // ver LikeButton.tsx) — snappy sin rebote exagerado.
  lens_spring_damping: 18,
  lens_spring_stiffness: 220,

  // Fade-in de la primera medición (evita el flash en x:0 antes del layout).
  lens_fade_duration_ms: 180,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// MARCA — LOGO FINAL (urbea-logo-final.html)
//
// Paleta EXCLUSIVA del logo (icono de app + login), distinta del verde Salvia
// del sistema de gestión. Aditiva: NO reemplaza `colors`. Alcance acotado a las
// superficies de logo (#43, decisión del cliente 2026-07-05: "solo icono + login").
// ─────────────────────────────────────────────────────────────────────────────

export const brand = {
  green:      '#1A5E44', // verde Urbea del logo
  green_deep: '#123A2C',
  carnita:    '#EEE4D0',
  carnita_2:  '#E6D9BF',
  ink:        '#1C2620', // tinta del logo
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// RADIOS
// ─────────────────────────────────────────────────────────────────────────────

export const radii = {
  r_4:   4,
  r_8:   8,
  r_12:  12,
  r_16:  16,
  r_24:  24,
  r_pill: 999,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// SOMBRAS (traducidas de box-shadow CSS a React Native)
//
// CSS originals:
//   sm:      0 1px 3px rgba(30,22,12,.08), 0 1px 2px rgba(30,22,12,.06)
//   md:      0 8px 22px -8px rgba(30,22,12,.22)
//   lg:      0 22px 55px -18px rgba(30,22,12,.40)
//   primary: 0 8px 20px -6px rgba(90,138,94,.5)
//
// RN solo admite una sombra por View. Se usa la componente dominante.
// ─────────────────────────────────────────────────────────────────────────────

export const shadows = {
  sm: {
    shadowColor: '#1E160C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  md: {
    shadowColor: '#1E160C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 4,
  },
  lg: {
    shadowColor: '#1E160C',
    shadowOffset: { width: 0, height: 22 },
    shadowOpacity: 0.40,
    shadowRadius: 37,
    elevation: 8,
  },
  primary: {
    shadowColor: '#1A5E44',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.50,
    shadowRadius: 14,
    elevation: 5,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// TIPOGRAFÍA
// ─────────────────────────────────────────────────────────────────────────────

/** Nombres de familia tal como los exige @expo-google-fonts. */
export const fonts = {
  display: 'SpaceGrotesk_600SemiBold',       // Display / títulos
  display_italic: 'SpaceGrotesk_600SemiBold', // No hay italic en la fuente; usar display
  sans:    'HankenGrotesk_400Regular',        // Cuerpo
  sans_semibold: 'HankenGrotesk_600SemiBold', // Cuerpo semi-bold
  sans_bold:     'HankenGrotesk_700Bold',     // Cuerpo bold
  logo:    'Outfit_600SemiBold',              // Wordmark del logo final (#43.2)
} as const;

/** Type scale del kit 003.
 *
 * letterSpacing: CSS usa "em" relativos; RN usa px absolutos.
 *   -0.02em @ 44px ≈ -0.9   → usamos -0.88
 *   -0.01em @ 28px ≈ -0.28  → usamos -0.3
 *   0.16em  @ 12px ≈  1.92  → usamos 1.6
 */
export const type_scale = {
  display: {
    fontFamily: fonts.display,
    fontSize: 44,
    lineHeight: 44,    // lineHeight 1.0
    letterSpacing: -0.88,
  },
  h1: {
    fontFamily: fonts.display,
    fontSize: 28,
    lineHeight: 32,    // lineHeight ~1.14
    letterSpacing: -0.3,
  },
  price: {
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -0.3,
  },
  body: {
    fontFamily: fonts.sans,
    fontSize: 16,
    lineHeight: 24,    // lineHeight 1.5
    letterSpacing: 0,
  },
  caption: {
    fontFamily: fonts.sans_semibold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// ESPACIADO (escala base-4, derivada del kit)
// ─────────────────────────────────────────────────────────────────────────────

export const spacing = {
  s_4:  4,
  s_8:  8,
  s_12: 12,
  s_16: 16,
  s_20: 20, // inset de página (prototipo #26 midió 18 → base-4 20)
  s_24: 24,
  s_32: 32,
  s_40: 40, // separación de sección grande (prototipo #26)
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT (estructura de pantalla — extraído del prototipo #26, ver
// .taskmaster/docs/exploraciones/026-layout-system-extraction.md)
// ─────────────────────────────────────────────────────────────────────────────

export const layout = {
  screen_inset: 20, // padding horizontal de página (prototipo 18 → base-4 20)
  grid_gutter: 14,  // separación entre columnas del grid de tarjetas (medido exacto)
  grid_cols: 2,     // columnas por defecto del grid de propiedades
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT AGRUPADO
// ─────────────────────────────────────────────────────────────────────────────

export const theme = {
  colors,
  glass,
  radii,
  shadows,
  fonts,
  type_scale,
  spacing,
  layout,
} as const;

export type Theme = typeof theme;
