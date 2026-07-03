/**
 * Tests fase RED — useUpdateLeadNote hook
 * Archivo SUT: mobile/src/features/leads/hooks/useUpdateLeadNote.ts
 * Subtarea Taskmaster: 29.5 — hook de mutación de internal_notes de lead
 *
 * SUT: useUpdateLeadNote(deps?) → { update_note, is_updating, error }
 *
 * Contrato (mirror de useUpdateLeadStatus, responsabilidad única: notas):
 *   - update_note(lead_id, note) invoca EF 'update-lead-note' vía
 *     supabase.functions.invoke('update-lead-note', { body: { lead_id, note } }).
 *   - note es REQUERIDO pero "" es válido (limpia la nota → internal_notes=null en DB).
 *   - Llama onSuccess (si fue inyectado) solo en caso de éxito.
 *   - is_updating: true de forma SÍNCRONA al disparar (patrón ref+force_update),
 *     false en reposo.
 *   - error: null en éxito; string con descripción en fallo (EF o red).
 *   - Doble-submit: una segunda llamada mientras la primera está en curso se
 *     bloquea (no dispara una segunda invocación de la EF).
 *
 * PATRÓN DE MOCK (idéntico a useUpdateLeadStatus.test.ts):
 *   - supabase inyectado como dep: useUpdateLeadNote({ supabase: mock, onSuccess? })
 *   - useAuth() mockeado via jest.mock (mantiene el patrón del repo; el hook
 *     gemelo llama useAuth() para preservar el orden de hooks entre renders)
 *
 * CÓDIGOS DE ERROR DE LA EF (types.ts de update-lead-note):
 *   LEAD_NOT_FOUND | UNAUTHORIZED_AGENT | DB_ERROR
 *
 * EDGE CASES CUBIERTOS (13 casos, EC-1..EC-13):
 *
 * ### Happy path
 * - (EC-1) invoke_llamado_con_body_correcto_y_nombre_update_lead_note
 * - (EC-2) exito_llama_on_success
 * - (EC-3) exito_is_updating_false_al_terminar
 * - (EC-4) exito_error_es_null
 *
 * ### Errores de la EF (no se tragan)
 * - (EC-5) error_ef_is_updating_false_error_seteado
 * - (EC-6) error_ef_on_success_no_llamado
 *
 * ### Nota vacía (regla de negocio: "" limpia la nota, es válido)
 * - (EC-7) nota_vacia_permitida_invoca_ef_con_note_vacio
 *
 * ### Errores de red
 * - (EC-8) error_red_invoke_lanza_manejado_error_seteado_no_crashea
 *
 * ### Estado is_updating (patrón ref síncrono)
 * - (EC-9) is_updating_true_de_forma_sincrona_tras_invocar
 * - (EC-10) doble_submit_segunda_llamada_concurrente_se_bloquea
 *
 * ### DI y robustez
 * - (EC-11) funciona_sin_callback_on_success_no_crashea
 * - (EC-12) di_cliente_supabase_inyectado_es_usado_no_singleton
 * - (EC-13) mensaje_de_error_se_expone_correctamente_en_error
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { useAuth } from '@/features/auth/context';
import { useUpdateLeadNote } from '../hooks/useUpdateLeadNote';

// ---------------------------------------------------------------------------
// Mock de useAuth — declara ANTES de cualquier import del SUT.
// El agente autenticado tiene id TEST_AGENT_ID (patrón idéntico al gemelo:
// el hook real llamará useAuth() para preservar el orden de hooks).
// ---------------------------------------------------------------------------

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_AGENT_ID = 'agente-uuid-lead-note-29';
const TEST_LEAD_ID = 'lead-uuid-update-note-001';

// ---------------------------------------------------------------------------
// Helper — cast tipado de mock
// ---------------------------------------------------------------------------

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

// ---------------------------------------------------------------------------
// Factory del mock de supabase — solo functions.invoke
//
// La EF 'update-lead-note' se invoca vía:
//   supabase.functions.invoke('update-lead-note', { body: { lead_id, note } })
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
      data: { id: TEST_LEAD_ID, internal_notes: 'nota de prueba' },
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

    // La invocación real de la EF es la prueba de que hubo trabajo, no un stub estático
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

    // La invocación real de la EF es la prueba de que hubo trabajo, no un stub estático
    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  // ── (EC-5) Error EF — is_updating false + error seteado ──────────────────

  it('(EC-5) error_ef_is_updating_false_error_seteado: EF devuelve error → is_updating=false y error!=null', async () => {
    const EF_ERROR_MSG = 'UNAUTHORIZED_AGENT: el agente no es dueño del lead';
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: null, error: { message: EF_ERROR_MSG } },
    });
    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, 'nota');
    });

    expect(result.current.is_updating).toBe(false);
    expect(result.current.error).not.toBeNull();
  });

  // ── (EC-6) Error EF — onSuccess NO llamado ───────────────────────────────

  it('(EC-6) error_ef_on_success_no_llamado: EF devuelve error → onSuccess NO es invocado', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: {
        data: null,
        error: { message: 'LEAD_NOT_FOUND: lead no existe o no pertenece al agente' },
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

  // ── (EC-8) Error de red — invoke rechaza (network/timeout) ───────────────

  it('(EC-8) error_red_invoke_lanza_manejado_error_seteado_no_crashea: invoke rechazado → no crashea, error!=null, is_updating=false', async () => {
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
    expect(result.current.error).not.toBeNull();
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

    // Estado inicial antes de cualquier acción
    expect(result.current.is_updating).toBe(false);

    // Dispara la acción SIN awaitar — la Promise queda pendiente
    act(() => {
      void result.current.update_note(TEST_LEAD_ID, 'nota en vuelo');
    });

    // is_updating debe ser true de forma SÍNCRONA, sin esperar la resolución
    expect(result.current.is_updating).toBe(true);

    // Limpieza: resolver para no dejar Promise pendiente colgada
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

    // Primera llamada — queda en curso (Promise pendiente)
    act(() => {
      void result.current.update_note(TEST_LEAD_ID, 'primera nota');
    });
    expect(result.current.is_updating).toBe(true);

    // Segunda llamada concurrente — debe bloquearse (no debe invocar la EF de nuevo)
    act(() => {
      void result.current.update_note(TEST_LEAD_ID, 'segunda nota concurrente');
    });

    expect(mock_invoke).toHaveBeenCalledTimes(1);

    // Limpieza: resolver para no dejar Promise pendiente colgada
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

    // La invocación real de la EF es la prueba de que hubo trabajo, no un stub estático
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

    // Solo el cliente inyectado (A) debe haber sido invocado
    expect(mock_supabase_a._mock_invoke).toHaveBeenCalledTimes(1);
    expect(mock_supabase_b._mock_invoke).not.toHaveBeenCalled();
  });

  // ── (EC-13) Mensaje de error se expone correctamente en error ───────────

  it('(EC-13) mensaje_de_error_se_expone_correctamente_en_error: el mensaje de la EF queda accesible textualmente en error', async () => {
    const EF_ERROR_MSG = 'DB_ERROR: no se pudo actualizar internal_notes';
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: null, error: { message: EF_ERROR_MSG } },
    });
    const { result } = await renderHook(() =>
      useUpdateLeadNote({ supabase: mock_supabase as never }),
    );

    await act(async () => {
      await result.current.update_note(TEST_LEAD_ID, 'nota que falla');
    });

    expect(result.current.error).toContain('DB_ERROR');
  });

});
