/**
 * ConsentCheckbox — checkbox de consentimiento explícito, reutilizable.
 *
 * Usado en el registro libre (§5.4: términos, privacidad, WhatsApp — subtareas
 * 72.6/72.7) y en el muro de re-aceptación (§5.5, features/auth/components/legal-wall.tsx —
 * es un MURO renderizado inline, no una ruta: una ruta se esquiva, un muro no).
 *
 * ponytail: no hay librería de checkbox instalada en el proyecto — un Pressable
 * con el ícono `Check` de phosphor-react-native (ya instalado) es el mínimo que
 * funciona; no se justifica una dependencia nueva para un cuadro con palomita.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'phosphor-react-native';

import { brand, colors, fonts, radii, spacing } from '@/theme/theme';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface ConsentCheckboxProps {
  testID?: string;
  checked: boolean;
  onToggle: () => void;
  label: React.ReactNode;
  error?: string;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function ConsentCheckbox({
  testID,
  checked,
  onToggle,
  label,
  error,
  disabled = false,
}: ConsentCheckboxProps): React.JSX.Element {
  return (
    <View style={styles.wrapper}>
      <Pressable
        testID={testID}
        onPress={onToggle}
        disabled={disabled}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        style={styles.row}
        hitSlop={8}
      >
        <View
          style={[
            styles.box,
            checked && styles.box_checked,
            error !== undefined && styles.box_error,
          ]}
        >
          {checked && <Check size={14} color={brand.carnita} weight="bold" />}
        </View>
        <Text style={styles.label}>{label}</Text>
      </Pressable>
      {error !== undefined && error.length > 0 && (
        <Text style={styles.error_text} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  wrapper: { marginBottom: spacing.s_12 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.s_8 },
  box: {
    width: 22,
    height: 22,
    borderRadius: radii.r_4,
    borderWidth: 1.5,
    borderColor: colors.silver,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    backgroundColor: colors.surface,
  },
  box_checked: {
    backgroundColor: brand.green,
    borderColor: brand.green,
  },
  box_error: {
    borderColor: colors.danger,
  },
  label: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.ink,
  },
  error_text: {
    marginTop: 4,
    marginLeft: 30,
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.danger,
  },
});
