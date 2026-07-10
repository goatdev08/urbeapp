/**
 * Tests fase RED — saveProfile (profileService.ts)
 * Subtarea Taskmaster: 52.4 — Migrar subida de imágenes a API File v56 + streaming
 *
 * SUT: saveProfile({ fullName, imageUri, userId }): Promise<{ profilePhotoUrl: string | null }>
 *
 * Contrato NUEVO (streaming, mismo patrón que useVideoUpload post-52.1):
 *   1. `supabase.storage.from('profile-photos').createSignedUploadUrl(path, { upsert: true })`
 *      → `{ data: { signedUrl, path, token }, error }`. El segundo argumento
 *      `{ upsert: true }` PRESERVA la semántica de upsert que hoy vive en
 *      `storage.upload(path, body, { upsert: true, ... })` — verificado en
 *      node_modules/@supabase/storage-js/src/packages/StorageFileApi.ts:379-399
 *      (`createSignedUploadUrl(path, options?: { upsert: boolean })`).
 *   2. `new File(imageUri).createUploadTask(signedUrl, { httpMethod: 'PUT',
 *      uploadType: UploadType.BINARY_CONTENT, headers: {'Content-Type': 'image/jpeg'} })`
 *      → UploadTask (verificado en build/File.d.ts + build/NetworkTasks.d.ts).
 *   3. `task.uploadAsync()` → `{ status, body, headers }`; 2xx = éxito.
 *   4. `supabase.storage.from('profile-photos').getPublicUrl(path)` con el MISMO
 *      path que el signed upload.
 *   5. UPSERT en user_preferences — SIN CAMBIOS respecto al contrato actual.
 *
 * EDGE CASES CUBIERTOS (RED):
 *
 * ### Happy path
 * - (a) happy_path_con_foto_via_signed_url_y_upload_task: signed URL con path
 *   correcto + uploadAsync 2xx + getPublicUrl → upsert → retorna publicUrl.
 * - (b) happy_path_sin_foto: imageUri null → sin createSignedUploadUrl, sin
 *   File, upsert con null, retorna null.
 *
 * ### Ramas de la migración a streaming (no obvias)
 * - (g) signed_url_incluye_upsert_true: createSignedUploadUrl recibe
 *   `{ upsert: true }` como segundo argumento — preserva la semántica de
 *   upsert que antes vivía en las opciones de `storage.upload`.
 * - (h) upload_task_opciones_correctas: createUploadTask recibe httpMethod PUT,
 *   uploadType BINARY_CONTENT, Content-Type image/jpeg.
 * - (i) getpublicurl_usa_mismo_path_que_signed_url: getPublicUrl recibe
 *   exactamente el mismo path que createSignedUploadUrl.
 * - (m) no_usa_fetch_para_leer_el_archivo: el flujo streaming NO llama al
 *   fetch() global para leer el archivo como ArrayBuffer (elimina el pico de
 *   memoria — mismo root cause que el OOM de video).
 *
 * ### Invariantes de negocio preservadas (sin cambios respecto al contrato previo)
 * - (c) tabla_correcta_user_preferences.
 * - (d) onConflict_user_id.
 * - (e) path_exacto_sin_prefijo_bucket: path es '{userId}/avatar.jpg' exactamente.
 * - (f) upsert_incluye_full_name_y_url.
 *
 * ### Boundary / error
 * - (j) error_de_signed_url_rechaza: createSignedUploadUrl con error → lanza,
 *   NO llama createUploadTask, NO hace upsert.
 * - (k) error_de_upload_status_no_2xx_rechaza: uploadAsync status=500 → lanza,
 *   NO llama getPublicUrl, NO hace upsert.
 * - (l) error_de_upsert_rechaza: upsert error → saveProfile lanza, no swallow.
 */

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks (mocks definidos dentro del factory)
// ---------------------------------------------------------------------------

import { saveProfile } from '../profileService';
import * as FileSystem from 'expo-file-system';

const mock_create_signed_upload_url = jest.fn();
const mock_get_public_url = jest.fn();
const mock_upsert = jest.fn();
const mock_from_storage = jest.fn();
const mock_from_db = jest.fn();

// El cliente supabase exportado desde @/lib/supabase/client se sustituye por
// un objeto con la forma mínima necesaria para profileService. NOTA: esta
// forma de storage YA NO expone `.upload` — solo `createSignedUploadUrl` +
// `getPublicUrl` (streaming). Si el SUT aún llama `.upload(...)`, explota con
// TypeError (falla por comportamiento, confirma que sigue en el patrón viejo).
jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    storage: {
      from: mock_from_storage,
    },
    from: mock_from_db,
  },
}));

// API NUEVA v56 — solo se exporta la clase File + el enum UploadType.
jest.mock('expo-file-system', () => ({
  File: jest.fn(),
  UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
}));

const MockFile = FileSystem.File as unknown as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers de fábrica
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'user-abc-123';
const TEST_FULL_NAME = 'María García López';
const TEST_IMAGE_URI = 'file:///processed/avatar_q0.8.jpg';
const TEST_PUBLIC_URL =
  'https://supabase.co/storage/v1/object/public/profile-photos/user-abc-123/avatar.jpg';
const EXPECTED_PATH = `${TEST_USER_ID}/avatar.jpg`;
const SIGNED_URL = `https://proyecto.supabase.co/storage/v1/object/upload/sign/profile-photos/${EXPECTED_PATH}?token=tok-firmado-abc`;

interface MockUploadTask {
  uploadAsync: jest.Mock<Promise<{ status: number; body?: string }>, []>;
}

function make_mock_upload_task(status = 200): MockUploadTask {
  return { uploadAsync: jest.fn().mockResolvedValue({ status, body: '' }) };
}

function make_mock_file(upload_task: MockUploadTask = make_mock_upload_task()) {
  return {
    createUploadTask: jest.fn().mockReturnValue(upload_task),
    _upload_task: upload_task,
  };
}

/** Configura el mock de storage para un flujo streaming exitoso. */
function setup_storage_streaming_ok() {
  mock_create_signed_upload_url.mockResolvedValue({
    data: { signedUrl: SIGNED_URL, path: EXPECTED_PATH, token: 'tok-firmado-abc' },
    error: null,
  });
  mock_get_public_url.mockReturnValue({ data: { publicUrl: TEST_PUBLIC_URL } });
  mock_from_storage.mockReturnValue({
    createSignedUploadUrl: mock_create_signed_upload_url,
    getPublicUrl: mock_get_public_url,
  });
  MockFile.mockImplementation(() => make_mock_file() as never);
}

/** Configura el mock de la tabla user_preferences para un upsert exitoso. */
function setup_db_upsert_ok() {
  mock_upsert.mockResolvedValue({ data: null, error: null });
  mock_from_db.mockReturnValue({
    upsert: mock_upsert,
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('saveProfile — streaming (signed URL + File v56)', () => {
  // ── (a) happy path con foto ──────────────────────────────────────────────

  it('(a) happy_path_con_foto_via_signed_url_y_upload_task: sube por streaming, obtiene publicUrl, upsert y retorna url', async () => {
    setup_storage_streaming_ok();
    setup_db_upsert_ok();

    const result = await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    expect(result.profilePhotoUrl).toBe(TEST_PUBLIC_URL);
    expect(mock_create_signed_upload_url).toHaveBeenCalledTimes(1);
    expect(mock_get_public_url).toHaveBeenCalledTimes(1);
    expect(mock_upsert).toHaveBeenCalledTimes(1);
  });

  // ── (b) happy path SIN foto ──────────────────────────────────────────────

  it('(b) happy_path_sin_foto: imageUri null → NO llama signed url ni File, upsert con null, retorna null', async () => {
    setup_db_upsert_ok();

    const result = await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: null,
      userId: TEST_USER_ID,
    });

    expect(result.profilePhotoUrl).toBeNull();
    expect(mock_create_signed_upload_url).not.toHaveBeenCalled();
    expect(mock_get_public_url).not.toHaveBeenCalled();
    expect(MockFile).not.toHaveBeenCalled();
    expect(mock_upsert).toHaveBeenCalledTimes(1);
  });

  // ── (c) tabla correcta: user_preferences ────────────────────────────────

  it('(c) tabla_correcta_user_preferences: upsert usa tabla user_preferences, NOT users', async () => {
    setup_storage_streaming_ok();
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    expect(mock_from_db).toHaveBeenCalledWith('user_preferences');
    expect(mock_from_db).not.toHaveBeenCalledWith('users');
  });

  // ── (d) onConflict: user_id ──────────────────────────────────────────────

  it('(d) onConflict_user_id: el upsert incluye onConflict: "user_id"', async () => {
    setup_storage_streaming_ok();
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    const upsert_call = mock_upsert.mock.calls[0];
    expect(upsert_call).toBeDefined();
    const upsert_options = upsert_call![1] as Record<string, unknown>;
    expect(upsert_options).toEqual(expect.objectContaining({ onConflict: 'user_id' }));
  });

  // ── (e) path exacto sin prefijo de bucket ───────────────────────────────

  it('(e) path_exacto_sin_prefijo_bucket: path pasado a createSignedUploadUrl es "{userId}/avatar.jpg" exactamente', async () => {
    setup_storage_streaming_ok();
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    const signed_call = mock_create_signed_upload_url.mock.calls[0];
    expect(signed_call).toBeDefined();
    const path_arg = signed_call![0] as string;
    expect(path_arg).toBe(EXPECTED_PATH);
    expect(path_arg).not.toContain('profile-photos/');
  });

  // ── (f) columnas del upsert: full_name y profile_photo_url ──────────────

  it('(f) upsert_incluye_full_name_y_url: upsert contiene full_name y profile_photo_url', async () => {
    setup_storage_streaming_ok();
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    const upsert_call = mock_upsert.mock.calls[0];
    expect(upsert_call).toBeDefined();
    const upsert_data = upsert_call![0] as Record<string, unknown>;
    expect(upsert_data).toEqual(
      expect.objectContaining({
        user_id: TEST_USER_ID,
        full_name: TEST_FULL_NAME,
        profile_photo_url: TEST_PUBLIC_URL,
      }),
    );
    expect(upsert_data).not.toHaveProperty('display_name');
    expect(upsert_data).not.toHaveProperty('photo_url');
  });

  // ── (g) createSignedUploadUrl preserva semántica upsert:true ────────────

  it('(g) signed_url_incluye_upsert_true: createSignedUploadUrl recibe { upsert: true } como segundo argumento', async () => {
    setup_storage_streaming_ok();
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    const signed_call = mock_create_signed_upload_url.mock.calls[0];
    expect(signed_call).toBeDefined();
    const options_arg = signed_call![1] as Record<string, unknown>;
    expect(options_arg).toEqual(expect.objectContaining({ upsert: true }));
  });

  // ── (h) opciones de createUploadTask: PUT + BINARY_CONTENT + Content-Type ─

  it('(h) upload_task_opciones_correctas: createUploadTask recibe signedUrl + httpMethod PUT + uploadType BINARY_CONTENT + Content-Type image/jpeg', async () => {
    setup_storage_streaming_ok();
    setup_db_upsert_ok();
    const file_instance = make_mock_file();
    MockFile.mockImplementation(() => file_instance as never);

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    expect(file_instance.createUploadTask).toHaveBeenCalledTimes(1);
    const [signed_url_arg, options_arg] = file_instance.createUploadTask.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(signed_url_arg).toBe(SIGNED_URL);
    expect(options_arg).toMatchObject({
      httpMethod: 'PUT',
      uploadType: FileSystem.UploadType.BINARY_CONTENT,
      headers: { 'Content-Type': 'image/jpeg' },
    });
  });

  // ── (i) getPublicUrl usa el mismo path que el signed upload ─────────────

  it('(i) getpublicurl_usa_mismo_path_que_signed_url: getPublicUrl recibe el mismo path que createSignedUploadUrl', async () => {
    setup_storage_streaming_ok();
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    const signed_path = mock_create_signed_upload_url.mock.calls[0]![0] as string;
    const get_public_url_path = mock_get_public_url.mock.calls[0]![0] as string;
    expect(get_public_url_path).toBe(signed_path);
    expect(get_public_url_path).toBe(EXPECTED_PATH);
  });

  // ── (j) error de createSignedUploadUrl → lanza, no sube, no upsert ──────

  it('(j) error_de_signed_url_rechaza: createSignedUploadUrl error → saveProfile lanza, NO llama upload ni upsert', async () => {
    mock_create_signed_upload_url.mockResolvedValue({
      data: null,
      error: { message: 'signed url: permiso denegado' },
    });
    mock_from_storage.mockReturnValue({
      createSignedUploadUrl: mock_create_signed_upload_url,
      getPublicUrl: mock_get_public_url,
    });
    setup_db_upsert_ok();

    await expect(
      saveProfile({
        fullName: TEST_FULL_NAME,
        imageUri: TEST_IMAGE_URI,
        userId: TEST_USER_ID,
      }),
    ).rejects.toThrow(/permiso denegado|signed|url/i);

    // El fallo debe originarse DESPUÉS de intentar el signed URL (nueva API) —
    // no de un TypeError incidental por seguir llamando al `.upload` legacy.
    expect(mock_create_signed_upload_url).toHaveBeenCalledTimes(1);
    expect(mock_get_public_url).not.toHaveBeenCalled();
    expect(mock_upsert).not.toHaveBeenCalled();
  });

  // ── (k) uploadAsync status no-2xx → lanza, no getPublicUrl, no upsert ───

  it('(k) error_de_upload_status_no_2xx_rechaza: uploadAsync status=500 → saveProfile lanza, NO llama getPublicUrl ni upsert', async () => {
    setup_storage_streaming_ok();
    const failing_upload_task = make_mock_upload_task(500);
    const file_instance = make_mock_file(failing_upload_task);
    MockFile.mockImplementation(() => file_instance as never);
    setup_db_upsert_ok();

    await expect(
      saveProfile({
        fullName: TEST_FULL_NAME,
        imageUri: TEST_IMAGE_URI,
        userId: TEST_USER_ID,
      }),
    ).rejects.toThrow(/storage|upload/i);

    // El fallo debe originarse DESPUÉS de crear el upload task (nueva API) —
    // no de un TypeError incidental por seguir llamando al `.upload` legacy.
    expect(file_instance.createUploadTask).toHaveBeenCalledTimes(1);
    expect(failing_upload_task.uploadAsync).toHaveBeenCalledTimes(1);
    expect(mock_get_public_url).not.toHaveBeenCalled();
    expect(mock_upsert).not.toHaveBeenCalled();
  });

  // ── (l) error de upsert → lanza con mensaje específico ──────────────────

  it('(l) error_de_upsert_rechaza: user_preferences.upsert error → saveProfile lanza con mensaje de DB', async () => {
    setup_storage_streaming_ok();

    mock_upsert.mockResolvedValue({ data: null, error: { message: 'DB error: duplicate key' } });
    mock_from_db.mockReturnValue({
      upsert: mock_upsert,
    });

    await expect(
      saveProfile({
        fullName: TEST_FULL_NAME,
        imageUri: TEST_IMAGE_URI,
        userId: TEST_USER_ID,
      }),
    ).rejects.toThrow(/upsert|preferences|DB|database/i);
  });

  // ── (m) ya no usa fetch() para leer el archivo (elimina el pico de RAM) ──

  it('(m) no_usa_fetch_para_leer_el_archivo: el flujo streaming NO llama a fetch() global', async () => {
    setup_storage_streaming_ok();
    setup_db_upsert_ok();

    const original_fetch = global.fetch;
    const mock_fetch = jest.fn();
    global.fetch = mock_fetch as unknown as typeof global.fetch;

    try {
      await saveProfile({
        fullName: TEST_FULL_NAME,
        imageUri: TEST_IMAGE_URI,
        userId: TEST_USER_ID,
      });

      expect(mock_fetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = original_fetch;
    }
  });
});
