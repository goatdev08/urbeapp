/**
 * Tests — useResolveAgentApplication / useResolveAdvertisingRequest /
 * useResolveAgencyRegistration (subtarea 221.4)
 * Archivo SUT: mobile/src/features/admin/hooks/useResolveRequest.ts
 *
 * RPCs definitivas del backend (221.1/221.2):
 *   resolve_agent_application({p_application_id, p_approve, p_reason?})
 *     códigos: APPLICATION_NOT_FOUND | ALREADY_RESOLVED | REASON_REQUIRED |
 *       STATUS_CHANGE_REQUIRES_ADMIN
 *   resolve_advertising_request({p_request_id, p_approve, p_reason?})
 *     códigos: REQUEST_NOT_FOUND | ALREADY_RESOLVED | REASON_REQUIRED |
 *       STATUS_CHANGE_REQUIRES_ADMIN
 *   resolve_agency_registration({p_agency_id, p_approve, p_reason?})
 *     códigos: AGENCY_NOT_FOUND | ALREADY_RESOLVED | REASON_REQUIRED |
 *       STATUS_CHANGE_REQUIRES_ADMIN
 * Los tres carriles comparten el SUFIJO `_NOT_FOUND`, `ALREADY_RESOLVED`,
 * `REASON_REQUIRED` y `STATUS_CHANGE_REQUIRES_ADMIN` — el PREFIJO del
 * `_NOT_FOUND` es propio de cada tabla.
 *
 * PATRÓN: DI directa vía deps.supabase con { rpc: jest.fn() } (sin mockear
 * el módulo del cliente — mismo criterio que useCreateAdvertisingRequest).
 *
 * EDGE CASES (por cada uno de los 3 hooks — EC-N se repite en 3 describes):
 * - (EC-1) aprobar_invoca_la_rpc_con_nombre_y_params_exactos_sin_reason
 * - (EC-2) rechazar_con_motivo_incluye_p_reason_en_el_body
 * - (EC-3) exito_devuelve_ok_true_y_llama_onSuccess
 * - (EC-4) error_reason_required_produce_mensaje_en_espanol
 * - (EC-5) error_already_resolved_produce_mensaje_distinto
 * - (EC-6) codigo_desconocido_cae_a_mensaje_generico
 * - (EC-7) no_doble_submit_segunda_llamada_en_vuelo_se_ignora
 * - (EC-8) is_submitting_false_tras_resolver
 * - (EC-9) error_not_found_del_carril_produce_mensaje_propio
 * - (EC-10) status_change_requires_admin_produce_mensaje_propio
 */

import { act, renderHook } from '@testing-library/react-native';

import { make_binding_sensitive_supabase_mock } from '@/test-utils/supabaseMock';

import {
  useResolveAgentApplication,
  useResolveAdvertisingRequest,
  useResolveAgencyRegistration,
} from '../hooks/useResolveRequest';

function make_client(result: unknown): { client: unknown; rpc: jest.Mock } {
  const resolved = result instanceof Promise ? result : Promise.resolve(result);
  const { client, _mock_rpc } = make_binding_sensitive_supabase_mock({ rpc: () => resolved });
  // `rpc` expone el spy real (candado #233.3) bajo el mismo nombre que usaban
  // las aserciones existentes (`client.rpc`) para minimizar el diff.
  return { client, rpc: _mock_rpc };
}

describe('useResolveAgentApplication', () => {
  it('EC-1: aprobar invoca la RPC con nombre/params exactos, sin p_reason', async () => {
    const { client, rpc } = make_client({ error: null });
    const { result } = await renderHook(() => useResolveAgentApplication({ supabase: client }));
    await act(async () => {
      await result.current.resolve({ application_id: 'app-1', approve: true });
    });
    expect(rpc).toHaveBeenCalledWith('resolve_agent_application', {
      p_application_id: 'app-1',
      p_approve: true,
    });
  });

  it('EC-2: rechazar con motivo incluye p_reason en el body', async () => {
    const { client, rpc } = make_client({ error: null });
    const { result } = await renderHook(() => useResolveAgentApplication({ supabase: client }));
    await act(async () => {
      await result.current.resolve({ application_id: 'app-1', approve: false, reason: 'Datos incompletos' });
    });
    expect(rpc).toHaveBeenCalledWith('resolve_agent_application', {
      p_application_id: 'app-1',
      p_approve: false,
      p_reason: 'Datos incompletos',
    });
  });

  it('EC-3: éxito devuelve ok:true y llama onSuccess', async () => {
    const { client } = make_client({ error: null });
    const on_success = jest.fn();
    const { result } = await renderHook(() =>
      useResolveAgentApplication({ supabase: client, onSuccess: on_success }),
    );
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.resolve({ application_id: 'app-1', approve: true });
    });
    expect(outcome).toEqual({ ok: true, error: null });
    expect(on_success).toHaveBeenCalledTimes(1);
  });

  it('EC-4: REASON_REQUIRED produce mensaje en español', async () => {
    const { client } = make_client({ error: { message: 'REASON_REQUIRED' } });
    const { result } = await renderHook(() => useResolveAgentApplication({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.resolve({ application_id: 'app-1', approve: false });
    });
    expect(outcome?.error).toMatch(/motivo/i);
  });

  it('EC-5: ALREADY_RESOLVED produce mensaje distinto', async () => {
    const { client } = make_client({ error: { message: 'ALREADY_RESOLVED' } });
    const { result } = await renderHook(() => useResolveAgentApplication({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.resolve({ application_id: 'app-1', approve: true });
    });
    expect(outcome?.error).toMatch(/ya fue resuelta/i);
  });

  it('EC-6: código desconocido cae a mensaje genérico', async () => {
    const { client } = make_client({ error: { message: 'WAT' } });
    const { result } = await renderHook(() => useResolveAgentApplication({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.resolve({ application_id: 'app-1', approve: true });
    });
    expect(outcome?.error).toMatch(/no se pudo resolver/i);
  });

  it('EC-7: no doble-submit — segunda llamada en vuelo se ignora', async () => {
    let resolve_fn: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      resolve_fn = r;
    });
    const { client, rpc } = make_client(pending);
    const { result } = await renderHook(() => useResolveAgentApplication({ supabase: client }));

    let first: Promise<unknown> | undefined;
    let second: { ok: boolean; error: string | null } | undefined;
    act(() => {
      first = result.current.resolve({ application_id: 'app-1', approve: true });
    });
    await act(async () => {
      second = await result.current.resolve({ application_id: 'app-1', approve: true });
    });

    expect(second).toEqual({ ok: false, error: null });
    expect(rpc).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve_fn({ error: null });
      await first;
    });
  });

  it('EC-8: is_submitting=false tras resolver', async () => {
    const { client } = make_client({ error: null });
    const { result } = await renderHook(() => useResolveAgentApplication({ supabase: client }));
    await act(async () => {
      await result.current.resolve({ application_id: 'app-1', approve: true });
    });
    expect(result.current.is_submitting).toBe(false);
  });

  it('EC-9: APPLICATION_NOT_FOUND produce mensaje propio del carril', async () => {
    const { client } = make_client({ error: { message: 'APPLICATION_NOT_FOUND' } });
    const { result } = await renderHook(() => useResolveAgentApplication({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.resolve({ application_id: 'app-1', approve: true });
    });
    expect(outcome?.error).toMatch(/ya no existe/i);
  });

  it('EC-10: STATUS_CHANGE_REQUIRES_ADMIN produce mensaje propio', async () => {
    const { client } = make_client({ error: { message: 'STATUS_CHANGE_REQUIRES_ADMIN' } });
    const { result } = await renderHook(() => useResolveAgentApplication({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.resolve({ application_id: 'app-1', approve: true });
    });
    expect(outcome?.error).toMatch(/administrador/i);
  });
});

describe('useResolveAdvertisingRequest', () => {
  it('EC-1: aprobar invoca la RPC con nombre/params exactos, sin p_reason', async () => {
    const { client, rpc } = make_client({ error: null });
    const { result } = await renderHook(() => useResolveAdvertisingRequest({ supabase: client }));
    await act(async () => {
      await result.current.resolve({ request_id: 'req-1', approve: true });
    });
    expect(rpc).toHaveBeenCalledWith('resolve_advertising_request', {
      p_request_id: 'req-1',
      p_approve: true,
    });
  });

  it('EC-2: rechazar con motivo incluye p_reason en el body', async () => {
    const { client, rpc } = make_client({ error: null });
    const { result } = await renderHook(() => useResolveAdvertisingRequest({ supabase: client }));
    await act(async () => {
      await result.current.resolve({ request_id: 'req-1', approve: false, reason: 'No aplica' });
    });
    expect(rpc).toHaveBeenCalledWith('resolve_advertising_request', {
      p_request_id: 'req-1',
      p_approve: false,
      p_reason: 'No aplica',
    });
  });

  it('EC-3: éxito devuelve ok:true y llama onSuccess', async () => {
    const { client } = make_client({ error: null });
    const on_success = jest.fn();
    const { result } = await renderHook(() =>
      useResolveAdvertisingRequest({ supabase: client, onSuccess: on_success }),
    );
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.resolve({ request_id: 'req-1', approve: true });
    });
    expect(outcome).toEqual({ ok: true, error: null });
    expect(on_success).toHaveBeenCalledTimes(1);
  });

  it('EC-4: REASON_REQUIRED produce mensaje en español', async () => {
    const { client } = make_client({ error: { message: 'REASON_REQUIRED' } });
    const { result } = await renderHook(() => useResolveAdvertisingRequest({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.resolve({ request_id: 'req-1', approve: false });
    });
    expect(outcome?.error).toMatch(/motivo/i);
  });

  it('EC-5: ALREADY_RESOLVED produce mensaje distinto', async () => {
    const { client } = make_client({ error: { message: 'ALREADY_RESOLVED' } });
    const { result } = await renderHook(() => useResolveAdvertisingRequest({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.resolve({ request_id: 'req-1', approve: true });
    });
    expect(outcome?.error).toMatch(/ya fue resuelta/i);
  });

  it('EC-6: código desconocido cae a mensaje genérico', async () => {
    const { client } = make_client({ error: { message: 'WAT' } });
    const { result } = await renderHook(() => useResolveAdvertisingRequest({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.resolve({ request_id: 'req-1', approve: true });
    });
    expect(outcome?.error).toMatch(/no se pudo resolver/i);
  });

  it('EC-7: no doble-submit — segunda llamada en vuelo se ignora', async () => {
    let resolve_fn: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      resolve_fn = r;
    });
    const { client, rpc } = make_client(pending);
    const { result } = await renderHook(() => useResolveAdvertisingRequest({ supabase: client }));

    let first: Promise<unknown> | undefined;
    let second: { ok: boolean; error: string | null } | undefined;
    act(() => {
      first = result.current.resolve({ request_id: 'req-1', approve: true });
    });
    await act(async () => {
      second = await result.current.resolve({ request_id: 'req-1', approve: true });
    });

    expect(second).toEqual({ ok: false, error: null });
    expect(rpc).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve_fn({ error: null });
      await first;
    });
  });

  it('EC-8: is_submitting=false tras resolver', async () => {
    const { client } = make_client({ error: null });
    const { result } = await renderHook(() => useResolveAdvertisingRequest({ supabase: client }));
    await act(async () => {
      await result.current.resolve({ request_id: 'req-1', approve: true });
    });
    expect(result.current.is_submitting).toBe(false);
  });

  it('EC-9: REQUEST_NOT_FOUND produce mensaje propio del carril', async () => {
    const { client } = make_client({ error: { message: 'REQUEST_NOT_FOUND' } });
    const { result } = await renderHook(() => useResolveAdvertisingRequest({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.resolve({ request_id: 'req-1', approve: true });
    });
    expect(outcome?.error).toMatch(/ya no existe/i);
  });

  it('EC-10: STATUS_CHANGE_REQUIRES_ADMIN produce mensaje propio', async () => {
    const { client } = make_client({ error: { message: 'STATUS_CHANGE_REQUIRES_ADMIN' } });
    const { result } = await renderHook(() => useResolveAdvertisingRequest({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.resolve({ request_id: 'req-1', approve: true });
    });
    expect(outcome?.error).toMatch(/administrador/i);
  });
});

describe('useResolveAgencyRegistration', () => {
  it('EC-1: aprobar invoca la RPC con nombre/params exactos, sin p_reason', async () => {
    const { client, rpc } = make_client({ error: null });
    const { result } = await renderHook(() => useResolveAgencyRegistration({ supabase: client }));
    await act(async () => {
      await result.current.resolve({ agency_id: 'agency-1', approve: true });
    });
    expect(rpc).toHaveBeenCalledWith('resolve_agency_registration', {
      p_agency_id: 'agency-1',
      p_approve: true,
    });
  });

  it('EC-2: rechazar con motivo incluye p_reason en el body', async () => {
    const { client, rpc } = make_client({ error: null });
    const { result } = await renderHook(() => useResolveAgencyRegistration({ supabase: client }));
    await act(async () => {
      await result.current.resolve({ agency_id: 'agency-1', approve: false, reason: 'Datos incompletos' });
    });
    expect(rpc).toHaveBeenCalledWith('resolve_agency_registration', {
      p_agency_id: 'agency-1',
      p_approve: false,
      p_reason: 'Datos incompletos',
    });
  });

  it('EC-3: éxito devuelve ok:true y llama onSuccess', async () => {
    const { client } = make_client({ error: null });
    const on_success = jest.fn();
    const { result } = await renderHook(() =>
      useResolveAgencyRegistration({ supabase: client, onSuccess: on_success }),
    );
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.resolve({ agency_id: 'agency-1', approve: true });
    });
    expect(outcome).toEqual({ ok: true, error: null });
    expect(on_success).toHaveBeenCalledTimes(1);
  });

  it('EC-4: REASON_REQUIRED produce mensaje en español', async () => {
    const { client } = make_client({ error: { message: 'REASON_REQUIRED' } });
    const { result } = await renderHook(() => useResolveAgencyRegistration({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.resolve({ agency_id: 'agency-1', approve: false });
    });
    expect(outcome?.error).toMatch(/motivo/i);
  });

  it('EC-5: ALREADY_RESOLVED produce mensaje distinto', async () => {
    const { client } = make_client({ error: { message: 'ALREADY_RESOLVED' } });
    const { result } = await renderHook(() => useResolveAgencyRegistration({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.resolve({ agency_id: 'agency-1', approve: true });
    });
    expect(outcome?.error).toMatch(/ya fue resuelta/i);
  });

  it('EC-6: código desconocido cae a mensaje genérico', async () => {
    const { client } = make_client({ error: { message: 'WAT' } });
    const { result } = await renderHook(() => useResolveAgencyRegistration({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.resolve({ agency_id: 'agency-1', approve: true });
    });
    expect(outcome?.error).toMatch(/no se pudo resolver/i);
  });

  it('EC-7: no doble-submit — segunda llamada en vuelo se ignora', async () => {
    let resolve_fn: (v: unknown) => void = () => {};
    const pending = new Promise((r) => {
      resolve_fn = r;
    });
    const { client, rpc } = make_client(pending);
    const { result } = await renderHook(() => useResolveAgencyRegistration({ supabase: client }));

    let first: Promise<unknown> | undefined;
    let second: { ok: boolean; error: string | null } | undefined;
    act(() => {
      first = result.current.resolve({ agency_id: 'agency-1', approve: true });
    });
    await act(async () => {
      second = await result.current.resolve({ agency_id: 'agency-1', approve: true });
    });

    expect(second).toEqual({ ok: false, error: null });
    expect(rpc).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve_fn({ error: null });
      await first;
    });
  });

  it('EC-8: is_submitting=false tras resolver', async () => {
    const { client } = make_client({ error: null });
    const { result } = await renderHook(() => useResolveAgencyRegistration({ supabase: client }));
    await act(async () => {
      await result.current.resolve({ agency_id: 'agency-1', approve: true });
    });
    expect(result.current.is_submitting).toBe(false);
  });

  it('EC-9: AGENCY_NOT_FOUND produce mensaje propio del carril', async () => {
    const { client } = make_client({ error: { message: 'AGENCY_NOT_FOUND' } });
    const { result } = await renderHook(() => useResolveAgencyRegistration({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.resolve({ agency_id: 'agency-1', approve: true });
    });
    expect(outcome?.error).toMatch(/ya no existe/i);
  });

  it('EC-10: STATUS_CHANGE_REQUIRES_ADMIN produce mensaje propio', async () => {
    const { client } = make_client({ error: { message: 'STATUS_CHANGE_REQUIRES_ADMIN' } });
    const { result } = await renderHook(() => useResolveAgencyRegistration({ supabase: client }));
    let outcome: { ok: boolean; error: string | null } | undefined;
    await act(async () => {
      outcome = await result.current.resolve({ agency_id: 'agency-1', approve: true });
    });
    expect(outcome?.error).toMatch(/administrador/i);
  });
});
