/**
 * CrmSearchSheet — hoja mínima de búsqueda del CRM (#267.7).
 *
 * Solo un TextInput "Buscar por nombre" + "Buscar"/"Limpiar". La búsqueda va
 * SIEMPRE al servidor (p_query de crm_leads_page, nunca filtrado en cliente —
 * regla D7 de la subtarea): al confirmar, `onSubmit(query)` deja que el padre
 * (CRMScreen) pase ese valor a los 4 `useCrmLeadsPage`. La hoja COMPLETA de
 * filtros (banda, temperatura, etc.) es #271 — esto no la anticipa.
 *
 * ponytail: Modal nativo de RN (patrón de LeadExpandedView.tsx, que se borra
 * en esta misma subtarea) — sin librería de bottom-sheet nueva.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, TouchableWithoutFeedback, View } from 'react-native';

import { colors, fonts, radii, spacing } from '@/theme/theme';

export interface CrmSearchSheetProps {
  visible: boolean;
  /** Query activa al abrir la hoja — precarga el input (reabrir tras buscar). */
  initialQuery: string | null;
  onClose: () => void;
  /** trim().length===0 → null (CRMScreen lo interpreta como "sin búsqueda"). */
  onSubmit: (query: string | null) => void;
}

export function CrmSearchSheet({
  visible,
  initialQuery,
  onClose,
  onSubmit,
}: CrmSearchSheetProps): React.JSX.Element {
  const [text, set_text] = useState(initialQuery ?? '');

  // Resincroniza el input con la query activa cada vez que la hoja se abre
  // (si el agente la cierra sin buscar, la próxima apertura no debe arrastrar
  // un borrador viejo de otra sesión de la hoja).
  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resincroniza el input con la query activa en cada apertura de la hoja.
      set_text(initialQuery ?? '');
    }
  }, [visible, initialQuery]);

  function handle_search(): void {
    const trimmed = text.trim();
    onSubmit(trimmed.length > 0 ? trimmed : null);
    onClose();
  }

  function handle_clear(): void {
    set_text('');
    onSubmit(null);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose} accessibilityLabel="Cerrar búsqueda">
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      <View style={styles.sheet}>
        <View style={styles.handle_wrap}>
          <View style={styles.handle} />
        </View>

        <TextInput
          style={styles.input}
          placeholder="Buscar por nombre"
          placeholderTextColor={colors.gray_1}
          value={text}
          onChangeText={set_text}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          onSubmitEditing={handle_search}
          accessibilityLabel="Buscar por nombre"
        />

        <View style={styles.actions}>
          <Pressable
            onPress={handle_clear}
            accessibilityRole="button"
            accessibilityLabel="Limpiar búsqueda"
            style={styles.clear_btn}
          >
            <Text style={styles.clear_text}>Limpiar</Text>
          </Pressable>
          <Pressable
            onPress={handle_search}
            accessibilityRole="button"
            accessibilityLabel="Buscar"
            style={styles.search_btn}
          >
            <Text style={styles.search_btn_text}>Buscar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(30,26,21,0.45)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.r_24,
    borderTopRightRadius: radii.r_24,
    padding: spacing.s_20,
    paddingTop: 0,
  },
  handle_wrap: {
    alignItems: 'center',
    paddingTop: spacing.s_12,
    paddingBottom: spacing.s_16,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.paper_3,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.silver,
    borderRadius: radii.r_12,
    paddingHorizontal: spacing.s_16,
    paddingVertical: spacing.s_12,
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.paper,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.s_16,
    marginTop: spacing.s_16,
  },
  clear_btn: {
    paddingVertical: spacing.s_12,
    paddingHorizontal: spacing.s_8,
  },
  clear_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    color: colors.gray_2,
  },
  search_btn: {
    paddingVertical: spacing.s_12,
    paddingHorizontal: spacing.s_24,
    borderRadius: radii.r_pill,
    backgroundColor: colors.primary,
  },
  search_btn_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    color: colors.on_primary,
  },
});
