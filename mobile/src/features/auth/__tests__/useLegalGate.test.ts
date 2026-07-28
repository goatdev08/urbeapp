/**
 * Tests fase RED — useLegalGate (mobile/src/features/auth/hooks/useLegalGate.ts)
 * Subtarea Taskmaster: 72.6 — Términos/privacidad versionados + re-aceptación (§5.5)
 *
 * SUT: useLegalGate() → { pending, is_loading, error, accept, refresh }
 *
 * Contrato:
 *   - Al montar, llama supabase.rpc('pending_legal_consents') (sin args — RLS/
 *     security invoker resuelve auth.uid() en el server).
 *   - pending: arreglo de { doc_type, version, terms_version_id } tal como los
 *     devuelve la RPC (fuente: supabase/tests/18_legal_gate_test.sql, subtarea 72.6).
 *   - Un error de la RPC se captura: NO debe tronar el hook (no throw sin
 *     atrapar), se expone en `error`, is_loading pasa a false, pending queda [].
 *   - accept() inserta en supabase.from('user_consents').insert([...]) UNA fila
 *     por cada doc de `pending`, con exactamente
 *     { user_id: <id del usuario de useAuth>, consent_type: doc.doc_type, terms_version_id: doc.terms_version_id }.
 *   - Tras un accept() exitoso, el hook vuelve a llamar la RPC (refresca) —
 *     se verifica por conteo de llamadas a rpc (mount + post-accept = 2).
 *
 * PATRÓN DE MOCK: @/lib/supabase/client con jest.fn() DENTRO del factory
 * (mismo patrón que features/auth/__tests__/context.test.tsx). useAuth se
 * mockea aparte (mismo patrón que features/leads/__tests__/useAgentLeads.test.ts)
 * porque accept() necesita el user.id para el INSERT (with_check de RLS
 * consents_insert exige user_id = auth.uid()).
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Estado inicial / boundary
 * - EC-1: is_loading=true y pending=[] mientras la RPC no ha resuelto (promesa
 *   que nunca resuelve dentro del test — RNTL no espera promesas ajenas al
 *   ciclo de render para completar `await renderHook(...)`, confirmado empíricamente).
 *
 * ### Happy path
 * - EC-2: sin pendientes (RPC devuelve []) → pending=[], is_loading=false, error=null.
 * - EC-3: con pendientes (RPC devuelve 2 docs) → pending los expone tal cual.
 *
 * ### Ramas de reglas no obvias / error
 * - EC-4: error de la RPC → no truena; error queda con el mensaje, pending=[].
 * - EC-5: accept() inserta una fila POR CADA doc pendiente con consent_type y
 *   terms_version_id correctos (shape exacto, no solo "fue llamado").
 * - EC-6: accept() manda el user_id de useAuth() en cada fila insertada.
 * - EC-7: tras accept() exitoso, el hook refresca (2da llamada a rpc).
 * - EC-8: si accept() falla el INSERT, NO se refresca (pending se mantiene) y
 *   el error queda expuesto.
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Importamos los mocks YA resueltos para poder redefinir implementaciones en
// cada test.
// ---------------------------------------------------------------------------
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/features/auth/context';
import type { UserProfile } from '@/features/auth/context';

// ---------------------------------------------------------------------------
// Mocks — jest.fn() DENTRO del factory (evita hoisting), mismo patrón que
// features/auth/__tests__/context.test.tsx.
// ---------------------------------------------------------------------------
jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(),
  },
}));

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Importamos el SUT DESPUÉS de los mocks
// ---------------------------------------------------------------------------
import { useLegalGate } from '../hooks/useLegalGate';
import type { PendingLegalDocument } from '../hooks/useLegalGate';

const mock_rpc = supabase.rpc as jest.MockedFunction<typeof supabase.rpc>;
const mock_from = supabase.from as jest.MockedFunction<typeof supabase.from>;
const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

// ---------------------------------------------------------------------------
// Constantes / factories
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'usuario-uuid-gate-72-6';

function make_pending_terms(overrides: Partial<PendingLegalDocument> = {}): PendingLegalDocument {
  return { doc_type: 'terms', version: '2.0', terms_version_id: 'terms-version-uuid-2-0', ...overrides };
}

function make_pending_privacy(overrides: Partial<PendingLegalDocument> = {}): PendingLegalDocument {
  return { doc_type: 'privacy', version: '1.0', terms_version_id: 'privacy-version-uuid-1-0', ...overrides };
}

/** Arma el mock de supabase.from('user_consents').insert(rows) → {error}. */
function setup_insert_mock(error: { message: string } | null = null) {
  const mock_insert = jest.fn().mockResolvedValue({ error });
  mock_from.mockReturnValue({ insert: mock_insert } as unknown as ReturnType<typeof supabase.from>);
  return { mock_insert };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();

  mock_use_auth.mockReturnValue({
    session: null,
    // El hook solo lee user.id; construir un UserProfile completo aquí sería ruido.
    user: { id: TEST_USER_ID } as unknown as UserProfile,
    isLoading: false,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
    requestPasswordReset: jest.fn(),
    updatePassword: jest.fn(),
  });

  // Default: sin pendientes.
  mock_rpc.mockResolvedValue({ data: [], error: null } as unknown as Awaited<ReturnType<typeof mock_rpc>>);
});

// ===========================================================================
// EC-1: is_loading=true / pending=[] antes de que la RPC resuelva
// ===========================================================================
describe('EC-1: estado_inicial_is_loading_true', () => {
  it('is_loading es true y pending es [] mientras pending_legal_consents no ha resuelto', async () => {
    // Promesa que NUNCA resuelve dentro del test — RNTL v14 resuelve
    // `await renderHook(...)` tras el commit inicial, sin esperar promesas
    // externas al ciclo de render (confirmado empíricamente para este repo).
    mock_rpc.mockReturnValue(new Promise(() => {}) as unknown as ReturnType<typeof mock_rpc>);

    const { result } = await renderHook(() => useLegalGate());

    // El stub tiene is_loading:false fijo — esta aserción FALLA contra el stub.
    expect(result.current.is_loading).toBe(true);
    expect(result.current.pending).toEqual([]);
  });
});

// ===========================================================================
// EC-2: sin pendientes
// ===========================================================================
describe('EC-2: sin_pendientes_pending_vacio', () => {
  it('RPC devuelve [] → pending=[], is_loading=false, error=null', async () => {
    mock_rpc.mockResolvedValue({ data: [], error: null } as unknown as Awaited<ReturnType<typeof mock_rpc>>);

    const { result } = await renderHook(() => useLegalGate());

    expect(result.current.pending).toEqual([]);
    expect(result.current.is_loading).toBe(false);
    expect(result.current.error).toBe(null);
    // La implementación real DEBE haber llamado la RPC; el stub no la llama.
    expect(mock_rpc).toHaveBeenCalledWith('pending_legal_consents');
  });
});

// ===========================================================================
// EC-3: con pendientes
// ===========================================================================
describe('EC-3: con_pendientes_los_expone', () => {
  it('RPC devuelve 2 docs → pending los expone tal cual (mismo shape)', async () => {
    const docs = [make_pending_terms(), make_pending_privacy()];
    mock_rpc.mockResolvedValue({ data: docs, error: null } as unknown as Awaited<ReturnType<typeof mock_rpc>>);

    const { result } = await renderHook(() => useLegalGate());

    // El stub siempre devuelve [] — esta aserción FALLA contra el stub.
    expect(result.current.pending).toEqual(docs);
    expect(result.current.is_loading).toBe(false);
  });
});

// ===========================================================================
// EC-4: error de la RPC no truena el hook
// ===========================================================================
describe('EC-4: error_de_la_rpc_no_truena_expone_error', () => {
  it('RPC devuelve error → no lanza, error queda con el mensaje, pending=[]', async () => {
    mock_rpc.mockResolvedValue({
      data: null,
      error: { message: 'connection timeout' },
    } as unknown as Awaited<ReturnType<typeof mock_rpc>>);

    // No debe lanzar — si el hook propaga el error sin atraparlo, renderHook rechaza.
    const { result } = await renderHook(() => useLegalGate());

    expect(result.current.error).toBe('connection timeout');
    expect(result.current.pending).toEqual([]);
    expect(result.current.is_loading).toBe(false);
  });
});

// ===========================================================================
// EC-5 / EC-6: accept() inserta una fila por doc pendiente con el shape exacto
// ===========================================================================
describe('EC-5_EC-6: accept_inserta_fila_por_doc_con_consent_type_y_version_correctos', () => {
  it('inserta {user_id, consent_type, terms_version_id} por cada doc de pending', async () => {
    const terms_doc = make_pending_terms({ terms_version_id: 'v-terms-2-0-xyz' });
    const privacy_doc = make_pending_privacy({ terms_version_id: 'v-privacy-1-0-abc' });
    mock_rpc.mockResolvedValue({
      data: [terms_doc, privacy_doc],
      error: null,
    } as unknown as Awaited<ReturnType<typeof mock_rpc>>);
    const { mock_insert } = setup_insert_mock(null);

    const { result } = await renderHook(() => useLegalGate());

    await act(async () => {
      await result.current.accept();
    });

    // El stub no llama from() en absoluto — esta aserción FALLA contra el stub.
    expect(mock_from).toHaveBeenCalledWith('user_consents');
    expect(mock_insert).toHaveBeenCalledWith([
      { user_id: TEST_USER_ID, consent_type: 'terms', terms_version_id: 'v-terms-2-0-xyz' },
      { user_id: TEST_USER_ID, consent_type: 'privacy', terms_version_id: 'v-privacy-1-0-abc' },
    ]);
  });
});

// ===========================================================================
// EC-7: tras accept() exitoso, el hook refresca
// ===========================================================================
describe('EC-7: accept_exitoso_refresca_pending', () => {
  it('tras accept(), pending_legal_consents se vuelve a llamar (mount + post-accept = 2)', async () => {
    mock_rpc
      .mockResolvedValueOnce({ data: [make_pending_terms()], error: null } as unknown as Awaited<ReturnType<typeof mock_rpc>>)
      .mockResolvedValueOnce({ data: [], error: null } as unknown as Awaited<ReturnType<typeof mock_rpc>>);
    setup_insert_mock(null);

    const { result } = await renderHook(() => useLegalGate());

    expect(result.current.pending).toHaveLength(1);

    await act(async () => {
      await result.current.accept();
    });

    // El stub nunca vuelve a llamar rpc — esta aserción FALLA contra el stub.
    expect(mock_rpc).toHaveBeenCalledTimes(2);
    expect(result.current.pending).toEqual([]);
  });
});

// ===========================================================================
// EC-8: si el INSERT de accept() falla, NO refresca y expone el error
// ===========================================================================
describe('EC-8: accept_con_error_de_insert_no_refresca_y_expone_error', () => {
  it('INSERT con error → pending NO cambia, error queda expuesto, rpc no se vuelve a llamar', async () => {
    const terms_doc = make_pending_terms();
    mock_rpc.mockResolvedValue({ data: [terms_doc], error: null } as unknown as Awaited<ReturnType<typeof mock_rpc>>);
    setup_insert_mock({ message: 'duplicate key value violates unique constraint' });

    const { result } = await renderHook(() => useLegalGate());

    await act(async () => {
      await result.current.accept();
    });

    // El stub no llama rpc ni una vez tras el mount inicial (0 llamadas) — el
    // GREEN debe llamarla exactamente 1 vez (mount) y NO una 2da (el insert falló).
    expect(mock_rpc).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toEqual([terms_doc]);
    expect(result.current.error).toBe('duplicate key value violates unique constraint');
  });
});
