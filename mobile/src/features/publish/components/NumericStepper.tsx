/**
 * NumericStepper — stepper +/− para campos enteros pequeños (bedrooms, bathrooms).
 *
 * ponytail: sin dependencia externa — Pressable + Text nativo.
 * Techo conocido: min/max enteros, sin animaciones por ahora.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

// ---------------------------------------------------------------------------
// Tokens locales (alineados al paleta de step1/step2)
// ---------------------------------------------------------------------------

const COLOR_SALVIA = '#5A8A5E';
const COLOR_TEXT_PRIMARY = '#1A1A1A';
const COLOR_TEXT_SECONDARY = '#6B7280';
const COLOR_BORDER = '#E5E7EB';
const COLOR_BG_BUTTON = '#F3F4F6';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface NumericStepperProps {
  /** Valor actual (null = sin selección). */
  value: number | null;
  /** Mínimo inclusivo. Default 0. */
  min?: number;
  /** Máximo inclusivo. Default 10. */
  max?: number;
  /** Callback cuando el valor cambia. */
  onChange: (next: number) => void;
  /** Texto a mostrar cuando value es null. */
  placeholder?: string;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function NumericStepper({
  value,
  min = 0,
  max = 10,
  onChange,
  placeholder = '—',
}: NumericStepperProps) {
  const current = value ?? min;

  const handle_decrement = () => {
    if (current > min) onChange(current - 1);
  };

  const handle_increment = () => {
    if (current < max) onChange(current + 1);
  };

  const can_decrement = current > min;
  const can_increment = current < max;

  return (
    <View style={styles.container}>
      <Pressable
        onPress={handle_decrement}
        disabled={!can_decrement}
        accessibilityRole="button"
        accessibilityLabel="Reducir"
        style={({ pressed }) => [
          styles.btn,
          pressed && can_decrement && styles.btn_pressed,
          !can_decrement && styles.btn_disabled,
        ]}
      >
        <Text style={[styles.btn_text, !can_decrement && styles.btn_text_disabled]}>
          −
        </Text>
      </Pressable>

      <Text style={styles.value_text}>
        {value === null ? placeholder : String(value)}
      </Text>

      <Pressable
        onPress={handle_increment}
        disabled={!can_increment}
        accessibilityRole="button"
        accessibilityLabel="Aumentar"
        style={({ pressed }) => [
          styles.btn,
          pressed && can_increment && styles.btn_pressed,
          !can_increment && styles.btn_disabled,
        ]}
      >
        <Text style={[styles.btn_text, !can_increment && styles.btn_text_disabled]}>
          +
        </Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const BTN_SIZE = 36;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  btn: {
    width: BTN_SIZE,
    height: BTN_SIZE,
    borderRadius: BTN_SIZE / 2,
    backgroundColor: COLOR_BG_BUTTON,
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btn_pressed: {
    backgroundColor: 'rgba(90,138,94,0.12)',
    borderColor: COLOR_SALVIA,
  },
  btn_disabled: {
    opacity: 0.35,
  },
  btn_text: {
    fontSize: 18,
    fontWeight: '600',
    color: COLOR_TEXT_PRIMARY,
    lineHeight: 22,
  },
  btn_text_disabled: {
    color: COLOR_TEXT_SECONDARY,
  },
  value_text: {
    fontSize: 16,
    fontWeight: '600',
    color: COLOR_TEXT_PRIMARY,
    minWidth: 24,
    textAlign: 'center',
  },
});
