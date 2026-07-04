/**
 * CopyCard — tarjeta con valor copiable al portapapeles (theme-based).
 *
 * Versión con tokens del design system del CopyCard local de
 * admin/agencies/[id].tsx (que sigue en paleta pre-theme; su migración a este
 * componente queda como deuda del audit pre-#20).
 *
 * Maneja su propio estado "Copiado ✓" con timeout de 2s.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { colors, fonts, radii, spacing, type_scale } from '@/theme/theme';

export interface CopyCardProps {
  label: string;
  value: string;
  /** Renderiza el valor en monospace grande (códigos). */
  monospace?: boolean;
}

export function CopyCard({ label, value, monospace = false }: CopyCardProps) {
  const [copied, set_copied] = useState(false);
  const timeout_ref = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeout_ref.current !== null) {
        clearTimeout(timeout_ref.current);
      }
    };
  }, []);

  const handle_copy = async () => {
    await Clipboard.setStringAsync(value);
    set_copied(true);
    if (timeout_ref.current !== null) {
      clearTimeout(timeout_ref.current);
    }
    timeout_ref.current = setTimeout(() => {
      set_copied(false);
    }, 2000);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <Text
        style={[styles.value, monospace ? styles.value_monospace : null]}
        selectable
        numberOfLines={monospace ? 1 : undefined}
      >
        {value}
      </Text>
      <Pressable
        style={({ pressed }) => [
          styles.button,
          pressed && styles.button_pressed,
          copied ? styles.button_success : null,
        ]}
        onPress={() => { void handle_copy(); }}
        accessibilityRole="button"
        accessibilityLabel={`Copiar ${label}`}
      >
        <Text style={[styles.button_text, copied ? styles.button_text_success : null]}>
          {copied ? 'Copiado ✓' : 'Copiar'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.r_12,
    borderWidth: 1,
    borderColor: colors.paper_3,
    padding: spacing.s_16,
  },
  label: {
    ...type_scale.caption,
    color: colors.gray_2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.s_8,
  },
  value: {
    ...type_scale.body,
    color: colors.ink,
    marginBottom: spacing.s_12,
  },
  value_monospace: {
    fontFamily: 'monospace',
    fontSize: 22,
    letterSpacing: 2,
    fontWeight: '600',
  },
  button: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.s_8,
    paddingHorizontal: spacing.s_20,
    borderRadius: radii.r_pill,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  button_pressed: {
    opacity: 0.75,
  },
  button_success: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  button_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    color: colors.primary,
  },
  button_text_success: {
    color: colors.on_primary,
  },
});
