/**
 * CRMScreen — pantalla de leads/CRM para agentes.
 *
 * Subtarea 15.1 — scaffold con role guard.
 * La lista de leads la implementa 15.2; aquí solo el andamio y la cabecera.
 *
 * Paleta: gestión clara (paper) — misma que MyListings / ProfileScreen.
 */
import React from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { colors, layout, spacing, type_scale } from '@/theme/theme';

export function CRMScreen(): React.ReactElement {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Cabecera */}
        <View style={styles.header}>
          <Text style={styles.title}>CRM</Text>
          <Text style={styles.subtitle}>Tus leads de contacto</Text>
        </View>

        {/* Placeholder — 15.2 llenará esta área con la lista real */}
        <View style={styles.placeholder}>
          <Text style={styles.placeholder_text}>Lista de leads — 15.2</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  container: {
    flex: 1,
    paddingHorizontal: layout.screen_inset,
  },
  header: {
    paddingTop: spacing.s_24,
    paddingBottom: spacing.s_16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.silver,
  },
  title: {
    ...type_scale.h1,
    color: colors.ink,
  },
  subtitle: {
    ...type_scale.body,
    color: colors.gray_2,
    marginTop: spacing.s_4,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder_text: {
    ...type_scale.body,
    color: colors.gray_1,
  },
});
