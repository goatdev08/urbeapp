/**
 * ClosePropertyDialog — confirmación de cierre con picker de motivo OBLIGATORIO.
 *
 * Subtarea 17.7.
 *
 * Regla UX: el botón "Cerrar publicación" permanece deshabilitado hasta que
 * el agente elija un motivo. Esto refleja el guard del cliente en closeProperty
 * (invariante PRD: closed_reason no puede ser null al invocar la EF).
 *
 * closed_reason → enum DB: rented | sold | withdrawn | expired
 * Labels es-MX:          Rentada | Vendida | Retirada | Vencida
 */

import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { colors, fonts, radii, shadows, spacing, type_scale } from '@/theme/theme';
import type { ClosedReason } from '../hooks/usePropertyActions';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface ClosePropertyDialogProps {
  visible: boolean;
  property_id: string;
  on_dismiss: () => void;
  on_confirm: (args: { property_id: string; closed_reason: ClosedReason }) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Opciones de motivo
// ---------------------------------------------------------------------------

const REASON_OPTIONS: { value: ClosedReason; label: string }[] = [
  { value: 'rented',    label: 'Rentada'  },
  { value: 'sold',      label: 'Vendida'  },
  { value: 'withdrawn', label: 'Retirada' },
  { value: 'expired',   label: 'Vencida'  },
];

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function ClosePropertyDialog({
  visible,
  property_id,
  on_dismiss,
  on_confirm,
}: ClosePropertyDialogProps): React.JSX.Element {
  const [selected_reason, set_selected_reason] = useState<ClosedReason | null>(null);

  const handle_dismiss = () => {
    set_selected_reason(null);
    on_dismiss();
  };

  const handle_confirm = () => {
    if (!selected_reason) return; // guard — nunca debería llegar aquí (botón disabled)
    void on_confirm({ property_id, closed_reason: selected_reason });
    set_selected_reason(null);
  };

  const can_confirm = selected_reason !== null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handle_dismiss}
      statusBarTranslucent
    >
      {/* Overlay: tap fuera = dismiss */}
      <Pressable style={styles.overlay} onPress={handle_dismiss}>
        {/* Diálogo — detiene propagación */}
        <Pressable style={styles.dialog} onPress={() => undefined}>

          <Text style={styles.title}>Cerrar publicación</Text>
          <Text style={styles.body_text}>
            ¿Por qué deseas cerrar esta publicación?
            Esta acción no se puede deshacer.
          </Text>

          {/* Picker de motivo */}
          <View style={styles.options_container}>
            {REASON_OPTIONS.map((opt) => {
              const is_selected = selected_reason === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => set_selected_reason(opt.value)}
                  style={({ pressed }) => [
                    styles.option,
                    is_selected && styles.option_selected,
                    pressed && !is_selected && styles.option_pressed,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: is_selected }}
                  accessibilityLabel={opt.label}
                >
                  {/* Indicador radio visual */}
                  <View style={[styles.radio_dot, is_selected && styles.radio_dot_selected]} />
                  <Text style={[styles.option_text, is_selected && styles.option_text_selected]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Acciones */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.btn_cancel} onPress={handle_dismiss}>
              <Text style={styles.btn_cancel_text}>Cancelar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn_confirm, !can_confirm && styles.btn_confirm_disabled]}
              onPress={handle_confirm}
              disabled={!can_confirm}
              accessibilityState={{ disabled: !can_confirm }}
            >
              <Text style={[styles.btn_confirm_text, !can_confirm && styles.btn_confirm_text_disabled]}>
                Cerrar publicación
              </Text>
            </TouchableOpacity>
          </View>

        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(30, 26, 21, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.s_24,
  },

  dialog: {
    width: '100%',
    backgroundColor: colors.paper,
    borderRadius: radii.r_16,
    padding: spacing.s_24,
    ...shadows.lg,
  },

  title: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 26,
    color: colors.ink,
    marginBottom: spacing.s_8,
  },

  body_text: {
    ...type_scale.body,
    color: colors.gray_2,
    marginBottom: spacing.s_16,
  },

  // ── Picker de motivo ───────────────────────────────────────────────────────

  options_container: {
    marginBottom: spacing.s_24,
    borderRadius: radii.r_8,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.paper_3,
  },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.s_12,
    paddingHorizontal: spacing.s_16,
    backgroundColor: colors.paper,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.paper_3,
  },
  option_selected: {
    backgroundColor: colors.primary_tint,
  },
  option_pressed: {
    backgroundColor: colors.paper_2,
  },

  option_text: {
    ...type_scale.body,
    color: colors.ink,
  },
  option_text_selected: {
    fontFamily: fonts.sans_semibold,
    color: colors.primary_deep,
  },

  // Indicador radio visual
  radio_dot: {
    width: 18,
    height: 18,
    borderRadius: radii.r_pill,
    borderWidth: 2,
    borderColor: colors.gray_1,
    marginRight: spacing.s_12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radio_dot_selected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },

  // ── Botones ────────────────────────────────────────────────────────────────

  actions: {
    flexDirection: 'row',
    gap: spacing.s_12,
  },

  btn_cancel: {
    flex: 1,
    paddingVertical: spacing.s_12,
    borderRadius: radii.r_8,
    borderWidth: 1.5,
    borderColor: colors.paper_3,
    alignItems: 'center',
  },
  btn_cancel_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 15,
    color: colors.gray_2,
  },

  btn_confirm: {
    flex: 2,
    paddingVertical: spacing.s_12,
    borderRadius: radii.r_8,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  btn_confirm_disabled: {
    backgroundColor: colors.primary_tint,
  },
  btn_confirm_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 15,
    color: colors.paper,
  },
  btn_confirm_text_disabled: {
    color: colors.gray_1,
  },
});
