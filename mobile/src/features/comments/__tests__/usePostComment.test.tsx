/**
 * Tests fase RED — usePostComment (publicar un comentario vía EF post-comment)
 * Archivo SUT: mobile/src/features/comments/hooks/usePostComment.ts
 * Subtarea Taskmaster: 289.7 (tarea #289)
 *
 * SEAM BAJO TEST (firma pública, DI del cliente):
 *
 *   usePostComment(property_id: string, opts?: {
 *     on_posted?: (comment: PostedComment) => void; supabase?: unknown;
 *   }): { post(body: string): Promise<PostedComment | null>; posting: boolean; error: string | null }
 *
 * CONTRATO HTTP anclado por supabase/functions/post-comment/types.ts (leído,
 * no asumido): POST { property_id, body } → 201 { comment: CommentRecord }
 * (comment.status es SOLO 'visible' | 'held_for_review' — el filtro de
 * clasificación decide, nunca 'hidden'/'deleted' en la respuesta de creación).
 * Errores: { error: { code, message } } con 400 INVALID_INPUT, 404
 * PROPERTY_NOT_FOUND, 409 PROPERTY_NOT_ACTIVE, 401 UNAUTHENTICATED, 500 DB_ERROR.
 *
 * 🔴 DECISIÓN (fijada por el orquestador, contrato de la subtarea 289.7):
 * SIN prepend optimista antes de la respuesta — `post()` resuelve con el
 * comentario tal como lo devolvió el servidor (con su `status` real, que la
 * UI usa para pintar "En revisión" si vino held_for_review) y es el LLAMADOR
 * quien hace `useComments().prepend(comment)` tras el await. El status lo
 * decide SIEMPRE el servidor (el filtro de contenido corre en la EF, no en
 * el cliente) — ningún test de este archivo asume que el hook adivina el
 * status antes de la respuesta.
 *
 * MAPA código → mensaje ES (copys ancla — fuente independiente, ver
 * constantes de este archivo; mismo patrón que useUpdateLeadNote.ts/75.6:
 * NUNCA el texto crudo de supabase-js/Postgres en inglés):
 *   INVALID_INPUT      → 'Tu comentario no puede estar vacío ni superar 500 caracteres.'
 *   PROPERTY_NOT_FOUND → 'Esta propiedad ya no existe.'
 *   PROPERTY_NOT_ACTIVE→ 'Esta propiedad ya no admite comentarios.'
 *   UNAUTHENTICATED    → 'Debes iniciar sesión de nuevo para continuar.'
 *   (código desconocido)        → 'Ocurrió un error. Intenta de nuevo.'
 *   (sin código — error de red) → 'No se pudo conectar. Verifica tu conexión e intenta de nuevo.'
 *
 * PATRÓN DE MOCK: FunctionsHttpError REAL con Response {error:{code,message}}
 * (idéntico a useUpdateLeadNote.test.ts/auth/api.test.ts) + supabaseMock
 * sensible al binding (#205, functions.invoke).
 *
 * EDGE CASES CUBIERTOS (17 casos):
 *
 * ### Happy path
 * - (EC-1) exito_invoca_post_comment_con_property_id_y_body_en_el_arg_body
 * - (EC-2) exito_devuelve_el_comment_creado_tal_cual_lo_manda_el_servidor
 * - (EC-3) exito_llama_on_posted_con_el_comentario_creado
 * - (EC-4) sin_prepend_optimista_on_posted_no_se_llama_antes_de_resolver_la_promesa
 *
 * ### Edge cases del PRD (§18.2 moderación)
 * - (EC-5) status_held_for_review_se_expone_igual_sin_reescribirlo_a_visible
 * - (EC-6) error_invalid_input_mensaje_de_validacion_exacto
 * - (EC-7) error_property_not_active_mensaje_propio_exacto
 * - (EC-8) error_property_not_found_mensaje_propio_exacto
 * - (EC-9) error_unauthenticated_mensaje_propio_exacto
 *
 * ### Boundary / error
 * - (EC-10) error_codigo_desconocido_mensaje_generico
 * - (EC-11) error_de_red_sin_codigo_mensaje_neutro_nunca_texto_crudo_en_ingles
 * - (EC-12) posting_true_sincronamente_al_disparar_post
 * - (EC-13) posting_false_tras_exito
 * - (EC-14) posting_false_tras_error
 * - (EC-15) doble_envio_bloquea_segunda_llamada_mientras_la_primera_esta_en_vuelo
 * - (EC-16) on_posted_no_se_llama_en_error
 *
 * ### 🔴 Integridad del cliente supabase-js (#205)
 * - (EC-17) functions_invoke_no_se_desprende_del_cliente
 */

import { FunctionsHttpError } from '@supabase/supabase-js';
import { renderHook, act } from '@testing-library/react-native';

import { make_binding_sensitive_supabase_mock } from '@/test-utils/supabaseMock';

import { usePostComment, type PostedComment } from '../hooks/usePostComment';

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const PROPERTY_ID = 'propiedad-post-comment-uuid-289';

const INVALID_INPUT_MESSAGE = 'Tu comentario no puede estar vacío ni superar 500 caracteres.';
const PROPERTY_NOT_FOUND_MESSAGE = 'Esta propiedad ya no existe.';
const PROPERTY_NOT_ACTIVE_MESSAGE = 'Esta propiedad ya no admite comentarios.';
const UNAUTHENTICATED_MESSAGE = 'Debes iniciar sesión de nuevo para continuar.';
const GENERIC_UNKNOWN_MESSAGE = 'Ocurrió un error. Intenta de nuevo.';
const NETWORK_MESSAGE = 'No se pudo conectar. Verifica tu conexión e intenta de nuevo.';

const CREATED_COMMENT: PostedComment = {
  id: 'comment-nuevo-uuid',
  property_id: PROPERTY_ID,
  user_id: 'usuario-autor-uuid',
  body: 'Muy buena ubicación',
  status: 'visible',
  created_at: '2026-09-11T10:00:00.000Z',
};

const HELD_COMMENT: PostedComment = { ...CREATED_COMMENT, id: 'comment-held-uuid', status: 'held_for_review' };

/** FunctionsHttpError real con body {error:{code,message}} — mismo patrón que useUpdateLeadNote.test.ts. */
function make_ef_http_error(code: string): FunctionsHttpError {
  return new FunctionsHttpError(
    new Response(JSON.stringify({ error: { code, message: 'mensaje interno de la EF' } }), { status: 400 }),
  );
}

function make_client(invoke_result: { data: unknown; error: unknown } | (() => Promise<{ data: unknown; error: unknown }>)) {
  const impl = typeof invoke_result === 'function' ? invoke_result : () => Promise.resolve(invoke_result);
  return make_binding_sensitive_supabase_mock({ invoke: impl });
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('usePostComment — happy path', () => {
  it('EC-1 éxito: invoca post-comment con { property_id, body } en el arg body', async () => {
    const mock = make_client({ data: { comment: CREATED_COMMENT }, error: null });
    const { result } = await renderHook(() => usePostComment(PROPERTY_ID, { supabase: mock.client }));

    await act(async () => {
      await result.current.post('Muy buena ubicación');
    });

    expect(mock._mock_invoke).toHaveBeenCalledWith('post-comment', {
      body: { property_id: PROPERTY_ID, body: 'Muy buena ubicación' },
    });
  });

  it('EC-2 éxito: devuelve el comment creado TAL CUAL lo manda el servidor', async () => {
    const mock = make_client({ data: { comment: CREATED_COMMENT }, error: null });
    const { result } = await renderHook(() => usePostComment(PROPERTY_ID, { supabase: mock.client }));

    let returned!: PostedComment | null;
    await act(async () => {
      returned = await result.current.post('Muy buena ubicación');
    });

    expect(returned).toEqual(CREATED_COMMENT);
  });

  it('EC-3 éxito: llama on_posted con el comentario creado', async () => {
    const mock = make_client({ data: { comment: CREATED_COMMENT }, error: null });
    const on_posted = jest.fn();
    const { result } = await renderHook(() => usePostComment(PROPERTY_ID, { supabase: mock.client, on_posted }));

    await act(async () => {
      await result.current.post('Muy buena ubicación');
    });

    expect(on_posted).toHaveBeenCalledTimes(1);
    expect(on_posted).toHaveBeenCalledWith(CREATED_COMMENT);
  });

  it('EC-4 sin prepend optimista: on_posted NO se llama antes de que la promesa de post() resuelva', async () => {
    let resolve_fn!: (v: { data: unknown; error: unknown }) => void;
    const pending = new Promise<{ data: unknown; error: unknown }>((resolve) => {
      resolve_fn = resolve;
    });
    const mock = make_client(() => pending);
    const on_posted = jest.fn();
    const { result } = await renderHook(() => usePostComment(PROPERTY_ID, { supabase: mock.client, on_posted }));

    let post_promise!: Promise<PostedComment | null>;
    act(() => {
      post_promise = result.current.post('Muy buena ubicación');
    });

    // Aún no resolvió — on_posted no debe haberse llamado (nada optimista).
    expect(on_posted).not.toHaveBeenCalled();

    resolve_fn({ data: { comment: CREATED_COMMENT }, error: null });
    await act(async () => {
      await post_promise;
    });

    expect(on_posted).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Edge cases del PRD §18.2
// ---------------------------------------------------------------------------

describe('usePostComment — 🔴 PRD §18.2', () => {
  it('EC-5 status held_for_review se expone TAL CUAL (sin reescribirlo a visible)', async () => {
    const mock = make_client({ data: { comment: HELD_COMMENT }, error: null });
    const { result } = await renderHook(() => usePostComment(PROPERTY_ID, { supabase: mock.client }));

    let returned!: PostedComment | null;
    await act(async () => {
      returned = await result.current.post('contiene una palabra filtrada');
    });

    expect(returned?.status).toBe('held_for_review');
  });

  it('EC-6 error INVALID_INPUT: mensaje de validación EXACTO', async () => {
    const mock = make_client({ data: null, error: make_ef_http_error('INVALID_INPUT') });
    const { result } = await renderHook(() => usePostComment(PROPERTY_ID, { supabase: mock.client }));

    await act(async () => {
      await result.current.post('');
    });

    expect(result.current.error).toBe(INVALID_INPUT_MESSAGE);
  });

  it('EC-7 error PROPERTY_NOT_ACTIVE: mensaje propio EXACTO', async () => {
    const mock = make_client({ data: null, error: make_ef_http_error('PROPERTY_NOT_ACTIVE') });
    const { result } = await renderHook(() => usePostComment(PROPERTY_ID, { supabase: mock.client }));

    await act(async () => {
      await result.current.post('hola');
    });

    expect(result.current.error).toBe(PROPERTY_NOT_ACTIVE_MESSAGE);
  });

  it('EC-8 error PROPERTY_NOT_FOUND: mensaje propio EXACTO', async () => {
    const mock = make_client({ data: null, error: make_ef_http_error('PROPERTY_NOT_FOUND') });
    const { result } = await renderHook(() => usePostComment(PROPERTY_ID, { supabase: mock.client }));

    await act(async () => {
      await result.current.post('hola');
    });

    expect(result.current.error).toBe(PROPERTY_NOT_FOUND_MESSAGE);
  });

  it('EC-9 error UNAUTHENTICATED: mensaje propio EXACTO', async () => {
    const mock = make_client({ data: null, error: make_ef_http_error('UNAUTHENTICATED') });
    const { result } = await renderHook(() => usePostComment(PROPERTY_ID, { supabase: mock.client }));

    await act(async () => {
      await result.current.post('hola');
    });

    expect(result.current.error).toBe(UNAUTHENTICATED_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// Boundary / error
// ---------------------------------------------------------------------------

describe('usePostComment — boundary / error', () => {
  it('EC-10 error con código desconocido: mensaje genérico', async () => {
    const mock = make_client({ data: null, error: make_ef_http_error('SOME_NEW_CODE') });
    const { result } = await renderHook(() => usePostComment(PROPERTY_ID, { supabase: mock.client }));

    await act(async () => {
      await result.current.post('hola');
    });

    expect(result.current.error).toBe(GENERIC_UNKNOWN_MESSAGE);
  });

  it('EC-11 error de red (sin código): mensaje neutro, NUNCA el texto crudo en inglés', async () => {
    const mock = make_client(() => Promise.reject(new Error('Network request failed')));
    const { result } = await renderHook(() => usePostComment(PROPERTY_ID, { supabase: mock.client }));

    let threw: unknown = null;
    await act(async () => {
      try {
        await result.current.post('hola');
      } catch (e) {
        threw = e;
      }
    });

    expect(threw).toBeNull();
    expect(result.current.error).toBe(NETWORK_MESSAGE);
    expect(result.current.error).not.toContain('Network request failed');
  });

  it('EC-12 posting=true SÍNCRONAMENTE al disparar post()', async () => {
    const pending = new Promise<{ data: unknown; error: unknown }>(() => {});
    const mock = make_client(() => pending);
    const { result } = await renderHook(() => usePostComment(PROPERTY_ID, { supabase: mock.client }));

    act(() => {
      void result.current.post('hola');
    });

    expect(result.current.posting).toBe(true);
  });

  it('EC-13 posting=false tras un éxito', async () => {
    const mock = make_client({ data: { comment: CREATED_COMMENT }, error: null });
    const { result } = await renderHook(() => usePostComment(PROPERTY_ID, { supabase: mock.client }));

    await act(async () => {
      await result.current.post('hola');
    });

    expect(result.current.posting).toBe(false);
  });

  it('EC-14 posting=false tras un error (no se queda colgado)', async () => {
    const mock = make_client({ data: null, error: make_ef_http_error('DB_ERROR') });
    const { result } = await renderHook(() => usePostComment(PROPERTY_ID, { supabase: mock.client }));

    await act(async () => {
      await result.current.post('hola');
    });

    expect(result.current.posting).toBe(false);
  });

  it('EC-15 doble envío: una 2ª llamada mientras la 1ª está en vuelo NO invoca la EF otra vez', async () => {
    let resolve_fn!: (v: { data: unknown; error: unknown }) => void;
    const pending = new Promise<{ data: unknown; error: unknown }>((resolve) => {
      resolve_fn = resolve;
    });
    const mock = make_client(() => pending);
    const { result } = await renderHook(() => usePostComment(PROPERTY_ID, { supabase: mock.client }));

    let first!: Promise<PostedComment | null>;
    let second!: Promise<PostedComment | null>;
    act(() => {
      first = result.current.post('primero');
      second = result.current.post('segundo');
    });

    expect(mock._mock_invoke).toHaveBeenCalledTimes(1);

    resolve_fn({ data: { comment: CREATED_COMMENT }, error: null });
    await act(async () => {
      await Promise.all([first, second]);
    });
  });

  it('EC-16 on_posted NO se llama en error', async () => {
    const mock = make_client({ data: null, error: make_ef_http_error('DB_ERROR') });
    const on_posted = jest.fn();
    const { result } = await renderHook(() => usePostComment(PROPERTY_ID, { supabase: mock.client, on_posted }));

    await act(async () => {
      await result.current.post('hola');
    });

    expect(on_posted).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 🔴 Integridad del cliente supabase-js (#205)
// ---------------------------------------------------------------------------

describe('usePostComment — 🔴 no desprender functions.invoke del cliente (#205)', () => {
  it('EC-17 invoca functions.invoke() LIGADO al cliente, sin desprenderlo', async () => {
    const mock = make_client({ data: { comment: CREATED_COMMENT }, error: null });
    const { result } = await renderHook(() => usePostComment(PROPERTY_ID, { supabase: mock.client }));

    let threw: unknown = null;
    try {
      await act(async () => {
        await result.current.post('hola');
      });
    } catch (e) {
      threw = e;
    }

    expect(threw).toBeNull();
    expect(mock._mock_invoke).toHaveBeenCalledTimes(1);
  });
});
