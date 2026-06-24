/**
 * AvatarPicker — área presionable de foto de perfil.
 *
 * En 6.2 integra expo-image-picker: al presionar ofrece Cámara / Galería
 *        (Alert con opciones), y muestra la preview de la imagen seleccionada.
 * En 6.4 se añadirá compresión sobre el uri retornado.
 * En 6.5 se integrará upload a Supabase Storage.
 *
 * El uri seleccionado se eleva al padre mediante `onChange`.
 * TODO 6.4 — comprimir el uri antes de pasarlo a `onChange`.
 * TODO 6.5 — `onChange` será consumido por la lógica de upload en OnboardingScreen.
 */
import React from 'react';
import {
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useImagePicker } from '../hooks/useImagePicker';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AvatarPickerProps {
  /**
   * URI de la imagen seleccionada; undefined → muestra el placeholder.
   * Proviene del estado de OnboardingScreen (elevado por onChange).
   */
  uri?: string | undefined;
  /**
   * Callback cuando se selecciona un nuevo avatar.
   * TODO 6.4 — el uri llegará crudo; compresión se aplica en 6.4 antes de llamarlo.
   * TODO 6.5 — OnboardingScreen usará este uri para el upload a Supabase Storage.
   */
  onChange?: (uri: string) => void;
  /** Muestra estado de carga (e.g. durante upload en 6.5). */
  uploading?: boolean;
}

// ---------------------------------------------------------------------------
// Tokens visuales
// ---------------------------------------------------------------------------

const AVATAR_SIZE = 100;
const COLOR_SALVIA = '#5A8A5E';
const BG_PAPER = '#F6F2EB';

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function AvatarPicker({ uri, onChange, uploading = false }: AvatarPickerProps) {
  const { pick_from_gallery, pick_from_camera } = useImagePicker();

  /**
   * Muestra un Alert con opciones Cámara / Galería y lanza el picker elegido.
   * Si el usuario cancela el Alert o el picker, no hace nada (uri queda igual).
   */
  const handle_press = () => {
    Alert.alert(
      'Foto de perfil',
      'Elige cómo quieres agregar tu foto',
      [
        {
          text: 'Tomar foto',
          onPress: async () => {
            const result = await pick_from_camera();
            if (result.uri) {
              onChange?.(result.uri);
            }
          },
        },
        {
          text: 'Elegir de galería',
          onPress: async () => {
            const result = await pick_from_gallery();
            if (result.uri) {
              onChange?.(result.uri);
            }
          },
        },
        {
          text: 'Cancelar',
          style: 'cancel',
        },
      ],
      { cancelable: true },
    );
  };

  const has_image = Boolean(uri);

  return (
    <View style={styles.container}>
      <Pressable
        onPress={handle_press}
        disabled={uploading}
        accessibilityRole="button"
        accessibilityLabel="Seleccionar foto de perfil"
        accessibilityHint="Abre opciones para tomar foto o elegir de galería"
        style={({ pressed }) => [
          styles.avatar_circle,
          pressed && styles.avatar_circle_pressed,
        ]}
      >
        {has_image ? (
          /* Preview de la imagen seleccionada */
          <Image
            source={{ uri: uri as string }}
            style={styles.avatar_image}
            accessibilityLabel="Foto de perfil seleccionada"
          />
        ) : (
          /* Silhouette placeholder */
          <View style={styles.silhouette_wrap}>
            <View style={styles.silhouette_head} />
            <View style={styles.silhouette_body} />
          </View>
        )}

        {/* Badge de cámara — siempre visible como indicador de edición */}
        <View style={styles.camera_badge}>
          <View style={styles.camera_body}>
            <View style={styles.camera_lens} />
          </View>
        </View>
      </Pressable>

      <Text style={styles.hint_text}>
        {uploading ? 'Subiendo…' : has_image ? 'Toca para cambiar foto' : 'Toca para agregar foto'}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginBottom: 32,
  },
  avatar_circle: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: '#E8E4DC',
    borderWidth: 2,
    borderColor: COLOR_SALVIA,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'visible', // para el badge
  },
  avatar_circle_pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.96 }],
  },

  // ── Preview de imagen ────────────────────────────────────────────────────
  avatar_image: {
    width: AVATAR_SIZE - 4, // descuenta el border (2px × 2)
    height: AVATAR_SIZE - 4,
    borderRadius: (AVATAR_SIZE - 4) / 2,
  },

  // ── Silhouette placeholder ──────────────────────────────────────────────
  silhouette_wrap: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: AVATAR_SIZE * 0.72,
    width: AVATAR_SIZE * 0.72,
    overflow: 'hidden',
  },
  silhouette_head: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#B8B4AE',
    marginBottom: 2,
  },
  silhouette_body: {
    width: 52,
    height: 28,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    backgroundColor: '#B8B4AE',
  },

  // ── Badge cámara ────────────────────────────────────────────────────────
  camera_badge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLOR_SALVIA,
    borderWidth: 2,
    borderColor: BG_PAPER,
    justifyContent: 'center',
    alignItems: 'center',
  },
  camera_body: {
    width: 14,
    height: 11,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  camera_lens: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLOR_SALVIA,
  },

  // ── Texto ayuda ─────────────────────────────────────────────────────────
  hint_text: {
    marginTop: 10,
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '400',
  },
});
