/**
 * RailIcon.tsx — ícono outline con realce de contraste (variante B, 293.1).
 *
 * Dibuja el mismo ícono Phosphor DOS veces: una copia negra semitransparente
 * (rgba(0,0,0,0.4)) desplazada 1px detrás + el ícono de color encima. Sin
 * cápsula de fondo — el contraste lo da esta doble capa, no un chip glass.
 * Nace en PropertyOverlay.tsx (rail del feed, 293.3).
 *
 * 293.6 (ajuste tras smoke): se muda a components/ — antes vivía en
 * features/feed/ pero LikeButton/SaveButton (components/) y ActionButtons
 * (features/property-detail/) también lo consumen; un `components/`
 * importando de un feature ajeno estaba al revés (capa invertida).
 * RAIL_ACTION_BOX viaja con él por el mismo motivo (misma caja táctil
 * 46×46 que usan ambos rails).
 */

import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import type { Icon } from 'phosphor-react-native';

/** Tamaño default de los íconos outline del rail (293.1, ~28px). */
export const RAIL_ICON_SIZE = 28;

/** Copia negra detrás del ícono de color — variante B aprobada en 293.1. */
const ICON_SHADOW_COLOR = 'rgba(0,0,0,0.4)';

/** Caja táctil 46×46 sin fondo/borde/radio — outline aprobado en 293.1/293.3. */
export const RAIL_ACTION_BOX: ViewStyle = {
  width: 46,
  height: 46,
  alignItems: 'center',
  justifyContent: 'center',
};

type RailIconProps = {
  icon: Icon;
  color: string;
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
  /** Tamaño del ícono en px (default RAIL_ICON_SIZE=28, el del rail del feed). */
  size?: number;
};

export function RailIcon({ icon: IconCmp, color, weight = 'bold', size = RAIL_ICON_SIZE }: RailIconProps) {
  return (
    <View style={{ width: size, height: size }}>
      <IconCmp size={size} color={ICON_SHADOW_COLOR} weight={weight} style={styles.icon_shadow_layer} />
      <IconCmp size={size} color={color} weight={weight} />
    </View>
  );
}

const styles = StyleSheet.create({
  /** Copia negra del ícono, 1px abajo/derecha, DETRÁS del ícono de color. */
  icon_shadow_layer: {
    position: 'absolute',
    top: 1,
    left: 1,
  },
});
