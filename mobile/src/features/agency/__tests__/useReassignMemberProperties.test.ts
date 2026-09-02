/**
 * Tests — useReassignMemberProperties (subtarea 203.2)
 * Archivo SUT: mobile/src/features/agency/hooks/useReassignMemberProperties.ts
 *
 * SEAM: useReassignMemberProperties(deps?: {supabase?, onSuccess?}) → {
 *   submit(p_agency_id, p_from_user_id, p_to_user_id), submitting, error
 * }
 * RPC: client.rpc('reassign_member_properties_atomic', { p_agency_id, p_from_user_id, p_to_user_id })
 *
 * 🔴 CONTRATO PINNEADO (backend en paralelo, subtarea 203.1, otra rama):
 * `reassign_member_properties_atomic(p_agency_id uuid, p_from_user_id uuid,
 * p_to_user_id uuid) returns integer` — el entero es el conteo de
 * propiedades reasignadas (0 NO es error). Errores P0001 con el código
 * EMBEBIDO en `error.message`: NOT_AUTHENTICATED | NOT_AUTHORIZED |
 * SAME_USER | TARGET_NOT_ACTIVE_MEMBER. Mismo criterio de parseo que
 * usePromoteProperty/useCreateAdvertisingRequest (`error.message.includes(code)`).
 *
 * PATRÓN: calca usePromoteProperty — is_working_ref (gatea Y refleja el
 * estado — un segundo submit mientras el primero está en vuelo es un
 * no-op) + force_update síncrono ANTES del primer await, DI del cliente vía
 * `deps.supabase`, getters en el objeto retornado. `client.rpc(...)` se
 * llama DIRECTO, nunca desprendido (#205) — el doble es el de
 * `@/test-utils/supabaseMock` (candado #233.3): `rpc()` lee `this` y LANZA
 * si se invoca desprendido, así que un GREEN que desprendiera la llamada
 * real ya no puede sobrevivir con la suite en verde.
 *
 * EDGE CASES:
 * - (EC-1) exito_invoca_la_rpc_con_el_nombre_y_params_exactos
 * - (EC-2) exito_devuelve_ok_true_count_y_llama_onSuccess_con_el_count
 * - (EC-3) exito_con_count_cero_sigue_siendo_ok_true_no_es_error (0 NO es error)
 * - (EC-4) error_not_authorized_produce_mensaje_en_espanol
 * - (EC-5) error_target_not_active_member_produce_mensaje_distinto
 * - (EC-6) error_same_user_produce_mensaje_distinto
 * - (EC-7) codigo_desconocido_not_authenticated_cae_a_mensaje_generico
 * - (EC-8) rechazo_de_la_promesa_no_lanza_y_devuelve_mensaje_generico
 * - (EC-9) submitting_true_sincronamente_al_disparar
 * - (EC-10) submitting_false_tras_resolver
 * - (EC-11) onSuccess_no_se_llama_en_error
 * - (EC-12) doble_submit_concurrente_solo_dispara_una_rpc (is_working_ref)
 * - (EC-13a) tras_un_error_de_la_rpc_el_guard_se_libera_la_siguiente_llamada_SI_invoca_rpc
 * - (EC-13b) tras_un_rechazo_de_la_promesa_el_guard_se_libera_la_siguiente_llamada_SI_invoca_rpc
 */

import { act, renderHook } from '@testing-library/react-native';

import { make_binding_sensitive_supabase_mock } from '@/test-utils/supabaseMock';

import { useReassignMemberProperties } from '../hooks/useReassignMemberProperties';

const P_AGENCY_ID = 'agencia-uuid-203-reassign';
const P_FROM_USER_ID = 'user-uuid-203-suspendido';
const P_TO_USER_ID = 'user-uuid-203-activo';

/**
 * `client` es el doble sensible al binding (candado #233.3) para inyectar
 * como `deps.supabase`; `rpc` es el spy real sobre el que se asertan las
 * llamadas — nunca `client.rpc` directo, que ya no es un jest.fn sino el
 * método que lanza si se desprende.
 */
function make_client(result: unknown): { client: unknown; rpc: jest.Mock } {
  const resolved = result instanceof Promise ? result : Promise.resolve(result);
  const { client, _mock_rpc } = make_binding_sensitive_supabase_mock({ rpc: () => resolved });
  return { client, rpc: _mock_rpc };
}

async function submit_default(client: unknown) {
  const { result } = await renderHook(() =>
    useReassignMemberProperties({ supabase: client })
  );
  let outcome: { ok: boolean; count: number | null; error: string | null } | undefined;
  await act(async () => {
    outcome = await result.current.submit(P_AGENCY_ID, P_FROM_USER_ID, P_TO_USER_ID);
  });
  return { result, outcome };
}

describe('useReassignMemberProperties', () => {
  it('EC-1: éxito invoca la RPC con nombre y params exactos', async () => {
    const { client, rpc } = make_client({ data: 3, error: null });
    await submit_default(client);
    expect(rpc).toHaveBeenCalledWith('reassign_member_properties_atomic', {
      p_agency_id: P_AGENCY_ID,
      p_from_user_id: P_FROM_USER_ID,
      p_to_user_id: P_TO_USER_ID,
    });
  });

  it('EC-2: éxito devuelve ok:true, count y llama onSuccess con el count', async () => {
    const { client } = make_client({ data: 3, error: null });
    const on_success = jest.fn();
    const { result } = await renderHook(() =>
      useReassignMemberProperties({ supabase: client, onSuccess: on_success })
    );
    let outcome: { ok: boolean; count: number | null; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.submit(P_AGENCY_ID, P_FROM_USER_ID, P_TO_USER_ID);
    });
    expect(outcome).toEqual({ ok: true, count: 3, error: null });
    expect(on_success).toHaveBeenCalledWith(3);
  });

  it('EC-3: count=0 sigue siendo ok:true — 0 NO es error', async () => {
    const { client } = make_client({ data: 0, error: null });
    const on_success = jest.fn();
    const { result } = await renderHook(() =>
      useReassignMemberProperties({ supabase: client, onSuccess: on_success })
    );
    let outcome: { ok: boolean; count: number | null; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.submit(P_AGENCY_ID, P_FROM_USER_ID, P_TO_USER_ID);
    });
    expect(outcome).toEqual({ ok: true, count: 0, error: null });
    expect(on_success).toHaveBeenCalledWith(0);
  });

  it('EC-4: NOT_AUTHORIZED produce mensaje en español', async () => {
    const { client } = make_client({ data: null, error: { message: 'NOT_AUTHORIZED' } });
    const { outcome } = await submit_default(client);
    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toBe('No tienes permiso para reasignar en esta inmobiliaria');
  });

  it('EC-5: TARGET_NOT_ACTIVE_MEMBER produce mensaje distinto', async () => {
    const { client } = make_client({
      data: null,
      error: { message: 'TARGET_NOT_ACTIVE_MEMBER' },
    });
    const { outcome } = await submit_default(client);
    expect(outcome?.error).toBe('Ese miembro no está activo en la inmobiliaria');
  });

  it('EC-6: SAME_USER produce mensaje distinto', async () => {
    const { client } = make_client({ data: null, error: { message: 'SAME_USER' } });
    const { outcome } = await submit_default(client);
    expect(outcome?.error).toBe('Elige un miembro distinto');
  });

  it('EC-7: código desconocido (NOT_AUTHENTICATED) cae a mensaje genérico', async () => {
    const { client } = make_client({ data: null, error: { message: 'NOT_AUTHENTICATED' } });
    const { outcome } = await submit_default(client);
    expect(outcome?.error).toBe('No se pudo reasignar');
  });

  it('EC-8: rechazo de la promesa no lanza, mensaje genérico', async () => {
    const { client } = make_binding_sensitive_supabase_mock({
      rpc: () => Promise.reject(new Error('network')),
    });
    const { result } = await renderHook(() =>
      useReassignMemberProperties({ supabase: client })
    );
    let outcome: { ok: boolean; count: number | null; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.submit(P_AGENCY_ID, P_FROM_USER_ID, P_TO_USER_ID);
    });
    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toMatch(/no se pudo reasignar/i);
  });

  it('EC-9: submitting=true síncronamente al disparar', async () => {
    let resolve_fn: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      resolve_fn = r;
    });
    const { client } = make_client(pending);
    const { result } = await renderHook(() =>
      useReassignMemberProperties({ supabase: client })
    );

    let submit_promise: Promise<unknown> | undefined;
    act(() => {
      submit_promise = result.current.submit(P_AGENCY_ID, P_FROM_USER_ID, P_TO_USER_ID);
    });
    expect(result.current.submitting).toBe(true);

    await act(async () => {
      resolve_fn({ data: 1, error: null });
      await submit_promise;
    });
  });

  it('EC-10: submitting=false tras resolver', async () => {
    const { client } = make_client({ data: 1, error: null });
    const { result } = await submit_default(client);
    expect(result.current.submitting).toBe(false);
  });

  it('EC-11: onSuccess no se llama en error', async () => {
    const { client } = make_client({ data: null, error: { message: 'SAME_USER' } });
    const on_success = jest.fn();
    const { result } = await renderHook(() =>
      useReassignMemberProperties({ supabase: client, onSuccess: on_success })
    );
    await act(async () => {
      await result.current.submit(P_AGENCY_ID, P_FROM_USER_ID, P_TO_USER_ID);
    });
    expect(on_success).not.toHaveBeenCalled();
  });

  it('EC-12: doble submit concurrente solo dispara una RPC', async () => {
    let resolve_fn: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      resolve_fn = r;
    });
    const { client, rpc } = make_client(pending);
    const { result } = await renderHook(() =>
      useReassignMemberProperties({ supabase: client })
    );

    let first: Promise<unknown> | undefined;
    let second: Promise<unknown> | undefined;
    act(() => {
      first = result.current.submit(P_AGENCY_ID, P_FROM_USER_ID, P_TO_USER_ID);
      second = result.current.submit(P_AGENCY_ID, P_FROM_USER_ID, P_TO_USER_ID);
    });

    expect(rpc).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve_fn({ data: 1, error: null });
      await Promise.all([first, second]);
    });
  });

  it('EC-13a: tras un error de la RPC, el guard se libera — la siguiente llamada SÍ invoca rpc de nuevo', async () => {
    const { client, rpc } = make_client({ data: null, error: { message: 'SAME_USER' } });
    const { result } = await renderHook(() =>
      useReassignMemberProperties({ supabase: client })
    );

    await act(async () => {
      await result.current.submit(P_AGENCY_ID, P_FROM_USER_ID, P_TO_USER_ID);
    });
    expect(result.current.submitting).toBe(false);

    await act(async () => {
      await result.current.submit(P_AGENCY_ID, P_FROM_USER_ID, P_TO_USER_ID);
    });

    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('EC-13b: tras un rechazo de la promesa, el guard se libera — la siguiente llamada SÍ invoca rpc de nuevo', async () => {
    const { client, _mock_rpc: rpc } = make_binding_sensitive_supabase_mock({
      rpc: jest
        .fn()
        .mockImplementationOnce(() => Promise.reject(new Error('network')))
        .mockImplementationOnce(() => Promise.resolve({ data: 1, error: null })),
    });

    const { result } = await renderHook(() =>
      useReassignMemberProperties({ supabase: client })
    );

    await act(async () => {
      await result.current.submit(P_AGENCY_ID, P_FROM_USER_ID, P_TO_USER_ID);
    });
    expect(result.current.submitting).toBe(false);

    await act(async () => {
      await result.current.submit(P_AGENCY_ID, P_FROM_USER_ID, P_TO_USER_ID);
    });

    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
