/**
 * IsotipoMark — isotipo de firma de Urbea, geometría tomada del logo final
 * `urbea-logo-final.html` (viewBox 0 0 240 240): pin/U cuya pata derecha se
 * eleva y remata en flecha hacia arriba, coronada por dos puntos (la Ü).
 * Trazo monolínea de grosor uniforme (19u) con remates redondos.
 *
 * Reusable en: map pins, loaders/spinners, empty states, badges.
 *
 * react-native-svg con paths EXACTOS del logo final (#43). El color aplica al
 * trazo y a los dos puntos → un solo param, los consumers lo controlan.
 */
import React from 'react';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { colors } from '@/theme/theme';

interface IsotipoMarkProps {
  size?: number;
  color?: string;
}

export function IsotipoMark({ size = 24, color = colors.primary }: IsotipoMarkProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 240 240">
      <G fill="none" stroke={color} strokeWidth={19} strokeLinecap="round" strokeLinejoin="round">
        {/* U/pin: pata izquierda corta, base redondeada, pata derecha alta. */}
        <Path d="M84 108 L84 138 A29 29 0 0 0 142 138 L142 72" />
        {/* Flecha hacia arriba en la punta de la pata derecha. */}
        <Path d="M123 90 L142 70 L161 90" />
      </G>
      {/* Los dos puntos de la Ü (guiño amigable). */}
      <Circle cx={100} cy={52} r={8.5} fill={color} />
      <Circle cx={126} cy={52} r={8.5} fill={color} />
    </Svg>
  );
}
