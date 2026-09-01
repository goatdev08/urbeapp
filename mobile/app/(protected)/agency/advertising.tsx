/**
 * Ruta Stack — «Quiero anunciar» (subtarea 221.3, módulo 041-M4).
 *
 * El owner de una agencia SIN `can_advertise` propone una categoría de
 * anunciante; la solicitud queda `pending` hasta que un admin la resuelva
 * desde `/admin/requests` (subtarea 221.4) — la aprobación enciende
 * `can_advertise` vía la EF `set-org-advertising` ya existente (#209).
 *
 * Guard: useAgencyRole().isOwner — mismo patrón que agency/invitations.tsx
 * (spinner mientras carga, Redirect si no es owner). Entrada: ProfileScreen,
 * visible solo para `isOwner && !can_advertise`.
 *
 * Estados: sin solicitud → formulario (categoría + enviar); pending →
 * aviso "en revisión"; approved → aviso de listo (caso borde: la pantalla
 * se visitó justo antes de que can_advertise refrescara en el consumidor);
 * rejected → motivo + botón para solicitar de nuevo (vuelve al formulario).
 *
 * Reusa AdvertiserCategorySelect/ADVERTISER_CATEGORY_LABELS de
 * features/admin/components — la misma lista de categorías que ya usa el
 * admin en agencies/[id].tsx (209.3); es un picker presentacional, no
 * lógica de admin.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Redirect, Stack } from 'expo-router';

import { PrimaryButton } from '@/components/PrimaryButton';
import {
  ADVERTISER_CATEGORY_LABELS,
  AdvertiserCategorySelect,
  type AdvertiserCategory,
} from '@/features/admin/components/advertiser-category-select';
import { useAgencyRole } from '@/features/leads/hooks/useAgencyRole';
import { useMyAdvertisingRequest } from '@/features/agency/hooks/useMyAdvertisingRequest';
import { useCreateAdvertisingRequest } from '@/features/agency/hooks/useCreateAdvertisingRequest';
import { colors, radii, spacing, type_scale } from '@/theme/theme';

export default function AgencyAdvertisingScreen() {
  const { isOwner, agencyId, loading: role_loading } = useAgencyRole();
  const { loading: request_loading, request, error_message, refetch } =
    useMyAdvertisingRequest(agencyId);
  const [category, set_category] = useState<AdvertiserCategory | null>(null);
  const [category_error, set_category_error] = useState<string | undefined>(undefined);
  const [retry_mode, set_retry_mode] = useState(false);

  const { submit, submitting, error: submit_error } = useCreateAdvertisingRequest({
    onSuccess: () => {
      set_retry_mode(false);
      refetch();
    },
  });

  const handle_submit = useCallback(async () => {
    if (category === null) {
      set_category_error('Selecciona una categoría de anunciante.');
      return;
    }
    set_category_error(undefined);
    await submit(category);
  }, [category, submit]);

  // ── Guard de rol (patrón agency/invitations.tsx) ─────────────────────────
  if (role_loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!isOwner) {
    return <Redirect href="/(protected)/(tabs)/profile" />;
  }

  const show_form = request === null || (request.status === 'rejected' && retry_mode);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackButtonDisplayMode: 'minimal',
          title: 'Quiero anunciar',
          headerStyle: { backgroundColor: colors.paper },
          headerTintColor: colors.primary,
          headerTitleStyle: {
            fontFamily: 'HankenGrotesk_600SemiBold',
            color: colors.ink,
            fontSize: 17,
          },
        }}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scroll_content}
          keyboardShouldPersistTaps="handled"
        >
          {request_loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.primary} testID="loading-indicator" />
            </View>
          ) : error_message !== null ? (
            <View style={styles.error_box}>
              <Text style={styles.error_text}>{error_message}</Text>
              <PrimaryButton label="Reintentar" onPress={refetch} surface="light" />
            </View>
          ) : show_form ? (
            <>
              <Text style={styles.intro}>
                Propón una categoría de anunciante para tu inmobiliaria. Un
                administrador revisará la solicitud antes de activar tu
                cuenta comercial.
              </Text>

              <AdvertiserCategorySelect
                value={category}
                onChange={(c) => {
                  set_category(c);
                  set_category_error(undefined);
                }}
                error={category_error}
              />

              {submit_error !== null && (
                <View style={styles.error_box}>
                  <Text style={styles.error_text}>{submit_error}</Text>
                </View>
              )}

              <PrimaryButton
                label="Enviar solicitud"
                loading={submitting}
                disabled={submitting}
                onPress={() => void handle_submit()}
                surface="light"
              />
            </>
          ) : request.status === 'pending' ? (
            <View style={styles.status_box} testID="status-pending">
              <Text style={styles.status_title}>Solicitud en revisión</Text>
              <Text style={styles.status_body}>
                Propusiste la categoría{' '}
                <Text style={styles.status_bold}>
                  {ADVERTISER_CATEGORY_LABELS[request.proposed_category]}
                </Text>
                . Un administrador la revisará pronto — te avisaremos cuando
                haya una respuesta.
              </Text>
            </View>
          ) : request.status === 'approved' ? (
            <View style={styles.status_box} testID="status-approved">
              <Text style={styles.status_title}>Solicitud aprobada</Text>
              <Text style={styles.status_body}>
                Tu cuenta comercial ya está activa. Vuelve a tu perfil para
                crear tu primer anuncio.
              </Text>
            </View>
          ) : (
            <View style={styles.status_box_rejected} testID="status-rejected">
              <Text style={styles.status_title_rejected}>Solicitud rechazada</Text>
              <Text style={styles.status_body}>
                {request.rejection_reason ?? 'El administrador no dejó un motivo.'}
              </Text>
              <PrimaryButton
                label="Solicitar de nuevo"
                onPress={() => set_retry_mode(true)}
                surface="light"
              />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

// ---------------------------------------------------------------------------
// Estilos — mismo registro que agency/register.tsx (gestión-claro)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flex: 1, backgroundColor: colors.paper },
  scroll_content: {
    padding: spacing.s_20,
    paddingBottom: spacing.s_40,
    gap: spacing.s_16,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.s_24,
  },

  intro: {
    ...type_scale.body,
    color: colors.gray_3,
  },

  error_box: {
    backgroundColor: colors.danger + '14',
    borderRadius: radii.r_8,
    borderWidth: 1,
    borderColor: colors.danger + '44',
    padding: spacing.s_12,
    gap: spacing.s_12,
  },
  error_text: {
    ...type_scale.caption,
    textTransform: 'none',
    letterSpacing: 0,
    color: colors.danger,
  },

  status_box: {
    backgroundColor: colors.primary_tint,
    borderRadius: radii.r_12,
    borderWidth: 1,
    borderColor: colors.primary_soft,
    padding: spacing.s_16,
    gap: spacing.s_8,
  },
  status_box_rejected: {
    backgroundColor: colors.danger + '0F',
    borderRadius: radii.r_12,
    borderWidth: 1,
    borderColor: colors.danger + '44',
    padding: spacing.s_16,
    gap: spacing.s_12,
  },
  status_title: {
    ...type_scale.h1,
    fontSize: 20,
    color: colors.primary_deep,
  },
  status_title_rejected: {
    ...type_scale.h1,
    fontSize: 20,
    color: colors.danger,
  },
  status_body: {
    ...type_scale.body,
    color: colors.ink,
  },
  status_bold: {
    fontWeight: '700',
  },
});
