/**
 * Tests — useAdminRequestsQueues (las tres listas de /admin/requests,
 * subtarea 221.4)
 * Archivo SUT: mobile/src/features/admin/hooks/useAdminRequestsQueues.ts
 *
 * Tres hooks independientes, mismo esqueleto (query única + todo-o-nada
 * propio + refetch):
 *   - useAdminAgentApplications   → from('agent_applications').eq('status','pending')
 *   - useAdminPendingAgencies     → from('agencies').eq('status','pending_approval')
 *   - useAdminAdvertisingRequests → from('advertising_requests').eq('status','pending')
 *
 * PATRÓN DE MOCK: holder mutable + builder encadenable tolerante a la forma,
 * enrutado por tabla (mismo criterio que useCanAdvertise.test.tsx).
 *
 * EDGE CASES (por cada uno de los 3 hooks — EC-N se repite en 3 describes):
 * - (EC-1) lista_vacia_items_arreglo_vacio
 * - (EC-2) lista_con_filas_las_devuelve_tal_cual
 * - (EC-3) error_de_query_items_null_mensaje_neutro
 * - (EC-4) filtra_por_el_status_correcto
 * - (EC-5) refetch_vuelve_a_disparar_la_query
 */

import { act, renderHook } from '@testing-library/react-native';

const mock_supabase_holder: { client: ReturnType<typeof make_supabase_mock> } = {
  client: null as never,
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

import {
  useAdminAgentApplications,
  useAdminPendingAgencies,
  useAdminAdvertisingRequests,
} from '../hooks/useAdminRequestsQueues';

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
        if (prop === 'then') {
          return resolved_promise.then.bind(resolved_promise);
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

function make_supabase_mock(table: string, result: unknown) {
  const calls: RecordedCall[] = [];
  const builder = make_chainable_query(result, calls);
  const from = jest.fn((t: string) => {
    if (t === table) return builder;
    throw new Error(`tabla no mockeada en el test: ${t}`);
  });
  return { from, _calls: calls };
}

describe.each([
  {
    name: 'useAdminAgentApplications',
    hook: useAdminAgentApplications,
    table: 'agent_applications',
    status: 'pending',
    row: {
      id: 'app-1',
      user_id: 'user-1',
      application_type: 'independent',
      agency_id: null,
      reason: 'Quiero publicar mis propiedades',
      created_at: '2026-08-29T00:00:00Z',
      applicant: { first_name: 'Ana', last_name: 'García', email: 'ana@example.com' },
      agency: null,
    },
  },
  {
    name: 'useAdminPendingAgencies',
    hook: useAdminPendingAgencies,
    table: 'agencies',
    status: 'pending_approval',
    row: {
      id: 'agency-1',
      name: 'Inmobiliaria Ejemplo',
      slug: 'inmobiliaria-ejemplo',
      contact_name: 'Bruno',
      contact_email: 'bruno@example.com',
      created_at: '2026-08-29T00:00:00Z',
    },
  },
  {
    name: 'useAdminAdvertisingRequests',
    hook: useAdminAdvertisingRequests,
    table: 'advertising_requests',
    status: 'pending',
    row: {
      id: 'req-1',
      agency_id: 'agency-1',
      requested_by_user_id: 'user-1',
      proposed_category: 'seguros',
      created_at: '2026-08-29T00:00:00Z',
      agency: { id: 'agency-1', name: 'Inmobiliaria Ejemplo' },
    },
  },
])('$name', ({ hook, table, status, row }) => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('EC-1: lista vacía → items arreglo vacío', async () => {
    mock_supabase_holder.client = make_supabase_mock(table, { data: [], error: null });
    const { result } = await renderHook(() => hook());
    await act(async () => {});
    expect(result.current.items).toEqual([]);
    expect(result.current.error_message).toBeNull();
  });

  it('EC-2: lista con filas → las devuelve tal cual', async () => {
    mock_supabase_holder.client = make_supabase_mock(table, { data: [row], error: null });
    const { result } = await renderHook(() => hook());
    await act(async () => {});
    expect(result.current.items).toEqual([row]);
  });

  it('EC-3: error de query → items null, mensaje neutro', async () => {
    mock_supabase_holder.client = make_supabase_mock(table, {
      data: null,
      error: { message: 'boom' },
    });
    const { result } = await renderHook(() => hook());
    await act(async () => {});
    expect(result.current.items).toBeNull();
    expect(result.current.error_message).not.toBeNull();
  });

  it('EC-4: filtra por el status correcto', async () => {
    mock_supabase_holder.client = make_supabase_mock(table, { data: [], error: null });
    await renderHook(() => hook());
    await act(async () => {});
    const eq_call = find_call(mock_supabase_holder.client._calls, 'eq');
    expect(eq_call?.args).toEqual(['status', status]);
  });

  it('EC-5: refetch vuelve a disparar la query', async () => {
    mock_supabase_holder.client = make_supabase_mock(table, { data: [], error: null });
    const { result } = await renderHook(() => hook());
    await act(async () => {});
    const calls_before = mock_supabase_holder.client.from.mock.calls.length;
    await act(async () => {
      result.current.refetch();
    });
    expect(mock_supabase_holder.client.from.mock.calls.length).toBeGreaterThan(calls_before);
  });
});
