/**
 * Tests — useAgencyAgents hook
 * Archivo SUT: mobile/src/features/leads/hooks/useAgencyAgents.ts
 * Subtarea Taskmaster: 28.2 — Create useAgencyAgents hook to fetch agent list for owners
 * Extendido en 203.2 — un agente SUSPENDIDO también debe aparecer (con su
 * `status` expuesto) para que el owner pueda ubicarlo en el selector del CRM
 * y en la tarjeta de miembros (contrato §2 de la tarea #203: un agente
 * suspendido sigue recibiendo leads — #203.1 — y su inventario necesita
 * reasignarse desde algún lugar visible).
 *
 * SUT: useAgencyAgents(agencyId: string | null, enabled: boolean)
 *        → { agents: Agent[], loading: boolean, error: string | null }
 *
 * Contrato (schema migración 0003 agencies_and_agents):
 *   - ⚠️ El nombre/foto del agente se leen de `users` (first_name, last_name,
 *     avatar_url), NO de `user_preferences`. Motivo (fix verificado en vivo #28):
 *     la RLS `user_prefs_select` solo deja leer el user_preferences PROPIO
 *     (user_id = auth.uid()), así que el OWNER no puede leer el user_preferences
 *     de sus agentes → los nombres salían null ("? Agente"). En cambio la RLS
 *     `users_select` sí deja al owner leer las filas `users` de sus agentes
 *     (is_agency_owner_of), y esas columnas están en los tipos generados
 *     (sin cast `as never`).
 *   - Solo ejecuta la query si enabled===true && agencyId!=null (enabled = isOwner,
 *     ver useAgencyRole de la subtarea 28.1). Si no, agents=[] sin llamar supabase.
 *   - Query (203.2): from('agency_members')
 *       .select('user_id, status, users(id, first_name, last_name, avatar_url)')
 *       .eq('agency_id', agencyId).eq('member_role', 'agent').in('status', ['active', 'suspended'])
 *     ⭐ 203.2: el filtro de status pasó de `.eq('status','active')` a
 *     `.in('status', ['active','suspended'])` — un agente suspendido sigue
 *     generando leads (ruteo #203.1) y el owner necesita verlo para
 *     reasignar su inventario. `removed` sigue fuera (ya no tiene membresía
 *     vigente en la agencia).
 *   - El owner NO se incluye (filtro member_role='agent' lo excluye).
 *   - Transformación: id = users.id (o user_id); full_name = [first_name, last_name]
 *     unidos con espacio (null si ambos vacíos); profile_photo_url = avatar_url;
 *     status = la columna `status` de agency_members ('active' | 'suspended').
 *   - Orden client-side por full_name (locale), nulls al final.
 *   - Error de query → agents=[], error poblado, sin crash.
 *
 * PATRÓN DE MOCK (idéntico a useAgencyRole.test.ts / useAgentLeads.test.ts):
 *   - `@/lib/supabase/client`: mock de módulo con getter sobre objeto mutable.
 *   - Cadena: from('agency_members').select(...)
 *       .eq('agency_id', agencyId).eq('member_role', 'agent').in('status', [...])
 *       → Promise<{data, error}>.
 *
 * EDGE CASES CUBIERTOS:
 * - (EC-1) owner_agencyId_valido_enabled_true_devuelve_agentes_mapeados
 * - (EC-embed) el select lee de users, no de user_preferences
 * - (EC-2) enabled_false_no_ejecuta_query_agents_vacio
 * - (EC-3) agencyId_null_no_ejecuta_query_agents_vacio
 * - (EC-4) agente_sin_nombre_en_users_full_name_photo_null_sin_crash
 * - (EC-5) error_de_query_expone_estado_agents_vacio_sin_crash
 * - (EC-6) ordena_alfabeticamente_por_full_name_nulls_al_final
 * - (EC-7) query_filtra_member_role_agent_y_usa_in_status_active_suspended (203.2)
 * - (EC-8) agente_suspendido_incluido_con_status_expuesto (203.2)
 * - (EC-9) select_incluye_columna_status (203.2)
 */

import { renderHook } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { useAgencyAgents } from '../hooks/useAgencyAgents';
import type { Agent } from '../types';

// ---------------------------------------------------------------------------
// Mock del cliente Supabase — patrón mock_supabase_holder con getter.
//
// Cadena de query esperada:
//   supabase.from('agency_members')
//     .select('user_id, status, users(id, first_name, last_name, avatar_url)')
//     .eq('agency_id', agencyId)         ← filtra por la agencia del owner
//     .eq('member_role', 'agent')        ← EC-7: excluye al owner
//     .in('status', ['active','suspended']) ← EC-7 (203.2): activos Y suspendidos
// ---------------------------------------------------------------------------

/** Holder mutable — beforeEach lo reemplaza con el mock apropiado por test. */
const mock_supabase_holder: { client: ReturnType<typeof make_supabase_mock_agency_agents> } = {
  client: null as never, // se sobrescribe en beforeEach antes de cada test
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_AGENCY_ID = 'agencia-uuid-28-agents-list';
const AGENT_CARLOS_ID = 'agente-uuid-carlos-zamudio';
const AGENT_BEATRIZ_ID = 'agente-uuid-beatriz-aguilar';
const AGENT_SUSPENDIDO_ID = 'agente-uuid-david-suspendido';

// ---------------------------------------------------------------------------
// Datos de prueba — shape raw de la respuesta embedded de agency_members
// (users legible por el owner vía RLS is_agency_owner_of).
// ---------------------------------------------------------------------------

interface RawUser {
  id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
}

interface RawAgencyMemberRow {
  user_id: string;
  status: 'active' | 'suspended';
  users: RawUser | null;
}

const RAW_AGENT_CARLOS: RawAgencyMemberRow = {
  user_id: AGENT_CARLOS_ID,
  status: 'active',
  users: {
    id: AGENT_CARLOS_ID,
    first_name: 'Carlos',
    last_name: 'Zamudio',
    avatar_url: 'https://storage.supabase.co/profile-photos/carlos.jpg',
  },
};

const RAW_AGENT_BEATRIZ: RawAgencyMemberRow = {
  user_id: AGENT_BEATRIZ_ID,
  status: 'active',
  users: {
    id: AGENT_BEATRIZ_ID,
    first_name: 'Beatriz',
    last_name: 'Aguilar',
    avatar_url: 'https://storage.supabase.co/profile-photos/beatriz.jpg',
  },
};

/** Agente sin nombre en users (first_name/last_name null) — full_name debe ser null. */
const RAW_AGENT_SIN_NOMBRE: RawAgencyMemberRow = {
  user_id: 'agente-uuid-sin-nombre',
  status: 'active',
  users: {
    id: 'agente-uuid-sin-nombre',
    first_name: null,
    last_name: null,
    avatar_url: null,
  },
};

/** Agente SUSPENDIDO (203.2) — sigue apareciendo en la lista, con status expuesto. */
const RAW_AGENT_SUSPENDIDO: RawAgencyMemberRow = {
  user_id: AGENT_SUSPENDIDO_ID,
  status: 'suspended',
  users: {
    id: AGENT_SUSPENDIDO_ID,
    first_name: 'David',
    last_name: 'Núñez',
    avatar_url: null,
  },
};

// ---------------------------------------------------------------------------
// Factory del mock de Supabase
//
// Cadena: from('agency_members').select(...)
//   .eq('agency_id', agencyId).eq('member_role', 'agent').in('status', [...])
// La cadena resuelve directamente a { data, error } (PostgREST/supabase-js v2).
// ---------------------------------------------------------------------------

function make_supabase_mock_agency_agents(
  opts: {
    query_result?: { data: RawAgencyMemberRow[] | null; error: { message: string } | null };
  } = {}
) {
  const { query_result = { data: [RAW_AGENT_CARLOS], error: null } } = opts;

  const mock_in_status = jest.fn().mockResolvedValue(query_result);
  const mock_eq_role = jest.fn().mockReturnValue({ in: mock_in_status });
  const mock_eq_agency = jest.fn().mockReturnValue({ eq: mock_eq_role });
  const mock_select = jest.fn().mockReturnValue({ eq: mock_eq_agency });
  const mock_from = jest.fn().mockReturnValue({ select: mock_select });

  return {
    from: mock_from,
    _mock_from: mock_from,
    _mock_select: mock_select,
    _mock_eq_agency: mock_eq_agency,
    _mock_eq_role: mock_eq_role,
    _mock_in_status: mock_in_status,
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

  it('(EC-1) owner_agencyId_valido_enabled_true_devuelve_agentes_mapeados: agency_members con embed users → agents con id/full_name/profile_photo_url/status correctos', async () => {
    mock_supabase_holder.client = make_supabase_mock_agency_agents({
      query_result: { data: [RAW_AGENT_CARLOS], error: null },
    });

    const { result } = await renderHook(() => useAgencyAgents(TEST_AGENCY_ID, true));

    expect(result.current.agents).toHaveLength(1);

    const agent = result.current.agents[0] as Agent;

    expect(agent.id).toBe(AGENT_CARLOS_ID);
    // full_name = first_name + ' ' + last_name (de users, legible por el owner)
    expect(agent.full_name).toBe('Carlos Zamudio');
    // profile_photo_url = users.avatar_url
    expect(agent.profile_photo_url).toBe(
      'https://storage.supabase.co/profile-photos/carlos.jpg'
    );
    // (203.2) status expuesto directo de agency_members.status
    expect(agent.status).toBe('active');

    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  // ── (EC-embed) El select lee de users, NO de user_preferences ────────────
  //
  // Regresión del fix #28: el owner NO puede leer user_preferences de sus
  // agentes (RLS user_prefs_select = user_id propio). El nombre/foto deben
  // venir de columnas de `users`. Lock del data-source correcto.

  it('(EC-embed) el select lee first_name/last_name/avatar_url de users (no user_preferences)', async () => {
    await renderHook(() => useAgencyAgents(TEST_AGENCY_ID, true));

    const select_arg = mock_supabase_holder.client._mock_select.mock.calls[0]?.[0] as string;
    expect(select_arg).toContain('users(');
    expect(select_arg).toContain('first_name');
    expect(select_arg).toContain('last_name');
    expect(select_arg).toContain('avatar_url');
    expect(select_arg).not.toContain('user_preferences');
  });

  // ── (EC-2) enabled=false (usuario no owner) ──────────────────────────────

  it('(EC-2) enabled_false_no_ejecuta_query_agents_vacio: enabled=false → supabase.from NO se llama, agents=[], loading=false', async () => {
    const { result } = await renderHook(() => useAgencyAgents(TEST_AGENCY_ID, false));

    expect(mock_supabase_holder.client._mock_from).not.toHaveBeenCalled();
    expect(result.current.agents).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  // ── (EC-3) agencyId=null ──────────────────────────────────────────────────

  it('(EC-3) agencyId_null_no_ejecuta_query_agents_vacio: agencyId=null y enabled=true → supabase.from NO se llama, agents=[]', async () => {
    const { result } = await renderHook(() => useAgencyAgents(null, true));

    expect(mock_supabase_holder.client._mock_from).not.toHaveBeenCalled();
    expect(result.current.agents).toEqual([]);
  });

  // ── (EC-4) Agente sin nombre en users ────────────────────────────────────
  //
  // Regla: un agente puede tener first_name/last_name null. full_name debe
  // mapear a null (no ' ' ni ''), profile_photo_url a null, sin crash.

  it('(EC-4) agente_sin_nombre_en_users_full_name_photo_null_sin_crash: users.first_name/last_name null → full_name=null y profile_photo_url=null, sin crash', async () => {
    mock_supabase_holder.client = make_supabase_mock_agency_agents({
      query_result: { data: [RAW_AGENT_SIN_NOMBRE], error: null },
    });

    const { result } = await renderHook(() => useAgencyAgents(TEST_AGENCY_ID, true));

    expect(result.current.agents).toHaveLength(1);

    const agent = result.current.agents[0] as Agent;

    expect(agent.id).toBe('agente-uuid-sin-nombre');
    expect(agent.full_name).toBeNull();
    expect(agent.profile_photo_url).toBeNull();

    expect(result.current.error).toBeNull();
  });

  // ── (EC-5) Error de la query ───────────────────────────────────────────────

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

  // ── (EC-7) Filtra member_role='agent' y usa .in('status', [...]) (203.2) ──

  it('(EC-7) query_filtra_member_role_agent_y_usa_in_status_active_suspended: la query llama from("agency_members") y encadena .eq("agency_id",…).eq("member_role","agent").in("status",["active","suspended"])', async () => {
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
    expect(mock_supabase_holder.client._mock_in_status).toHaveBeenCalledWith(
      'status',
      ['active', 'suspended']
    );
  });

  // ── (EC-8) Agente suspendido incluido, con status expuesto (203.2) ───────

  it('(EC-8) agente_suspendido_incluido_con_status_expuesto: agency_members con un agente status=suspended → sigue apareciendo en agents con status="suspended"', async () => {
    mock_supabase_holder.client = make_supabase_mock_agency_agents({
      query_result: { data: [RAW_AGENT_CARLOS, RAW_AGENT_SUSPENDIDO], error: null },
    });

    const { result } = await renderHook(() => useAgencyAgents(TEST_AGENCY_ID, true));

    expect(result.current.agents).toHaveLength(2);
    const suspendido = result.current.agents.find((a) => a.id === AGENT_SUSPENDIDO_ID);
    expect(suspendido).toBeDefined();
    expect(suspendido?.status).toBe('suspended');
    expect(suspendido?.full_name).toBe('David Núñez');

    const carlos = result.current.agents.find((a) => a.id === AGENT_CARLOS_ID);
    expect(carlos?.status).toBe('active');
  });

  // ── (EC-9) El select pide la columna status (203.2) ──────────────────────

  it('(EC-9) select_incluye_columna_status: el select() incluye "status" como columna propia de agency_members', async () => {
    await renderHook(() => useAgencyAgents(TEST_AGENCY_ID, true));

    const select_arg = mock_supabase_holder.client._mock_select.mock.calls[0]?.[0] as string;
    expect(select_arg).toMatch(/(^|[\s,])status([\s,]|$)/);
  });
});
