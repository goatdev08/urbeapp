/**
 * Tests — useUnmanagedInventory (subtarea 203.2)
 * Archivo SUT: mobile/src/features/agency/hooks/useUnmanagedInventory.ts
 *
 * Contrato §2 de la tarea #203: el owner/admin necesita saber CUÁNTAS
 * publicaciones activas quedaron "sin gestor" (dueño de la propiedad =
 * miembro suspendido/removido) para decidir si reasignarlas.
 *
 * SUT: useUnmanagedInventory(agencyId: string | null, user_ids: string[])
 *        → { counts: Record<string, number>, loading: boolean, error: string | null, refetch: () => void }
 *
 * Query (una sola, agrupada en cliente — contrato §2):
 *   from('properties').select('owner_user_id')
 *     .eq('agency_id', agencyId)
 *     .in('owner_user_id', user_ids)
 *     .is('deleted_at', null)
 *   → counts[owner_user_id] = número de filas con ese owner_user_id.
 *
 * Guardas: no ejecuta la query si agencyId es null o user_ids está vacío
 * (evita un .in([]) inútil y una llamada de red sin filtros útiles).
 *
 * 🔴 Contrato de dependencia: `user_ids` se compara por CONTENIDO
 * (`.join('|')`), no por referencia — un caller que pase un literal `[...]`
 * inline en cada render (como este mismo archivo de test) NO debe disparar
 * un loop de refetch por simple cambio de identidad del arreglo. Para forzar
 * un refresh real (el conteo cambió pero el conjunto de ids no, típicamente
 * tras un reassign exitoso) se expone `refetch()` — mismo patrón que
 * useAdminRequestsQueues (refetch_tick).
 *
 * EDGE CASES:
 * - (EC-1) agencyId_null_no_ejecuta_query_counts_vacio
 * - (EC-2) user_ids_vacio_no_ejecuta_query_counts_vacio
 * - (EC-3) camino_feliz_agrupa_conteos_por_owner_user_id
 * - (EC-4) error_de_query_counts_vacio_error_poblado_sin_crash
 * - (EC-5) query_usa_los_filtros_exactos_agency_id_in_owner_user_id_deleted_at
 * - (EC-6) nueva_referencia_mismo_contenido_de_user_ids_NO_reejecuta_la_query
 * - (EC-7) refetch_fuerza_una_nueva_query_aunque_agencyId_y_user_ids_no_cambien
 */

import { act, renderHook } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks (jest.mock se hoistea igual — patrón
// useAgencyAgents.test.ts)
// ---------------------------------------------------------------------------

import { useUnmanagedInventory } from '../hooks/useUnmanagedInventory';

const mock_supabase_holder: { client: ReturnType<typeof make_supabase_mock> } = {
  client: null as never,
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

const TEST_AGENCY_ID = 'agencia-uuid-203-unmanaged';
const SUSPENDED_A = 'user-uuid-suspendido-a';
const SUSPENDED_B = 'user-uuid-suspendido-b';

function make_supabase_mock(
  opts: {
    query_result?: {
      data: { owner_user_id: string }[] | null;
      error: { message: string } | null;
    };
  } = {}
) {
  const { query_result = { data: [], error: null } } = opts;

  const mock_is_deleted = jest.fn().mockResolvedValue(query_result);
  const mock_in_owner = jest.fn().mockReturnValue({ is: mock_is_deleted });
  const mock_eq_agency = jest.fn().mockReturnValue({ in: mock_in_owner });
  const mock_select = jest.fn().mockReturnValue({ eq: mock_eq_agency });
  const mock_from = jest.fn().mockReturnValue({ select: mock_select });

  return {
    from: mock_from,
    _mock_from: mock_from,
    _mock_select: mock_select,
    _mock_eq_agency: mock_eq_agency,
    _mock_in_owner: mock_in_owner,
    _mock_is_deleted: mock_is_deleted,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mock_supabase_holder.client = make_supabase_mock();
});

describe('useUnmanagedInventory', () => {
  it('(EC-1) agencyId_null_no_ejecuta_query_counts_vacio', async () => {
    const { result } = await renderHook(() =>
      useUnmanagedInventory(null, [SUSPENDED_A])
    );

    expect(mock_supabase_holder.client._mock_from).not.toHaveBeenCalled();
    expect(result.current.counts).toEqual({});
    expect(result.current.loading).toBe(false);
  });

  it('(EC-2) user_ids_vacio_no_ejecuta_query_counts_vacio', async () => {
    const { result } = await renderHook(() =>
      useUnmanagedInventory(TEST_AGENCY_ID, [])
    );

    expect(mock_supabase_holder.client._mock_from).not.toHaveBeenCalled();
    expect(result.current.counts).toEqual({});
  });

  it('(EC-3) camino_feliz_agrupa_conteos_por_owner_user_id', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      query_result: {
        data: [
          { owner_user_id: SUSPENDED_A },
          { owner_user_id: SUSPENDED_A },
          { owner_user_id: SUSPENDED_B },
        ],
        error: null,
      },
    });

    const { result } = await renderHook(() =>
      useUnmanagedInventory(TEST_AGENCY_ID, [SUSPENDED_A, SUSPENDED_B])
    );

    expect(result.current.counts).toEqual({
      [SUSPENDED_A]: 2,
      [SUSPENDED_B]: 1,
    });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-4) error_de_query_counts_vacio_error_poblado_sin_crash', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      query_result: { data: null, error: { message: 'RLS policy violation' } },
    });

    const { result } = await renderHook(() =>
      useUnmanagedInventory(TEST_AGENCY_ID, [SUSPENDED_A])
    );

    expect(result.current.counts).toEqual({});
    expect(result.current.error).toBe('RLS policy violation');
    expect(result.current.loading).toBe(false);
  });

  it('(EC-5) query_usa_los_filtros_exactos_agency_id_in_owner_user_id_deleted_at', async () => {
    await renderHook(() =>
      useUnmanagedInventory(TEST_AGENCY_ID, [SUSPENDED_A, SUSPENDED_B])
    );

    expect(mock_supabase_holder.client._mock_from).toHaveBeenCalledWith('properties');
    expect(mock_supabase_holder.client._mock_select).toHaveBeenCalledWith('owner_user_id');
    expect(mock_supabase_holder.client._mock_eq_agency).toHaveBeenCalledWith(
      'agency_id',
      TEST_AGENCY_ID
    );
    expect(mock_supabase_holder.client._mock_in_owner).toHaveBeenCalledWith('owner_user_id', [
      SUSPENDED_A,
      SUSPENDED_B,
    ]);
    expect(mock_supabase_holder.client._mock_is_deleted).toHaveBeenCalledWith(
      'deleted_at',
      null
    );
  });

  it('(EC-6) nueva_referencia_mismo_contenido_de_user_ids_NO_reejecuta_la_query', async () => {
    const { rerender } = await renderHook(
      ({ ids }: { ids: string[] }) => useUnmanagedInventory(TEST_AGENCY_ID, ids),
      { initialProps: { ids: [SUSPENDED_A] } }
    );

    expect(mock_supabase_holder.client._mock_from).toHaveBeenCalledTimes(1);

    // Nueva referencia (arreglo distinto), MISMO contenido — un caller que
    // no memoiza (patrón común, p.ej. este mismo test) no debe disparar un
    // loop de refetch.
    await rerender({ ids: [SUSPENDED_A] });

    expect(mock_supabase_holder.client._mock_from).toHaveBeenCalledTimes(1);
  });

  it('(EC-7) refetch_fuerza_una_nueva_query_aunque_agencyId_y_user_ids_no_cambien', async () => {
    const { result } = await renderHook(() =>
      useUnmanagedInventory(TEST_AGENCY_ID, [SUSPENDED_A])
    );

    expect(mock_supabase_holder.client._mock_from).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refetch();
    });

    expect(mock_supabase_holder.client._mock_from).toHaveBeenCalledTimes(2);
  });
});
