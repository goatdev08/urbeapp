/**
 * Tests fase RED — useAgencyAgents hook
 * Archivo SUT: mobile/src/features/leads/hooks/useAgencyAgents.ts
 * Subtarea Taskmaster: 28.2 — Create useAgencyAgents hook to fetch agent list for owners
 *
 * SUT: useAgencyAgents(agencyId: string | null, enabled: boolean)
 *        → { agents: Agent[], loading: boolean, error: string | null }
 *
 * Contrato (schema migración 0003 agencies_and_agents + 0015 user_preferences):
 *   - ⚠️ CORRECCIÓN: users NO tiene full_name/profile_photo_url — viven en
 *     `user_preferences` (migración 0015, fuera de tipos generados). La query
 *     parte de `agency_members` con embed encadenado hacia users → user_preferences,
 *     igual que useAgentLeads/useAgentProfile (cast `as never`).
 *   - Solo ejecuta la query si enabled===true && agencyId!=null (enabled = isOwner,
 *     ver useAgencyRole de la subtarea 28.1). Si no, agents=[] sin llamar supabase.
 *   - Query: from('agency_members')
 *       .select('user_id, users(id, user_preferences(full_name, profile_photo_url))' as never)
 *       .eq('agency_id', agencyId).eq('member_role', 'agent').eq('status', 'active')
 *   - El owner NO se incluye (filtro member_role='agent' lo excluye).
 *   - Transformación: id = users.id (o user_id), full_name/profile_photo_url =
 *     user_preferences[0]?.… ?? null (array vacío → null, sin crash).
 *   - Orden client-side por full_name (locale), nulls al final.
 *   - Error de query → agents=[], error poblado, sin crash.
 *
 * PATRÓN DE MOCK (idéntico a useAgencyRole.test.ts / useAgentLeads.test.ts):
 *   - `@/lib/supabase/client`: mock de módulo con getter sobre objeto mutable
 *     `mock_supabase_holder`.
 *   - Cadena de query: from('agency_members').select(...)
 *       .eq('agency_id', agencyId).eq('member_role', 'agent').eq('status', 'active')
 *       → Promise<{data, error}>.
 *
 * EDGE CASES CUBIERTOS (7 casos):
 *
 * ### Happy path
 * - (EC-1) owner_agencyId_valido_enabled_true_devuelve_agentes_mapeados
 *
 * ### Edge cases del PRD / schema (migración 0003 + 0015)
 * - (EC-2) enabled_false_no_ejecuta_query_agents_vacio
 * - (EC-3) agencyId_null_no_ejecuta_query_agents_vacio
 * - (EC-4) agente_sin_user_preferences_full_name_photo_null_sin_crash
 *
 * ### Ramas de reglas no obvias
 * - (EC-6) ordena_alfabeticamente_por_full_name_nulls_al_final
 * - (EC-7) query_filtra_member_role_agent_y_status_active
 *
 * ### Boundary / error
 * - (EC-5) error_de_query_expone_estado_agents_vacio_sin_crash
 */

import { renderHook } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mock del cliente Supabase — patrón mock_supabase_holder con getter
// (idéntico a useAgencyRole.test.ts / useAgentLeads.test.ts).
//
// Cadena de query esperada:
//   supabase.from('agency_members')
//     .select('user_id, users(id, user_preferences(full_name, profile_photo_url))' as never)
//     .eq('agency_id', agencyId)     ← filtra por la agencia del owner
//     .eq('member_role', 'agent')    ← EC-7: excluye al owner
//     .eq('status', 'active')        ← EC-7: solo membresías activas
// ---------------------------------------------------------------------------

/** Holder mutable — beforeEach lo reemplaza con el mock apropiado por test. */
const mock_supabase_holder: { client: ReturnType<typeof make_supabase_mock_agency_agents> } = {
  client: null as never, // se sobrescribe en beforeEach antes de cada test
};

jest.mock('@/lib/supabase/client', () => ({
  // Getter: cada acceso a `supabase` en el SUT resuelve el valor actual.
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { useAgencyAgents } from '../hooks/useAgencyAgents';
import type { Agent } from '../types';

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_AGENCY_ID = 'agencia-uuid-28-agents-list';
const AGENT_CARLOS_ID = 'agente-uuid-carlos-zamudio';
const AGENT_BEATRIZ_ID = 'agente-uuid-beatriz-aguilar';

// ---------------------------------------------------------------------------
// Datos de prueba — shape raw de la respuesta embedded de agency_members
// ---------------------------------------------------------------------------

interface RawUserPreference {
  full_name: string | null;
  profile_photo_url: string | null;
}

interface RawUser {
  id: string;
  user_preferences: RawUserPreference[];
}

interface RawAgencyMemberRow {
  user_id: string;
  users: RawUser | null;
}

const RAW_AGENT_CARLOS: RawAgencyMemberRow = {
  user_id: AGENT_CARLOS_ID,
  users: {
    id: AGENT_CARLOS_ID,
    user_preferences: [
      {
        full_name: 'Carlos Zamudio',
        profile_photo_url: 'https://storage.supabase.co/profile-photos/carlos.jpg',
      },
    ],
  },
};

const RAW_AGENT_BEATRIZ: RawAgencyMemberRow = {
  user_id: AGENT_BEATRIZ_ID,
  users: {
    id: AGENT_BEATRIZ_ID,
    user_preferences: [
      {
        full_name: 'Beatriz Aguilar',
        profile_photo_url: 'https://storage.supabase.co/profile-photos/beatriz.jpg',
      },
    ],
  },
};

/** Agente sin fila en user_preferences (sin onboarding) — array vacío. */
const RAW_AGENT_SIN_PREFS: RawAgencyMemberRow = {
  user_id: 'agente-uuid-sin-onboarding',
  users: {
    id: 'agente-uuid-sin-onboarding',
    user_preferences: [],
  },
};

/** Agente con full_name null explícito (edge de orden — debe ir al final). */
const RAW_AGENT_SIN_NOMBRE: RawAgencyMemberRow = {
  user_id: 'agente-uuid-sin-nombre',
  users: {
    id: 'agente-uuid-sin-nombre',
    user_preferences: [{ full_name: null, profile_photo_url: null }],
  },
};

// ---------------------------------------------------------------------------
// Factory del mock de Supabase
//
// Cadena: from('agency_members').select(...)
//   .eq('agency_id', agencyId).eq('member_role', 'agent').eq('status', 'active')
// La cadena resuelve directamente a { data, error } (PostgREST/supabase-js v2).
// ---------------------------------------------------------------------------

function make_supabase_mock_agency_agents(
  opts: {
    query_result?: { data: RawAgencyMemberRow[] | null; error: { message: string } | null };
  } = {}
) {
  const { query_result = { data: [RAW_AGENT_CARLOS], error: null } } = opts;

  // Extremo final de la cadena: .eq('status', 'active') → Promise<{ data, error }>
  const mock_eq_status = jest.fn().mockResolvedValue(query_result);
  // .eq('member_role', 'agent') → { eq: mock_eq_status }
  const mock_eq_role = jest.fn().mockReturnValue({ eq: mock_eq_status });
  // .eq('agency_id', agencyId) → { eq: mock_eq_role }
  const mock_eq_agency = jest.fn().mockReturnValue({ eq: mock_eq_role });
  // .select(...) → { eq: mock_eq_agency }
  const mock_select = jest.fn().mockReturnValue({ eq: mock_eq_agency });
  // from('agency_members') → { select }
  const mock_from = jest.fn().mockReturnValue({ select: mock_select });

  return {
    from: mock_from,
    // Expuestos para aserciones directas
    _mock_from: mock_from,
    _mock_select: mock_select,
    _mock_eq_agency: mock_eq_agency,
    _mock_eq_role: mock_eq_role,
    _mock_eq_status: mock_eq_status,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mock_supabase_holder.client = make_supabase_mock_agency_agents();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAgencyAgents', () => {
  // ── (EC-1) Happy path — owner con agencyId válido y enabled=true ─────────

  it('(EC-1) owner_agencyId_valido_enabled_true_devuelve_agentes_mapeados: agency_members con embed users/user_preferences → agents con id/full_name/profile_photo_url correctos', async () => {
    mock_supabase_holder.client = make_supabase_mock_agency_agents({
      query_result: { data: [RAW_AGENT_CARLOS], error: null },
    });

    const { result } = await renderHook(() => useAgencyAgents(TEST_AGENCY_ID, true));

    expect(result.current.agents).toHaveLength(1);

    const agent = result.current.agents[0] as Agent;

    expect(agent.id).toBe(AGENT_CARLOS_ID);
    expect(agent.full_name).toBe('Carlos Zamudio');
    expect(agent.profile_photo_url).toBe(
      'https://storage.supabase.co/profile-photos/carlos.jpg'
    );

    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  // ── (EC-2) enabled=false (usuario no owner) ──────────────────────────────
  //
  // Regla: para no-owners no debe ejecutarse ninguna query (evita costo/RLS
  // innecesario). agents debe quedar vacío y loading debe resolver a false.

  it('(EC-2) enabled_false_no_ejecuta_query_agents_vacio: enabled=false → supabase.from NO se llama, agents=[], loading=false', async () => {
    const { result } = await renderHook(() => useAgencyAgents(TEST_AGENCY_ID, false));

    expect(mock_supabase_holder.client._mock_from).not.toHaveBeenCalled();
    expect(result.current.agents).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  // ── (EC-3) agencyId=null ──────────────────────────────────────────────────
  //
  // Regla: sin agencyId (aún no resuelto por useAgencyRole) no hay nada que
  // consultar — no debe ejecutarse ninguna query aunque enabled=true.

  it('(EC-3) agencyId_null_no_ejecuta_query_agents_vacio: agencyId=null y enabled=true → supabase.from NO se llama, agents=[]', async () => {
    const { result } = await renderHook(() => useAgencyAgents(null, true));

    expect(mock_supabase_holder.client._mock_from).not.toHaveBeenCalled();
    expect(result.current.agents).toEqual([]);
  });

  // ── (EC-4) Agente sin user_preferences ───────────────────────────────────
  //
  // Regla: un agente puede no tener fila en user_preferences (sin onboarding).
  // full_name y profile_photo_url deben mapear a null, sin crash.

  it('(EC-4) agente_sin_user_preferences_full_name_photo_null_sin_crash: users.user_preferences:[] → full_name=null y profile_photo_url=null, sin crash', async () => {
    mock_supabase_holder.client = make_supabase_mock_agency_agents({
      query_result: { data: [RAW_AGENT_SIN_PREFS], error: null },
    });

    const { result } = await renderHook(() => useAgencyAgents(TEST_AGENCY_ID, true));

    expect(result.current.agents).toHaveLength(1);

    const agent = result.current.agents[0] as Agent;

    expect(agent.id).toBe('agente-uuid-sin-onboarding');
    expect(agent.full_name).toBeNull();
    expect(agent.profile_photo_url).toBeNull();

    expect(result.current.error).toBeNull();
  });

  // ── (EC-5) Error de la query ───────────────────────────────────────────────
  //
  // Si Supabase retorna error (red, RLS, etc.), el hook debe exponerlo en
  // error (string) y devolver agents=[] (no null/undefined), sin crashear.

  it('(EC-5) error_de_query_expone_estado_agents_vacio_sin_crash: query devuelve {error:{message}} → agents=[], error!=null, no crashea', async () => {
    mock_supabase_holder.client = make_supabase_mock_agency_agents({
      query_result: {
        data: null,
        error: { message: 'RLS policy violation: no tienes acceso a agency_members' },
      },
    });

    const { result } = await renderHook(() => useAgencyAgents(TEST_AGENCY_ID, true));

    expect(result.current.error).toBe(
      'RLS policy violation: no tienes acceso a agency_members'
    );
    expect(result.current.agents).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  // ── (EC-6) Orden alfabético por full_name, nulls al final ────────────────
  //
  // Regla: la query no ordena server-side (no hay columna full_name en
  // agency_members); el hook DEBE ordenar client-side por full_name (locale),
  // con los full_name=null al final.

  it('(EC-6) ordena_alfabeticamente_por_full_name_nulls_al_final: respuesta desordenada [Carlos, sin_nombre, Beatriz] → agents ordenados [Beatriz, Carlos, sin_nombre]', async () => {
    mock_supabase_holder.client = make_supabase_mock_agency_agents({
      query_result: {
        data: [RAW_AGENT_CARLOS, RAW_AGENT_SIN_NOMBRE, RAW_AGENT_BEATRIZ],
        error: null,
      },
    });

    const { result } = await renderHook(() => useAgencyAgents(TEST_AGENCY_ID, true));

    expect(result.current.agents).toHaveLength(3);
    expect(result.current.agents.map((a) => a.full_name)).toEqual([
      'Beatriz Aguilar',
      'Carlos Zamudio',
      null,
    ]);
  });

  // ── (EC-7) Filtra member_role='agent' y status='active' ─────────────────
  //
  // Regla del schema (migración 0003): el owner tiene member_role='owner' y NO
  // debe aparecer en la lista; membresías 'removed' tampoco. La query DEBE
  // encadenar los tres .eq en el orden agency_id → member_role → status.

  it('(EC-7) query_filtra_member_role_agent_y_status_active: la query llama from("agency_members") y encadena .eq("agency_id",…).eq("member_role","agent").eq("status","active")', async () => {
    await renderHook(() => useAgencyAgents(TEST_AGENCY_ID, true));

    expect(mock_supabase_holder.client._mock_from).toHaveBeenCalledWith('agency_members');
    expect(mock_supabase_holder.client._mock_eq_agency).toHaveBeenCalledWith(
      'agency_id',
      TEST_AGENCY_ID
    );
    expect(mock_supabase_holder.client._mock_eq_role).toHaveBeenCalledWith(
      'member_role',
      'agent'
    );
    expect(mock_supabase_holder.client._mock_eq_status).toHaveBeenCalledWith(
      'status',
      'active'
    );
  });
});
