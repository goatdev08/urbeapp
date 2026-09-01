/**
 * /ads/new/step3 — Paso 3 del wizard de anuncios: CTA.
 * Subtarea 169.9.
 *
 * REUSO: validate_ad_cta (169.6) es la ÚNICA capa de formato — este screen
 * no reimplementa ninguna regla. 🔴 Se persiste `normalized_value`, NUNCA el
 * string crudo del input (ver cabecera de lib/validation.ts): por eso el
 * input es estado LOCAL (raw_value) y solo al validar en "Siguiente" se
 * escribe a state.cta_value.
 */
import React, { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAdForm } from '@/features/ads/store/AdFormContext';
import { validate_ad_cta, type AdCtaType } from '@/features/ads/lib/validation';
import { SelectionCard } from '@/features/publish/components/SelectionCard';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radii, spacing, type_scale } from '@/theme/theme';

const CTA_OPTIONS: { value: AdCtaType; label: string }[] = [
  { value: 'external_url', label: 'Enlace' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'phone', label: 'Teléfono' },
];

// error_code → mensaje en español (mismo criterio que lead_error_messages.ts:
// mapa local, sin extraer contrato del cliente al código de servidor).
const CTA_ERROR_MESSAGES: Record<string, string> = {
  AD_CTA_URL_INVALID: 'Ingresa un enlace válido que empiece con http:// o https://',
  AD_CTA_PHONE_INVALID: 'Ingresa un número válido (10 a 15 dígitos).',
};

function placeholder_for(cta_type: AdCtaType | null): string {
  if (cta_type === 'external_url') return 'https://tusitio.com/promo';
  if (cta_type === 'whatsapp') return '33 1234 5678';
  if (cta_type === 'phone') return '33 1234 5678';
  return '';
}

export default function AdStep3Screen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state, update } = useAdForm();

  const [raw_value, set_raw_value] = useState(state.cta_value ?? '');
  const [error, set_error] = useState<string | null>(null);

  const handle_type_press = useCallback(
    (value: AdCtaType) => {
      update({ cta_type: value, cta_value: null });
      set_raw_value('');
      set_error(null);
    },
    [update],
  );

  const handle_next = useCallback(() => {
    if (!state.cta_type) return;
    const result = validate_ad_cta(state.cta_type, raw_value);
    if (!result.valid) {
      set_error(CTA_ERROR_MESSAGES[result.error_code ?? ''] ?? 'CTA inválido.');
      return;
    }
    update({ cta_value: result.normalized_value });
    router.push('/ads/new/step4');
  }, [state.cta_type, raw_value, update, router]);

  return (
    <View style={styles.container}>
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
            <Text style={styles.page_title}>Llamado a la acción</Text>
            <Text style={styles.page_subtitle}>
              A dónde va la persona que toca tu anuncio.
            </Text>
          </View>

          <Text style={styles.section_label}>Tipo</Text>
          <View style={styles.row_group}>
            {CTA_OPTIONS.map(({ value, label }) => (
              <View key={value} style={styles.row_item}>
                <SelectionCard
                  label={label}
                  selected={state.cta_type === value}
                  onPress={() => handle_type_press(value)}
                />
              </View>
            ))}
          </View>

          {state.cta_type && (
            <>
              <Text style={styles.section_label}>
                {state.cta_type === 'external_url' ? 'Enlace' : 'Número'}
              </Text>
              <TextInput
                style={styles.input}
                value={raw_value}
                onChangeText={(text) => {
                  set_raw_value(text);
                  set_error(null);
                }}
                placeholder={placeholder_for(state.cta_type)}
                placeholderTextColor={colors.gray_1}
                keyboardType={state.cta_type === 'external_url' ? 'url' : 'phone-pad'}
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Valor del CTA"
              />
              {error && <Text style={styles.error_text}>{error}</Text>}
            </>
          )}
        </ScrollView>

        <View style={[styles.cta_area, { paddingBottom: 16 + insets.bottom }]}>
          <PrimaryButton
            label="Siguiente"
            onPress={handle_next}
            surface="light"
            disabled={!state.cta_type || raw_value.trim().length === 0}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
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
  section_label: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: colors.gray_2,
    letterSpacing: 0.6,
    textTransform: 'uppercase' as const,
    marginBottom: spacing.s_12,
    marginTop: spacing.s_20,
  },
  row_group: {
    flexDirection: 'row',
    gap: spacing.s_8,
  },
  row_item: {
    flex: 1,
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
  error_text: {
    fontSize: 13,
    color: colors.danger,
    marginTop: spacing.s_8,
  },
  cta_area: {
    paddingHorizontal: spacing.s_20,
    paddingVertical: spacing.s_16,
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderTopColor: colors.paper_3,
  },
});
