/**
 * Tests fase RED — useAgencyRole hook
 * Archivo SUT: mobile/src/features/leads/hooks/useAgencyRole.ts
 * Subtarea Taskmaster: 28.1 (original) + 75.5 (Ola 1 #71 — 4 roles, admin ve el equipo)
 *
 * SUT: useAgencyRole() → { isOwner, isAdmin?, canViewTeam?, agencyId,
 *                          memberRole: 'owner'|'admin'|'agent'|'viewer'|null,
 *                          loading, error? }
 *
 * Contrato (schema migración 0003 agencies_and_agents + 0008 rls_helpers +
 * 20260805000002 agency_member_role_values — Ola 1 #71):
 *   - Consulta `agency_members` — el rol de agencia vive SOLO ahí (member_role).
 *     users.role es siempre 'agent' incluso para el owner de la agencia (seed) —
 *     por eso NO se puede derivar isOwner de useAuth().user.role.
 *   - Query: from('agency_members').select('member_role, agency_id')
 *       .eq('user_id', <auth uid>).eq('status', 'active')
 *   - isOwner = memberRole === 'owner'; isAdmin = memberRole === 'admin' (75.5);
 *     canViewTeam = isOwner || isAdmin (75.5 — el admin ahora también ve el
 *     pipeline del equipo, migración 20260807000005).
 *   - 'agent' y 'viewer' → isOwner=false, isAdmin=false, canViewTeam=false.
 *   - Sin fila activa (data vacío/null) → isOwner=false, isAdmin=false,
 *     canViewTeam=false, agencyId=null, memberRole=null.
 *   - Un miembro 'suspended' NO matchea el filtro .eq('status','active') de la
 *     query — la fila ni siquiera vuelve; mismo resultado que "sin fila activa".
 *   - Error de Supabase → estado seguro (memberRole=null, canViewTeam=false),
 *     sin crash, PERO distinguible de "sin membresía real" vía `error=true`
 *     (defecto conocido — ver mobile/src/features/agency/api.ts
 *     fetch_own_membership, que hoy colapsa error y "sin membresía" al mismo
 *     `null`; ProfileScreen.tsx:83-87 documenta el mismo patrón).
 *   - Estado inicial: loading=true antes de resolver.
 *
 * PATRÓN DE MOCK (idéntico a useAgentLeads.test.ts):
 *   - `@/lib/supabase/client`: mock de módulo con getter sobre objeto mutable
 *     `mock_supabase_holder`.
 *   - `@/features/auth/context` (useAuth): provee el usuario autenticado (uid).
 *   - Cadena de query: from('agency_members').select(...).eq('user_id', uid)
 *       .eq('status', 'active') → Promise<{data, error}>.
 *
 * EDGE CASES CUBIERTOS:
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
 *
 * ### 75.5 — El admin de inmobiliaria ve el pipeline del equipo (4 roles)
 * - (EC-7) usuario_admin_isAdmin_true_canViewTeam_true
 * - (EC-8) usuario_agent_no_ve_equipo_canViewTeam_false
 * - (EC-9) usuario_viewer_no_ve_equipo_canViewTeam_false
 * - (EC-10) miembro_suspended_no_obtiene_visibilidad_de_equipo
 * - (EC-11) error_de_red_no_se_lee_como_sin_membresia_distingue_de_vacio
 * - (EC-12) sin_membresia_real_error_es_false_no_true
 *
 * ### Corrección code review (rama tarea/75) — FIX5: refetch tras error
 * - (EC-13) refetch_reintenta_la_query_y_limpia_el_error
 */

import { renderHook, act } from '@testing-library/react-native';

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
  member_role: 'owner' | 'admin' | 'agent' | 'viewer';
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

const RAW_MEMBER_ADMIN: RawAgencyMemberRow = {
  member_role: 'admin',
  agency_id: TEST_AGENCY_ID,
};

const RAW_MEMBER_VIEWER: RawAgencyMemberRow = {
  member_role: 'viewer',
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
    signOut: jest.fn(),
    requestPasswordReset: jest.fn(),
    updatePassword: jest.fn(),
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

  // ═══════════════════════════════════════════════════════════════════════
  // 75.5 — El admin de inmobiliaria ve el pipeline del equipo (4 roles)
  // ═══════════════════════════════════════════════════════════════════════

  // ── (EC-7) Usuario admin — isAdmin=true, canViewTeam=true ────────────────

  it('(EC-7) usuario_admin_isAdmin_true_canViewTeam_true: member_role="admin" → isAdmin=true, canViewTeam=true, isOwner=false, memberRole="admin"', async () => {
    mock_supabase_holder.client = make_supabase_mock_agency_role({
      query_result: { data: [RAW_MEMBER_ADMIN], error: null },
    });

    const { result } = await renderHook(() => useAgencyRole());

    expect(result.current.memberRole).toBe('admin');
    expect(result.current.isOwner).toBe(false);
    expect(result.current.isAdmin).toBe(true);
    expect(result.current.canViewTeam).toBe(true);
    expect(result.current.agencyId).toBe(TEST_AGENCY_ID);
  });

  // ── (EC-8) Usuario agent — NO ve el equipo ────────────────────────────────

  it('(EC-8) usuario_agent_no_ve_equipo_canViewTeam_false: member_role="agent" → isAdmin=false, canViewTeam=false', async () => {
    mock_supabase_holder.client = make_supabase_mock_agency_role({
      query_result: { data: [RAW_MEMBER_AGENT], error: null },
    });

    const { result } = await renderHook(() => useAgencyRole());

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.canViewTeam).toBe(false);
  });

  // ── (EC-9) Usuario viewer — NO ve el equipo (solo-lectura de su propio rol) ──

  it('(EC-9) usuario_viewer_no_ve_equipo_canViewTeam_false: member_role="viewer" → isOwner=false, isAdmin=false, canViewTeam=false, memberRole="viewer"', async () => {
    mock_supabase_holder.client = make_supabase_mock_agency_role({
      query_result: { data: [RAW_MEMBER_VIEWER], error: null },
    });

    const { result } = await renderHook(() => useAgencyRole());

    expect(result.current.memberRole).toBe('viewer');
    expect(result.current.isOwner).toBe(false);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.canViewTeam).toBe(false);
  });

  // ── (EC-10) Miembro suspended — sin visibilidad de equipo ─────────────────
  //
  // La query filtra .eq('status','active') server-side: un admin suspendido
  // NUNCA vuelve en `data` (mismo resultado observable que "sin fila activa",
  // EC-3) — documentado explícitamente aquí porque es la ruta por la que un
  // admin dado de baja pierde canViewTeam, no un chequeo defensivo en el hook.

  it('(EC-10) miembro_suspended_no_obtiene_visibilidad_de_equipo: admin suspendido no matchea el filtro status=active → data=[] → canViewTeam=false, memberRole=null', async () => {
    // Simula lo que devuelve Postgres cuando el filtro .eq('status','active')
    // excluye la fila del admin suspendido: la query resuelve con data=[].
    mock_supabase_holder.client = make_supabase_mock_agency_role({
      query_result: { data: [], error: null },
    });

    const { result } = await renderHook(() => useAgencyRole());

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.canViewTeam).toBe(false);
    expect(result.current.memberRole).toBeNull();
  });

  // ── (EC-11) Error de red — NO se lee como "sin membresía" ─────────────────
  //
  // Defecto conocido (agency/api.ts fetch_own_membership, ProfileScreen.tsx:83-87):
  // hoy un error de query colapsa al mismo estado que "sin fila activa". El
  // hook debe distinguirlos vía `error` — "no pude saberlo" ≠ "no hay membresía".

  it('(EC-11) error_de_red_no_se_lee_como_sin_membresia_distingue_de_vacio: la query falla → error=true (memberRole sigue null, pero DISTINGUIBLE de una consulta exitosa vacía)', async () => {
    mock_supabase_holder.client = make_supabase_mock_agency_role({
      query_result: {
        data: null,
        error: { message: 'RLS policy violation: no tienes acceso a agency_members' },
      },
    });

    const { result } = await renderHook(() => useAgencyRole());

    expect(result.current.memberRole).toBeNull();
    expect(result.current.canViewTeam).toBe(false);
    expect(result.current.error).toBe(true);
  });

  // ── (EC-12) Sin membresía REAL (consulta exitosa, vacía) — error=false ────

  it('(EC-12) sin_membresia_real_error_es_false_no_true: consulta exitosa sin fila activa (data=[]) → error=false, NO true (distingue del caso EC-11)', async () => {
    mock_supabase_holder.client = make_supabase_mock_agency_role({
      query_result: { data: [], error: null },
    });

    const { result } = await renderHook(() => useAgencyRole());

    expect(result.current.memberRole).toBeNull();
    expect(result.current.error).toBe(false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Corrección code review (rama tarea/75) — FIX5: refetch tras error
  // ═══════════════════════════════════════════════════════════════════════

  // ── (EC-13) refetch() reintenta la query ──────────────────────────────────

  it('(EC-13) refetch_reintenta_la_query_y_limpia_el_error: tras un error, refetch() vuelve a consultar agency_members; si la segunda consulta tiene éxito, error pasa a false', async () => {
    mock_supabase_holder.client = make_supabase_mock_agency_role({
      query_result: {
        data: null,
        error: { message: 'RLS policy violation: no tienes acceso a agency_members' },
      },
    });

    const { result } = await renderHook(() => useAgencyRole());

    expect(result.current.error).toBe(true);
    expect(result.current.isOwner).toBe(false);

    // La query fue reemplazada para simular que el reintento sí resuelve.
    mock_supabase_holder.client = make_supabase_mock_agency_role({
      query_result: { data: [RAW_MEMBER_OWNER], error: null },
    });

    await act(async () => {
      result.current.refetch();
    });

    expect(mock_supabase_holder.client._mock_from).toHaveBeenCalledWith('agency_members');
    expect(result.current.error).toBe(false);
    expect(result.current.isOwner).toBe(true);
    expect(result.current.agencyId).toBe(TEST_AGENCY_ID);
  });
});
