/**
 * Tests fase RED — usePropertyActions hook
 * Archivo: mobile/src/features/profile/hooks/usePropertyActions.ts
 * Subtarea Taskmaster: 17.7 — diálogos de confirmación (close/delete)
 *
 * SUT: usePropertyActions(deps?) → { changeStatus, closeProperty, pauseProperty,
 *                                    unpauseProperty, deleteProperty, isWorking, error }
 *
 * Contrato:
 *   - changeStatus / close / pause / unpause → invocan EF 'update-property-status'
 *     vía supabase.functions.invoke('update-property-status', { body })
 *   - closeProperty EXIGE closed_reason (guard en cliente): si falta/null → NO invoca la EF
 *   - deleteProperty → soft-delete: supabase.from('properties').update({deleted_at:<iso>}).eq('id', pid)
 *   - Todas devuelven {ok, error}; errores NO se tragan.
 *   - isWorking: true durante la operación, false al terminar.
 *
 * PATRÓN DE MOCK:
 *   - supabase inyectado como dep: usePropertyActions({ supabase: mock })
 *   - useAuth() mockeado via jest.mock (proporciona user.id)
 *
 * EDGE CASES CUBIERTOS (22 casos):
 *
 * ### Happy path
 * - (EC-1) close_property_con_reason_valida_retorna_ok
 * - (EC-2) delete_property_soft_delete_retorna_ok
 * - (EC-3) pause_property_retorna_ok
 * - (EC-4) unpause_property_retorna_ok
 *
 * ### Invariante crítica del PRD (guard closed_reason §propiedades-y-video)
 * - (EC-5) close_sin_reason_guard_cliente_no_invoca_ef
 * - (EC-6) close_con_reason_null_guard_cliente_no_invoca_ef
 *
 * ### Shape exacto del payload EF
 * - (EC-7) close_ef_recibe_nombre_update_property_status
 * - (EC-8) close_ef_body_tiene_new_status_closed
 * - (EC-9) close_ef_body_tiene_closed_reason
 * - (EC-10) close_ef_body_tiene_property_id
 * - (EC-11) pause_ef_body_new_status_paused_sin_closed_reason
 * - (EC-12) unpause_ef_body_new_status_active
 * - (EC-13) change_status_directo_invoca_ef_shape_correcto
 *
 * ### Shape exacto del soft-delete
 * - (EC-14) delete_from_recibe_tabla_properties
 * - (EC-15) delete_update_recibe_deleted_at_no_nulo
 * - (EC-16) delete_eq_recibe_id_correcto
 *
 * ### Propagación de errores (no se tragan)
 * - (EC-17) close_ef_devuelve_error_se_propaga_ok_false
 * - (EC-18) delete_db_error_se_propaga_ok_false
 *
 * ### Estado isWorking
 * - (EC-19) estado_inicial_isWorking_false_error_null
 * - (EC-20) isWorking_true_durante_accion
 * - (EC-21) isWorking_false_tras_exito
 * - (EC-22) isWorking_false_tras_error
 *
 * ### Señal compartida de mutación (subtarea 55.1)
 * - (EC-23) delete_exitoso_emite_property_deleted_una_vez_con_el_id
 * - (EC-24) delete_con_error_no_emite_property_deleted
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { useAuth } from '@/features/auth/context';
import { emitPropertyDeleted } from '@/lib/propertyEvents';
import { usePropertyActions } from '../hooks/usePropertyActions';
import type { ClosedReason } from '../hooks/usePropertyActions';

// ---------------------------------------------------------------------------
// Mock de useAuth — userId viene del mock, no de un AuthProvider real
// ---------------------------------------------------------------------------

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock de propertyEvents — espía la emisión de la señal compartida (55.1)
// sin ejecutar el pub/sub real.
// ---------------------------------------------------------------------------

jest.mock('@/lib/propertyEvents', () => ({
  emitPropertyDeleted: jest.fn(),
  onPropertyDeleted: jest.fn(() => jest.fn()),
}));

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'usuario-agente-uuid-17';
const TEST_PROPERTY_ID = 'propiedad-uuid-abc-999';
const TEST_CLOSED_REASON: ClosedReason = 'rented';

// ---------------------------------------------------------------------------
// Helpers — cast tipado de mock
// ---------------------------------------------------------------------------

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;
const mock_emit_property_deleted = emitPropertyDeleted as jest.MockedFunction<
  typeof emitPropertyDeleted
>;

// ---------------------------------------------------------------------------
// Factories de mock
// ---------------------------------------------------------------------------

/**
 * Mock del cliente Supabase con:
 *   functions.invoke('update-property-status', { body }) → { data, error }
 *   from('properties').update({ deleted_at }).eq('id', pid) → { error }
 */
function make_mock_supabase(opts: {
  invoke_result?: { data: Record<string, unknown> | null; error: { message: string } | null };
  delete_result?: { error: { message: string } | null };
} = {}) {
  const {
    invoke_result = {
      data: { id: TEST_PROPERTY_ID, status: 'closed', closed_reason: 'rented' },
      error: null,
    },
    delete_result = { error: null },
  } = opts;

  // Mock de EF invoke
  const mock_invoke = jest.fn().mockResolvedValue(invoke_result);
  const mock_functions = { invoke: mock_invoke };

  // Mock de soft-delete chain: .from(...).update(...).eq(...)
  const mock_eq = jest.fn().mockResolvedValue(delete_result);
  const mock_update = jest.fn().mockReturnValue({ eq: mock_eq });
  const mock_from = jest.fn().mockReturnValue({ update: mock_update });

  return {
    functions: mock_functions,
    from: mock_from,
    // Expuestos para aserciones
    _mock_invoke: mock_invoke,
    _mock_from: mock_from,
    _mock_update: mock_update,
    _mock_eq: mock_eq,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mock_use_auth.mockReturnValue({
     
    user: { id: TEST_USER_ID } as any,
    session: null,
    isLoading: false,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePropertyActions', () => {

  // ── (EC-19) Estado inicial ─────────────────────────────────────────────────

  it('(EC-19) estado_inicial_isWorking_false_error_null: al montar, isWorking=false y error=null', async () => {
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: make_mock_supabase() as never })
    );

    expect(result.current.isWorking).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // ── (EC-1) Happy path — closeProperty con reason válida ──────────────────

  it('(EC-1) close_property_con_reason_valida_retorna_ok: closeProperty({property_id, closed_reason}) exitoso devuelve {ok:true, error:null}', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    let action_result: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      action_result = await result.current.closeProperty({
        property_id: TEST_PROPERTY_ID,
        closed_reason: TEST_CLOSED_REASON,
      });
    });

    expect(action_result).toBeDefined();
    expect(action_result!.ok).toBe(true);
    expect(action_result!.error).toBeNull();
  });

  // ── (EC-2) Happy path — deleteProperty soft-delete ────────────────────────

  it('(EC-2) delete_property_soft_delete_retorna_ok: deleteProperty exitoso devuelve {ok:true, error:null}', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    let action_result: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      action_result = await result.current.deleteProperty({
        property_id: TEST_PROPERTY_ID,
      });
    });

    expect(action_result).toBeDefined();
    expect(action_result!.ok).toBe(true);
    expect(action_result!.error).toBeNull();
  });

  // ── (EC-3) Happy path — pauseProperty ────────────────────────────────────

  it('(EC-3) pause_property_retorna_ok: pauseProperty exitoso devuelve {ok:true, error:null}', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: { id: TEST_PROPERTY_ID, status: 'paused', closed_reason: null }, error: null },
    });
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    let action_result: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      action_result = await result.current.pauseProperty({ property_id: TEST_PROPERTY_ID });
    });

    expect(action_result!.ok).toBe(true);
    expect(action_result!.error).toBeNull();
  });

  // ── (EC-4) Happy path — unpauseProperty ──────────────────────────────────

  it('(EC-4) unpause_property_retorna_ok: unpauseProperty exitoso devuelve {ok:true, error:null}', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: { id: TEST_PROPERTY_ID, status: 'active', closed_reason: null }, error: null },
    });
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    let action_result: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      action_result = await result.current.unpauseProperty({ property_id: TEST_PROPERTY_ID });
    });

    expect(action_result!.ok).toBe(true);
    expect(action_result!.error).toBeNull();
  });

  // ── (EC-5) INVARIANTE CRÍTICA — close sin reason no invoca la EF ─────────

  it('(EC-5) close_sin_reason_guard_cliente_no_invoca_ef: closeProperty con closed_reason=undefined → EF NO invocada y {ok:false, error!=null}', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    let action_result: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
       
      action_result = await result.current.closeProperty({
        property_id: TEST_PROPERTY_ID,
        closed_reason: undefined as never,
      });
    });

    // Guard en cliente: la EF NO debe haberse invocado
    expect(mock_supabase._mock_invoke).not.toHaveBeenCalled();
    // El error debe exponerse (no se traga)
    expect(action_result!.ok).toBe(false);
    expect(action_result!.error).not.toBeNull();
  });

  // ── (EC-6) INVARIANTE CRÍTICA — close con reason=null no invoca la EF ────

  it('(EC-6) close_con_reason_null_guard_cliente_no_invoca_ef: closeProperty con closed_reason=null → EF NO invocada y {ok:false, error!=null}', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    let action_result: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      action_result = await result.current.closeProperty({
        property_id: TEST_PROPERTY_ID,
        closed_reason: null as never,
      });
    });

    expect(mock_supabase._mock_invoke).not.toHaveBeenCalled();
    expect(action_result!.ok).toBe(false);
    expect(action_result!.error).not.toBeNull();
  });

  // ── (EC-7) Shape EF — nombre correcto 'update-property-status' ───────────

  it('(EC-7) close_ef_recibe_nombre_update_property_status: functions.invoke primer argumento = "update-property-status" (exacto)', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    await act(async () => {
      await result.current.closeProperty({
        property_id: TEST_PROPERTY_ID,
        closed_reason: TEST_CLOSED_REASON,
      });
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledWith(
      'update-property-status',
      expect.anything(),
    );
  });

  // ── (EC-8) Shape EF — body.new_status = 'closed' ────────────────────────

  it('(EC-8) close_ef_body_tiene_new_status_closed: closeProperty invoca EF con body.new_status === "closed"', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    await act(async () => {
      await result.current.closeProperty({
        property_id: TEST_PROPERTY_ID,
        closed_reason: TEST_CLOSED_REASON,
      });
    });

    const call_body = mock_supabase._mock_invoke.mock.calls[0]![1] as { body: Record<string, unknown> };
    expect(call_body.body.new_status).toBe('closed');
  });

  // ── (EC-9) Shape EF — body.closed_reason coincide ────────────────────────

  it('(EC-9) close_ef_body_tiene_closed_reason: body.closed_reason === el valor proporcionado a closeProperty', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    await act(async () => {
      await result.current.closeProperty({
        property_id: TEST_PROPERTY_ID,
        closed_reason: 'sold',
      });
    });

    const call_body = mock_supabase._mock_invoke.mock.calls[0]![1] as { body: Record<string, unknown> };
    expect(call_body.body.closed_reason).toBe('sold');
  });

  // ── (EC-10) Shape EF — body.property_id coincide ─────────────────────────

  it('(EC-10) close_ef_body_tiene_property_id: body.property_id === el property_id proporcionado', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    await act(async () => {
      await result.current.closeProperty({
        property_id: TEST_PROPERTY_ID,
        closed_reason: TEST_CLOSED_REASON,
      });
    });

    const call_body = mock_supabase._mock_invoke.mock.calls[0]![1] as { body: Record<string, unknown> };
    expect(call_body.body.property_id).toBe(TEST_PROPERTY_ID);
  });

  // ── (EC-11) Shape EF — pause: new_status='paused', sin closed_reason ─────

  it('(EC-11) pause_ef_body_new_status_paused_sin_closed_reason: pauseProperty → body.new_status="paused" y body.closed_reason es null o ausente', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: { id: TEST_PROPERTY_ID, status: 'paused', closed_reason: null }, error: null },
    });
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    await act(async () => {
      await result.current.pauseProperty({ property_id: TEST_PROPERTY_ID });
    });

    const call_body = mock_supabase._mock_invoke.mock.calls[0]![1] as { body: Record<string, unknown> };
    expect(call_body.body.new_status).toBe('paused');
    // closed_reason debe ser null (no 'rented', no 'sold', no cualquier valor)
    // Acepta null o ausente (undefined convertible a null al serializar)
    const cr = call_body.body.closed_reason;
    expect(cr === null || cr === undefined).toBe(true);
  });

  // ── (EC-12) Shape EF — unpause: new_status='active' ─────────────────────

  it('(EC-12) unpause_ef_body_new_status_active: unpauseProperty → body.new_status === "active"', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: { id: TEST_PROPERTY_ID, status: 'active', closed_reason: null }, error: null },
    });
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    await act(async () => {
      await result.current.unpauseProperty({ property_id: TEST_PROPERTY_ID });
    });

    const call_body = mock_supabase._mock_invoke.mock.calls[0]![1] as { body: Record<string, unknown> };
    expect(call_body.body.new_status).toBe('active');
  });

  // ── (EC-13) changeStatus directo — shape EF correcto ─────────────────────

  it('(EC-13) change_status_directo_invoca_ef_shape_correcto: changeStatus({property_id, new_status:"paused"}) → EF con body.property_id y body.new_status correctos', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: { id: TEST_PROPERTY_ID, status: 'paused', closed_reason: null }, error: null },
    });
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    await act(async () => {
      await result.current.changeStatus({
        property_id: TEST_PROPERTY_ID,
        new_status: 'paused',
      });
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    const call_body = mock_supabase._mock_invoke.mock.calls[0]![1] as { body: Record<string, unknown> };
    expect(call_body.body.property_id).toBe(TEST_PROPERTY_ID);
    expect(call_body.body.new_status).toBe('paused');
  });

  // ── (EC-14) Shape delete — supabase.from('properties') ───────────────────

  it('(EC-14) delete_from_recibe_tabla_properties: deleteProperty → supabase.from llamado con "properties" (NOT "property_videos" ni otra tabla)', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    await act(async () => {
      await result.current.deleteProperty({ property_id: TEST_PROPERTY_ID });
    });

    expect(mock_supabase._mock_from).toHaveBeenCalledWith('properties');
    expect(mock_supabase._mock_from).not.toHaveBeenCalledWith('property_videos');
  });

  // ── (EC-15) Shape delete — deleted_at no nulo ────────────────────────────

  it('(EC-15) delete_update_recibe_deleted_at_no_nulo: deleteProperty → update recibe {deleted_at} con valor ISO string no nulo', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    await act(async () => {
      await result.current.deleteProperty({ property_id: TEST_PROPERTY_ID });
    });

    expect(mock_supabase._mock_update).toHaveBeenCalledTimes(1);
    const update_arg = mock_supabase._mock_update.mock.calls[0]![0] as Record<string, unknown>;
    // deleted_at debe existir, ser string, y no ser null/undefined
    expect(update_arg).toHaveProperty('deleted_at');
    expect(typeof update_arg.deleted_at).toBe('string');
    expect(update_arg.deleted_at).not.toBeNull();
    expect((update_arg.deleted_at as string).length).toBeGreaterThan(0);
  });

  // ── (EC-16) Shape delete — eq('id', property_id) correcto ────────────────

  it('(EC-16) delete_eq_recibe_id_correcto: deleteProperty → .eq("id", property_id) con el property_id proporcionado', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    await act(async () => {
      await result.current.deleteProperty({ property_id: TEST_PROPERTY_ID });
    });

    expect(mock_supabase._mock_eq).toHaveBeenCalledWith('id', TEST_PROPERTY_ID);
  });

  // ── (EC-17) Propagación error EF — no se traga ──────────────────────────

  it('(EC-17) close_ef_devuelve_error_se_propaga_ok_false: EF retorna {data:null, error:{message}} → {ok:false, error!=null}', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: {
        data: null,
        error: { message: 'INVALID_TRANSITION: active → closed requiere closed_reason' },
      },
    });
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    let action_result: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      action_result = await result.current.closeProperty({
        property_id: TEST_PROPERTY_ID,
        closed_reason: TEST_CLOSED_REASON,
      });
    });

    expect(action_result!.ok).toBe(false);
    expect(action_result!.error).not.toBeNull();
  });

  // ── (EC-18) Propagación error DB en delete — no se traga ─────────────────

  it('(EC-18) delete_db_error_se_propaga_ok_false: supabase.update retorna {error:{message}} → {ok:false, error!=null}', async () => {
    const mock_supabase = make_mock_supabase({
      delete_result: { error: { message: 'RLS policy violation: no es el dueño de la propiedad' } },
    });
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    let action_result: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      action_result = await result.current.deleteProperty({ property_id: TEST_PROPERTY_ID });
    });

    expect(action_result!.ok).toBe(false);
    expect(action_result!.error).not.toBeNull();
  });

  // ── (EC-20) isWorking=true durante acción pendiente ──────────────────────

  it('(EC-20) isWorking_true_durante_accion: isWorking=true mientras la Promise de una acción está pendiente (patrón ref inmediato)', async () => {
    // Dejamos la EF invoke colgada para observar el estado intermedio
    let resolve_invoke!: (v: { data: Record<string, unknown>; error: null }) => void;
    const pending_invoke = new Promise<{ data: Record<string, unknown>; error: null }>((res) => {
      resolve_invoke = res;
    });

    const mock_invoke_pending = jest.fn().mockReturnValue(pending_invoke);
    const mock_supabase_pending = {
      functions: { invoke: mock_invoke_pending },
      from: jest.fn(),
    };

    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase_pending as never })
    );

    // Inicia closeProperty SIN awaitar — la Promise queda pendiente
    act(() => {
      void result.current.closeProperty({
        property_id: TEST_PROPERTY_ID,
        closed_reason: TEST_CLOSED_REASON,
      });
    });

    // isWorking debe ser true mientras la Promise no resuelva
    expect(result.current.isWorking).toBe(true);

    // Limpieza: resolver la Promise para no dejar colgada
    await act(async () => {
      resolve_invoke({ data: { id: TEST_PROPERTY_ID, status: 'closed', closed_reason: 'rented' }, error: null });
    });
  });

  // ── (EC-21) isWorking=false tras éxito ───────────────────────────────────

  it('(EC-21) isWorking_false_tras_exito: isWorking=false tras acción exitosa', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    await act(async () => {
      await result.current.closeProperty({
        property_id: TEST_PROPERTY_ID,
        closed_reason: TEST_CLOSED_REASON,
      });
    });

    expect(result.current.isWorking).toBe(false);
  });

  // ── (EC-22) isWorking=false tras error ───────────────────────────────────

  it('(EC-22) isWorking_false_tras_error: isWorking=false tras error de la EF', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: null, error: { message: 'PROPERTY_NOT_FOUND' } },
    });
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    await act(async () => {
      await result.current.closeProperty({
        property_id: TEST_PROPERTY_ID,
        closed_reason: TEST_CLOSED_REASON,
      });
    });

    expect(result.current.isWorking).toBe(false);
  });

  // ── (EC-23) Señal compartida — delete exitoso emite property_deleted ────

  it('(EC-23) delete_exitoso_emite_property_deleted_una_vez_con_el_id: deleteProperty exitoso llama a emitPropertyDeleted exactamente una vez con el property_id', async () => {
    const mock_supabase = make_mock_supabase();
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    await act(async () => {
      await result.current.deleteProperty({ property_id: TEST_PROPERTY_ID });
    });

    expect(mock_emit_property_deleted).toHaveBeenCalledTimes(1);
    expect(mock_emit_property_deleted).toHaveBeenCalledWith(TEST_PROPERTY_ID);
  });

  // ── (EC-24) Señal compartida — delete con error NO emite ─────────────────

  it('(EC-24) delete_con_error_no_emite_property_deleted: si el soft-delete de Supabase devuelve error, emitPropertyDeleted NO se invoca', async () => {
    const mock_supabase = make_mock_supabase({
      delete_result: { error: { message: 'RLS policy violation: no es el dueño de la propiedad' } },
    });
    const { result } = await renderHook(() =>
      usePropertyActions({ supabase: mock_supabase as never })
    );

    await act(async () => {
      await result.current.deleteProperty({ property_id: TEST_PROPERTY_ID });
    });

    expect(mock_emit_property_deleted).not.toHaveBeenCalled();
  });

});
