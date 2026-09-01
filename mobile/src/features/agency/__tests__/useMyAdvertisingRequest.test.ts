/**
 * Tests — useMyAdvertisingRequest (última solicitud de cuenta comercial del
 * owner, subtarea 221.3)
 * Archivo SUT: mobile/src/features/agency/hooks/useMyAdvertisingRequest.ts
 *
 * SEAM: useMyAdvertisingRequest(agency_id: string | null) → {
 *   loading, request, error_message, refetch
 * }
 *
 * Query: supabase.from('advertising_requests')
 *   .select('id, proposed_category, status, rejection_reason, created_at')
 *   .eq('agency_id', agency_id)
 *   .order('created_at', { ascending: false })
 *   .limit(1)
 *   .maybeSingle()
 *
 * PATRÓN DE MOCK: holder mutable + builder encadenable tolerante a la forma
 * (mismo criterio que useCanAdvertise.test.tsx).
 *
 * EDGE CASES:
 * - (EC-1) agency_id_null_no_dispara_query_estado_seguro
 * - (EC-2) owner_sin_solicitudes_previas_request_null
 * - (EC-3) owner_con_solicitud_pending_la_devuelve
 * - (EC-4) owner_con_solicitud_rejected_incluye_rejection_reason
 * - (EC-5) error_de_query_falla_con_mensaje_neutro_sin_lanzar
 * - (EC-6) rechazo_de_promesa_falla_con_mensaje_neutro
 * - (EC-7) filtra_explicito_por_agency_id_recibido
 * - (EC-8) loading_true_sincronamente_al_montar
 * - (EC-9) refetch_vuelve_a_disparar_la_query
 */

import { act, renderHook } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mock del cliente Supabase — holder mutable con getter.
// ---------------------------------------------------------------------------

const mock_supabase_holder: { client: ReturnType<typeof make_supabase_mock> } = {
  client: null as never,
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

import { useMyAdvertisingRequest } from '../hooks/useMyAdvertisingRequest';

const TEST_AGENCY_ID = 'agencia-uuid-221-3';

type RecordedCall = { method: string; args: unknown[] };

function make_chainable_query(
  result: unknown,
  calls: RecordedCall[],
): Record<string, (...args: unknown[]) => unknown> {
  const resolved_promise = result instanceof Promise ? result : Promise.resolve(result);
  const proxy: Record<string, (...args: unknown[]) => unknown> = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'maybeSingle' || prop === 'single') {
          return () => resolved_promise;
        }
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
          return proxy;
        };
      },
    },
  );
  return proxy;
}

function find_call(calls: RecordedCall[], method: string): RecordedCall | undefined {
  return calls.find((c) => c.method === method);
}

function make_supabase_mock(
  result: unknown = { data: null, error: null },
): { from: jest.Mock; _calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const builder = make_chainable_query(result, calls);
  const from = jest.fn((table: string) => {
    if (table === 'advertising_requests') return builder;
    throw new Error(`tabla no mockeada en el test: ${table}`);
  });
  return { from, _calls: calls };
}

beforeEach(() => {
  jest.clearAllMocks();
  mock_supabase_holder.client = make_supabase_mock();
});

describe('useMyAdvertisingRequest', () => {
  it('EC-1: agency_id null → estado seguro, ninguna query', async () => {
    const { result } = await renderHook(() => useMyAdvertisingRequest(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.request).toBeNull();
    expect(result.current.error_message).toBeNull();
    expect(mock_supabase_holder.client.from).not.toHaveBeenCalled();
  });

  it('EC-2: sin solicitudes previas → request null', async () => {
    mock_supabase_holder.client = make_supabase_mock({ data: null, error: null });
    const { result } = await renderHook(() => useMyAdvertisingRequest(TEST_AGENCY_ID));
    await act(async () => {});
    expect(result.current.loading).toBe(false);
    expect(result.current.request).toBeNull();
    expect(result.current.error_message).toBeNull();
  });

  it('EC-3: solicitud pending → la devuelve', async () => {
    const row = {
      id: 'req-1',
      proposed_category: 'seguros',
      status: 'pending',
      rejection_reason: null,
      created_at: '2026-08-29T00:00:00Z',
    };
    mock_supabase_holder.client = make_supabase_mock({ data: row, error: null });
    const { result } = await renderHook(() => useMyAdvertisingRequest(TEST_AGENCY_ID));
    await act(async () => {});
    expect(result.current.request).toEqual(row);
  });

  it('EC-4: solicitud rejected → incluye rejection_reason', async () => {
    const row = {
      id: 'req-2',
      proposed_category: 'mudanzas',
      status: 'rejected',
      rejection_reason: 'Categoría no aplica a tu giro.',
      created_at: '2026-08-29T00:00:00Z',
    };
    mock_supabase_holder.client = make_supabase_mock({ data: row, error: null });
    const { result } = await renderHook(() => useMyAdvertisingRequest(TEST_AGENCY_ID));
    await act(async () => {});
    expect(result.current.request?.rejection_reason).toBe('Categoría no aplica a tu giro.');
  });

  it('EC-5: error de query → mensaje neutro, request null', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      data: null,
      error: { message: 'boom' },
    });
    const { result } = await renderHook(() => useMyAdvertisingRequest(TEST_AGENCY_ID));
    await act(async () => {});
    expect(result.current.request).toBeNull();
    expect(result.current.error_message).not.toBeNull();
  });

  it('EC-6: rechazo de la promesa → mensaje neutro sin lanzar', async () => {
    mock_supabase_holder.client = make_supabase_mock(Promise.reject(new Error('network')));
    const { result } = await renderHook(() => useMyAdvertisingRequest(TEST_AGENCY_ID));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.error_message).not.toBeNull();
  });

  it('EC-7: filtra explícito por agency_id recibido', async () => {
    mock_supabase_holder.client = make_supabase_mock({ data: null, error: null });
    await renderHook(() => useMyAdvertisingRequest(TEST_AGENCY_ID));
    await act(async () => {});
    const eq_call = find_call(mock_supabase_holder.client._calls, 'eq');
    expect(eq_call?.args).toEqual(['agency_id', TEST_AGENCY_ID]);
  });

  it('EC-8: loading=true síncronamente al montar', async () => {
    mock_supabase_holder.client = make_supabase_mock(new Promise(() => {}));
    const { result } = await renderHook(() => useMyAdvertisingRequest(TEST_AGENCY_ID));
    expect(result.current.loading).toBe(true);
  });

  it('EC-9: refetch vuelve a disparar la query', async () => {
    mock_supabase_holder.client = make_supabase_mock({ data: null, error: null });
    const { result } = await renderHook(() => useMyAdvertisingRequest(TEST_AGENCY_ID));
    await act(async () => {});
    const calls_before = mock_supabase_holder.client.from.mock.calls.length;
    await act(async () => {
      result.current.refetch();
    });
    expect(mock_supabase_holder.client.from.mock.calls.length).toBeGreaterThan(calls_before);
  });
});
