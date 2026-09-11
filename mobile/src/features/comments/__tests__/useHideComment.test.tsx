/**
 * Tests fase RED — useHideComment (UPDATE status-only sobre comments: ocultar/
 * restaurar por el gestor, borrado propio por el autor)
 * Archivo SUT: mobile/src/features/comments/hooks/useHideComment.ts
 * Subtarea Taskmaster: 289.7 (tarea #289)
 *
 * SEAM BAJO TEST (firma pública, DI del cliente):
 *
 *   useHideComment(opts?: { supabase?: unknown }): {
 *     set_status(comment_id: string, status: 'hidden'|'visible'|'deleted'): Promise<boolean>;
 *     busy: boolean; error: string | null;
 *   }
 *
 * CONTRATO ANCLADO por comments_update (migración 20260910100001 §5, WITH
 * CHECK status-only): el gestor alterna 'hidden'/'visible' libremente; el
 * autor SOLO puede pasar su propio comentario a 'deleted' — este hook NO
 * valida esa regla en el cliente (2ª capa = RLS, igual que el resto del
 * repo); un intento fuera de la regla vuelve 42501 y el hook lo mapea al
 * MISMO camino de error que "0 filas" (RLS bloquea, no lanza).
 *
 * `.update({status}).eq('id', comment_id).select('id,status').single()`:
 * `.single()` sobre 0 filas (RLS bloqueó el UPDATE) responde PGRST116 —
 * mismo boundary que pgtap_policy_dominada_por_select advierte (una policy
 * "abierta" pasaría en falso si el hook TRAGARA el error sin exponerlo).
 *
 * EDGE CASES CUBIERTOS (12 casos):
 *
 * ### Happy path
 * - (EC-1) exito_status_hidden_invoca_update_eq_select_single_en_ese_orden
 * - (EC-2) exito_status_visible_restaurar_un_comentario_oculto
 * - (EC-3) exito_status_deleted_borrado_propio_del_autor
 * - (EC-4) exito_resuelve_true_y_error_queda_null
 *
 * ### 🔴 Ramas no obvias — RLS status-only (comments_update)
 * - (EC-5) cero_filas_pgrst116_single_sin_match_no_lanza_resuelve_false_error_propio
 * - (EC-6) permiso_denegado_42501_no_lanza_resuelve_false_error_propio
 *
 * ### Boundary / error
 * - (EC-7)  busy_true_sincronamente_al_disparar_set_status
 * - (EC-8)  busy_false_tras_exito
 * - (EC-9)  busy_false_tras_error_no_se_queda_colgado
 * - (EC-10) error_se_limpia_en_la_siguiente_llamada_exitosa
 * - (EC-11) error_de_red_rechazo_no_lanza_resuelve_false_mensaje_propio
 *
 * ### 🔴 Integridad del cliente supabase-js (#205)
 * - (EC-12) update_no_se_desprende_del_cliente_this_se_preserva
 */

import { renderHook, act } from '@testing-library/react-native';

import { make_binding_sensitive_supabase_mock } from '@/test-utils/supabaseMock';

import { useHideComment } from '../hooks/useHideComment';
import { make_query_builder } from '@/test-utils/commentsQueryMock';

// ---------------------------------------------------------------------------
// Constantes / helpers de mock
// ---------------------------------------------------------------------------

const COMMENT_ID = 'comentario-uuid-hide-289';

function make_client(result: { data: unknown; error: { message?: string; code?: string } | null }) {
  const qb = make_query_builder(result);
  const mock = make_binding_sensitive_supabase_mock({ from: () => qb.builder });
  return { client: mock.client, calls: qb.calls, _mock_from: mock._mock_from };
}

function make_rejecting_client() {
  const mock = make_binding_sensitive_supabase_mock({
    from: () => ({
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      then: (_resolve: unknown, reject: (reason: unknown) => void) =>
        Promise.reject(new Error('Network request failed')).catch(reject),
    }),
  });
  return { client: mock.client };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('useHideComment — happy path', () => {
  it('EC-1 éxito status=hidden: invoca update({status}).eq("id",…).select("id,status").single()', async () => {
    const { client, calls } = make_client({ data: { id: COMMENT_ID, status: 'hidden' }, error: null });
    const { result } = await renderHook(() => useHideComment({ supabase: client }));

    let ok = false;
    await act(async () => {
      ok = await result.current.set_status(COMMENT_ID, 'hidden');
    });

    expect(ok).toBe(true);
    expect(calls).toContainEqual({ method: 'update', args: [{ status: 'hidden' }] });
    expect(calls).toContainEqual({ method: 'eq', args: ['id', COMMENT_ID] });
    expect(calls.some((c) => c.method === 'single')).toBe(true);
  });

  it('EC-2 éxito status=visible: restaura un comentario oculto', async () => {
    const { client, calls } = make_client({ data: { id: COMMENT_ID, status: 'visible' }, error: null });
    const { result } = await renderHook(() => useHideComment({ supabase: client }));

    let ok = false;
    await act(async () => {
      ok = await result.current.set_status(COMMENT_ID, 'visible');
    });

    expect(ok).toBe(true);
    expect(calls).toContainEqual({ method: 'update', args: [{ status: 'visible' }] });
  });

  it('EC-3 éxito status=deleted: borrado propio del autor', async () => {
    const { client, calls } = make_client({ data: { id: COMMENT_ID, status: 'deleted' }, error: null });
    const { result } = await renderHook(() => useHideComment({ supabase: client }));

    let ok = false;
    await act(async () => {
      ok = await result.current.set_status(COMMENT_ID, 'deleted');
    });

    expect(ok).toBe(true);
    expect(calls).toContainEqual({ method: 'update', args: [{ status: 'deleted' }] });
  });

  it('EC-4 éxito: resuelve true y error queda null', async () => {
    const { client } = make_client({ data: { id: COMMENT_ID, status: 'hidden' }, error: null });
    const { result } = await renderHook(() => useHideComment({ supabase: client }));

    await act(async () => {
      await result.current.set_status(COMMENT_ID, 'hidden');
    });

    expect(result.current.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 🔴 Ramas no obvias — RLS status-only
// ---------------------------------------------------------------------------

describe('useHideComment — 🔴 RLS status-only (comments_update)', () => {
  it('EC-5 0 filas (PGRST116, single sin match): no lanza, resuelve false, error propio', async () => {
    const { client } = make_client({
      data: null,
      error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
    });
    const { result } = await renderHook(() => useHideComment({ supabase: client }));

    let ok = true;
    let threw: unknown = null;
    await act(async () => {
      try {
        ok = await result.current.set_status(COMMENT_ID, 'hidden');
      } catch (e) {
        threw = e;
      }
    });

    expect(threw).toBeNull();
    expect(ok).toBe(false);
    expect((result.current.error ?? '').length).toBeGreaterThan(0);
  });

  it('EC-6 permiso denegado (42501): no lanza, resuelve false, error propio', async () => {
    const { client } = make_client({ data: null, error: { code: '42501', message: 'permission denied' } });
    const { result } = await renderHook(() => useHideComment({ supabase: client }));

    let ok = true;
    await act(async () => {
      ok = await result.current.set_status(COMMENT_ID, 'visible');
    });

    expect(ok).toBe(false);
    expect((result.current.error ?? '').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Boundary / error
// ---------------------------------------------------------------------------

describe('useHideComment — boundary / error', () => {
  it('EC-7 busy=true SÍNCRONAMENTE al disparar set_status', async () => {
    const pending_qb: Record<string, unknown> = {
      update: jest.fn(() => pending_qb),
      eq: jest.fn(() => pending_qb),
      select: jest.fn(() => pending_qb),
      single: jest.fn(() => pending_qb),
      then: () => new Promise(() => {}),
    };
    const mock = make_binding_sensitive_supabase_mock({ from: () => pending_qb });
    const { result } = await renderHook(() => useHideComment({ supabase: mock.client }));

    act(() => {
      void result.current.set_status(COMMENT_ID, 'hidden');
    });

    expect(result.current.busy).toBe(true);
  });

  it('EC-8 busy=false tras un éxito', async () => {
    const { client } = make_client({ data: { id: COMMENT_ID, status: 'hidden' }, error: null });
    const { result } = await renderHook(() => useHideComment({ supabase: client }));

    await act(async () => {
      await result.current.set_status(COMMENT_ID, 'hidden');
    });

    expect(result.current.busy).toBe(false);
  });

  it('EC-9 busy=false tras un error (no se queda colgado)', async () => {
    const { client } = make_client({ data: null, error: { code: '42501' } });
    const { result } = await renderHook(() => useHideComment({ supabase: client }));

    await act(async () => {
      await result.current.set_status(COMMENT_ID, 'hidden');
    });

    expect(result.current.busy).toBe(false);
  });

  it('EC-10 error se limpia en la siguiente llamada EXITOSA', async () => {
    const { client: failing_client } = make_client({ data: null, error: { code: '42501' } });
    const { result, rerender } = await renderHook(
      ({ client }: { client: unknown }) => useHideComment({ supabase: client }),
      { initialProps: { client: failing_client } },
    );

    await act(async () => {
      await result.current.set_status(COMMENT_ID, 'hidden');
    });
    expect(result.current.error).not.toBeNull();

    const { client: ok_client } = make_client({ data: { id: COMMENT_ID, status: 'hidden' }, error: null });
    await rerender({ client: ok_client });

    await act(async () => {
      await result.current.set_status(COMMENT_ID, 'hidden');
    });

    expect(result.current.error).toBeNull();
  });

  it('EC-11 error de red (rechazo): no lanza, resuelve false, mensaje propio', async () => {
    const { client } = make_rejecting_client();
    const { result } = await renderHook(() => useHideComment({ supabase: client }));

    let ok = true;
    let threw: unknown = null;
    await act(async () => {
      try {
        ok = await result.current.set_status(COMMENT_ID, 'hidden');
      } catch (e) {
        threw = e;
      }
    });

    expect(threw).toBeNull();
    expect(ok).toBe(false);
    expect((result.current.error ?? '').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 🔴 Integridad del cliente supabase-js (#205)
// ---------------------------------------------------------------------------

describe('useHideComment — 🔴 no desprender métodos de supabase-js (#205)', () => {
  it('EC-12 invoca update() sobre from() LIGADO al cliente, sin desprenderlo', async () => {
    const { client } = make_client({ data: { id: COMMENT_ID, status: 'hidden' }, error: null });
    const { result } = await renderHook(() => useHideComment({ supabase: client }));

    let threw: unknown = null;
    try {
      await act(async () => {
        await result.current.set_status(COMMENT_ID, 'hidden');
      });
    } catch (e) {
      threw = e;
    }

    expect(threw).toBeNull();
  });
});
