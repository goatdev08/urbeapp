/**
 * StepIndicator — indicador de progreso para wizards de múltiples pasos.
 *
 * Muestra tres puntos: los pasos anteriores y el actual con color SALVIA;
 * los siguientes en gris claro. Texto auxiliar "Paso X de Y".
 *
 * Uso en el wizard de publicación (8.1):
 *   <StepIndicator current={1} total={3} />
 *
 * ponytail: View + dots — sin librerías externas de progress.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

const COLOR_SALVIA = '#5A8A5E';
const COLOR_INACTIVE = '#D1D5DB';
const COLOR_LABEL = '#6B7280';

export interface StepIndicatorProps {
  /** Paso actual (1-based). */
  current: number;
  /** Total de pasos. */
  total: number;
}

export function StepIndicator({ current, total }: StepIndicatorProps) {
  return (
    <View style={styles.container} accessibilityLabel={`Paso ${current} de ${total}`}>
      <View style={styles.dots_row}>
        {Array.from({ length: total }, (_, i) => {
          const step_number = i + 1;
          const is_active = step_number <= current;
          return (
            <View
              key={step_number}
              style={[
                styles.dot,
                is_active ? styles.dot_active : styles.dot_inactive,
                // dot actual ligeramente más grande
                step_number === current && styles.dot_current,
              ]}
            />
          );
        })}
      </View>
      <Text style={styles.label}>
        Paso {current} de {total}
      </Text>
    </View>
  );
}

const DOT_SIZE = 8;
const DOT_CURRENT_SIZE = 10;

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  dots_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dot: {
    borderRadius: 100,
  },
  dot_active: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    backgroundColor: COLOR_SALVIA,
  },
  dot_inactive: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    backgroundColor: COLOR_INACTIVE,
  },
  dot_current: {
    width: DOT_CURRENT_SIZE,
    height: DOT_CURRENT_SIZE,
  },
  label: {
    fontSize: 12,
    color: COLOR_LABEL,
    fontWeight: '500',
  },
});
