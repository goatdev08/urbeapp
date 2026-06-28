/**
 * DeletePropertyDialog — confirmación destructiva de eliminación.
 *
 * Subtarea 17.7.
 *
 * Soft-delete: establece deleted_at en DB. RLS garantiza que solo el dueño
 * puede ejecutarlo. El trigger cascade_soft_delete_property_videos propaga
 * deleted_at a property_videos automáticamente.
 *
 * Copy es-MX. Botón destructivo en colors.danger.
 */

import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { colors, fonts, radii, shadows, spacing, type_scale } from '@/theme/theme';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface DeletePropertyDialogProps {
  visible: boolean;
  property_id: string;
  on_dismiss: () => void;
  on_confirm: (args: { property_id: string }) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function DeletePropertyDialog({
  visible,
  property_id,
  on_dismiss,
  on_confirm,
}: DeletePropertyDialogProps): React.JSX.Element {
  const handle_confirm = () => {
    void on_confirm({ property_id });
    on_dismiss();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={on_dismiss}
      statusBarTranslucent
    >
      {/* Overlay: tap fuera = dismiss */}
      <Pressable style={styles.overlay} onPress={on_dismiss}>
        {/* Diálogo — detiene propagación */}
        <Pressable style={styles.dialog} onPress={() => undefined}>

          <Text style={styles.title}>¿Eliminar esta publicación?</Text>
          <Text style={styles.body_text}>
            Esta acción es permanente y no se puede deshacer.
            La publicación dejará de ser visible para todos los usuarios.
          </Text>

          {/* Acciones */}
          <View style={styles.actions}>
            <TouchableOpacity style={styles.btn_cancel} onPress={on_dismiss}>
              <Text style={styles.btn_cancel_text}>Cancelar</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.btn_delete} onPress={handle_confirm}>
              <Text style={styles.btn_delete_text}>Eliminar</Text>
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
    marginBottom: spacing.s_24,
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

  btn_delete: {
    flex: 2,
    paddingVertical: spacing.s_12,
    borderRadius: radii.r_8,
    backgroundColor: colors.danger,
    alignItems: 'center',
  },
  btn_delete_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 15,
    color: colors.paper,
  },
});
