/**
 * CompactStepper — card con label + stepper +/− para columnas angostas (2 por fila).
 *
 * Quick fix 2026-08-15 (sin tarea de Taskmaster, hallazgo de smoke test manual):
 * NumericStepper se diseñó para una fila de ancho completo (label a la
 * izquierda, stepper de ancho fijo ~132px a la derecha). Al reusarlo en una
 * columna de ~160px (Baños + Medios baños lado a lado) el botón "+" queda
 * cortado contra el borde de la pantalla — visto tanto en Android como iOS.
 * Este componente apila label arriba y controles abajo, y reparte -/valor/+
 * con `justifyContent: space-between` a lo ancho de la columna (proporcional
 * al espacio disponible) en vez de un `gap` fijo — así se adapta al ancho
 * real de cada plataforma en lugar de asumir uno.
 *
 * Quick fix 2026-08-15 (2ª ronda, mismo hallazgo): label y hint viven FUERA
 * de la caja con borde — igual que el campo de precio (label arriba, hint
 * abajo, la caja solo envuelve el control). Antes ambos vivían dentro de la
 * caja e inflaban su altura sin necesidad, inconsistente con precio/terreno.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const COLOR_SALVIA = '#1A5E44';
const COLOR_TEXT_PRIMARY = '#1A1A1A';
const COLOR_TEXT_SECONDARY = '#6B7280';
const COLOR_BORDER = '#E5E7EB';
const COLOR_BG_BUTTON = '#F3F4F6';
const COLOR_INPUT_BG = '#FFFFFF';
const COLOR_HINT = '#9CA3AF';

export interface CompactStepperProps {
  label: string;
  hint?: string;
  value: number | null;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  placeholder?: string;
}

export function CompactStepper({
  label,
  hint = 'Opcional',
  value,
  min = 0,
  max = 10,
  onChange,
  placeholder = '0',
}: CompactStepperProps) {
  const current = value ?? min;
  const can_decrement = current > min;
  const can_increment = current < max;

  const handle_decrement = () => {
    if (can_decrement) onChange(current - 1);
  };

  const handle_increment = () => {
    if (can_increment) onChange(current + 1);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.control_box}>
        <Pressable
          onPress={handle_decrement}
          disabled={!can_decrement}
          accessibilityRole="button"
          accessibilityLabel={`Reducir ${label}`}
          style={({ pressed }) => [
            styles.btn,
            pressed && can_decrement && styles.btn_pressed,
            !can_decrement && styles.btn_disabled,
          ]}
        >
          <Text style={[styles.btn_text, !can_decrement && styles.btn_text_disabled]}>−</Text>
        </Pressable>

        <Text style={styles.value_text}>{value === null ? placeholder : String(value)}</Text>

        <Pressable
          onPress={handle_increment}
          disabled={!can_increment}
          accessibilityRole="button"
          accessibilityLabel={`Aumentar ${label}`}
          style={({ pressed }) => [
            styles.btn,
            pressed && can_increment && styles.btn_pressed,
            !can_increment && styles.btn_disabled,
          ]}
        >
          <Text style={[styles.btn_text, !can_increment && styles.btn_text_disabled]}>+</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const BTN_SIZE = 32;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: COLOR_TEXT_SECONDARY,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  // Caja con borde — solo envuelve el control, igual que el input de precio/terreno.
  control_box: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLOR_INPUT_BG,
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
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
    fontSize: 16,
    fontWeight: '600',
    color: COLOR_TEXT_PRIMARY,
    lineHeight: 20,
  },
  btn_text_disabled: {
    color: COLOR_TEXT_SECONDARY,
  },
  value_text: {
    fontSize: 15,
    fontWeight: '600',
    color: COLOR_TEXT_PRIMARY,
    textAlign: 'center',
  },
  hint: {
    fontSize: 12,
    color: COLOR_HINT,
    marginTop: 4,
  },
});
