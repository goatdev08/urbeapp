/**
 * /ads/new/step5 — Paso 5 del wizard de anuncios: resumen y envío a revisión.
 * Subtarea 169.9, DESBLOQUEADA por #191 (subtarea 170.10).
 *
 * EL BLOQUEANTE QUE 169.9 DOCUMENTÓ YA NO EXISTE. Cuando se escribió este
 * archivo no había ninguna ruta para que un miembro autenticado creara el
 * registro `ads`: grant_ad_slot_atomic está revoke'd a authenticated (lo
 * invoca el admin desde Studio) y `public.ads` no tiene policy de INSERT.
 * Este paso, correctamente, NO simulaba un éxito inexistente — avisaba que el
 * envío automático no estaba disponible.
 *
 * #191 agregó `public.create_ad_campaign_atomic` (security definer, granted a
 * authenticated), y ahora este paso SÍ envía. Lo que la RPC garantiza y este
 * archivo NO debe volver a implementar:
 *   · La agencia sale del JWT, no de un parámetro.
 *   · El ad nace en 'pending_review' — nunca activo. Activarlo es del admin.
 *   · Zonas vacías = cobertura nacional, no error.
 *   · Atómico: ad + zonas, o nada.
 *
 * El único paso extra del cliente es resolver el `creative_id` a partir del
 * `cloudflare_uid` que dejó useAdUpload (169.7): el wizard guarda el uid de
 * Stream, y la RPC —como mint-ad-urls— autoriza por CREATIVO.
 */
import React, { useCallback, useState } from 'react';
import { Alert, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAdForm } from '@/features/ads/store/AdFormContext';
import { PrimaryButton } from '@/components/PrimaryButton';
import { supabase } from '@/lib/supabase/client';
import { colors, radii, spacing, type_scale } from '@/theme/theme';
import type { AdCtaType } from '@/features/ads/lib/validation';

/**
 * Mensajes por código de error de la RPC. Los literales son los que lanza
 * create_ad_campaign_atomic (P0001) — mismo criterio que
 * AD_UPLOAD_IN_PROGRESS en useAdUpload: un estado esperado merece un mensaje
 * entendible, no el genérico.
 */
const ERROR_MESSAGES: Record<string, string> = {
  NOT_AGENCY_MANAGER:
    'Solo el dueño o un administrador de la organización puede enviar campañas.',
  AGENCY_CANNOT_ADVERTISE:
    'Tu organización todavía no tiene habilitada la publicidad. Escríbenos para activarla.',
  CREATIVE_NOT_FOUND:
    'No encontramos tu video listo. Vuelve al primer paso y súbelo de nuevo.',
};
const GENERIC_ERROR =
  'No se pudo enviar la campaña. Revisa tu conexión e intenta de nuevo.';

function message_for(error: unknown): string {
  const raw = (error as { message?: string } | null)?.message ?? '';
  for (const code of Object.keys(ERROR_MESSAGES)) {
    if (raw.includes(code)) return ERROR_MESSAGES[code] as string;
  }
  return GENERIC_ERROR;
}

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

  const [submitting, set_submitting] = useState(false);

  const handle_submit = useCallback(async () => {
    if (submitting) return;
    if (!state.cloudflare_uid || !state.cta_type || !state.cta_value) {
      Alert.alert('Falta información', 'Completa los pasos anteriores antes de enviar.');
      return;
    }
    set_submitting(true);
    try {
      // El wizard guarda el uid de Stream; la RPC autoriza por CREATIVO (igual
      // que mint-ad-urls), así que hay que traducirlo. El filtro por
      // cloudflare_uid basta: RLS ya acota ad_creatives a la propia agencia.
      const { data: creative, error: creative_error } = await supabase
        .from('ad_creatives')
        .select('id')
        .eq('cloudflare_uid', state.cloudflare_uid)
        .maybeSingle();

      if (creative_error || !creative) {
        Alert.alert('No se pudo enviar', ERROR_MESSAGES.CREATIVE_NOT_FOUND as string);
        return;
      }

      const { error } = await supabase.rpc('create_ad_campaign_atomic', {
        p_creative_id: creative.id,
        p_title: state.title,
        p_cta_type: state.cta_type,
        p_cta_value: state.cta_value,
        // Zonas vacías = cobertura nacional. Se manda '[]', no null, para que
        // la intención quede explícita en el payload.
        p_zones: state.zones.map((zone) => ({
          municipality_id: zone.kind === 'municipality' ? zone.id : null,
          neighborhood_id: zone.kind === 'neighborhood' ? Number(zone.id) : null,
        })),
      });

      if (error) {
        Alert.alert('No se pudo enviar', message_for(error));
        return;
      }

      Alert.alert(
        'Campaña enviada',
        'Tu campaña quedó en revisión. El equipo de Urbea la revisa antes de mostrarla en el feed.',
        [{ text: 'Entendido', onPress: () => router.replace('/(protected)/(tabs)/profile') }],
      );
    } catch (err) {
      Alert.alert('No se pudo enviar', message_for(err));
    } finally {
      set_submitting(false);
    }
  }, [submitting, state, router]);

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
        <PrimaryButton
          label={submitting ? 'Enviando…' : 'Enviar a revisión'}
          onPress={() => void handle_submit()}
          surface="light"
          disabled={submitting}
        />
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
