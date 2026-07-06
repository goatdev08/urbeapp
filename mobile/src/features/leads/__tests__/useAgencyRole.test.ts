/**
 * Tests fase RED — useAgencyRole hook
 * Archivo SUT: mobile/src/features/leads/hooks/useAgencyRole.ts
 * Subtarea Taskmaster: 28.1 — Create useAgencyRole hook to detect agency owner status
 *
 * SUT: useAgencyRole() → { isOwner: boolean, agencyId: string | null,
 *                          memberRole: 'owner' | 'agent' | null, loading: boolean }
 *
 * Contrato (schema migración 0003 agencies_and_agents + 0008 rls_helpers):
 *   - Consulta `agency_members` — el rol de agencia vive SOLO ahí (member_role).
 *     users.role es siempre 'agent' incluso para el owner de la agencia (seed) —
 *     por eso NO se puede derivar isOwner de useAuth().user.role.
 *   - Query: from('agency_members').select('member_role, agency_id')
 *       .eq('user_id', <auth uid>).eq('status', 'active')
 *   - isOwner = memberRole === 'owner'.
 *   - Sin fila activa (data vacío/null) → isOwner=false, agencyId=null, memberRole=null.
 *   - Error de Supabase → estado seguro (isOwner=false, agencyId=null, memberRole=null),
 *     sin crash.
 *   - Estado inicial: loading=true antes de resolver.
 *
 * PATRÓN DE MOCK (idéntico a useAgentLeads.test.ts):
 *   - `@/lib/supabase/client`: mock de módulo con getter sobre objeto mutable
 *     `mock_supabase_holder`.
 *   - `@/features/auth/context` (useAuth): provee el usuario autenticado (uid).
 *   - Cadena de query: from('agency_members').select(...).eq('user_id', uid)
 *       .eq('status', 'active') → Promise<{data, error}>.
 *
 * EDGE CASES CUBIERTOS (6 casos):
 *
 * ### Happy path
 * - (EC-1) usuario_owner_isOwner_true_con_agencyId
 *
 * ### Edge cases del PRD / schema (migración 0003 agency_members)
 * - (EC-2) usuario_agent_isOwner_false_memberRole_agent
 * - (EC-3) sin_fila_activa_en_agency_members_estado_nulo
 *
 * ### Ramas de reglas no obvias
 * - (EC-6) filtra_status_active_en_la_query
 *
 * ### Boundary / error
 * - (EC-4) error_de_query_expone_estado_seguro_sin_crash
 * - (EC-5) estado_loading_inicial_true
 */

import { renderHook } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { useAuth } from '@/features/auth/context';
import { useAgencyRole } from '../hooks/useAgencyRole';

// ---------------------------------------------------------------------------
// Mock de useAuth — declara ANTES de cualquier import del SUT.
// El usuario autenticado tiene id TEST_USER_ID.
// ---------------------------------------------------------------------------

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock del cliente Supabase — patrón mock_supabase_holder con getter
// (idéntico a useAgentLeads.test.ts).
//
// Cadena de query esperada:
//   supabase.from('agency_members')
//     .select('member_role, agency_id')
//     .eq('user_id', TEST_USER_ID)   ← filtra por el usuario autenticado
//     .eq('status', 'active')        ← EC-6: solo membresías activas
// ---------------------------------------------------------------------------

/** Holder mutable — beforeEach lo reemplaza con el mock apropiado por test. */
const mock_supabase_holder: { client: ReturnType<typeof make_supabase_mock_agency_role> } = {
  client: null as never, // se sobrescribe en beforeEach antes de cada test
};

jest.mock('@/lib/supabase/client', () => ({
  // Getter: cada acceso a `supabase` en el SUT resuelve el valor actual.
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'usuario-uuid-agency-role-28';
const TEST_AGENCY_ID = 'agencia-uuid-28-membership';

// ---------------------------------------------------------------------------
// Helper — cast tipado de mock
// ---------------------------------------------------------------------------

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

// ---------------------------------------------------------------------------
// Datos de prueba — shape de la respuesta raw de agency_members
// ---------------------------------------------------------------------------

interface RawAgencyMemberRow {
  member_role: 'owner' | 'agent';
  agency_id: string;
}

const RAW_MEMBER_OWNER: RawAgencyMemberRow = {
  member_role: 'owner',
  agency_id: TEST_AGENCY_ID,
};

const RAW_MEMBER_AGENT: RawAgencyMemberRow = {
  member_role: 'agent',
  agency_id: TEST_AGENCY_ID,
};

// ---------------------------------------------------------------------------
// Factory del mock de Supabase
//
// Cadena: from('agency_members').select(...).eq('user_id', uid).eq('status', 'active')
// La cadena resuelve directamente a { data, error } (PostgREST/supabase-js v2).
// ---------------------------------------------------------------------------

function make_supabase_mock_agency_role(
  opts: {
    query_result?: { data: RawAgencyMemberRow[] | null; error: { message: string } | null };
  } = {}
) {
  const { query_result = { data: [RAW_MEMBER_OWNER], error: null } } = opts;

  // Extremo final de la cadena: segundo .eq(...) → Promise<{ data, error }>
  const mock_eq_status = jest.fn().mockResolvedValue(query_result);
  // .eq('user_id', uid) → retorna { eq: mock_eq_status }
  const mock_eq_user = jest.fn().mockReturnValue({ eq: mock_eq_status });
  // .select(...) → retorna { eq: mock_eq_user }
  const mock_select = jest.fn().mockReturnValue({ eq: mock_eq_user });
  // from('agency_members') → retorna { select }
  const mock_from = jest.fn().mockReturnValue({ select: mock_select });

  return {
    from: mock_from,
    // Expuestos para aserciones directas
    _mock_from: mock_from,
    _mock_select: mock_select,
    _mock_eq_user: mock_eq_user,
    _mock_eq_status: mock_eq_status,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mock_supabase_holder.client = make_supabase_mock_agency_role();
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

describe('useAgencyRole', () => {
  // ── (EC-1) Happy path — usuario owner ────────────────────────────────────

  it('(EC-1) usuario_owner_isOwner_true_con_agencyId: member_role="owner" → isOwner=true, memberRole="owner", agencyId poblado', async () => {
    mock_supabase_holder.client = make_supabase_mock_agency_role({
      query_result: { data: [RAW_MEMBER_OWNER], error: null },
    });

    const { result } = await renderHook(() => useAgencyRole());

    expect(result.current.isOwner).toBe(true);
    expect(result.current.memberRole).toBe('owner');
    expect(result.current.agencyId).toBe(TEST_AGENCY_ID);
    expect(result.current.loading).toBe(false);
  });

  // ── (EC-2) Usuario agent (no owner) ──────────────────────────────────────

  it('(EC-2) usuario_agent_isOwner_false_memberRole_agent: member_role="agent" → isOwner=false, memberRole="agent", agencyId poblado', async () => {
    mock_supabase_holder.client = make_supabase_mock_agency_role({
      query_result: { data: [RAW_MEMBER_AGENT], error: null },
    });

    const { result } = await renderHook(() => useAgencyRole());

    expect(result.current.isOwner).toBe(false);
    expect(result.current.memberRole).toBe('agent');
    expect(result.current.agencyId).toBe(TEST_AGENCY_ID);
  });

  // ── (EC-3) Sin fila activa en agency_members ─────────────────────────────
  //
  // Regla: un usuario sin membresía activa (o recién removido) no debe crashear.
  // El hook debe devolver estado nulo, no lanzar.

  it('(EC-3) sin_fila_activa_en_agency_members_estado_nulo: query devuelve data:[] → isOwner=false, agencyId=null, memberRole=null', async () => {
    mock_supabase_holder.client = make_supabase_mock_agency_role({
      query_result: { data: [], error: null },
    });

    const { result } = await renderHook(() => useAgencyRole());

    expect(result.current.isOwner).toBe(false);
    expect(result.current.agencyId).toBeNull();
    expect(result.current.memberRole).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  // ── (EC-4) Error de la query ──────────────────────────────────────────────
  //
  // Si Supabase retorna error (red, RLS, etc.), el hook debe caer a un estado
  // seguro (isOwner=false) y NO crashear ni dejar isOwner en un valor previo.

  it('(EC-4) error_de_query_expone_estado_seguro_sin_crash: query devuelve {error:{message}} → isOwner=false, agencyId=null, memberRole=null, no crashea', async () => {
    mock_supabase_holder.client = make_supabase_mock_agency_role({
      query_result: {
        data: null,
        error: { message: 'RLS policy violation: no tienes acceso a agency_members' },
      },
    });

    const { result } = await renderHook(() => useAgencyRole());

    expect(result.current.isOwner).toBe(false);
    expect(result.current.agencyId).toBeNull();
    expect(result.current.memberRole).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  // ── (EC-5) Estado loading inicial ────────────────────────────────────────
  //
  // Antes de que el fetch async resuelva, el hook debe exponer loading=true.
  // Patrón: mock con promesa pendiente (nunca resuelve en este test).
  // act() de React 18 no espera promesas pendientes iniciadas dentro de useEffect
  // → await renderHook completa sin que la promesa resuelva → loading sigue true.
  //
  // RED: stub retorna loading=false fijo sin llamar supabase → falla la aserción.
  // GREEN: hook inicializa useState({loading: true}) → mantiene true con fetch pendiente.

  it('(EC-5) estado_loading_inicial_true: loading=true mientras el fetch async está pendiente (promesa pendiente, act no espera)', async () => {
    // Promesa que nunca resuelve — simula fetch en progreso.
    const pending_query = new Promise<{ data: RawAgencyMemberRow[]; error: null }>(() => {});

    mock_supabase_holder.client = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue(pending_query),
          }),
        }),
      }),
      // Propiedades de aserción para compatibilidad con el tipo del holder
      _mock_from: jest.fn(),
      _mock_select: jest.fn(),
      _mock_eq_user: jest.fn(),
      _mock_eq_status: jest.fn(),
    } as unknown as ReturnType<typeof make_supabase_mock_agency_role>;

    const { result } = await renderHook(() => useAgencyRole());

    expect(result.current.loading).toBe(true);
  });

  // ── (EC-6) Filtra status='active' ────────────────────────────────────────
  //
  // Regla del schema (migración 0003): una membresía puede estar 'removed'.
  // La query DEBE filtrar status='active' para no considerar membresías dadas
  // de baja como fuente del rol.

  it('(EC-6) filtra_status_active_en_la_query: la query llama .eq("status", "active") tras filtrar por user_id', async () => {
    await renderHook(() => useAgencyRole());

    expect(mock_supabase_holder.client._mock_from).toHaveBeenCalledWith('agency_members');
    expect(mock_supabase_holder.client._mock_eq_user).toHaveBeenCalledWith(
      'user_id',
      TEST_USER_ID
    );
    expect(mock_supabase_holder.client._mock_eq_status).toHaveBeenCalledWith('status', 'active');
  });
});
