/**
 * Pantalla de registro — ruta /register (Expo Router).
 *
 * Dos modos en una pantalla:
 *   'user'  (default) — registro libre (§5.1): nombre completo, teléfono,
 *           fecha de nacimiento, estado, municipio, correo + contraseña
 *           (+confirmar). supabase.auth.signUp → trigger handle_new_user crea
 *           el perfil con role='user'. Con autoconfirm activo la sesión entra
 *           directa y el listener del AuthProvider redirige (Redirect abajo).
 *   'agent' — registro de agente por código de invitación (flujo original 5.7/5.8):
 *           validate-invitation → datos → redeem-invitation → auto-login → onboarding.
 *
 * NOTA de import: `RegisterFormErrors`/`validate_register_form` existen en DOS
 * módulos con forma distinta — el de features/auth (modo 'user', §5.1) y el
 * de features/registration (modo 'agent', invitación). Los de features/auth
 * se importan con alias (`UserRegisterForm*`, `validate_user_register_form`)
 * para no chocar; los de features/registration conservan su nombre original.
 *
 * Patrón de refs sincrónicas (stale closures en RNTL) tomado de login.tsx.
 * Branding: espejo del login (#20.13) — fondo carnita + UrbeaLockup + botón verde.
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
import { LocationFields } from '@/features/auth/components/location-fields';
import { supabase } from '@/lib/supabase/client';
import { ConsentCheckbox } from '@/features/auth/components/consent-checkbox';
import { record_signup_consents } from '@/features/auth/record-consents';
import {
  to_e164_mx,
  validate_register_form as validate_user_register_form,
  type FieldError,
  type RegisterFormErrors as UserRegisterFormErrors,
  type RegisterFormValues as UserRegisterFormValues,
} from '@/features/auth/validation';
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
import { UrbeaLockup } from '@/components/UrbeaLockup';
import { brand, colors, fonts } from '@/theme/theme';

type RegisterMode = 'user' | 'agent';

/** Errores del formulario de registro libre (§5.1) — todos los de
 * UserRegisterFormErrors más `confirm`, que es solo UX (no viaja al backend). */
type UserFormErrors = UserRegisterFormErrors & {
  confirm?: FieldError;
  // §5.4/§5.5: los tres consentimientos son obligatorios para registrarse.
  consents?: FieldError;
};

/**
 * Máscara ligera AAAA-MM-DD mientras el usuario teclea solo dígitos.
 *
 * ponytail: no hay date picker instalado (ninguna de las dependencias del
 * proyecto lo trae) y validate_birthdate ya cubre fecha imposible, futura y
 * mayoría de edad — este helper solo necesita guiar el tecleo, no ser a
 * prueba de balas. Un TextInput con esta máscara es el mínimo que funciona.
 */
function format_birthdate_input(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

export default function RegisterScreen() {
  const { signIn, signUp, session, isLoading } = useAuth();
  const router = useRouter();

  // Modo del flujo: registro libre (default) o agente por código.
  const [mode, set_mode] = useState<RegisterMode>('user');

  // ── Estado del registro libre ('user', §5.1) ────────────────────────────────
  const [u_name, set_u_name] = useState('');
  const [u_phone, set_u_phone] = useState('');
  const [u_birthdate, set_u_birthdate] = useState('');
  const [u_state_id, set_u_state_id] = useState('');
  const [u_municipality_id, set_u_municipality_id] = useState('');
  const [u_email, set_u_email] = useState('');
  const [u_password, set_u_password] = useState('');
  const [u_confirm, set_u_confirm] = useState('');
  const [u_errors, set_u_errors] = useState<UserFormErrors>({});
  // Consentimientos (72.6 terms+privacy §5.5, 72.7 whatsapp §5.4). Van en estado y no
  // en refs porque el checkbox necesita re-render para reflejar la palomita.
  const [accept_terms, set_accept_terms] = useState(false);
  const [accept_privacy, set_accept_privacy] = useState(false);
  const [accept_whatsapp, set_accept_whatsapp] = useState(false);
  const u_name_ref = useRef('');
  const u_phone_ref = useRef('');
  const u_birthdate_ref = useRef('');
  const u_state_id_ref = useRef('');
  const u_municipality_id_ref = useRef('');
  const u_email_ref = useRef('');
  const u_password_ref = useRef('');
  const u_confirm_ref = useRef('');

  // ── Estado del registro de agente ('agent') ─────────────────────────────────
  const [code, set_code] = useState('');
  const [first_name, set_first_name] = useState('');
  const [last_name, set_last_name] = useState('');
  const [email, set_email] = useState('');
  const [password, set_password] = useState('');
  const [show_password, set_show_password] = useState(false);

  // Fase del flujo agente: 'code' (validar código) → 'details' (datos + canje)
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

  // ── Registro libre: validar + signUp (§5.1) ─────────────────────────────────
  const validate_user_form = (): UserFormErrors => {
    const values: UserRegisterFormValues = {
      full_name: u_name_ref.current,
      email: u_email_ref.current,
      password: u_password_ref.current,
      phone: u_phone_ref.current,
      birthdate: u_birthdate_ref.current,
      state_id: u_state_id_ref.current,
      municipality_id: u_municipality_id_ref.current,
    };
    const next: UserFormErrors = validate_user_register_form(values);
    if (!accept_terms || !accept_privacy || !accept_whatsapp) {
      next.consents = { message: 'Debes aceptar los tres para crear tu cuenta' };
    }
    if (u_confirm_ref.current !== u_password_ref.current) {
      next.confirm = { message: 'Las contraseñas no coinciden' };
    }
    return next;
  };

  const handle_user_submit = async () => {
    if (is_submitting) return;

    const form_errors = validate_user_form();
    set_u_errors(form_errors);
    if (Object.keys(form_errors).length > 0) return;

    set_general_error(null);
    set_is_submitting(true);
    try {
      // §5.1: el formulario captura un solo campo "nombre completo" — se
      // parte en first_name (primera palabra) / last_name (el resto) al
      // enviar, que es como lo persiste handle_new_user.
      const full_name = u_name_ref.current.trim();
      const name_parts = full_name.split(/\s+/);
      // noUncheckedIndexedAccess tipa name_parts[0] como string|undefined aun
      // sabiendo que full_name no está vacío (ya lo garantizó validate_full_name) —
      // el `?? full_name` solo satisface al compilador, nunca se usa en runtime.
      const first_name_part = name_parts[0] ?? full_name;
      const last_name_part = name_parts.slice(1).join(' ');

      await signUp(u_email_ref.current.trim(), u_password_ref.current, {
        first_name: first_name_part,
        // E.164 SIEMPRE: users_phone_unique_active es un índice único sobre el
        // texto crudo, así que guardar lo tecleado dejaría que '3312345678' y
        // '+523312345678' convivan como cuentas distintas de la misma persona.
        phone: to_e164_mx(u_phone_ref.current),
        date_of_birth: u_birthdate_ref.current.trim(),
        state_id: u_state_id_ref.current.trim(),
        municipality_id: u_municipality_id_ref.current.trim(),
        // exactOptionalPropertyTypes: la clave solo se incluye cuando hay
        // apellido — asignar `undefined` explícito rompería el tipo.
        ...(last_name_part.length > 0 ? { last_name: last_name_part } : {}),
      });

      // Consentimientos (72.6 terms+privacy §5.5, 72.7 whatsapp §5.4). DESPUÉS del
      // signUp a propósito: la policy consents_insert exige user_id = auth.uid(), o sea
      // que sin sesión el INSERT devuelve 42501.
      // Si esto falla NO se aborta el registro — la cuenta ya existe y tumbarla aquí
      // dejaría al usuario sin cuenta y sin explicación. En su lugar entra sin
      // consentimientos registrados, y el gate legal del ProtectedLayout lo detecta en
      // el siguiente render y le pide aceptarlos. Ese gate es justamente la red.
      const { data: session_data } = await supabase.auth.getSession();
      const new_user_id = session_data.session?.user.id;
      if (new_user_id !== undefined) {
        const { error: consent_error } = await record_signup_consents(new_user_id);
        if (consent_error !== null) {
          console.warn('[register] No se pudieron guardar los consentimientos:', consent_error);
        }
      }

      // La sesión llega por onAuthStateChange; el Redirect de arriba (o este
      // replace) lleva a la home. El usuario libre no pasa por onboarding.
      router.replace('/');
    } catch (err) {
      // Caso más común: correo ya registrado → mensaje accionable.
      const err_code =
        typeof err === 'object' && err !== null
          ? (err as { code?: string }).code
          : undefined;
      if (err_code === 'user_already_exists') {
        set_general_error('Ya existe una cuenta con este correo. Inicia sesión.');
      } else {
        set_general_error(map_auth_error(err));
      }
    } finally {
      set_is_submitting(false);
    }
  };

  // ── Agente Fase 1: validar el código de invitación ──────────────────────────
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

  // ── Agente Fase 2: canjear + auto-login ─────────────────────────────────────
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

  // Cambiar de modo limpia el error general (los estados de campo se conservan
  // por si el usuario regresa; no interfieren entre modos).
  const switch_mode = (next: RegisterMode) => {
    set_general_error(null);
    set_mode(next);
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

  const error_banner = general_error !== null && (
    <View style={styles.error_banner} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <Text style={styles.error_banner_text}>{general_error}</Text>
    </View>
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
          {/* Lockup del logo final — mismo hero vertical que el login (#20.13). */}
          <View style={styles.header}>
            <UrbeaLockup size={95} direction="column" />
            <Text style={styles.subtitle}>
              {mode === 'user' ? 'Crea tu cuenta' : 'Crea tu cuenta de agente'}
            </Text>
          </View>

          {/* ══ Modo 'user' — registro libre ══════════════════════════════════ */}
          {mode === 'user' && (
            <View style={styles.form}>
              <FormField
                testID="signup-name"
                label="Nombre completo"
                value={u_name}
                onChangeText={(t) => {
                  u_name_ref.current = t;
                  set_u_name(t);
                }}
                autoCapitalize="words"
                textContentType="name"
                placeholder="Nombre y apellido"
                error={u_errors.full_name?.message}
                editable={!is_submitting}
              />
              <FormField
                testID="signup-phone"
                label="Teléfono"
                value={u_phone}
                onChangeText={(t) => {
                  u_phone_ref.current = t;
                  set_u_phone(t);
                }}
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                placeholder="10 dígitos"
                error={u_errors.phone?.message}
                editable={!is_submitting}
              />
              <FormField
                testID="signup-birthdate"
                label="Fecha de nacimiento"
                value={u_birthdate}
                onChangeText={(t) => {
                  const formatted = format_birthdate_input(t);
                  u_birthdate_ref.current = formatted;
                  set_u_birthdate(formatted);
                }}
                keyboardType="number-pad"
                placeholder="AAAA-MM-DD"
                maxLength={10}
                error={u_errors.birthdate?.message}
                editable={!is_submitting}
              />
              <LocationFields
                state_id={u_state_id}
                municipality_id={u_municipality_id}
                on_change_state={(id) => {
                  u_state_id_ref.current = id;
                  set_u_state_id(id);
                }}
                on_change_municipality={(id) => {
                  u_municipality_id_ref.current = id;
                  set_u_municipality_id(id);
                }}
                state_error={u_errors.state_id?.message}
                municipality_error={u_errors.municipality_id?.message}
                disabled={is_submitting}
              />
              <FormField
                testID="signup-email"
                label="Correo electrónico"
                value={u_email}
                onChangeText={(t) => {
                  u_email_ref.current = t;
                  set_u_email(t);
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                placeholder="tu@correo.com"
                error={u_errors.email?.message}
                editable={!is_submitting}
              />
              <FormField
                testID="signup-password"
                label="Contraseña"
                value={u_password}
                onChangeText={(t) => {
                  u_password_ref.current = t;
                  set_u_password(t);
                }}
                secureTextEntry={!show_password}
                autoComplete="new-password"
                textContentType="newPassword"
                placeholder="Mínimo 6 caracteres"
                error={u_errors.password?.message}
                editable={!is_submitting}
                right_addon={password_toggle}
              />
              <FormField
                testID="signup-confirm"
                label="Confirmar contraseña"
                value={u_confirm}
                onChangeText={(t) => {
                  u_confirm_ref.current = t;
                  set_u_confirm(t);
                }}
                secureTextEntry={!show_password}
                autoComplete="new-password"
                textContentType="newPassword"
                placeholder="Repite tu contraseña"
                returnKeyType="done"
                onSubmitEditing={handle_user_submit}
                error={u_errors.confirm?.message}
                editable={!is_submitting}
              />

              {/* §5.5 (72.6) y §5.4 (72.7) — los tres son obligatorios. Se piden por
                  separado, no con un solo "acepto todo": el consentimiento tiene que
                  ser específico e informado para sostenerse ante la LFPDPPP. */}
              <View style={styles.consents_block}>
                <ConsentCheckbox
                  testID="signup-accept-terms"
                  checked={accept_terms}
                  onToggle={() => set_accept_terms((v) => !v)}
                  disabled={is_submitting}
                  label="Acepto los Términos y Condiciones"
                />
                <ConsentCheckbox
                  testID="signup-accept-privacy"
                  checked={accept_privacy}
                  onToggle={() => set_accept_privacy((v) => !v)}
                  disabled={is_submitting}
                  label="He leído el Aviso de Privacidad"
                />
                <ConsentCheckbox
                  testID="signup-accept-whatsapp"
                  checked={accept_whatsapp}
                  onToggle={() => set_accept_whatsapp((v) => !v)}
                  disabled={is_submitting}
                  label="Acepto que, al contactar a un agente por WhatsApp, comparta con él mis datos de contacto y la propiedad que me interesa"
                  {...(u_errors.consents?.message !== undefined
                    ? { error: u_errors.consents.message }
                    : {})}
                />
              </View>

              {error_banner}

              <Pressable
                style={[styles.submit_button, is_submitting && styles.submit_button_disabled]}
                onPress={handle_user_submit}
                disabled={is_submitting}
                accessibilityRole="button"
                accessibilityLabel="Crear cuenta"
                accessibilityState={{ busy: is_submitting }}
              >
                {is_submitting ? (
                  <View style={styles.submit_loading_row}>
                    <ActivityIndicator testID="signup-spinner" size="small" color="#9CA3AF" />
                    <Text style={[styles.submit_text, styles.submit_text_disabled, styles.submit_loading_label]}>
                      Creando cuenta…
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.submit_text}>Crear cuenta</Text>
                )}
              </Pressable>

              {/* Acceso al flujo de agente por código de invitación */}
              <View style={styles.switch_link_row}>
                <Text style={styles.switch_link_text}>¿Tienes un código de invitación? </Text>
                <Pressable onPress={() => switch_mode('agent')} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.switch_link}>Regístrate como agente</Text>
                </Pressable>
              </View>
            </View>
          )}

          {/* ══ Modo 'agent' — código de invitación (flujo original) ═════════ */}
          {mode === 'agent' && (
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

              {error_banner}

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

              {/* Regreso al registro libre */}
              <View style={styles.switch_link_row}>
                <Text style={styles.switch_link_text}>¿No tienes código? </Text>
                <Pressable onPress={() => switch_mode('user')} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.switch_link}>Crea una cuenta normal</Text>
                </Pressable>
              </View>
            </View>
          )}

          <View style={styles.login_link_row}>
            <Text style={styles.login_link_text}>¿Ya tienes cuenta? </Text>
            <Link href="/login" style={styles.login_link}>
              Inicia sesión
            </Link>
          </View>
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
  },
  form: { width: '100%' },
  toggle_text: { fontFamily: fonts.sans_semibold, fontSize: 13, color: colors.gray_2 },
  agency_banner: {
    marginBottom: 16,
    backgroundColor: colors.primary_tint,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: brand.green,
  },
  agency_label: {
    fontFamily: fonts.sans_semibold,
    fontSize: 12,
    color: brand.green,
    marginBottom: 2,
  },
  agency_name: { fontFamily: fonts.sans_bold, fontSize: 16, color: colors.ink },
  // Los consentimientos van agrupados y separados del bloque de campos: son una
  // decisión distinta a llenar datos.
  consents_block: { marginTop: 8, marginBottom: 4 },
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
  error_banner: {
    marginTop: 4,
    marginBottom: 12,
    backgroundColor: colors.accent_tint,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  error_banner_text: { fontFamily: fonts.sans, fontSize: 14, color: colors.danger, textAlign: 'center' },
  switch_link_row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 24 },
  switch_link_text: { fontFamily: fonts.sans, fontSize: 14, color: colors.gray_3 },
  switch_link: { fontFamily: fonts.sans_semibold, fontSize: 14, color: brand.green },
  login_link_row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 12 },
  login_link_text: { fontFamily: fonts.sans, fontSize: 14, color: colors.gray_3 },
  login_link: { fontFamily: fonts.sans_semibold, fontSize: 14, color: brand.green },
});
