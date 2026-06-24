/**
 * Tests unitarios para processProfileImage (imageUtils.ts).
 *
 * Patrón: jest-expo globals + jest.fn() DENTRO del factory para evitar hoisting.
 * Ver context.test.tsx para el mismo patrón.
 *
 * Casos cubiertos:
 *   (a) imagen ya ≤ 1 MB: una sola pasada, retorno directo.
 *   (b) imagen > 1 MB: compresión iterativa — manipulateAsync se llama varias veces
 *       hasta que el tamaño cae por debajo del límite.
 *   (c) resize siempre solicita width: 512 (AVATAR_MAX_PX).
 *   (d) se solicita SaveFormat.JPEG en todos los pasos.
 *   (e) si getInfoAsync devuelve exists: false → lanza Error.
 */

// ---------------------------------------------------------------------------
// Mocks — jest.fn() DENTRO del factory (evita problemas de hoisting con babel-jest)
// ---------------------------------------------------------------------------

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

jest.mock('expo-file-system', () => ({
  getInfoAsync: jest.fn(),
}));

// Importar módulos DESPUÉS de registrar los mocks
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';

import { processProfileImage, AVATAR_MAX_PX, MAX_SIZE_BYTES, QUALITY_STEPS } from '../imageUtils';

// ---------------------------------------------------------------------------
// Referencias tipadas a los mocks
// ---------------------------------------------------------------------------

const mock_manipulate_async = ImageManipulator.manipulateAsync as jest.MockedFunction<
  typeof ImageManipulator.manipulateAsync
>;

const mock_get_info_async = FileSystem.getInfoAsync as jest.MockedFunction<
  typeof FileSystem.getInfoAsync
>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RAW_URI = 'file:///raw/photo.jpg';
const PROCESSED_URI_1 = 'file:///processed/photo_q0.8.jpg';
const PROCESSED_URI_2 = 'file:///processed/photo_q0.6.jpg';
const PROCESSED_URI_3 = 'file:///processed/photo_q0.4.jpg';

function make_manipulate_result(uri: string) {
  return { uri, width: AVATAR_MAX_PX, height: AVATAR_MAX_PX };
}

function make_file_info_exists(uri: string, size: number) {
  return { exists: true as const, uri, size, isDirectory: false as const, modificationTime: 0 };
}

function make_file_info_missing() {
  return { exists: false as const, uri: '', isDirectory: false as const };
}

// Tamaños de referencia
const SMALL_SIZE = 500 * 1024;       // 500 KB → ≤ 1 MB → pasa a la primera
const LARGE_SIZE = 2 * 1024 * 1024;  // 2 MB   → > 1 MB → necesita reintento
const MEDIUM_SIZE = 800 * 1024;      // 800 KB → ≤ 1 MB (en el segundo intento)

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processProfileImage', () => {
  // ── (a) Imagen ya ≤ 1 MB: una sola pasada ──────────────────────────────

  it('(a) retorna el resultado sin reintento si el tamaño es ≤ 1 MB', async () => {
    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_1));
    mock_get_info_async.mockResolvedValueOnce(make_file_info_exists(PROCESSED_URI_1, SMALL_SIZE));

    const result = await processProfileImage(RAW_URI);

    expect(result.uri).toBe(PROCESSED_URI_1);
    expect(result.size).toBe(SMALL_SIZE);
    expect(result.size).toBeLessThanOrEqual(MAX_SIZE_BYTES);

    // manipulateAsync solo se llamó una vez (no hubo reintento)
    expect(mock_manipulate_async).toHaveBeenCalledTimes(1);
    expect(mock_get_info_async).toHaveBeenCalledTimes(1);
  });

  // ── (b) Imagen > 1 MB: compresión iterativa ─────────────────────────────

  it('(b) reintenta con calidad más baja si el primer resultado supera 1 MB', async () => {
    // Primera pasada (quality 0.8) → 2 MB, demasiado grande
    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_1));
    mock_get_info_async.mockResolvedValueOnce(make_file_info_exists(PROCESSED_URI_1, LARGE_SIZE));

    // Segunda pasada (quality 0.6) → 800 KB, acepta
    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_2));
    mock_get_info_async.mockResolvedValueOnce(make_file_info_exists(PROCESSED_URI_2, MEDIUM_SIZE));

    const result = await processProfileImage(RAW_URI);

    expect(result.uri).toBe(PROCESSED_URI_2);
    expect(result.size).toBe(MEDIUM_SIZE);
    expect(result.size).toBeLessThanOrEqual(MAX_SIZE_BYTES);

    // Se llamó dos veces: primera falló el límite, segunda OK
    expect(mock_manipulate_async).toHaveBeenCalledTimes(2);
    expect(mock_get_info_async).toHaveBeenCalledTimes(2);
  });

  it('(b) agota los tres pasos de calidad si ninguno cumple y retorna el último', async () => {
    // Las tres pasadas superan 1 MB
    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_1));
    mock_get_info_async.mockResolvedValueOnce(make_file_info_exists(PROCESSED_URI_1, LARGE_SIZE));

    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_2));
    mock_get_info_async.mockResolvedValueOnce(make_file_info_exists(PROCESSED_URI_2, LARGE_SIZE));

    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_3));
    mock_get_info_async.mockResolvedValueOnce(make_file_info_exists(PROCESSED_URI_3, LARGE_SIZE));

    const result = await processProfileImage(RAW_URI);

    // Retorna el último resultado (quality 0.4) sin lanzar
    expect(result.uri).toBe(PROCESSED_URI_3);
    // Todos los pasos de QUALITY_STEPS se ejecutaron
    expect(mock_manipulate_async).toHaveBeenCalledTimes(QUALITY_STEPS.length);
  });

  // ── (c) Resize siempre solicita width: AVATAR_MAX_PX ────────────────────

  it('(c) siempre solicita resize a width 512 (AVATAR_MAX_PX)', async () => {
    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_1));
    mock_get_info_async.mockResolvedValueOnce(make_file_info_exists(PROCESSED_URI_1, SMALL_SIZE));

    await processProfileImage(RAW_URI);

    // Segundo argumento de manipulateAsync es el array de acciones
    const call_args = mock_manipulate_async.mock.calls[0];
    expect(call_args).toBeDefined();
    const actions = call_args![1] as Array<{ resize: { width: number } }>;
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ resize: { width: AVATAR_MAX_PX } });
    expect(AVATAR_MAX_PX).toBe(512);
  });

  // ── (d) Formato JPEG ─────────────────────────────────────────────────────

  it('(d) solicita SaveFormat.JPEG en la primera pasada', async () => {
    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_1));
    mock_get_info_async.mockResolvedValueOnce(make_file_info_exists(PROCESSED_URI_1, SMALL_SIZE));

    await processProfileImage(RAW_URI);

    const call_args = mock_manipulate_async.mock.calls[0];
    expect(call_args).toBeDefined();
    const options = call_args![2] as { format: string; compress: number; base64: boolean };
    expect(options.format).toBe('jpeg'); // SaveFormat.JPEG = 'jpeg'
  });

  // ── (e) Archivo no existe → lanza Error ──────────────────────────────────

  it('(e) lanza Error si getInfoAsync devuelve exists: false', async () => {
    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_1));
    mock_get_info_async.mockResolvedValueOnce(make_file_info_missing());

    await expect(processProfileImage(RAW_URI)).rejects.toThrow('imageUtils');
  });
});
