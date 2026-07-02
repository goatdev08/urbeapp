/**
 * Tests fase RED — useUpdateLeadStatus hook
 * Archivo SUT: mobile/src/features/leads/hooks/useUpdateLeadStatus.ts
 * Subtarea Taskmaster: 15.4 — hook de mutación de estado de lead
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
 *   - error: null en éxito; string con descripción en fallo.
 *
 * PATRÓN DE MOCK:
 *   - supabase inyectado como dep: useUpdateLeadStatus({ supabase: mock, onSuccess? })
 *   - useAuth() mockeado via jest.mock (mantiene el patrón del repo)
 *
 * ENUM lead_status (fuente: migración 0001):
 *   'new' | 'contacted' | 'in_progress' | 'visit_scheduled' |
 *   'closed_won' | 'closed_lost' | 'discarded'
 *
 * CÓDIGOS DE ERROR DE LA EF (types.ts de update-lead-status):
 *   INVALID_INPUT | INVALID_TRANSITION | UNAUTHENTICATED |
 *   UNAUTHORIZED_AGENT | LEAD_NOT_FOUND | DB_ERROR
 *
 * EDGE CASES CUBIERTOS (13 casos):
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
 * ### Errores de la EF (no se tragan — propagación correcta)
 * - (EC-10) error_ef_invalid_transition_ok_false_error_propagado_invoke_llamado
 * - (EC-11) error_ef_on_success_no_llamado_invoke_si_llamado
 * - (EC-12) error_ef_unauthorized_agent_ok_false_error_propagado
 * - (EC-13) error_red_reject_ok_false_error_no_nulo_invoke_llamado
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mock de useAuth — declara ANTES de cualquier import del SUT.
// El agente autenticado tiene id TEST_AGENT_ID.
// ---------------------------------------------------------------------------

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { useAuth } from '@/features/auth/context';
import { useUpdateLeadStatus } from '../hooks/useUpdateLeadStatus';
import type { ActionResult } from '../hooks/useUpdateLeadStatus';

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_AGENT_ID = 'agente-uuid-lead-status-15';
const TEST_LEAD_ID = 'lead-uuid-update-status-001';

// ---------------------------------------------------------------------------
// Helper — cast tipado de mock
// ---------------------------------------------------------------------------

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

// ---------------------------------------------------------------------------
// Factory del mock de supabase — solo functions.invoke
//
// La EF 'update-lead-status' se invoca vía:
//   supabase.functions.invoke('update-lead-status', { body: { lead_id, new_status, note? } })
// supabase-js v2 devuelve { data, error } donde error es FunctionsHttpError si !2xx.
// En los tests se simula directamente con { data, error } resolviendo la Promise.
// ---------------------------------------------------------------------------

function make_mock_supabase(opts: {
  invoke_result?: {
    data: Record<string, unknown> | null;
    error: { message: string } | null;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user: { id: TEST_AGENT_ID } as any,
    session: null,
    isLoading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
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
  //
  // Regla: note es estrictamente opcional. Si no se pasa, el campo NO debe estar
  // presente en el body (ni como undefined), para no contaminar el payload de la EF.

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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(Object.prototype.hasOwnProperty.call(call_body.body, 'note')).toBe(false);
  });

  // ── (EC-9) is_updating=false inicial, luego true durante acción ──────────
  //
  // Regla: is_updating pasa a true de forma SÍNCRONA al disparar update_status
  // (antes del primer await), igual que isWorking en usePropertyActions (patrón ref).
  // Luego vuelve a false al resolver.

  it('(EC-9) is_updating_false_inicial_luego_true_durante_accion_pendiente: is_updating=false inicial; true mientras la Promise está pendiente', async () => {
    // Invoke que nunca resuelve en este test — simula vuelo en progreso
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

    // Estado inicial antes de cualquier acción
    expect(result.current.is_updating).toBe(false);

    // Dispara la acción SIN awaitar — la Promise queda pendiente
    act(() => {
      void result.current.update_status(TEST_LEAD_ID, 'contacted');
    });

    // is_updating debe ser true mientras la Promise no resuelve
    expect(result.current.is_updating).toBe(true);

    // Limpieza: resolver para no dejar Promise pendiente colgada
    await act(async () => {
      resolve_invoke({
        data: { id: TEST_LEAD_ID, status: 'contacted', internal_notes: null },
        error: null,
      });
    });
  });

  // ── (EC-10) Error EF INVALID_TRANSITION — propagado, invoke fue llamado ───

  it('(EC-10) error_ef_invalid_transition_ok_false_error_propagado_invoke_llamado: EF retorna INVALID_TRANSITION → invoke fue llamado, {ok:false, error contiene el message}', async () => {
    const EF_ERROR_MSG = 'INVALID_TRANSITION: new → closed_won no está permitido';
    const mock_supabase = make_mock_supabase({
      invoke_result: {
        data: null,
        error: { message: EF_ERROR_MSG },
      },
    });
    const { result } = await renderHook(() =>
      useUpdateLeadStatus({ supabase: mock_supabase as never }),
    );

    let action_result: ActionResult | undefined;
    await act(async () => {
      action_result = await result.current.update_status(TEST_LEAD_ID, 'closed_won');
    });

    // La EF sí fue invocada (el error vino de la EF, no de un guard previo)
    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    // El hook reporta fallo
    expect(action_result!.ok).toBe(false);
    // El mensaje de error de la EF debe estar accesible (no se traga)
    expect(action_result!.error).not.toBeNull();
    expect(action_result!.error).toContain('INVALID_TRANSITION');
  });

  // ── (EC-11) Error EF — onSuccess NO llamado, invoke SÍ llamado ───────────

  it('(EC-11) error_ef_on_success_no_llamado_invoke_si_llamado: cuando la EF devuelve error, invoke SÍ fue llamado y onSuccess NO es invocado', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: {
        data: null,
        error: { message: 'LEAD_NOT_FOUND: lead no existe o no pertenece al agente' },
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

  // ── (EC-12) Error EF UNAUTHORIZED_AGENT — propagado ──────────────────────

  it('(EC-12) error_ef_unauthorized_agent_ok_false_error_propagado: EF retorna UNAUTHORIZED_AGENT → invoke llamado, {ok:false, error!=null}', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: {
        data: null,
        error: { message: 'UNAUTHORIZED_AGENT: el agente no es dueño del lead' },
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
    expect(action_result!.error).not.toBeNull();
    expect(action_result!.error).toContain('UNAUTHORIZED_AGENT');
  });

  // ── (EC-13) Error de red — invoke rechaza (FunctionsHttpError o Network) ──
  //
  // Cuando supabase-js lanza una excepción al invocar la EF (timeout, network
  // error, etc.), el hook NO debe crashear: captura el error y devuelve
  // {ok:false, error!=null}, manteniendo is_updating=false.

  it('(EC-13) error_red_reject_ok_false_error_no_nulo_invoke_llamado: invoke rechazado (network/timeout) → invoke fue llamado, {ok:false, error!=null}, is_updating=false', async () => {
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

    // La EF fue intentada (invoke fue llamado)
    expect(mock_invoke_reject).toHaveBeenCalledTimes(1);
    // El hook no crashea — retorna {ok:false, error!=null}
    expect(action_result!.ok).toBe(false);
    expect(action_result!.error).not.toBeNull();
    // is_updating vuelve a false tras el error (no queda "colgado")
    expect(result.current.is_updating).toBe(false);
  });

});
