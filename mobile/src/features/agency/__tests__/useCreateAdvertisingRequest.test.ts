/**
 * Tests — useCreateAdvertisingRequest (subtarea 221.3)
 * Archivo SUT: mobile/src/features/agency/hooks/useCreateAdvertisingRequest.ts
 *
 * SEAM: useCreateAdvertisingRequest(deps?: {supabase?, onSuccess?}) → {
 *   submit(category), submitting, error
 * }
 * RPC: client.rpc('create_advertising_request', { p_proposed_category })
 * Errores P0001 con código embebido en error.message: NOT_OWNER |
 * ALREADY_PENDING | ALREADY_ADVERTISER.
 *
 * PATRÓN: DI directa vía deps.supabase con un objeto plano { rpc: jest.fn() }
 * (mismo criterio que useAdStats.test.tsx — no hace falta mockear el módulo
 * del cliente).
 *
 * EDGE CASES:
 * - (EC-1) exito_invoca_la_rpc_con_el_nombre_y_params_exactos
 * - (EC-2) exito_devuelve_ok_true_y_llama_onSuccess
 * - (EC-3) error_not_owner_produce_mensaje_en_espanol
 * - (EC-4) error_already_pending_produce_mensaje_distinto
 * - (EC-5) error_already_advertiser_produce_mensaje_distinto
 * - (EC-6) codigo_desconocido_cae_a_mensaje_generico
 * - (EC-7) rechazo_de_la_promesa_no_lanza_y_devuelve_mensaje_generico
 * - (EC-8) submitting_true_sincronamente_al_disparar
 * - (EC-9) submitting_false_tras_resolver
 * - (EC-10) onSuccess_no_se_llama_en_error
 * - (EC-11) no_doble_submit_segunda_llamada_en_vuelo_se_ignora (candado #233.4
 *   — el guardian de #221 encontró que solo la UI protegía el doble-submit;
 *   backstop = ALREADY_PENDING del servidor. Mismo patrón que EC-7 de
 *   useResolveRequest.test.ts: is_working_ref con early-return síncrono.)
 * - (EC-12) tras_error_resuelto_el_guard_se_libera_segunda_llamada_SI_invoca_rpc
 *   (candado del guardian tras EC-11: sin este caso, mover
 *   `is_working_ref.current = false` a solo la rama de éxito — dejando la
 *   rama de error sin liberar el guard — sobrevive con la suite en verde:
 *   el early-return de #233.4 devolvería {ok:false,error:null} EN SILENCIO
 *   para siempre tras el primer error.)
 * - (EC-13) tras_rechazo_de_la_promesa_el_guard_se_libera_segunda_llamada_SI_invoca_rpc
 *   (mismo hallazgo que EC-12 pero para la rama de rechazo — borrar el reset
 *   ahí también sobrevivía.)
 */

import { act, renderHook } from '@testing-library/react-native';

import { useCreateAdvertisingRequest } from '../hooks/useCreateAdvertisingRequest';

function make_client(result: unknown): { rpc: jest.Mock } {
  const resolved = result instanceof Promise ? result : Promise.resolve(result);
  return { rpc: jest.fn(() => resolved) };
}

describe('useCreateAdvertisingRequest', () => {
  it('EC-1: éxito invoca la RPC con nombre y params exactos', async () => {
    const client = make_client({ error: null });
    const { result } = await renderHook(() =>
      useCreateAdvertisingRequest({ supabase: client }),
    );
    await act(async () => {
      await result.current.submit('seguros');
    });
    expect(client.rpc).toHaveBeenCalledWith('create_advertising_request', {
      p_proposed_category: 'seguros',
    });
  });

  it('EC-2: éxito devuelve ok:true y llama onSuccess', async () => {
    const client = make_client({ error: null });
    const on_success = jest.fn();
    const { result } = await renderHook(() =>
      useCreateAdvertisingRequest({ supabase: client, onSuccess: on_success }),
    );
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.submit('seguros');
    });
    expect(outcome).toEqual({ ok: true, error: null });
    expect(on_success).toHaveBeenCalledTimes(1);
  });

  it('EC-3: NOT_OWNER produce mensaje en español', async () => {
    const client = make_client({ error: { message: 'NOT_OWNER' } });
    const { result } = await renderHook(() =>
      useCreateAdvertisingRequest({ supabase: client }),
    );
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.submit('seguros');
    });
    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toMatch(/dueño/i);
  });

  it('EC-4: ALREADY_PENDING produce mensaje distinto', async () => {
    const client = make_client({ error: { message: 'ALREADY_PENDING' } });
    const { result } = await renderHook(() =>
      useCreateAdvertisingRequest({ supabase: client }),
    );
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.submit('seguros');
    });
    expect(outcome?.error).toMatch(/en revisión/i);
  });

  it('EC-5: ALREADY_ADVERTISER produce mensaje distinto', async () => {
    const client = make_client({ error: { message: 'ALREADY_ADVERTISER' } });
    const { result } = await renderHook(() =>
      useCreateAdvertisingRequest({ supabase: client }),
    );
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.submit('seguros');
    });
    expect(outcome?.error).toMatch(/ya tiene/i);
  });

  it('EC-6: código desconocido cae a mensaje genérico', async () => {
    const client = make_client({ error: { message: 'WHATEVER' } });
    const { result } = await renderHook(() =>
      useCreateAdvertisingRequest({ supabase: client }),
    );
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.submit('seguros');
    });
    expect(outcome?.error).toMatch(/no se pudo enviar/i);
  });

  it('EC-7: rechazo de la promesa no lanza, mensaje genérico', async () => {
    const client = { rpc: jest.fn(() => Promise.reject(new Error('network'))) };
    const { result } = await renderHook(() =>
      useCreateAdvertisingRequest({ supabase: client }),
    );
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.submit('seguros');
    });
    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toMatch(/no se pudo enviar/i);
  });

  it('EC-8: submitting=true síncronamente al disparar', async () => {
    let resolve_fn: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      resolve_fn = r;
    });
    const client = make_client(pending);
    const { result } = await renderHook(() =>
      useCreateAdvertisingRequest({ supabase: client }),
    );

    let submit_promise: Promise<unknown> | undefined;
    act(() => {
      submit_promise = result.current.submit('seguros');
    });
    expect(result.current.submitting).toBe(true);

    await act(async () => {
      resolve_fn({ error: null });
      await submit_promise;
    });
  });

  it('EC-9: submitting=false tras resolver', async () => {
    const client = make_client({ error: null });
    const { result } = await renderHook(() =>
      useCreateAdvertisingRequest({ supabase: client }),
    );
    await act(async () => {
      await result.current.submit('seguros');
    });
    expect(result.current.submitting).toBe(false);
  });

  it('EC-10: onSuccess no se llama en error', async () => {
    const client = make_client({ error: { message: 'ALREADY_PENDING' } });
    const on_success = jest.fn();
    const { result } = await renderHook(() =>
      useCreateAdvertisingRequest({ supabase: client, onSuccess: on_success }),
    );
    await act(async () => {
      await result.current.submit('seguros');
    });
    expect(on_success).not.toHaveBeenCalled();
  });

  it('EC-11: no doble-submit — segunda llamada en vuelo se ignora', async () => {
    let resolve_fn: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      resolve_fn = r;
    });
    const client = make_client(pending);
    const { result } = await renderHook(() =>
      useCreateAdvertisingRequest({ supabase: client }),
    );

    let first: Promise<unknown> | undefined;
    let second: { ok: boolean; error: string | null } | undefined;
    act(() => {
      first = result.current.submit('seguros');
    });
    await act(async () => {
      second = await result.current.submit('seguros');
    });

    expect(second).toEqual({ ok: false, error: null });
    expect(client.rpc).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve_fn({ error: null });
      await first;
    });
  });

  it('EC-12: tras un error resuelto por la RPC, el guard se libera — la siguiente llamada SÍ invoca rpc de nuevo', async () => {
    const client = make_client({ error: { message: 'NOT_OWNER' } });
    const { result } = await renderHook(() =>
      useCreateAdvertisingRequest({ supabase: client }),
    );

    await act(async () => {
      await result.current.submit('seguros');
    });
    await act(async () => {
      await result.current.submit('seguros');
    });

    expect(client.rpc).toHaveBeenCalledTimes(2);
  });

  it('EC-13: tras un rechazo de la promesa, el guard se libera — la siguiente llamada SÍ invoca rpc de nuevo', async () => {
    const client = { rpc: jest.fn(() => Promise.reject(new Error('network'))) };
    const { result } = await renderHook(() =>
      useCreateAdvertisingRequest({ supabase: client }),
    );

    await act(async () => {
      await result.current.submit('seguros');
    });
    await act(async () => {
      await result.current.submit('seguros');
    });

    expect(client.rpc).toHaveBeenCalledTimes(2);
  });
});
