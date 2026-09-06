/**
 * StatusPicker — desplegable fino de estados de un lead (#117), extraído de
 * LeadExpandedView.tsx:387-482 (subtarea 267.6, REUSO_CON_RESERVA aprobado
 * — LeadExpandedView se borra en 267.7).
 *
 * Componente PURO y controlado: no gestiona su propio estado de apertura ni
 * llama a ningún hook de red — el padre decide `open` y recibe `onToggle`/
 * `onSelect`. Esto permite reusarlo tanto en el Modal viejo (mientras vive)
 * como en LeadInlineDetail (267.6) sin duplicar la lista de 8 estados
 * vigentes ni el patrón de accesibilidad (accessibilityState.expanded).
 *
 * El disparador ES el badge del estado actual (FIX3 de LeadExpandedView):
 * siempre visible, incluso si `current` es un estado legacy fuera de
 * ALL_LEAD_STATUSES (get_status_meta tiene fallback seguro). En `readOnly`
 * el disparador no es tappable y no lleva caret — se lee como etiqueta, no
 * como control; la lista nunca se monta.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CaretDown } from 'phosphor-react-native';

import { colors, fonts, radii, spacing } from '@/theme/theme';
import { ALL_LEAD_STATUSES, get_status_meta } from '../lead_status_meta';
import type { LeadStatus } from '../types';

export interface StatusPickerProps {
  /**
   * Estado actual del lead — se muestra SIEMPRE como badge del disparador.
   * `null` = el padre solo conoce la proyección 8→4 (crm_leads_page no
   * expone el status crudo): el badge pinta `current_label` en neutro y
   * ningún ítem lleva ✓ (nunca se adivina).
   */
  current: LeadStatus | null;
  /** Etiqueta del badge cuando `current` es null (p. ej. "Contactado"). */
  current_label?: string | undefined;
  /** true = la lista de 8 estados está montada. */
  open: boolean;
  /** Tocar el disparador (badge). No-op esperado del padre si readOnly. */
  onToggle: () => void;
  /** Tocar una opción de la lista. */
  onSelect: (status: LeadStatus) => void;
  /** Deshabilita disparador y opciones (p.ej. mutación en curso). */
  disabled?: boolean;
  /** Modo solo lectura: disparador no tappable, sin caret, lista nunca montada. */
  readOnly?: boolean;
}

export function StatusPicker({
  current,
  current_label,
  open,
  onToggle,
  onSelect,
  disabled = false,
  readOnly = false,
}: StatusPickerProps): React.JSX.Element {
  const current_meta =
    current !== null
      ? get_status_meta(current)
      : { label: current_label ?? 'Estado', bg: colors.paper_3, text: colors.gray_3 };

  return (
    <View>
      <Pressable
        onPress={onToggle}
        disabled={readOnly || disabled}
        accessibilityRole={readOnly ? 'text' : 'button'}
        accessibilityState={readOnly ? undefined : { expanded: open }}
        accessibilityLabel={
          readOnly
            ? `Estado: ${current_meta.label}`
            : `Estado actual: ${current_meta.label}. ${open ? 'Cerrar' : 'Abrir'} la lista de estados`
        }
        style={({ pressed }) => [
          styles.trigger,
          pressed && !readOnly && styles.trigger_pressed,
        ]}
      >
        <View style={[styles.dot, { backgroundColor: current_meta.bg }]} />
        <View style={[styles.badge, { backgroundColor: current_meta.bg }]}>
          <Text style={[styles.badge_text, { color: current_meta.text }]}>{current_meta.label}</Text>
        </View>
        <View style={styles.spacer} />
        {!readOnly && (
          <CaretDown
            size={16}
            weight="bold"
            color={colors.gray_2}
            style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
          />
        )}
      </Pressable>

      {!readOnly && open && (
        <View style={styles.list}>
          {ALL_LEAD_STATUSES.map((s) => {
            const meta = get_status_meta(s);
            const is_current = s === current;

            return (
              <Pressable
                key={s}
                onPress={() => onSelect(s)}
                disabled={disabled}
                accessibilityRole="radio"
                accessibilityState={{ checked: is_current, disabled }}
                accessibilityLabel={`Estado: ${meta.label}${is_current ? ', seleccionado' : ''}`}
                style={({ pressed }) => [
                  styles.row,
                  is_current && styles.row_current,
                  pressed && !disabled && styles.row_pressed,
                ]}
              >
                <View style={[styles.dot, { backgroundColor: meta.bg }]} />
                <View style={[styles.badge, { backgroundColor: meta.bg }]}>
                  <Text style={[styles.badge_text, { color: meta.text }]}>{meta.label}</Text>
                </View>
                {is_current && <Text style={styles.check}>✓</Text>}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8,
    paddingVertical: spacing.s_8,
    paddingHorizontal: spacing.s_8,
    borderRadius: radii.r_8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.silver,
    backgroundColor: colors.paper,
  },
  trigger_pressed: {
    backgroundColor: colors.paper_2,
  },
  spacer: {
    flex: 1,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  badge: {
    alignSelf: 'center',
    borderRadius: radii.r_pill,
    paddingVertical: 4,
    paddingHorizontal: 10,
    alignItems: 'flex-start',
  },
  badge_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
  },
  list: {
    paddingHorizontal: spacing.s_4,
    paddingTop: spacing.s_8,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8,
    paddingVertical: spacing.s_8,
    paddingHorizontal: spacing.s_8,
    borderRadius: radii.r_8,
  },
  row_current: {
    backgroundColor: colors.paper,
  },
  row_pressed: {
    backgroundColor: colors.paper_2,
  },
  check: {
    fontSize: 16,
    color: colors.primary,
    fontFamily: fonts.sans_bold,
    marginLeft: 'auto',
    flexShrink: 0,
  },
});
