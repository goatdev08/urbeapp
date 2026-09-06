/**
 * Tests fase RED — useCrmSuggestedMessage (subtarea 267.4, tarea #267 "CRM UI
 * agente").
 * Archivo SUT: mobile/src/features/leads/hooks/useCrmSuggestedMessage.ts
 * (STUB que lanza 'not_implemented' — la implementación real es el GREEN).
 *
 * SEAM bajo test: la firma pública del hook —
 *   useCrmSuggestedMessage(leadId) → { message, loading, error, refetch }
 * — y el contrato exacto de la RPC escalar `crm_suggested_message`
 * (migración 20260906200001_crm_suggested_message.sql, subtarea 267.4,
 * pgTAP: supabase/tests/105_crm_suggested_message_test.sql): param
 * `p_lead_id`, `data` es `string | null` DIRECTO (RPC escalar, NUNCA un
 * array — a diferencia de crm_lead_detail que es SETOF).
 *
 * DECISIONES DE DISEÑO DEL CONTRATO (D-XXX de esta subtarea):
 * - D-INITIAL: loading = Boolean(leadId) en el primer render (sonda), igual
 *   que useCrmLeadDetail.
 * - Molde useCrmLeadDetail.ts / useLeadStats.ts: UNA sola llamada
 *   `supabase.rpc`, error neutro en español, deps por contenido.
 * - D-ESCALAR: `rpc_result.data` se asigna DIRECTO a `message` (string |
 *   null) — no hay indexación `[0]` como en crm_lead_detail (SETOF).
 * - D-SINMSG: `data: null` (lead cerrado o no autorizado — D-AUTZ-SHARED
 *   fail-closed de la RPC) → message=null SIN error (silencioso, anti-IDOR,
 *   mismo criterio D-SINFILA de useCrmLeadDetail).
 * - D-ERROR: error de RPC → mensaje neutro en español
 *   'No se pudo cargar el mensaje sugerido.' — nunca el texto crudo de
 *   PostgREST/Postgres.
 *
 * PATRÓN DE MOCK: '@/lib/supabase/client' con mock_supabase_holder + getter
 * (idéntico a useCrmLeadDetail.test.ts); renderHook/act con `await` (RNTL
 * 14); unmount() dentro de act(); sonda del primer render (array
 * render_states). Reloj fijo con jest.useFakeTimers().setSystemTime en
 * TODOS los casos (regla del repo, aunque este hook no lea Date) — evita que
 * un futuro uso de fecha en el mensaje (p. ej. "hace N días") cuele un test
 * bomba de fecha.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) estado_inicial_antes_del_efecto_message_null_loading_true_sin_error
 * - (EC-2) llama_crm_suggested_message_con_params_exactos
 * - (EC-3) exito_mapea_el_string_directo_D_ESCALAR
 *
 * ### Ramas de reglas no obvias
 * - (EC-4) data_null_cerrado_o_no_autorizado_message_null_sin_error_D_SINMSG
 * - (EC-5) error_de_rpc_mensaje_neutro_en_espanol_message_null_D_ERROR
 *
 * ### Deps por contenido / estabilidad
 * - (EC-6) rerender_con_el_mismo_leadId_no_dispara_otra_llamada
 * - (EC-7) cambiar_leadId_dispara_una_llamada_nueva_y_reinicia_message
 *
 * ### Boundary / error
 * - (EC-8) leadId_null_o_undefined_no_llama_rpc_message_null_sin_error_loading_false
 * - (EC-9) unmount_durante_llamada_en_vuelo_no_aplica_estado_sin_warning
 * - (EC-10) refetch_manual_redispara_la_rpc
 */

import { renderHook, act } from '@testing-library/react-native';

import { useCrmSuggestedMessage } from '../hooks/useCrmSuggestedMessage';

// ---------------------------------------------------------------------------
// Mock del cliente Supabase
// ---------------------------------------------------------------------------

type MockSupabaseClient = { rpc: jest.Mock };

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

const LEAD_ID = 'lead-uuid-267-4-suggested';

const MENSAJE_SUGERIDO =
  'Hola Karla, vi que te interesó la propiedad de Av. Independencia 450, Guadalajara. ¿Te gustaría agendar una visita?';

function make_supabase_mock(
  rpc_impl: jest.Mock = jest.fn().mockResolvedValue({ data: MENSAJE_SUGERIDO, error: null }),
): MockSupabaseClient {
  return { rpc: rpc_impl };
}

beforeEach(() => {
  // Reloj fijo en TODOS los casos (regla del repo) aunque este hook no lea
  // Date — evita un test-bomba-de-fecha si el mensaje llega a incorporar
  // fecha relativa más adelante.
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

describe('useCrmSuggestedMessage', () => {
  it('(EC-1) estado_inicial_antes_del_efecto_message_null_loading_true_sin_error', async () => {
    const pending = new Promise<never>(() => {});
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending));

    const render_states: ReturnType<typeof useCrmSuggestedMessage>[] = [];
    function useProbe() {
      const state = useCrmSuggestedMessage(LEAD_ID);
      render_states.push(state);
      return state;
    }

    await renderHook(() => useProbe());

    const first = render_states[0]!;
    expect(first.message).toBeNull();
    expect(first.loading).toBe(true);
    expect(first.error).toBeNull();
  });

  it('(EC-2) llama_crm_suggested_message_con_params_exactos', async () => {
    await renderHook(() => useCrmSuggestedMessage(LEAD_ID));

    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledTimes(1);
    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledWith('crm_suggested_message', {
      p_lead_id: LEAD_ID,
    });
  });

  it('(EC-3) exito_mapea_el_string_directo_D_ESCALAR', async () => {
    const { result } = await renderHook(() => useCrmSuggestedMessage(LEAD_ID));

    expect(result.current.message).toBe(MENSAJE_SUGERIDO);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('(EC-4) data_null_cerrado_o_no_autorizado_message_null_sin_error_D_SINMSG', async () => {
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockResolvedValue({ data: null, error: null }));

    const { result } = await renderHook(() => useCrmSuggestedMessage(LEAD_ID));

    expect(result.current.message).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-5) error_de_rpc_mensaje_neutro_en_espanol_message_null_D_ERROR', async () => {
    const RAW_PG_MESSAGE = 'permission denied for function crm_suggested_message';
    mock_supabase_holder.client = make_supabase_mock(
      jest.fn().mockResolvedValue({ data: null, error: { message: RAW_PG_MESSAGE } }),
    );

    const { result } = await renderHook(() => useCrmSuggestedMessage(LEAD_ID));

    expect(result.current.error).toBe('No se pudo cargar el mensaje sugerido.');
    expect(result.current.error).not.toBe(RAW_PG_MESSAGE);
    expect(result.current.message).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-6) rerender_con_el_mismo_leadId_no_dispara_otra_llamada', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: MENSAJE_SUGERIDO, error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { rerender } = await renderHook(({ leadId }: { leadId: string }) => useCrmSuggestedMessage(leadId), {
      initialProps: { leadId: LEAD_ID },
    });
    expect(rpc).toHaveBeenCalledTimes(1);

    await rerender({ leadId: LEAD_ID });

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('(EC-7) cambiar_leadId_dispara_una_llamada_nueva_y_reinicia_message', async () => {
    const OTRO_MENSAJE = 'Hola Diego, vi que te interesó una de mis propiedades. ¿Te gustaría agendar una visita?';
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: MENSAJE_SUGERIDO, error: null })
      .mockResolvedValueOnce({ data: OTRO_MENSAJE, error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result, rerender } = await renderHook(({ leadId }: { leadId: string }) => useCrmSuggestedMessage(leadId), {
      initialProps: { leadId: LEAD_ID },
    });
    expect(result.current.message).toBe(MENSAJE_SUGERIDO);

    await rerender({ leadId: 'lead-uuid-267-4-otro' });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith('crm_suggested_message', { p_lead_id: 'lead-uuid-267-4-otro' });
    expect(result.current.message).toBe(OTRO_MENSAJE);
  });

  it('(EC-8) leadId_null_o_undefined_no_llama_rpc_message_null_sin_error_loading_false', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: MENSAJE_SUGERIDO, error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result: result_null } = await renderHook(() => useCrmSuggestedMessage(null));
    expect(rpc).not.toHaveBeenCalled();
    expect(result_null.current.message).toBeNull();
    expect(result_null.current.loading).toBe(false);
    expect(result_null.current.error).toBeNull();

    const { result: result_undefined } = await renderHook(() => useCrmSuggestedMessage(undefined));
    expect(rpc).not.toHaveBeenCalled();
    expect(result_undefined.current.message).toBeNull();
  });

  it('(EC-9) unmount_durante_llamada_en_vuelo_no_aplica_estado_sin_warning', async () => {
    let resolve_rpc!: (value: { data: string; error: null }) => void;
    const pending = new Promise<{ data: string; error: null }>((resolve) => {
      resolve_rpc = resolve;
    });
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending));

    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = await renderHook(() => useCrmSuggestedMessage(LEAD_ID));

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
      resolve_rpc({ data: MENSAJE_SUGERIDO, error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(console_error_spy).not.toHaveBeenCalled();
    console_error_spy.mockRestore();
  });

  it('(EC-10) refetch_manual_redispara_la_rpc', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: MENSAJE_SUGERIDO, error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result } = await renderHook(() => useCrmSuggestedMessage(LEAD_ID));
    expect(rpc).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
