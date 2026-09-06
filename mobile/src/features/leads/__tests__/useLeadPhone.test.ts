/**
 * Tests fase RED — useLeadPhone (subtarea 267.6, tarea #267 "CRM UI agente").
 * Archivo SUT: mobile/src/features/leads/hooks/useLeadPhone.ts
 * (STUB que lanza 'not_implemented' — la implementación real es el GREEN).
 *
 * SEAM bajo test: la firma pública del hook —
 *   useLeadPhone(leadId) → { phone, loading, error, refetch }
 * — y la cadena EXACTA de PostgREST vía el embed:
 *   supabase.from('leads')
 *     .select('users!leads_user_id_fkey(phone)')
 *     .eq('id', leadId)
 *     .is('deleted_at', null)
 *     .maybeSingle()
 * Extraído de useAgentLeads.ts (el flujo viejo, se borra en 267.7). El hint
 * `users!leads_user_id_fkey` es OBLIGATORIO: `leads` tiene DOS FKs a `users`
 * (agent_id y user_id) — sin el hint PostgREST no sabe cuál usar y falla.
 * Ya probado bajo RLS (`users_select` expone la identidad del buscador con
 * relación de lead vigente) — este hook solo extrae esa lectura puntual del
 * teléfono, no reintroduce lógica de RLS nueva.
 *
 * DECISIONES DE DISEÑO DEL CONTRATO (D-XXX de esta subtarea):
 * - D-INITIAL: loading = Boolean(leadId) en el primer render (sonda), igual
 *   que useCrmLeadDetail/useCrmSuggestedMessage.
 * - D-EMBED-EXACTO: el string de `.select(...)` se asertea LITERAL —
 *   'users!leads_user_id_fkey(phone)' — porque un typo o la pérdida del hint
 *   rompe la query en producción sin que TypeScript lo detecte (PostgREST
 *   resuelve el hint en runtime).
 * - D-MAP: `phone = data?.users?.phone ?? null` — el embed many-to-one puede
 *   llegar como objeto O null (usuario borrado/RLS sin fila visible), nunca
 *   se asume la forma.
 * - D-SINFILA: sin fila (RLS, `deleted_at` no nulo, o el lead no existe) →
 *   `phone` null SIN error — fail-closed silencioso, anti-IDOR, mismo
 *   criterio D-SINFILA de useCrmLeadDetail (nunca se distingue "no existe" de
 *   "no es tuyo").
 * - D-ERROR: error de red/PostgREST → mensaje neutro en español
 *   'No se pudo cargar el teléfono del lead.' — nunca el texto crudo.
 *
 * PATRÓN DE MOCK: '@/lib/supabase/client' con mock_supabase_holder + getter
 * (idéntico a useCrmSuggestedMessage.test.ts), pero aquí la cadena es
 * from().select().eq().is().maybeSingle() — un jest.fn() POR MÉTODO
 * (molde useAgentLeads.test.ts / make_supabase_mock_leads) para poder
 * asertar los argumentos exactos de cada eslabón. `.maybeSingle()` es el
 * extremo: resuelve directo a `{ data, error }` (no es chainable+thenable
 * como `.order()` en useAgentLeads — aquí no hay doble encadenamiento).
 * renderHook/act con `await` (RNTL 14); unmount() dentro de act(); reloj
 * fijo con jest.useFakeTimers().setSystemTime en TODOS los casos (regla del
 * repo, tests-bomba-de-fecha).
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### SEAMS
 * - (EC-2) cadena_exacta_from_select_eq_is_maybe_single_con_hint_fk_literal
 *
 * ### Happy path
 * - (EC-1) estado_inicial_antes_del_efecto_phone_null_loading_true_sin_error
 * - (EC-3) exito_mapea_data_users_phone_D_MAP
 *
 * ### Ramas de reglas no obvias
 * - (EC-4) data_null_sin_fila_phone_null_sin_error_D_SINFILA
 * - (EC-5) data_con_users_null_phone_null_sin_error_D_MAP
 * - (EC-6) error_de_postgrest_mensaje_neutro_en_espanol_phone_null_D_ERROR
 *
 * ### Boundary / error
 * - (EC-7) rerender_con_el_mismo_leadId_no_dispara_otra_llamada
 * - (EC-8) cambiar_leadId_dispara_una_llamada_nueva_y_reinicia_phone
 * - (EC-9) leadId_null_o_undefined_no_llama_supabase_phone_null_sin_error_loading_false
 * - (EC-10) unmount_durante_llamada_en_vuelo_no_aplica_estado_sin_warning
 * - (EC-11) refetch_manual_redispara_la_query
 */

import { renderHook, act } from '@testing-library/react-native';

import { useLeadPhone } from '../hooks/useLeadPhone';

// ---------------------------------------------------------------------------
// Mock del cliente Supabase — cadena from().select().eq().is().maybeSingle()
// con UN jest.fn() por eslabón (molde useAgentLeads.test.ts:
// make_supabase_mock_leads), para asertar los argumentos exactos de cada uno.
// ---------------------------------------------------------------------------

type QueryResult = { data: { users: { phone: string | null } | null } | null; error: { message: string } | null };

type MockSupabaseClient = {
  from: jest.Mock;
  _mock_from: jest.Mock;
  _mock_select: jest.Mock;
  _mock_eq: jest.Mock;
  _mock_is: jest.Mock;
  _mock_maybe_single: jest.Mock;
};

const mock_supabase_holder: { client: MockSupabaseClient } = {
  client: null as never,
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LEAD_ID = 'lead-uuid-267-6-phone';
const TELEFONO = '+525512345678';

function make_supabase_mock(
  maybe_single_impl: jest.Mock = jest.fn().mockResolvedValue({ data: { users: { phone: TELEFONO } }, error: null }),
): MockSupabaseClient {
  const mock_maybe_single = maybe_single_impl;
  const mock_is = jest.fn().mockReturnValue({ maybeSingle: mock_maybe_single });
  const mock_eq = jest.fn().mockReturnValue({ is: mock_is });
  const mock_select = jest.fn().mockReturnValue({ eq: mock_eq });
  const mock_from = jest.fn().mockReturnValue({ select: mock_select });

  return {
    from: mock_from,
    _mock_from: mock_from,
    _mock_select: mock_select,
    _mock_eq: mock_eq,
    _mock_is: mock_is,
    _mock_maybe_single: mock_maybe_single,
  };
}

beforeEach(() => {
  // Reloj fijo en TODOS los casos (regla del repo) — evita un test-bomba-de-
  // fecha si este hook llega a incorporar fecha relativa más adelante.
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-06T12:00:00Z'));
  jest.clearAllMocks();
  mock_supabase_holder.client = make_supabase_mock();
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useLeadPhone', () => {
  it('(EC-1) estado_inicial_antes_del_efecto_phone_null_loading_true_sin_error', async () => {
    const pending = new Promise<never>(() => {});
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending));

    const render_states: ReturnType<typeof useLeadPhone>[] = [];
    function useProbe() {
      const state = useLeadPhone(LEAD_ID);
      render_states.push(state);
      return state;
    }

    await renderHook(() => useProbe());

    const first = render_states[0]!;
    expect(first.phone).toBeNull();
    expect(first.loading).toBe(true);
    expect(first.error).toBeNull();
  });

  it('(EC-2) cadena_exacta_from_select_eq_is_maybe_single_con_hint_fk_literal', async () => {
    await renderHook(() => useLeadPhone(LEAD_ID));

    const client = mock_supabase_holder.client;
    expect(client._mock_from).toHaveBeenCalledWith('leads');
    expect(client._mock_select).toHaveBeenCalledWith('users!leads_user_id_fkey(phone)');
    expect(client._mock_eq).toHaveBeenCalledWith('id', LEAD_ID);
    expect(client._mock_is).toHaveBeenCalledWith('deleted_at', null);
    expect(client._mock_maybe_single).toHaveBeenCalledTimes(1);
  });

  it('(EC-3) exito_mapea_data_users_phone_D_MAP', async () => {
    const { result } = await renderHook(() => useLeadPhone(LEAD_ID));

    expect(result.current.phone).toBe(TELEFONO);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('(EC-4) data_null_sin_fila_phone_null_sin_error_D_SINFILA', async () => {
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockResolvedValue({ data: null, error: null }));

    const { result } = await renderHook(() => useLeadPhone(LEAD_ID));

    expect(result.current.phone).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-5) data_con_users_null_phone_null_sin_error_D_MAP', async () => {
    mock_supabase_holder.client = make_supabase_mock(
      jest.fn().mockResolvedValue({ data: { users: null }, error: null }),
    );

    const { result } = await renderHook(() => useLeadPhone(LEAD_ID));

    expect(result.current.phone).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-6) error_de_postgrest_mensaje_neutro_en_espanol_phone_null_D_ERROR', async () => {
    const RAW_PG_MESSAGE = 'permission denied for relation leads';
    mock_supabase_holder.client = make_supabase_mock(
      jest.fn().mockResolvedValue({ data: null, error: { message: RAW_PG_MESSAGE } }),
    );

    const { result } = await renderHook(() => useLeadPhone(LEAD_ID));

    expect(result.current.error).toBe('No se pudo cargar el teléfono del lead.');
    expect(result.current.error).not.toBe(RAW_PG_MESSAGE);
    expect(result.current.phone).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-7) rerender_con_el_mismo_leadId_no_dispara_otra_llamada', async () => {
    const maybe_single = jest.fn().mockResolvedValue({ data: { users: { phone: TELEFONO } }, error: null });
    mock_supabase_holder.client = make_supabase_mock(maybe_single);

    const { rerender } = await renderHook(({ leadId }: { leadId: string }) => useLeadPhone(leadId), {
      initialProps: { leadId: LEAD_ID },
    });
    expect(maybe_single).toHaveBeenCalledTimes(1);

    await rerender({ leadId: LEAD_ID });

    expect(maybe_single).toHaveBeenCalledTimes(1);
  });

  it('(EC-8) cambiar_leadId_dispara_una_llamada_nueva_y_reinicia_phone', async () => {
    const OTRO_TELEFONO = '+525587654321';
    const maybe_single = jest
      .fn()
      .mockResolvedValueOnce({ data: { users: { phone: TELEFONO } }, error: null })
      .mockResolvedValueOnce({ data: { users: { phone: OTRO_TELEFONO } }, error: null });
    mock_supabase_holder.client = make_supabase_mock(maybe_single);

    const { result, rerender } = await renderHook(({ leadId }: { leadId: string }) => useLeadPhone(leadId), {
      initialProps: { leadId: LEAD_ID },
    });
    expect(result.current.phone).toBe(TELEFONO);

    await rerender({ leadId: 'lead-uuid-267-6-otro' });

    expect(maybe_single).toHaveBeenCalledTimes(2);
    expect(mock_supabase_holder.client._mock_eq).toHaveBeenLastCalledWith('id', 'lead-uuid-267-6-otro');
    expect(result.current.phone).toBe(OTRO_TELEFONO);
  });

  it('(EC-8b) cambiar_a_un_lead_sin_fila_visible_reinicia_phone_a_null_D_SINFILA', async () => {
    // Guardian 267.6: sin este caso, un hook que conservara el teléfono
    // anterior cuando no hay fila (RLS / deleted_at / lead ajeno) pasaría la
    // suite — y el botón de WhatsApp marcaría al contacto EQUIVOCADO (PII
    // cruzada entre leads). EC-4 arranca desde null y no puede verlo.
    const maybe_single = jest
      .fn()
      .mockResolvedValueOnce({ data: { users: { phone: TELEFONO } }, error: null })
      .mockResolvedValueOnce({ data: null, error: null });
    mock_supabase_holder.client = make_supabase_mock(maybe_single);

    const { result, rerender } = await renderHook(({ leadId }: { leadId: string }) => useLeadPhone(leadId), {
      initialProps: { leadId: LEAD_ID },
    });
    expect(result.current.phone).toBe(TELEFONO);

    await rerender({ leadId: 'lead-uuid-267-6-sin-fila' });

    expect(maybe_single).toHaveBeenCalledTimes(2);
    expect(result.current.phone).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-8c) respuesta_tardia_de_un_leadId_anterior_no_pisa_el_telefono_actual_D_SEQ', async () => {
    // Guardian 267.6 (obs. 1): LEAD-A lento, LEAD-B rápido. Resuelve B, luego
    // llega A tardío — el hook ya representa a B y NO debe volver a TEL-A.
    const TEL_A = '+525511111111';
    const TEL_B = '+525522222222';
    let resolve_a!: (value: QueryResult) => void;
    const pending_a = new Promise<QueryResult>((resolve) => {
      resolve_a = resolve;
    });
    const maybe_single = jest
      .fn()
      .mockReturnValueOnce(pending_a)
      .mockResolvedValueOnce({ data: { users: { phone: TEL_B } }, error: null });
    mock_supabase_holder.client = make_supabase_mock(maybe_single);

    const { result, rerender } = await renderHook(({ leadId }: { leadId: string }) => useLeadPhone(leadId), {
      initialProps: { leadId: 'lead-a' },
    });
    await rerender({ leadId: 'lead-b' });
    expect(result.current.phone).toBe(TEL_B);

    await act(async () => {
      resolve_a({ data: { users: { phone: TEL_A } }, error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.phone).toBe(TEL_B);
    expect(result.current.loading).toBe(false);
  });

  it('(EC-6b) rechazo_real_de_red_termina_con_error_neutro_y_loading_false', async () => {
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockRejectedValue(new TypeError('Network request failed')));

    const { result } = await renderHook(() => useLeadPhone(LEAD_ID));

    expect(result.current.error).toBe('No se pudo cargar el teléfono del lead.');
    expect(result.current.phone).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-9) leadId_null_o_undefined_no_llama_supabase_phone_null_sin_error_loading_false', async () => {
    const { result: result_null } = await renderHook(() => useLeadPhone(null));
    expect(mock_supabase_holder.client._mock_from).not.toHaveBeenCalled();
    expect(result_null.current.phone).toBeNull();
    expect(result_null.current.loading).toBe(false);
    expect(result_null.current.error).toBeNull();

    const { result: result_undefined } = await renderHook(() => useLeadPhone(undefined));
    expect(mock_supabase_holder.client._mock_from).not.toHaveBeenCalled();
    expect(result_undefined.current.phone).toBeNull();
  });

  it('(EC-10) unmount_durante_llamada_en_vuelo_no_aplica_estado_sin_warning', async () => {
    let resolve_maybe_single!: (value: QueryResult) => void;
    const pending = new Promise<QueryResult>((resolve) => {
      resolve_maybe_single = resolve;
    });
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending));

    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = await renderHook(() => useLeadPhone(LEAD_ID));

    let unmount_threw = false;
    try {
      await act(async () => {
        unmount();
      });
    } catch {
      unmount_threw = true;
    }
    expect(unmount_threw).toBe(false);

    await act(async () => {
      resolve_maybe_single({ data: { users: { phone: TELEFONO } }, error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(console_error_spy).not.toHaveBeenCalled();
    console_error_spy.mockRestore();
  });

  it('(EC-11) refetch_manual_redispara_la_query', async () => {
    const maybe_single = jest.fn().mockResolvedValue({ data: { users: { phone: TELEFONO } }, error: null });
    mock_supabase_holder.client = make_supabase_mock(maybe_single);

    const { result } = await renderHook(() => useLeadPhone(LEAD_ID));
    expect(maybe_single).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(maybe_single).toHaveBeenCalledTimes(2);
  });
});
