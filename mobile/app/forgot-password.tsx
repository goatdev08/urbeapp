/**
 * Pantalla "olvidé mi contraseña" — ruta /forgot-password (Expo Router).
 * Subtarea 72.5 (PRD §5.3).
 *
 * Pide el correo y dispara supabase.auth.resetPasswordForEmail (wrapper
 * requestPasswordReset en features/auth/context.tsx). El botón de login que
 * lleva aquí vive en app/login.tsx.
 *
 * Anti-enumeración (regla dura de la subtarea, mismo criterio que
 * map_auth_error con 'invalid_credentials'): el mensaje final es SIEMPRE el
 * de éxito, exista la cuenta o no, y también si `requestPasswordReset` lanza
 * (red caída, rate limit, etc.) — un error distinto ahí filtraría info sobre
 * si el correo está registrado. Por eso el catch está vacío a propósito.
 *
 * BLOQUEANTE (72.3): sin el SMTP de Resend configurado en el proyecto remoto,
 * el correo de recuperación sale por el mailer default de Supabase (rate
 * limited, no apto para producción) — el viaje end-to-end no se puede probar
 * hasta que esa subtarea se destrabe. La UI y la validación sí quedan listas.
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';

import { UrbeaLoader } from '@/components/UrbeaLoader';
import { useAuth } from '@/features/auth/context';
import { FormField } from '@/features/auth/components/form-field';
import { validate_email } from '@/features/auth/validation';
import { UrbeaLockup } from '@/components/UrbeaLockup';
import { brand, colors, fonts } from '@/theme/theme';

export default function ForgotPasswordScreen() {
  const { requestPasswordReset } = useAuth();

  const [email, set_email] = useState('');
  const [touched, set_touched] = useState(false);
  const [is_submitting, set_is_submitting] = useState(false);
  const [submitted, set_submitted] = useState(false);

  const email_error = validate_email(email);

  const handle_submit = async () => {
    if (is_submitting) return;

    set_touched(true);
    if (email_error !== undefined) return;

    set_is_submitting(true);
    try {
      await requestPasswordReset(email.trim());
    } catch (err) {
      // El USUARIO nunca ve este error: mostrar "esa cuenta no existe" convertiría la
      // pantalla en un enumerador de correos registrados (mismo criterio que
      // map_auth_error con invalid_credentials). Pero tragárselo del todo tampoco:
      // un fallo de red o de configuración del SMTP se vería idéntico a un envío
      // exitoso y sería invisible al depurar. Se registra, no se muestra.
      console.warn('[forgot-password] resetPasswordForEmail falló:', err);
    } finally {
      set_is_submitting(false);
      set_submitted(true);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <UrbeaLockup size={95} direction="column" />
            <Text style={styles.subtitle}>
              {submitted ? 'Revisa tu correo' : 'Recupera tu contraseña'}
            </Text>
          </View>

          {submitted ? (
            <View style={styles.form}>
              <Text style={styles.confirmation_text} accessibilityRole="alert">
                Si el correo está registrado, te enviamos un enlace para restablecer tu
                contraseña. Revisa tu bandeja de entrada (y spam).
              </Text>
              <Link href="/login" style={styles.back_link} accessibilityRole="link">
                Volver a iniciar sesión
              </Link>
            </View>
          ) : (
            <View style={styles.form}>
              <Text style={styles.helper_text}>
                Ingresa tu correo y te enviaremos un enlace para restablecer tu contraseña.
              </Text>

              <FormField
                testID="forgot-password-email"
                label="Correo electrónico"
                value={email}
                onChangeText={set_email}
                onBlur={() => set_touched(true)}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                placeholder="tu@correo.com"
                returnKeyType="done"
                onSubmitEditing={handle_submit}
                error={touched ? email_error?.message : undefined}
                editable={!is_submitting}
              />

              <Pressable
                style={[styles.submit_button, is_submitting && styles.submit_button_disabled]}
                onPress={handle_submit}
                disabled={is_submitting}
                accessibilityRole="button"
                accessibilityLabel="Enviar enlace de recuperación"
                accessibilityState={{ busy: is_submitting }}
              >
                {is_submitting ? (
                  <View style={styles.submit_loading_row}>
                    <UrbeaLoader testID="submit-spinner" size="small" color="#9CA3AF" />
                    <Text
                      style={[styles.submit_text, styles.submit_text_disabled, styles.submit_loading_label]}
                    >
                      Enviando…
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.submit_text}>Enviar enlace</Text>
                )}
              </Pressable>

              <View style={styles.back_link_row}>
                <Link href="/login" style={styles.back_link} accessibilityRole="link">
                  Volver a iniciar sesión
                </Link>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: brand.carnita },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  header: { marginBottom: 40, alignItems: 'center', gap: 16 },
  subtitle: {
    fontFamily: fonts.logo,
    fontSize: 15,
    color: brand.green_deep,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  form: { width: '100%' },
  helper_text: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.gray_3,
    marginBottom: 20,
    textAlign: 'center',
  },
  confirmation_text: {
    fontFamily: fonts.sans,
    fontSize: 15,
    color: brand.ink,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  submit_button: {
    marginTop: 8,
    backgroundColor: brand.green,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submit_button_disabled: { backgroundColor: brand.carnita_2 },
  submit_text: { fontFamily: fonts.sans_semibold, fontSize: 16, color: brand.carnita },
  submit_text_disabled: { color: colors.gray_2 },
  submit_loading_row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  submit_loading_label: { marginLeft: 8 },
  back_link_row: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  back_link: {
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    color: brand.green,
    textAlign: 'center',
  },
});
