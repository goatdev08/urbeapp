/**
 * Tests fase RED — useVideoUpload hook (mobile/src/features/publish/hooks/useVideoUpload.ts)
 * Subtarea Taskmaster: 68.4 — Reescritura upload-first a Cloudflare Stream
 * (POST simple ≤200MB, SIN tus-js-client, cero deps nuevas).
 *
 * SUT: useVideoUpload(deps?: { supabase? }): { upload, status, progress, error }
 *
 * Contrato NUEVO (reemplaza el flujo de Supabase Storage con signed URL):
 *   1. local_uri nulo → status='error', SIN invocar mint-upload-url.
 *   2. status='uploading' (visible antes del primer await — sync act()).
 *   3. `new File(local_uri)` (expo-file-system v56, getters síncronos
 *      .exists/.size). !exists → status='error', SIN invocar mint-upload-url.
 *   4. Techo MAX_STREAM_UPLOAD_BYTES = 200 MB (direct upload simple de
 *      Cloudflare Stream, distinto del techo de 500 MB del bucket legado de
 *      Supabase Storage). Excede → status='error' con mensaje de tamaño, SIN
 *      invocar mint-upload-url.
 *   5. `supabase.functions.invoke('mint-upload-url', ...)` →
 *      `{ data: { uploadUrl, uid }, error }`. Errores mapeados por código
 *      (extraído del body de FunctionsHttpError, mismo patrón que
 *      ContactAgentButton/edge-errors.ts):
 *        - UNAUTHENTICATED (401)      → mensaje de sesión.
 *        - UPLOAD_IN_PROGRESS (409)   → mensaje específico "video en proceso".
 *        - cualquier otro (502/500/red) → mensaje neutro fijo.
 *      En cualquier error del paso 5: NO sube a Stream, NO escribe al form.
 *   6. `file.createUploadTask(uploadUrl, { onProgress, ... })` + `uploadAsync()`
 *      — streaming, agnóstico al encoding exacto (PUT vs POST multipart; lo
 *      fija el GREEN según la doc de Cloudflare). onProgress actualiza
 *      progress 0..0.99 (cap, nunca reporta 1 antes de la resolución final).
 *   7. Éxito (2xx): status='processing' (NO 'success' — el video queda
 *      transcodificando en Stream; 'ready' llega por webhook en 68.5).
 *      progress=1. `update({ video_id: uid, cloudflare_uid: uid })` UNA vez.
 *      NO escribe `storage_path` (flujo legado).
 *   8. Fallo (no-2xx o excepción del binario): status='error', mensaje
 *      neutro, NO escribe al form.
 *
 * NOTA API: @testing-library/react-native v14 — renderHook es ASYNC
 * (`const { result } = await renderHook(...)`).
 *
 * Mocks: TODO mockeado (cero red real) — expo-file-system (File),
 * supabase.functions.invoke, usePublishForm (update). NO se usa
 * PublishFormProvider real — el módulo completo se mockea para poder
 * asertar `update` como spy directo (contrato pedido para 68.4).
 *
 * EDGE CASES CUBIERTOS (verbatim del brief 68.4 + boundary derivado):
 *
 * ### Happy path
 * - (EC6) exito_sube_a_stream_y_actualiza_form: mint-upload-url ok → sube a
 *   uploadUrl → 2xx → status='processing', progress=1, update() llamado UNA
 *   vez con {video_id, cloudflare_uid}.
 * - (EC11) status_final_es_processing_no_success: contrato nuevo — nunca
 *   'success'.
 *
 * ### Edge cases del brief 68.4 (URI/archivo/tamaño)
 * - (EC1) uri_nula_no_invoca_mint_upload_url.
 * - (EC2) archivo_no_existe_no_invoca_mint_upload_url.
 * - (EC3a) excede_200mb_no_invoca_mint_upload_url.
 * - (EC3b) exactamente_200mb_si_procede — boundary exacto derivado de EC3.
 *
 * ### Ramas de mapeo de error de mint-upload-url (no obvias)
 * - (EC4) mint_upload_url_409_mensaje_especifico_video_en_proceso.
 * - (EC5a) mint_upload_url_401_mensaje_de_sesion.
 * - (EC5b) mint_upload_url_502_mensaje_neutro — "otros" códigos.
 *
 * ### Boundary / error del binario a Stream
 * - (EC7) stream_responde_no_2xx_no_escribe_al_form.
 * - (EC8) excepcion_de_red_en_upload_a_stream_mensaje_neutro.
 * - (EC9) onProgress_actualiza_progress_cap_099_durante_y_1_en_exito.
 * - (EC10) invoca_mint_upload_url_solo_despues_de_validar_tamano — orden via
 *   spies (invocationCallOrder de File vs. invoke).
 *
 * ### Sanidad de estado inicial
 * - (EC0) estado_inicial_es_idle.
 */

import { renderHook, act } from '@testing-library/react-native';
import * as FileSystem from 'expo-file-system';
import { FunctionsHttpError } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Mock de 'expo-file-system' — API v56 (clase File, getters síncronos).
// ---------------------------------------------------------------------------

jest.mock('expo-file-system', () => ({
  File: jest.fn(),
  UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
}));

const MockFile = FileSystem.File as unknown as jest.Mock;

// ---------------------------------------------------------------------------
// Mock de usePublishForm — el hook bajo test solo necesita `update` como spy;
// no se usa el Provider real (contrato pedido para 68.4).
// ---------------------------------------------------------------------------

jest.mock('../store/PublishFormContext', () => ({
  usePublishForm: jest.fn(),
}));

import { usePublishForm } from '../store/PublishFormContext';

const mock_use_publish_form = usePublishForm as jest.Mock;

// ---------------------------------------------------------------------------
// SUT — importado DESPUÉS de los mocks de módulo
// ---------------------------------------------------------------------------

import { useVideoUpload } from '../hooks/useVideoUpload';

// ---------------------------------------------------------------------------
// Constantes de test — valores independientes del SUT (fuente: el brief 68.4)
// ---------------------------------------------------------------------------

const TEST_LOCAL_URI = 'file:///data/user/0/com.urbea/cache/video.mp4';
const STREAM_UID = 'stream-uid-mint-test-abc123';
const SIGNED_UPLOAD_URL = 'https://upload.videodelivery.net/tus-session/abc123';
// 200 MB — techo del direct upload simple de Cloudflare Stream (decisión
// 68.4). Literal independiente, NO importado de la constante del SUT.
const MAX_STREAM_UPLOAD_BYTES = 200 * 1024 * 1024;

const SESSION_ERROR_MESSAGE = 'No hay sesión activa. Inicia sesión para publicar.';
const NEUTRAL_ERROR_MESSAGE = 'Error al subir el video. Verifica tu conexión e intenta de nuevo.';
const UPLOAD_IN_PROGRESS_MESSAGE = 'Ya tienes un video en proceso. Espera a que termine para subir otro.';

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
// Factories de mock del File nativo (API v56)
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
// Factory de mock del cliente Supabase inyectado (solo functions.invoke)
// ---------------------------------------------------------------------------

function make_mock_supabase(opts: { invoke_result?: { data: unknown; error: unknown } }) {
  const {
    invoke_result = {
      data: { uploadUrl: SIGNED_UPLOAD_URL, uid: STREAM_UID },
      error: null,
    },
  } = opts;

  const mock_invoke = jest.fn().mockResolvedValue(invoke_result);

  return {
    functions: { invoke: mock_invoke },
    // Expuesto para aserciones
    _mock_invoke: mock_invoke,
  };
}

/** FunctionsHttpError con el body { error: { code, message } } que emiten las EFs de Urbea. */
function make_ef_error(payload: { code: string; message: string }, status: number): FunctionsHttpError {
  return new FunctionsHttpError(new Response(JSON.stringify({ error: payload }), { status }));
}

// Helper: deja que las promesas ya-resueltas (mint-upload-url) avancen antes
// de inspeccionar createUploadTask / capturar onProgress.
async function flush_microtasks(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useVideoUpload', () => {
  let mock_update: jest.Mock;

  beforeEach(() => {
    MockFile.mockReset();
    MockFile.mockImplementation(() => make_mock_file({}) as never);
    mock_update = jest.fn();
    mock_use_publish_form.mockReturnValue({
      update: mock_update,
      state: {} as never,
      reset: jest.fn(),
    });
  });

  // ── (EC0) Estado inicial ───────────────────────────────────────────────

  it('(EC0) estado_inicial_es_idle: al montar, status=idle, progress=0, error=null', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase as never }),
    );

    expect(result.current.status).toBe('idle');
    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBeNull();
  });

  // ── (EC1) URI nula ──────────────────────────────────────────────────────

  it('(EC1) uri_nula_no_invoca_mint_upload_url: local_uri null → status=error, sin invocar mint-upload-url ni escribir al form', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.upload(null);
    });

    expect(result.current.status).toBe('error');
    expect(mock_supabase._mock_invoke).not.toHaveBeenCalled();
    expect(mock_update).not.toHaveBeenCalled();
  });

  // ── (EC2) Archivo no existe ─────────────────────────────────────────────

  it('(EC2) archivo_no_existe_no_invoca_mint_upload_url: file.exists=false → status=error, sin invocar mint-upload-url', async () => {
    const file_instance = make_mock_file({ exists: false });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).not.toBeNull();
    expect(mock_supabase._mock_invoke).not.toHaveBeenCalled();
    expect(mock_update).not.toHaveBeenCalled();
  });

  // ── (EC3a/EC3b) Techo de 200 MB — boundary exacto ────────────────────────

  it('(EC3a) excede_200mb_no_invoca_mint_upload_url: file.size > 200MB → status=error con mensaje de tamaño, sin invocar mint-upload-url', async () => {
    const file_instance = make_mock_file({ size: MAX_STREAM_UPLOAD_BYTES + 1 });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toMatch(/200/);
    expect(mock_supabase._mock_invoke).not.toHaveBeenCalled();
    expect(mock_update).not.toHaveBeenCalled();
  });

  it('(EC3b) exactamente_200mb_si_procede: file.size = 200MB exacto → SÍ invoca mint-upload-url', async () => {
    const file_instance = make_mock_file({ size: MAX_STREAM_UPLOAD_BYTES });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('processing');
  });

  // ── (EC4) mint-upload-url → 409 UPLOAD_IN_PROGRESS ───────────────────────

  it('(EC4) mint_upload_url_409_mensaje_especifico_video_en_proceso: error 409 → mensaje específico, sin subir a Stream ni escribir al form', async () => {
    const file_instance = make_mock_file({});
    MockFile.mockImplementation(() => file_instance as never);
    const ef_error = make_ef_error(
      { code: 'UPLOAD_IN_PROGRESS', message: 'Ya tienes un video en curso; espera a que termine' },
      409,
    );
    const mock_supabase = make_mock_supabase({ invoke_result: { data: null, error: ef_error } });

    const { result } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(UPLOAD_IN_PROGRESS_MESSAGE);
    expect(file_instance.createUploadTask).not.toHaveBeenCalled();
    expect(mock_update).not.toHaveBeenCalled();
  });

  // ── (EC5a/EC5b) mint-upload-url → 401 / otros ────────────────────────────

  it('(EC5a) mint_upload_url_401_mensaje_de_sesion: error 401 UNAUTHENTICATED → mensaje de sesión, sin subir', async () => {
    const file_instance = make_mock_file({});
    MockFile.mockImplementation(() => file_instance as never);
    const ef_error = make_ef_error({ code: 'UNAUTHENTICATED', message: 'Autenticación requerida' }, 401);
    const mock_supabase = make_mock_supabase({ invoke_result: { data: null, error: ef_error } });

    const { result } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(SESSION_ERROR_MESSAGE);
    expect(file_instance.createUploadTask).not.toHaveBeenCalled();
    expect(mock_update).not.toHaveBeenCalled();
  });

  it('(EC5b) mint_upload_url_502_mensaje_neutro: error 502 STREAM_UPLOAD_FAILED → mensaje neutro de red (rama "otros")', async () => {
    const file_instance = make_mock_file({});
    MockFile.mockImplementation(() => file_instance as never);
    const ef_error = make_ef_error(
      { code: 'STREAM_UPLOAD_FAILED', message: 'No se pudo crear el upload en Cloudflare Stream' },
      502,
    );
    const mock_supabase = make_mock_supabase({ invoke_result: { data: null, error: ef_error } });

    const { result } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(mock_update).not.toHaveBeenCalled();
  });

  // ── (EC6) Happy path — sube el binario y actualiza el form ───────────────

  it('(EC6) exito_sube_a_stream_y_actualiza_form: mint-upload-url ok → sube a uploadUrl → 2xx → status=processing, progress=1, form actualizado UNA vez', async () => {
    const upload_task = make_mock_upload_task({ status: 200 });
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledWith('mint-upload-url', expect.anything());
    expect(file_instance.createUploadTask).toHaveBeenCalledTimes(1);

    const [url_arg] = file_instance.createUploadTask.mock.calls[0] as [string, unknown];
    expect(url_arg).toBe(SIGNED_UPLOAD_URL);

    expect(file_instance._upload_task.uploadAsync).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('processing');
    expect(result.current.progress).toBe(1);
    expect(mock_update).toHaveBeenCalledTimes(1);
    expect(mock_update).toHaveBeenCalledWith({ video_id: STREAM_UID, cloudflare_uid: STREAM_UID });
  });

  // ── (EC7) Stream responde no-2xx ──────────────────────────────────────────

  it('(EC7) stream_responde_no_2xx_no_escribe_al_form: uploadAsync status=500 → status=error, sin llamar update', async () => {
    const upload_task = make_mock_upload_task({ status: 500 });
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    expect(file_instance.createUploadTask).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('error');
    expect(mock_update).not.toHaveBeenCalled();
  });

  // ── (EC8) Excepción de red al subir el binario ────────────────────────────

  it('(EC8) excepcion_de_red_en_upload_a_stream_mensaje_neutro: uploadAsync rechaza (red/AbortError) → status=error, mensaje neutro, sin update, sin crash', async () => {
    const upload_task: MockUploadTask = {
      uploadAsync: jest.fn().mockRejectedValue(new Error('network fail')),
    };
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(mock_update).not.toHaveBeenCalled();
  });

  // ── (EC9) onProgress — cap 0.99 durante, 1 en éxito ───────────────────────

  it('(EC9) onProgress_actualiza_progress_cap_099_durante_y_1_en_exito', async () => {
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

    const { result } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase as never }),
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
    expect(result.current.progress).toBeLessThan(1);

    act(() => {
      captured_on_progress!({ bytesSent: 99.9e6, totalBytes: 100e6 });
    });
    expect(result.current.progress).toBeLessThanOrEqual(0.99);

    await act(async () => {
      resolve_upload({ status: 200 });
    });

    expect(result.current.progress).toBe(1);
  });

  // ── (EC10) Orden: mint-upload-url solo se invoca tras validar tamaño ─────

  it('(EC10) invoca_mint_upload_url_solo_despues_de_validar_tamano: con archivo válido, File se construye/lee ANTES de invocar mint-upload-url', async () => {
    const file_instance = make_mock_file({});
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(MockFile).toHaveBeenCalledTimes(1);
    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);

    const file_call_order = MockFile.mock.invocationCallOrder[0] as number;
    const invoke_call_order = mock_supabase._mock_invoke.mock.invocationCallOrder[0] as number;
    expect(file_call_order).toBeLessThan(invoke_call_order);

    // Complemento (EC3a): un archivo inválido NUNCA gasta la llamada a la EF.
    const oversized_file = make_mock_file({ size: MAX_STREAM_UPLOAD_BYTES + 1 });
    MockFile.mockImplementation(() => oversized_file as never);
    const mock_supabase_2 = make_mock_supabase({});
    const { result: result_2 } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase_2 as never }),
    );

    await act(async () => {
      await result_2.current.upload(TEST_LOCAL_URI);
    });

    expect(mock_supabase_2._mock_invoke).not.toHaveBeenCalled();
  });

  // ── (EC11) Contrato nuevo — status final NUNCA es 'success' ───────────────

  it("(EC11) status_final_es_processing_no_success: tras éxito del upload, status es exactamente 'processing' (reemplaza el antiguo 'success')", async () => {
    const file_instance = make_mock_file({});
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.status).toBe('processing');
    expect(result.current.status as string).not.toBe('success');
  });
});
