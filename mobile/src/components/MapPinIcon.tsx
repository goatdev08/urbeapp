/**
 * MapPinIcon.tsx — pin canónico de TODOS los mapas de Urbea.
 *
 * Un solo icono para los marcadores: Phosphor `MapPinSimple` (el pin de paleta
 * — círculo sobre asta; `map-pin-simple`, elegido por Abraham 2026-08-16 sobre
 * la gota clásica `MapPin`), weight="fill" para que sea legible sobre los tiles
 * del mapa. Sustituye al teardrop custom (mapa global), al pin nativo de
 * plataforma (MapPicker) y al pin rojo default (detalle) — consistencia pedida
 * en la sesión flash 2026-07-06.
 *
 * Uso dentro de <Marker> con anchor={{x:0.5, y:1}} (la punta del pin marca la
 * coordenada) y centerOffset={{x:0, y:-size/2}} para el equivalente en iOS.
 * `MapPinSimple` también termina en punta abajo-centro (el asta baja hasta
 * y=232 del viewBox de 256), así que esos anclajes siguen siendo correctos.
 */
import React from 'react';
import { MapPinSimple } from 'phosphor-react-native';

import { colors } from '@/theme/theme';

export interface MapPinIconProps {
  /** Color del pin. Default: salvia (colors.primary). */
  color?: string;
  /** Alto del icono en px. Default 36. */
  size?: number;
}

export function MapPinIcon({ color = colors.primary, size = 36 }: MapPinIconProps) {
  return <MapPinSimple size={size} color={color} weight="fill" />;
}
