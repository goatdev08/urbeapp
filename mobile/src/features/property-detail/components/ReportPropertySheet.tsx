/**
 * ReportPropertySheet — bottom sheet de motivos para reportar una propiedad
 * publicada (botón «Reportar» del detalle, subtarea 220.5, módulo 041-M2).
 *
 * Sin lógica de red propia: recibe `on_submit` (useReportProperty.submit_report)
 * + `is_submitting`/`error_message` del hook, inyectados por el padre
 * (ActionButtons). Componente puro salvo el estado local de selección (motivo
 * elegido + texto libre de "Otro").
 *
 * Mecanismo: calca PropertyActionMenu (profile/components) — Modal RN
 * transparente con overlay + hoja inferior, sin dependencia nueva. El
 * contenido es un formulario (radio list + texto condicional + submit), no
 * una lista de acciones puras, así que el header (título + cerrar) sigue el
 * patrón de FilterSheet (search/components) — ambos ya viven en el repo y
 * comparten tokens de theme.ts.
 *
 * No hay mockup de esta pantalla en la identidad visual (nota del plan de
 * 220.5) — se sigue el lenguaje de los sheets hermanos, sin inventar UI.
 */

import React, { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'phosphor-react-native';

import { colors, fonts, radii, shadows, spacing } from '@/theme/theme';
import { PrimaryButton } from '@/components/PrimaryButton';
import type {
  PropertyReportReason,
  SubmitReportInput,
  SubmitReportResult,
} from '../hooks/useReportProperty';

// ─── Tipos ──────────────────────────────────────────────────────────────────

export interface ReportPropertySheetProps {
  /** Controla visibilidad del Modal. */
  visible: boolean;
  /** Cerrar sin enviar (tap overlay, X o cancelar implícito). */
  on_dismiss: () => void;
  /** useReportProperty().submit_report — INSERT directo, inyectado por el padre. */
  on_submit: (input: SubmitReportInput) => Promise<SubmitReportResult>;
  /** useReportProperty().is_submitting — deshabilita la lista y el submit. */
  is_submitting: boolean;
  /** useReportProperty().error_message — se muestra inline, el sheet NO se cierra en error. */
  error_message: string | null;
}

// ─── Motivos (PRD §24.1, enum property_report_reason) ─────────────────────

const REASONS: { key: PropertyReportReason; label: string }[] = [
  { key: 'not_exist_fraud', label: 'No existe / es un fraude' },
  { key: 'misleading', label: 'Información engañosa' },
  { key: 'false_price', label: 'Precio falso' },
  { key: 'wrong_address', label: 'Dirección incorrecta' },
  { key: 'inappropriate', label: 'Contenido inapropiado' },
  { key: 'duplicate', label: 'Publicación duplicada' },
  { key: 'other', label: 'Otro' },
];

// ─── Componente ──────────────────────────────────────────────────────────────

export function ReportPropertySheet({
  visible,
  on_dismiss,
  on_submit,
  is_submitting,
  error_message,
}: ReportPropertySheetProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [selected_reason, set_selected_reason] = useState<PropertyReportReason | null>(null);
  const [reason_text, set_reason_text] = useState('');

  const reset = () => {
    set_selected_reason(null);
    set_reason_text('');
  };

  /** Cierra y limpia la selección local — el error_message vive en el padre. */
  const handle_dismiss = () => {
    reset();
    on_dismiss();
  };

  // "Otro" exige texto real en el cliente — mismo trim().length>0 que el
  // hook (mirror del CHECK SQL); deshabilita el submit ANTES de llamar al hook.
  const other_text_missing = selected_reason === 'other' && reason_text.trim().length === 0;
  const can_submit = selected_reason !== null && !other_text_missing && !is_submitting;

  const handle_submit = async () => {
    if (selected_reason === null) return;
    // exactOptionalPropertyTypes: omitir la clave por completo cuando no
    // aplica, en vez de asignarle `undefined` explícito.
    const input: SubmitReportInput =
      selected_reason === 'other'
        ? { reason: selected_reason, reason_text }
        : { reason: selected_reason };
    const result = await on_submit(input);
    // Éxito → cierra y limpia. Error → error_message (prop) se ve inline,
    // el sheet permanece abierto para reintentar.
    if (result.ok) {
      reset();
      on_dismiss();
    }
  };

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

        {/* Hoja inferior — onPress vacío para detener propagación al overlay */}
        <Pressable style={styles.sheet} onPress={() => undefined}>

          <View style={styles.handle} />

          <View style={styles.header}>
            <Text style={styles.title}>Reportar publicación</Text>
            <Pressable
              onPress={handle_dismiss}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Cerrar"
            >
              <X size={22} color={colors.ink} weight="bold" />
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.s_16 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {REASONS.map((reason) => {
              const selected = selected_reason === reason.key;
              return (
                <Pressable
                  key={reason.key}
                  onPress={() => set_selected_reason(reason.key)}
                  disabled={is_submitting}
                  style={({ pressed }) => [
                    styles.reason_row,
                    pressed && !is_submitting && styles.reason_row_pressed,
                    is_submitting && styles.reason_row_disabled,
                  ]}
                  accessibilityRole="radio"
                  accessibilityLabel={reason.label}
                  accessibilityState={{ selected, disabled: is_submitting }}
                >
                  <View style={[styles.radio_outer, selected && styles.radio_outer_selected]}>
                    {selected && <View style={styles.radio_inner} />}
                  </View>
                  <Text style={styles.reason_label}>{reason.label}</Text>
                </Pressable>
              );
            })}

            {selected_reason === 'other' && (
              <TextInput
                style={styles.other_input}
                value={reason_text}
                onChangeText={set_reason_text}
                placeholder="Cuéntanos qué pasó"
                placeholderTextColor={colors.gray_1}
                multiline
                editable={!is_submitting}
                accessibilityLabel="Motivo del reporte"
              />
            )}

            {error_message !== null && (
              <Text style={styles.error_text}>{error_message}</Text>
            )}

            <View style={styles.submit_wrap}>
              <PrimaryButton
                label="Enviar reporte"
                onPress={handle_submit}
                disabled={!can_submit}
                loading={is_submitting}
                surface="light"
              />
            </View>
          </ScrollView>

        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Estilos ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({

  overlay: {
    flex: 1,
    backgroundColor: 'rgba(30, 26, 21, 0.45)', // ink_feed con opacidad — sin hardcode hex puro
    justifyContent: 'flex-end',
  },

  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radii.r_16,
    borderTopRightRadius: radii.r_16,
    paddingTop: spacing.s_8,
    maxHeight: '80%',
    ...shadows.md,
  },

  handle: {
    width: 36,
    height: 4,
    borderRadius: radii.r_pill,
    backgroundColor: colors.paper_3,
    alignSelf: 'center',
    marginBottom: spacing.s_8,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.s_24,
    paddingBottom: spacing.s_12,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.ink,
  },

  body: {
    paddingHorizontal: spacing.s_24,
  },

  // ── Fila de motivo (radio) ────────────────────────────────────────────────
  reason_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_12,
    paddingVertical: spacing.s_12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.paper_3,
  },
  reason_row_pressed: {
    backgroundColor: colors.paper_2,
  },
  reason_row_disabled: {
    opacity: 0.4,
  },
  radio_outer: {
    width: 20,
    height: 20,
    borderRadius: radii.r_pill,
    borderWidth: 1.5,
    borderColor: colors.paper_3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radio_outer_selected: {
    borderColor: colors.primary,
  },
  radio_inner: {
    width: 10,
    height: 10,
    borderRadius: radii.r_pill,
    backgroundColor: colors.primary,
  },
  reason_label: {
    flex: 1,
    fontFamily: fonts.sans_semibold,
    fontSize: 15,
    color: colors.ink,
  },

  // ── Campo de texto — solo "Otro" (mirror price_input de FilterSheet) ──────
  other_input: {
    borderWidth: 1,
    borderColor: colors.paper_3,
    borderRadius: radii.r_8,
    paddingHorizontal: spacing.s_12,
    paddingVertical: spacing.s_12,
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.paper_2,
    minHeight: 80,
    textAlignVertical: 'top',
    marginTop: spacing.s_8,
  },

  error_text: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: colors.danger,
    marginTop: spacing.s_12,
  },

  submit_wrap: {
    marginTop: spacing.s_16,
  },
});
