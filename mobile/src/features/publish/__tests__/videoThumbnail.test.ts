/**
 * Tests fase RED — generate_and_store_thumbnail (videoThumbnail.ts)
 * Subtarea Taskmaster: 52.4 — Migrar subida de imágenes a API File v56 + streaming
 *
 * SUT: generate_and_store_thumbnail(video_id, local_uri, duration_seconds): Promise<void>
 *
 * Contrato NUEVO (streaming, mismo patrón que useVideoUpload post-52.1 y
 * profileService post-52.4):
 *   1. `supabase.storage.from('profile-photos').createSignedUploadUrl(path, { upsert: true })`
 *      → `{ data: { signedUrl, path, token }, error }`. Bucket SIN CAMBIOS
 *      (`profile-photos`, decisión ponytail documentada en el SUT — bucket
 *      público reusado para servir la portada sin firmar).
 *   2. `new File(thumb_uri).createUploadTask(signedUrl, { httpMethod: 'PUT',
 *      uploadType: UploadType.BINARY_CONTENT, headers: {'Content-Type': 'image/jpeg'} })`.
 *   3. `task.uploadAsync()` → `{ status }`; 2xx = éxito.
 *   4. `getPublicUrl(path)` con el MISMO path que el signed upload.
 *   5. UPSERT/UPDATE en property_videos.thumbnail_url — SIN CAMBIOS.
 *
 * fail-soft (invariante preexistente, NO tocada por esta migración): la
 * portada es opcional — ningún fallo del flujo bloquea ni rechaza la promesa;
 * el caller (step3.tsx) la invoca con `void` fire-and-forget.
 *
 * NOTA DE MOCKING — `videoThumbnail.ts` importa `supabase` de forma ESTÁTICA
 * (`import { supabase } from '@/lib/supabase/client'`), a diferencia de
 * profileService.ts (require() lazy). Las declaraciones `import` se hoistean
 * SIEMPRE por encima de cualquier `const` del mismo archivo (semántica ESM),
 * así que un `const mock_x = jest.fn()` externo referenciado DENTRO del
 * factory de `jest.mock()` llegaría `undefined` al SUT (el factory corre en
 * cuanto el import estático de `generate_and_store_thumbnail` dispara el
 * require() de `@/lib/supabase/client`, ANTES de que el `const` se asigne).
 * Fix: los `jest.fn()` se crean LITERAL dentro de cada factory (sin
 * referenciar variables externas) y se leen DESPUÉS vía el módulo importado
 * (mismo patrón que expo-file-system en useVideoUpload.test.tsx).
 *
 * EDGE CASES CUBIERTOS (RED):
 *
 * ### Happy path
 * - (a) exito_streaming_signed_url_y_upload_task: signed URL con path
 *   {user_id}/thumb_{video_id}.jpg + upload task correcto + uploadAsync 2xx +
 *   getPublicUrl → property_videos.update({thumbnail_url}).eq('id', video_id).
 *
 * ### Ramas de la migración a streaming (no obvias)
 * - (b) bucket_es_profile_photos: storage.from() recibe exactamente
 *   'profile-photos' (bucket público reusado, decisión ponytail sin cambios).
 * - (h) getpublicurl_usa_mismo_path_que_signed_url: getPublicUrl recibe el
 *   mismo path que createSignedUploadUrl.
 * - (i) path_incluye_thumb_prefijo_y_video_id: el path firmado es exactamente
 *   `{user_id}/thumb_{video_id}.jpg`.
 * - (g) no_usa_fetch_para_leer_el_thumbnail: el flujo streaming NO llama a
 *   fetch() global para leer el archivo (elimina el pico de RAM, mismo root
 *   cause que el OOM de video).
 *
 * ### fail-soft — ningún fallo rompe el flujo de publicación (preexistente)
 * - (c) sin_sesion_no_sube_ni_lanza: sin user en sesión → resuelve sin
 *   llamar storage ni lanzar.
 * - (d) signed_url_falla_no_sube_ni_lanza: createSignedUploadUrl con error →
 *   resuelve sin lanzar, NO llama createUploadTask, NO actualiza property_videos.
 * - (e) upload_no_2xx_no_actualiza_ni_lanza: uploadAsync status=500 →
 *   resuelve sin lanzar, NO actualiza property_videos.
 * - (f) excepcion_inesperada_no_rompe_el_flujo: getThumbnailAsync rechaza →
 *   generate_and_store_thumbnail sigue resolviendo (fail-soft), sin lanzar.
 */

// ---------------------------------------------------------------------------
// Mocks — jest.fn() LITERAL dentro de cada factory (ver NOTA DE MOCKING arriba).
// Las referencias tipadas se extraen DESPUÉS, leyendo el módulo ya mockeado.
// ---------------------------------------------------------------------------

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    storage: { from: jest.fn() },
    from: jest.fn(),
  },
}));

jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: jest.fn(),
}));

// API NUEVA v56 — solo se exporta la clase File + el enum UploadType.
jest.mock('expo-file-system', () => ({
  File: jest.fn(),
  UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
}));

import { supabase } from '@/lib/supabase/client';
import * as FileSystem from 'expo-file-system';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { generate_and_store_thumbnail } from '../lib/videoThumbnail';

const mock_get_session = supabase.auth.getSession as jest.Mock;
const mock_from_storage = supabase.storage.from as jest.Mock;
const mock_from_db = supabase.from as jest.Mock;
const MockFile = FileSystem.File as unknown as jest.Mock;
const mock_get_thumbnail_async = VideoThumbnails.getThumbnailAsync as jest.MockedFunction<
  typeof VideoThumbnails.getThumbnailAsync
>;

// Referencias a los sub-mocks de storage/db — se re-crean en cada setup_* para
// poder inspeccionar llamadas por test sin fugas entre casos.
let mock_create_signed_upload_url: jest.Mock;
let mock_get_public_url: jest.Mock;
let mock_update: jest.Mock;
let mock_eq: jest.Mock;

// ---------------------------------------------------------------------------
// Helpers de fábrica
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'user-thumb-456';
const TEST_VIDEO_ID = 'video-uuid-789';
const TEST_LOCAL_URI = 'file:///cache/video.mp4';
const TEST_THUMB_URI = 'file:///cache/thumb.jpg';
const EXPECTED_PATH = `${TEST_USER_ID}/thumb_${TEST_VIDEO_ID}.jpg`;
const SIGNED_URL = `https://proyecto.supabase.co/storage/v1/object/upload/sign/profile-photos/${EXPECTED_PATH}?token=tok-thumb-abc`;
const TEST_PUBLIC_URL = `https://supabase.co/storage/v1/object/public/profile-photos/${EXPECTED_PATH}`;

interface MockUploadTask {
  uploadAsync: jest.Mock<Promise<{ status: number }>, []>;
}

function make_mock_upload_task(status = 200): MockUploadTask {
  return { uploadAsync: jest.fn().mockResolvedValue({ status }) };
}

function make_mock_file(upload_task: MockUploadTask = make_mock_upload_task()) {
  return {
    createUploadTask: jest.fn().mockReturnValue(upload_task),
    _upload_task: upload_task,
  };
}

function setup_session_ok(user_id: string | null = TEST_USER_ID) {
  mock_get_session.mockResolvedValue({
    data: { session: user_id != null ? { user: { id: user_id } } : null },
  });
}

function setup_storage_streaming_ok() {
  mock_create_signed_upload_url = jest.fn().mockResolvedValue({
    data: { signedUrl: SIGNED_URL, path: EXPECTED_PATH, token: 'tok-thumb-abc' },
    error: null,
  });
  mock_get_public_url = jest.fn().mockReturnValue({ data: { publicUrl: TEST_PUBLIC_URL } });
  mock_from_storage.mockReturnValue({
    createSignedUploadUrl: mock_create_signed_upload_url,
    getPublicUrl: mock_get_public_url,
  });
  MockFile.mockImplementation(() => make_mock_file() as never);
}

function setup_db_update_ok() {
  mock_eq = jest.fn().mockResolvedValue({ data: null, error: null });
  mock_update = jest.fn().mockReturnValue({ eq: mock_eq });
  mock_from_db.mockReturnValue({ update: mock_update });
}

beforeEach(() => {
  jest.clearAllMocks();
  setup_session_ok();
  mock_get_thumbnail_async.mockResolvedValue({ uri: TEST_THUMB_URI } as never);
  setup_storage_streaming_ok();
  setup_db_update_ok();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generate_and_store_thumbnail — streaming (signed URL + File v56)', () => {
  // ── (a) Happy path — streaming completo ─────────────────────────────────

  it('(a) exito_streaming_signed_url_y_upload_task: sube por signed URL + upload task y actualiza property_videos', async () => {
    const file_instance = make_mock_file();
    MockFile.mockImplementation(() => file_instance as never);

    await generate_and_store_thumbnail(TEST_VIDEO_ID, TEST_LOCAL_URI, 20);

    expect(mock_create_signed_upload_url).toHaveBeenCalledWith(
      EXPECTED_PATH,
      expect.objectContaining({ upsert: true }),
    );
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

    expect(mock_get_public_url).toHaveBeenCalledWith(EXPECTED_PATH);
    expect(mock_from_db).toHaveBeenCalledWith('property_videos');
    expect(mock_update).toHaveBeenCalledWith(
      expect.objectContaining({ thumbnail_url: TEST_PUBLIC_URL }),
    );
    expect(mock_eq).toHaveBeenCalledWith('id', TEST_VIDEO_ID);
  });

  // ── (b) Bucket sigue siendo 'profile-photos' ────────────────────────────

  it("(b) bucket_es_profile_photos: storage.from() recibe exactamente 'profile-photos'", async () => {
    await generate_and_store_thumbnail(TEST_VIDEO_ID, TEST_LOCAL_URI, 20);

    expect(mock_from_storage).toHaveBeenCalledWith('profile-photos');
    expect(mock_from_storage).not.toHaveBeenCalledWith('property-thumbnails');
  });

  // ── (h) getPublicUrl usa el mismo path que el signed upload ─────────────

  it('(h) getpublicurl_usa_mismo_path_que_signed_url: getPublicUrl recibe el mismo path que createSignedUploadUrl', async () => {
    await generate_and_store_thumbnail(TEST_VIDEO_ID, TEST_LOCAL_URI, 20);

    const signed_path = mock_create_signed_upload_url.mock.calls[0]![0] as string;
    const public_url_path = mock_get_public_url.mock.calls[0]![0] as string;
    expect(public_url_path).toBe(signed_path);
  });

  // ── (i) path incluye prefijo thumb_ y el video_id ───────────────────────

  it('(i) path_incluye_thumb_prefijo_y_video_id: el path firmado es exactamente {user_id}/thumb_{video_id}.jpg', async () => {
    await generate_and_store_thumbnail(TEST_VIDEO_ID, TEST_LOCAL_URI, 20);

    const signed_path = mock_create_signed_upload_url.mock.calls[0]![0] as string;
    expect(signed_path).toBe(`${TEST_USER_ID}/thumb_${TEST_VIDEO_ID}.jpg`);
  });

  // ── (c) Sin sesión → fail-soft, sin lanzar ──────────────────────────────

  it('(c) sin_sesion_no_sube_ni_lanza: sin user en sesión → resuelve sin llamar storage ni lanzar', async () => {
    setup_session_ok(null);

    await expect(
      generate_and_store_thumbnail(TEST_VIDEO_ID, TEST_LOCAL_URI, 20),
    ).resolves.toBeUndefined();

    expect(mock_create_signed_upload_url).not.toHaveBeenCalled();
    expect(mock_update).not.toHaveBeenCalled();
  });

  // ── (d) createSignedUploadUrl falla → fail-soft, sin lanzar ─────────────

  it('(d) signed_url_falla_no_sube_ni_lanza: createSignedUploadUrl con error → resuelve sin lanzar, NO sube ni actualiza', async () => {
    mock_create_signed_upload_url.mockResolvedValue({
      data: null,
      error: { message: 'permiso denegado' },
    });
    mock_from_storage.mockReturnValue({
      createSignedUploadUrl: mock_create_signed_upload_url,
      getPublicUrl: mock_get_public_url,
    });

    await expect(
      generate_and_store_thumbnail(TEST_VIDEO_ID, TEST_LOCAL_URI, 20),
    ).resolves.toBeUndefined();

    expect(MockFile).not.toHaveBeenCalled();
    expect(mock_update).not.toHaveBeenCalled();
  });

  // ── (e) uploadAsync no-2xx → fail-soft, sin lanzar ──────────────────────

  it('(e) upload_no_2xx_no_actualiza_ni_lanza: uploadAsync status=500 → resuelve sin lanzar, NO actualiza property_videos', async () => {
    const failing_upload_task = make_mock_upload_task(500);
    MockFile.mockImplementation(() => make_mock_file(failing_upload_task) as never);

    await expect(
      generate_and_store_thumbnail(TEST_VIDEO_ID, TEST_LOCAL_URI, 20),
    ).resolves.toBeUndefined();

    expect(mock_get_public_url).not.toHaveBeenCalled();
    expect(mock_update).not.toHaveBeenCalled();
  });

  // ── (f) excepción inesperada → fail-soft, sin lanzar ────────────────────

  it('(f) excepcion_inesperada_no_rompe_el_flujo: getThumbnailAsync rechaza → generate_and_store_thumbnail sigue resolviendo', async () => {
    mock_get_thumbnail_async.mockRejectedValue(new Error('no se pudo extraer el frame'));

    await expect(
      generate_and_store_thumbnail(TEST_VIDEO_ID, TEST_LOCAL_URI, 20),
    ).resolves.toBeUndefined();

    expect(mock_update).not.toHaveBeenCalled();
  });

  // ── (g) ya no usa fetch() para leer el thumbnail ────────────────────────

  it('(g) no_usa_fetch_para_leer_el_thumbnail: el flujo streaming NO llama a fetch() global', async () => {
    const original_fetch = global.fetch;
    const mock_fetch = jest.fn();
    global.fetch = mock_fetch as unknown as typeof global.fetch;

    try {
      await generate_and_store_thumbnail(TEST_VIDEO_ID, TEST_LOCAL_URI, 20);
      expect(mock_fetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = original_fetch;
    }
  });
});
