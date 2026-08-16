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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * EXTENSIÓN — Subtarea 103.2 (fix(103.2), tarea #103): "verificar antes de
 * fallar". Bug: uploadAsync() PUEDE lanzar/devolver no-2xx aunque el archivo
 * SÍ haya llegado completo a Stream (falso negativo, error de lectura de la
 * respuesta HTTP tras el envío del binario). Contrato nuevo: cuando el
 * upload falla, en vez de marcar error de inmediato, se consulta el estado
 * real del video vía `check_video_status(cloudflare_uid)` (colaborador
 * inyectado, NUNCA se lee `property_videos` por canal lateral):
 *   - 'ready' | 'processing' → ÉXITO (mismo desenlace que el 2xx feliz).
 *   - 'failed' → error propio de procesamiento, corta de inmediato (no
 *     agota verify_attempts).
 *   - 'uploading' | 'missing' agotados verify_attempts → error neutro.
 *   - excepción del propio checker → error neutro, fail-closed.
 *   - status='verifying' expuesto mientras se consulta (progress=0.99).
 *   - En el camino feliz 2xx normal, el checker NUNCA se invoca (EC20).
 *
 * ### Happy path (falso negativo — el bug exacto de #103)
 * - (EC12) falso_negativo_uploadasync_lanza_checker_ready_status_processing.
 * - (EC13) falso_negativo_checker_processing_tambien_exito.
 * - (EC14) falso_negativo_status_500_checker_ready_tambien_exito — mismo
 *   contrato mediante el camino de status no-2xx (resuelto, no excepción).
 *
 * ### Ramas de reglas no obvias (verificación acotada)
 * - (EC15) checker_uploading_agotados_los_intentos_error_neutro.
 * - (EC16) checker_failed_corta_de_inmediato_sin_agotar_intentos.
 * - (EC17) checker_lanza_excepcion_fail_closed_sin_update.
 * - (EC18) reintentos_uploading_luego_ready_verify_attempts_2_dos_llamadas.
 * - (EC19) checker_llamado_con_el_uid_devuelto_por_mint_upload_url.
 *
 * ### No regresión (guard-rail — deben seguir en VERDE)
 * - (EC20) exito_2xx_no_llama_al_checker_ni_una_vez.
 *
 * ### Boundary / estado transitorio
 * - (EC21) estado_pasa_por_verifying_antes_del_desenlace.
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

  // ── (EC24, #150) on_progress — callback EN VIVO para la barra de la UI ────
  // El progreso vive en un ref (invisible a mitad de un await, mismo problema
  // que O2/on_status_change): sin este callback, step5 solo puede mostrar un
  // spinner. La barra de progreso necesita CADA avance notificado en vivo.

  it('(EC24) on_progress_notifica_cada_avance_en_vivo_y_el_1_final', async () => {
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
    const mock_on_progress = jest.fn();

    const { result } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase as never, on_progress: mock_on_progress }),
    );

    act(() => {
      void result.current.upload(TEST_LOCAL_URI);
    });
    await act(async () => {
      await flush_microtasks();
    });

    // El arranque resetea la barra a 0 EN VIVO (feedback inmediato post-picker).
    expect(mock_on_progress).toHaveBeenCalledWith(0);

    act(() => {
      captured_on_progress!({ bytesSent: 25e6, totalBytes: 100e6 });
    });
    expect(mock_on_progress).toHaveBeenCalledWith(0.25);

    act(() => {
      captured_on_progress!({ bytesSent: 60e6, totalBytes: 100e6 });
    });
    expect(mock_on_progress).toHaveBeenCalledWith(0.6);

    await act(async () => {
      resolve_upload({ status: 200 });
    });

    // Éxito → 1 notificado (la barra cierra llena, no se queda en 0.99).
    expect(mock_on_progress).toHaveBeenCalledWith(1);
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

  // ═══════════════════════════════════════════════════════════════════════
  // Subtarea 103.2 — "verificar antes de fallar" (falso negativo de
  // FileSystemUploadTask contra Cloudflare Stream, ver tarea #103). El
  // checker (`check_video_status`) es un colaborador INYECTADO — nunca se
  // lee `property_videos` por canal lateral en estos tests.
  // ═══════════════════════════════════════════════════════════════════════

  const UPLOAD_READ_RESPONSE_ERROR_MESSAGE = 'Unable to upload a file: Failed to read response';

  /** uploadAsync que RECHAZA con el error exacto reproducido en #103. */
  function make_failing_upload_task(): MockUploadTask {
    return { uploadAsync: jest.fn().mockRejectedValue(new Error(UPLOAD_READ_RESPONSE_ERROR_MESSAGE)) };
  }

  // ── (EC12/EC13) Falso negativo por excepción — checker confirma el video ─

  async function assert_falso_negativo_exito(checker_status: 'ready' | 'processing'): Promise<void> {
    const upload_task = make_failing_upload_task();
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});
    const mock_check_video_status = jest.fn().mockResolvedValue(checker_status);

    const { result } = await renderHook(() =>
      useVideoUpload({
        supabase: mock_supabase as never,
        check_video_status: mock_check_video_status,
        verify_attempts: 2,
        verify_interval_ms: 0,
      }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.status).toBe('processing');
    expect(result.current.progress).toBe(1);
    expect(result.current.error).toBeNull();
    expect(mock_update).toHaveBeenCalledTimes(1);
    expect(mock_update).toHaveBeenCalledWith({ video_id: STREAM_UID, cloudflare_uid: STREAM_UID });
  }

  it("(EC12) falso_negativo_uploadasync_lanza_checker_ready_status_processing: uploadAsync rechaza 'Failed to read response' + checker='ready' → status=processing, progress=1, update() UNA vez, error=null", async () => {
    await assert_falso_negativo_exito('ready');
  });

  it("(EC13) falso_negativo_checker_processing_tambien_exito: mismo reject + checker='processing' → mismo resultado de éxito", async () => {
    await assert_falso_negativo_exito('processing');
  });

  // ── (EC14) Falso negativo por status no-2xx (resuelto, no excepción) ─────

  it("(EC14) falso_negativo_status_500_checker_ready_tambien_exito: uploadAsync RESUELVE status=500 (sin rechazar) + checker='ready' → también éxito", async () => {
    const upload_task = make_mock_upload_task({ status: 500 });
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});
    const mock_check_video_status = jest.fn().mockResolvedValue('ready');

    const { result } = await renderHook(() =>
      useVideoUpload({
        supabase: mock_supabase as never,
        check_video_status: mock_check_video_status,
        verify_attempts: 2,
        verify_interval_ms: 0,
      }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.status).toBe('processing');
    expect(result.current.progress).toBe(1);
    expect(result.current.error).toBeNull();
    expect(mock_update).toHaveBeenCalledTimes(1);
    expect(mock_update).toHaveBeenCalledWith({ video_id: STREAM_UID, cloudflare_uid: STREAM_UID });
  });

  // ── (EC15) Checker 'uploading' agotando todos los intentos ───────────────

  it("(EC15) checker_uploading_agotados_los_intentos_error_neutro: checker='uploading' en TODOS los intentos → status=error, mensaje neutro, update NO llamado, checker llamado exactamente verify_attempts veces", async () => {
    const upload_task = make_failing_upload_task();
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});
    const mock_check_video_status = jest.fn().mockResolvedValue('uploading');
    const VERIFY_ATTEMPTS = 3;

    const { result } = await renderHook(() =>
      useVideoUpload({
        supabase: mock_supabase as never,
        check_video_status: mock_check_video_status,
        verify_attempts: VERIFY_ATTEMPTS,
        verify_interval_ms: 0,
      }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(mock_update).not.toHaveBeenCalled();
    expect(mock_check_video_status).toHaveBeenCalledTimes(VERIFY_ATTEMPTS);
  });

  // ── (EC16) Checker 'failed' — corta de inmediato ──────────────────────────

  it("(EC16) checker_failed_corta_de_inmediato_sin_agotar_intentos: checker='failed' → status=error con mensaje propio de procesamiento fallido, update NO llamado, checker llamado EXACTAMENTE 1 vez (no agota verify_attempts)", async () => {
    const upload_task = make_failing_upload_task();
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});
    const mock_check_video_status = jest.fn().mockResolvedValue('failed');

    const { result } = await renderHook(() =>
      useVideoUpload({
        supabase: mock_supabase as never,
        check_video_status: mock_check_video_status,
        verify_attempts: 5,
        verify_interval_ms: 0,
      }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).not.toBeNull();
    expect(result.current.error).not.toBe(NEUTRAL_ERROR_MESSAGE);
    expect(result.current.error).toMatch(/no se pudo procesar/i);
    expect(mock_update).not.toHaveBeenCalled();
    expect(mock_check_video_status).toHaveBeenCalledTimes(1);
  });

  // ── (EC17) Excepción del propio checker — fail-closed ─────────────────────

  it('(EC17) checker_lanza_excepcion_fail_closed_sin_update: check_video_status rechaza → status=error, mensaje neutro (fail-closed), update NO llamado', async () => {
    const upload_task = make_failing_upload_task();
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});
    const mock_check_video_status = jest.fn().mockRejectedValue(new Error('db unreachable'));

    const { result } = await renderHook(() =>
      useVideoUpload({
        supabase: mock_supabase as never,
        check_video_status: mock_check_video_status,
        verify_attempts: 2,
        verify_interval_ms: 0,
      }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(mock_update).not.toHaveBeenCalled();
    // Distingue "fail-closed tras invocar el checker" de "el checker nunca
    // se llamó" (el viejo camino de error inmediato produce el MISMO
    // desenlace observable — sin esta aserción el test no sería RED).
    expect(mock_check_video_status).toHaveBeenCalledTimes(1);
  });

  // ── (EC18) Reintentos: 'uploading' → 'ready' en el 2º intento ─────────────

  it("(EC18) reintentos_uploading_luego_ready_verify_attempts_2_dos_llamadas: checker='uploading' la 1ra vez y 'ready' la 2da (verify_attempts=2) → éxito, checker llamado EXACTAMENTE 2 veces", async () => {
    const upload_task = make_failing_upload_task();
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});
    const mock_check_video_status = jest
      .fn()
      .mockResolvedValueOnce('uploading')
      .mockResolvedValueOnce('ready');

    const { result } = await renderHook(() =>
      useVideoUpload({
        supabase: mock_supabase as never,
        check_video_status: mock_check_video_status,
        verify_attempts: 2,
        verify_interval_ms: 0,
      }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.status).toBe('processing');
    expect(result.current.error).toBeNull();
    expect(mock_check_video_status).toHaveBeenCalledTimes(2);
  });

  // ── (EC19) El checker se llama con el uid devuelto por mint-upload-url ───

  it('(EC19) checker_llamado_con_el_uid_devuelto_por_mint_upload_url: check_video_status se invoca con el mismo uid que devolvió mint-upload-url', async () => {
    const DISTINCT_UID = 'stream-uid-checker-arg-test-xyz789';
    const upload_task = make_failing_upload_task();
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: { uploadUrl: SIGNED_UPLOAD_URL, uid: DISTINCT_UID }, error: null },
    });
    const mock_check_video_status = jest.fn().mockResolvedValue('ready');

    const { result } = await renderHook(() =>
      useVideoUpload({
        supabase: mock_supabase as never,
        check_video_status: mock_check_video_status,
        verify_attempts: 2,
        verify_interval_ms: 0,
      }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(mock_check_video_status).toHaveBeenCalledWith(DISTINCT_UID);
    expect(mock_update).toHaveBeenCalledWith({ video_id: DISTINCT_UID, cloudflare_uid: DISTINCT_UID });
  });

  // ── (EC20) No regresión — el camino feliz 2xx NUNCA consulta el checker ──

  it('(EC20) exito_2xx_no_llama_al_checker_ni_una_vez: upload normal 2xx → status=processing sin invocar check_video_status ni una vez (guard-rail no-regresión)', async () => {
    const upload_task = make_mock_upload_task({ status: 200 });
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});
    const mock_check_video_status = jest.fn().mockResolvedValue('ready');

    const { result } = await renderHook(() =>
      useVideoUpload({
        supabase: mock_supabase as never,
        check_video_status: mock_check_video_status,
        verify_attempts: 2,
        verify_interval_ms: 0,
      }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.status).toBe('processing');
    expect(mock_check_video_status).not.toHaveBeenCalled();
  });

  // ── (EC21) Estado transitorio 'verifying' antes del desenlace ────────────

  it("(EC21) estado_pasa_por_verifying_antes_del_desenlace: tras el reject de uploadAsync, status='verifying' con progress=0.99 ANTES de resolver el checker; al resolver 'ready' termina en 'processing'/progress=1", async () => {
    const upload_task = make_failing_upload_task();
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    let resolve_checker!: (v: string) => void;
    const pending_check = new Promise<string>((res) => {
      resolve_checker = res;
    });
    const mock_check_video_status = jest.fn().mockReturnValue(pending_check);

    const { result } = await renderHook(() =>
      useVideoUpload({
        supabase: mock_supabase as never,
        check_video_status: mock_check_video_status,
        verify_attempts: 2,
        verify_interval_ms: 0,
      }),
    );

    act(() => {
      void result.current.upload(TEST_LOCAL_URI);
    });

    await act(async () => {
      await flush_microtasks(8);
    });

    expect(mock_check_video_status).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('verifying');
    expect(result.current.progress).toBe(0.99);

    await act(async () => {
      resolve_checker('ready');
      await flush_microtasks(5);
    });

    expect(result.current.status).toBe('processing');
    expect(result.current.progress).toBe(1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Defecto O2 (guardian, tras el GREEN de 103.2) — 'verifying' era una rama
  // muerta: step3.tsx solo lee hook.status DESPUÉS de `await upload()`
  // (patrón de refs), así que el texto "Verificando que el video llegó…"
  // nunca se renderizaba durante el poll. Fix: `on_status_change` notifica
  // CADA transición en vivo, para que la UI pueda espejarla sin esperar el
  // await completo.
  // ═══════════════════════════════════════════════════════════════════════

  it("(EC22) on_status_change_recibe_verifying_antes_del_desenlace: con un falso negativo que el checker termina resolviendo, el callback recibe 'verifying' ANTES que 'processing'", async () => {
    const upload_task = make_failing_upload_task();
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});
    const mock_check_video_status = jest.fn().mockResolvedValue('ready');
    const mock_on_status_change = jest.fn();

    const { result } = await renderHook(() =>
      useVideoUpload({
        supabase: mock_supabase as never,
        check_video_status: mock_check_video_status,
        verify_attempts: 2,
        verify_interval_ms: 0,
        on_status_change: mock_on_status_change,
      }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    const statuses = mock_on_status_change.mock.calls.map((call) => call[0]);

    expect(statuses).toContain('verifying');
    expect(statuses.indexOf('verifying')).toBeLessThan(statuses.lastIndexOf('processing'));
    expect(result.current.status).toBe('processing');
  });

  it('(EC23) on_status_change_2xx_no_emite_verifying: el camino feliz 2xx nunca notifica el estado transitorio (guard-rail, mismo criterio que EC20)', async () => {
    const upload_task = make_mock_upload_task({ status: 200 });
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});
    const mock_on_status_change = jest.fn();

    const { result } = await renderHook(() =>
      useVideoUpload({
        supabase: mock_supabase as never,
        on_status_change: mock_on_status_change,
      }),
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    const statuses = mock_on_status_change.mock.calls.map((call) => call[0]);

    expect(statuses).not.toContain('verifying');
    expect(statuses).toContain('processing');
    expect(result.current.status).toBe('processing');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Quick fix 2026-08-15 (smoke manual): "Cambiar video" durante una subida
  // debe CANCELAR la anterior y dejar subir otra de inmediato.
  //   - mint-upload-url se invoca con body { replace: true } (la EF soft-borra
  //     los pendientes sin propiedad del caller antes de contar concurrencia).
  //   - createUploadTask recibe un AbortSignal; cancel() lo aborta.
  //   - Una subida cancelada/superada NUNCA escribe status/error/form después:
  //     el llamador la reemplazó, su resultado ya no importa.
  //   - upload() mientras hay otra en vuelo = supersede (cancela la anterior).
  // EDGE CASES:
  // - (CX-1) mint_se_invoca_con_replace_true
  // - (CX-2) createUploadTask_recibe_signal_y_cancel_lo_aborta_status_idle
  // - (CX-3) subida_cancelada_no_escribe_al_form_ni_pone_error_al_resolver
  // - (CX-4) segundo_upload_supera_al_primero_solo_el_segundo_escribe
  // ─────────────────────────────────────────────────────────────────────────

  it('(CX-1) mint_se_invoca_con_replace_true', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase as never }),
    );
    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });
    expect(mock_supabase._mock_invoke).toHaveBeenCalledWith('mint-upload-url', {
      body: { replace: true },
    });
  });

  it('(CX-2) createUploadTask_recibe_signal_y_cancel_lo_aborta_status_idle', async () => {
    // uploadAsync queda colgado hasta que se aborta el signal (como el nativo).
    let captured_signal: AbortSignal | undefined;
    const upload_task: MockUploadTask = {
      uploadAsync: jest.fn().mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            captured_signal?.addEventListener('abort', () => {
              const err = new Error('Aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }),
      ),
    };
    const file_instance = make_mock_file({ upload_task });
    file_instance.createUploadTask.mockImplementation((_url: string, opts: { signal?: AbortSignal }) => {
      captured_signal = opts.signal;
      return upload_task;
    });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});
    const statuses: string[] = [];

    const { result } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase as never, on_status_change: (s) => statuses.push(s) }),
    );

    let upload_promise!: Promise<void>;
    act(() => {
      upload_promise = result.current.upload(TEST_LOCAL_URI);
    });
    await act(async () => {
      await flush_microtasks(6);
    });
    expect(captured_signal).toBeInstanceOf(AbortSignal);
    expect(captured_signal!.aborted).toBe(false);

    act(() => {
      result.current.cancel();
    });
    await act(async () => {
      await upload_promise;
    });

    expect(captured_signal!.aborted).toBe(true);
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(mock_update).not.toHaveBeenCalled();
    expect(statuses[statuses.length - 1]).toBe('idle');
  });

  it('(CX-3) subida_cancelada_no_escribe_al_form_ni_pone_error_al_resolver', async () => {
    // El nativo NO respeta el abort y termina 2xx después — aun así, una
    // subida cancelada no debe escribir nada (el llamador ya la reemplazó).
    let resolve_upload!: (v: MockUploadTaskResult) => void;
    const upload_task: MockUploadTask = {
      uploadAsync: jest.fn().mockImplementation(
        () => new Promise((resolve) => { resolve_upload = resolve; }),
      ),
    };
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase as never }),
    );

    let upload_promise!: Promise<void>;
    act(() => {
      upload_promise = result.current.upload(TEST_LOCAL_URI);
    });
    await act(async () => {
      await flush_microtasks(6);
    });
    act(() => {
      result.current.cancel();
    });
    await act(async () => {
      resolve_upload({ status: 200 });
      await upload_promise;
    });

    expect(mock_update).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('(CX-4) segundo_upload_supera_al_primero_solo_el_segundo_escribe', async () => {
    let resolve_first!: (v: MockUploadTaskResult) => void;
    const first_task: MockUploadTask = {
      uploadAsync: jest.fn().mockImplementation(
        () => new Promise((resolve) => { resolve_first = resolve; }),
      ),
    };
    const second_task = make_mock_upload_task({ status: 200 });
    const first_file = make_mock_file({ upload_task: first_task });
    const second_file = make_mock_file({ upload_task: second_task });
    MockFile.mockImplementationOnce(() => first_file as never).mockImplementationOnce(
      () => second_file as never,
    );
    const SECOND_UID = 'stream-uid-second-xyz';
    const mock_invoke = jest
      .fn()
      .mockResolvedValueOnce({ data: { uploadUrl: SIGNED_UPLOAD_URL, uid: STREAM_UID }, error: null })
      .mockResolvedValueOnce({ data: { uploadUrl: SIGNED_UPLOAD_URL, uid: SECOND_UID }, error: null });
    const mock_supabase = { functions: { invoke: mock_invoke } };

    const { result } = await renderHook(() =>
      useVideoUpload({ supabase: mock_supabase as never }),
    );

    let first_promise!: Promise<void>;
    act(() => {
      first_promise = result.current.upload(TEST_LOCAL_URI);
    });
    await act(async () => {
      await flush_microtasks(6);
    });
    // Segundo upload mientras el primero sigue en vuelo → supersede.
    await act(async () => {
      await result.current.upload('file:///other/video.mp4');
    });
    // El primero termina "bien" DESPUÉS — no debe pisar al segundo.
    await act(async () => {
      resolve_first({ status: 200 });
      await first_promise;
    });

    expect(mock_update).toHaveBeenCalledTimes(1);
    expect(mock_update).toHaveBeenCalledWith({ video_id: SECOND_UID, cloudflare_uid: SECOND_UID });
    expect(result.current.status).toBe('processing');
  });
});
