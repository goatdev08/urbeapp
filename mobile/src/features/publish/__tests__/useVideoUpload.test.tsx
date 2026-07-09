/**
 * Tests fase RED — useVideoUpload hook (mobile/src/features/publish/hooks/useVideoUpload.ts)
 * Subtarea Taskmaster: 52.1 — Reescribir useVideoUpload a subida por streaming (API nueva File v56)
 *
 * SUT: useVideoUpload(deps?: { supabase?, uuid? }): { upload, status, progress, error }
 *
 * Contrato (streaming, API nueva expo-file-system v56):
 *   - Recibe cliente Supabase y generador de UUID como deps inyectables.
 *   - Obtiene user_id de supabase.auth.getSession().
 *   - Genera video_id con uuid() ANTES de subir.
 *   - Validación de tamaño SÍNCRONA: `new File(local_uri)` → `.exists` / `.size`
 *     (verificado en node_modules/expo-file-system/build/File.d.ts +
 *     internal/NativeFileSystem.types.d.ts — getters síncronos, NO getInfoAsync).
 *   - Sube por streaming (sin cargar el archivo completo en RAM):
 *       1. `supabase.storage.from('property-videos').createSignedUploadUrl(storage_path)`
 *          → `{ data: { signedUrl, path, token }, error }`.
 *       2. `file.createUploadTask(signedUrl, { httpMethod: 'PUT',
 *          uploadType: UploadType.BINARY_CONTENT, headers: {'Content-Type':'video/mp4'},
 *          onProgress }) : UploadTask` (verificado en build/NetworkTasks.d.ts + File.d.ts).
 *       3. `task.uploadAsync()` → `{ status, body, headers }`; 2xx = éxito.
 *   - Progreso real vía onProgress({bytesSent, totalBytes}) → progress_ref, cap ≤0.99
 *     hasta el éxito (evita saltos 0→1 sin datos reales; guard división por 0).
 *   - Al éxito llama update({ video_id, storage_path }) del PublishFormContext, progress=1.
 *   - En error (createSignedUploadUrl falla, status no-2xx, o excepción/red): expone
 *     mensaje NEUTRO fijo 'Error al subir el video. Verifica tu conexión e intenta de
 *     nuevo.' (SIN 'archivo más pequeño' — el límite de tamaño ya se validó antes),
 *     NO escribe al form, NO llama createUploadTask si el error fue en el paso 1.
 *
 * NOTA API: @testing-library/react-native v14 — renderHook es ASYNC y debe ser
 * `await`ed. Patrón: `const { result } = await renderHook(...)`.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (T1) exito_streaming_signed_url_y_upload_task: createSignedUploadUrl con
 *   path {user_id}/{video_id}.mp4, createUploadTask con signedUrl + opciones
 *   correctas (PUT, BINARY_CONTENT, Content-Type video/mp4), status final
 *   'success', progress=1, form actualizado con video_id + storage_path.
 * - (EC-3) path_primer_segmento_es_user_id: invariante RLS — primer segmento
 *   del storage_path pasado a createSignedUploadUrl === auth.uid().
 * - (EC-4) path_termina_en_mp4: extensión .mp4 fija (decisión para demo).
 * - (EC-5) bucket_es_property_videos: storage.from() recibe exactamente 'property-videos'.
 * - (EC-6) video_id_proviene_del_generador_inyectado: video_id === valor del uuid() inyectado.
 *
 * ### Sin video seleccionado / sin sesión
 * - (EC-7) sin_local_uri_no_llama_signed_url: local_uri null → sin createSignedUploadUrl,
 *   sin escritura al form, status=error.
 * - (EC-8) sin_sesion_no_sube: getSession sin user → sin createSignedUploadUrl, error claro,
 *   sin escritura al form.
 *
 * ### Error del paso 1 — createSignedUploadUrl
 * - (T2) signed_url_falla_no_sube_ni_actualiza_form: createSignedUploadUrl con error →
 *   status='error', mensaje del error, form NO actualizado, createUploadTask NO llamado.
 *
 * ### Error del paso 2/3 — upload no-2xx
 * - (T3) status_500_mensaje_neutro_sin_archivo_mas_pequeno: uploadAsync status=500 →
 *   status='error', mensaje EXACTO 'Error al subir el video. Verifica tu conexión e
 *   intenta de nuevo.', SIN 'archivo más pequeño'.
 *
 * ### Progreso (state machine + progreso real)
 * - (EC-11) estado_inicial_es_idle: al montar: status='idle', progress=0, error=null.
 * - (EC-12) estado_uploading_durante_subida: mientras uploadAsync está pendiente, status='uploading'.
 * - (T4) progreso_incremental_real_via_onProgress: onProgress({bytesSent:25e6,totalBytes:100e6})
 *   → progress≈0.25; luego {75e6,100e6} → progress≈0.75 (incremental, no salto directo a 1).
 * - (T5) totalBytes_cero_progreso_no_es_NaN: onProgress con totalBytes=0 → progress no-NaN (0).
 *
 * ### Validación de tamaño (SÍNCRONA vía File — boundary exacto del bucket 500 MB)
 * - (T6) rechaza_524288001_bytes_antes_de_signed_url: file.size=524288001 → status='error'
 *   ANTES de llamar createSignedUploadUrl (no se llama).
 * - (T7) procede_a_signed_url_con_524288000_bytes_exactos: file.size=524288000 (límite exacto)
 *   → SÍ procede a createSignedUploadUrl, status='success'.
 * - (T8) archivo_no_existe_rechaza_antes_de_signed_url: file.exists=false → status='error',
 *   createSignedUploadUrl NO llamado.
 *
 * ### Resiliencia a errores de red — mensaje neutro fijo, sin crash
 * - (R1) uploadAsync_rechaza_mensaje_neutro_sin_crash: uploadAsync() rechaza (red/AbortError)
 *   → status='error', mensaje NEUTRO fijo (sin 'archivo más pequeño').
 * - (R2) status_503_mensaje_neutro: uploadAsync status=503 → mismo mensaje neutro fijo.
 * - (R3) signed_url_rechaza_mensaje_neutro_sin_crash: createSignedUploadUrl() rechaza
 *   (falla de red antes de subir) → status='error', mensaje neutro, sin crash.
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import * as FileSystem from 'expo-file-system';

// ---------------------------------------------------------------------------
// Mock de 'expo-file-system' — API NUEVA v56 (clase File, NO getInfoAsync legacy).
// Verificado en node_modules/expo-file-system/build/File.d.ts +
// internal/NativeFileSystem.types.d.ts: `new File(uri)` expone `.exists` y
// `.size` como getters SÍNCRONOS, y `.createUploadTask(url, options): UploadTask`.
// ---------------------------------------------------------------------------

jest.mock('expo-file-system', () => ({
  File: jest.fn(),
  UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
}));

const MockFile = FileSystem.File as unknown as jest.Mock;

// ---------------------------------------------------------------------------
// Wrapper con PublishFormProvider
// ---------------------------------------------------------------------------

import { PublishFormProvider, usePublishForm } from '../store/PublishFormContext';

// ---------------------------------------------------------------------------
// SUT — importado DESPUÉS de los imports de contexto
// ---------------------------------------------------------------------------

import { useVideoUpload } from '../hooks/useVideoUpload';

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'usuario-test-uuid-123';
const TEST_VIDEO_ID = 'video-uuid-fijo-para-tests';
const TEST_LOCAL_URI = 'file:///data/user/0/com.urbea/cache/video.mp4';
const EXPECTED_STORAGE_PATH = `${TEST_USER_ID}/${TEST_VIDEO_ID}.mp4`;
const SIGNED_URL = `https://proyecto.supabase.co/storage/v1/object/upload/sign/property-videos/${EXPECTED_STORAGE_PATH}?token=tok-firmado-abc`;
const FRIENDLY_ERROR_NEUTRAL = 'Error al subir el video. Verifica tu conexión e intenta de nuevo.';
const MAX_VIDEO_SIZE_BYTES = 524288000; // 500 MB — límite del bucket (migración 20260710000001)

type MockUploadTaskResult = { status: number; body?: string; headers?: Record<string, string> };

interface MockUploadTask {
  uploadAsync: jest.Mock<Promise<MockUploadTaskResult>, []>;
}

interface MockFileInstance {
  exists: boolean;
  size: number;
  createUploadTask: jest.Mock;
  _upload_task: MockUploadTask;
}

// ---------------------------------------------------------------------------
// Factory de mock del File nativo (API v56)
// ---------------------------------------------------------------------------

function make_mock_upload_task(result: MockUploadTaskResult = { status: 200 }): MockUploadTask {
  return {
    uploadAsync: jest.fn().mockResolvedValue({ status: result.status, body: '', headers: {} }),
  };
}

function make_mock_file(opts: {
  exists?: boolean;
  size?: number;
  upload_task?: MockUploadTask;
}): MockFileInstance {
  const { exists = true, size = 50 * 1024 * 1024 } = opts;
  const upload_task = opts.upload_task ?? make_mock_upload_task();
  const create_upload_task = jest.fn().mockReturnValue(upload_task);
  return { exists, size, createUploadTask: create_upload_task, _upload_task: upload_task };
}

// ---------------------------------------------------------------------------
// Factories de mock para el cliente Supabase inyectado
// ---------------------------------------------------------------------------

function make_mock_supabase(opts: {
  user_id?: string | null;
  signed_result?: { data: unknown; error: unknown };
}) {
  const {
    user_id = TEST_USER_ID,
    signed_result = {
      data: { signedUrl: SIGNED_URL, path: EXPECTED_STORAGE_PATH, token: 'tok-firmado-abc' },
      error: null,
    },
  } = opts;

  const mock_create_signed_upload_url = jest.fn().mockResolvedValue(signed_result);
  const mock_storage_from = jest
    .fn()
    .mockReturnValue({ createSignedUploadUrl: mock_create_signed_upload_url });

  const mock_get_session = jest.fn().mockResolvedValue({
    data: {
      session:
        user_id != null
          ? {
              user: { id: user_id },
              access_token: 'tok',
              refresh_token: 'ref',
              token_type: 'bearer',
              expires_in: 3600,
              expires_at: Math.floor(Date.now() / 1000) + 3600,
            }
          : null,
    },
    error: null,
  });

  return {
    auth: { getSession: mock_get_session },
    storage: { from: mock_storage_from },
    // Expuestos para aserciones
    _mock_create_signed_upload_url: mock_create_signed_upload_url,
    _mock_storage_from: mock_storage_from,
    _mock_get_session: mock_get_session,
  };
}

// ---------------------------------------------------------------------------
// Mock del uuid inyectable — valor determinista
// ---------------------------------------------------------------------------

function make_uuid_gen(fixed = TEST_VIDEO_ID): jest.Mock<() => string> {
  return jest.fn().mockReturnValue(fixed);
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <PublishFormProvider>{children}</PublishFormProvider>
);

// Helper: deja que las promesas ya-resueltas (getSession, createSignedUploadUrl)
// avancen antes de inspeccionar createUploadTask / capturar onProgress.
async function flush_microtasks(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useVideoUpload', () => {
  beforeEach(() => {
    MockFile.mockImplementation(() => make_mock_file({}) as never);
  });

  // ── (EC-11) Estado inicial ──────────────────────────────────────────────

  it('(EC-11) estado_inicial_es_idle: al montar, status=idle, progress=0, error=null', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper },
    );

    expect(result.current.status).toBe('idle');
    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBeNull();
  });

  // ── (T1) Happy path — streaming completo ─────────────────────────────────

  it('(T1) exito_streaming_signed_url_y_upload_task: sube por signed URL + upload task y escribe al context', async () => {
    const file_instance = make_mock_file({});
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(
      () => ({
        sut: useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
        form: usePublishForm(),
      }),
      { wrapper },
    );

    await act(async () => {
      await result.current.sut.upload(TEST_LOCAL_URI);
    });

    expect(mock_supabase._mock_storage_from).toHaveBeenCalledWith('property-videos');
    expect(mock_supabase._mock_create_signed_upload_url).toHaveBeenCalledWith(
      EXPECTED_STORAGE_PATH,
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
      headers: { 'Content-Type': 'video/mp4' },
    });

    expect(file_instance._upload_task.uploadAsync).toHaveBeenCalledTimes(1);
    expect(result.current.sut.status).toBe('success');
    expect(result.current.sut.progress).toBe(1);
    expect(result.current.form.state.video_id).toBe(TEST_VIDEO_ID);
    expect(result.current.form.state.storage_path).toBe(EXPECTED_STORAGE_PATH);
  });

  // ── (EC-3) Primer segmento del path = user_id (RLS invariant) ─────────────

  it('(EC-3) path_primer_segmento_es_user_id: el primer segmento del storage_path es el user_id de sesión', async () => {
    const custom_user_id = 'uid-rls-test-456';
    const mock_supabase = make_mock_supabase({ user_id: custom_user_id });

    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper },
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    const call_args = mock_supabase._mock_create_signed_upload_url.mock.calls[0] as [string];
    const first_segment = call_args[0].split('/')[0];
    expect(first_segment).toBe(custom_user_id);
  });

  // ── (EC-4) Path termina en .mp4 ───────────────────────────────────────────

  it('(EC-4) path_termina_en_mp4: el storage_path pasado a createSignedUploadUrl termina en .mp4', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper },
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    const call_args = mock_supabase._mock_create_signed_upload_url.mock.calls[0] as [string];
    expect(call_args[0]).toMatch(/\.mp4$/);
  });

  // ── (EC-5) Bucket es 'property-videos' ────────────────────────────────────

  it('(EC-5) bucket_es_property_videos: storage.from() recibe exactamente "property-videos"', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper },
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(mock_supabase._mock_storage_from).toHaveBeenCalledWith('property-videos');
    expect(mock_supabase._mock_storage_from).not.toHaveBeenCalledWith('videos');
    expect(mock_supabase._mock_storage_from).not.toHaveBeenCalledWith('property_videos');
  });

  // ── (EC-6) video_id proviene del generador inyectado ─────────────────────

  it('(EC-6) video_id_proviene_del_generador_inyectado: el video_id en el form es el valor devuelto por uuid()', async () => {
    const DETERMINISTIC_UUID = 'deterministic-uuid-para-ec6';
    const mock_supabase = make_mock_supabase({});
    const uuid_gen = make_uuid_gen(DETERMINISTIC_UUID);

    const { result } = await renderHook(
      () => ({
        sut: useVideoUpload({ supabase: mock_supabase as never, uuid: uuid_gen }),
        form: usePublishForm(),
      }),
      { wrapper },
    );

    await act(async () => {
      await result.current.sut.upload(TEST_LOCAL_URI);
    });

    expect(uuid_gen).toHaveBeenCalledTimes(1);
    expect(result.current.form.state.video_id).toBe(DETERMINISTIC_UUID);
  });

  // ── (EC-7) Sin local_uri → no sube, no escribe al form ────────────────────

  it('(EC-7) sin_local_uri_no_llama_signed_url: local_uri null → sin createSignedUploadUrl, sin escritura al form, status=error', async () => {
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(
      () => ({
        sut: useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
        form: usePublishForm(),
      }),
      { wrapper },
    );

    await act(async () => {
      await result.current.sut.upload(null);
    });

    expect(mock_supabase._mock_create_signed_upload_url).not.toHaveBeenCalled();
    expect(result.current.form.state.video_id).toBeNull();
    expect(result.current.form.state.storage_path).toBeNull();
    expect(result.current.sut.status).toBe('error');
  });

  // ── (EC-8) Sin sesión → no sube, error claro, no escribe al form ──────────

  it('(EC-8) sin_sesion_no_sube: getSession devuelve null → sin createSignedUploadUrl, error claro, sin escritura al form', async () => {
    const mock_supabase = make_mock_supabase({ user_id: null });

    const { result } = await renderHook(
      () => ({
        sut: useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
        form: usePublishForm(),
      }),
      { wrapper },
    );

    await act(async () => {
      await result.current.sut.upload(TEST_LOCAL_URI);
    });

    expect(mock_supabase._mock_create_signed_upload_url).not.toHaveBeenCalled();
    expect(result.current.form.state.video_id).toBeNull();
    expect(result.current.form.state.storage_path).toBeNull();
    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).not.toBeNull();
  });

  // ── (T2) createSignedUploadUrl falla → no sube, no escribe al form ────────

  it('(T2) signed_url_falla_no_sube_ni_actualiza_form: createSignedUploadUrl con error → status=error, form NO actualizado, createUploadTask NO llamado', async () => {
    const file_instance = make_mock_file({});
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({
      signed_result: { data: null, error: { message: 'permiso denegado para signed url' } },
    });

    const { result } = await renderHook(
      () => ({
        sut: useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
        form: usePublishForm(),
      }),
      { wrapper },
    );

    await act(async () => {
      await result.current.sut.upload(TEST_LOCAL_URI);
    });

    expect(mock_supabase._mock_create_signed_upload_url).toHaveBeenCalledTimes(1);
    expect(file_instance.createUploadTask).not.toHaveBeenCalled();
    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).not.toBeNull();
    expect(result.current.form.state.video_id).toBeNull();
    expect(result.current.form.state.storage_path).toBeNull();
  });

  // ── (T3) uploadAsync status 500 → mensaje neutro, sin 'archivo más pequeño' ─

  it("(T3) status_500_mensaje_neutro_sin_archivo_mas_pequeno: uploadAsync status=500 → error neutro EXACTO, sin 'archivo más pequeño'", async () => {
    const upload_task = make_mock_upload_task({ status: 500 });
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(
      () => ({
        sut: useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
        form: usePublishForm(),
      }),
      { wrapper },
    );

    await act(async () => {
      await result.current.sut.upload(TEST_LOCAL_URI);
    });

    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).toBe(FRIENDLY_ERROR_NEUTRAL);
    expect(result.current.sut.error).not.toMatch(/archivo más pequeño/i);
    expect(result.current.form.state.video_id).toBeNull();
    expect(result.current.form.state.storage_path).toBeNull();
  });

  // ── (EC-12) Status 'uploading' mientras uploadAsync está pendiente ─────────

  it("(EC-12) estado_uploading_durante_subida: status=uploading mientras uploadAsync no resuelve", async () => {
    let resolve_upload!: (v: MockUploadTaskResult) => void;
    const pending = new Promise<MockUploadTaskResult>((res) => {
      resolve_upload = res;
    });
    const upload_task: MockUploadTask = { uploadAsync: jest.fn().mockReturnValue(pending) };
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper },
    );

    act(() => {
      void result.current.upload(TEST_LOCAL_URI);
    });

    // Deja avanzar getSession + createSignedUploadUrl (resueltos) hasta llegar
    // a uploadAsync, que queda pendiente.
    await act(async () => {
      await flush_microtasks();
    });

    expect(result.current.status).toBe('uploading');

    // Limpieza: resolvemos para no dejar Promises colgadas
    await act(async () => {
      resolve_upload({ status: 200 });
    });
  });

  // ── (T4) Progreso incremental real vía onProgress ─────────────────────────

  it('(T4) progreso_incremental_real_via_onProgress: onProgress actualiza progress de forma incremental (0.25, luego 0.75)', async () => {
    let captured_on_progress: ((d: { bytesSent: number; totalBytes: number }) => void) | undefined;
    let resolve_upload!: (v: MockUploadTaskResult) => void;
    const pending = new Promise<MockUploadTaskResult>((res) => {
      resolve_upload = res;
    });
    const create_upload_task = jest.fn().mockImplementation((_url: string, options: {
      onProgress?: (d: { bytesSent: number; totalBytes: number }) => void;
    }) => {
      captured_on_progress = options.onProgress;
      return { uploadAsync: jest.fn().mockReturnValue(pending) };
    });
    const file_instance: MockFileInstance = {
      exists: true,
      size: 50 * 1024 * 1024,
      createUploadTask: create_upload_task,
      _upload_task: { uploadAsync: jest.fn().mockReturnValue(pending) },
    };
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper },
    );

    act(() => {
      void result.current.upload(TEST_LOCAL_URI);
    });

    await act(async () => {
      await flush_microtasks();
    });

    expect(captured_on_progress).toBeDefined();

    act(() => {
      captured_on_progress!({ bytesSent: 25e6, totalBytes: 100e6 });
    });
    expect(result.current.progress).toBeCloseTo(0.25, 2);

    act(() => {
      captured_on_progress!({ bytesSent: 75e6, totalBytes: 100e6 });
    });
    expect(result.current.progress).toBeCloseTo(0.75, 2);
    // Cap ≤0.99 antes de la resolución final — nunca reporta 1 vía onProgress solo.
    expect(result.current.progress).toBeLessThan(1);

    await act(async () => {
      resolve_upload({ status: 200 });
    });

    expect(result.current.progress).toBe(1);
  });

  // ── (T5) totalBytes=0 → progress no-NaN ───────────────────────────────────

  it('(T5) totalBytes_cero_progreso_no_es_NaN: onProgress con totalBytes=0 no produce NaN', async () => {
    let captured_on_progress: ((d: { bytesSent: number; totalBytes: number }) => void) | undefined;
    let resolve_upload!: (v: MockUploadTaskResult) => void;
    const pending = new Promise<MockUploadTaskResult>((res) => {
      resolve_upload = res;
    });
    const create_upload_task = jest.fn().mockImplementation((_url: string, options: {
      onProgress?: (d: { bytesSent: number; totalBytes: number }) => void;
    }) => {
      captured_on_progress = options.onProgress;
      return { uploadAsync: jest.fn().mockReturnValue(pending) };
    });
    const file_instance: MockFileInstance = {
      exists: true,
      size: 50 * 1024 * 1024,
      createUploadTask: create_upload_task,
      _upload_task: { uploadAsync: jest.fn().mockReturnValue(pending) },
    };
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper },
    );

    act(() => {
      void result.current.upload(TEST_LOCAL_URI);
    });

    await act(async () => {
      await flush_microtasks();
    });

    act(() => {
      captured_on_progress!({ bytesSent: 0, totalBytes: 0 });
    });

    expect(Number.isNaN(result.current.progress)).toBe(false);
    expect(result.current.progress).toBe(0);

    await act(async () => {
      resolve_upload({ status: 200 });
    });
  });
});

// ---------------------------------------------------------------------------
// Validación de tamaño — SÍNCRONA vía File (API v56), boundary exacto 500 MB
// ---------------------------------------------------------------------------

describe('useVideoUpload - validación de tamaño (File síncrono)', () => {
  it('(T6) rechaza_524288001_bytes_antes_de_signed_url: file.size = MAX+1 → error ANTES de createSignedUploadUrl', async () => {
    const file_instance = make_mock_file({ size: MAX_VIDEO_SIZE_BYTES + 1 });
    MockFile.mockImplementation(() => file_instance as never);

    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper },
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.status).toBe('error');
    expect(mock_supabase._mock_create_signed_upload_url).not.toHaveBeenCalled();
    expect(file_instance.createUploadTask).not.toHaveBeenCalled();
  });

  it('(T7) procede_a_signed_url_con_524288000_bytes_exactos: file.size = MAX exacto → SÍ procede, status=success', async () => {
    const file_instance = make_mock_file({ size: MAX_VIDEO_SIZE_BYTES });
    MockFile.mockImplementation(() => file_instance as never);

    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper },
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(mock_supabase._mock_create_signed_upload_url).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('success');
  });

  it('(T8) archivo_no_existe_rechaza_antes_de_signed_url: file.exists=false → error, createSignedUploadUrl NO llamado', async () => {
    const file_instance = make_mock_file({ exists: false });
    MockFile.mockImplementation(() => file_instance as never);

    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper },
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).not.toBeNull();
    expect(mock_supabase._mock_create_signed_upload_url).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Resiliencia a errores de red — mensaje neutro fijo, sin crash
// ---------------------------------------------------------------------------

describe('useVideoUpload - resiliencia a errores (red)', () => {
  beforeEach(() => {
    MockFile.mockImplementation(() => make_mock_file({}) as never);
  });

  it('(R1) uploadAsync_rechaza_mensaje_neutro_sin_crash: uploadAsync() rechaza (red/AbortError) → status=error, mensaje neutro fijo', async () => {
    const upload_task: MockUploadTask = {
      uploadAsync: jest.fn().mockRejectedValue(new Error('network fail')),
    };
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper },
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI).catch(() => {});
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(FRIENDLY_ERROR_NEUTRAL);
    expect(result.current.error).not.toMatch(/archivo más pequeño/i);
  });

  it('(R2) status_503_mensaje_neutro: uploadAsync status=503 → mismo mensaje neutro fijo', async () => {
    const upload_task = make_mock_upload_task({ status: 503 });
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper },
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(FRIENDLY_ERROR_NEUTRAL);
  });

  it('(R3) signed_url_rechaza_mensaje_neutro_sin_crash: createSignedUploadUrl() rechaza (falla de red) → status=error, sin crash', async () => {
    const mock_supabase = make_mock_supabase({});
    mock_supabase._mock_create_signed_upload_url.mockRejectedValue(new Error('network down'));

    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper },
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI).catch(() => {});
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(FRIENDLY_ERROR_NEUTRAL);
  });
});
