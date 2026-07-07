/**
 * OnboardingScreen — pantalla de bienvenida para capturar nombre y foto del agente.
 *
 * Jerarquía editorial (personality kit Urbea):
 *   eyebrow → título grande → subtítulo → campos
 *
 * Superficie: CLARA ("paper" #F6F2EB) — pantalla de gestión, estética híbrida.
 *
 * Subtarea 6.6 — implementado:
 *   - Validación de nombre (requerido, mín 2 chars): is_valid_full_name() + mensaje inline.
 *   - Botón "Saltar por ahora" (ghost): guarda perfil sin foto (imageUri null), exige nombre válido.
 *   - Indicador de progreso: PrimaryButton en loading={uploading} durante el guardado.
 *   - Navegación: router.replace('/(protected)') al completar (continuar o saltar).
 *   - Manejo de error: Alert en español + reseteo de uploading para reintentar.
 *   - Guard de re-show: TODO (ver comentario abajo).
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { AvatarPicker } from './components/AvatarPicker';
import { is_valid_full_name, FULL_NAME_ERROR_MSG } from './validation';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useAuth } from '@/features/auth/context';
import { processProfileImage } from '@/lib/imageUtils';
import { saveProfile } from '@/lib/profileService';
import { supabase } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// Tokens visuales — paper/gestión (alineados con personality kit)
// ---------------------------------------------------------------------------

const COLOR_BG_PAPER = '#F6F2EB';
const COLOR_SALVIA = '#1A5E44';
const COLOR_TEXT_HEADING = '#1A1A1A';
const COLOR_TEXT_BODY = '#4A4A4A';
const COLOR_TEXT_MUTED = '#6B7280';
const COLOR_INPUT_BORDER = '#D1C9BD';
const COLOR_INPUT_BG = '#FFFFFF';
const COLOR_ERROR = '#B91C1C';

// Ruta del home protegido (grupo transparente a la URL en Expo Router)
const HOME_ROUTE = '/(protected)' as const;

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function OnboardingScreen() {
  const router = useRouter();

  // ── Auth context ────────────────────────────────────────────────────────
  const { user } = useAuth();

  // ── Estado del formulario ───────────────────────────────────────────────
  const [full_name, set_full_name] = useState('');
  const [avatar_uri, set_avatar_uri] = useState<string | undefined>(undefined);
  const [uploading, set_uploading] = useState(false);

  // Controla si el usuario ya tocó el campo (para mostrar error solo tras interacción)
  const [name_dirty, set_name_dirty] = useState(false);

  const name_valid = is_valid_full_name(full_name);
  const show_name_error = name_dirty && !name_valid;

  // ── Guard: redirigir si ya completó el onboarding ───────────────────────
  //
  // Comprobamos si full_name ya está guardado en user_preferences.
  // La columna full_name fue añadida en migración 0015 y no aparece en los
  // tipos generados (pre-0015), por lo que usamos el cast `as unknown`.
  // Si ya tiene nombre → ya completó el onboarding → redirigir al home.
  //
  // Se hace una consulta ligera al montar; si falla (error de red, etc.)
  // simplemente dejamos mostrar el onboarding (fail-open, no invasivo).
  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const check_onboarding_done = async () => {
      const { data } = await supabase
        .from('user_preferences')
        .select('full_name')
        .eq('user_id', user.id)
        .maybeSingle();

      if (cancelled) return;

      // Si ya hay un full_name guardado, el onboarding está completo
      const row = data as { full_name: string | null } | null;
      if (row?.full_name && row.full_name.trim().length >= 2) {
        router.replace(HOME_ROUTE);
      }
    };

    check_onboarding_done();

    return () => {
      cancelled = true;
    };
  }, [user, router]);

  // ── Handlers ────────────────────────────────────────────────────────────

  /**
   * Recibe el uri crudo del AvatarPicker, lo comprime/redimensiona (6.4) y actualiza
   * el estado con el uri procesado (listo para preview y upload).
   */
  const handle_avatar_change = async (uri: string) => {
    try {
      const processed = await processProfileImage(uri);
      set_avatar_uri(processed.uri);
    } catch {
      // Si el procesamiento falla (caso raro), caer al uri crudo para no bloquear al usuario.
      set_avatar_uri(uri);
    }
  };

  /**
   * Guarda el perfil del agente (nombre + foto) y navega a la home.
   * Llama a saveProfile con la imageUri actual (puede ser undefined = null).
   */
  const handle_continue = async () => {
    if (!user || !name_valid) return;

    set_uploading(true);
    try {
      await saveProfile({
        fullName: full_name.trim(),
        imageUri: avatar_uri ?? null,
        userId: user.id,
      });
      router.replace(HOME_ROUTE);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Ocurrió un error al guardar tu perfil.';
      Alert.alert('Error al guardar', message, [{ text: 'Reintentar' }]);
    } finally {
      set_uploading(false);
    }
  };

  /**
   * Salta la foto: guarda perfil sin imagen (imageUri null) y navega a la home.
   * El nombre sigue siendo obligatorio (exige nombre válido).
   */
  const handle_skip = async () => {
    if (!user || !name_valid) return;

    set_uploading(true);
    try {
      await saveProfile({
        fullName: full_name.trim(),
        imageUri: null,
        userId: user.id,
      });
      router.replace(HOME_ROUTE);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Ocurrió un error al guardar tu perfil.';
      Alert.alert('Error al guardar', message, [{ text: 'Reintentar' }]);
    } finally {
      set_uploading(false);
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
          {/* ── Cabecera editorial ──────────────────────────────────────── */}
          <View style={styles.header}>
            <Text style={styles.eyebrow}>BIENVENIDO A URBEA</Text>
            <Text style={styles.title}>Tu perfil de{'\n'}agente</Text>
            <Text style={styles.subtitle}>
              Completa tu información para que los clientes puedan encontrarte.
            </Text>
          </View>

          {/* ── Foto de perfil ──────────────────────────────────────────── */}
          <AvatarPicker
            uri={avatar_uri}
            onChange={handle_avatar_change}
            uploading={uploading}
          />

          {/* ── Campo nombre ─────────────────────────────────────────────── */}
          <View style={styles.field_wrap}>
            <Text style={styles.field_label}>Nombre completo</Text>
            <TextInput
              style={[
                styles.field_input,
                show_name_error && styles.field_input_error,
              ]}
              value={full_name}
              onChangeText={(text) => {
                set_full_name(text);
                if (!name_dirty) set_name_dirty(true);
              }}
              onBlur={() => set_name_dirty(true)}
              placeholder="Tu nombre y apellido"
              placeholderTextColor={COLOR_TEXT_MUTED}
              autoCapitalize="words"
              autoCorrect={false}
              autoComplete="name"
              textContentType="name"
              returnKeyType="done"
              editable={!uploading}
              accessibilityLabel="Nombre completo"
              accessibilityHint="Ingresa tu nombre y apellido"
            />
            {show_name_error && (
              <Text style={styles.field_error} accessibilityRole="alert">
                {FULL_NAME_ERROR_MSG}
              </Text>
            )}
          </View>

          {/* ── CTAs ─────────────────────────────────────────────────────── */}
          <View style={styles.cta_group}>
            <PrimaryButton
              label="Continuar"
              onPress={handle_continue}
              surface="light"
              variant="primary"
              disabled={!name_valid}
              loading={uploading}
            />

            <View style={styles.cta_gap} />

            <PrimaryButton
              label="Saltar foto"
              onPress={handle_skip}
              surface="light"
              variant="ghost"
              disabled={!name_valid || uploading}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Estilos — surface: light / paper
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLOR_BG_PAPER,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 40,
    paddingBottom: 40,
  },

  // ── Cabecera editorial ─────────────────────────────────────────────────
  header: {
    marginBottom: 36,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: COLOR_SALVIA,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  title: {
    fontSize: 38,
    fontWeight: '700',
    color: COLOR_TEXT_HEADING,
    lineHeight: 44,
    letterSpacing: -0.8,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 15,
    color: COLOR_TEXT_BODY,
    lineHeight: 22,
    fontWeight: '400',
  },

  // ── Campo de nombre ────────────────────────────────────────────────────
  field_wrap: {
    marginBottom: 36,
  },
  field_label: {
    fontSize: 14,
    fontWeight: '500',
    color: COLOR_TEXT_BODY,
    marginBottom: 8,
  },
  field_input: {
    height: 52,
    borderWidth: 1,
    borderColor: COLOR_INPUT_BORDER,
    borderRadius: 12,
    backgroundColor: COLOR_INPUT_BG,
    paddingHorizontal: 16,
    fontSize: 16,
    color: COLOR_TEXT_HEADING,
    // Sombra sutil para dar profundidad sobre el fondo paper
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  field_input_error: {
    borderColor: COLOR_ERROR,
  },
  field_error: {
    marginTop: 6,
    fontSize: 13,
    color: COLOR_ERROR,
    lineHeight: 18,
  },

  // ── CTAs ───────────────────────────────────────────────────────────────
  cta_group: {
    marginTop: 4,
  },
  cta_gap: {
    height: 12,
  },
});
