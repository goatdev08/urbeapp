/**
 * Tests fase RED — useCanAdvertise hook (gate de capacidad por RUTA)
 * Archivo SUT: mobile/src/features/ads/hooks/useCanAdvertise.ts
 * Subtarea Taskmaster: 169.8 — "sin can_advertise la RUTA no existe"
 *
 * SEAM BAJO TEST (firma pública, decidida en esta subtarea — hook NUEVO,
 * NO extiende useAgencyRole que ya tiene 3 consumidores vivos: CRMScreen,
 * agency/invitations.tsx, agency/members.tsx):
 *
 *   useCanAdvertise(): { can_advertise: boolean; loading: boolean }
 *
 * Consumidor previsto (GREEN de otro paso, NO esta subtarea):
 * mobile/app/(protected)/ads/_layout.tsx — mientras loading=true muestra un
 * indicador de carga (nunca monta el Slot ni deja pasar contenido); solo
 * cuando loading=false decide entre <Redirect> (can_advertise=false) o
 * montar la ruta (can_advertise=true). Por eso este hook garantiza
 * can_advertise=false SIEMPRE que loading=true — un consumidor que
 * (incorrectamente) leyera can_advertise antes de que loading baje a false
 * nunca vería un falso "true" optimista.
 *
 * CONTRATO DE QUERIES (decisión de diseño de esta subtarea — mismo patrón
 * server-side que supabase/functions/_shared/clients.ts
 * make_advertiser_authorizer, 169.4, pero SIN el RPC org_can_advertise
 * porque ese wrapper está `revoke`d de `authenticated` — PostgREST no lo
 * puede alcanzar desde el cliente, ver migración 20260816000008). Colapsa
 * las MISMAS 4 causas que private.org_can_advertise (verificadas en
 * supabase/migrations/20260815000001_org_advertising_capability.sql:57-67 —
 * "false si: id inexistente | deleted_at no nulo | status <> 'active' |
 * can_advertise = false"), más el rol owner/admin que el 403 de la EF exige
 * antes de siquiera mirar la capacidad:
 *
 *   1. supabase.from('agency_members')
 *        .select('agency_id, member_role')
 *        .eq('user_id', <auth uid>)
 *        .eq('status', 'active')
 *        .maybeSingle()
 *      - error, o sin fila, o member_role NOT IN ('owner','admin')
 *        → can_advertise=false, la query 2 NUNCA se dispara (fail-fast).
 *   2. supabase.from('agencies')
 *        .select('can_advertise, deleted_at, status')
 *        .eq('id', <agency_id de la query 1>)
 *        .maybeSingle()
 *      - CUALQUIER error (42703 columna inexistente, 42P01 relación
 *        inexistente, error de red genérico, lo que sea) → can_advertise=false.
 *      - sin fila → can_advertise=false.
 *      - deleted_at !== null → can_advertise=false (soft-deleted).
 *      - status !== 'active' → can_advertise=false (p.ej. 'suspended',
 *        'approved' pero aún no activada, 'pending_approval', 'rejected' —
 *        enum agency_status, 20260604000001).
 *      - can_advertise !== true → can_advertise=false.
 *      - deleted_at===null && status==='active' && can_advertise===true
 *        → can_advertise=true.
 *
 *   ⚠️ FIX pedido por el coordinador (2026-08-16, tras el RED inicial): la
 *   169.2 (máquina de estados) SUSPENDE los anuncios de una organización
 *   suspendida (paused_by_suspension) pero NO apaga `agencies.can_advertise`
 *   — la columna se queda en true. Sin este filtro, el owner de una agencia
 *   suspendida vería la ruta, recorrería el wizard entero y solo se
 *   estrellaría al subir el creativo (403 de mint-ad-upload-url, 169.4, que
 *   SÍ consulta las 4 causas vía private.org_can_advertise). El filtrado de
 *   deleted_at/status es RESPONSABILIDAD DEL HOOK, no de RLS: la policy
 *   `agencies_select` (20260604000010:180-186) deja ver la fila al manager
 *   vía la cláusula `or private.manages_agency(id)` AUNQUE la agencia esté
 *   suspendida o soft-deleted — RLS no la esconde, así que confiar en que
 *   "si no vino la fila es que no existe" sería INCORRECTO aquí.
 *
 * Sin sesión (useAuth().user === null) → can_advertise=false, loading=false,
 * NINGUNA query se dispara (ni siquiera agency_members).
 *
 * PATRÓN DE MOCK: holder mutable `mock_supabase_holder` con getter en
 * `@/lib/supabase/client` (idéntico a useAgencyRole.test.ts /
 * useAgentStats.test.ts) + mock de `@/features/auth/context`. `from(table)`
 * enruta por nombre de tabla a un builder encadenable distinto para
 * 'agency_members' vs 'agencies' — cada builder resuelve de verdad (nunca
 * un cliente sin `.from()`, lección de 169.7).
 *
 * GOTCHAS RNTL ya pagados (169.6/169.7): `renderHook` con `await`, `act()`
 * async con `await`, `unmount()` dentro de `act()`.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) owner_con_can_advertise_true_habilita
 * - (EC-2) admin_con_can_advertise_true_tambien_habilita
 *
 * ### 🔴 Criterio de aceptación central — FALLAR CERRADO ante backend sin schema
 * - (EC-3) columna_can_advertise_no_existe_42703_falla_cerrado
 * - (EC-4) relacion_no_existe_42P01_falla_cerrado
 * - (EC-5) error_generico_de_red_en_agencies_falla_cerrado
 * - (EC-6) error_en_agency_members_tambien_falla_cerrado_sin_consultar_agencies
 *
 * ### Ramas de reglas no obvias (rol / organización / capacidad)
 * - (EC-7) can_advertise_false_en_bd_no_habilita
 * - (EC-8) agencies_select_pide_deleted_at_y_status_ademas_de_can_advertise
 * - (EC-9) organizacion_soft_deleted_no_habilita_pese_a_can_advertise_true
 * - (EC-10) organizacion_suspendida_no_habilita_pese_a_can_advertise_true
 * - (EC-11) sin_organizacion_falla_cerrado_sin_consultar_agencies
 * - (EC-12) rol_agent_no_autorizado_sin_consultar_agencies
 * - (EC-13) rol_viewer_no_autorizado_sin_consultar_agencies
 *
 * ### Boundary / error
 * - (EC-14) sin_sesion_falla_cerrado_sin_disparar_ninguna_query
 * - (EC-15) loading_inicial_true_can_advertise_false_primera_query_pendiente
 * - (EC-16) loading_true_can_advertise_false_segunda_query_pendiente
 * - (EC-17) tras_resolver_loading_false
 */

import { renderHook } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mock de useAuth — ANTES de cualquier import del SUT.
// ---------------------------------------------------------------------------

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Mock del cliente Supabase — holder mutable con getter, enrutado por tabla.
// ---------------------------------------------------------------------------

const mock_supabase_holder: { client: ReturnType<typeof make_supabase_mock> } = {
  client: null as never,
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar los mocks
// ---------------------------------------------------------------------------

import { useAuth } from '@/features/auth/context';
import { useCanAdvertise } from '../hooks/useCanAdvertise';

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'usuario-uuid-can-advertise-169-8';
const TEST_AGENCY_ID = 'agencia-uuid-169-8-anunciante';

type MembersRow = { agency_id: string; member_role: 'owner' | 'admin' | 'agent' | 'viewer' } | null;
type MembersResult = { data: MembersRow; error: { code?: string; message: string } | null };
/** deleted_at/status viajan SIEMPRE junto con can_advertise (169.8, fix del coordinador) — ver docblock. */
type AgenciesRow = { can_advertise: boolean; deleted_at: string | null; status: string } | null;
type AgenciesResult = { data: AgenciesRow; error: { code?: string; message: string } | null };

/**
 * Mock de `supabase.from(table)` enrutado por nombre de tabla — cada tabla
 * tiene su propia cadena encadenable que RESUELVE de verdad (nunca un
 * builder vacío que reviente con TypeError, lección de 169.7).
 *
 * agency_members: .select(...).eq('user_id', uid).eq('status', 'active').maybeSingle()
 * agencies:       .select('can_advertise, deleted_at, status').eq('id', agency_id).maybeSingle()
 */
function make_supabase_mock(opts: {
  members_result?: MembersResult | Promise<never>;
  agencies_result?: AgenciesResult | Promise<never>;
} = {}) {
  const {
    members_result = { data: { agency_id: TEST_AGENCY_ID, member_role: 'owner' }, error: null },
    agencies_result = { data: { can_advertise: true, deleted_at: null, status: 'active' }, error: null },
  } = opts;

  const members_maybe_single = jest.fn().mockReturnValue(
    members_result instanceof Promise ? members_result : Promise.resolve(members_result),
  );
  const members_eq_status = jest.fn().mockReturnValue({ maybeSingle: members_maybe_single });
  const members_eq_user = jest.fn().mockReturnValue({ eq: members_eq_status });
  const members_select = jest.fn().mockReturnValue({ eq: members_eq_user });

  const agencies_maybe_single = jest.fn().mockReturnValue(
    agencies_result instanceof Promise ? agencies_result : Promise.resolve(agencies_result),
  );
  const agencies_eq_id = jest.fn().mockReturnValue({ maybeSingle: agencies_maybe_single });
  const agencies_select = jest.fn().mockReturnValue({ eq: agencies_eq_id });

  const from = jest.fn((table: string) => {
    if (table === 'agency_members') return { select: members_select };
    if (table === 'agencies') return { select: agencies_select };
    throw new Error(`tabla no mockeada en el test: ${table}`);
  });

  return {
    from,
    _members: { select: members_select, eq_user: members_eq_user, eq_status: members_eq_status, maybe_single: members_maybe_single },
    _agencies: { select: agencies_select, eq_id: agencies_eq_id, maybe_single: agencies_maybe_single },
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mock_supabase_holder.client = make_supabase_mock();
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

describe('useCanAdvertise', () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  it('(EC-1) owner_con_can_advertise_true_habilita: member_role=owner + agencies.can_advertise=true (activa, sin borrar) → can_advertise=true, loading=false', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      members_result: { data: { agency_id: TEST_AGENCY_ID, member_role: 'owner' }, error: null },
      agencies_result: { data: { can_advertise: true, deleted_at: null, status: 'active' }, error: null },
    });

    const { result } = await renderHook(() => useCanAdvertise());

    expect(result.current.can_advertise).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('(EC-2) admin_con_can_advertise_true_tambien_habilita: member_role=admin + can_advertise=true (activa, sin borrar) → can_advertise=true (espeja el 403 de la EF que acepta owner Y admin)', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      members_result: { data: { agency_id: TEST_AGENCY_ID, member_role: 'admin' }, error: null },
      agencies_result: { data: { can_advertise: true, deleted_at: null, status: 'active' }, error: null },
    });

    const { result } = await renderHook(() => useCanAdvertise());

    expect(result.current.can_advertise).toBe(true);
  });

  // ── 🔴 Criterio central — FALLAR CERRADO ante backend sin schema ──────────

  it('(EC-3) columna_can_advertise_no_existe_42703_falla_cerrado: agencies query error.code="42703" (column does not exist) → can_advertise=false, NUNCA true, sin lanzar', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      members_result: { data: { agency_id: TEST_AGENCY_ID, member_role: 'owner' }, error: null },
      agencies_result: { data: null, error: { code: '42703', message: 'column agencies.can_advertise does not exist' } },
    });

    const { result } = await renderHook(() => useCanAdvertise());

    expect(result.current.can_advertise).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('(EC-4) relacion_no_existe_42P01_falla_cerrado: agencies query error.code="42P01" (relation does not exist) → can_advertise=false, sin lanzar', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      members_result: { data: { agency_id: TEST_AGENCY_ID, member_role: 'owner' }, error: null },
      agencies_result: { data: null, error: { code: '42P01', message: 'relation "public.agencies" does not exist' } },
    });

    const { result } = await renderHook(() => useCanAdvertise());

    expect(result.current.can_advertise).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('(EC-5) error_generico_de_red_en_agencies_falla_cerrado: agencies query devuelve un error SIN code reconocido (red/timeout) → can_advertise=false, sin lanzar', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      members_result: { data: { agency_id: TEST_AGENCY_ID, member_role: 'owner' }, error: null },
      agencies_result: { data: null, error: { message: 'FetchError: network request failed' } },
    });

    const { result } = await renderHook(() => useCanAdvertise());

    expect(result.current.can_advertise).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('(EC-6) error_en_agency_members_tambien_falla_cerrado_sin_consultar_agencies: la PRIMERA query falla (p.ej. 42P01 si agency_members tampoco existiera) → can_advertise=false Y la tabla agencies NUNCA se consulta (fail-fast)', async () => {
    const mock = make_supabase_mock({
      members_result: { data: null, error: { code: '42P01', message: 'relation "public.agency_members" does not exist' } },
    });
    mock_supabase_holder.client = mock;

    const { result } = await renderHook(() => useCanAdvertise());

    expect(result.current.can_advertise).toBe(false);
    expect(mock.from).not.toHaveBeenCalledWith('agencies');
  });

  // ── Ramas de reglas no obvias (rol / organización / capacidad) ─────────────

  it('(EC-7) can_advertise_false_en_bd_no_habilita: rol owner pero agencies.can_advertise=false (activa, sin borrar) → can_advertise=false', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      members_result: { data: { agency_id: TEST_AGENCY_ID, member_role: 'owner' }, error: null },
      agencies_result: { data: { can_advertise: false, deleted_at: null, status: 'active' }, error: null },
    });

    const { result } = await renderHook(() => useCanAdvertise());

    expect(result.current.can_advertise).toBe(false);
  });

  it('(EC-8) agencies_select_pide_deleted_at_y_status_ademas_de_can_advertise: la query 2 selecciona las 3 columnas que private.org_can_advertise necesita (20260815000001:57-67), no solo can_advertise — de lo contrario el hook no podría detectar una agencia suspendida/soft-deleted', async () => {
    const mock = make_supabase_mock();
    mock_supabase_holder.client = mock;

    await renderHook(() => useCanAdvertise());

    const select_arg = mock._agencies.select.mock.calls[0]?.[0] as string;
    expect(select_arg).toEqual(expect.stringContaining('can_advertise'));
    expect(select_arg).toEqual(expect.stringContaining('deleted_at'));
    expect(select_arg).toEqual(expect.stringContaining('status'));
  });

  it('(EC-9) organizacion_soft_deleted_no_habilita_pese_a_can_advertise_true: rol owner + can_advertise=true + status=active PERO deleted_at NO nulo → can_advertise=false (private.org_can_advertise exige deleted_at is null)', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      members_result: { data: { agency_id: TEST_AGENCY_ID, member_role: 'owner' }, error: null },
      agencies_result: {
        data: { can_advertise: true, deleted_at: '2026-08-01T00:00:00Z', status: 'active' },
        error: null,
      },
    });

    const { result } = await renderHook(() => useCanAdvertise());

    expect(result.current.can_advertise).toBe(false);
  });

  it('(EC-10) organizacion_suspendida_no_habilita_pese_a_can_advertise_true: rol owner + can_advertise=true + deleted_at nulo PERO status="suspended" → can_advertise=false (169.2 suspende los anuncios sin apagar la columna can_advertise)', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      members_result: { data: { agency_id: TEST_AGENCY_ID, member_role: 'owner' }, error: null },
      agencies_result: { data: { can_advertise: true, deleted_at: null, status: 'suspended' }, error: null },
    });

    const { result } = await renderHook(() => useCanAdvertise());

    expect(result.current.can_advertise).toBe(false);
  });

  it('(EC-11) sin_organizacion_falla_cerrado_sin_consultar_agencies: agency_members.maybeSingle() devuelve data=null (usuario sin membresía activa) → can_advertise=false, agencies NUNCA se consulta', async () => {
    const mock = make_supabase_mock({
      members_result: { data: null, error: null },
    });
    mock_supabase_holder.client = mock;

    const { result } = await renderHook(() => useCanAdvertise());

    expect(result.current.can_advertise).toBe(false);
    expect(mock.from).not.toHaveBeenCalledWith('agencies');
  });

  it('(EC-12) rol_agent_no_autorizado_sin_consultar_agencies: member_role=agent (no owner/admin) → can_advertise=false, agencies NUNCA se consulta aunque hubiera can_advertise=true en BD', async () => {
    const mock = make_supabase_mock({
      members_result: { data: { agency_id: TEST_AGENCY_ID, member_role: 'agent' }, error: null },
    });
    mock_supabase_holder.client = mock;

    const { result } = await renderHook(() => useCanAdvertise());

    expect(result.current.can_advertise).toBe(false);
    expect(mock.from).not.toHaveBeenCalledWith('agencies');
  });

  it('(EC-13) rol_viewer_no_autorizado_sin_consultar_agencies: member_role=viewer → can_advertise=false, agencies NUNCA se consulta', async () => {
    const mock = make_supabase_mock({
      members_result: { data: { agency_id: TEST_AGENCY_ID, member_role: 'viewer' }, error: null },
    });
    mock_supabase_holder.client = mock;

    const { result } = await renderHook(() => useCanAdvertise());

    expect(result.current.can_advertise).toBe(false);
    expect(mock.from).not.toHaveBeenCalledWith('agencies');
  });

  // ── Boundary / error ────────────────────────────────────────────────────

  it('(EC-14) sin_sesion_falla_cerrado_sin_disparar_ninguna_query: useAuth().user=null → can_advertise=false, loading=false, from() NUNCA se llama', async () => {
    mock_use_auth.mockReturnValue({

      user: null,
      session: null,
      isLoading: false,
      signIn: jest.fn(),
      signOut: jest.fn(),
      requestPasswordReset: jest.fn(),
      updatePassword: jest.fn(),
    } as any);
    const mock = make_supabase_mock();
    mock_supabase_holder.client = mock;

    const { result } = await renderHook(() => useCanAdvertise());

    expect(result.current.can_advertise).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(mock.from).not.toHaveBeenCalled();
  });

  it('(EC-15) loading_inicial_true_can_advertise_false_primera_query_pendiente: agency_members.maybeSingle() nunca resuelve → loading=true Y can_advertise=false (nunca true optimista)', async () => {
    const pending = new Promise<never>(() => {});
    mock_supabase_holder.client = make_supabase_mock({ members_result: pending });

    const { result } = await renderHook(() => useCanAdvertise());

    expect(result.current.loading).toBe(true);
    expect(result.current.can_advertise).toBe(false);
  });

  it('(EC-16) loading_true_can_advertise_false_segunda_query_pendiente: agency_members resuelve owner, pero agencies.maybeSingle() nunca resuelve → loading sigue true Y can_advertise sigue false', async () => {
    const pending = new Promise<never>(() => {});
    mock_supabase_holder.client = make_supabase_mock({
      members_result: { data: { agency_id: TEST_AGENCY_ID, member_role: 'owner' }, error: null },
      agencies_result: pending,
    });

    const { result } = await renderHook(() => useCanAdvertise());

    expect(result.current.loading).toBe(true);
    expect(result.current.can_advertise).toBe(false);
  });

  it('(EC-17) tras_resolver_loading_false: ambas queries resuelven → loading termina en false (sin importar el resultado de can_advertise)', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      members_result: { data: { agency_id: TEST_AGENCY_ID, member_role: 'agent' }, error: null },
    });

    const { result } = await renderHook(() => useCanAdvertise());

    expect(result.current.loading).toBe(false);
  });
});
