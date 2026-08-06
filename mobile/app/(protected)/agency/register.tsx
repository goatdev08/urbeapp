/**
 * Ruta Stack — alta self-service de una inmobiliaria (§4.7, subtarea 71.4).
 *
 * Entrada: ProfileMenu del perfil propio, visible para `role='user'`
 * (ProfileScreen.tsx) — mismo público que "Convertirme en agente"
 * (/upgrade), pero es un flujo DISTINTO: /upgrade une la cuenta a una
 * inmobiliaria YA EXISTENTE (token o solicitud); esta pantalla FUNDA una
 * inmobiliaria nueva a nombre del usuario autenticado.
 *
 * Invoca la EF `register-agency` (autenticada — created_by_user_id sale
 * SIEMPRE del JWT en el servidor, nunca del payload). La agencia nace
 * `pending_approval`: la cuenta NO cambia de rol ni gana membresía todavía
 * — eso llega con la aprobación admin (71.5). El éxito solo muestra el
 * aviso de revisión pendiente.
 *
 * Validación de forma solo presentacional (trim, longitud mínima, formato de
 * email/slug) — la frontera de confianza real es la EF.
 */
import React, { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { PrimaryButton } from '@/components/PrimaryButton';
import { FormField } from '@/features/auth/components/form-field';
import { register_agency } from '@/features/agency/api';
import { colors, radii, spacing, type_scale } from '@/theme/theme';

// ---------------------------------------------------------------------------
// Constantes de validación (mismo patrón que admin/agencies/create.tsx)
// ---------------------------------------------------------------------------

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Deriva un slug candidato a partir del nombre: minúsculas + espacios→guiones. */
function derive_slug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

interface FormState {
  name: string;
  slug: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
}

interface FormErrors {
  name?: string;
  slug?: string;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
}

function validate_form(fields: FormState): FormErrors {
  const errors: FormErrors = {};

  if (fields.name.trim().length < 2) {
    errors.name = 'El nombre debe tener al menos 2 caracteres.';
  }

  const slug = fields.slug.trim();
  if (slug.length === 0) {
    errors.slug = 'El slug es obligatorio.';
  } else if (!SLUG_REGEX.test(slug)) {
    errors.slug = 'Solo minúsculas, números y guiones (ej. "mi-inmobiliaria").';
  }

  if (fields.contact_name.trim().length === 0) {
    errors.contact_name = 'El nombre de contacto es obligatorio.';
  }

  if (fields.contact_phone.trim().length === 0) {
    errors.contact_phone = 'El teléfono de contacto es obligatorio.';
  }

  if (fields.contact_email.trim().length === 0) {
    errors.contact_email = 'El correo de contacto es obligatorio.';
  } else if (!EMAIL_REGEX.test(fields.contact_email.trim())) {
    errors.contact_email = 'El correo de contacto no es válido.';
  }

  return errors;
}

function is_form_valid(fields: FormState): boolean {
  return Object.keys(validate_form(fields)).length === 0;
}

// ---------------------------------------------------------------------------
// Mensajes de error (code de la EF → español)
// ---------------------------------------------------------------------------

const SUBMIT_FALLBACK_MESSAGE =
  'No se pudo completar el registro. Revisa tu conexión e inténtalo de nuevo.';

const SUBMIT_ERROR_MESSAGES: Record<string, string> = {
  SLUG_DUPLICATE: 'Ya existe una inmobiliaria con ese identificador. Elige otro.',
  NAME_DUPLICATE: 'Ya existe una inmobiliaria con ese nombre.',
  FIELDS_INCOMPLETE: 'Los datos de contacto están incompletos.',
  INVALID_INPUT: 'Revisa los campos e inténtalo de nuevo.',
  UNAUTHENTICATED: 'Tu sesión expiró. Inicia sesión de nuevo.',
};

function submit_error_message(code: string | undefined): string {
  return SUBMIT_ERROR_MESSAGES[code ?? ''] ?? SUBMIT_FALLBACK_MESSAGE;
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

export default function RegisterAgencyScreen() {
  const router = useRouter();

  const [fields, set_fields] = useState<FormState>({
    name: '',
    slug: '',
    contact_name: '',
    contact_phone: '',
    contact_email: '',
  });
  const [errors, set_errors] = useState<FormErrors>({});
  const [submitting, set_submitting] = useState(false);
  const [submit_error, set_submit_error] = useState<string | null>(null);
  const [submitted, set_submitted] = useState(false);

  // ponytail: logo diferido — la EF acepta logo_url opcional; subir con el
  // patrón mint-r2-url (tarea #69) cuando haya una pieza reutilizable de
  // subida de imagen en mobile (hoy no existe fuera del flujo de video).

  // ── Handlers de campos ───────────────────────────────────────────────────

  const handle_name_change = useCallback((text: string) => {
    set_fields((prev) => {
      // Si el slug actual era vacío o igual al derivado del nombre anterior,
      // se auto-actualiza; si el usuario lo editó a mano, se respeta.
      const prev_derived = derive_slug(prev.name);
      const slug_is_auto = prev.slug === '' || prev.slug === prev_derived;
      return {
        ...prev,
        name: text,
        slug: slug_is_auto ? derive_slug(text) : prev.slug,
      };
    });
    set_errors(({ name: _n, ...rest }) => rest);
  }, []);

  function make_field_handler(key: keyof FormState, error_key?: keyof FormErrors) {
    return (text: string) => {
      set_fields((prev) => ({ ...prev, [key]: key === 'slug' ? text.toLowerCase() : text }));
      if (error_key !== undefined) {
        set_errors((e) => {
          const next = { ...e };
          delete next[error_key];
          return next;
        });
      }
    };
  }

  // ── Submit ───────────────────────────────────────────────────────────────

  const handle_submit = useCallback(async () => {
    const validation_errors = validate_form(fields);
    if (Object.keys(validation_errors).length > 0) {
      set_errors(validation_errors);
      return;
    }

    set_submit_error(null);
    set_submitting(true);
    try {
      const result = await register_agency({
        name: fields.name.trim(),
        slug: fields.slug.trim(),
        contact_name: fields.contact_name.trim(),
        contact_phone: fields.contact_phone.trim(),
        contact_email: fields.contact_email.trim(),
        logo_url: null,
      });
      if (!result.ok) {
        set_submit_error(submit_error_message(result.code));
        return;
      }
      set_submitted(true);
    } catch {
      set_submit_error(SUBMIT_FALLBACK_MESSAGE);
    } finally {
      set_submitting(false);
    }
  }, [fields]);

  const form_valid = is_form_valid(fields);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackButtonDisplayMode: 'minimal',
          title: 'Registrar inmobiliaria',
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
          {submitted ? (
            <>
              <View style={styles.success_box}>
                <Text style={styles.success_title}>Solicitud enviada</Text>
                <Text style={styles.option_body}>
                  Tu inmobiliaria quedó en revisión. Un administrador la aprobará
                  pronto — te avisaremos cuando esté activa. Tu cuenta sigue como
                  buscador mientras tanto.
                </Text>
              </View>
              <PrimaryButton label="Volver a mi perfil" onPress={() => router.back()} />
            </>
          ) : (
            <>
              <Text style={styles.intro}>
                Registra tu inmobiliaria en Urbea. Un administrador revisará los
                datos antes de activarla.
              </Text>

              <FormField
                label="Nombre de la inmobiliaria *"
                value={fields.name}
                onChangeText={handle_name_change}
                placeholder="Inmobiliaria Ejemplo"
                error={errors.name}
                autoCapitalize="words"
                editable={!submitting}
                returnKeyType="next"
              />

              <FormField
                label="Identificador único (slug) *"
                value={fields.slug}
                onChangeText={make_field_handler('slug', 'slug')}
                placeholder="inmobiliaria-ejemplo"
                error={errors.slug}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!submitting}
                returnKeyType="next"
              />

              <FormField
                label="Nombre de contacto *"
                value={fields.contact_name}
                onChangeText={make_field_handler('contact_name', 'contact_name')}
                placeholder="Ana García"
                error={errors.contact_name}
                autoCapitalize="words"
                editable={!submitting}
                returnKeyType="next"
              />

              <FormField
                label="Teléfono de contacto *"
                value={fields.contact_phone}
                onChangeText={make_field_handler('contact_phone', 'contact_phone')}
                placeholder="+52 33 1234 5678"
                error={errors.contact_phone}
                keyboardType="phone-pad"
                editable={!submitting}
                returnKeyType="next"
              />

              <FormField
                label="Correo de contacto *"
                value={fields.contact_email}
                onChangeText={make_field_handler('contact_email', 'contact_email')}
                placeholder="contacto@inmobiliaria.mx"
                error={errors.contact_email}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!submitting}
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (form_valid && !submitting) {
                    void handle_submit();
                  }
                }}
              />

              {submit_error !== null && (
                <View style={styles.error_box}>
                  <Text style={styles.error_text}>{submit_error}</Text>
                </View>
              )}

              <PrimaryButton
                label="Enviar registro"
                loading={submitting}
                disabled={!form_valid || submitting}
                onPress={() => void handle_submit()}
              />
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

  option_body: {
    ...type_scale.caption,
    textTransform: 'none',
    letterSpacing: 0,
    color: colors.gray_2,
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
    textTransform: 'none',
    letterSpacing: 0,
    color: colors.danger,
  },

  // ── Éxito (aviso de revisión pendiente) ─────────────────────────────────
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
});
