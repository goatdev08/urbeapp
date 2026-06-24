/**
 * AvatarPicker — área presionable de foto de perfil.
 *
 * En 6.1 muestra solo el placeholder (silhouette + icono de cámara).
 * En 6.2 se conectará a expo-image-picker.
 * En 6.4 se añadirá compresión.
 * En 6.5 se integrará upload a Supabase Storage.
 *
 * Acepta `uri` opcional para mostrar la imagen seleccionada (cuando 6.2 esté listo).
 * El onPress está declarado pero muestra un TODO hasta que 6.2 lo conecte.
 */
import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AvatarPickerProps {
  /**
   * URI de la imagen seleccionada.
   * En 6.1 siempre es undefined; 6.2 la populará.
   */
  uri?: string | undefined;
  /**
   * Callback al presionar el área de avatar.
   * 6.2 conectará expo-image-picker aquí.
   */
  onPress: () => void;
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

export function AvatarPicker({ uri: _uri, onPress, uploading = false }: AvatarPickerProps) {
  // En 6.2: si `uri` está definido, mostrar <Image source={{ uri }} />.
  // Por ahora siempre mostramos el placeholder de silhouette.

  return (
    <View style={styles.container}>
      <Pressable
        onPress={onPress}
        disabled={uploading}
        accessibilityRole="button"
        accessibilityLabel="Seleccionar foto de perfil"
        accessibilityHint="Abre la galería para elegir una foto"
        style={({ pressed }) => [
          styles.avatar_circle,
          pressed && styles.avatar_circle_pressed,
        ]}
      >
        {/* Silhouette placeholder — se reemplazará por <Image> en 6.2 */}
        <View style={styles.silhouette_wrap}>
          {/* Círculo cabeza */}
          <View style={styles.silhouette_head} />
          {/* Arco torso */}
          <View style={styles.silhouette_body} />
        </View>

        {/* Badge de cámara */}
        <View style={styles.camera_badge}>
          {/* Icono de cámara con formas nativas RN (sin SVG externo) */}
          <View style={styles.camera_body}>
            <View style={styles.camera_lens} />
          </View>
        </View>
      </Pressable>

      <Text style={styles.hint_text}>
        {uploading ? 'Subiendo…' : 'Toca para agregar foto'}
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
    backgroundColor: '#E8E4DC', // tono cálido sobre paper
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
