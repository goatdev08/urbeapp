/**
 * Tests fase RED — useReassignLead (subtarea 269.5, CRM vista de agencia,
 * exploración 045 fase E).
 * Archivo SUT: mobile/src/features/leads/hooks/useReassignLead.ts (STUB
 * que lanza 'not_implemented' — la implementación real es el GREEN).
 *
 * SEAM bajo test: la firma pública del hook —
 *   useReassignLead(options?) → { reassign(lead_id, to_agent), busy }
 * — y el contrato exacto de la RPC `reassign_lead_atomic`
 * (migración 20260906400002_reassign_lead_atomic.sql, subtarea 269.2):
 * params `p_lead_id/p_to_agent`, returns void, errores P0001 con el
 * código EMBEBIDO en `error.message` (verificado leyendo la migración, no
 * asumido): NOT_AUTHENTICATED | LEAD_NOT_FOUND | SAME_USER |
 * TARGET_NOT_ACTIVE_MEMBER.
 *
 * Molde EXACTO: mobile/src/features/agency/hooks/useReassignMemberProperties.ts
 * + su test (mismo dominio "reasignar", mismo criterio de parseo
 * `error.message.includes(code)`, mismo guard is_working_ref que GATEA la
 * llamada — no solo la refleja — y mismo doble sensible al binding
 * `make_binding_sensitive_supabase_mock`, `@/test-utils/supabaseMock`,
 * candado #233.3, memoria supabase_js_metodo_desprendido).
 *
 * DECISIONES DE DISEÑO DEL CONTRATO (D-XXX de esta subtarea):
 * - D-SIGNATURE: `useReassignLead(options?: { on_changed?: () => void })`
 *   — SIN DI de `supabase` (a diferencia de useReassignMemberProperties):
 *   el plan de 269.5 fija esta firma exacta; el hook importa el cliente
 *   singleton vía `@/lib/supabase/client` (mismo patrón de import que
 *   useCrmFunnel/useCrmAgencyOverview), interceptado aquí con
 *   jest.mock + el doble sensible al binding.
 * - D-RETURN: éxito → `{ok: true}` (sin `message`); error → `{ok: false,
 *   message: string}`. Nunca lanza (ninguna rama produce una promesa
 *   rechazada hacia el caller).
 * - D-MAP: los 3 códigos EXTENDIDOS de esta subtarea (SAME_USER,
 *   TARGET_NOT_ACTIVE_MEMBER, LEAD_NOT_FOUND) tienen mensaje ESPECÍFICO en
 *   español, sin PII; NOT_AUTHENTICATED es un código real de la RPC pero
 *   NO está en la lista de códigos a extender de esta subtarea → cae al
 *   FALLBACK genérico (mismo criterio que useReassignMemberProperties
 *   EC-7, donde NOT_AUTHENTICATED tampoco está en su ERROR_MESSAGES).
 *   LEAD_NOT_FOUND reusa el MISMO texto que LEAD_EF_ERROR_MESSAGES.LEAD_NOT_FOUND
 *   (lead_error_messages.ts) — mismo lead, mismo mensaje, sin importar si
 *   el error nace de una EF o de esta RPC.
 * - D-NETWORK: la promesa de `rpc(...)` RECHAZADA (network/timeout) es un
 *   caso DISTINTO del código desconocido — mismo criterio que
 *   map_lead_ef_error(undefined): mensaje de "no se pudo conectar", no el
 *   genérico de "ocurrió un error".
 * - D-BUSY: `is_working_ref` GATEA (no solo refleja) — un segundo
 *   `reassign()` mientras el primero sigue en vuelo es un no-op:
 *   `{ok: false, message: null}` SIN invocar la rpc una segunda vez
 *   (molde EC-12 de useReassignMemberProperties). El guard se libera tras
 *   CUALQUIER resolución (éxito, error de rpc, o rechazo) — la siguiente
 *   llamada SÍ dispara la rpc de nuevo.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) exito_invoca_reassign_lead_atomic_con_params_exactos
 * - (EC-2) exito_devuelve_ok_true_sin_message
 * - (EC-3) exito_llama_on_changed_una_vez
 * - (EC-4) exito_busy_false_tras_resolver
 * - (EC-5) on_changed_opcional_no_provisto_no_lanza_en_exito
 *
 * ### Mapeo de errores (P0001, código embebido en error.message)
 * - (EC-6) error_same_user_mensaje_en_espanol_exacto
 * - (EC-7) error_target_not_active_member_mensaje_distinto
 * - (EC-8) error_lead_not_found_mensaje_distinto_reusa_texto_de_ef_lead_not_found
 * - (EC-9) error_codigo_desconocido_not_authenticated_cae_a_mensaje_generico
 * - (EC-10) rechazo_de_la_promesa_no_lanza_mensaje_de_conexion_distinto_del_generico
 * - (EC-11) on_changed_no_se_llama_en_ningun_camino_de_error
 *
 * ### Busy / re-entrancia (D-BUSY)
 * - (EC-12) busy_true_sincronamente_al_disparar
 * - (EC-13) doble_llamada_concurrente_solo_dispara_una_rpc_segunda_devuelve_ok_false_sin_message
 * - (EC-14) tras_error_de_rpc_el_guard_se_libera_la_siguiente_llamada_si_invoca_rpc
 * - (EC-15) tras_rechazo_de_la_promesa_el_guard_se_libera_la_siguiente_llamada_si_invoca_rpc
 *
 * ### Seam de binding
 * - (EC-16) rpc_se_invoca_con_this_intacto_no_lanza_por_desprendimiento
 */

import { act, renderHook } from '@testing-library/react-native';

import { make_binding_sensitive_supabase_mock } from '@/test-utils/supabaseMock';

import { useReassignLead } from '../hooks/useReassignLead';
import type { ReassignLeadResult } from '../hooks/useReassignLead';

// ---------------------------------------------------------------------------
// Mock del cliente Supabase — sensible al binding (candado #233.3)
// ---------------------------------------------------------------------------

const mock_supabase_holder: { bundle: ReturnType<typeof make_binding_sensitive_supabase_mock> | null } = {
  bundle: null,
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.bundle?.client;
  },
}));

// ---------------------------------------------------------------------------
// Constantes de test — fuente independiente del SUT
// ---------------------------------------------------------------------------

const LEAD_ID = 'lead-uuid-269-5-reassign';
const TO_AGENT_ID = 'agent-uuid-269-5-destino';

// Literales de mensaje EN ESPAÑOL fijados por ESTE test (D-MAP) —
// independientes de cualquier mapa de la implementación: si el GREEN usa
// otro texto, este test lo detecta como regresión real. LEAD_NOT_FOUND
// reusa deliberadamente el MISMO texto que LEAD_EF_ERROR_MESSAGES.LEAD_NOT_FOUND
// (mobile/src/features/leads/lead_error_messages.ts) — mismo lead, mismo
// mensaje sin importar el origen del error.
const MSG_SAME_USER = 'Ese lead ya está asignado a esa persona.';
const MSG_TARGET_NOT_ACTIVE_MEMBER = 'Ese agente ya no está activo en la inmobiliaria.';
const MSG_LEAD_NOT_FOUND = 'Este lead ya no existe o fue eliminado.';
const MSG_GENERIC_FALLBACK = 'Ocurrió un error. Intenta de nuevo.';
const MSG_NETWORK = 'No se pudo conectar. Verifica tu conexión e intenta de nuevo.';

function make_bundle(
  rpc_impl: () => Promise<{ data: null; error: { message: string } | null }> = () =>
    Promise.resolve({ data: null, error: null }),
) {
  return make_binding_sensitive_supabase_mock({ rpc: rpc_impl });
}

beforeEach(() => {
  jest.clearAllMocks();
  mock_supabase_holder.bundle = make_bundle();
});

async function reassign_default() {
  const { result } = await renderHook(() => useReassignLead());
  let outcome: ReassignLeadResult | undefined;
  await act(async () => {
    outcome = await result.current.reassign(LEAD_ID, TO_AGENT_ID);
  });
  return { result, outcome };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useReassignLead', () => {
  it('(EC-1) exito_invoca_reassign_lead_atomic_con_params_exactos', async () => {
    await reassign_default();

    expect(mock_supabase_holder.bundle!._mock_rpc).toHaveBeenCalledTimes(1);
    expect(mock_supabase_holder.bundle!._mock_rpc).toHaveBeenCalledWith('reassign_lead_atomic', {
      p_lead_id: LEAD_ID,
      p_to_agent: TO_AGENT_ID,
    });
  });

  it('(EC-2) exito_devuelve_ok_true_sin_message', async () => {
    const { outcome } = await reassign_default();

    expect(outcome).toEqual({ ok: true });
  });

  it('(EC-3) exito_llama_on_changed_una_vez', async () => {
    const on_changed = jest.fn();
    const { result } = await renderHook(() => useReassignLead({ on_changed }));

    await act(async () => {
      await result.current.reassign(LEAD_ID, TO_AGENT_ID);
    });

    expect(on_changed).toHaveBeenCalledTimes(1);
  });

  it('(EC-4) exito_busy_false_tras_resolver', async () => {
    const { result } = await reassign_default();
    expect(result.current.busy).toBe(false);
  });

  it('(EC-5) on_changed_opcional_no_provisto_no_lanza_en_exito', async () => {
    const { result } = await renderHook(() => useReassignLead());
    let threw = false;
    await act(async () => {
      try {
        await result.current.reassign(LEAD_ID, TO_AGENT_ID);
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
  });

  it('(EC-6) error_same_user_mensaje_en_espanol_exacto', async () => {
    mock_supabase_holder.bundle = make_bundle(() =>
      Promise.resolve({ data: null, error: { message: 'SAME_USER' } }),
    );
    const { outcome } = await reassign_default();

    expect(outcome).toEqual({ ok: false, message: MSG_SAME_USER });
  });

  it('(EC-7) error_target_not_active_member_mensaje_distinto', async () => {
    mock_supabase_holder.bundle = make_bundle(() =>
      Promise.resolve({ data: null, error: { message: 'TARGET_NOT_ACTIVE_MEMBER' } }),
    );
    const { outcome } = await reassign_default();

    expect(outcome).toEqual({ ok: false, message: MSG_TARGET_NOT_ACTIVE_MEMBER });
    expect(outcome?.ok === false && outcome.message).not.toBe(MSG_SAME_USER);
  });

  it('(EC-8) error_lead_not_found_mensaje_distinto_reusa_texto_de_ef_lead_not_found', async () => {
    mock_supabase_holder.bundle = make_bundle(() =>
      Promise.resolve({ data: null, error: { message: 'LEAD_NOT_FOUND' } }),
    );
    const { outcome } = await reassign_default();

    expect(outcome).toEqual({ ok: false, message: MSG_LEAD_NOT_FOUND });
  });

  it('(EC-9) error_codigo_desconocido_not_authenticated_cae_a_mensaje_generico', async () => {
    mock_supabase_holder.bundle = make_bundle(() =>
      Promise.resolve({ data: null, error: { message: 'NOT_AUTHENTICATED' } }),
    );
    const { outcome } = await reassign_default();

    expect(outcome).toEqual({ ok: false, message: MSG_GENERIC_FALLBACK });
  });

  it('(EC-10) rechazo_de_la_promesa_no_lanza_mensaje_de_conexion_distinto_del_generico', async () => {
    mock_supabase_holder.bundle = make_binding_sensitive_supabase_mock({
      rpc: () => Promise.reject(new Error('network down')),
    });

    const { result } = await renderHook(() => useReassignLead());
    let outcome: ReassignLeadResult | undefined;
    let threw = false;
    await act(async () => {
      try {
        outcome = await result.current.reassign(LEAD_ID, TO_AGENT_ID);
      } catch {
        threw = true;
      }
    });

    expect(threw).toBe(false);
    expect(outcome).toEqual({ ok: false, message: MSG_NETWORK });
    expect(outcome?.ok === false && outcome.message).not.toBe(MSG_GENERIC_FALLBACK);
  });

  it('(EC-11) on_changed_no_se_llama_en_ningun_camino_de_error', async () => {
    mock_supabase_holder.bundle = make_bundle(() =>
      Promise.resolve({ data: null, error: { message: 'SAME_USER' } }),
    );
    const on_changed = jest.fn();
    const { result } = await renderHook(() => useReassignLead({ on_changed }));

    await act(async () => {
      await result.current.reassign(LEAD_ID, TO_AGENT_ID);
    });

    expect(on_changed).not.toHaveBeenCalled();
  });

  it('(EC-12) busy_true_sincronamente_al_disparar', async () => {
    let resolve_fn: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      resolve_fn = r;
    });
    mock_supabase_holder.bundle = make_bundle(() => pending as Promise<{ data: null; error: null }>);

    const { result } = await renderHook(() => useReassignLead());

    let reassign_promise: Promise<unknown> | undefined;
    act(() => {
      reassign_promise = result.current.reassign(LEAD_ID, TO_AGENT_ID);
    });
    expect(result.current.busy).toBe(true);

    await act(async () => {
      resolve_fn({ data: null, error: null });
      await reassign_promise;
    });
  });

  it('(EC-13) doble_llamada_concurrente_solo_dispara_una_rpc_segunda_devuelve_ok_false_sin_message', async () => {
    let resolve_fn: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      resolve_fn = r;
    });
    mock_supabase_holder.bundle = make_bundle(() => pending as Promise<{ data: null; error: null }>);

    const { result } = await renderHook(() => useReassignLead());

    let first: Promise<ReassignLeadResult> | undefined;
    let second: Promise<ReassignLeadResult> | undefined;
    act(() => {
      first = result.current.reassign(LEAD_ID, TO_AGENT_ID);
      second = result.current.reassign(LEAD_ID, TO_AGENT_ID);
    });

    expect(mock_supabase_holder.bundle!._mock_rpc).toHaveBeenCalledTimes(1);

    let second_outcome: ReassignLeadResult | undefined;
    await act(async () => {
      resolve_fn({ data: null, error: null });
      const [, second_result] = await Promise.all([first, second]);
      second_outcome = second_result;
    });

    expect(second_outcome).toEqual({ ok: false, message: null });
  });

  it('(EC-14) tras_error_de_rpc_el_guard_se_libera_la_siguiente_llamada_si_invoca_rpc', async () => {
    mock_supabase_holder.bundle = make_bundle(() =>
      Promise.resolve({ data: null, error: { message: 'SAME_USER' } }),
    );
    const { result } = await renderHook(() => useReassignLead());

    await act(async () => {
      await result.current.reassign(LEAD_ID, TO_AGENT_ID);
    });
    expect(result.current.busy).toBe(false);

    await act(async () => {
      await result.current.reassign(LEAD_ID, TO_AGENT_ID);
    });

    expect(mock_supabase_holder.bundle!._mock_rpc).toHaveBeenCalledTimes(2);
  });

  it('(EC-15) tras_rechazo_de_la_promesa_el_guard_se_libera_la_siguiente_llamada_si_invoca_rpc', async () => {
    const rpc = jest
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error('network')))
      .mockImplementationOnce(() => Promise.resolve({ data: null, error: null }));
    mock_supabase_holder.bundle = make_binding_sensitive_supabase_mock({ rpc });

    const { result } = await renderHook(() => useReassignLead());

    await act(async () => {
      await result.current.reassign(LEAD_ID, TO_AGENT_ID);
    });
    expect(result.current.busy).toBe(false);

    await act(async () => {
      await result.current.reassign(LEAD_ID, TO_AGENT_ID);
    });

    expect(mock_supabase_holder.bundle!._mock_rpc).toHaveBeenCalledTimes(2);
  });

  it('(EC-16) rpc_se_invoca_con_this_intacto_no_lanza_por_desprendimiento', async () => {
    // El doble sensible al binding LANZA un TypeError si el SUT desprende
    // client.rpc del cliente (candado #233.3) — si el GREEN escribe
    // `const {rpc} = supabase; rpc(...)`, este test falla con el TypeError
    // del guard, no con una aserción de negocio.
    const { outcome } = await reassign_default();
    expect(outcome).toEqual({ ok: true });
    expect(mock_supabase_holder.bundle!._mock_rpc).toHaveBeenCalledTimes(1);
  });
});
