/**
 * Ruta Stack — editar perfil de agente.
 *
 * Subtarea 22.2: pre-puebla el formulario con los datos reales del usuario.
 *   - 22.3 implementará el guardado (Supabase + Storage).
 *   - 22.4 añadirá validación de campos.
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
import { Stack } from 'expo-router';
import { useRouter } from 'expo-router';

import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/features/auth/context';
import { useEditProfile } from '@/features/profile/hooks/useEditProfile';
import { AvatarPicker } from '@/features/onboarding/components/AvatarPicker';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radii, spacing, type_scale } from '@/theme/theme';

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

  // Estado del formulario — inicializado vacío, pre-poblado en useEffect
  const [avatar_uri, set_avatar_uri] = useState<string | undefined>(undefined);
  // ponytail: removePhoto fijo en false hasta 22.4 (botón de quitar foto aún no existe)
  const remove_photo = false;
  const [full_name, set_full_name] = useState('');
  const [bio, set_bio] = useState('');

  // Loading de prefs: true hasta que la query resuelva (o no haya sesión)
  const [prefs_loading, set_prefs_loading] = useState(true);

  // Hook de guardado (22.3 — dual-write híbrido).
  // error no se destructura aquí: usamos el valor DEVUELTO por save() en handle_save
  // para evitar leer un snapshot obsoleto de la closure del render anterior (V2 fix).
  const { save, isSaving } = useEditProfile();

  // Loading compuesto: auth + prefs
  const loading = auth_loading || prefs_loading;

  // Pre-poblar el form al montar.
  // ponytail: bio viene de useAuth().user (ya en memoria); solo una query a Supabase
  // para las cols de migración 0015 que no están en el tipo generado.
  useEffect(() => {
    // Espera a que auth resuelva antes de saber el user_id
    if (auth_loading) return;

    const user_id = session?.user?.id;
    if (!user_id) {
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
      set_avatar_uri(prefs?.profile_photo_url ?? undefined);
      set_prefs_loading(false);
    }

    void fetch_prefs();

    return () => {
      ignore = true;
    };
  }, [auth_loading, session?.user?.id, user?.bio]);

  // Guardado — dual-write híbrido (22.3). Validación fina en 22.4.
  async function handle_save() {
    // Usamos el valor DEVUELTO por save() (no la variable destructurada del render
    // anterior, que es un snapshot obsoleto): garantiza que un fallo parcial
    // siempre llegue al usuario aunque el componente no se haya re-renderizado aún.
    const save_result = await save({
      fullName: full_name,
      imageUri: avatar_uri ?? null,
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
              uri={avatar_uri}
              onChange={set_avatar_uri}
              uploading={false}
            />
          </View>

          {/* Campo: Nombre completo */}
          <View style={styles.field}>
            <Text style={styles.label}>Nombre completo</Text>
            <TextInput
              style={styles.input}
              value={full_name}
              onChangeText={set_full_name}
              placeholder="Tu nombre como aparecerá en el perfil"
              placeholderTextColor={colors.gray_1}
              autoCapitalize="words"
              returnKeyType="next"
              accessibilityLabel="Nombre completo"
            />
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
              textAlignVertical="top"
              returnKeyType="default"
              accessibilityLabel="Biografía profesional"
            />
          </View>

          {/* Botón Guardar */}
          <View style={styles.save_wrap}>
            <PrimaryButton
              label={isSaving ? 'Guardando…' : 'Guardar'}
              variant="primary"
              surface="light"
              onPress={handle_save}
              disabled={isSaving}
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
});
