/**
 * /ads/new/step5 — Paso 5 del wizard de anuncios: resumen y envío a revisión.
 * Subtarea 169.9.
 *
 * 🔴 BLOQUEANTE (documentado en la bitácora de esta subtarea, reportado al
 * orquestador — NO inventado aquí): no existe ningún RPC/EF que un miembro
 * autenticado de la organización pueda llamar para crear el registro
 * `ads` (título/CTA/zonas) y dejarlo en `pending_review`.
 *   - `public.grant_ad_slot_atomic` (169.3) es EXCLUSIVO de `service_role`
 *     (revoke a public/anon/authenticated, 20260816000007) — lo invoca el
 *     admin de Urbea a mano desde Studio/CLI (comentario de la propia
 *     función: "lo invoca el admin de Urbea desde Studio/CLI").
 *   - La tabla `public.ads` NO tiene policy de INSERT/UPDATE para
 *     `authenticated` (20260816000005: "Sin policy de INSERT/UPDATE:
 *     exclusivo de RPC/EF security definer futura").
 *   - El criterio de aceptación de la Tarea B (exploración 039) para
 *     "Cliente" solo pide el gate de capacidad + tsc/lint — nada sobre
 *     creación de `ads` desde el wizard.
 * Lo único que ESTE wizard persiste de verdad es el creativo (ad_creatives,
 * vía useAdUpload/169.7 — INSERT sí permitido a `authenticated`, scoped a
 * su agencia). Título/CTA/zonas quedan validados y listos en el resumen,
 * pero no hay dónde escribirlos todavía. "Enviar a revisión" NO simula un
 * éxito que no ocurrió — ver handle_submit.
 */
import React, { useCallback } from 'react';
import { Alert, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAdForm } from '@/features/ads/store/AdFormContext';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radii, spacing, type_scale } from '@/theme/theme';
import type { AdCtaType } from '@/features/ads/lib/validation';

const CTA_TYPE_LABELS: Record<AdCtaType, string> = {
  external_url: 'Enlace',
  whatsapp: 'WhatsApp',
  phone: 'Teléfono',
};

export default function AdStep5Screen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state } = useAdForm();

  const zones_summary =
    state.zones.length === 0
      ? 'Cobertura nacional'
      : state.zones.map((z) => z.name).join(', ');

  // Ver el bloqueante documentado en el header del archivo: no hay endpoint
  // self-service para crear el `ads` en pending_review todavía. No se
  // simula éxito — se informa el estado real (video guardado, resto
  // pendiente de un canal manual con el equipo de Urbea).
  const handle_submit = useCallback(() => {
    Alert.alert(
      'Video guardado',
      'Tu video ya quedó guardado. El envío automático de la campaña todavía no está disponible — nuestro equipo la revisará y se pondrá en contacto para activarla.',
      [{ text: 'Entendido', onPress: () => router.replace('/(protected)/(tabs)/profile') }],
    );
  }, [router]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scroll_content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.page_header}>
          <Text style={styles.page_title}>Resumen</Text>
          <Text style={styles.page_subtitle}>Revisa antes de enviar a revisión.</Text>
        </View>

        <View style={styles.summary_card}>
          <SummaryRow label="Video" value={state.cloudflare_uid ? 'Listo' : 'Sin subir'} />
          <SummaryRow label="Título" value={state.title || '—'} />
          <SummaryRow
            label="CTA"
            value={
              state.cta_type
                ? `${CTA_TYPE_LABELS[state.cta_type]} · ${state.cta_value ?? '—'}`
                : '—'
            }
          />
          <SummaryRow label="Zonas" value={zones_summary} last />
        </View>

        <Text style={styles.disclaimer}>
          Un anuncio nunca se activa solo — el equipo de Urbea lo revisa antes de
          mostrarlo en el feed.
        </Text>
      </ScrollView>

      <View style={[styles.cta_area, { paddingBottom: 16 + insets.bottom }]}>
        <PrimaryButton label="Enviar a revisión" onPress={handle_submit} surface="light" />
      </View>
    </SafeAreaView>
  );
}

function SummaryRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.summary_row, !last && styles.summary_row_border]}>
      <Text style={styles.summary_label}>{label}</Text>
      <Text style={styles.summary_value} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
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
    marginBottom: spacing.s_20,
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
  summary_card: {
    borderRadius: radii.r_16,
    borderWidth: 1,
    borderColor: colors.paper_3,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  summary_row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.s_12,
    paddingHorizontal: spacing.s_16,
    paddingVertical: spacing.s_12,
  },
  summary_row_border: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.paper_3,
  },
  summary_label: {
    fontSize: 13,
    color: colors.gray_2,
  },
  summary_value: {
    flex: 1,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '600' as const,
    color: colors.ink,
  },
  disclaimer: {
    marginTop: spacing.s_16,
    fontSize: 12,
    color: colors.gray_2,
    lineHeight: 18,
  },
  cta_area: {
    paddingHorizontal: spacing.s_20,
    paddingVertical: spacing.s_16,
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderTopColor: colors.paper_3,
  },
});
