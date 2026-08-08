/**
 * Tests fase RED — useUpdateLeadNote hook
 * Archivo SUT: mobile/src/features/leads/hooks/useUpdateLeadNote.ts
 * Subtarea Taskmaster: 29.5 (original) + 75.6 (mensajes de error en español)
 *
 * SUT: useUpdateLeadNote(deps?) → { update_note, is_updating, error }
 *
 * Contrato (mirror de useUpdateLeadStatus, responsabilidad única: notas):
 *   - update_note(lead_id, note) invoca EF 'update-lead-note' vía
 *     supabase.functions.invoke('update-lead-note', { body: { lead_id, note } }).
 *   - note es REQUERIDO pero "" es válido (limpia la nota → internal_notes=null en DB).
 *   - Llama onSuccess (si fue inyectado) solo en caso de éxito.
 *   - is_updating: true de forma SÍNCRONA al disparar, false en reposo.
 *   - error: null en éxito; MENSAJE EN ESPAÑOL en fallo (75.6 — antes era
 *     error.message crudo de supabase-js, literalmente en inglés).
 *   - Doble-submit: una segunda llamada mientras la primera está en curso se
 *     bloquea (no dispara una segunda invocación de la EF).
 *
 * PATRÓN DE MOCK:
 *   - supabase inyectado como dep: useUpdateLeadNote({ supabase: mock, onSuccess? })
 *   - useAuth() mockeado via jest.mock
 *   - Errores de la EF: FunctionsHttpError REAL con Response {error:{code,message}},
 *     mismo patrón que auth/__tests__/api.test.ts y useUpdateLeadStatus.test.ts.
 *
 * CÓDIGOS DE ERROR DE LA EF (supabase/functions/update-lead-note/{handler,types}.ts,
 * verificados leyendo el handler — no asumidos):
 *   INVALID_INPUT (400) | UNAUTHENTICATED (401) | UNAUTHORIZED_AGENT (403) |
 *   LEAD_NOT_FOUND (404) | DB_ERROR (500)
 *
 * MAPA código → mensaje ES — IDÉNTICO al de useUpdateLeadStatus (mismo mapa
 * compartido; ambas EFs emiten los mismos 5 códigos):
 *   INVALID_INPUT      → 'Datos incorrectos. Intenta de nuevo.'
 *   UNAUTHENTICATED    → 'Debes iniciar sesión de nuevo para continuar.'
 *   UNAUTHORIZED_AGENT → 'No tienes permiso para modificar este lead.'
 *   LEAD_NOT_FOUND     → 'Este lead ya no existe o fue eliminado.'
 *   DB_ERROR           → 'Error interno. Intenta de nuevo.'
 *   (código desconocido)        → 'Ocurrió un error. Intenta de nuevo.'
 *   (sin código — error de red) → 'No se pudo conectar. Verifica tu conexión e intenta de nuevo.'
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) invoke_llamado_con_body_correcto_y_nombre_update_lead_note
 * - (EC-2) exito_llama_on_success
 * - (EC-3) exito_is_updating_false_al_terminar
 * - (EC-4) exito_error_es_null
 *
 * ### Errores de la EF — mensajes en español (75.6, defecto #1 del usuario)
 * - (EC-5) error_ef_unauthorized_agent_mensaje_espanol_exacto
 * - (EC-6) error_ef_on_success_no_llamado
 * - (EC-14) error_ef_invalid_input_mensaje_espanol_exacto
 * - (EC-15) error_ef_lead_not_found_mensaje_espanol_exacto
 * - (EC-16) error_ef_db_error_mensaje_espanol_exacto
 * - (EC-17) error_ef_unauthenticated_mensaje_espanol_exacto
 * - (EC-18) error_ef_codigo_desconocido_mensaje_neutro
 * - (EC-19) ninguna_rama_expone_el_texto_crudo_de_supabase_js_en_ingles
 *
 * ### Nota vacía (regla de negocio: "" limpia la nota, es válido)
 * - (EC-7) nota_vacia_permitida_invoca_ef_con_note_vacio
 *
 * ### Errores de red
 * - (EC-8) error_red_invoke_lanza_mensaje_neutro_espanol_no_raw_message
 *
 * ### Estado is_updating (patrón ref síncrono)
 * - (EC-9) is_updating_true_de_forma_sincrona_tras_invocar
 * - (EC-10) doble_submit_segunda_llamada_concurrente_se_bloquea
 *
 * ### DI y robustez
 * - (EC-11) funciona_sin_callback_on_success_no_crashea
 * - (EC-12) di_cliente_supabase_inyectado_es_usado_no_singleton
 *
 * ### Boundary / no-regresión
 * - (EC-13) error_no_muta_estado_local_is_updating_false_y_on_success_no_invocado
 *
 * ### Corrección code review (rama tarea/75) — FIX6: is_follow_up sin cobertura
 * Regla (75.6, docstring del SUT): note y is_follow_up viajan INDEPENDIENTES,
 * cada uno solo si vino `!== undefined` — NUNCA por truthiness (is_follow_up
 * =false es una desactivación real, no "ausente"). Sin estos tests, cambiar
 * el spread condicional a truthiness (`...(is_follow_up ? {is_follow_up} : {})`)
 * pasaba los 881 tests de la suite y rompía "desmarcar seguimiento" en prod.
 * - (EC-20) is_follow_up_false_sin_note_manda_solo_is_follow_up
 * - (EC-21) solo_note_no_incluye_is_follow_up_en_el_body
 * - (EC-22) note_e_is_follow_up_ambos_presentes_viajan_ambos
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { useAuth } from '@/features/auth/context';
import { useUpdateLeadNote } from '../hooks/useUpdateLeadNote';

// ---------------------------------------------------------------------------
// Mock de useAuth — declara ANTES de cualquier import del SUT.
// ---------------------------------------------------------------------------

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_AGENT_ID = 'agente-uuid-lead-note-29';
const TEST_LEAD_ID = 'lead-uuid-update-note-001';

// Literal EXACTO de @supabase/functions-js (FunctionsHttpError) — fuente
// independiente del SUT, ver node_modules/@supabase/functions-js/src/types.ts:91.
const RAW_SUPABASE_JS_MESSAGE = 'Edge Function returned a non-2xx status code';

// ---------------------------------------------------------------------------
// Helper — cast tipado de mock
// ---------------------------------------------------------------------------

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

/** FunctionsHttpError real con body {error:{code,message}} — mismo patrón que auth/api.test.ts. */
function make_ef_http_error(code: string): FunctionsHttpError {
  return new FunctionsHttpError(
    new Response(JSON.stringify({ error: { code, message: 'mensaje interno de la EF' } }), {
      status: 400,
    }),
  );
}

// ---------------------------------------------------------------------------
// Factory del mock de supabase — solo functions.invoke
// ---------------------------------------------------------------------------

function make_mock_supabase(opts: {
  invoke_result?: {
    data: Record<string, unknown> | null;
    error: unknown | null;
  };
} = {}) {
  const {
    invoke_result = {
      data: { id: TEST_LEAD_ID, internal_notes: 'nota de prueba' },
      error: null,
    },
  } = opts;

  const mock_invoke = jest.fn().mockResolvedValue(invoke_result);

  return {
    functions: { invoke: mock_invoke },
    _mock_invoke: mock_invoke,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mock_use_auth.mockReturnValue({

    user: { id: TEST_AGENT_ID } as any,
    session: null,
    isLoading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
    requestPasswordReset: jest.fn(),
    updatePassword: jest.fn(),
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useUpdateLeadNote', () => {

  // ── (EC-1) Happy path — invoke llamado con nombre y body correctos ────────

  it('(EC-1) invoke_llamado_con_body_correcto_y_nombre_update_lead_note: update_note invoca functions.invoke("update-lead-note", { body: { lead_id, note } })', async () => {
    const mock_supabase = make_mock_supabase();
    const TEST_NOTE = 'El interesado confirma visita el lunes';
    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, TEST_NOTE);
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    expect(mock_supabase._mock_invoke).toHaveBeenCalledWith('update-lead-note', {
      body: { lead_id: TEST_LEAD_ID, note: TEST_NOTE },
    });
  });

  // ── (EC-2) Happy path — onSuccess callback invocado ──────────────────────

  it('(EC-2) exito_llama_on_success: tras éxito, el callback onSuccess es invocado exactamente una vez', async () => {
    const mock_supabase = make_mock_supabase();
    const mock_on_success = jest.fn();
    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase as never, onSuccess: mock_on_success }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, 'nota confirmada');
    });

    expect(mock_on_success).toHaveBeenCalledTimes(1);
  });

  // ── (EC-3) Happy path — is_updating vuelve a false al terminar ──────────

  it('(EC-3) exito_is_updating_false_al_terminar: tras éxito, la EF fue invocada y is_updating=false', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, 'nota confirmada');
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    expect(result.current.is_updating).toBe(false);
  });

  // ── (EC-4) Happy path — error es null tras éxito ─────────────────────────

  it('(EC-4) exito_error_es_null: tras éxito, la EF fue invocada y error es null', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, 'nota confirmada');
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  // ── (EC-5) Error EF UNAUTHORIZED_AGENT — mensaje en español exacto ───────

  it('(EC-5) error_ef_unauthorized_agent_mensaje_espanol_exacto: EF devuelve UNAUTHORIZED_AGENT → is_updating=false y error === "No tienes permiso para modificar este lead." (literal exacto)', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: null, error: make_ef_http_error('UNAUTHORIZED_AGENT') },
    });
    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, 'nota');
    });

    expect(result.current.is_updating).toBe(false);
    expect(result.current.error).toBe('No tienes permiso para modificar este lead.');
  });

  // ── (EC-6) Error EF — onSuccess NO llamado ───────────────────────────────

  it('(EC-6) error_ef_on_success_no_llamado: EF devuelve error → onSuccess NO es invocado', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: {
        data: null,
        error: make_ef_http_error('LEAD_NOT_FOUND'),
      },
    });
    const mock_on_success = jest.fn();
    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase as never, onSuccess: mock_on_success }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, 'nota');
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    expect(mock_on_success).not.toHaveBeenCalled();
  });

  // ── (EC-7) Nota vacía — regla de negocio: "" limpia la nota, es válido ──

  it('(EC-7) nota_vacia_permitida_invoca_ef_con_note_vacio: note="" no es bloqueado por el hook, se invoca la EF con body.note=""', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: { id: TEST_LEAD_ID, internal_notes: null }, error: null },
    });
    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, '');
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    expect(mock_supabase._mock_invoke).toHaveBeenCalledWith('update-lead-note', {
      body: { lead_id: TEST_LEAD_ID, note: '' },
    });
    expect(result.current.error).toBeNull();
  });

  // ── (EC-8) Error de red — invoke rechaza → mensaje neutro, no el raw ─────

  it('(EC-8) error_red_invoke_lanza_mensaje_neutro_espanol_no_raw_message: invoke rechazado → no crashea, error es el mensaje neutro en español, is_updating=false, NUNCA el mensaje crudo de la excepción', async () => {
    const NETWORK_ERROR_MSG = 'Failed to fetch: conexión rechazada por timeout';
    const mock_invoke_reject = jest.fn().mockRejectedValue(new Error(NETWORK_ERROR_MSG));
    const mock_supabase_reject = {
      functions: { invoke: mock_invoke_reject },
      _mock_invoke: mock_invoke_reject,
    };

    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase_reject as never }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, 'nota');
    });

    expect(mock_invoke_reject).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe(
      'No se pudo conectar. Verifica tu conexión e intenta de nuevo.',
    );
    expect(result.current.error).not.toBe(NETWORK_ERROR_MSG);
    expect(result.current.is_updating).toBe(false);
  });

  // ── (EC-9) is_updating=true de forma SÍNCRONA tras invocar (patrón ref) ──

  it('(EC-9) is_updating_true_de_forma_sincrona_tras_invocar: is_updating pasa a true en el mismo tick síncrono en que se dispara update_note', async () => {
    let resolve_invoke!: (v: { data: Record<string, unknown>; error: null }) => void;
    const pending_invoke = new Promise<{ data: Record<string, unknown>; error: null }>(
      (res) => {
        resolve_invoke = res;
      },
    );
    const mock_supabase_pending = {
      functions: { invoke: jest.fn().mockReturnValue(pending_invoke) },
      _mock_invoke: jest.fn(),
    };

    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase_pending as never }),
    );

    expect(result.current.is_updating).toBe(false);

    act(() => {
      void result.current.update_note(TEST_LEAD_ID, 'nota en vuelo');
    });

    expect(result.current.is_updating).toBe(true);

    await act(async () => {
      resolve_invoke({ data: { id: TEST_LEAD_ID, internal_notes: 'nota en vuelo' }, error: null });
    });
  });

  // ── (EC-10) Doble-submit — segunda llamada concurrente se bloquea ───────

  it('(EC-10) doble_submit_segunda_llamada_concurrente_se_bloquea: mientras la primera invocación está en curso, una segunda llamada NO dispara una segunda invocación de la EF', async () => {
    let resolve_invoke!: (v: { data: Record<string, unknown>; error: null }) => void;
    const pending_invoke = new Promise<{ data: Record<string, unknown>; error: null }>(
      (res) => {
        resolve_invoke = res;
      },
    );
    const mock_invoke = jest.fn().mockReturnValue(pending_invoke);
    const mock_supabase_pending = {
      functions: { invoke: mock_invoke },
      _mock_invoke: mock_invoke,
    };

    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase_pending as never }),
    );

    act(() => {
      void result.current.update_note(TEST_LEAD_ID, 'primera nota');
    });
    expect(result.current.is_updating).toBe(true);

    act(() => {
      void result.current.update_note(TEST_LEAD_ID, 'segunda nota concurrente');
    });

    expect(mock_invoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve_invoke({ data: { id: TEST_LEAD_ID, internal_notes: 'primera nota' }, error: null });
    });
  });

  // ── (EC-11) Funciona sin callback onSuccess — no crashea ─────────────────

  it('(EC-11) funciona_sin_callback_on_success_no_crashea: sin onSuccess inyectado, update_note invoca la EF y no lanza excepción', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() => useUpdateLeadNote({ supabase: mock_supabase as never }));

    await expect(
      act(async () => {
        await result.current.update_note(TEST_LEAD_ID, 'nota sin callback');
      }),
    ).resolves.not.toThrow();

    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  // ── (EC-12) DI del cliente supabase — usa el inyectado, no un singleton ──

  it('(EC-12) di_cliente_supabase_inyectado_es_usado_no_singleton: el hook usa el cliente supabase inyectado por deps, no un singleton global', async () => {
    const mock_supabase_a = make_mock_supabase();
    const mock_supabase_b = make_mock_supabase();

    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase_a as never }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, 'nota via cliente A');
    });

    expect(mock_supabase_a._mock_invoke).toHaveBeenCalledTimes(1);
    expect(mock_supabase_b._mock_invoke).not.toHaveBeenCalled();
  });

  // ── (EC-13) No-regresión — error no muta estado local incorrectamente ────

  it('(EC-13) error_no_muta_estado_local_is_updating_false_y_on_success_no_invocado: tras un error de la EF, is_updating vuelve a false y onSuccess nunca se invoca', async () => {
    const mock_on_success = jest.fn();
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: null, error: make_ef_http_error('DB_ERROR') },
    });
    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase as never, onSuccess: mock_on_success }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, 'nota que falla');
    });

    expect(result.current.is_updating).toBe(false);
    expect(result.current.error).not.toBeNull();
    expect(mock_on_success).not.toHaveBeenCalled();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Corrección code review (rama tarea/75) — FIX6: is_follow_up sin cobertura
  // ═══════════════════════════════════════════════════════════════════════

  // ── (EC-20) is_follow_up=false sin note — body SOLO trae is_follow_up ────

  it('(EC-20) is_follow_up_false_sin_note_manda_solo_is_follow_up: update_note(id, undefined, false) invoca la EF con body={lead_id, is_follow_up:false} SIN la clave note', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, undefined, false);
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    expect(mock_supabase._mock_invoke).toHaveBeenCalledWith('update-lead-note', {
      body: { lead_id: TEST_LEAD_ID, is_follow_up: false },
    });
    const [, { body }] = mock_supabase._mock_invoke.mock.calls[0] as [string, { body: object }];
    expect(body).not.toHaveProperty('note');
  });

  // ── (EC-21) Solo note — body NO incluye is_follow_up ──────────────────────

  it('(EC-21) solo_note_no_incluye_is_follow_up_en_el_body: update_note(id, note) sin tercer argumento invoca la EF con body={lead_id, note} SIN la clave is_follow_up', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, 'nota sin toggle');
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledWith('update-lead-note', {
      body: { lead_id: TEST_LEAD_ID, note: 'nota sin toggle' },
    });
    const [, { body }] = mock_supabase._mock_invoke.mock.calls[0] as [string, { body: object }];
    expect(body).not.toHaveProperty('is_follow_up');
  });

  // ── (EC-22) Ambos presentes — el body trae los dos campos ─────────────────

  it('(EC-22) note_e_is_follow_up_ambos_presentes_viajan_ambos: update_note(id, note, true) invoca la EF con body={lead_id, note, is_follow_up:true}', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, 'nota y toggle juntos', true);
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledWith('update-lead-note', {
      body: { lead_id: TEST_LEAD_ID, note: 'nota y toggle juntos', is_follow_up: true },
    });
  });

  // ── (EC-14) Error EF INVALID_INPUT — mensaje en español exacto ───────────

  it('(EC-14) error_ef_invalid_input_mensaje_espanol_exacto: EF devuelve INVALID_INPUT → error === "Datos incorrectos. Intenta de nuevo." (literal exacto)', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: null, error: make_ef_http_error('INVALID_INPUT') },
    });
    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, 'nota');
    });

    expect(result.current.error).toBe('Datos incorrectos. Intenta de nuevo.');
  });

  // ── (EC-15) Error EF LEAD_NOT_FOUND — mensaje en español exacto ──────────

  it('(EC-15) error_ef_lead_not_found_mensaje_espanol_exacto: EF devuelve LEAD_NOT_FOUND → error === "Este lead ya no existe o fue eliminado." (literal exacto)', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: null, error: make_ef_http_error('LEAD_NOT_FOUND') },
    });
    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, 'nota');
    });

    expect(result.current.error).toBe('Este lead ya no existe o fue eliminado.');
  });

  // ── (EC-16) Error EF DB_ERROR — mensaje en español exacto ────────────────

  it('(EC-16) error_ef_db_error_mensaje_espanol_exacto: EF devuelve DB_ERROR → error === "Error interno. Intenta de nuevo." (literal exacto)', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: null, error: make_ef_http_error('DB_ERROR') },
    });
    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, 'nota');
    });

    expect(result.current.error).toBe('Error interno. Intenta de nuevo.');
  });

  // ── (EC-17) Error EF UNAUTHENTICATED — mensaje en español exacto ─────────

  it('(EC-17) error_ef_unauthenticated_mensaje_espanol_exacto: EF devuelve UNAUTHENTICATED → error === "Debes iniciar sesión de nuevo para continuar." (literal exacto)', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: null, error: make_ef_http_error('UNAUTHENTICATED') },
    });
    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, 'nota');
    });

    expect(result.current.error).toBe('Debes iniciar sesión de nuevo para continuar.');
  });

  // ── (EC-18) Código desconocido — mensaje neutro (no crashea, no lo inventa) ──

  it('(EC-18) error_ef_codigo_desconocido_mensaje_neutro: EF devuelve un código NO mapeado → error === "Ocurrió un error. Intenta de nuevo." (fallback neutro)', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: null, error: make_ef_http_error('FUTURE_CODE_NO_MAPEADO') },
    });
    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, 'nota');
    });

    expect(result.current.error).toBe('Ocurrió un error. Intenta de nuevo.');
  });

  // ── (EC-19) Ninguna rama expone el texto crudo de supabase-js en inglés ──

  it('(EC-19) ninguna_rama_expone_el_texto_crudo_de_supabase_js_en_ingles: en NINGUNA rama de error el mensaje es el literal en inglés de FunctionsHttpError', async () => {
    const codes_conocidos = [
      'INVALID_INPUT',
      'UNAUTHENTICATED',
      'UNAUTHORIZED_AGENT',
      'LEAD_NOT_FOUND',
      'DB_ERROR',
      'CODIGO_INVENTADO_SIN_MAPEO',
    ];

    for (const code of codes_conocidos) {
      const mock_supabase = make_mock_supabase({
        invoke_result: { data: null, error: make_ef_http_error(code) },
      });
      const { result } = await renderHook(() =>
        useUpdateLeadNote({ supabase: mock_supabase as never }),
      );

      await act(async () => {
        await result.current.update_note(TEST_LEAD_ID, 'nota');
      });

      expect(result.current.error).not.toBe(RAW_SUPABASE_JS_MESSAGE);
      expect(result.current.error).not.toBeNull();
      expect(result.current.error).toMatch(/^[A-ZÁÉÍÓÚÑ]/);
    }
  });

});
