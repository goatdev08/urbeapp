/**
 * Tests fase RED — useAdUpload hook (mobile/src/features/ads/hooks/useAdUpload.ts)
 * Subtarea Taskmaster: 169.7 — ciclo de subida del creativo de un anuncio.
 *
 * SUT: useAdUpload(deps?: UseAdUploadDeps): UseAdUploadResult
 *   upload: (params: { local_uri: string | null; duration_ms: number | null }) => Promise<void>
 *   cancel: () => void
 *   status: 'idle' | 'uploading' | 'polling' | 'ready' | 'failed'
 *   progress: number   // 0..1
 *   error: string | null
 *   cloudflare_uid: string | null   // solo no-null cuando status==='ready'
 *
 * REUSO deliberado (CLAUDE.md §0) del pipeline de
 * mobile/src/features/publish/hooks/useVideoUpload.ts: mismo patrón de
 * File(local_uri) (expo-file-system v56, getters síncronos .exists/.size),
 * mismo techo MAX_STREAM_UPLOAD_BYTES=200MB, mismo
 * file.createUploadTask(uploadUrl, {onProgress, signal}).uploadAsync(), mismo
 * extract_error_code sobre FunctionsHttpError. Sin PublishFormContext: este
 * hook NO depende de ningún wizard/contexto (169.8/169.9 no existen
 * todavía) — expone `cloudflare_uid` directo para que el futuro wizard lo
 * lea, en vez de escribir a un form ajeno.
 *
 * DIFERENCIAS DE CONTRATO frente al hermano (no son bugs, son el punto de
 * esta subtarea):
 *   D1. El ciclo NO termina en 'processing' tras el 2xx del binario — sigue
 *       con un POLL de `ad_creatives.status` (checker inyectado,
 *       `check_ad_creative_status`, NUNCA se lee la tabla por canal lateral
 *       en estos tests) hasta 'ready' | 'failed'. progress se queda en 0.99
 *       durante todo el poll; solo llega a 1 cuando status='ready'.
 *   D2. La duración (169.6, `validate_ad_duration_ms`, rango [6,30] s
 *       INCLUSIVE) se valida ANTES de tocar el archivo o la red — mint-ad-
 *       upload-url NUNCA se invoca con una duración inválida (169.4 solo
 *       capa el máximo de 30s en Stream; el mínimo de 6s es enteramente
 *       responsabilidad del cliente/webhook, 169.5/169.6).
 *   D3. mint-ad-upload-url (169.4) tiene errores propios que el hermano no
 *       tiene: FORBIDDEN (403, sin capacidad de anunciar la organización) y
 *       AD_UPLOAD_IN_PROGRESS (409, scoped por agencia — NO es
 *       UPLOAD_IN_PROGRESS del hermano). El 409 se traduce a un mensaje
 *       ENTENDIBLE y DISTINTO del genérico: es un estado esperado, no una
 *       falla.
 *   D4. `ad_creatives` (20260816000005_ads_schema.sql) NO tiene columna de
 *       razón de falla — el servidor (169.5) COLAPSA el motivo de
 *       'failed' (AD_DURATION_INVALID vs. fallo real de transcodificación)
 *       en el mismo status. Por eso la única forma real de que el cliente
 *       distinga esos dos 'failed' es ATAJAR la duración inválida en el
 *       PRE-FLIGHT (D2, antes de subir nada): si el pre-flight ya validó
 *       [6,30]s, cualquier 'failed' que llegue del poll es, por
 *       eliminación, un fallo de transcodificación — mensaje genérico
 *       distinto del de duración. Ver EC-POLL-FAILED.
 *   D5. Sin useEffect de limpieza, desmontar el componente NO detendría un
 *       upload/poll en vuelo (el hermano tiene ese hueco: step5.tsx nunca
 *       llama a .cancel() en su unmount). Este hook SÍ registra un cleanup
 *       de efecto que cancela automáticamente al desmontar — contrato nuevo,
 *       pedido explícito de la subtarea ("que no queden timers vivos ni
 *       setState sobre un componente desmontado").
 *
 * NOTA API: @testing-library/react-native v14 — renderHook es ASYNC
 * (`const { result } = await renderHook(...)`); unmount() bajo fake timers
 * DEBE ir envuelto en act (si no, los efectos de los hooks de los tests
 * POSTERIORES no corren — corrupción silenciosa, gotcha ya pagado en este
 * repo).
 *
 * Mocks: TODO mockeado (cero red real) — expo-file-system (File),
 * supabase.functions.invoke, check_ad_creative_status (colaborador
 * inyectado). validate_ad_duration_ms de 169.6 SÍ se ejecuta real (función
 * pura ya probada en su propio archivo; aquí solo se prueba que el hook la
 * aplica en el momento y con el efecto correctos).
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC0) estado_inicial_es_idle_progreso_cero_sin_cloudflare_uid.
 * - (EC1) exito_completo_mint_binario_y_poll_hasta_ready: mint ok → sube el
 *   binario 2xx → poll resuelve 'ready' → status='ready', progress=1,
 *   cloudflare_uid=uid, error=null.
 *
 * ### Edge cases del PRD/contratos (169.4/169.6 — archivo y duración)
 * - (EC2) uri_nula_no_invoca_mint_ni_checker.
 * - (EC3) duracion_invalida_no_invoca_mint_ni_construye_file: orden — la
 *   duración se valida ANTES de tocar el filesystem (D2).
 * - (EC4) duracion_null_fail_closed_no_invoca_mint: mismo criterio fail-
 *   closed que validate_ad_duration_ms (169.6).
 * - (EC5) duracion_boundary_minimo_5999ms_invalida_6000ms_valida.
 * - (EC6) duracion_boundary_maximo_30000ms_valida_30001ms_invalida.
 * - (EC7) archivo_no_existe_no_invoca_mint.
 * - (EC8) excede_200mb_no_invoca_mint.
 *
 * ### Ramas de mint-ad-upload-url (D3, no obvias)
 * - (EC9) mint_401_unauthenticated_mensaje_de_sesion.
 * - (EC10) mint_403_forbidden_sin_capacidad_de_anunciar_mensaje_propio: NO
 *   es el mismo mensaje que 401 ni el neutro.
 * - (EC11) mint_409_ad_upload_in_progress_mensaje_entendible_no_generico:
 *   el punto central de la subtarea — DISTINTO del mensaje neutro.
 * - (EC12) mint_502_stream_upload_failed_mensaje_neutro_otros_codigos.
 *
 * ### Boundary / error del binario a Stream
 * - (EC13) stream_upload_no_2xx_falla_sin_iniciar_poll: el checker NUNCA se
 *   invoca si el binario no llegó.
 * - (EC14) stream_upload_excepcion_red_mensaje_neutro_sin_crash.
 * - (EC15) progreso_cap_099_durante_binario_via_onProgress.
 * - (EC16) progreso_permanece_099_tras_2xx_hasta_que_el_poll_resuelve_ready
 *   (D1 — el punto donde este hook diverge del hermano).
 * - (EC17) on_progress_notifica_1_solo_cuando_el_poll_resuelve_ready.
 *
 * ### Poll del creativo hasta ready|failed (dominio propio, D1/D4)
 * - (EC18/EC19) poll_checker_processing_o_uploading_reintenta_sin_terminar.
 * - (EC-POLL-FAILED) poll_checker_failed_mensaje_de_transcodificacion_
 *   distinto_del_mensaje_de_duracion_invalida (D4 — el corazón de la
 *   subtarea: los dos 'failed' son observablemente distinguibles).
 * - (EC20) poll_checker_missing_reintenta_como_en_curso.
 * - (EC21) poll_attempts_agotados_mensaje_neutro_checker_llamado_exactamente_n_veces.
 * - (EC22) poll_checker_lanza_excepcion_fail_closed_llamado_una_vez.
 * - (EC23) poll_checker_invocado_con_el_uid_devuelto_por_mint.
 *
 * ### Cancelación / unmount a mitad de la subida (D5)
 * - (EC24) cancel_a_mitad_del_binario_aborta_signal_status_idle_sin_error.
 * - (EC25) cancel_a_mitad_del_poll_detiene_el_loop_checker_no_se_llama_de_nuevo.
 * - (EC26) unmount_a_mitad_del_binario_aborta_automaticamente_sin_crash.
 * - (EC27) unmount_a_mitad_del_poll_detiene_el_loop_sin_llamadas_posteriores_
 *   ni_timers_vivos: bajo fake timers, tras desmontar, avanzar el reloj NO
 *   produce llamadas nuevas al checker (no quedan timers vivos).
 * - (EC28) segundo_upload_supersede_al_primero_solo_el_segundo_persiste_
 *   cloudflare_uid.
 */

import { renderHook, act } from '@testing-library/react-native';
import * as FileSystem from 'expo-file-system';
import { FunctionsHttpError } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Mock de 'expo-file-system' — API v56 (clase File, getters síncronos), mismo
// mock que el hermano (useVideoUpload.test.tsx).
// ---------------------------------------------------------------------------

jest.mock('expo-file-system', () => ({
  File: jest.fn(),
  UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
}));

const MockFile = FileSystem.File as unknown as jest.Mock;

// ---------------------------------------------------------------------------
// SUT — importado DESPUÉS de los mocks de módulo
// ---------------------------------------------------------------------------

import { useAdUpload } from '../hooks/useAdUpload';

// ---------------------------------------------------------------------------
// Constantes de test — valores independientes del SUT (nunca importados de
// la constante del propio módulo bajo prueba — ese fue el hueco de 169.6).
// ---------------------------------------------------------------------------

const TEST_LOCAL_URI = 'file:///data/user/0/com.urbea/cache/ad-video.mp4';
const STREAM_UID = 'stream-uid-ad-mint-test-abc123';
const SIGNED_UPLOAD_URL = 'https://upload.videodelivery.net/tus-session/ad-abc123';
const MAX_STREAM_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB — mismo techo que el hermano.
const VALID_DURATION_MS = 15000; // 15 s, cómodamente dentro de [6,30] s.

const SESSION_ERROR_MESSAGE = 'No hay sesión activa. Inicia sesión para publicar.';
const FORBIDDEN_MESSAGE = 'No tienes permiso para publicar anuncios de esta organización.';
const AD_UPLOAD_IN_PROGRESS_MESSAGE =
  'Ya tienes un anuncio subiéndose. Espera a que termine para subir otro.';
const NEUTRAL_ERROR_MESSAGE = 'Error al subir el anuncio. Verifica tu conexión e intenta de nuevo.';
const AD_DURATION_INVALID_MESSAGE = 'La duración del video debe ser de entre 6 y 30 segundos.';
const TRANSCODING_FAILED_MESSAGE = 'El anuncio no se pudo procesar. Intenta subir el video de nuevo.';

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
// Factories de mock del File nativo (API v56) — mismo patrón que el hermano.
// ---------------------------------------------------------------------------

function make_mock_upload_task(result: MockUploadTaskResult = { status: 200 }): MockUploadTask {
  return {
    uploadAsync: jest.fn().mockResolvedValue({ status: result.status, body: '', headers: {} }),
  };
}

function make_mock_file(opts: { exists?: boolean; size?: number; upload_task?: MockUploadTask }): MockFileInstance {
  const { exists = true, size = 20 * 1024 * 1024 } = opts;
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
    _mock_invoke: mock_invoke,
  };
}

/** FunctionsHttpError con el body { error: { code, message } } que emiten las EFs de Urbea. */
function make_ef_error(payload: { code: string; message: string }, status: number): FunctionsHttpError {
  return new FunctionsHttpError(new Response(JSON.stringify({ error: payload }), { status }));
}

/** Deja avanzar promesas ya-resueltas (mint, binario, primer tick del poll). */
async function flush_microtasks(times = 6): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAdUpload', () => {
  beforeEach(() => {
    MockFile.mockReset();
    MockFile.mockImplementation(() => make_mock_file({}) as never);
  });

  // ── (EC0) Estado inicial ───────────────────────────────────────────────

  it('(EC0) estado_inicial_es_idle_progreso_cero_sin_cloudflare_uid', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(() => useAdUpload({ supabase: mock_supabase as never }));

    expect(result.current.status).toBe('idle');
    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBeNull();
    expect(result.current.cloudflare_uid).toBeNull();
  });

  // ── (EC1) Happy path completo — hasta 'ready' ────────────────────────────

  it('(EC1) exito_completo_mint_binario_y_poll_hasta_ready: mint ok, binario 2xx, poll resuelve ready → status=ready, progress=1, cloudflare_uid=uid', async () => {
    const upload_task = make_mock_upload_task({ status: 200 });
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});
    const mock_checker = jest.fn().mockResolvedValue('ready');

    const { result } = await renderHook(() =>
      useAdUpload({
        supabase: mock_supabase as never,
        check_ad_creative_status: mock_checker,
        poll_attempts: 3,
        poll_interval_ms: 0,
      }),
    );

    await act(async () => {
      await result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledWith('mint-ad-upload-url', expect.anything());
    expect(file_instance.createUploadTask).toHaveBeenCalledTimes(1);
    expect(mock_checker).toHaveBeenCalledWith(STREAM_UID);
    expect(result.current.status).toBe('ready');
    expect(result.current.progress).toBe(1);
    expect(result.current.error).toBeNull();
    expect(result.current.cloudflare_uid).toBe(STREAM_UID);
  });

  // ── (EC2) URI nula ──────────────────────────────────────────────────────

  it('(EC2) uri_nula_no_invoca_mint_ni_checker', async () => {
    const mock_supabase = make_mock_supabase({});
    const mock_checker = jest.fn().mockResolvedValue('ready');
    const { result } = await renderHook(() =>
      useAdUpload({ supabase: mock_supabase as never, check_ad_creative_status: mock_checker }),
    );

    await act(async () => {
      await result.current.upload({ local_uri: null, duration_ms: VALID_DURATION_MS });
    });

    expect(result.current.status).toBe('failed');
    expect(mock_supabase._mock_invoke).not.toHaveBeenCalled();
    expect(mock_checker).not.toHaveBeenCalled();
    expect(result.current.cloudflare_uid).toBeNull();
  });

  // ── (EC3) Duración inválida — se valida ANTES de tocar el archivo ────────

  it('(EC3) duracion_invalida_no_invoca_mint_ni_construye_file: duración fuera de rango → falla ANTES de instanciar File (D2)', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(() => useAdUpload({ supabase: mock_supabase as never }));

    await act(async () => {
      await result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: 3000 }); // 3s, < 6s
    });

    expect(result.current.status).toBe('failed');
    expect(result.current.error).toBe(AD_DURATION_INVALID_MESSAGE);
    expect(MockFile).not.toHaveBeenCalled();
    expect(mock_supabase._mock_invoke).not.toHaveBeenCalled();
  });

  // ── (EC4) Duración null — fail-closed ─────────────────────────────────────

  it('(EC4) duracion_null_fail_closed_no_invoca_mint: sin duration_ms no hay forma de verificar el mínimo (mismo criterio que 169.6/169.5)', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(() => useAdUpload({ supabase: mock_supabase as never }));

    await act(async () => {
      await result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: null });
    });

    expect(result.current.status).toBe('failed');
    expect(result.current.error).toBe(AD_DURATION_INVALID_MESSAGE);
    expect(mock_supabase._mock_invoke).not.toHaveBeenCalled();
  });

  // ── (EC5) Boundary del mínimo: 5999ms inválido, 6000ms válido ────────────

  it('(EC5) duracion_boundary_minimo_5999ms_invalida_6000ms_valida', async () => {
    const mock_supabase_below = make_mock_supabase({});
    const { result: result_below } = await renderHook(() =>
      useAdUpload({ supabase: mock_supabase_below as never }),
    );
    await act(async () => {
      await result_below.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: 5999 });
    });
    expect(result_below.current.status).toBe('failed');
    expect(result_below.current.error).toBe(AD_DURATION_INVALID_MESSAGE);
    expect(mock_supabase_below._mock_invoke).not.toHaveBeenCalled();

    const mock_supabase_at = make_mock_supabase({});
    const { result: result_at } = await renderHook(() => useAdUpload({ supabase: mock_supabase_at as never }));
    await act(async () => {
      await result_at.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: 6000 });
    });
    expect(mock_supabase_at._mock_invoke).toHaveBeenCalledTimes(1);
  });

  // ── (EC6) Boundary del máximo: 30000ms válido, 30001ms inválido ──────────

  it('(EC6) duracion_boundary_maximo_30000ms_valida_30001ms_invalida', async () => {
    const mock_supabase_at = make_mock_supabase({});
    const { result: result_at } = await renderHook(() => useAdUpload({ supabase: mock_supabase_at as never }));
    await act(async () => {
      await result_at.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: 30000 });
    });
    expect(mock_supabase_at._mock_invoke).toHaveBeenCalledTimes(1);

    const mock_supabase_over = make_mock_supabase({});
    const { result: result_over } = await renderHook(() =>
      useAdUpload({ supabase: mock_supabase_over as never }),
    );
    await act(async () => {
      await result_over.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: 30001 });
    });
    expect(result_over.current.status).toBe('failed');
    expect(result_over.current.error).toBe(AD_DURATION_INVALID_MESSAGE);
    expect(mock_supabase_over._mock_invoke).not.toHaveBeenCalled();
  });

  // ── (EC7) Archivo no existe ─────────────────────────────────────────────

  it('(EC7) archivo_no_existe_no_invoca_mint', async () => {
    const file_instance = make_mock_file({ exists: false });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(() => useAdUpload({ supabase: mock_supabase as never }));

    await act(async () => {
      await result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });

    expect(result.current.status).toBe('failed');
    expect(mock_supabase._mock_invoke).not.toHaveBeenCalled();
  });

  // ── (EC8) Techo de 200 MB ──────────────────────────────────────────────

  it('(EC8) excede_200mb_no_invoca_mint', async () => {
    const file_instance = make_mock_file({ size: MAX_STREAM_UPLOAD_BYTES + 1 });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(() => useAdUpload({ supabase: mock_supabase as never }));

    await act(async () => {
      await result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });

    expect(result.current.status).toBe('failed');
    expect(result.current.error).toMatch(/200/);
    expect(mock_supabase._mock_invoke).not.toHaveBeenCalled();
  });

  // ── (EC9) mint-ad-upload-url → 401 UNAUTHENTICATED ────────────────────────

  it('(EC9) mint_401_unauthenticated_mensaje_de_sesion', async () => {
    const ef_error = make_ef_error({ code: 'UNAUTHENTICATED', message: 'Autenticación requerida' }, 401);
    const mock_supabase = make_mock_supabase({ invoke_result: { data: null, error: ef_error } });

    const { result } = await renderHook(() => useAdUpload({ supabase: mock_supabase as never }));

    await act(async () => {
      await result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });

    expect(result.current.status).toBe('failed');
    expect(result.current.error).toBe(SESSION_ERROR_MESSAGE);
  });

  // ── (EC10) mint-ad-upload-url → 403 FORBIDDEN (sin capacidad de anunciar) ─

  it('(EC10) mint_403_forbidden_sin_capacidad_de_anunciar_mensaje_propio: distinto del de sesión y del neutro', async () => {
    const ef_error = make_ef_error(
      { code: 'FORBIDDEN', message: 'No tienes permiso para publicar anuncios de esta organización' },
      403,
    );
    const mock_supabase = make_mock_supabase({ invoke_result: { data: null, error: ef_error } });

    const { result } = await renderHook(() => useAdUpload({ supabase: mock_supabase as never }));

    await act(async () => {
      await result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });

    expect(result.current.status).toBe('failed');
    expect(result.current.error).toBe(FORBIDDEN_MESSAGE);
    expect(result.current.error).not.toBe(SESSION_ERROR_MESSAGE);
    expect(result.current.error).not.toBe(NEUTRAL_ERROR_MESSAGE);
  });

  // ── (EC11) mint-ad-upload-url → 409 AD_UPLOAD_IN_PROGRESS ─────────────────

  it('(EC11) mint_409_ad_upload_in_progress_mensaje_entendible_no_generico: 409 propio, es un estado esperado no una falla', async () => {
    const ef_error = make_ef_error(
      { code: 'AD_UPLOAD_IN_PROGRESS', message: 'Ya tienes un anuncio en curso; espera a que termine' },
      409,
    );
    const mock_supabase = make_mock_supabase({ invoke_result: { data: null, error: ef_error } });

    const { result } = await renderHook(() => useAdUpload({ supabase: mock_supabase as never }));

    await act(async () => {
      await result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });

    expect(result.current.status).toBe('failed');
    expect(result.current.error).toBe(AD_UPLOAD_IN_PROGRESS_MESSAGE);
    expect(result.current.error).not.toBe(NEUTRAL_ERROR_MESSAGE);
  });

  // ── (EC12) mint-ad-upload-url → 502 (representante de "otros" códigos) ───

  it('(EC12) mint_502_stream_upload_failed_mensaje_neutro_otros_codigos', async () => {
    const ef_error = make_ef_error(
      { code: 'STREAM_UPLOAD_FAILED', message: 'No se pudo crear el upload en Cloudflare Stream' },
      502,
    );
    const mock_supabase = make_mock_supabase({ invoke_result: { data: null, error: ef_error } });

    const { result } = await renderHook(() => useAdUpload({ supabase: mock_supabase as never }));

    await act(async () => {
      await result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });

    expect(result.current.status).toBe('failed');
    expect(result.current.error).toBe(NEUTRAL_ERROR_MESSAGE);
  });

  // ── (EC13) Binario no-2xx: NO inicia el poll ──────────────────────────────

  it('(EC13) stream_upload_no_2xx_falla_sin_iniciar_poll: uploadAsync status=500 → status=failed, checker NUNCA invocado', async () => {
    const upload_task = make_mock_upload_task({ status: 500 });
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});
    const mock_checker = jest.fn().mockResolvedValue('ready');

    const { result } = await renderHook(() =>
      useAdUpload({ supabase: mock_supabase as never, check_ad_creative_status: mock_checker }),
    );

    await act(async () => {
      await result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });

    expect(result.current.status).toBe('failed');
    expect(mock_checker).not.toHaveBeenCalled();
  });

  // ── (EC14) Excepción de red en el binario ─────────────────────────────────

  it('(EC14) stream_upload_excepcion_red_mensaje_neutro_sin_crash', async () => {
    const upload_task: MockUploadTask = { uploadAsync: jest.fn().mockRejectedValue(new Error('network fail')) };
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(() => useAdUpload({ supabase: mock_supabase as never }));

    await act(async () => {
      await result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });

    expect(result.current.status).toBe('failed');
    expect(result.current.error).toBe(NEUTRAL_ERROR_MESSAGE);
  });

  // ── (EC15) Progreso — cap 0.99 durante el binario ─────────────────────────

  it('(EC15) progreso_cap_099_durante_binario_via_onProgress', async () => {
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
      size: 20 * 1024 * 1024,
      createUploadTask: create_upload_task,
      _upload_task: { uploadAsync: jest.fn().mockReturnValue(pending) },
    };
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(() => useAdUpload({ supabase: mock_supabase as never }));

    act(() => {
      void result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });
    await act(async () => {
      await flush_microtasks();
    });

    expect(captured_on_progress).toBeDefined();

    act(() => {
      captured_on_progress!({ bytesSent: 10e6, totalBytes: 20e6 });
    });
    expect(result.current.progress).toBeCloseTo(0.5, 2);

    act(() => {
      captured_on_progress!({ bytesSent: 19.98e6, totalBytes: 20e6 });
    });
    expect(result.current.progress).toBeLessThanOrEqual(0.99);

    await act(async () => {
      resolve_upload({ status: 200 });
    });
  });

  // ── (EC16) Progreso se queda en 0.99 tras el 2xx hasta que el poll resuelve ready (D1) ──

  it('(EC16) progreso_permanece_099_tras_2xx_hasta_que_el_poll_resuelve_ready', async () => {
    const upload_task = make_mock_upload_task({ status: 200 });
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    let resolve_checker!: (v: string) => void;
    const pending_check = new Promise<string>((res) => {
      resolve_checker = res;
    });
    const mock_checker = jest.fn().mockReturnValue(pending_check);

    const { result } = await renderHook(() =>
      useAdUpload({
        supabase: mock_supabase as never,
        check_ad_creative_status: mock_checker,
        poll_attempts: 3,
        poll_interval_ms: 0,
      }),
    );

    act(() => {
      void result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });
    await act(async () => {
      await flush_microtasks(8);
    });

    expect(mock_checker).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('polling');
    expect(result.current.progress).toBe(0.99);

    await act(async () => {
      resolve_checker('ready');
      await flush_microtasks(5);
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.progress).toBe(1);
  });

  // ── (EC17) on_progress notifica 1 SOLO cuando el poll resuelve ready ─────

  it('(EC17) on_progress_notifica_1_solo_cuando_el_poll_resuelve_ready', async () => {
    const upload_task = make_mock_upload_task({ status: 200 });
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});
    const mock_checker = jest.fn().mockResolvedValue('ready');
    const mock_on_progress = jest.fn();

    const { result } = await renderHook(() =>
      useAdUpload({
        supabase: mock_supabase as never,
        check_ad_creative_status: mock_checker,
        on_progress: mock_on_progress,
        poll_attempts: 3,
        poll_interval_ms: 0,
      }),
    );

    await act(async () => {
      await result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });

    expect(mock_on_progress).toHaveBeenCalledWith(1);
    // Nunca notificó 1 antes de que status llegara a 'ready' — última llamada es el 1.
    const calls = mock_on_progress.mock.calls.map((c) => c[0] as number);
    expect(calls[calls.length - 1]).toBe(1);
  });

  // ── (EC18/EC19) Poll: 'processing'/'uploading' reintenta sin terminar ────

  async function assert_poll_reintenta(interim_status: 'processing' | 'uploading'): Promise<void> {
    const upload_task = make_mock_upload_task({ status: 200 });
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});
    const mock_checker = jest.fn().mockResolvedValueOnce(interim_status).mockResolvedValueOnce('ready');

    const { result } = await renderHook(() =>
      useAdUpload({
        supabase: mock_supabase as never,
        check_ad_creative_status: mock_checker,
        poll_attempts: 3,
        poll_interval_ms: 0,
      }),
    );

    await act(async () => {
      await result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });

    expect(mock_checker).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('ready');
  }

  it("(EC18) poll_checker_processing_reintenta_sin_terminar: 'processing' en el 1er intento, 'ready' en el 2do", async () => {
    await assert_poll_reintenta('processing');
  });

  it("(EC19) poll_checker_uploading_reintenta_sin_terminar: 'uploading' en el 1er intento, 'ready' en el 2do", async () => {
    await assert_poll_reintenta('uploading');
  });

  // ── (EC-POLL-FAILED) 'failed' del poll: mensaje DISTINTO del de duración inválida (D4) ──

  it("(EC-POLL-FAILED) poll_checker_failed_mensaje_de_transcodificacion_distinto_del_mensaje_de_duracion_invalida: la duración YA fue validada en el pre-flight (EC3-EC6), así que un 'failed' del poll SIEMPRE es un fallo de transcodificación", async () => {
    const upload_task = make_mock_upload_task({ status: 200 });
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});
    const mock_checker = jest.fn().mockResolvedValue('failed');

    const { result } = await renderHook(() =>
      useAdUpload({
        supabase: mock_supabase as never,
        check_ad_creative_status: mock_checker,
        poll_attempts: 5,
        poll_interval_ms: 0,
      }),
    );

    await act(async () => {
      await result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });

    expect(result.current.status).toBe('failed');
    expect(result.current.error).toBe(TRANSCODING_FAILED_MESSAGE);
    expect(result.current.error).not.toBe(AD_DURATION_INVALID_MESSAGE);
    // Corta de inmediato — no agota poll_attempts esperando un desenlace que ya llegó.
    expect(mock_checker).toHaveBeenCalledTimes(1);
    expect(result.current.cloudflare_uid).toBeNull();
  });

  // ── (EC20) Poll: 'missing' se trata como en curso (reintenta) ────────────

  it("(EC20) poll_checker_missing_reintenta_como_en_curso: 'missing' (uid aún no visible) en el 1er intento, 'ready' en el 2do", async () => {
    const upload_task = make_mock_upload_task({ status: 200 });
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});
    const mock_checker = jest.fn().mockResolvedValueOnce('missing').mockResolvedValueOnce('ready');

    const { result } = await renderHook(() =>
      useAdUpload({
        supabase: mock_supabase as never,
        check_ad_creative_status: mock_checker,
        poll_attempts: 3,
        poll_interval_ms: 0,
      }),
    );

    await act(async () => {
      await result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });

    expect(mock_checker).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('ready');
  });

  // ── (EC21) Poll agotado sin resolver ──────────────────────────────────────

  it('(EC21) poll_attempts_agotados_mensaje_neutro_checker_llamado_exactamente_n_veces', async () => {
    const upload_task = make_mock_upload_task({ status: 200 });
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});
    const mock_checker = jest.fn().mockResolvedValue('processing');
    const POLL_ATTEMPTS = 4;

    const { result } = await renderHook(() =>
      useAdUpload({
        supabase: mock_supabase as never,
        check_ad_creative_status: mock_checker,
        poll_attempts: POLL_ATTEMPTS,
        poll_interval_ms: 0,
      }),
    );

    await act(async () => {
      await result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });

    expect(result.current.status).toBe('failed');
    expect(result.current.error).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(mock_checker).toHaveBeenCalledTimes(POLL_ATTEMPTS);
    expect(result.current.cloudflare_uid).toBeNull();
  });

  // ── (EC22) Poll: el checker lanza — fail-closed ───────────────────────────

  it('(EC22) poll_checker_lanza_excepcion_fail_closed_llamado_una_vez', async () => {
    const upload_task = make_mock_upload_task({ status: 200 });
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});
    const mock_checker = jest.fn().mockRejectedValue(new Error('db unreachable'));

    const { result } = await renderHook(() =>
      useAdUpload({
        supabase: mock_supabase as never,
        check_ad_creative_status: mock_checker,
        poll_attempts: 3,
        poll_interval_ms: 0,
      }),
    );

    await act(async () => {
      await result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });

    expect(result.current.status).toBe('failed');
    expect(result.current.error).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(mock_checker).toHaveBeenCalledTimes(1);
  });

  // ── (EC23) Poll: se invoca con el uid que devolvió mint ───────────────────

  it('(EC23) poll_checker_invocado_con_el_uid_devuelto_por_mint', async () => {
    const DISTINCT_UID = 'stream-uid-ad-checker-arg-xyz789';
    const upload_task = make_mock_upload_task({ status: 200 });
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: { uploadUrl: SIGNED_UPLOAD_URL, uid: DISTINCT_UID }, error: null },
    });
    const mock_checker = jest.fn().mockResolvedValue('ready');

    const { result } = await renderHook(() =>
      useAdUpload({
        supabase: mock_supabase as never,
        check_ad_creative_status: mock_checker,
        poll_attempts: 3,
        poll_interval_ms: 0,
      }),
    );

    await act(async () => {
      await result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });

    expect(mock_checker).toHaveBeenCalledWith(DISTINCT_UID);
    expect(result.current.cloudflare_uid).toBe(DISTINCT_UID);
  });

  // ── (EC24) cancel() a mitad del binario ───────────────────────────────────

  it('(EC24) cancel_a_mitad_del_binario_aborta_signal_status_idle_sin_error', async () => {
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

    const { result } = await renderHook(() => useAdUpload({ supabase: mock_supabase as never }));

    let upload_promise!: Promise<void>;
    act(() => {
      upload_promise = result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });
    await act(async () => {
      await flush_microtasks();
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
    expect(result.current.cloudflare_uid).toBeNull();
  });

  // ── (EC25) cancel() a mitad del poll ──────────────────────────────────────

  it('(EC25) cancel_a_mitad_del_poll_detiene_el_loop_checker_no_se_llama_de_nuevo', async () => {
    const upload_task = make_mock_upload_task({ status: 200 });
    const file_instance = make_mock_file({ upload_task });
    MockFile.mockImplementation(() => file_instance as never);
    const mock_supabase = make_mock_supabase({});

    let resolve_first_check!: (v: string) => void;
    const first_check = new Promise<string>((res) => {
      resolve_first_check = res;
    });
    const mock_checker = jest.fn().mockReturnValueOnce(first_check).mockResolvedValue('ready');

    const { result } = await renderHook(() =>
      useAdUpload({
        supabase: mock_supabase as never,
        check_ad_creative_status: mock_checker,
        poll_attempts: 5,
        poll_interval_ms: 0,
      }),
    );

    let upload_promise!: Promise<void>;
    act(() => {
      upload_promise = result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });
    await act(async () => {
      await flush_microtasks(8);
    });
    expect(mock_checker).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('polling');

    act(() => {
      result.current.cancel();
    });

    // El 1er checker resuelve TARDE ('uploading' → seguiría reintentando si no
    // estuviera cancelado) — no debe disparar una 2da llamada al checker.
    await act(async () => {
      resolve_first_check('uploading');
      await upload_promise;
      await flush_microtasks(6);
    });

    expect(mock_checker).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.cloudflare_uid).toBeNull();
  });

  // ── (EC26) unmount() a mitad del binario — auto-cancela sin crashear (D5) ─

  it('(EC26) unmount_a_mitad_del_binario_aborta_automaticamente_sin_crash', async () => {
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

    const { result, unmount } = await renderHook(() => useAdUpload({ supabase: mock_supabase as never }));

    // 🔴 await obligatorio: el act() de RNTL 14 SIEMPRE envuelve el callback en
    // `async () => await callback()` (act.js:69) — incluso este "síncrono"
    // devuelve un thenable. Sin await, el tracking de act() queda colgado
    // ("overlapping act() calls") y el unmount() de más abajo (que SÍ está
    // envuelto correctamente) no alcanza a flushear su cleanup antes de la
    // aserción — el mismo gotcha #1 de la subtarea, versión "se coló".
    await act(async () => {
      void result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });
    await act(async () => {
      await flush_microtasks();
    });
    expect(captured_signal!.aborted).toBe(false);

    let unmount_threw = false;
    try {
      // Gotcha ya pagado en este repo: unmount() bajo fake timers/efectos DEBE
      // ir envuelto en act — si no, los efectos de hooks POSTERIORES no corren.
      await act(async () => {
        unmount();
        await flush_microtasks();
      });
    } catch {
      unmount_threw = true;
    }

    expect(unmount_threw).toBe(false);
    expect(captured_signal!.aborted).toBe(true);
  });

  // ── (EC27) unmount() a mitad del poll — no quedan timers vivos ───────────

  it('(EC27) unmount_a_mitad_del_poll_detiene_el_loop_sin_llamadas_posteriores_ni_timers_vivos', async () => {
    jest.useFakeTimers();
    try {
      const upload_task = make_mock_upload_task({ status: 200 });
      const file_instance = make_mock_file({ upload_task });
      MockFile.mockImplementation(() => file_instance as never);
      const mock_supabase = make_mock_supabase({});
      // Siempre 'processing' — si el loop siguiera vivo tras desmontar, cada
      // avance del reloj produciría una llamada nueva al checker.
      const mock_checker = jest.fn().mockResolvedValue('processing');

      const { result, unmount } = await renderHook(() =>
        useAdUpload({
          supabase: mock_supabase as never,
          check_ad_creative_status: mock_checker,
          poll_attempts: 10,
          poll_interval_ms: 5000,
        }),
      );

      // 🔴 await obligatorio (mismo motivo que EC26): sin él, el tracking de
      // act() queda colgado y el unmount() de abajo no flushea su cleanup
      // (useLayoutEffect) a tiempo — el poll seguía vivo tras desmontar.
      await act(async () => {
        void result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(0);
      });

      expect(mock_checker).toHaveBeenCalledTimes(1);
      const calls_before_unmount = mock_checker.mock.calls.length;

      await act(async () => {
        unmount();
        await jest.advanceTimersByTimeAsync(0);
      });

      // Avanza el reloj MUY por delante del intervalo de poll — si quedara un
      // timer vivo, esto dispararía llamadas nuevas al checker.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(60000);
      });

      expect(mock_checker.mock.calls.length).toBe(calls_before_unmount);
    } finally {
      jest.useRealTimers();
    }
  });

  // ── (EC28) Supersede: el 2do upload reemplaza al 1ro ──────────────────────

  it('(EC28) segundo_upload_supersede_al_primero_solo_el_segundo_persiste_cloudflare_uid', async () => {
    let resolve_first!: (v: MockUploadTaskResult) => void;
    const first_task: MockUploadTask = {
      uploadAsync: jest.fn().mockImplementation(() => new Promise((resolve) => { resolve_first = resolve; })),
    };
    const second_task = make_mock_upload_task({ status: 200 });
    const first_file = make_mock_file({ upload_task: first_task });
    const second_file = make_mock_file({ upload_task: second_task });
    MockFile.mockImplementationOnce(() => first_file as never).mockImplementationOnce(() => second_file as never);

    const SECOND_UID = 'stream-uid-ad-second-xyz';
    const mock_invoke = jest
      .fn()
      .mockResolvedValueOnce({ data: { uploadUrl: SIGNED_UPLOAD_URL, uid: STREAM_UID }, error: null })
      .mockResolvedValueOnce({ data: { uploadUrl: SIGNED_UPLOAD_URL, uid: SECOND_UID }, error: null });
    const mock_supabase = { functions: { invoke: mock_invoke } };
    const mock_checker = jest.fn().mockResolvedValue('ready');

    const { result } = await renderHook(() =>
      useAdUpload({
        supabase: mock_supabase as never,
        check_ad_creative_status: mock_checker,
        poll_attempts: 3,
        poll_interval_ms: 0,
      }),
    );

    let first_promise!: Promise<void>;
    act(() => {
      first_promise = result.current.upload({ local_uri: TEST_LOCAL_URI, duration_ms: VALID_DURATION_MS });
    });
    await act(async () => {
      await flush_microtasks();
    });
    // Segundo upload mientras el primero sigue en vuelo (binario) → supersede.
    await act(async () => {
      await result.current.upload({ local_uri: 'file:///other/ad-video.mp4', duration_ms: VALID_DURATION_MS });
    });
    // El primero termina "bien" DESPUÉS — no debe pisar al segundo.
    await act(async () => {
      resolve_first({ status: 200 });
      await first_promise;
    });

    expect(result.current.status).toBe('ready');
    expect(result.current.cloudflare_uid).toBe(SECOND_UID);
  });
});
