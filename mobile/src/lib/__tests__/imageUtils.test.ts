/**
 * Tests fase RED — processProfileImage (imageUtils.ts)
 * Subtarea Taskmaster: 52.4 — Migrar subida de imágenes a API File v56 + streaming
 *
 * Contrato NUEVO (API File v56, verificado en
 * node_modules/expo-file-system/build/File.d.ts +
 * build/internal/NativeFileSystem.types.d.ts):
 *   - `getInfoAsync` del entry principal de expo-file-system v56 es un SHIM
 *     LEGACY que LANZA en runtime (node_modules/expo-file-system/src/legacyWarnings.ts:27-28)
 *     → la foto de perfil del onboarding está rota HOY.
 *   - Reemplazo: `new File(uri)` expone `.exists` (boolean, getter síncrono) y
 *     `.size` (number, getter síncrono) — SIN I/O extra, SIN import de getInfoAsync.
 *   - El resto del algoritmo (resize 512px, compresión iterativa JPEG 0.8→0.6→0.4,
 *     retorno del último resultado si ninguno cumple ≤1MB) NO cambia — solo cambia
 *     CÓMO se mide el tamaño del archivo manipulado.
 *
 * EDGE CASES CUBIERTOS (RED):
 *
 * ### Happy path
 * - (a) imagen_ya_bajo_limite_una_sola_pasada: File.size ≤ 1 MB → retorno directo,
 *   sin reintento.
 *
 * ### Edge cases del PRD / lógica preservada (compresión iterativa)
 * - (b) reintenta_con_calidad_mas_baja_si_excede_limite: primera pasada > 1 MB
 *   (según File.size) → segunda pasada con calidad más baja.
 * - (b2) agota_los_tres_pasos_y_retorna_el_ultimo_si_ninguno_cumple: las tres
 *   pasadas exceden 1 MB → retorna la última sin lanzar.
 * - (c) resize_siempre_solicita_width_512: invariante de negocio sin cambios.
 * - (d) solicita_saveformat_jpeg: invariante de negocio sin cambios.
 *
 * ### Ramas de la migración a File v56 (no obvias)
 * - (e) archivo_no_existe_lanza_error_via_file_exists: File.exists === false →
 *   lanza Error mencionando 'imageUtils' (MISMO contrato público que antes, pero
 *   la fuente de verdad ahora es File.exists, no FileInfo.exists de getInfoAsync).
 * - (f) usa_file_v56_con_uri_manipulado_no_getInfoAsync: `new File(...)` se
 *   invoca con el URI del resultado de manipulateAsync (mismo argumento que antes
 *   recibía getInfoAsync) — confirma que la medición pasa por la clase File.
 * - (g) tamano_proviene_del_getter_size_no_de_shape_fileinfo: el tamaño final
 *   devuelto por processProfileImage es exactamente el valor de `File.size`
 *   (getter síncrono), no un objeto FileInfo legacy.
 *
 * ### Boundary
 * - (h) tamano_exactamente_en_el_limite_no_reintenta: File.size === MAX_SIZE_BYTES
 *   (límite exacto, inclusive) → NO reintenta, una sola pasada.
 */

// ---------------------------------------------------------------------------
// Mocks — jest.fn() DENTRO del factory (evita problemas de hoisting con babel-jest)
// ---------------------------------------------------------------------------

import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';

import { processProfileImage, AVATAR_MAX_PX, MAX_SIZE_BYTES, QUALITY_STEPS } from '../imageUtils';

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png', WEBP: 'webp' },
}));

// API NUEVA v56: solo se exporta la clase File (constructor). NO se exporta
// getInfoAsync — si el SUT aún lo importa/llama, este mock lo deja `undefined`
// y la llamada explota con TypeError (falla por comportamiento, no por parse).
jest.mock('expo-file-system', () => ({
  File: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Referencias tipadas a los mocks
// ---------------------------------------------------------------------------

const mock_manipulate_async = ImageManipulator.manipulateAsync as jest.MockedFunction<
  typeof ImageManipulator.manipulateAsync
>;

const MockFile = FileSystem.File as unknown as jest.Mock;

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

/** Factory de instancia mock de File (API v56) — exists/size como getters. */
function make_file_instance(opts: { exists?: boolean; size?: number }) {
  const { exists = true, size = 0 } = opts;
  return { exists, size };
}

/**
 * Encadena implementaciones de `new File(uri)` en el orden de llamada —
 * cada pasada de compresión crea una instancia distinta.
 */
function queue_file_instances(instances: ReturnType<typeof make_file_instance>[]): void {
  let call = 0;
  MockFile.mockImplementation(() => {
    const instance = instances[call] ?? instances[instances.length - 1];
    call += 1;
    return instance as never;
  });
}

// Tamaños de referencia
const SMALL_SIZE = 500 * 1024; // 500 KB → ≤ 1 MB → pasa a la primera
const LARGE_SIZE = 2 * 1024 * 1024; // 2 MB   → > 1 MB → necesita reintento
const MEDIUM_SIZE = 800 * 1024; // 800 KB → ≤ 1 MB (en el segundo intento)

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processProfileImage — API File v56', () => {
  // ── (a) Imagen ya ≤ 1 MB: una sola pasada ──────────────────────────────

  it('(a) imagen_ya_bajo_limite_una_sola_pasada: retorna sin reintento si File.size ≤ 1 MB', async () => {
    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_1));
    queue_file_instances([make_file_instance({ size: SMALL_SIZE })]);

    const result = await processProfileImage(RAW_URI);

    expect(result.uri).toBe(PROCESSED_URI_1);
    expect(result.size).toBe(SMALL_SIZE);
    expect(result.size).toBeLessThanOrEqual(MAX_SIZE_BYTES);
    expect(mock_manipulate_async).toHaveBeenCalledTimes(1);
    expect(MockFile).toHaveBeenCalledTimes(1);
  });

  // ── (b) Imagen > 1 MB: compresión iterativa ─────────────────────────────

  it('(b) reintenta_con_calidad_mas_baja_si_excede_limite: File.size > 1 MB en la primera pasada → reintenta', async () => {
    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_1));
    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_2));
    queue_file_instances([
      make_file_instance({ size: LARGE_SIZE }),
      make_file_instance({ size: MEDIUM_SIZE }),
    ]);

    const result = await processProfileImage(RAW_URI);

    expect(result.uri).toBe(PROCESSED_URI_2);
    expect(result.size).toBe(MEDIUM_SIZE);
    expect(result.size).toBeLessThanOrEqual(MAX_SIZE_BYTES);
    expect(mock_manipulate_async).toHaveBeenCalledTimes(2);
    expect(MockFile).toHaveBeenCalledTimes(2);
  });

  it('(b2) agota_los_tres_pasos_y_retorna_el_ultimo_si_ninguno_cumple: las tres pasadas exceden 1 MB', async () => {
    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_1));
    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_2));
    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_3));
    queue_file_instances([
      make_file_instance({ size: LARGE_SIZE }),
      make_file_instance({ size: LARGE_SIZE }),
      make_file_instance({ size: LARGE_SIZE }),
    ]);

    const result = await processProfileImage(RAW_URI);

    expect(result.uri).toBe(PROCESSED_URI_3);
    expect(mock_manipulate_async).toHaveBeenCalledTimes(QUALITY_STEPS.length);
  });

  // ── (c) Resize siempre solicita width: AVATAR_MAX_PX ────────────────────

  it('(c) resize_siempre_solicita_width_512: invariante sin cambios tras la migración', async () => {
    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_1));
    queue_file_instances([make_file_instance({ size: SMALL_SIZE })]);

    await processProfileImage(RAW_URI);

    const call_args = mock_manipulate_async.mock.calls[0];
    expect(call_args).toBeDefined();
    const actions = call_args![1] as { resize: { width: number } }[];
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ resize: { width: AVATAR_MAX_PX } });
    expect(AVATAR_MAX_PX).toBe(512);
  });

  // ── (d) Formato JPEG ─────────────────────────────────────────────────────

  it('(d) solicita_saveformat_jpeg: invariante sin cambios tras la migración', async () => {
    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_1));
    queue_file_instances([make_file_instance({ size: SMALL_SIZE })]);

    await processProfileImage(RAW_URI);

    const call_args = mock_manipulate_async.mock.calls[0];
    expect(call_args).toBeDefined();
    const options = call_args![2] as { format: string };
    expect(options.format).toBe('jpeg'); // SaveFormat.JPEG = 'jpeg'
  });

  // ── (e) Archivo no existe (File.exists = false) → lanza Error ───────────

  it('(e) archivo_no_existe_lanza_error_via_file_exists: File.exists=false → lanza Error mencionando imageUtils', async () => {
    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_1));
    queue_file_instances([make_file_instance({ exists: false, size: 0 })]);

    await expect(processProfileImage(RAW_URI)).rejects.toThrow('imageUtils');
  });

  // ── (f) Usa File(uri) con el URI manipulado, NO getInfoAsync ────────────

  it('(f) usa_file_v56_con_uri_manipulado_no_getinfoasync: new File() recibe el uri manipulado', async () => {
    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_1));
    queue_file_instances([make_file_instance({ size: SMALL_SIZE })]);

    await processProfileImage(RAW_URI);

    expect(MockFile).toHaveBeenCalledWith(PROCESSED_URI_1);
    // El módulo mockeado de expo-file-system NO expone getInfoAsync — si el SUT
    // lo importara y llamara, este assert nunca se alcanzaría (TypeError previo).
    expect((FileSystem as Record<string, unknown>).getInfoAsync).toBeUndefined();
  });

  // ── (g) Tamaño proviene del getter .size de File, no de un FileInfo legacy ─

  it('(g) tamano_proviene_del_getter_size_no_de_shape_fileinfo: result.size === File.size exacto', async () => {
    const DISTINCTIVE_SIZE = 654321;
    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_1));
    queue_file_instances([make_file_instance({ size: DISTINCTIVE_SIZE })]);

    const result = await processProfileImage(RAW_URI);

    expect(result.size).toBe(DISTINCTIVE_SIZE);
  });

  // ── (h) Boundary — tamaño exactamente en el límite ──────────────────────

  it('(h) tamano_exactamente_en_el_limite_no_reintenta: File.size === MAX_SIZE_BYTES exacto → no reintenta', async () => {
    mock_manipulate_async.mockResolvedValueOnce(make_manipulate_result(PROCESSED_URI_1));
    queue_file_instances([make_file_instance({ size: MAX_SIZE_BYTES })]);

    const result = await processProfileImage(RAW_URI);

    expect(result.size).toBe(MAX_SIZE_BYTES);
    expect(mock_manipulate_async).toHaveBeenCalledTimes(1);
  });
});
