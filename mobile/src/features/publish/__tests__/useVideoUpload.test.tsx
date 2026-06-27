/**
 * Tests fase RED — useVideoUpload hook (mobile/src/features/publish/hooks/useVideoUpload.ts)
 * Subtarea Taskmaster: 8.8 — Build Step 3 with video upload and preview
 *
 * SUT: useVideoUpload(deps?: { supabase?, uuid? }): { upload, status, progress, error }
 *
 * Contrato (Opción C del orquestador):
 *   - Recibe cliente Supabase y generador de UUID como deps inyectables.
 *   - Obtiene user_id de supabase.auth.getSession().
 *   - Genera video_id con uuid() ANTES de subir.
 *   - Sube a bucket 'property-videos' con path '{user_id}/{video_id}.mp4'.
 *   - Al éxito llama update({ video_id, storage_path }) del PublishFormContext.
 *   - En error: expone mensaje, NO escribe al form.
 *
 * NOTA API: @testing-library/react-native v14 — renderHook es ASYNC y debe ser
 * `await`ed. Patrón: `const { result } = await renderHook(...)`.
 * Ver implementación en dist/render-hook.js — `render()` (inner) es async y
 * result.current se setea vía useEffect tras el await.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) happy_path_upload_exitoso: llama upload con path correcto y escribe al context.
 * - (EC-2) update_escribe_video_id_y_storage_path: form state recibe video_id y storage_path exactos.
 *
 * ### Edge cases del PRD / contrato Opción-C
 * - (EC-3) path_primer_segmento_es_user_id: invariante RLS — foldername[1] === auth.uid().
 * - (EC-4) path_termina_en_mp4: extensión .mp4 fija (decisión para demo).
 * - (EC-5) bucket_es_property_videos: storage.from() recibe exactamente 'property-videos'.
 * - (EC-6) video_id_proviene_del_generador_inyectado: video_id === valor del uuid() inyectado.
 *
 * ### Sin video seleccionado
 * - (EC-7) sin_local_uri_no_llama_upload: local_uri null → sin upload, sin escritura al form.
 *
 * ### Sin sesión / sin user_id
 * - (EC-8) sin_sesion_no_sube: getSession sin user → sin upload, error claro, sin escritura al form.
 *
 * ### Error del storage
 * - (EC-9) error_storage_no_escribe_al_form: upload error → video_id/storage_path siguen null en form.
 * - (EC-10) error_storage_expone_mensaje: el error del hook contiene info del error de storage.
 *
 * ### Progreso (state machine)
 * - (EC-11) estado_inicial_es_idle: al montar: status='idle', progress=0, error=null.
 * - (EC-12) estado_uploading_durante_subida: mientras upload pendiente, status='uploading'.
 * - (EC-13) estado_success_tras_upload_exitoso: tras upload OK, status='success'.
 * - (EC-14) estado_error_tras_upload_fallido: tras upload con error Supabase, status='error'.
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'usuario-test-uuid-123';
const TEST_VIDEO_ID = 'video-uuid-fijo-para-tests';
const TEST_LOCAL_URI = 'file:///data/user/0/com.urbea/cache/video.mp4';
const EXPECTED_STORAGE_PATH = `${TEST_USER_ID}/${TEST_VIDEO_ID}.mp4`;

// ---------------------------------------------------------------------------
// Factories de mock para el cliente Supabase inyectado
// ---------------------------------------------------------------------------

function make_mock_supabase(opts: {
  user_id?: string | null;
  upload_result?: { data: unknown; error: unknown };
}) {
  const {
    user_id = TEST_USER_ID,
    upload_result = { data: { path: EXPECTED_STORAGE_PATH }, error: null },
  } = opts;

  const mock_upload = jest.fn().mockResolvedValue(upload_result);
  const mock_storage_from = jest.fn().mockReturnValue({ upload: mock_upload });

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
    _mock_upload: mock_upload,
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

// ---------------------------------------------------------------------------
// Wrapper con PublishFormProvider
// ---------------------------------------------------------------------------

import { PublishFormProvider, usePublishForm } from '../store/PublishFormContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <PublishFormProvider>{children}</PublishFormProvider>
);

// ---------------------------------------------------------------------------
// SUT — importado DESPUÉS de los imports de contexto
// ---------------------------------------------------------------------------

import { useVideoUpload } from '../hooks/useVideoUpload';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useVideoUpload', () => {
  // El hook lee el archivo con fetch(local_uri).arrayBuffer() (igual que la
  // subida de foto de perfil). Mockeamos fetch para que devuelva bytes; el body
  // no afecta las aserciones (el mock de storage.upload lo ignora).
  const real_fetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      arrayBuffer: async () => new ArrayBuffer(8),
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = real_fetch;
  });

  // ── (EC-11) Estado inicial ──────────────────────────────────────────────────

  it('(EC-11) estado_inicial_es_idle: al montar, status=idle, progress=0, error=null', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper }
    );

    expect(result.current.status).toBe('idle');
    expect(result.current.progress).toBe(0);
    expect(result.current.error).toBeNull();
  });

  // ── (EC-1) Happy path — upload exitoso ────────────────────────────────────

  it('(EC-1) happy_path_upload_exitoso: sube el video y escribe al context', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper }
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(mock_supabase._mock_storage_from).toHaveBeenCalledWith('property-videos');
    expect(mock_supabase._mock_upload).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('success');
  });

  // ── (EC-2) update escribe video_id y storage_path ─────────────────────────

  it('(EC-2) update_escribe_video_id_y_storage_path: el form recibe video_id y storage_path tras éxito', async () => {
    const mock_supabase = make_mock_supabase({});
    const uuid_gen = make_uuid_gen();

    // Hook doble: SUT + lector del form en el mismo tree
    const { result } = await renderHook(
      () => ({
        sut: useVideoUpload({ supabase: mock_supabase as never, uuid: uuid_gen }),
        form: usePublishForm(),
      }),
      { wrapper }
    );

    await act(async () => {
      await result.current.sut.upload(TEST_LOCAL_URI);
    });

    expect(result.current.form.state.video_id).toBe(TEST_VIDEO_ID);
    expect(result.current.form.state.storage_path).toBe(EXPECTED_STORAGE_PATH);
  });

  // ── (EC-3) Primer segmento del path = user_id (RLS invariant) ─────────────

  it('(EC-3) path_primer_segmento_es_user_id: el primer segmento del path de upload es el user_id de sesión', async () => {
    const custom_user_id = 'uid-rls-test-456';
    const mock_supabase = make_mock_supabase({
      user_id: custom_user_id,
      upload_result: { data: { path: `${custom_user_id}/${TEST_VIDEO_ID}.mp4` }, error: null },
    });

    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper }
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    const upload_call = mock_supabase._mock_upload.mock.calls[0] as [string, ...unknown[]];
    const first_segment = upload_call[0].split('/')[0];
    expect(first_segment).toBe(custom_user_id);
  });

  // ── (EC-4) Path termina en .mp4 ───────────────────────────────────────────

  it('(EC-4) path_termina_en_mp4: el path del objeto en storage termina en .mp4', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper }
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    const upload_call = mock_supabase._mock_upload.mock.calls[0] as [string, ...unknown[]];
    expect(upload_call[0]).toMatch(/\.mp4$/);
  });

  // ── (EC-5) Bucket es 'property-videos' ────────────────────────────────────

  it('(EC-5) bucket_es_property_videos: storage.from() recibe exactamente "property-videos"', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper }
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
    const mock_supabase = make_mock_supabase({
      upload_result: { data: { path: `${TEST_USER_ID}/${DETERMINISTIC_UUID}.mp4` }, error: null },
    });
    const uuid_gen = make_uuid_gen(DETERMINISTIC_UUID);

    const { result } = await renderHook(
      () => ({
        sut: useVideoUpload({ supabase: mock_supabase as never, uuid: uuid_gen }),
        form: usePublishForm(),
      }),
      { wrapper }
    );

    await act(async () => {
      await result.current.sut.upload(TEST_LOCAL_URI);
    });

    // El generador fue invocado exactamente una vez
    expect(uuid_gen).toHaveBeenCalledTimes(1);
    // El video_id en el form es el valor que devolvió el generador
    expect(result.current.form.state.video_id).toBe(DETERMINISTIC_UUID);
  });

  // ── (EC-7) Sin local_uri → no sube, no escribe al form ────────────────────

  it('(EC-7) sin_local_uri_no_llama_upload: local_uri null → sin llamada a upload, sin escritura al form, status=error', async () => {
    const mock_supabase = make_mock_supabase({});

    const { result } = await renderHook(
      () => ({
        sut: useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
        form: usePublishForm(),
      }),
      { wrapper }
    );

    await act(async () => {
      await result.current.sut.upload(null);
    });

    expect(mock_supabase._mock_upload).not.toHaveBeenCalled();
    expect(result.current.form.state.video_id).toBeNull();
    expect(result.current.form.state.storage_path).toBeNull();
    expect(result.current.sut.status).toBe('error');
  });

  // ── (EC-8) Sin sesión → no sube, error claro, no escribe al form ──────────

  it('(EC-8) sin_sesion_no_sube: getSession devuelve null → sin upload, error claro, sin escritura al form', async () => {
    const mock_supabase = make_mock_supabase({ user_id: null });

    const { result } = await renderHook(
      () => ({
        sut: useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
        form: usePublishForm(),
      }),
      { wrapper }
    );

    await act(async () => {
      await result.current.sut.upload(TEST_LOCAL_URI);
    });

    expect(mock_supabase._mock_upload).not.toHaveBeenCalled();
    expect(result.current.form.state.video_id).toBeNull();
    expect(result.current.form.state.storage_path).toBeNull();
    expect(result.current.sut.status).toBe('error');
    expect(result.current.sut.error).not.toBeNull();
  });

  // ── (EC-9) Error de storage → no escribe al form ──────────────────────────

  it('(EC-9) error_storage_no_escribe_al_form: error en upload → video_id y storage_path siguen null en form', async () => {
    const mock_supabase = make_mock_supabase({
      upload_result: { data: null, error: { message: 'Storage error: bucket access denied' } },
    });

    const { result } = await renderHook(
      () => ({
        sut: useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
        form: usePublishForm(),
      }),
      { wrapper }
    );

    await act(async () => {
      await result.current.sut.upload(TEST_LOCAL_URI);
    });

    expect(result.current.form.state.video_id).toBeNull();
    expect(result.current.form.state.storage_path).toBeNull();
    expect(result.current.sut.status).toBe('error');
  });

  // ── (EC-10) Error de storage expone mensaje ────────────────────────────────

  it('(EC-10) error_storage_expone_mensaje: el campo error del hook contiene información del error de storage', async () => {
    const mock_supabase = make_mock_supabase({
      upload_result: {
        data: null,
        error: { message: 'Storage error: bucket access denied' },
      },
    });

    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper }
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.error).toMatch(/storage|bucket|denied/i);
  });

  // ── (EC-12) Status 'uploading' mientras la Promise está pendiente ──────────

  it('(EC-12) estado_uploading_durante_subida: status=uploading mientras el upload está en curso', async () => {
    let resolve_upload!: (v: { data: unknown; error: null }) => void;
    const pending_upload = new Promise<{ data: unknown; error: null }>((res) => {
      resolve_upload = res;
    });

    const mock_upload = jest.fn().mockReturnValue(pending_upload);
    const mock_supabase = {
      auth: {
        getSession: jest.fn().mockResolvedValue({
          data: {
            session: {
              user: { id: TEST_USER_ID },
              access_token: 'tok',
              refresh_token: 'ref',
              token_type: 'bearer',
              expires_in: 3600,
              expires_at: 9999999,
            },
          },
          error: null,
        }),
      },
      storage: { from: jest.fn().mockReturnValue({ upload: mock_upload }) },
    };

    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper }
    );

    // Inicia el upload pero NO awaita — la Promise queda pendiente
    act(() => {
      void result.current.upload(TEST_LOCAL_URI);
    });

    // Debe estar en 'uploading' mientras la Promise de storage no resuelve
    expect(result.current.status).toBe('uploading');

    // Limpieza: resolvemos para no dejar Promises colgadas
    await act(async () => {
      resolve_upload({ data: { path: EXPECTED_STORAGE_PATH }, error: null });
    });
  });

  // ── (EC-13) Status 'success' tras upload exitoso ───────────────────────────

  it('(EC-13) estado_success_tras_upload_exitoso: tras upload exitoso, status=success', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper }
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.status).toBe('success');
  });

  // ── (EC-14) Status 'error' tras upload fallido ────────────────────────────

  it('(EC-14) estado_error_tras_upload_fallido: tras upload con error Supabase, status=error', async () => {
    const mock_supabase = make_mock_supabase({
      upload_result: { data: null, error: { message: 'Request failed with status code 403' } },
    });

    const { result } = await renderHook(
      () => useVideoUpload({ supabase: mock_supabase as never, uuid: make_uuid_gen() }),
      { wrapper }
    );

    await act(async () => {
      await result.current.upload(TEST_LOCAL_URI);
    });

    expect(result.current.status).toBe('error');
  });
});
