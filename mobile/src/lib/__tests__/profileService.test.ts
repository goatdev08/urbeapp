/**
 * Tests unitarios para profileService.ts — fase RED (subtarea 6.5).
 *
 * SUT: saveProfile({ fullName, imageUri, userId }): Promise<{ profilePhotoUrl: string | null }>
 *
 * Casos cubiertos:
 *   (a) happy_path_con_foto: sube a Storage, getPublicUrl, upsert, retorna url.
 *   (b) happy_path_sin_foto: imageUri null → sin upload, upsert con null, retorna null.
 *   (c) tabla_correcta_user_preferences: upsert apunta a 'user_preferences', NOT 'users'.
 *   (d) onConflict_user_id: upsert pasa onConflict: 'user_id'.
 *   (e) path_exacto_sin_prefijo_bucket: path es '{userId}/avatar.jpg' exactamente.
 *   (f) upsert_incluye_full_name_y_url: columnas full_name y profile_photo_url (NOT display_name).
 *   (g) upload_upsert_false_es_true: upload lleva { upsert: true, contentType: 'image/jpeg' }.
 *   (h) getPublicUrl_se_usa_despues_del_upload: getPublicUrl lleva el mismo path que upload.
 *   (i) error_de_upload_rechaza: upload error → saveProfile lanza, no swallow.
 *   (j) error_de_upsert_rechaza: upsert error → saveProfile lanza, no swallow.
 */

// ---------------------------------------------------------------------------
// Mocks — definidos DENTRO del factory para evitar hoisting de babel-jest
// ---------------------------------------------------------------------------

// Mocks internos; se instancian dentro del factory para que jest.fn() exista.
// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { saveProfile } from '../profileService';

const mock_upload = jest.fn();
const mock_get_public_url = jest.fn();
const mock_upsert = jest.fn();
const mock_from_storage = jest.fn();
const mock_from_db = jest.fn();

// El cliente supabase exportado desde @/lib/supabase/client se sustituye por
// un objeto con la forma mínima necesaria para profileService.
jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    storage: {
      from: mock_from_storage,
    },
    from: mock_from_db,
  },
}));

// ---------------------------------------------------------------------------
// Helpers de fábrica
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'user-abc-123';
const TEST_FULL_NAME = 'María García López';
const TEST_IMAGE_URI = 'file:///processed/avatar_q0.8.jpg';
const TEST_PUBLIC_URL = 'https://supabase.co/storage/v1/object/public/profile-photos/user-abc-123/avatar.jpg';
const EXPECTED_PATH = `${TEST_USER_ID}/avatar.jpg`;

/** Configura el mock de storage para un upload exitoso. */
function setup_storage_upload_ok() {
  mock_upload.mockResolvedValue({ data: { path: EXPECTED_PATH }, error: null });
  mock_get_public_url.mockReturnValue({ data: { publicUrl: TEST_PUBLIC_URL } });
  mock_from_storage.mockReturnValue({
    upload: mock_upload,
    getPublicUrl: mock_get_public_url,
  });
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

describe('saveProfile', () => {
  // ── (a) happy path con foto ──────────────────────────────────────────────

  it('(a) happy_path_con_foto: sube imagen, obtiene publicUrl, upsert y retorna url', async () => {
    setup_storage_upload_ok();
    setup_db_upsert_ok();

    const result = await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    expect(result.profilePhotoUrl).toBe(TEST_PUBLIC_URL);
    expect(mock_upload).toHaveBeenCalledTimes(1);
    expect(mock_get_public_url).toHaveBeenCalledTimes(1);
    expect(mock_upsert).toHaveBeenCalledTimes(1);
  });

  // ── (b) happy path SIN foto ──────────────────────────────────────────────

  it('(b) happy_path_sin_foto: imageUri null → NO llama upload, upsert con null, retorna null', async () => {
    // Solo necesita el mock de DB; el storage no debería llamarse.
    setup_db_upsert_ok();

    const result = await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: null,
      userId: TEST_USER_ID,
    });

    expect(result.profilePhotoUrl).toBeNull();
    expect(mock_upload).not.toHaveBeenCalled();
    expect(mock_get_public_url).not.toHaveBeenCalled();
    expect(mock_upsert).toHaveBeenCalledTimes(1);
  });

  // ── (c) tabla correcta: user_preferences ────────────────────────────────

  it('(c) tabla_correcta_user_preferences: upsert usa tabla user_preferences, NOT users', async () => {
    setup_storage_upload_ok();
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    // El argumento de .from() de la DB debe ser 'user_preferences'
    expect(mock_from_db).toHaveBeenCalledWith('user_preferences');
    expect(mock_from_db).not.toHaveBeenCalledWith('users');
  });

  // ── (d) onConflict: user_id ──────────────────────────────────────────────

  it('(d) onConflict_user_id: el upsert incluye onConflict: "user_id"', async () => {
    setup_storage_upload_ok();
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    // El segundo argumento (opciones) de upsert debe incluir onConflict: 'user_id'
    const upsert_call = mock_upsert.mock.calls[0];
    expect(upsert_call).toBeDefined();
    const upsert_options = upsert_call![1] as Record<string, unknown>;
    expect(upsert_options).toEqual(expect.objectContaining({ onConflict: 'user_id' }));
  });

  // ── (e) path exacto sin prefijo de bucket ───────────────────────────────

  it('(e) path_exacto_sin_prefijo_bucket: path de upload es "{userId}/avatar.jpg" exactamente', async () => {
    setup_storage_upload_ok();
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    const upload_call = mock_upload.mock.calls[0];
    expect(upload_call).toBeDefined();
    const path_arg = upload_call![0] as string;
    // Debe ser exactamente '{userId}/avatar.jpg' — sin 'profile-photos/' delante
    expect(path_arg).toBe(`${TEST_USER_ID}/avatar.jpg`);
    expect(path_arg).not.toContain('profile-photos/');
  });

  // ── (f) columnas del upsert: full_name y profile_photo_url ──────────────

  it('(f) upsert_incluye_full_name_y_url: upsert contiene full_name y profile_photo_url', async () => {
    setup_storage_upload_ok();
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
      })
    );
    // Asegurar que NO usa nombres de columna incorrectos
    expect(upsert_data).not.toHaveProperty('display_name');
    expect(upsert_data).not.toHaveProperty('photo_url');
  });

  // ── (g) opciones de upload: upsert true y contentType jpeg ──────────────

  it('(g) upload_upsert_true_y_content_type_jpeg: upload lleva { upsert: true, contentType: "image/jpeg" }', async () => {
    setup_storage_upload_ok();
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    const upload_call = mock_upload.mock.calls[0];
    expect(upload_call).toBeDefined();
    const upload_options = upload_call![2] as Record<string, unknown>;
    expect(upload_options).toEqual(
      expect.objectContaining({ upsert: true, contentType: 'image/jpeg' })
    );
  });

  // ── (h) getPublicUrl usa el mismo path que upload ───────────────────────

  it('(h) getPublicUrl_se_usa_despues_del_upload: getPublicUrl recibe el mismo path que upload', async () => {
    setup_storage_upload_ok();
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    const upload_path = mock_upload.mock.calls[0]![0] as string;
    const get_public_url_path = mock_get_public_url.mock.calls[0]![0] as string;
    expect(get_public_url_path).toBe(upload_path);
    expect(get_public_url_path).toBe(`${TEST_USER_ID}/avatar.jpg`);
  });

  // ── (i) error de upload → lanza con mensaje específico ─────────────────

  it('(i) error_de_upload_rechaza: storage.upload error → saveProfile lanza con mensaje de storage', async () => {
    mock_upload.mockResolvedValue({ data: null, error: { message: 'Storage error: bucket not found' } });
    mock_from_storage.mockReturnValue({
      upload: mock_upload,
      getPublicUrl: mock_get_public_url,
    });
    setup_db_upsert_ok();

    // La implementación real debe lanzar un error que mencione el problema de storage
    // y no propagar el error genérico del stub.
    // Este test verifica que al implementarse, el mensaje del error de storage se propaga.
    await expect(
      saveProfile({
        fullName: TEST_FULL_NAME,
        imageUri: TEST_IMAGE_URI,
        userId: TEST_USER_ID,
      })
    ).rejects.toThrow(/storage|upload|bucket/i);
  });

  // ── (j) error de upsert → lanza con mensaje específico ──────────────────

  it('(j) error_de_upsert_rechaza: user_preferences.upsert error → saveProfile lanza con mensaje de DB', async () => {
    setup_storage_upload_ok();

    mock_upsert.mockResolvedValue({ data: null, error: { message: 'DB error: duplicate key' } });
    mock_from_db.mockReturnValue({
      upsert: mock_upsert,
    });

    // La implementación real debe lanzar un error que mencione el problema de DB/upsert.
    await expect(
      saveProfile({
        fullName: TEST_FULL_NAME,
        imageUri: TEST_IMAGE_URI,
        userId: TEST_USER_ID,
      })
    ).rejects.toThrow(/upsert|preferences|DB|database/i);
  });
});
