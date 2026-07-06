/**
 * Pantalla de login — ruta /login (Expo Router).
 *
 * Subtarea 2.3: UI + validación de formulario.
 * Subtarea 2.4: conectar handle_submit a useAuth().signIn
 *   y manejar errores del backend (credenciales incorrectas, red, etc.).
 * Subtarea 2.5 (pendiente): protección de rutas — redirigir si ya hay sesión.
 *
 * Nota de implementación — stale closure / RNTL:
 * En el entorno de tests (RNTL v14 + React 19) los fireEvent.changeText() sin
 * await dentro de un act() externo no garantizan que el estado React esté
 * actualizado antes de que se dispare fireEvent.press(). Se usan refs para
 * rastrear los valores actuales de email/password de forma SIEMPRE SINCRÓNICA,
 * independientemente del ciclo de render.
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
import { map_auth_error } from '@/features/auth/auth-errors';
import { FormField } from '@/features/auth/components/form-field';
import {
  is_form_valid,
  validate_login_form,
  type LoginFormErrors,
} from '@/features/auth/validation';
import { UrbeaLockup } from '@/components/UrbeaLockup';
import { brand, colors, fonts } from '@/theme/theme';

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

export default function LoginScreen() {
  const { signIn, session, isLoading } = useAuth();
  const router = useRouter();

  // Estado del formulario
  const [email, set_email] = useState('');
  const [password, set_password] = useState('');
  const [show_password, set_show_password] = useState(false);
  const [errors, set_errors] = useState<LoginFormErrors>({});
  const [touched, set_touched] = useState({ email: false, password: false });
  const [is_submitting, set_is_submitting] = useState(false);
  const [general_error, set_general_error] = useState<string | null>(null);

  // Refs que reflejan siempre el valor más reciente de email/password.
  // Se actualizan de forma sincrónica en los handlers de cambio de texto,
  // lo que resuelve el problema de stale closures cuando handle_submit se
  // ejecuta antes de que React haya refrescado el estado.
  const email_ref = useRef('');
  const password_ref = useRef('');

  // ---------------------------------------------------------------------------
  // Rebote: si ya hay sesión activa (y no estamos cargando), ir a la home.
  // Usamos <Redirect> declarativo (Expo Router SDK 56) para evitar el parpadeo.
  // Mientras isLoading=true no decidimos nada — evita redirect prematuro.
  // ---------------------------------------------------------------------------

  if (!isLoading && session !== null) {
    return <Redirect href="/" />;
  }

  // ---------------------------------------------------------------------------
  // Handlers de cambio de texto
  // ---------------------------------------------------------------------------

  const handle_email_change = (text: string) => {
    email_ref.current = text;
    set_email(text);
  };

  const handle_password_change = (text: string) => {
    password_ref.current = text;
    set_password(text);
  };

  // ---------------------------------------------------------------------------
  // Validación reactiva al perder foco
  // ---------------------------------------------------------------------------

  const handle_email_blur = () => {
    set_touched((prev) => ({ ...prev, email: true }));
    set_errors((prev) => ({
      ...prev,
      ...validate_login_form({ email: email_ref.current, password: password_ref.current }),
    }));
  };

  const handle_password_blur = () => {
    set_touched((prev) => ({ ...prev, password: true }));
    set_errors((prev) => ({
      ...prev,
      ...validate_login_form({ email: email_ref.current, password: password_ref.current }),
    }));
  };

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  const handle_submit = async () => {
    // Evitar doble submit PRIMERO: si ya hay una llamada en vuelo, ignorar sin
    // tocar ningún estado (evita enqueue de state updates en tests con act dangling).
    if (is_submitting) {
      return;
    }

    // Usar refs para obtener los valores MÁS RECIENTES aunque el estado React
    // todavía no se haya re-renderizado (problema de stale closures en tests).
    const current_email = email_ref.current;
    const current_password = password_ref.current;

    // Marcar todos los campos como tocados para mostrar errores inline
    set_touched({ email: true, password: true });

    const form_errors = validate_login_form({ email: current_email, password: current_password });
    set_errors(form_errors);

    if (!is_form_valid(form_errors)) {
      return;
    }

    set_general_error(null);
    set_is_submitting(true);
    try {
      await signIn(current_email.trim(), current_password);
      router.replace('/');
    } catch (err) {
      set_general_error(map_auth_error(err));
    } finally {
      set_is_submitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

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

  const form_errors = validate_login_form({ email, password });
  const can_submit = is_form_valid(form_errors) && !is_submitting;

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

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
          {/* Lockup del logo final (#43.2) — hero vertical: mark verde grande
              + wordmark URBEA debajo, centrado. */}
          <View style={styles.header}>
            <UrbeaLockup size={95} direction="column" />
            <Text style={styles.subtitle}>Inicia sesión para continuar</Text>
          </View>

          {/* Formulario */}
          <View style={styles.form}>
            <FormField
              testID="login-email"
              label="Correo electrónico"
              value={email}
              onChangeText={handle_email_change}
              onBlur={handle_email_blur}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              placeholder="tu@correo.com"
              returnKeyType="next"
              error={touched.email ? errors.email?.message : undefined}
              editable={!is_submitting}
            />

            <FormField
              testID="login-password"
              label="Contraseña"
              value={password}
              onChangeText={handle_password_change}
              onBlur={handle_password_blur}
              secureTextEntry={!show_password}
              autoComplete="current-password"
              textContentType="password"
              placeholder="Mínimo 6 caracteres"
              returnKeyType="done"
              onSubmitEditing={handle_submit}
              error={touched.password ? errors.password?.message : undefined}
              editable={!is_submitting}
              right_addon={password_toggle}
            />

            {general_error !== null && (
              <View
                style={styles.error_banner}
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
              >
                <Text style={styles.error_banner_text}>{general_error}</Text>
              </View>
            )}

            <Pressable
              style={[styles.submit_button, !can_submit && styles.submit_button_disabled]}
              onPress={handle_submit}
              disabled={is_submitting}
              accessibilityRole="button"
              accessibilityLabel="Iniciar sesión"
              accessibilityState={{ disabled: !can_submit, busy: is_submitting }}
            >
              {is_submitting ? (
                <View style={styles.submit_loading_row}>
                  <ActivityIndicator
                    testID="submit-spinner"
                    size="small"
                    color="#9CA3AF"
                  />
                  <Text style={[styles.submit_text, styles.submit_text_disabled, styles.submit_loading_label]}>
                    Iniciando sesión…
                  </Text>
                </View>
              ) : (
                <Text style={[styles.submit_text, !can_submit && styles.submit_text_disabled]}>
                  Iniciar sesión
                </Text>
              )}
            </Pressable>

            {/* Acceso al registro de agente por código de invitación (#20.13):
                sin este enlace la pantalla de código era inalcanzable desde el login. */}
            <View style={styles.register_link_row}>
              <Text style={styles.register_link_text}>¿Tienes un código de invitación? </Text>
              <Link href="/register" style={styles.register_link} accessibilityRole="link">
                Regístrate
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: brand.carnita, // carnita del logo final (#43.2)
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  header: {
    marginBottom: 40,
    alignItems: 'center',
    gap: 16,
  },
  subtitle: {
    fontFamily: fonts.logo, // misma fuente que el wordmark URBEA (Outfit)
    fontSize: 15,
    color: brand.green_deep,
    letterSpacing: 0.3,
  },
  form: {
    width: '100%',
  },
  toggle_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
    color: colors.gray_2,
  },
  submit_button: {
    marginTop: 8,
    backgroundColor: brand.green, // verde del logo final
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submit_button_disabled: {
    backgroundColor: brand.carnita_2,
  },
  submit_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 16,
    color: brand.carnita,
  },
  submit_text_disabled: {
    color: colors.gray_2,
  },
  submit_loading_row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  submit_loading_label: {
    marginLeft: 8,
  },
  error_banner: {
    marginBottom: 12,
    backgroundColor: colors.accent_tint,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  error_banner_text: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.danger,
    textAlign: 'center',
  },
  register_link_row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  register_link_text: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.gray_3,
  },
  register_link: {
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    color: brand.green,
  },
});
