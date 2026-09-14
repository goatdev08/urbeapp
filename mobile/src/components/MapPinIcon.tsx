/**
 * MapPinIcon.tsx — pin canónico de TODOS los mapas de Urbea.
 *
 * ⭐ Chincheta vectorial (#294, Abraham 2026-09-14): réplica del 📍 de iOS
 * dibujada con `react-native-svg` — cabeza esférica con brillo, cuello y aguja
 * metálicos, sombra en la punta. El emoji como texto NO sirve: cada sistema lo
 * pinta con su propia fuente (Apple Color Emoji vs Noto) y la de Apple no se
 * puede empaquetar; con el vector Android e iOS dibujan exactamente lo mismo.
 * Sustituye al Phosphor `MapPinSimple` duotone de #185/#186 en los marcadores
 * (mapa global, detalle y mira central del wizard). Los pines INLINE (dirección,
 * chip de zona, sugerencias, tab de Mapa) siguen con Phosphor — alcance pedido:
 * "los pines de mapa".
 *
 * `color` tiñe la CABEZA (antes teñía el disco): el código por operación del
 * mapa global (renta salvia / venta arcilla) se conserva. Vertical, sin
 * inclinación (decisión de Abraham sobre el preview). Ya no hace falta el guard
 * de tema de #186: cabeza saturada + aguja metálica contrastan solas en tiles
 * claros y oscuros.
 *
 * Lienzo CUADRADO `size × size` (viewBox 64×64, dibujo centrado en x=32, punta
 * en y≈63): los tres consumidores centran horizontalmente con `size/2` y
 * anclan la punta abajo (`anchor={{x:0.5,y:1}}`, `marginTop: -PIN_SIZE`), así
 * que ninguno cambia.
 *
 * Solo primitivas soportadas en ambas plataformas: sin `filter` (la sombra es
 * una elipse con opacidad). Aprobado sobre preview HTML (artifact ee4f3d84).
 */
import React from 'react';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
} from 'react-native-svg';

import { colors } from '@/theme/theme';

export interface MapPinIconProps {
  /**
   * Color de la CABEZA. Default: salvia (`colors.primary`).
   * El mapa global lo usa para el código por operación (renta salvia / venta
   * arcilla); detalle y wizard se quedan con el default.
   */
  color?: string;
  /** Alto (y ancho) del icono en px. Default 36. */
  size?: number;
}

/**
 * Aclara (`amount` > 0) u oscurece (`amount` < 0) un color hex `#RRGGBB`
 * mezclándolo hacia blanco/negro. Suficiente para los 4 stops del gradiente.
 */
export function shade_hex(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const target = amount < 0 ? 0 : 255;
  const p = Math.min(1, Math.abs(amount));
  const mix = (c: number) => Math.round((target - c) * p + c);
  const r = mix(n >> 16);
  const g = mix((n >> 8) & 0xff);
  const b = mix(n & 0xff);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

export function MapPinIcon({ color = colors.primary, size = 36 }: MapPinIconProps) {
  // Ids únicos por color: varios pines conviven en el mismo mapa con cabezas
  // distintas y react-native-svg resuelve `url(#id)` por nombre.
  const head_id = `pin-head-${color.replace('#', '')}`;

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <RadialGradient id={head_id} cx="36%" cy="30%" r="78%">
          <Stop offset="0" stopColor={shade_hex(color, 0.45)} />
          <Stop offset="0.38" stopColor={color} />
          <Stop offset="0.82" stopColor={shade_hex(color, -0.25)} />
          <Stop offset="1" stopColor={shade_hex(color, -0.45)} />
        </RadialGradient>
        <LinearGradient id="pin-needle" x1="0" x2="1" y1="0" y2="0">
          <Stop offset="0" stopColor="#F4F4F4" />
          <Stop offset="0.45" stopColor="#A9A9A9" />
          <Stop offset="1" stopColor="#4A4A4A" />
        </LinearGradient>
        <LinearGradient id="pin-collar" x1="0" x2="1" y1="0" y2="0">
          <Stop offset="0" stopColor="#D9D9D9" />
          <Stop offset="0.5" stopColor="#8E8E8E" />
          <Stop offset="1" stopColor="#3E3E3E" />
        </LinearGradient>
      </Defs>
      {/* Sombra de la punta sobre el mapa */}
      <Ellipse cx="32" cy="62.4" rx="5.5" ry="1.5" fill="#000" opacity={0.22} />
      <G>
        {/* Aguja */}
        <Path d="M30.55 36.5 L33.45 36.5 L32.2 62.6 L31.8 62.6 Z" fill="url(#pin-needle)" />
        {/* Cuello */}
        <Path d="M28.2 31.5 L35.8 31.5 L34.3 37.2 L29.7 37.2 Z" fill="url(#pin-collar)" />
        {/* Cabeza */}
        <Circle cx="32" cy="17" r="15.5" fill={`url(#${head_id})`} />
        {/* Brillo */}
        <Ellipse
          cx="26"
          cy="10.2"
          rx="5.2"
          ry="3.3"
          transform="rotate(-32 26 10.2)"
          fill="#FFF"
          opacity={0.55}
        />
      </G>
    </Svg>
  );
}
