/**
 * PropertyActionMenu — hoja de acciones contextual para un item de propiedad.
 *
 * Subtarea 17.4. Componente puro (sin side-effects): recibe status + callbacks,
 * muestra las acciones correctas según estado, y dispara el callback al seleccionar.
 *
 * Mecanismo: Modal RN nativo con overlay transparente y hoja inferior.
 * ponytail: sin @expo/react-native-action-sheet ni nueva dependencia — Modal es
 * suficiente, funciona uniforme iOS/Android y es testable con props controlados.
 *
 * Visibilidad de acciones según status:
 *   Editar       → siempre (incluso draft/closed — permite corrección)
 *   Pausar       → solo status === 'active'
 *   Reanudar     → solo status === 'paused'
 *   Cerrar       → status === 'active' | 'paused'
 *   Eliminar     → siempre (destructiva)
 *
 * Las mutaciones reales (invocar EF, confirmaciones) llegan en subtarea 17.7.
 * Los callbacks aquí son stubs / no-op hasta entonces.
 */

import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, fonts, radii, shadows, spacing } from '@/theme/theme';
import type { MyProperty } from '@/features/profile/types';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type PropertyStatus = MyProperty['status'];

/** Callbacks de acción — sin lógica aquí; implementados en 17.7 / 17.8. */
export interface PropertyActionCallbacks {
  /** Navegar al wizard de edición con los datos de la propiedad (17.8). */
  on_edit: () => void;
  /** Pausar si status=active; Reanudar si status=paused (17.7). */
  on_toggle_pause: () => void;
  /** Cerrar publicación — abre confirmación (17.7). */
  on_close: () => void;
  /** Eliminar propiedad — abre confirmación destructiva (17.7). */
  on_delete: () => void;
}

export interface PropertyActionMenuProps {
  /** Controla visibilidad del Modal. */
  visible: boolean;
  /** Propiedad activa — null oculta el modal sin renderizar nada. */
  item: MyProperty | null;
  /** Cerrar sin acción (tap overlay o cancelar). */
  on_dismiss: () => void;
  callbacks: PropertyActionCallbacks;
}

// ─── Helpers internos ────────────────────────────────────────────────────────

interface MenuAction {
  key: string;
  label: string;
  handler: () => void;
  /** Si true, se estiliza con colors.danger. */
  destructive?: boolean;
}

function get_actions(status: PropertyStatus, cb: PropertyActionCallbacks): MenuAction[] {
  const actions: MenuAction[] = [];

  // Editar — siempre disponible
  actions.push({ key: 'edit', label: 'Editar', handler: cb.on_edit });

  // Pausar / Reanudar — solo active o paused
  if (status === 'active') {
    actions.push({ key: 'pause', label: 'Pausar', handler: cb.on_toggle_pause });
  } else if (status === 'paused') {
    actions.push({ key: 'unpause', label: 'Reanudar', handler: cb.on_toggle_pause });
  }

  // Cerrar — active o paused
  if (status === 'active' || status === 'paused') {
    actions.push({ key: 'close', label: 'Cerrar', handler: cb.on_close });
  }

  // Eliminar — siempre, destructiva
  actions.push({ key: 'delete', label: 'Eliminar', handler: cb.on_delete, destructive: true });

  return actions;
}

// ─── Componente ──────────────────────────────────────────────────────────────

export function PropertyActionMenu({
  visible,
  item,
  on_dismiss,
  callbacks,
}: PropertyActionMenuProps): React.JSX.Element | null {
  if (!item) return null;

  const actions = get_actions(item.status, callbacks);

  /** Cierra el modal ANTES de invocar el handler para evitar flickering. */
  const handle_action = (handler: () => void) => {
    on_dismiss();
    // ponytail: requestAnimationFrame evita que el Modal se cierre encima del handler
    // (imperceptible en la práctica; sin setTimeout artificial)
    handler();
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

        {/* Hoja inferior — onPress vacío para detener propagación al overlay */}
        <Pressable style={styles.sheet} onPress={() => undefined}>

          {/* Handle visual */}
          <View style={styles.handle} />

          {/* Acciones */}
          {actions.map((action, index) => (
            <Pressable
              key={action.key}
              onPress={() => handle_action(action.handler)}
              style={({ pressed }) => [
                styles.action_row,
                index < actions.length - 1 && styles.action_row_border,
                pressed && styles.action_row_pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={action.label}
            >
              <Text
                style={[
                  styles.action_label,
                  action.destructive && styles.action_destructive,
                ]}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}

          {/* Separador visual antes de Cancelar */}
          <View style={styles.cancel_separator} />

          {/* Cancelar */}
          <Pressable
            onPress={on_dismiss}
            style={({ pressed }) => [
              styles.action_row,
              pressed && styles.action_row_pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Cancelar"
          >
            <Text style={styles.cancel_label}>Cancelar</Text>
          </Pressable>

        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Estilos ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({

  // ── Overlay ────────────────────────────────────────────────────────────────
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(30, 26, 21, 0.45)', // ink_feed con opacidad — sin hardcode hex puro
    justifyContent: 'flex-end',
  },

  // ── Hoja inferior ──────────────────────────────────────────────────────────
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radii.r_16,
    borderTopRightRadius: radii.r_16,
    paddingBottom: spacing.s_32,  // safe area visual; sin react-native-safe-area-context extra
    paddingTop: spacing.s_8,
    ...shadows.md,
  },

  // Handle visual de hoja
  handle: {
    width: 36,
    height: 4,
    borderRadius: radii.r_pill,
    backgroundColor: colors.paper_3,
    alignSelf: 'center',
    marginBottom: spacing.s_8,
  },

  // ── Fila de acción ─────────────────────────────────────────────────────────
  action_row: {
    paddingVertical: spacing.s_16,
    paddingHorizontal: spacing.s_24,
    alignItems: 'center',
  },
  action_row_border: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.paper_3,
  },
  action_row_pressed: {
    backgroundColor: colors.paper_2,
  },

  action_label: {
    fontFamily: fonts.sans_semibold,
    fontSize: 16,
    color: colors.ink,
  },
  /** Estilo destructivo — usa token danger del theme, sin hex hardcodeado. */
  action_destructive: {
    color: colors.danger,
  },

  // Separador visual entre acciones y Cancelar
  cancel_separator: {
    height: spacing.s_8,
    backgroundColor: colors.paper_2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.paper_3,
  },

  cancel_label: {
    fontFamily: fonts.sans_bold,
    fontSize: 16,
    color: colors.gray_2,
  },
});
