/**
 * Tests fase RED — useResolveReport, EXTENSIÓN para comentarios (kind:'comment',
 * subtarea 289.6/289.7, tarea #289). Archivo NUEVO — el archivo hermano
 * useResolveReport.test.tsx (220.4, property) NO SE TOCA y debe seguir verde.
 * SUT: mobile/src/features/admin/hooks/useResolveReport.ts
 *
 * SEAM BAJO TEST — CONTRATO NUEVO fijado aquí por el test-author (decisión de
 * Abraham, ver prompt de 289.6): `resolve()` gana una unión discriminada por
 * `kind`, backward-compatible con el contrato vigente:
 *
 *   type ResolveReportParams =
 *     | { kind?: 'property'; property_id: string;
 *         action: 'restore'|'request_changes'|'keep_suspended'|'delete'; reason?: string }
 *     | { kind: 'comment'; comment_id: string;
 *         action: 'restore'|'keep_hidden'|'delete_comment'; reason?: string }
 *
 *   `kind` es OPCIONAL para la rama property (default 'property') — así los
 *   22 tests EXISTENTES de useResolveReport.test.tsx, que llaman
 *   `resolve({property_id, action, reason?})` SIN `kind`, siguen compilando y
 *   pasando SIN TOCARLOS (migración mínima: NO se renombra el campo `reason`
 *   ni se quita compat, solo se AÑADE la rama nueva).
 *
 *   kind:'comment' → invoca la EF NUEVA `moderate-comment` (NO
 *   `moderate-property`) con body `{comment_id, action, reason?}` — mismo
 *   criterio que la rama property: `reason` solo viaja en el body si vino.
 *
 * 🔴 SUPUESTO PARA GREEN — status derivado client-side: la respuesta de éxito
 * de `moderate-comment` es `{ok:true, comment_id, action}` (NO trae `status`,
 * a diferencia de `moderate-property`). Para conservar el tipo
 * `ResolveReportResult = {ok:true; status:string} | {ok:false; status:null}`
 * SIN cambiarlo, el hook debe DERIVAR el status resultante del propio `action`
 * enviado (mismo patrón que REPORTS_RESOLUTION_TARGET_STATUS en
 * moderate-property/handler.ts), con el mapa:
 *   restore → 'visible' | keep_hidden → 'hidden' | delete_comment → 'deleted'
 * (valores REALES del enum comment_status, 20260910100001_comments.sql:49).
 * Si GREEN decide otra cosa, debe quedar documentado en la bitácora — este
 * archivo fija el contrato mínimo que el RED puede verificar sin acoplarse al
 * cuerpo crudo de la EF.
 *
 * 🔴 REGLA DE #200 (igual que la rama property) — el mensaje NUNCA sale de
 * `error.message` (el literal crudo en inglés de supabase-js). Se usa
 * `FunctionsHttpError` REAL con el cuerpo `{error:{code,message}}` que la EF
 * moderate-comment realmente emite (types.ts de la EF, subtarea 289.6).
 *
 * 🔴 REGLA DE #205 — `client.functions.invoke` NUNCA se desprende del cliente
 * (EC-7 lo caza, mismo patrón que EC-19 de la rama property).
 *
 * GOTCHAS RNTL ya pagados: `renderHook`/`act` con `await`; `is_submitting` se
 * lee SÍNCRONAMENTE en el mismo tick en que arranca la acción.
 *
 * EDGE CASES (RED) — 289.6/289.7, rama kind:'comment':
 *
 * ### Happy path e invocación
 * - (EC-1) restore_sin_reason_invoca_moderate_comment_con_body_comment_id_action
 * - (EC-2) con_reason_el_reason_viaja_en_el_body
 * - (EC-3) sin_reason_la_clave_reason_no_se_manda_en_el_body
 * - (EC-4) las_3_acciones_de_comentario_producen_el_body_exacto_por_accion
 * - (EC-5) exito_resuelve_ok_true_con_el_status_derivado_de_la_accion
 *
 * ### Regresión — la rama property sigue intacta
 * - (EC-6) sin_kind_o_kind_property_sigue_invocando_moderate_property_nunca_moderate_comment
 *
 * ### 🔴 Integridad del cliente supabase-js
 * - (EC-7) no_desprende_functions_invoke_del_cliente_en_la_rama_comment
 *
 * ### 🔴 Traducción de códigos (#200) — rama comment
 * - (EC-8)  admin_required_produce_un_mensaje_en_espanol_distinguible
 * - (EC-9)  comment_not_found_produce_un_mensaje_distinguible_de_admin_required
 * - (EC-10) invalid_action_produce_un_mensaje_distinguible_de_los_dos_anteriores
 * - (EC-11) ningun_codigo_deja_ver_el_literal_en_ingles_de_supabase_js
 *
 * ### Fallo de red
 * - (EC-12) invoke_rechazado_en_la_rama_comment_devuelve_ok_false_sin_lanzar
 *
 * ### 🔴 No doble-submit — semántica IGNORAR (comparte el ref con la rama property)
 * - (EC-13) segunda_llamada_comment_mientras_la_primera_sigue_en_vuelo_se_ignora
 *
 * ### Estado
 * - (EC-14) is_submitting_true_sincronamente_al_disparar_una_accion_de_comentario
 *
 * ### onSuccess
 * - (EC-15) on_success_se_llama_solo_tras_exito_de_una_accion_de_comentario
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { renderHook, act } from '@testing-library/react-native';

import { useResolveReport } from '../hooks/useResolveReport';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const TEST_COMMENT_ID = 'comment-uuid-a-configurar-289';
const TEST_PROPERTY_ID = 'property-uuid-a-configurar-220';

const RAW_SUPABASE_JS_MESSAGE = 'Edge Function returned a non-2xx status code';

/** Status derivado por acción (SUPUESTO documentado arriba). */
const COMMENT_ACTION_STATUS: Record<string, string> = {
  restore: 'visible',
  keep_hidden: 'hidden',
  delete_comment: 'deleted',
};

const COMMENT_ACTIONS = ['restore', 'keep_hidden', 'delete_comment'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function make_http_error(code: string, status = 400, message = 'mensaje interno de la EF') {
  return new FunctionsHttpError(
    new Response(JSON.stringify({ error: { code, message } }), { status }),
  );
}

type InvokeResult = { data: unknown; error: unknown | null };
type InvokeCall = { name: string; options: { body?: Record<string, unknown> } };

function make_client(behavior: () => Promise<InvokeResult>) {
  const calls: InvokeCall[] = [];
  let detached = false;

  const functions = {
    invoke(this: unknown, name: string, options: { body?: Record<string, unknown> } = {}) {
      if (this !== functions) detached = true;
      calls.push({ name, options });
      return behavior();
    },
  };

  return {
    client: { functions },
    calls,
    was_detached: () => detached,
  };
}

const ok_invoke_comment = () => (): Promise<InvokeResult> =>
  Promise.resolve({
    data: { ok: true, comment_id: TEST_COMMENT_ID, action: 'restore' },
    error: null,
  });

const failing_invoke = (code: string, status = 400) => (): Promise<InvokeResult> =>
  Promise.resolve({ data: null, error: make_http_error(code, status) });

const pending_invoke = () => (): Promise<InvokeResult> => new Promise(() => {}); // nunca resuelve

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Happy path e invocación
// ---------------------------------------------------------------------------

describe('useResolveReport — rama kind:"comment"', () => {
  it('EC-1 restore sin reason: invoca moderate-comment con body {comment_id, action}', async () => {
    const mock = make_client(ok_invoke_comment());
    const { result } = await renderHook(() => useResolveReport({ supabase: mock.client }));

    let res: unknown;
    await act(async () => {
      res = await result.current.resolve({
        kind: 'comment',
        comment_id: TEST_COMMENT_ID,
        action: 'restore',
      } as never);
    });

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]?.name).toBe('moderate-comment');
    expect(mock.calls[0]?.options.body).toEqual({
      comment_id: TEST_COMMENT_ID,
      action: 'restore',
    });
    expect((res as { ok: boolean }).ok).toBe(true);
  });

  it('EC-2 con reason: el reason viaja en el body', async () => {
    const mock = make_client(ok_invoke_comment());
    const { result } = await renderHook(() => useResolveReport({ supabase: mock.client }));

    await act(async () => {
      await result.current.resolve({
        kind: 'comment',
        comment_id: TEST_COMMENT_ID,
        action: 'delete_comment',
        reason: 'Contenido ofensivo confirmado',
      } as never);
    });

    expect(mock.calls[0]?.name).toBe('moderate-comment');
    expect(mock.calls[0]?.options.body?.reason).toBe('Contenido ofensivo confirmado');
  });

  it('EC-3 sin reason: la clave reason NO se manda en el body', async () => {
    const mock = make_client(ok_invoke_comment());
    const { result } = await renderHook(() => useResolveReport({ supabase: mock.client }));

    await act(async () => {
      await result.current.resolve({
        kind: 'comment',
        comment_id: TEST_COMMENT_ID,
        action: 'keep_hidden',
      } as never);
    });

    expect(mock.calls[0]?.name).toBe('moderate-comment');
    const body = mock.calls[0]?.options.body ?? {};
    expect(Object.prototype.hasOwnProperty.call(body, 'reason')).toBe(false);
  });

  it.each(COMMENT_ACTIONS)(
    'EC-4 el body incluye comment_id y action exactos para la acción %s',
    async (action) => {
      const mock = make_client(ok_invoke_comment());
      const { result } = await renderHook(() => useResolveReport({ supabase: mock.client }));

      await act(async () => {
        await result.current.resolve({
          kind: 'comment',
          comment_id: TEST_COMMENT_ID,
          action,
        } as never);
      });

      expect(mock.calls[0]?.options.body).toEqual({
        comment_id: TEST_COMMENT_ID,
        action,
      });
    },
  );

  it.each(COMMENT_ACTIONS)(
    'EC-5 éxito de %s resuelve ok:true con el status derivado de la acción',
    async (action) => {
      const mock = make_client(ok_invoke_comment());
      const { result } = await renderHook(() => useResolveReport({ supabase: mock.client }));

      let res: unknown;
      await act(async () => {
        res = await result.current.resolve({
          kind: 'comment',
          comment_id: TEST_COMMENT_ID,
          action,
        } as never);
      });

      expect((res as { ok: boolean; status: string }).ok).toBe(true);
      expect((res as { ok: boolean; status: string }).status).toBe(COMMENT_ACTION_STATUS[action]);
    },
  );
});

// ---------------------------------------------------------------------------
// Regresión — la rama property sigue intacta
// ---------------------------------------------------------------------------

describe('useResolveReport — regresión rama property (sin kind o kind:"property")', () => {
  it('EC-6 sin kind sigue invocando moderate-property, NUNCA moderate-comment', async () => {
    const mock = make_client(
      () => Promise.resolve({ data: { property_id: TEST_PROPERTY_ID, status: 'active' }, error: null }),
    );
    const { result } = await renderHook(() => useResolveReport({ supabase: mock.client }));

    await act(async () => {
      await result.current.resolve({ property_id: TEST_PROPERTY_ID, action: 'restore' });
    });

    expect(mock.calls[0]?.name).toBe('moderate-property');
    expect(mock.calls[0]?.name).not.toBe('moderate-comment');
  });
});

// ---------------------------------------------------------------------------
// Integridad del cliente supabase-js
// ---------------------------------------------------------------------------

describe('useResolveReport — no desprende functions.invoke (rama comment)', () => {
  it('EC-7 this sigue siendo el objeto functions al invocar moderate-comment', async () => {
    const mock = make_client(ok_invoke_comment());
    const { result } = await renderHook(() => useResolveReport({ supabase: mock.client }));

    await act(async () => {
      await result.current.resolve({
        kind: 'comment',
        comment_id: TEST_COMMENT_ID,
        action: 'restore',
      } as never);
    });

    expect(mock.was_detached()).toBe(false);
    expect(mock.calls[0]?.name).toBe('moderate-comment');
  });
});

// ---------------------------------------------------------------------------
// Traducción de códigos (#200) — rama comment
// ---------------------------------------------------------------------------

describe('useResolveReport — mensajes de error rama comment (#200)', () => {
  it('EC-8 ADMIN_REQUIRED produce un mensaje en español, no el literal crudo', async () => {
    const mock = make_client(failing_invoke('ADMIN_REQUIRED', 403));
    const { result } = await renderHook(() => useResolveReport({ supabase: mock.client }));

    await act(async () => {
      await result.current.resolve({
        kind: 'comment',
        comment_id: TEST_COMMENT_ID,
        action: 'restore',
      } as never);
    });

    expect(mock.calls[0]?.name).toBe('moderate-comment');
    expect(result.current.error_message).not.toBeNull();
    expect(result.current.error_message).not.toBe(RAW_SUPABASE_JS_MESSAGE);
  });

  it('EC-9 COMMENT_NOT_FOUND produce un mensaje distinguible de ADMIN_REQUIRED', async () => {
    const mock_admin = make_client(failing_invoke('ADMIN_REQUIRED', 403));
    const { result: r1 } = await renderHook(() => useResolveReport({ supabase: mock_admin.client }));
    await act(async () => {
      await r1.current.resolve({ kind: 'comment', comment_id: TEST_COMMENT_ID, action: 'restore' } as never);
    });
    const admin_message = r1.current.error_message;

    const mock_not_found = make_client(failing_invoke('COMMENT_NOT_FOUND', 404));
    const { result: r2 } = await renderHook(() =>
      useResolveReport({ supabase: mock_not_found.client }),
    );
    await act(async () => {
      await r2.current.resolve({ kind: 'comment', comment_id: TEST_COMMENT_ID, action: 'restore' } as never);
    });

    expect(r2.current.error_message).not.toBeNull();
    expect(r2.current.error_message).not.toBe(admin_message);
  });

  it('EC-10 INVALID_ACTION produce un mensaje distinguible de los dos anteriores', async () => {
    const mock = make_client(failing_invoke('INVALID_ACTION', 400));
    const { result } = await renderHook(() => useResolveReport({ supabase: mock.client }));

    await act(async () => {
      await result.current.resolve({
        kind: 'comment',
        comment_id: TEST_COMMENT_ID,
        action: 'restore',
      } as never);
    });

    expect(mock.calls[0]?.name).toBe('moderate-comment');
    expect(result.current.error_message).not.toBeNull();
    expect(result.current.error_message).not.toBe(RAW_SUPABASE_JS_MESSAGE);
  });

  it('EC-11 ningún código deja ver el literal crudo en inglés de supabase-js', async () => {
    for (const code of ['ADMIN_REQUIRED', 'COMMENT_NOT_FOUND', 'INVALID_ACTION', 'INVALID_INPUT', 'DB_ERROR']) {
      const mock = make_client(failing_invoke(code));
      const { result, unmount } = await renderHook(() => useResolveReport({ supabase: mock.client }));

      await act(async () => {
        await result.current.resolve({
          kind: 'comment',
          comment_id: TEST_COMMENT_ID,
          action: 'restore',
        } as never);
      });

      expect(mock.calls[0]?.name).toBe('moderate-comment');
      expect(result.current.error_message).not.toBe(RAW_SUPABASE_JS_MESSAGE);
      await act(async () => {
        unmount();
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Fallo de red
// ---------------------------------------------------------------------------

describe('useResolveReport — fallo de red rama comment', () => {
  it('EC-12 invoke rechazado devuelve ok:false sin lanzar y mensaje neutro', async () => {
    const functions = {
      invoke: jest.fn().mockRejectedValue(new Error('network down')),
    };
    const { result } = await renderHook(() => useResolveReport({ supabase: { functions } }));

    let res: unknown;
    await act(async () => {
      res = await result.current.resolve({
        kind: 'comment',
        comment_id: TEST_COMMENT_ID,
        action: 'restore',
      } as never);
    });

    expect((res as { ok: boolean }).ok).toBe(false);
    expect(result.current.error_message).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// No doble-submit
// ---------------------------------------------------------------------------

describe('useResolveReport — no doble-submit rama comment', () => {
  it('EC-13 segunda llamada mientras la primera sigue en vuelo se ignora sin segunda invocación', async () => {
    const mock = make_client(pending_invoke());
    const { result } = await renderHook(() => useResolveReport({ supabase: mock.client }));

    let first!: Promise<unknown>;
    let second_result: unknown;
    await act(async () => {
      first = result.current.resolve({
        kind: 'comment',
        comment_id: TEST_COMMENT_ID,
        action: 'restore',
      } as never);
      second_result = await result.current.resolve({
        kind: 'comment',
        comment_id: TEST_COMMENT_ID,
        action: 'keep_hidden',
      } as never);
    });

    expect(mock.calls).toHaveLength(1);
    expect((second_result as { ok: boolean }).ok).toBe(false);
    void first;
  });
});

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

describe('useResolveReport — is_submitting rama comment', () => {
  it('EC-14 is_submitting es true SÍNCRONAMENTE al disparar una acción de comentario', async () => {
    const mock = make_client(pending_invoke());
    const { result } = await renderHook(() => useResolveReport({ supabase: mock.client }));

    act(() => {
      void result.current.resolve({
        kind: 'comment',
        comment_id: TEST_COMMENT_ID,
        action: 'restore',
      } as never);
    });

    expect(result.current.is_submitting).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// onSuccess
// ---------------------------------------------------------------------------

describe('useResolveReport — onSuccess rama comment', () => {
  it('EC-15 onSuccess se llama SOLO tras éxito de una acción de comentario', async () => {
    const mock = make_client(ok_invoke_comment());
    const on_success = jest.fn();
    const { result } = await renderHook(() =>
      useResolveReport({ supabase: mock.client, onSuccess: on_success }),
    );

    await act(async () => {
      await result.current.resolve({
        kind: 'comment',
        comment_id: TEST_COMMENT_ID,
        action: 'restore',
      } as never);
    });

    expect(on_success).toHaveBeenCalledTimes(1);
  });
});
