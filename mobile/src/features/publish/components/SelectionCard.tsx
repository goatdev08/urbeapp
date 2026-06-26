/**
 * SelectionCard — card seleccionable para grupos de opciones mutuamente excluyentes.
 *
 * Uso en el wizard de publicación (step1): tipo de operación y tipo de propiedad.
 * Muestra el estado activo con borde y tinte SALVIA; inactivo con borde neutro.
 *
 * ponytail: Pressable + StyleSheet — sin librerías externas de UI.
 */
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

// ---------------------------------------------------------------------------
// Tokens de diseño (alineados con el resto de la app)
// ---------------------------------------------------------------------------

const COLOR_SALVIA = '#5A8A5E';
const COLOR_BORDER_INACTIVE = '#E5E7EB';
const COLOR_BG_SELECTED = 'rgba(90, 138, 94, 0.08)';
const COLOR_TEXT_PRIMARY = '#1A1A1A';
const COLOR_TEXT_INACTIVE = '#6B7280';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SelectionCardProps {
  /** Texto visible en la card. */
  label: string;
  /** Si esta card está actualmente seleccionada. */
  selected: boolean;
  /** Callback al pulsar. */
  onPress: () => void;
  /** Accesibilidad. Toma el valor de `label` si no se pasa. */
  accessibilityLabel?: string;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function SelectionCard({
  label,
  selected,
  onPress,
  accessibilityLabel,
}: SelectionCardProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.card,
        selected ? styles.card_selected : styles.card_inactive,
        pressed && !selected && styles.card_pressed,
      ]}
    >
      <Text
        style={[
          styles.label,
          selected ? styles.label_selected : styles.label_inactive,
        ]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  card_inactive: {
    borderColor: COLOR_BORDER_INACTIVE,
    backgroundColor: '#FFFFFF',
  },
  card_selected: {
    borderColor: COLOR_SALVIA,
    backgroundColor: COLOR_BG_SELECTED,
  },
  card_pressed: {
    backgroundColor: 'rgba(90, 138, 94, 0.04)',
    transform: [{ scale: 0.97 }],
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 20,
  },
  label_selected: {
    color: COLOR_SALVIA,
    fontWeight: '600',
  },
  label_inactive: {
    color: COLOR_TEXT_PRIMARY,
  },
});

// Exportamos también como default para importaciones de conveniencia
export default SelectionCard;
