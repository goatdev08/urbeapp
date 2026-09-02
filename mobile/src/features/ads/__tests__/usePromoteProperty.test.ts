/**
 * Tests — usePromoteProperty (subtarea 213.4)
 * Archivo SUT: mobile/src/features/ads/hooks/usePromoteProperty.ts
 *
 * SEAM: usePromoteProperty(deps?: {supabase?, onSuccess?}) → {
 *   submit(property_id), submitting, error
 * }
 * RPC: client.rpc('promote_property_atomic', { p_property_id })
 *
 * 🔴 CONTRATO PINNEADO (backend en paralelo, tarea 213.1/213.2, otra rama):
 * errores P0001 con el código EMBEBIDO en `error.message`:
 *   PROPERTY_NOT_PUBLISHED | ALREADY_PROMOTED | AGENCY_CANNOT_PUBLISH |
 *   ZONE_UNRESOLVED | PROPERTY_NOT_FOUND
 * Mismo criterio de parseo que useCreateAdvertisingRequest
 * (`error.message.includes(code)`).
 *
 * PATRÓN: calca useCreateAdvertisingRequest/useResolveRequest — is_working_ref
 * + force_update síncrono ANTES del primer await, DI del cliente vía
 * `deps.supabase`, getters en el objeto retornado. `client.rpc(...)` se llama
 * DIRECTO, nunca desprendido (#205) — el doble es el de `@/test-utils/
 * supabaseMock` (candado #233.3): `rpc()` lee `this` y LANZA si se invoca
 * desprendido (`const { rpc } = client; rpc(...)`), así que un GREEN que
 * desprendiera la llamada real ya no puede sobrevivir con la suite en verde
 * (precedente #205/170.4: un doble de objeto plano es ciego a ese mutante).
 *
 * EDGE CASES:
 * - (EC-1) exito_invoca_la_rpc_con_el_nombre_y_params_exactos
 * - (EC-2) exito_devuelve_ok_true_y_llama_onSuccess
 * - (EC-3) error_property_not_published_produce_mensaje_en_espanol
 * - (EC-4) error_already_promoted_produce_mensaje_distinto
 * - (EC-5) error_agency_cannot_publish_produce_mensaje_distinto
 * - (EC-6) error_zone_unresolved_produce_mensaje_distinto
 * - (EC-7) error_property_not_found_produce_mensaje_distinto
 * - (EC-8) codigo_desconocido_cae_a_mensaje_generico
 * - (EC-9) rechazo_de_la_promesa_no_lanza_y_devuelve_mensaje_generico
 * - (EC-10) submitting_true_sincronamente_al_disparar
 * - (EC-11) submitting_false_tras_resolver
 * - (EC-12) onSuccess_no_se_llama_en_error
 * - (EC-13) doble_submit_concurrente_solo_dispara_una_rpc (is_working_ref)
 * - (EC-14a) tras_un_error_de_la_rpc_el_guard_se_libera_la_siguiente_llamada_SI_invoca_rpc
 *   (candado del guardian: sin este caso, liberar `is_working_ref.current`
 *   solo en la rama de éxito sobrevive con la suite en verde — el segundo
 *   submit() quedaría bloqueado en silencio para siempre tras el primer error)
 * - (EC-14b) tras_un_rechazo_de_la_promesa_el_guard_se_libera_la_siguiente_llamada_SI_invoca_rpc
 *   (mismo hallazgo que EC-14a pero para la rama de rechazo — no liberar el
 *   guard en el catch también sobrevivía)
 */

import { act, renderHook } from '@testing-library/react-native';

import { make_binding_sensitive_supabase_mock } from '@/test-utils/supabaseMock';

import { usePromoteProperty } from '../hooks/usePromoteProperty';

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

describe('usePromoteProperty', () => {
  it('EC-1: éxito invoca la RPC con nombre y params exactos', async () => {
    const { client, rpc } = make_client({ error: null });
    const { result } = await renderHook(() => usePromoteProperty({ supabase: client }));
    await act(async () => {
      await result.current.submit('prop-uuid-1');
    });
    expect(rpc).toHaveBeenCalledWith('promote_property_atomic', {
      p_property_id: 'prop-uuid-1',
    });
  });

  it('EC-2: éxito devuelve ok:true y llama onSuccess', async () => {
    const { client } = make_client({ error: null });
    const on_success = jest.fn();
    const { result } = await renderHook(() =>
      usePromoteProperty({ supabase: client, onSuccess: on_success }),
    );
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.submit('prop-uuid-1');
    });
    expect(outcome).toEqual({ ok: true, error: null });
    expect(on_success).toHaveBeenCalledTimes(1);
  });

  it('EC-3: PROPERTY_NOT_PUBLISHED produce mensaje en español', async () => {
    const { client } = make_client({ error: { message: 'PROPERTY_NOT_PUBLISHED' } });
    const { result } = await renderHook(() => usePromoteProperty({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.submit('prop-uuid-1');
    });
    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toMatch(/activas/i);
  });

  it('EC-4: ALREADY_PROMOTED produce mensaje distinto', async () => {
    const { client } = make_client({ error: { message: 'ALREADY_PROMOTED' } });
    const { result } = await renderHook(() => usePromoteProperty({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.submit('prop-uuid-1');
    });
    expect(outcome?.error).toMatch(/promoción en curso/i);
  });

  it('EC-5: AGENCY_CANNOT_PUBLISH produce mensaje distinto', async () => {
    const { client } = make_client({ error: { message: 'AGENCY_CANNOT_PUBLISH' } });
    const { result } = await renderHook(() => usePromoteProperty({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.submit('prop-uuid-1');
    });
    expect(outcome?.error).toMatch(/no puede publicar/i);
  });

  it('EC-6: ZONE_UNRESOLVED produce mensaje distinto', async () => {
    const { client } = make_client({ error: { message: 'ZONE_UNRESOLVED' } });
    const { result } = await renderHook(() => usePromoteProperty({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.submit('prop-uuid-1');
    });
    expect(outcome?.error).toMatch(/ubicar el municipio/i);
  });

  it('EC-7: PROPERTY_NOT_FOUND produce mensaje distinto', async () => {
    const { client } = make_client({ error: { message: 'PROPERTY_NOT_FOUND' } });
    const { result } = await renderHook(() => usePromoteProperty({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.submit('prop-uuid-1');
    });
    expect(outcome?.error).toMatch(/no encontramos/i);
  });

  it('EC-8: código desconocido cae a mensaje genérico', async () => {
    const { client } = make_client({ error: { message: 'WHATEVER' } });
    const { result } = await renderHook(() => usePromoteProperty({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.submit('prop-uuid-1');
    });
    expect(outcome?.error).toMatch(/no se pudo enviar la promoción/i);
  });

  it('EC-9: rechazo de la promesa no lanza, mensaje genérico', async () => {
    // Rechazo CREADO PEREZOSAMENTE (dentro del factory de rpc, no como valor
    // ya construido): un Promise.reject ya construido antes de que el hook
    // le cuelgue su .then/.catch dispara "unhandled rejection" en el mismo
    // tick de definición del test, antes de que exista handler alguno.
    const { client } = make_binding_sensitive_supabase_mock({
      rpc: () => Promise.reject(new Error('network')),
    });
    const { result } = await renderHook(() => usePromoteProperty({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.submit('prop-uuid-1');
    });
    expect(outcome?.ok).toBe(false);
    expect(outcome?.error).toMatch(/no se pudo enviar la promoción/i);
  });

  it('EC-10: submitting=true síncronamente al disparar', async () => {
    let resolve_fn: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      resolve_fn = r;
    });
    const { client } = make_client(pending);
    const { result } = await renderHook(() => usePromoteProperty({ supabase: client }));

    let submit_promise: Promise<unknown> | undefined;
    act(() => {
      submit_promise = result.current.submit('prop-uuid-1');
    });
    expect(result.current.submitting).toBe(true);

    await act(async () => {
      resolve_fn({ error: null });
      await submit_promise;
    });
  });

  it('EC-11: submitting=false tras resolver', async () => {
    const { client } = make_client({ error: null });
    const { result } = await renderHook(() => usePromoteProperty({ supabase: client }));
    await act(async () => {
      await result.current.submit('prop-uuid-1');
    });
    expect(result.current.submitting).toBe(false);
  });

  it('EC-12: onSuccess no se llama en error', async () => {
    const { client } = make_client({ error: { message: 'ALREADY_PROMOTED' } });
    const on_success = jest.fn();
    const { result } = await renderHook(() =>
      usePromoteProperty({ supabase: client, onSuccess: on_success }),
    );
    await act(async () => {
      await result.current.submit('prop-uuid-1');
    });
    expect(on_success).not.toHaveBeenCalled();
  });

  it('EC-13: doble submit concurrente solo dispara una RPC', async () => {
    let resolve_fn: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      resolve_fn = r;
    });
    const { client, rpc } = make_client(pending);
    const { result } = await renderHook(() => usePromoteProperty({ supabase: client }));

    let first: Promise<unknown> | undefined;
    let second: Promise<unknown> | undefined;
    act(() => {
      first = result.current.submit('prop-uuid-1');
      second = result.current.submit('prop-uuid-1');
    });

    expect(rpc).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve_fn({ error: null });
      await Promise.all([first, second]);
    });
  });

  it('EC-14a: tras un error de la RPC, el guard se libera — la siguiente llamada SÍ invoca rpc de nuevo', async () => {
    const { client, rpc } = make_client({ error: { message: 'PROPERTY_NOT_PUBLISHED' } });
    const { result } = await renderHook(() => usePromoteProperty({ supabase: client }));

    await act(async () => {
      await result.current.submit('prop-uuid-1');
    });
    expect(result.current.submitting).toBe(false);

    await act(async () => {
      await result.current.submit('prop-uuid-1');
    });

    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('EC-14b: tras un rechazo de la promesa, el guard se libera — la siguiente llamada SÍ invoca rpc de nuevo', async () => {
    // 🔴 la SEGUNDA llamada resuelve distinto de la primera (rechazo → éxito):
    // si se reutilizara una única promesa rechazada para ambas invocaciones,
    // Jest la reportaría como "unhandled rejection" en la segunda espera
    // (nadie la consume dos veces del mismo objeto). mockImplementationOnce
    // por llamada evita eso sin cambiar el contrato.
    const { client, _mock_rpc: rpc } = make_binding_sensitive_supabase_mock({
      rpc: jest
        .fn()
        .mockImplementationOnce(() => Promise.reject(new Error('network')))
        .mockImplementationOnce(() => Promise.resolve({ error: null })),
    });

    const { result } = await renderHook(() => usePromoteProperty({ supabase: client }));

    await act(async () => {
      await result.current.submit('prop-uuid-1');
    });
    expect(result.current.submitting).toBe(false);

    await act(async () => {
      await result.current.submit('prop-uuid-1');
    });

    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
