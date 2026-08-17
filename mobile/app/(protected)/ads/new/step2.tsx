/**
 * /ads/new/step2 — Paso 2 del wizard de anuncios: título.
 * Subtarea 169.9.
 *
 * ads.title es NOT NULL sin más CHECK en DB (20260816000005) y 169.6 no
 * define un validador dedicado (solo duración/CTA/zonas) — el único
 * requisito real es "no vacío", validado aquí mismo (ponytail: no amerita
 * un módulo de validation.ts propio para una sola regla trivial).
 */
import React, { useCallback } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAdForm } from '@/features/ads/store/AdFormContext';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radii, spacing, type_scale } from '@/theme/theme';

export default function AdStep2Screen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state, update } = useAdForm();

  const is_valid = state.title.trim().length > 0;

  const handle_next = useCallback(() => {
    if (!is_valid) return;
    router.push('/ads/new/step3');
  }, [is_valid, router]);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scroll_content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.page_header}>
            <Text style={styles.page_title}>Título del anuncio</Text>
            <Text style={styles.page_subtitle}>
              Un título corto y claro — es lo primero que se ve en el feed.
            </Text>
          </View>

          <TextInput
            style={styles.input}
            value={state.title}
            onChangeText={(text) => update({ title: text })}
            placeholder="Ej. Departamentos con crédito Infonavit"
            placeholderTextColor={colors.gray_1}
            maxLength={120}
            autoFocus
            accessibilityLabel="Título del anuncio"
          />
        </ScrollView>

        <View style={[styles.cta_area, { paddingBottom: 16 + insets.bottom }]}>
          <PrimaryButton
            label="Siguiente"
            onPress={handle_next}
            surface="light"
            disabled={!is_valid}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scroll_content: {
    paddingHorizontal: spacing.s_20,
    paddingTop: spacing.s_8,
    paddingBottom: spacing.s_24,
  },
  page_header: {
    marginBottom: spacing.s_24,
  },
  page_title: {
    ...type_scale.h1,
    fontSize: 22,
    color: colors.ink,
    marginBottom: spacing.s_4,
  },
  page_subtitle: {
    ...type_scale.body,
    fontSize: 14,
    color: colors.gray_2,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.paper_3,
    borderRadius: radii.r_12,
    paddingHorizontal: spacing.s_16,
    paddingVertical: spacing.s_12,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  cta_area: {
    paddingHorizontal: spacing.s_20,
    paddingVertical: spacing.s_16,
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderTopColor: colors.paper_3,
  },
});
