/**
 * Sparkline — 14 barras de actividad diaria (CRM, #267.5).
 *
 * Preview: mobile/design-previews/267-crm-santiago.html (`renderSpark`,
 * 68×18, 14 barras de 3 px con 2 px de separación — exactamente
 * 14×3 + 13×2 = 68, el ancho por defecto). NULL = hueco: el día sin evento no
 * dibuja barra pero SÍ conserva su espacio (ALTERNATIVA A del preview, la
 * elegida — decisión ya tomada, no reabrir).
 *
 * Normaliza cada valor contra el máximo de la propia serie (mínimo 1 para
 * evitar /0 en una serie toda en cero) y opaca las barras bajas — mismo
 * cálculo que `renderSpark` del preview — para que el ojo lea intensidad,
 * no solo altura.
 *
 * ponytail: `View`s rectangulares, sin react-native-svg — no hace falta para
 * barras planas (a diferencia de TemperatureRing/FunnelCard, que sí
 * necesitan trazos/gradientes que RN no tiene nativos).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

const BAR_WIDTH = 3;
const GAP = 2;
const DEFAULT_WIDTH = 68;
const DEFAULT_HEIGHT = 18;
const MIN_BAR_H = 2;

export interface SparklineProps {
  values: (number | null)[];
  color: string;
  width?: number;
  height?: number;
}

export function Sparkline({
  values,
  color,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
}: SparklineProps): React.JSX.Element {
  const max = Math.max(1, ...values.filter((v): v is number => v !== null));

  return (
    <View style={[styles.row, { width, height }]}>
      {values.map((v, i) => {
        if (v === null) {
          // Hueco: ancho reservado, sin barra (ALTERNATIVA A del preview).
          return <View key={i} style={{ width: BAR_WIDTH }} />;
        }
        const ratio = Math.max(0, v) / max;
        const bar_h = Math.max(MIN_BAR_H, Math.round(ratio * height));
        const opacity = 0.15 + ratio * 0.85;
        return (
          <View
            key={i}
            style={{
              width: BAR_WIDTH,
              height: bar_h,
              borderRadius: 1.5,
              backgroundColor: color,
              opacity,
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexShrink: 0,
    gap: GAP,
  },
});
