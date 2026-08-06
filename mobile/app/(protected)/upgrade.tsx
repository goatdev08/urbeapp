/**
 * Ruta Stack — wizard "Convertirme en agente" (§4.2, subtarea 71.3).
 *
 * Entrada: ProfileMenu del perfil propio, solo visible para `role='user'`
 * (ProfileScreen.tsx). Dos caminos, elegidos en el paso inicial:
 *
 *   A) Token de invitación — reusa la EF `validate-invitation` (mismo patrón
 *      que register.tsx modo agente: validar primero, mostrar el nombre de
 *      la inmobiliaria, confirmar) y luego `upgrade-to-agent` para el canje
 *      atómico. Éxito inmediato: la cuenta pasa a `role='agent'` en el
 *      servidor — se refresca la sesión (`supabase.auth.refreshSession()`)
 *      para que el listener `onAuthStateChange` del AuthProvider (TOKEN_
 *      REFRESHED, context.tsx) recargue el perfil sin tocar ese contexto.
 *
 *   B) Solicitud a admin — motivo opcional, crea una `agent_application`
 *      pendiente (EF `request-agent-upgrade`); la cuenta sigue buscador
 *      hasta que un admin la apruebe (71.5).
 *
 * Validación de forma solo presentacional (trim, longitud mínima del código)
 * — la frontera de confianza real son las EFs.
 */
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { CaretRight, IdentificationBadge, PaperPlaneTilt } from 'phosphor-react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { FormField } from '@/features/auth/components/form-field';
import { validate_invitation } from '@/features/registration/api';
import { request_agent_upgrade, upgrade_to_agent } from '@/features/upgrade/api';
import { supabase } from '@/lib/supabase/client';
import { colors, radii, spacing, type_scale } from '@/theme/theme';

// ---------------------------------------------------------------------------
// Mensajes de error (code de la EF → español)
// ---------------------------------------------------------------------------

const TOKEN_FALLBACK_MESSAGE = 'No se pudo completar el proceso. Revisa tu conexión e inténtalo de nuevo.';
const REQUEST_FALLBACK_MESSAGE = 'No se pudo enviar tu solicitud. Revisa tu conexión e inténtalo de nuevo.';

const TOKEN_ERROR_MESSAGES: Record<string, string> = {
  TOKEN_NOT_FOUND: 'El código de invitación no existe. Verifícalo e intenta de nuevo.',
  TOKEN_REVOKED: 'Este código de invitación fue revocado por la inmobiliaria.',
  TOKEN_EXPIRED: 'El código de invitación ha expirado.',
  TOKEN_MAX_USES_REACHED: 'El código de invitación ya no está disponible.',
  AGENCY_INACTIVE: 'La inmobiliaria asociada a este código no está activa.',
  ALREADY_AGENT: 'Tu cuenta ya tiene privilegios de agente.',
  ALREADY_ACTIVE_MEMBER: 'Ya perteneces a una inmobiliaria activa.',
};

const REQUEST_ERROR_MESSAGES: Record<string, string> = {
  DUPLICATE_PENDING_APPLICATION: 'Ya tienes una solicitud pendiente de revisión.',
  ALREADY_AGENT: 'Tu cuenta ya tiene privilegios de agente.',
};

function token_error_message(code: string | undefined): string {
  return TOKEN_ERROR_MESSAGES[code ?? ''] ?? TOKEN_FALLBACK_MESSAGE;
}

function request_error_message(code: string | undefined): string {
  return REQUEST_ERROR_MESSAGES[code ?? ''] ?? REQUEST_FALLBACK_MESSAGE;
}

// ---------------------------------------------------------------------------
// Pasos del wizard
// ---------------------------------------------------------------------------

type WizardStep =
  | 'choose'
  | 'token_input'
  | 'token_confirm'
  | 'token_success'
  | 'request_form'
  | 'request_success';

export default function UpgradeToAgentScreen() {
  const router = useRouter();
  const [step, set_step] = useState<WizardStep>('choose');

  // ── Camino A: token ─────────────────────────────────────────────────────
  const [code, set_code] = useState('');
  const [code_error, set_code_error] = useState<string | undefined>(undefined);
  const [agency_name, set_agency_name] = useState<string | null>(null);
  const [validating, set_validating] = useState(false);
  const [upgrading, set_upgrading] = useState(false);
  const [token_error, set_token_error] = useState<string | null>(null);

  // ── Camino B: solicitud ─────────────────────────────────────────────────
  const [reason, set_reason] = useState('');
  const [requesting, set_requesting] = useState(false);
  const [request_error, set_request_error] = useState<string | null>(null);

  // ── Handlers Camino A ────────────────────────────────────────────────────

  async function handle_validate_code() {
    const trimmed = code.trim();
    if (trimmed.length < 6) {
      set_code_error('El código debe tener al menos 6 caracteres.');
      return;
    }
    set_code_error(undefined);
    set_token_error(null);
    set_validating(true);
    try {
      const result = await validate_invitation(trimmed);
      if (!result.ok) {
        set_token_error(token_error_message(result.code));
        return;
      }
      set_agency_name(result.agency_name);
      set_step('token_confirm');
    } catch {
      set_token_error(TOKEN_FALLBACK_MESSAGE);
    } finally {
      set_validating(false);
    }
  }

  async function handle_confirm_upgrade() {
    set_token_error(null);
    set_upgrading(true);
    try {
      const result = await upgrade_to_agent(code.trim());
      if (!result.ok) {
        set_token_error(token_error_message(result.code));
        return;
      }
      // El servidor ya cambió users.role a 'agent'. La sesión activa no lo
      // sabe hasta que se refresque — refrescar el token dispara el evento
      // TOKEN_REFRESHED que el AuthProvider (context.tsx) ya escucha para
      // recargar el perfil de public.users, sin tocar ese contexto.
      await supabase.auth.refreshSession();
      set_step('token_success');
    } catch {
      set_token_error(TOKEN_FALLBACK_MESSAGE);
    } finally {
      set_upgrading(false);
    }
  }

  // ── Handler Camino B ─────────────────────────────────────────────────────

  async function handle_submit_request() {
    set_request_error(null);
    set_requesting(true);
    try {
      const trimmed = reason.trim();
      const result = await request_agent_upgrade(trimmed.length > 0 ? trimmed : null);
      if (!result.ok) {
        set_request_error(request_error_message(result.code));
        return;
      }
      set_step('request_success');
    } catch {
      set_request_error(REQUEST_FALLBACK_MESSAGE);
    } finally {
      set_requesting(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackButtonDisplayMode: 'minimal',
          title: 'Convertirme en agente',
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
          {step === 'choose' && (
            <>
              <Text style={styles.intro}>
                Elige cómo quieres darte de alta como agente inmobiliario.
              </Text>

              <Pressable
                style={styles.option_card}
                onPress={() => set_step('token_input')}
                accessibilityRole="button"
                accessibilityLabel="Tengo un código de invitación"
              >
                <IdentificationBadge size={28} color={colors.primary} weight="bold" />
                <View style={styles.option_text}>
                  <Text style={styles.option_title}>Tengo un código de invitación</Text>
                  <Text style={styles.option_body}>
                    Una inmobiliaria te invitó — canjea tu código y activa tu cuenta al instante.
                  </Text>
                </View>
                <CaretRight size={20} color={colors.gray_2} />
              </Pressable>

              <Pressable
                style={styles.option_card}
                onPress={() => set_step('request_form')}
                accessibilityRole="button"
                accessibilityLabel="Solicitar revisión a un administrador"
              >
                <PaperPlaneTilt size={28} color={colors.primary} weight="bold" />
                <View style={styles.option_text}>
                  <Text style={styles.option_title}>No tengo un código</Text>
                  <Text style={styles.option_body}>
                    Envía una solicitud — un administrador la revisará antes de activar tu cuenta.
                  </Text>
                </View>
                <CaretRight size={20} color={colors.gray_2} />
              </Pressable>
            </>
          )}

          {step === 'token_input' && (
            <>
              <Text style={styles.intro}>
                Ingresa el código de invitación que te compartió la inmobiliaria.
              </Text>

              <FormField
                label="Código de invitación"
                placeholder="Ej. DEMO2026"
                autoCapitalize="characters"
                value={code}
                onChangeText={set_code}
                error={code_error}
                editable={!validating}
              />

              {token_error !== null && (
                <View style={styles.error_box}>
                  <Text style={styles.error_text}>{token_error}</Text>
                </View>
              )}

              <PrimaryButton
                label="Validar código"
                loading={validating}
                onPress={handle_validate_code}
              />
            </>
          )}

          {step === 'token_confirm' && agency_name !== null && (
            <>
              <View style={styles.confirm_box}>
                <Text style={styles.confirm_title}>Inmobiliaria encontrada</Text>
                <Text style={styles.confirm_agency}>{agency_name}</Text>
                <Text style={styles.option_body}>
                  Al confirmar, tu cuenta se convertirá en agente de esta inmobiliaria de inmediato.
                </Text>
              </View>

              {token_error !== null && (
                <View style={styles.error_box}>
                  <Text style={styles.error_text}>{token_error}</Text>
                </View>
              )}

              <PrimaryButton
                label="Confirmar y convertirme en agente"
                loading={upgrading}
                onPress={handle_confirm_upgrade}
              />
              <PrimaryButton
                label="Cancelar"
                variant="ghost"
                surface="light"
                disabled={upgrading}
                onPress={() => {
                  set_step('token_input');
                  set_agency_name(null);
                  set_token_error(null);
                }}
              />
            </>
          )}

          {step === 'token_success' && (
            <>
              <View style={styles.success_box}>
                <Text style={styles.success_title}>¡Bienvenido, agente!</Text>
                <Text style={styles.option_body}>
                  Tu cuenta ya tiene privilegios de agente. Ya puedes publicar propiedades y gestionar tus leads.
                </Text>
              </View>
              <PrimaryButton label="Ir al inicio" onPress={() => router.replace('/')} />
            </>
          )}

          {step === 'request_form' && (
            <>
              <Text style={styles.intro}>
                Cuéntanos brevemente por qué quieres convertirte en agente (opcional). Un
                administrador revisará tu solicitud.
              </Text>

              <FormField
                label="Motivo (opcional)"
                placeholder="Ej. Soy agente independiente en Guadalajara"
                value={reason}
                onChangeText={set_reason}
                multiline
                numberOfLines={4}
                style={styles.textarea}
                editable={!requesting}
              />

              {request_error !== null && (
                <View style={styles.error_box}>
                  <Text style={styles.error_text}>{request_error}</Text>
                </View>
              )}

              <PrimaryButton
                label="Enviar solicitud"
                loading={requesting}
                onPress={handle_submit_request}
              />
            </>
          )}

          {step === 'request_success' && (
            <>
              <View style={styles.success_box}>
                <Text style={styles.success_title}>Solicitud enviada</Text>
                <Text style={styles.option_body}>
                  Un administrador la revisará pronto. Mientras tanto, tu cuenta sigue como
                  buscador — te avisaremos cuando se apruebe.
                </Text>
              </View>
              <PrimaryButton label="Volver a mi perfil" onPress={() => router.back()} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

// ---------------------------------------------------------------------------
// Estilos — modo gestión-claro (mismo registro que agency/invitations.tsx)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  flex: {
    flex: 1,
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

  // ── Cards de selección de camino ────────────────────────────────────────
  option_card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_12,
    backgroundColor: colors.surface,
    borderRadius: radii.r_12,
    borderWidth: 1,
    borderColor: colors.paper_3,
    padding: spacing.s_16,
  },
  option_text: {
    flex: 1,
    gap: spacing.s_4,
  },
  option_title: {
    ...type_scale.body,
    fontWeight: '600',
    color: colors.ink,
  },
  option_body: {
    ...type_scale.caption,
    textTransform: 'none',
    letterSpacing: 0,
    color: colors.gray_2,
  },

  // ── Confirmación (Camino A) ─────────────────────────────────────────────
  confirm_box: {
    backgroundColor: colors.primary_tint,
    borderRadius: radii.r_12,
    borderWidth: 1,
    borderColor: colors.primary_soft,
    padding: spacing.s_16,
    gap: spacing.s_4,
  },
  confirm_title: {
    ...type_scale.caption,
    color: colors.primary_deep,
  },
  confirm_agency: {
    ...type_scale.h1,
    fontSize: 22,
    color: colors.primary_deep,
  },

  // ── Éxito (ambos caminos) ───────────────────────────────────────────────
  success_box: {
    backgroundColor: colors.primary_tint,
    borderRadius: radii.r_12,
    borderWidth: 1,
    borderColor: colors.primary_soft,
    padding: spacing.s_16,
    gap: spacing.s_8,
  },
  success_title: {
    ...type_scale.h1,
    fontSize: 22,
    color: colors.primary_deep,
  },

  // ── Error de la EF ───────────────────────────────────────────────────────
  error_box: {
    backgroundColor: colors.danger + '14',
    borderRadius: radii.r_8,
    borderWidth: 1,
    borderColor: colors.danger + '44',
    padding: spacing.s_12,
  },
  error_text: {
    ...type_scale.caption,
    textTransform: 'none',
    letterSpacing: 0,
    color: colors.danger,
  },

  textarea: {
    minHeight: 96,
    textAlignVertical: 'top',
    paddingTop: spacing.s_12,
  },
});
