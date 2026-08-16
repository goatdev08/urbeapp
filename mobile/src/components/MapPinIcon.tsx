/**
 * MapPinIcon.tsx — pin canónico de TODOS los mapas de Urbea.
 *
 * Un solo icono para los marcadores: Phosphor `MapPinSimple` (el pin de paleta
 * — círculo sobre asta; `map-pin-simple`, elegido por Abraham 2026-08-16 sobre
 * la gota clásica `MapPin`). Sustituye al teardrop custom (mapa global), al pin
 * nativo de plataforma (MapPicker) y al pin rojo default (detalle) —
 * consistencia pedida en la sesión flash 2026-07-06.
 *
 * ⭐ **Dos tonos, no silueta** (#186, Abraham: "en los mapas se ve totalmente de
 * un color sólido"). Se dibuja con `weight="duotone"`, que en Phosphor son dos
 * paths: el CONTORNO (anillo + asta, pintado con `color`) y un DISCO interior
 * (pintado con `duotoneColor`). Se aprovechan al revés de lo habitual:
 *   - contorno = tinta que contrasta con los tiles del mapa,
 *   - disco    = color de marca / de operación (`fill_color`).
 * `duotoneOpacity={1}` porque el default de Phosphor es 0.2 (pensado para el
 * duotone decorativo, aquí lavaría el relleno).
 *
 * El contorno sigue el TEMA DEL DISPOSITIVO (`useColorScheme`): tinta en claro,
 * marfil en oscuro — la app no tenía detección de tema hasta aquí. Es la única
 * forma de que el pin siga legible cuando los tiles del mapa se oscurecen.
 * ⚠️ En Android los tiles de Google NO siguen el tema del sistema (no hay
 * `customMapStyle` oscuro): el mapa se queda claro aunque el teléfono esté en
 * oscuro. Por eso el contorno claro se limita a iOS, donde Apple Maps sí
 * oscurece los tiles; en Android un contorno marfil sobre un mapa claro sería
 * un pin invisible. Si algún día se añade un estilo oscuro de mapa, este guard
 * de plataforma es lo único que hay que quitar.
 *
 * Uso dentro de <Marker> con anchor={{x:0.5, y:1}} (la punta del pin marca la
 * coordenada) y centerOffset={{x:0, y:-size/2}} para el equivalente en iOS.
 * `MapPinSimple` también termina en punta abajo-centro (el asta baja hasta
 * y=232 del viewBox de 256), así que esos anclajes siguen siendo correctos.
 */
import React from 'react';
import { Platform, useColorScheme } from 'react-native';
import { MapPinSimple } from 'phosphor-react-native';

import { colors } from '@/theme/theme';

export interface MapPinIconProps {
  /**
   * Color del DISCO interior. Default: salvia (`colors.primary`).
   * El mapa global lo usa para el código por operación (renta salvia / venta
   * arcilla); detalle y wizard se quedan con el default.
   */
  color?: string;
  /** Alto del icono en px. Default 36. */
  size?: number;
}

export function MapPinIcon({ color = colors.primary, size = 36 }: MapPinIconProps) {
  const scheme = useColorScheme();
  // Ver cabecera: solo iOS oscurece los tiles del mapa con el tema del sistema.
  const on_dark_map = scheme === 'dark' && Platform.OS === 'ios';
  const outline = on_dark_map ? colors.paper : colors.ink;

  return (
    <MapPinSimple
      size={size}
      weight="duotone"
      color={outline}
      duotoneColor={color}
      duotoneOpacity={1}
    />
  );
}
