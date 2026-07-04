/**
 * Ruta Stack — generación de códigos de invitación (SOLO owner de agencia).
 *
 * Tarea #34: el dueño de una inmobiliaria genera códigos para invitar agentes
 * a SU agencia (la EF create-invitation deriva la agencia del JWT; aquí nunca
 * viaja agency_id). El código se muestra UNA sola vez — en BD queda el hash.
 *
 * Guard: useAgencyRole().isOwner — mismo patrón que admin-layout (spinner
 * mientras carga, Redirect si no es owner). Entrada: botón "Invitar agentes"
 * del perfil propio (visible solo para owners).
 *
 * Alcance UI: máx. de usos opcional (vacío = ilimitado).
 * // ponytail: sin campo de expiración — la EF ya soporta expires_at; se
 * // agrega UI cuando el flujo de gestión de tokens lo pida (techo conocido).
 */
import React, { useState } from 'react';
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
import { FormField } from '@/features/auth/components/form-field';
import { CopyCard } from '@/features/agency/components/CopyCard';
import { useCreateInvitation } from '@/features/agency/hooks/useCreateInvitation';
import { useAgencyRole } from '@/features/leads/hooks/useAgencyRole';
import { colors, radii, spacing, type_scale } from '@/theme/theme';

// ---------------------------------------------------------------------------
// Mensajes de error (code de la EF → español)
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  NOT_AGENCY_OWNER: 'Solo el dueño de la inmobiliaria puede generar códigos.',
  AGENCY_INACTIVE: 'Tu inmobiliaria no está activa. Contacta al administrador.',
  UNKNOWN: 'No se pudo generar el código. Revisa tu conexión e inténtalo de nuevo.',
};

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

export default function AgencyInvitationsScreen() {
  const { isOwner, loading: role_loading } = useAgencyRole();
  const { create, invitation, loading, error_code, reset } = useCreateInvitation();

  const [max_uses_text, set_max_uses_text] = useState('');
  const [input_error, set_input_error] = useState<string | undefined>(undefined);

  // ── Guard de rol (patrón admin-layout) ────────────────────────────────────
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

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handle_generate = () => {
    const trimmed = max_uses_text.trim();
    let max_uses: number | null = null;

    if (trimmed !== '') {
      const parsed = Number(trimmed);
      if (!Number.isInteger(parsed) || parsed < 1) {
        set_input_error('Debe ser un número entero mayor o igual a 1.');
        return;
      }
      max_uses = parsed;
    }

    set_input_error(undefined);
    void create({ max_uses, expires_at: null });
  };

  const handle_generate_another = () => {
    set_max_uses_text('');
    set_input_error(undefined);
    reset();
  };

  const error_message =
    error_code !== null
      ? (ERROR_MESSAGES[error_code] ?? ERROR_MESSAGES.UNKNOWN)
      : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Invitar agentes',
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
          {invitation === null ? (
            <>
              <Text style={styles.intro}>
                Genera un código y compártelo con la persona que quieras invitar
                como agente a tu inmobiliaria. Lo canjeará al crear su cuenta.
              </Text>

              <FormField
                label="Máximo de usos (opcional)"
                placeholder="Ilimitado"
                keyboardType="number-pad"
                value={max_uses_text}
                onChangeText={set_max_uses_text}
                error={input_error}
              />

              {error_message !== null && (
                <View style={styles.error_box}>
                  <Text style={styles.error_text}>{error_message}</Text>
                </View>
              )}

              <PrimaryButton
                label="Generar código"
                loading={loading}
                onPress={handle_generate}
              />
            </>
          ) : (
            <>
              {/* Aviso de una sola vez */}
              <View style={styles.warning_box}>
                <Text style={styles.warning_text}>
                  Este código se muestra UNA sola vez. Cópialo y compártelo
                  ahora — no estará disponible después.
                </Text>
              </View>

              <CopyCard
                label="Código de invitación"
                value={invitation.plain_token}
                monospace
              />

              <Text style={styles.meta_text}>
                {invitation.max_uses === null
                  ? 'Usos: ilimitados'
                  : `Usos máximos: ${invitation.max_uses}`}
              </Text>

              <PrimaryButton
                label="Generar otro código"
                variant="ghost"
                surface="light"
                onPress={handle_generate_another}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

// ---------------------------------------------------------------------------
// Estilos — modo gestión-claro (mismo registro que my-listings / edit)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
  },
  scroll: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  scroll_content: {
    padding: spacing.s_20,
    paddingBottom: spacing.s_40,
    gap: spacing.s_16,
  },

  intro: {
    ...type_scale.body,
    color: colors.gray_3,
  },

  // ── Error de la EF ────────────────────────────────────────────────────────
  error_box: {
    backgroundColor: colors.danger + '14',
    borderRadius: radii.r_8,
    borderWidth: 1,
    borderColor: colors.danger + '44',
    padding: spacing.s_12,
  },
  error_text: {
    ...type_scale.caption,
    color: colors.danger,
  },

  // ── Aviso one-time ────────────────────────────────────────────────────────
  warning_box: {
    backgroundColor: colors.accent_tint,
    borderRadius: radii.r_8,
    borderWidth: 1,
    borderColor: colors.accent_soft,
    padding: spacing.s_12,
  },
  warning_text: {
    ...type_scale.caption,
    color: colors.accent_deep,
  },

  meta_text: {
    ...type_scale.caption,
    color: colors.gray_2,
  },
});
