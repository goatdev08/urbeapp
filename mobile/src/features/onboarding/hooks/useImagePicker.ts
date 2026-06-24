/**
 * useImagePicker — hook reutilizable para selección de imagen de avatar.
 *
 * Responsabilidades:
 *   - Pedir permisos de galería y/o cámara antes de lanzar el picker.
 *   - Manejar permiso DENEGADO con Alert en español; nunca crasha.
 *   - Exponer acciones: pick_from_gallery / pick_from_camera.
 *   - Retornar el uri crudo seleccionado (o null si se canceló).
 *
 * TODO 6.4 — agregar compresión/redimensionado del uri antes de retornarlo.
 *            Aquí se retorna el uri crudo sin ningún procesamiento.
 *
 * Patrón de nombre: hook en useX (ESLint react-hooks exige prefijo `use` en camelCase).
 */
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface ImagePickerResult {
  uri: string | null;
}

// ---------------------------------------------------------------------------
// Mensajes en español
// ---------------------------------------------------------------------------

const MSG_GALLERY_DENIED =
  'Urbea no tiene permiso para acceder a tu galería. ' +
  'Ve a Configuración > Privacidad > Fotos y habilita el acceso.';

const MSG_CAMERA_DENIED =
  'Urbea no tiene permiso para acceder a la cámara. ' +
  'Ve a Configuración > Privacidad > Cámara y habilita el acceso.';

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Solicita permisos de galería.
 * Retorna true si fue concedido, false si denegado (ya muestra el Alert).
 */
async function request_media_library_permission(): Promise<boolean> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('Permiso requerido', MSG_GALLERY_DENIED, [{ text: 'Entendido' }]);
    return false;
  }
  return true;
}

/**
 * Solicita permisos de cámara.
 * Retorna true si fue concedido, false si denegado (ya muestra el Alert).
 */
async function request_camera_permission(): Promise<boolean> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('Permiso requerido', MSG_CAMERA_DENIED, [{ text: 'Entendido' }]);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Hook público
// ---------------------------------------------------------------------------

export interface UseImagePickerReturn {
  /** Abre la galería del usuario para elegir una imagen. */
  pick_from_gallery: () => Promise<ImagePickerResult>;
  /** Abre la cámara para tomar una foto. */
  pick_from_camera: () => Promise<ImagePickerResult>;
}

export function useImagePicker(): UseImagePickerReturn {
  /**
   * Lanza la galería de imágenes con configuración de avatar (cuadrado, 1:1).
   * No comprime aquí — TODO 6.4 lo hará sobre el uri retornado.
   */
  async function pick_from_gallery(): Promise<ImagePickerResult> {
    const has_permission = await request_media_library_permission();
    if (!has_permission) return { uri: null };

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9, // calidad razonable; TODO 6.4 comprimirá más agresivamente
      // TODO 6.4 — añadir compresión/redimensionado aquí o post-selección.
    });

    if (result.canceled || !result.assets) return { uri: null };
    const first_asset = result.assets[0];
    if (!first_asset) return { uri: null };

    return { uri: first_asset.uri };
  }

  /**
   * Lanza la cámara para tomar una foto de perfil (cuadrado, 1:1).
   * No comprime aquí — TODO 6.4 lo hará sobre el uri retornado.
   */
  async function pick_from_camera(): Promise<ImagePickerResult> {
    const has_permission = await request_camera_permission();
    if (!has_permission) return { uri: null };

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9, // calidad razonable; TODO 6.4 comprimirá más agresivamente
      // TODO 6.4 — añadir compresión/redimensionado aquí o post-selección.
    });

    if (result.canceled || !result.assets) return { uri: null };
    const first_asset = result.assets[0];
    if (!first_asset) return { uri: null };

    return { uri: first_asset.uri };
  }

  return { pick_from_gallery, pick_from_camera };
}
