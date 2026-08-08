/**
 * Tests fase RED — useUpdateLeadStatus hook
 * Archivo SUT: mobile/src/features/leads/hooks/useUpdateLeadStatus.ts
 * Subtarea Taskmaster: 15.4 (original) + 75.6 (mensajes de error en español)
 *
 * SUT: useUpdateLeadStatus(deps?) → { update_status, is_updating, error }
 *
 * Contrato:
 *   - update_status(lead_id, new_status, note?) invoca EF 'update-lead-status'
 *     vía supabase.functions.invoke('update-lead-status', { body: { lead_id, new_status, note? } })
 *   - Retorna { ok, error } donde ok=true en éxito, ok=false en fallo.
 *   - Llama onSuccess (si fue inyectado) solo en caso de éxito.
 *   - note es opcional: si no se pasa, NO se incluye en el body (no body.note=undefined).
 *   - is_updating: true durante la invocación, false en reposo.
 *   - error: null en éxito; MENSAJE EN ESPAÑOL en fallo (75.6 — antes era
 *     error.message crudo de supabase-js, literalmente en inglés).
 *
 * PATRÓN DE MOCK:
 *   - supabase inyectado como dep: useUpdateLeadStatus({ supabase: mock, onSuccess? })
 *   - useAuth() mockeado via jest.mock (mantiene el patrón del repo)
 *   - Errores de la EF: FunctionsHttpError REAL con Response {error:{code,message}},
 *     mismo patrón que mobile/src/features/auth/__tests__/api.test.ts (make_http_error).
 *     `extract_error_code` (mobile/src/lib/supabase/edge-errors.ts) es un colaborador
 *     interno propio — NO se mockea, se ejercita con FunctionsHttpError reales.
 *
 * ENUM lead_status (fuente: migración 0001 + 75.1 — ver types.ts LeadStatus)
 *
 * CÓDIGOS DE ERROR DE LA EF (supabase/functions/update-lead-status/{handler,types}.ts,
 * verificados leyendo el handler — no asumidos):
 *   INVALID_INPUT (400) | UNAUTHENTICATED (401) | UNAUTHORIZED_AGENT (403) |
 *   LEAD_NOT_FOUND (404) | DB_ERROR (500)
 *   (INVALID_TRANSITION YA NO EXISTE — 75.1: transiciones libres, cualquiera → cualquiera)
 *
 * MAPA código → mensaje ES asumido para el GREEN (75.6, mismo patrón que
 * ContactAgentButton.tsx EF_ERROR_MESSAGES/map_ef_error — código desconocido y
 * fallo de red caen a un mensaje neutro, NUNCA al texto crudo de supabase-js):
 *   INVALID_INPUT      → 'Datos incorrectos. Intenta de nuevo.'
 *   UNAUTHENTICATED    → 'Debes iniciar sesión de nuevo para continuar.'
 *   UNAUTHORIZED_AGENT → 'No tienes permiso para modificar este lead.'
 *   LEAD_NOT_FOUND     → 'Este lead ya no existe o fue eliminado.'
 *   DB_ERROR           → 'Error interno. Intenta de nuevo.'
 *   (código desconocido)      → 'Ocurrió un error. Intenta de nuevo.'
 *   (sin código — error de red) → 'No se pudo conectar. Verifica tu conexión e intenta de nuevo.'
 *
 * Los literales de este archivo son INDEPENDIENTES del SUT (no se importan de
 * ningún mapa de la implementación) — si el GREEN usa otro texto, este test
 * lo detecta como regresión real.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) update_status_exitoso_invoca_ef_retorna_ok_true
 * - (EC-2) update_status_exitoso_llama_on_success
 * - (EC-3) update_status_exitoso_ok_true_is_updating_false_error_null
 *
 * ### Shape exacto del payload EF
 * - (EC-4) invoke_nombre_correcto_update_lead_status
 * - (EC-5) invoke_body_contiene_lead_id_correcto
 * - (EC-6) invoke_body_contiene_new_status_correcto
 * - (EC-7) update_status_con_note_body_incluye_note
 * - (EC-8) update_status_sin_note_body_omite_campo_note
 *
 * ### Estado is_updating
 * - (EC-9) is_updating_false_inicial_luego_true_durante_accion_pendiente
 *
 * ### Errores de la EF — mensajes en español (75.6, defecto #1 del usuario)
 * - (EC-10) error_ef_invalid_input_mensaje_espanol_exacto
 * - (EC-11) error_ef_on_success_no_llamado_invoke_si_llamado
 * - (EC-12) error_ef_unauthorized_agent_mensaje_espanol_exacto
 * - (EC-13) error_red_reject_mensaje_neutro_espanol_no_raw_message
 * - (EC-14) error_ef_lead_not_found_mensaje_espanol_exacto
 * - (EC-15) error_ef_db_error_mensaje_espanol_exacto
 * - (EC-16) error_ef_unauthenticated_mensaje_espanol_exacto
 * - (EC-17) error_ef_codigo_desconocido_mensaje_neutro
 * - (EC-18) ninguna_rama_expone_el_texto_crudo_de_supabase_js_en_ingles
 *
 * ### Boundary / no-regresión
 * - (EC-19) error_no_muta_estado_local_is_updating_false_y_on_success_no_invocado
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { useAuth } from '@/features/auth/context';
import { useUpdateLeadStatus } from '../hooks/useUpdateLeadStatus';
import type { ActionResult } from '../hooks/useUpdateLeadStatus';

// ---------------------------------------------------------------------------
// Mock de useAuth — declara ANTES de cualquier import del SUT.
// El agente autenticado tiene id TEST_AGENT_ID.
// ---------------------------------------------------------------------------

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_AGENT_ID = 'agente-uuid-lead-status-15';
const TEST_LEAD_ID = 'lead-uuid-update-status-001';

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
      data: { id: TEST_LEAD_ID, status: 'contacted', internal_notes: null },
      error: null,
    },
  } = opts;

  const mock_invoke = jest.fn().mockResolvedValue(invoke_result);

  return {
    functions: { invoke: mock_invoke },
    // Expuesto para aserciones directas
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

describe('useUpdateLeadStatus', () => {

  // ── (EC-1) Happy path — invoke llamado + ok=true ──────────────────────────

  it('(EC-1) update_status_exitoso_invoca_ef_retorna_ok_true: update_status exitoso → functions.invoke fue llamado y {ok:true, error:null}', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      useUpdateLeadStatus({ supabase: mock_supabase as never }),
    );

    let action_result: ActionResult | undefined;
    await act(async () => {
      action_result = await result.current.update_status(TEST_LEAD_ID, 'contacted');
    });

    // La EF debe haber sido invocada
    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    // Y el hook devuelve éxito
    expect(action_result).toBeDefined();
    expect(action_result!.ok).toBe(true);
    expect(action_result!.error).toBeNull();
  });

  // ── (EC-2) Happy path — onSuccess callback invocado ──────────────────────

  it('(EC-2) update_status_exitoso_llama_on_success: tras éxito, el callback onSuccess es invocado exactamente una vez', async () => {
    const mock_supabase = make_mock_supabase();
    const mock_on_success = jest.fn();
    const { result } = await renderHook(() =>
      useUpdateLeadStatus({ supabase: mock_supabase as never, onSuccess: mock_on_success }),
    );

    await act(async () => {
      await result.current.update_status(TEST_LEAD_ID, 'contacted');
    });

    expect(mock_on_success).toHaveBeenCalledTimes(1);
  });

  // ── (EC-3) Happy path — estado post-éxito ────────────────────────────────

  it('(EC-3) update_status_exitoso_ok_true_is_updating_false_error_null: tras éxito, is_updating=false y error=null (verificado combinado con ok=true)', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      useUpdateLeadStatus({ supabase: mock_supabase as never }),
    );

    let action_result: ActionResult | undefined;
    await act(async () => {
      action_result = await result.current.update_status(TEST_LEAD_ID, 'in_progress');
    });

    // ok=true verifica que la acción tuvo éxito
    expect(action_result!.ok).toBe(true);
    // Estado post-acción
    expect(result.current.is_updating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // ── (EC-4) Shape EF — nombre correcto 'update-lead-status' ───────────────

  it('(EC-4) invoke_nombre_correcto_update_lead_status: functions.invoke primer arg = "update-lead-status" (exacto, sin typo)', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      useUpdateLeadStatus({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.update_status(TEST_LEAD_ID, 'contacted');
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledWith(
      'update-lead-status',
      expect.anything(),
    );
  });

  // ── (EC-5) Shape EF — body.lead_id coincide ──────────────────────────────

  it('(EC-5) invoke_body_contiene_lead_id_correcto: body.lead_id === el lead_id argumento', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      useUpdateLeadStatus({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.update_status(TEST_LEAD_ID, 'visit_scheduled');
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    const call_body = mock_supabase._mock_invoke.mock.calls[0]![1] as {
      body: Record<string, unknown>;
    };
    expect(call_body.body.lead_id).toBe(TEST_LEAD_ID);
  });

  // ── (EC-6) Shape EF — body.new_status coincide ───────────────────────────

  it('(EC-6) invoke_body_contiene_new_status_correcto: body.new_status === el new_status argumento', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: {
        data: { id: TEST_LEAD_ID, status: 'visit_scheduled', internal_notes: null },
        error: null,
      },
    });
    const { result } = await renderHook(() =>
      useUpdateLeadStatus({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.update_status(TEST_LEAD_ID, 'visit_scheduled');
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    const call_body = mock_supabase._mock_invoke.mock.calls[0]![1] as {
      body: Record<string, unknown>;
    };
    expect(call_body.body.new_status).toBe('visit_scheduled');
  });

  // ── (EC-7) Con note — body.note incluido ─────────────────────────────────

  it('(EC-7) update_status_con_note_body_incluye_note: cuando se pasa note, body.note === el valor proporcionado', async () => {
    const mock_supabase = make_mock_supabase();
    const TEST_NOTE = 'El interesado confirma visita el lunes';
    const { result } = await renderHook(() =>
      useUpdateLeadStatus({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.update_status(TEST_LEAD_ID, 'visit_scheduled', TEST_NOTE);
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    const call_body = mock_supabase._mock_invoke.mock.calls[0]![1] as {
      body: Record<string, unknown>;
    };
    expect(call_body.body.note).toBe(TEST_NOTE);
  });

  // ── (EC-8) Sin note — body.note ausente ──────────────────────────────────

  it('(EC-8) update_status_sin_note_body_omite_campo_note: sin note, body NO contiene el campo note (ni como undefined)', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      useUpdateLeadStatus({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      // No se pasa note
      await result.current.update_status(TEST_LEAD_ID, 'contacted');
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    const call_body = mock_supabase._mock_invoke.mock.calls[0]![1] as {
      body: Record<string, unknown>;
    };
    // note debe estar ausente del body, no solo undefined

    expect(Object.prototype.hasOwnProperty.call(call_body.body, 'note')).toBe(false);
  });

  // ── (EC-9) is_updating=false inicial, luego true durante acción ──────────

  it('(EC-9) is_updating_false_inicial_luego_true_durante_accion_pendiente: is_updating=false inicial; true mientras la Promise está pendiente', async () => {
    let resolve_invoke!: (v: {
      data: Record<string, unknown>;
      error: null;
    }) => void;
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
      useUpdateLeadStatus({ supabase: mock_supabase_pending as never }),
    );

    expect(result.current.is_updating).toBe(false);

    act(() => {
      void result.current.update_status(TEST_LEAD_ID, 'contacted');
    });

    expect(result.current.is_updating).toBe(true);

    await act(async () => {
      resolve_invoke({
        data: { id: TEST_LEAD_ID, status: 'contacted', internal_notes: null },
        error: null,
      });
    });
  });

  // ── (EC-10) Error EF INVALID_INPUT — mensaje en español exacto ──────────

  it('(EC-10) error_ef_invalid_input_mensaje_espanol_exacto: EF retorna INVALID_INPUT → invoke fue llamado, error === "Datos incorrectos. Intenta de nuevo." (literal exacto)', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: null, error: make_ef_http_error('INVALID_INPUT') },
    });
    const { result } = await renderHook(() =>
      useUpdateLeadStatus({ supabase: mock_supabase as never }),
    );

    let action_result: ActionResult | undefined;
    await act(async () => {
      action_result = await result.current.update_status(TEST_LEAD_ID, 'closed_won_rent');
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    expect(action_result!.ok).toBe(false);
    expect(action_result!.error).toBe('Datos incorrectos. Intenta de nuevo.');
  });

  // ── (EC-11) Error EF — onSuccess NO llamado, invoke SÍ llamado ───────────

  it('(EC-11) error_ef_on_success_no_llamado_invoke_si_llamado: cuando la EF devuelve error, invoke SÍ fue llamado y onSuccess NO es invocado', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: {
        data: null,
        error: make_ef_http_error('LEAD_NOT_FOUND'),
      },
    });
    const mock_on_success = jest.fn();
    const { result } = await renderHook(() =>
      useUpdateLeadStatus({ supabase: mock_supabase as never, onSuccess: mock_on_success }),
    );

    await act(async () => {
      await result.current.update_status(TEST_LEAD_ID, 'discarded');
    });

    // invoke fue invocado (la EF se intentó)
    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    // onSuccess NO debe haberse invocado (hubo error)
    expect(mock_on_success).not.toHaveBeenCalled();
  });

  // ── (EC-12) Error EF UNAUTHORIZED_AGENT — mensaje en español exacto ──────

  it('(EC-12) error_ef_unauthorized_agent_mensaje_espanol_exacto: EF retorna UNAUTHORIZED_AGENT → invoke llamado, error === "No tienes permiso para modificar este lead." (literal exacto)', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: {
        data: null,
        error: make_ef_http_error('UNAUTHORIZED_AGENT'),
      },
    });
    const { result } = await renderHook(() =>
      useUpdateLeadStatus({ supabase: mock_supabase as never }),
    );

    let action_result: ActionResult | undefined;
    await act(async () => {
      action_result = await result.current.update_status(TEST_LEAD_ID, 'contacted');
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    expect(action_result!.ok).toBe(false);
    expect(action_result!.error).toBe('No tienes permiso para modificar este lead.');
  });

  // ── (EC-13) Error de red — invoke rechaza → mensaje neutro, no el raw ────

  it('(EC-13) error_red_reject_mensaje_neutro_espanol_no_raw_message: invoke rechazado (network/timeout) → invoke fue llamado, error es el mensaje neutro en español, is_updating=false, NUNCA el mensaje crudo de la excepción', async () => {
    const NETWORK_ERROR_MSG = 'Failed to fetch: conexión rechazada por timeout';
    const mock_invoke_reject = jest
      .fn()
      .mockRejectedValue(new Error(NETWORK_ERROR_MSG));
    const mock_supabase_reject = {
      functions: { invoke: mock_invoke_reject },
      _mock_invoke: mock_invoke_reject,
    };

    const { result } = await renderHook(() =>
      useUpdateLeadStatus({ supabase: mock_supabase_reject as never }),
    );

    let action_result: ActionResult | undefined;
    await act(async () => {
      action_result = await result.current.update_status(TEST_LEAD_ID, 'contacted');
    });

    expect(mock_invoke_reject).toHaveBeenCalledTimes(1);
    expect(action_result!.ok).toBe(false);
    expect(action_result!.error).toBe(
      'No se pudo conectar. Verifica tu conexión e intenta de nuevo.',
    );
    // NUNCA el mensaje crudo de la excepción de red
    expect(action_result!.error).not.toBe(NETWORK_ERROR_MSG);
    expect(result.current.is_updating).toBe(false);
  });

  // ── (EC-14) Error EF LEAD_NOT_FOUND — mensaje en español exacto ──────────

  it('(EC-14) error_ef_lead_not_found_mensaje_espanol_exacto: EF retorna LEAD_NOT_FOUND → error === "Este lead ya no existe o fue eliminado." (literal exacto)', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: null, error: make_ef_http_error('LEAD_NOT_FOUND') },
    });
    const { result } = await renderHook(() =>
      useUpdateLeadStatus({ supabase: mock_supabase as never }),
    );

    let action_result: ActionResult | undefined;
    await act(async () => {
      action_result = await result.current.update_status(TEST_LEAD_ID, 'contacted');
    });

    expect(action_result!.error).toBe('Este lead ya no existe o fue eliminado.');
  });

  // ── (EC-15) Error EF DB_ERROR — mensaje en español exacto ────────────────

  it('(EC-15) error_ef_db_error_mensaje_espanol_exacto: EF retorna DB_ERROR → error === "Error interno. Intenta de nuevo." (literal exacto)', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: null, error: make_ef_http_error('DB_ERROR') },
    });
    const { result } = await renderHook(() =>
      useUpdateLeadStatus({ supabase: mock_supabase as never }),
    );

    let action_result: ActionResult | undefined;
    await act(async () => {
      action_result = await result.current.update_status(TEST_LEAD_ID, 'contacted');
    });

    expect(action_result!.error).toBe('Error interno. Intenta de nuevo.');
  });

  // ── (EC-16) Error EF UNAUTHENTICATED — mensaje en español exacto ─────────

  it('(EC-16) error_ef_unauthenticated_mensaje_espanol_exacto: EF retorna UNAUTHENTICATED → error === "Debes iniciar sesión de nuevo para continuar." (literal exacto)', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: null, error: make_ef_http_error('UNAUTHENTICATED') },
    });
    const { result } = await renderHook(() =>
      useUpdateLeadStatus({ supabase: mock_supabase as never }),
    );

    let action_result: ActionResult | undefined;
    await act(async () => {
      action_result = await result.current.update_status(TEST_LEAD_ID, 'contacted');
    });

    expect(action_result!.error).toBe('Debes iniciar sesión de nuevo para continuar.');
  });

  // ── (EC-17) Código desconocido — mensaje neutro (no crashea, no lo inventa) ──

  it('(EC-17) error_ef_codigo_desconocido_mensaje_neutro: EF retorna un código NO mapeado → error === "Ocurrió un error. Intenta de nuevo." (fallback neutro, no crashea)', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: null, error: make_ef_http_error('FUTURE_CODE_NO_MAPEADO') },
    });
    const { result } = await renderHook(() =>
      useUpdateLeadStatus({ supabase: mock_supabase as never }),
    );

    let action_result: ActionResult | undefined;
    await act(async () => {
      action_result = await result.current.update_status(TEST_LEAD_ID, 'contacted');
    });

    expect(action_result!.ok).toBe(false);
    expect(action_result!.error).toBe('Ocurrió un error. Intenta de nuevo.');
  });

  // ── (EC-18) Ninguna rama expone el texto crudo de supabase-js en inglés ──

  it('(EC-18) ninguna_rama_expone_el_texto_crudo_de_supabase_js_en_ingles: en NINGUNA rama de error el mensaje es el literal en inglés de FunctionsHttpError ni contiene texto no traducido', async () => {
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
        useUpdateLeadStatus({ supabase: mock_supabase as never }),
      );

      let action_result: ActionResult | undefined;
      await act(async () => {
        action_result = await result.current.update_status(TEST_LEAD_ID, 'contacted');
      });

      expect(action_result!.error).not.toBe(RAW_SUPABASE_JS_MESSAGE);
      expect(action_result!.error).not.toBeNull();
      expect(action_result!.error).toMatch(/^[A-ZÁÉÍÓÚÑ]/); // frase en español, con mayúscula inicial
    }
  });

  // ── (EC-19) No-regresión — error no muta estado local incorrectamente ────

  it('(EC-19) error_no_muta_estado_local_is_updating_false_y_on_success_no_invocado: tras un error de la EF, is_updating vuelve a false y onSuccess nunca se invoca (no queda estado "colgado")', async () => {
    const mock_on_success = jest.fn();
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: null, error: make_ef_http_error('DB_ERROR') },
    });
    const { result } = await renderHook(() =>
      useUpdateLeadStatus({ supabase: mock_supabase as never, onSuccess: mock_on_success }),
    );

    await act(async () => {
      await result.current.update_status(TEST_LEAD_ID, 'contacted');
    });

    expect(result.current.is_updating).toBe(false);
    expect(result.current.error).not.toBeNull();
    expect(mock_on_success).not.toHaveBeenCalled();
  });

});
