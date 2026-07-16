/**
 * Ruta Stack — editar perfil de agente.
 *
 * Subtarea 22.2: pre-puebla el formulario con los datos reales del usuario.
 *   - 22.3 implementará el guardado (Supabase + Storage).
 *   - 22.4 validación de campos + char counter bio.
 *
 * Estrategia de fetch (ponytail: una sola query):
 *   - bio viene de useAuth().user (ya cargado en memoria por el AuthContext).
 *   - user_preferences → full_name, profile_photo_url (migración 0015; cast `as never`
 *     igual que useAgentProfile.ts y profileService.ts).
 * Loading state: spinner mientras la query de prefs no resuelve.
 *
 * Navegación: Stack hijo de (protected)/profile/. El header nativo provee
 * el botón de retroceso; añadimos un link "Cancelar" a la derecha del header.
 *
 * AvatarPicker — reutilizado de onboarding. API:
 *   uri?: string        → URI de la imagen actual (undefined = placeholder)
 *   onChange?: (uri: string) => void  → callback cuando el usuario elige nueva foto
 *   uploading?: boolean → bloquea el picker durante upload
 */
import React, { useState, useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack , useRouter } from 'expo-router';

import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/features/auth/context';
import { useEditProfile } from '@/features/profile/hooks/useEditProfile';
import { useR2Urls } from '@/hooks/useR2Urls';
import { AvatarPicker } from '@/features/onboarding/components/AvatarPicker';
import { is_valid_full_name } from '@/features/onboarding/validation';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radii, spacing, type_scale } from '@/theme/theme';

// ---------------------------------------------------------------------------
// Constantes de validación
// ---------------------------------------------------------------------------

const NAME_MAX_LENGTH = 100;
const BIO_MAX_LENGTH  = 280;

// ---------------------------------------------------------------------------
// Tipos locales — columnas de migración 0015 no generadas en types
// ---------------------------------------------------------------------------

/** Columnas de user_preferences relevantes para el form de edición. */
type PrefsRow = {
  full_name: string | null;
  profile_photo_url: string | null;
};

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export default function EditProfileScreen() {
  const router = useRouter();
  const { user, session, isLoading: auth_loading } = useAuth();

  // Estado del formulario — inicializado vacío, pre-poblado en useEffect.
  // `saved_avatar_key` es el valor CRUDO guardado en DB (key R2 o URL legacy
  // pre-migración) — nunca se pasa directo a saveProfile ni a <Image>, se
  // resuelve a URL de preview vía useR2Urls (69.6 — el key crudo no es una
  // uri de archivo local que AvatarPicker/expo-image puedan mostrar).
  const [saved_avatar_key, set_saved_avatar_key] = useState<string | undefined>(undefined);
  // `picked_image_uri` solo se setea cuando el usuario ELIGE una foto nueva
  // (AvatarPicker.onChange) — distingue "sin cambios" (KEEP → undefined a
  // saveProfile) de "reemplazar" (REPLACE → uri local a saveProfile). Bug
  // motivador (69.6): antes se reenviaba el key guardado tal cual como
  // imageUri, y saveProfile intentaba `new File(key)` sobre un key R2 que no
  // es un archivo del device → explotaba.
  const [picked_image_uri, set_picked_image_uri] = useState<string | undefined>(undefined);
  // ponytail: removePhoto fijo en false hasta trabajo nuevo (botón de quitar foto)
  const remove_photo = false;

  // Preview de la foto YA guardada — resuelve el key/URL legacy a una URL
  // utilizable (el passthrough de resolve_r2_urls cubre las URLs legacy).
  const { urls: saved_avatar_urls } = useR2Urls([saved_avatar_key]);
  const saved_avatar_url = saved_avatar_urls[0] ?? undefined;
  // El picker muestra la foto recién elegida (preview local inmediata) o,
  // si no hay cambio, la foto guardada ya resuelta a URL.
  const avatar_preview_uri = picked_image_uri ?? saved_avatar_url ?? undefined;
  const [full_name, set_full_name] = useState('');
  const [bio, set_bio] = useState('');

  // Dirty: solo mostrar el error de nombre tras el primer blur o intento de guardar
  const [name_dirty, set_name_dirty] = useState(false);

  // Loading de prefs: true hasta que la query resuelva (o no haya sesión)
  const [prefs_loading, set_prefs_loading] = useState(true);

  // Hook de guardado (22.3 — dual-write híbrido).
  // error no se destructura aquí: usamos el valor DEVUELTO por save() en handle_save
  // para evitar leer un snapshot obsoleto de la closure del render anterior (V2 fix).
  const { save, isSaving } = useEditProfile();

  // Loading compuesto: auth + prefs
  const loading = auth_loading || prefs_loading;

  // ── Validación derivada ──────────────────────────────────────────────────────

  /** Mensaje de error del nombre (null = válido). */
  function get_name_error(name: string): string | null {
    const trimmed = name.trim();
    if (trimmed.length === 0) return 'Nombre requerido';
    if (!is_valid_full_name(name)) return 'Mínimo 2 caracteres';  // reusa is_valid_full_name
    if (trimmed.length > NAME_MAX_LENGTH) return 'Máximo 100 caracteres';
    return null;
  }

  const name_error   = get_name_error(full_name);
  const is_form_valid = name_error === null;

  // Pre-poblar el form al montar.
  // ponytail: bio viene de useAuth().user (ya en memoria); solo una query a Supabase
  // para las cols de migración 0015 que no están en el tipo generado.
  useEffect(() => {
    // Espera a que auth resuelva antes de saber el user_id
    if (auth_loading) return;

    const user_id = session?.user?.id;
    if (!user_id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- guard "sin sesión" del efecto de carga inicial; resetea estado local, no deriva UI.
      set_prefs_loading(false);
      return;
    }

    // bio ya disponible desde el AuthContext (select('*') en users)
    set_bio(user?.bio ?? '');

    // Captura como string definido para que TS no se queje dentro de la closure
    const uid: string = user_id;

    let ignore = false;

    async function fetch_prefs(): Promise<void> {
      // Cast `as never` — mismo patrón que useAgentProfile.ts y profileService.ts
      const { data: raw_prefs, error } = await supabase
        .from('user_preferences')
        .select('full_name, profile_photo_url' as never)
        .eq('user_id', uid)
        .maybeSingle();

      if (ignore) return;

      if (error) {
        console.warn('[EditProfile] Error al cargar user_preferences:', error.message);
        set_prefs_loading(false);
        return;
      }

      const prefs = raw_prefs as PrefsRow | null;
      set_full_name(prefs?.full_name ?? '');
      set_saved_avatar_key(prefs?.profile_photo_url ?? undefined);
      set_prefs_loading(false);
    }

    void fetch_prefs();

    return () => {
      ignore = true;
    };
  }, [auth_loading, session?.user?.id, user?.bio]);

  // Guardado — dual-write híbrido (22.3) + validación (22.4).
  async function handle_save() {
    // Marcar el campo nombre como tocado para mostrar errores si aplica
    set_name_dirty(true);
    if (!is_form_valid) return;

    // Usamos el valor DEVUELTO por save() (no la variable destructurada del render
    // anterior, que es un snapshot obsoleto): garantiza que un fallo parcial
    // siempre llegue al usuario aunque el componente no se haya re-renderizado aún.
    // picked_image_uri undefined (usuario no cambió la foto) → KEEP: no se
    // pasa la key/URL guardada (no es un archivo local), saveProfile omite
    // la columna y conserva el valor existente en DB.
    const save_result = await save({
      fullName: full_name,
      imageUri: picked_image_uri,
      bio,
      removePhoto: remove_photo,
    });
    if (save_result.error) {
      Alert.alert('Error al guardar', save_result.error);
      return;
    }
    router.back();
  }

  return (
    <>
      {/* Header nativo: título centrado + link Cancelar a la derecha */}
      <Stack.Screen
        options={{
          headerShown: true, // el Stack de (protected) trae headerShown:false por defecto
          headerBackButtonDisplayMode: 'minimal', // solo chevron, sin "(tabs)"
          title: 'Editar perfil',
          headerStyle: { backgroundColor: colors.paper },
          headerTintColor: colors.primary,
          headerTitleStyle: {
            fontFamily: 'HankenGrotesk_600SemiBold',
            color: colors.ink,
            fontSize: 17,
          },
          headerRight: () => (
            <Text
              onPress={() => router.back()}
              style={styles.cancel_link}
              accessibilityRole="button"
              accessibilityLabel="Cancelar edición"
            >
              Cancelar
            </Text>
          ),
        }}
      />

      {/* Spinner mientras cargan los datos del perfil */}
      {loading ? (
        <View style={styles.loading_wrap}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : null}

      {/* Formulario — oculto durante la carga para evitar flash de estado vacío */}
      {!loading ? <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scroll_content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Avatar — centrado, margen superior s_32 */}
          <View style={styles.avatar_wrap}>
            <AvatarPicker
              uri={avatar_preview_uri}
              onChange={set_picked_image_uri}
              uploading={false}
            />
          </View>

          {/* Campo: Nombre completo */}
          <View style={styles.field}>
            <Text style={styles.label}>Nombre completo</Text>
            <TextInput
              style={[styles.input, name_dirty && name_error ? styles.input_error : null]}
              value={full_name}
              onChangeText={set_full_name}
              onBlur={() => set_name_dirty(true)}
              placeholder="Tu nombre como aparecerá en el perfil"
              placeholderTextColor={colors.gray_1}
              autoCapitalize="words"
              maxLength={NAME_MAX_LENGTH}
              returnKeyType="next"
              accessibilityLabel="Nombre completo"
            />
            {name_dirty && name_error ? (
              <Text style={styles.field_error}>{name_error}</Text>
            ) : null}
          </View>

          {/* Campo: Bio */}
          <View style={styles.field}>
            <Text style={styles.label}>Bio</Text>
            <TextInput
              style={[styles.input, styles.input_multiline]}
              value={bio}
              onChangeText={set_bio}
              placeholder="Cuéntale a los clientes sobre tu experiencia y especialidad"
              placeholderTextColor={colors.gray_1}
              multiline
              numberOfLines={4}
              maxLength={BIO_MAX_LENGTH}
              textAlignVertical="top"
              returnKeyType="default"
              accessibilityLabel="Biografía profesional"
            />
            {/* Char counter: muestra siempre; se torna accent al llegar al límite */}
            <Text style={[styles.bio_counter, bio.length >= BIO_MAX_LENGTH ? styles.bio_counter_limit : null]}>
              {bio.length}/{BIO_MAX_LENGTH}
            </Text>
          </View>

          {/* Botón Guardar */}
          <View style={styles.save_wrap}>
            <PrimaryButton
              label={isSaving ? 'Guardando…' : 'Guardar'}
              variant="primary"
              surface="light"
              onPress={handle_save}
              disabled={isSaving || !is_form_valid}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Estilos — modo gestión-claro
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.paper,
  },

  // ── Loading ──────────────────────────────────────────────────────────────────
  loading_wrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.paper,
  },
  scroll: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  scroll_content: {
    paddingHorizontal: spacing.s_24,
    paddingBottom: spacing.s_32,
  },

  // ── Avatar ──────────────────────────────────────────────────────────────────
  avatar_wrap: {
    alignItems: 'center',
    marginTop: spacing.s_32,
    // AvatarPicker ya tiene marginBottom: 32 interno (container)
  },

  // ── Campos del formulario ────────────────────────────────────────────────────
  field: {
    marginBottom: spacing.s_16,
  },
  label: {
    ...type_scale.caption,
    color: colors.gray_3,
    marginBottom: spacing.s_8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.silver,
    borderRadius: radii.r_12,
    paddingHorizontal: spacing.s_16,
    paddingVertical: spacing.s_12,
    ...type_scale.body,
    color: colors.ink,
    backgroundColor: colors.paper,
  },
  input_multiline: {
    height: 108,  // ~4 líneas a lineHeight 24 + padding
    paddingTop: spacing.s_12,
  },

  // ── Botón guardar ────────────────────────────────────────────────────────────
  save_wrap: {
    marginTop: spacing.s_24,
  },

  // ── Header cancel link ────────────────────────────────────────────────────────
  cancel_link: {
    ...type_scale.body,
    color: colors.primary,
    paddingRight: spacing.s_8,
  },

  // ── Validación ───────────────────────────────────────────────────────────────
  /** Borde de error en el input de nombre */
  input_error: {
    borderColor: colors.accent,
  },
  /** Mensaje de error inline bajo el campo */
  field_error: {
    ...type_scale.caption,
    color: colors.accent,
    marginTop: spacing.s_4,
    // ponytail: textTransform uppercase viene de caption; sobreescribir para legibilidad
    textTransform: 'none',
    letterSpacing: 0,
  },

  // ── Char counter bio ─────────────────────────────────────────────────────────
  bio_counter: {
    ...type_scale.caption,
    color: colors.gray_1,
    marginTop: spacing.s_4,
    textAlign: 'right',
  },
  bio_counter_limit: {
    color: colors.accent,
  },
});
