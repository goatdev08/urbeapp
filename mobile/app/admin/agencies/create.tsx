/**
 * /admin/agencies/create — Formulario para crear una nueva inmobiliaria.
 *
 * Subtarea 7.3 — Create agency form screen.
 *
 * Invoca la Edge Function `admin-create-agency` (JWT del admin se pasa
 * automáticamente por la sesión activa de supabase-js).
 *
 * En éxito navega a /admin/agencies/[id] vía router.replace (el form
 * NO queda en el back-stack para proteger datos sensibles del token).
 *
 * Estética: utilitaria/clara — fondo #FAFAF8, consistente con la lista.
 */
import React, { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { supabase } from '@/lib/supabase/client';
import { PrimaryButton } from '@/components/PrimaryButton';
import { FormField } from '@/features/auth/components/form-field';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface FormState {
  name: string;
  slug: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  owner_email: string;
  owner_first_name: string;
  owner_last_name: string;
}

interface FormErrors {
  name?: string;
  slug?: string;
  contact_email?: string;
  owner_email?: string;
  owner_first_name?: string;
  owner_last_name?: string;
}

// ---------------------------------------------------------------------------
// Constantes de validación
// ---------------------------------------------------------------------------

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Helpers de validación
// ---------------------------------------------------------------------------

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

function validate_form(fields: FormState): FormErrors {
  const errors: FormErrors = {};

  if (fields.name.trim().length < 2) {
    errors.name = 'El nombre debe tener al menos 2 caracteres.';
  }

  const slug = fields.slug.trim();
  if (slug.length === 0) {
    errors.slug = 'El slug es obligatorio.';
  } else if (!SLUG_REGEX.test(slug)) {
    errors.slug =
      'Solo minúsculas, números y guiones (ej. "mi-inmobiliaria-01").';
  }

  if (
    fields.contact_email.trim().length > 0 &&
    !EMAIL_REGEX.test(fields.contact_email.trim())
  ) {
    errors.contact_email = 'El correo de contacto no es válido.';
  }

  if (fields.owner_email.trim().length === 0) {
    errors.owner_email = 'El correo del propietario es obligatorio.';
  } else if (!EMAIL_REGEX.test(fields.owner_email.trim())) {
    errors.owner_email = 'El correo del propietario no es válido.';
  }

  if (fields.owner_first_name.trim().length === 0) {
    errors.owner_first_name = 'El nombre del propietario es obligatorio.';
  }

  if (fields.owner_last_name.trim().length === 0) {
    errors.owner_last_name = 'El apellido del propietario es obligatorio.';
  }

  return errors;
}

function is_form_valid(fields: FormState): boolean {
  return Object.keys(validate_form(fields)).length === 0;
}

// ---------------------------------------------------------------------------
// Mapeo de códigos de error del backend → mensajes en ES
// ---------------------------------------------------------------------------

function map_backend_error(code: string, message?: string): string {
  switch (code) {
    case 'INVALID_INPUT':
      return message ?? 'Datos inválidos. Revisa los campos e inténtalo de nuevo.';
    case 'SLUG_DUPLICATE':
      return 'El slug ya está en uso. Elige otro identificador único.';
    case 'NAME_DUPLICATE':
      return 'Ya existe una inmobiliaria con ese nombre.';
    case 'EMAIL_ALREADY_EXISTS':
      return 'El correo del propietario ya tiene una cuenta en Urbea.';
    case 'ALREADY_ACTIVE_MEMBER':
      return 'El correo del propietario ya es miembro activo de otra inmobiliaria.';
    default:
      return message ?? 'Ocurrió un error inesperado. Inténtalo de nuevo.';
  }
}

// ---------------------------------------------------------------------------
// Pantalla principal
// ---------------------------------------------------------------------------

export default function CreateAgencyScreen(): React.ReactElement {
  const router = useRouter();

  const [fields, set_fields] = useState<FormState>({
    name: '',
    slug: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    owner_email: '',
    owner_first_name: '',
    owner_last_name: '',
  });

  const [errors, set_errors] = useState<FormErrors>({});
  const [submit_error, set_submit_error] = useState<string | null>(null);
  const [is_loading, set_is_loading] = useState(false);

  // ── Handlers de campos ───────────────────────────────────────────────────

  const handle_name_change = useCallback((text: string) => {
    set_fields((prev) => {
      // Si el slug actual era vacío o igual al slug derivado del nombre anterior,
      // lo actualizamos automáticamente. Si el usuario lo editó manualmente, no tocamos.
      const prev_derived = derive_slug(prev.name);
      const slug_is_auto = prev.slug === '' || prev.slug === prev_derived;
      return {
        ...prev,
        name: text,
        slug: slug_is_auto ? derive_slug(text) : prev.slug,
      };
    });
    // Limpiar errores relevantes al escribir
    if (errors.name !== undefined) {
      set_errors(({ name: _n, ...rest }) => rest);
    }
  }, [errors.name]);

  const handle_slug_change = useCallback((text: string) => {
    set_fields((prev) => ({ ...prev, slug: text.toLowerCase() }));
    if (errors.slug !== undefined) {
      set_errors(({ slug: _s, ...rest }) => rest);
    }
  }, [errors.slug]);

  function make_field_handler(
    key: keyof FormState,
    error_key?: keyof FormErrors,
  ) {
    return (text: string) => {
      set_fields((prev) => ({ ...prev, [key]: text }));
      if (error_key !== undefined && errors[error_key] !== undefined) {
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
    // Validación local
    const validation_errors = validate_form(fields);
    if (Object.keys(validation_errors).length > 0) {
      set_errors(validation_errors);
      return;
    }

    set_is_loading(true);
    set_submit_error(null);

    const body: Record<string, string> = {
      name: fields.name.trim(),
      slug: fields.slug.trim(),
      owner_email: fields.owner_email.trim(),
      owner_first_name: fields.owner_first_name.trim(),
      owner_last_name: fields.owner_last_name.trim(),
    };

    if (fields.contact_name.trim().length > 0) {
      body['contact_name'] = fields.contact_name.trim();
    }
    if (fields.contact_email.trim().length > 0) {
      body['contact_email'] = fields.contact_email.trim();
    }
    if (fields.contact_phone.trim().length > 0) {
      body['contact_phone'] = fields.contact_phone.trim();
    }

    const { data, error } = await supabase.functions.invoke(
      'admin-create-agency',
      { body },
    );

    if (error !== null) {
      // FunctionsHttpError: el body JSON viene en error.context
      let error_message =
        'Ocurrió un error al crear la inmobiliaria. Inténtalo de nuevo.';

      try {
        // supabase-js expone el body del error en error.context (FunctionsHttpError)
        const error_body = await (error as { context?: { json?: () => Promise<unknown> } }).context?.json?.() as
          | { error?: { code?: string; message?: string } }
          | undefined;

        if (error_body?.error?.code !== undefined) {
          error_message = map_backend_error(
            error_body.error.code,
            error_body.error.message,
          );
        }
      } catch {
        // Si no se puede parsear, usamos el mensaje por defecto
      }

      set_submit_error(error_message);
      set_is_loading(false);
      return;
    }

    // Éxito → navegar a detalle pasando token de un solo uso por params.
    // router.replace evita que el form quede en el back-stack con datos sensibles.
    const response = data as {
      agency_id: string;
      owner_user_id: string;
      invite_action_link: string;
      plain_token: string;
      token_id: string;
    };

    router.replace({
      pathname: '/admin/agencies/[id]',
      params: {
        id: response.agency_id,
        plain_token: response.plain_token,
        invite_action_link: response.invite_action_link,
      },
    });
  }, [fields, router]);

  const form_valid = is_form_valid(fields);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Volver"
          style={styles.back_button}
        >
          <Text style={styles.back_text}>← Volver</Text>
        </Pressable>
        <Text style={styles.title}>Nueva inmobiliaria</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll_content}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Sección: Datos de la inmobiliaria ─────────────────────── */}
          <Text style={styles.section_title}>Datos de la inmobiliaria</Text>

          <FormField
            label="Nombre *"
            value={fields.name}
            onChangeText={handle_name_change}
            placeholder="Inmobiliaria Ejemplo"
            error={errors.name}
            autoCapitalize="words"
            returnKeyType="next"
          />

          <FormField
            label="Slug (identificador único) *"
            value={fields.slug}
            onChangeText={handle_slug_change}
            placeholder="inmobiliaria-ejemplo"
            error={errors.slug}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />
          <Text style={styles.field_hint}>
            Solo minúsculas, números y guiones. Se auto-deriva del nombre.
          </Text>

          {/* ── Sección: Contacto (opcional) ──────────────────────────── */}
          <Text style={styles.section_title}>Contacto (opcional)</Text>

          <FormField
            label="Nombre de contacto"
            value={fields.contact_name}
            onChangeText={make_field_handler('contact_name')}
            placeholder="Ana García"
            autoCapitalize="words"
            returnKeyType="next"
          />

          <FormField
            label="Correo de contacto"
            value={fields.contact_email}
            onChangeText={make_field_handler('contact_email', 'contact_email')}
            placeholder="contacto@inmobiliaria.mx"
            error={errors.contact_email}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />

          <FormField
            label="Teléfono de contacto"
            value={fields.contact_phone}
            onChangeText={make_field_handler('contact_phone')}
            placeholder="+52 55 1234 5678"
            keyboardType="phone-pad"
            returnKeyType="next"
          />

          {/* ── Sección: Propietario ──────────────────────────────────── */}
          <Text style={styles.section_title}>Propietario</Text>
          <Text style={styles.section_subtitle}>
            Se creará una cuenta en Urbea con estos datos y se le enviará una
            invitación.
          </Text>

          <FormField
            label="Correo del propietario *"
            value={fields.owner_email}
            onChangeText={make_field_handler('owner_email', 'owner_email')}
            placeholder="propietario@email.com"
            error={errors.owner_email}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
          />

          <FormField
            label="Nombre *"
            value={fields.owner_first_name}
            onChangeText={make_field_handler('owner_first_name', 'owner_first_name')}
            placeholder="Carlos"
            error={errors.owner_first_name}
            autoCapitalize="words"
            returnKeyType="next"
          />

          <FormField
            label="Apellido *"
            value={fields.owner_last_name}
            onChangeText={make_field_handler('owner_last_name', 'owner_last_name')}
            placeholder="López"
            error={errors.owner_last_name}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={() => {
              if (form_valid && !is_loading) {
                void handle_submit();
              }
            }}
          />

          {/* ── Error de submit ───────────────────────────────────────── */}
          {submit_error !== null && (
            <View style={styles.submit_error_box} accessibilityRole="alert">
              <Text style={styles.submit_error_text}>{submit_error}</Text>
            </View>
          )}

          {/* ── Botón principal ───────────────────────────────────────── */}
          <View style={styles.cta_wrapper}>
            <PrimaryButton
              label="Crear inmobiliaria"
              onPress={() => void handle_submit()}
              surface="light"
              loading={is_loading}
              disabled={!form_valid || is_loading}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Estilos — utilitaria/clara (consistente con admin/index.tsx)
// ---------------------------------------------------------------------------

const COLOR_BG = '#FAFAF8';
const COLOR_BORDER = '#E5E7EB';
const COLOR_TEXT_PRIMARY = '#1A1A1A';
const COLOR_TEXT_SECONDARY = '#6B7280';
const COLOR_SALVIA = '#5A8A5E';

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: COLOR_BG,
  },

  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLOR_BORDER,
    backgroundColor: COLOR_BG,
  },
  back_button: {
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  back_text: {
    fontSize: 15,
    color: COLOR_SALVIA,
    fontWeight: '500',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLOR_TEXT_PRIMARY,
    letterSpacing: -0.3,
  },

  // ── Scroll ─────────────────────────────────────────────────────────────────
  scroll_content: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 48,
  },

  // ── Secciones ──────────────────────────────────────────────────────────────
  section_title: {
    fontSize: 13,
    fontWeight: '700',
    color: COLOR_TEXT_SECONDARY,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 14,
    marginTop: 8,
  },
  section_subtitle: {
    fontSize: 13,
    color: COLOR_TEXT_SECONDARY,
    lineHeight: 18,
    marginTop: -10,
    marginBottom: 16,
  },
  field_hint: {
    fontSize: 12,
    color: COLOR_TEXT_SECONDARY,
    marginTop: -14,
    marginBottom: 20,
  },

  // ── Error de submit ─────────────────────────────────────────────────────────
  submit_error_box: {
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FECACA',
    padding: 14,
    marginBottom: 16,
  },
  submit_error_text: {
    fontSize: 14,
    color: '#DC2626',
    lineHeight: 20,
  },

  // ── CTA ────────────────────────────────────────────────────────────────────
  cta_wrapper: {
    marginTop: 8,
  },
});
