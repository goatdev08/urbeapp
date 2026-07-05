/**
 * Pantalla de registro de agente — ruta /register (Expo Router).
 *
 * Subtarea 5.7: UI en 2 fases.
 *   Fase 1: el agente ingresa el código de invitación → se valida contra
 *           validate-invitation y se muestra el nombre de la inmobiliaria.
 *   Fase 2: con el código validado, ingresa nombre/apellido/correo/contraseña →
 *           redeem-invitation crea la cuenta y la liga a la inmobiliaria.
 * Subtarea 5.8: auto-login tras el canje (useAuth().signIn) + manejo de errores.
 *
 * Patrón de refs sincrónicas (stale closures en RNTL) tomado de login.tsx.
 * Branding mínimo neutro — diseño visual en pausa hasta tarea #19.
 */
import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, Redirect, useRouter } from 'expo-router';

import { useAuth } from '@/features/auth/context';
import { FormField } from '@/features/auth/components/form-field';
import {
  redeem_invitation,
  validate_invitation,
} from '@/features/registration/api';
import {
  map_network_error,
  map_registration_error_code,
} from '@/features/registration/registration-errors';
import {
  is_form_valid,
  type RegisterFormErrors,
  validate_invitation_code,
  validate_register_form,
} from '@/features/registration/validation';

export default function RegisterScreen() {
  const { signIn, session, isLoading } = useAuth();
  const router = useRouter();

  // Estado del formulario
  const [code, set_code] = useState('');
  const [first_name, set_first_name] = useState('');
  const [last_name, set_last_name] = useState('');
  const [email, set_email] = useState('');
  const [password, set_password] = useState('');
  const [show_password, set_show_password] = useState(false);

  // Fase del flujo: 'code' (validar código) → 'details' (datos + canje)
  const [agency_name, set_agency_name] = useState<string | null>(null);
  const [errors, set_errors] = useState<RegisterFormErrors>({});
  const [is_validating, set_is_validating] = useState(false);
  const [is_submitting, set_is_submitting] = useState(false);
  const [general_error, set_general_error] = useState<string | null>(null);

  // Refs sincrónicas (valores más recientes pese a stale closures en tests)
  const code_ref = useRef('');
  const first_ref = useRef('');
  const last_ref = useRef('');
  const email_ref = useRef('');
  const password_ref = useRef('');

  // Si ya hay sesión, ir a la home.
  if (!isLoading && session !== null) {
    return <Redirect href="/" />;
  }

  const code_validated = agency_name !== null;

  // ── Fase 1: validar el código de invitación ────────────────────────────────
  const handle_validate_code = async () => {
    if (is_validating) return;

    const code_error = validate_invitation_code(code_ref.current);
    set_errors((prev) => {
      const next = { ...prev };
      if (code_error !== undefined) {
        next.invitationCode = code_error;
      } else {
        delete next.invitationCode;
      }
      return next;
    });
    if (code_error !== undefined) return;

    set_general_error(null);
    set_is_validating(true);
    try {
      const result = await validate_invitation(code_ref.current);
      if (result.ok) {
        set_agency_name(result.agency_name);
      } else {
        set_general_error(map_registration_error_code(result.code));
      }
    } catch (err) {
      set_general_error(map_network_error(err));
    } finally {
      set_is_validating(false);
    }
  };

  // ── Fase 2: canjear + auto-login ────────────────────────────────────────────
  const handle_submit = async () => {
    if (is_submitting) return;

    const values = {
      invitationCode: code_ref.current,
      firstName: first_ref.current,
      lastName: last_ref.current,
      email: email_ref.current,
      password: password_ref.current,
    };
    const form_errors = validate_register_form(values);
    set_errors(form_errors);
    if (!is_form_valid(form_errors)) return;

    set_general_error(null);
    set_is_submitting(true);
    try {
      const result = await redeem_invitation(values);
      if (!result.ok) {
        set_general_error(map_registration_error_code(result.code));
        return;
      }
      // Auto-login: reusamos las credenciales recién creadas. El listener
      // onAuthStateChange del AuthProvider captura la sesión y redirige.
      await signIn(values.email.trim(), values.password);
      // El agente recién dado de alta configura su perfil ANTES de entrar al
      // feed (la pantalla navega a /(protected) al terminar). Sin esta ruta el
      // onboarding era inalcanzable (hallazgo E2E 2026-07-04).
      router.replace('/onboarding');
    } catch (err) {
      set_general_error(map_network_error(err));
    } finally {
      set_is_submitting(false);
    }
  };

  const toggle_password_label = show_password ? 'Ocultar' : 'Mostrar';
  const password_toggle = (
    <Pressable
      onPress={() => set_show_password((v) => !v)}
      accessibilityRole="button"
      accessibilityLabel={`${toggle_password_label} contraseña`}
      hitSlop={8}
    >
      <Text style={styles.toggle_text}>{toggle_password_label}</Text>
    </Pressable>
  );

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
            <Text style={styles.brand}>Urbea</Text>
            <Text style={styles.subtitle}>Crea tu cuenta de agente</Text>
          </View>

          <View style={styles.form}>
            <FormField
              testID="register-code"
              label="Código de invitación"
              value={code}
              onChangeText={(t) => {
                code_ref.current = t;
                set_code(t);
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Código que te dio tu inmobiliaria"
              returnKeyType={code_validated ? 'next' : 'done'}
              onSubmitEditing={code_validated ? undefined : handle_validate_code}
              error={errors.invitationCode?.message}
              editable={!code_validated && !is_validating}
            />

            {!code_validated && (
              <Pressable
                style={[styles.submit_button, is_validating && styles.submit_button_disabled]}
                onPress={handle_validate_code}
                disabled={is_validating}
                accessibilityRole="button"
                accessibilityLabel="Validar código"
              >
                {is_validating ? (
                  <View style={styles.submit_loading_row}>
                    <ActivityIndicator testID="validate-spinner" size="small" color="#9CA3AF" />
                    <Text style={[styles.submit_text, styles.submit_text_disabled, styles.submit_loading_label]}>
                      Validando…
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.submit_text}>Validar código</Text>
                )}
              </Pressable>
            )}

            {/* Fase 2: aparece cuando el código es válido */}
            {code_validated && (
              <>
                <View style={styles.agency_banner} accessibilityRole="summary">
                  <Text style={styles.agency_label}>Inmobiliaria</Text>
                  <Text style={styles.agency_name}>{agency_name}</Text>
                </View>

                <FormField
                  testID="register-first-name"
                  label="Nombre"
                  value={first_name}
                  onChangeText={(t) => {
                    first_ref.current = t;
                    set_first_name(t);
                  }}
                  autoCapitalize="words"
                  textContentType="givenName"
                  placeholder="Tu nombre"
                  error={errors.firstName?.message}
                  editable={!is_submitting}
                />
                <FormField
                  testID="register-last-name"
                  label="Apellido"
                  value={last_name}
                  onChangeText={(t) => {
                    last_ref.current = t;
                    set_last_name(t);
                  }}
                  autoCapitalize="words"
                  textContentType="familyName"
                  placeholder="Tu apellido"
                  error={errors.lastName?.message}
                  editable={!is_submitting}
                />
                <FormField
                  testID="register-email"
                  label="Correo electrónico"
                  value={email}
                  onChangeText={(t) => {
                    email_ref.current = t;
                    set_email(t);
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  placeholder="tu@correo.com"
                  error={errors.email?.message}
                  editable={!is_submitting}
                />
                <FormField
                  testID="register-password"
                  label="Contraseña"
                  value={password}
                  onChangeText={(t) => {
                    password_ref.current = t;
                    set_password(t);
                  }}
                  secureTextEntry={!show_password}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  placeholder="Mínimo 8 caracteres"
                  returnKeyType="done"
                  onSubmitEditing={handle_submit}
                  error={errors.password?.message}
                  editable={!is_submitting}
                  right_addon={password_toggle}
                />
              </>
            )}

            {general_error !== null && (
              <View style={styles.error_banner} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                <Text style={styles.error_banner_text}>{general_error}</Text>
              </View>
            )}

            {code_validated && (
              <Pressable
                style={[styles.submit_button, is_submitting && styles.submit_button_disabled]}
                onPress={handle_submit}
                disabled={is_submitting}
                accessibilityRole="button"
                accessibilityLabel="Crear cuenta"
                accessibilityState={{ busy: is_submitting }}
              >
                {is_submitting ? (
                  <View style={styles.submit_loading_row}>
                    <ActivityIndicator testID="submit-spinner" size="small" color="#9CA3AF" />
                    <Text style={[styles.submit_text, styles.submit_text_disabled, styles.submit_loading_label]}>
                      Creando cuenta…
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.submit_text}>Crear cuenta</Text>
                )}
              </Pressable>
            )}

            <View style={styles.login_link_row}>
              <Text style={styles.login_link_text}>¿Ya tienes cuenta? </Text>
              <Link href="/login" style={styles.login_link}>
                Inicia sesión
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 40 },
  header: { marginBottom: 32, alignItems: 'center' },
  brand: { fontSize: 32, fontWeight: '700', color: '#111827', letterSpacing: -0.5, marginBottom: 8 },
  subtitle: { fontSize: 15, color: '#6B7280' },
  form: { width: '100%' },
  toggle_text: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  agency_banner: {
    marginBottom: 16,
    backgroundColor: '#F0FDF4',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  agency_label: { fontSize: 12, color: '#16A34A', fontWeight: '500', marginBottom: 2 },
  agency_name: { fontSize: 16, color: '#111827', fontWeight: '600' },
  submit_button: {
    marginTop: 8,
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submit_button_disabled: { backgroundColor: '#D1D5DB' },
  submit_text: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  submit_text_disabled: { color: '#9CA3AF' },
  submit_loading_row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  submit_loading_label: { marginLeft: 8 },
  error_banner: {
    marginTop: 4,
    marginBottom: 12,
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  error_banner_text: { fontSize: 14, color: '#DC2626', textAlign: 'center' },
  login_link_row: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  login_link_text: { fontSize: 14, color: '#6B7280' },
  login_link: { fontSize: 14, color: '#111827', fontWeight: '600' },
});
