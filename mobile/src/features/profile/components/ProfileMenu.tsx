/**
 * ProfileMenu — menú de acciones del perfil propio (bottom-sheet nativo).
 *
 * Reemplaza la pila de botones full-width del ProfileScreen por un único
 * botón "⋯" que abre este menú. Patrón RN Modal nativo, consistente con
 * FilterSheet / LeadExpandedView (sin @gorhom/bottom-sheet).
 *
 * Presentacional puro: recibe los items ya construidos por el consumidor
 * (label + icono Phosphor + handler + flag destructive). Cierra al tocar
 * un item o el backdrop.
 */
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { type Icon } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radii, spacing, type_scale } from '@/theme/theme';

export type ProfileMenuItem = {
  key: string;
  label: string;
  icon: Icon;
  onPress: () => void;
  /** Estilo destructivo (rojo) — p. ej. Cerrar sesión. */
  destructive?: boolean;
};

export interface ProfileMenuProps {
  visible: boolean;
  onClose: () => void;
  items: ProfileMenuItem[];
}

export function ProfileMenu({ visible, onClose, items }: ProfileMenuProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      {/* Backdrop — cierra al tocar fuera de la hoja */}
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* La hoja intercepta el toque para no cerrar al presionar un item */}
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.s_16 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />

          {items.map((item) => {
            const IconCmp = item.icon;
            const tint = item.destructive ? colors.danger : colors.ink;
            return (
              <Pressable
                key={item.key}
                style={styles.row}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                onPress={() => {
                  onClose();
                  item.onPress();
                }}
              >
                <IconCmp size={22} color={tint} weight="bold" />
                <Text style={[styles.row_label, { color: tint }]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(23,20,15,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radii.r_24,
    borderTopRightRadius: radii.r_24,
    paddingTop: spacing.s_12,
    paddingHorizontal: spacing.s_16,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.paper_3,
    marginBottom: spacing.s_12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_16,
    paddingVertical: spacing.s_16,
  },
  row_label: {
    ...type_scale.body,
  },
});
