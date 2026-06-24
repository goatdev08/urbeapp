/**
 * imageUtils — utilidades puras de procesamiento de imagen para Urbea.
 *
 * Función pública:
 *   processProfileImage(uri) — redimensiona a máx 512×512 px y comprime a JPEG.
 *   Si el resultado sigue siendo > 1 MB, reintenta reduciendo calidad en 3 pasos:
 *   0.8 → 0.6 → 0.4 (compresión iterativa). Mide el tamaño con expo-file-system.
 *
 * Decisiones de 6.4:
 *   - No se devuelve base64: 6.5 sube al Storage de Supabase-js desde el uri local
 *     (FormData / Blob), no desde base64. Si 6.5 lo necesitara, puede pedirlo con
 *     un parámetro opcional; de momento mantener la firma mínima.
 *   - expo-image-manipulator legacy API (manipulateAsync) es más simple de mockear
 *     en tests y está disponible en SDK 56; la nueva API fluida (ImageManipulator)
 *     añade complejidad sin beneficio para este caso de uso.
 *   - resize solo especifica `width: 512`; el manipulador preserva la proporción
 *     si no se especifica height, lo que es correcto para avatares cuadrados
 *     pre-recortados por el picker.
 */
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { getInfoAsync } from 'expo-file-system';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Dimensión máxima del avatar (px). */
export const AVATAR_MAX_PX = 512;

/** Límite de tamaño aceptable en bytes (1 MiB). */
export const MAX_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB

/**
 * Secuencia de calidades a intentar en orden descendente.
 * Si la primera pasada ya cumple ≤ 1 MB, el loop termina ahí.
 */
export const QUALITY_STEPS: readonly number[] = [0.8, 0.6, 0.4];

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface ProcessedImage {
  /** URI local de la imagen procesada (listo para upload o preview). */
  uri: string;
  /** Ancho final en píxeles. */
  width: number;
  /** Alto final en píxeles. */
  height: number;
  /** Tamaño final del archivo en bytes (tras la última pasada de compresión). */
  size: number;
}

// ---------------------------------------------------------------------------
// Implementación
// ---------------------------------------------------------------------------

/**
 * Redimensiona y comprime una imagen de perfil.
 *
 * Estrategia:
 *   1. Redimensiona a máx 512 px de ancho (preserva proporción).
 *   2. Comprime a JPEG empezando en quality 0.8.
 *   3. Mide el tamaño del archivo resultante con getInfoAsync.
 *   4. Si ≤ 1 MB → retorna ese resultado.
 *   5. Si > 1 MB → reintenta con la siguiente calidad (0.6, luego 0.4).
 *   6. Si ningún paso alcanza ≤ 1 MB → retorna el último resultado de todas
 *      formas (mejor que bloquear al usuario; avatares 512×512 nunca deberían
 *      llegar aquí).
 *
 * @param uri - URI local de la imagen cruda (devuelta por expo-image-picker).
 * @returns Objeto con el uri procesado y metadatos.
 * @throws Error si la imagen no puede procesarse (p.ej. archivo no existe).
 */
export async function processProfileImage(uri: string): Promise<ProcessedImage> {
  let last_result: ProcessedImage | null = null;

  for (const quality of QUALITY_STEPS) {
    const manipulated = await manipulateAsync(
      uri,
      [{ resize: { width: AVATAR_MAX_PX } }],
      {
        compress: quality,
        format: SaveFormat.JPEG,
        base64: false,
      },
    );

    const info = await getInfoAsync(manipulated.uri);

    if (!info.exists) {
      throw new Error(`imageUtils: el archivo manipulado no existe: ${manipulated.uri}`);
    }

    const size = info.size;
    last_result = {
      uri: manipulated.uri,
      width: manipulated.width,
      height: manipulated.height,
      size,
    };

    if (size <= MAX_SIZE_BYTES) {
      // Tamaño aceptable — retornar esta pasada.
      return last_result;
    }
    // Sigue siendo grande → probar la siguiente calidad (más baja).
  }

  // Todos los pasos agotados y ninguno cumplió ≤ 1 MB.
  // Retornamos el último (quality 0.4, máxima compresión disponible).
  // En la práctica esto no ocurre para avatares 512×512 px.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return last_result!;
}
