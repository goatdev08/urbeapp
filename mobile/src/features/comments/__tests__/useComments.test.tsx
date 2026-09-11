/**
 * Tests fase RED — useComments (lista paginada de comentarios de una propiedad)
 * Archivo SUT: mobile/src/features/comments/hooks/useComments.ts
 * Subtarea Taskmaster: 289.7 (tarea #289)
 *
 * SEAM BAJO TEST (firma pública, DI del cliente — mismo patrón que
 * useCrmLeadsPage.ts/usePropertyDetail.ts, los hooks de lectura paginada más
 * recientes del repo):
 *
 *   useComments(property_id: string, opts?: { page_size?: number; supabase?: unknown }): {
 *     items: CommentItem[]; loading: boolean; error: string | null; has_more: boolean;
 *     load_more(): Promise<void>; refetch(): Promise<void>;
 *     remove(id: string): void; update(id: string, patch: Partial<CommentItem>): void;
 *     prepend(item: CommentItem): void;
 *   }
 *
 * 🔴 DECISIÓN-FILTRO (fijada por este RED, GREEN debe cumplirla): la query NO
 * filtra `.in('status', ['visible','held_for_review'])`. Filtra SOLO
 * `.neq('status', 'deleted')` y deja que RLS (comments_select, migración
 * 20260910100001 §5) decida el resto por rol:
 *   - Cualquier authenticated sin relación con la fila: RLS solo devuelve
 *     status='visible' — el filtro explícito de más sería redundante.
 *   - El AUTOR ve su propio comentario en CUALQUIER status no-deleted (RLS
 *     `user_id = auth.uid()`) — necesario para que la UI pinte "En revisión"
 *     (held_for_review) y "Ocultado por moderación" (hidden) SOLO a él, tal
 *     como muestra el preview aprobado dirección A (contrato de la subtarea).
 *   - El GESTOR de la propiedad ve todo lo no-deleted (RLS
 *     `private.is_property_comment_manager`) — el hook confía en el server,
 *     no duplica esa decisión de negocio en el cliente.
 * `deleted` se excluye SIEMPRE en el cliente: un comentario "eliminado" no
 * vuelve a aparecer en el hilo ni para su propio autor (PRD §18.1 "el agente
 * puede ocultar... pero no eliminarlos definitivamente" — deleted es el único
 * estado que de verdad desaparece del hilo).
 *
 * PAGINACIÓN — keyset por (created_at, id), ambos DESC, con el truco LIMIT+1
 * (se pide `page_size + 1`; si vuelven más de `page_size` filas, `has_more`
 * es true y la fila extra se descarta ANTES de mapear a `items` — así
 * `has_more` es exacto, no una aproximación "quizás hay más"). `load_more`
 * arma el cursor desde el ÚLTIMO item cargado (no desde la fila descartada) y
 * lo manda como `.or('created_at.lt.<c>,and(created_at.eq.<c>,id.lt.<i>)')`
 * (mismo patrón keyset que evita duplicados en el límite exacto del cursor —
 * dos filas con el MISMO created_at se desempatan por id).
 *
 * IDENTIDAD — 2º query en paralelo a agent_public_profiles (mismas columnas
 * que usePropertyDetail.ts: full_name/profile_photo_url — NO
 * display_name/avatar_url, esos nombres no existen en la vista real, ver
 * supabase/types/database.types.ts:2133). Se OMITE por completo si la página
 * trae 0 filas (sin ids que resolver). Usuario sin fila en la vista → author:null
 * → la UI pinta "Usuario eliminado" (este hook no decide el copy).
 *
 * `loading` cubre SOLO carga inicial/refetch (precedente #288.1,
 * useFeedProperties.ts) — `load_more` es silencioso, protegido por un ref
 * interno contra reentrada, no por un 2º booleano de estado.
 *
 * `remove`/`update`/`prepend` son mutaciones LOCALES puras (sin red) — el
 * caller las usa tras una mutación exitosa de otro hook (useHideComment,
 * usePostComment) para no tener que refetch la página completa.
 *
 * Memorias que este RED hace cumplir:
 *   - supabase_js_metodo_desprendido (#205): client.from() vía
 *     make_binding_sensitive_supabase_mock — un `const {from} = client`
 *     dentro del hook lanza TypeError en TODOS los tests de este archivo.
 *   - hook_array_prop_reference_loop: EC-14 — un objeto opts NUEVO con el
 *     MISMO page_size no debe disparar refetch (dependencia por contenido).
 *   - rntl14_renderhook_async: renderHook/rerender siempre con `await`.
 *   - rntl_unmount_fuera_de_act: EC-20, unmount envuelto en act.
 *   - tests_bomba_de_fecha_y_estado_inicial: EC-11, sonda del primer render.
 *
 * EDGE CASES CUBIERTOS (21 casos):
 *
 * ### Happy path
 * - (EC-1)  primera_pagina_items_mapeados_con_identidad_incluye_usuario_sin_perfil_author_null
 * - (EC-2)  la_query_filtra_eq_property_id_explicito_no_confia_solo_en_rls
 * - (EC-3)  filtra_neq_status_deleted_y_no_agrega_un_in_de_status_explicito
 * - (EC-4)  identidad_via_agent_public_profiles_in_user_id_con_ids_unicos
 *
 * ### Edge cases del PRD (§18.1/§18.2)
 * - (EC-5)  autor_ve_su_propio_comentario_held_for_review_en_su_hoja_rls_decide
 * - (EC-6)  fila_hidden_devuelta_por_rls_al_gestor_no_se_filtra_doble_en_el_cliente
 * - (EC-7)  sin_mas_paginas_load_more_no_llama_a_la_red
 * - (EC-8)  hay_mas_paginas_load_more_usa_cursor_keyset_created_at_e_id_exacto
 * - (EC-9)  load_more_apenda_sin_duplicar_ids_ya_presentes_en_items
 *
 * ### Ramas no obvias
 * - (EC-10) sin_comentarios_en_la_pagina_no_llama_a_agent_public_profiles
 * - (EC-19) dependencias_por_contenido_opts_nuevo_mismo_page_size_no_dispara_refetch
 * - (EC-13) cambio_real_de_property_id_dispara_nuevo_fetch_y_resetea_items_y_cursor
 *
 * ### Boundary / error
 * - (EC-11) sonda_primer_render_loading_true_items_vacio_has_more_false_error_null
 * - (EC-12) error_de_red_en_la_query_principal_setea_error_y_loading_false
 * - (EC-14) error_en_refetch_no_borra_los_items_previos_fail_soft
 * - (EC-15) remove_quita_el_item_localmente_sin_llamar_a_la_red
 * - (EC-16) update_muta_un_item_por_id_localmente_sin_llamar_a_la_red
 * - (EC-17) prepend_inserta_al_inicio_sin_duplicar_si_el_id_ya_existe
 * - (EC-20) unmount_durante_fetch_en_vuelo_no_actualiza_estado_tras_desmontar
 *
 * ### 🔴 Integridad del cliente supabase-js (#205)
 * - (EC-18) from_no_se_desprende_del_cliente_el_flujo_completo_no_lanza
 * - (EC-21) segunda_pagina_tambien_usa_from_ligado_al_cliente_no_solo_la_primera
 *
 * ### 🔴 Paginación exacta (hallazgo guardián 289.7, ciclo 1: m11/m24 sobrevivían)
 * - (EC-22) la_query_pide_limit_page_size_mas_1_el_truco_limit_uno_que_hace_has_more_exacto
 * - (EC-23) ordena_por_created_at_desc_e_id_desc_el_2o_order_desempata_el_keyset
 */

import { renderHook, act } from '@testing-library/react-native';

import { make_binding_sensitive_supabase_mock } from '@/test-utils/supabaseMock';

import { useComments } from '../hooks/useComments';
import type { CommentItem } from '../types';
import { make_from_queue } from '@/test-utils/commentsQueryMock';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROPERTY_ID = 'propiedad-comentarios-uuid-289';
const OTHER_PROPERTY_ID = 'propiedad-comentarios-uuid-otra-289';

type CommentRow = {
  id: string;
  property_id: string;
  user_id: string;
  body: string;
  status: CommentItem['status'];
  created_at: string;
};

const ROW_A: CommentRow = {
  id: 'c-1',
  property_id: PROPERTY_ID,
  user_id: 'u-1',
  body: 'Buena zona, ¿tiene estacionamiento?',
  status: 'visible',
  created_at: '2026-09-01T10:00:00.000Z',
};

const ROW_B: CommentRow = {
  id: 'c-2',
  property_id: PROPERTY_ID,
  user_id: 'u-2',
  body: '¿Acepta mascotas?',
  status: 'held_for_review',
  created_at: '2026-09-01T09:00:00.000Z',
};

const PROFILE_U1 = { user_id: 'u-1', full_name: 'Ana Torres', profile_photo_url: 'https://cdn.urbea.mx/u1.jpg' };

function build_client(queues: Record<string, { data: unknown; error: unknown }[]>) {
  const queue = make_from_queue(queues);
  const mock = make_binding_sensitive_supabase_mock({ from: queue.from });
  return { client: mock.client, _mock_from: mock._mock_from, calls: queue.calls };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('useComments — happy path', () => {
  it('EC-1 primera página: items mapeados con identidad, usuario sin perfil → author:null', async () => {
    const { client } = build_client({
      comments: [{ data: [ROW_A, ROW_B], error: null }],
      agent_public_profiles: [{ data: [PROFILE_U1], error: null }],
    });

    const { result } = await renderHook(() => useComments(PROPERTY_ID, { supabase: client }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([
      { ...ROW_A, author: { full_name: 'Ana Torres', profile_photo_url: 'https://cdn.urbea.mx/u1.jpg' } },
      { ...ROW_B, author: null },
    ]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('EC-2 la query filtra .eq("property_id", …) explícito, no confía solo en RLS', async () => {
    const { client, calls } = build_client({
      comments: [{ data: [ROW_A], error: null }],
      agent_public_profiles: [{ data: [], error: null }],
    });

    await renderHook(() => useComments(PROPERTY_ID, { supabase: client }));
    await act(async () => {
      await Promise.resolve();
    });

    const eq_calls = calls.comments![0]!.filter((c) => c.method === 'eq');
    expect(eq_calls).toContainEqual({ method: 'eq', args: ['property_id', PROPERTY_ID] });

    // 🔧 Hallazgo guardián 289.7 (ciclo 1, m26): nadie aseguraba columnas
    // explícitas — un select('*') pasaba sin que ningún test lo notara.
    const select_call = calls.comments![0]!.find((c) => c.method === 'select');
    expect(select_call?.args[0]).not.toBe('*');
    expect(select_call?.args[0]).toBe('id, property_id, user_id, body, status, created_at');
  });

  it('EC-3 filtra .neq("status","deleted") y NO agrega un .in de status explícito', async () => {
    const { client, calls } = build_client({
      comments: [{ data: [ROW_A], error: null }],
      agent_public_profiles: [{ data: [], error: null }],
    });

    await renderHook(() => useComments(PROPERTY_ID, { supabase: client }));
    await act(async () => {
      await Promise.resolve();
    });

    const comments_calls = calls.comments![0]!;
    expect(comments_calls).toContainEqual({ method: 'neq', args: ['status', 'deleted'] });
    expect(comments_calls.some((c) => c.method === 'in' && c.args[0] === 'status')).toBe(false);
  });

  it('EC-4 identidad vía agent_public_profiles: .in("user_id", ids únicos)', async () => {
    const ROW_B2 = { ...ROW_B, id: 'c-3', user_id: 'u-1' }; // mismo autor que ROW_A → dedupe
    const { client, calls } = build_client({
      comments: [{ data: [ROW_A, ROW_B2], error: null }],
      agent_public_profiles: [{ data: [PROFILE_U1], error: null }],
    });

    await renderHook(() => useComments(PROPERTY_ID, { supabase: client }));
    await act(async () => {
      await Promise.resolve();
    });

    const identity_calls = calls.agent_public_profiles![0]!;
    const in_call = identity_calls.find((c) => c.method === 'in');
    expect(in_call?.args[0]).toBe('user_id');
    expect((in_call?.args[1] as string[]).sort()).toEqual(['u-1']);
  });
});

// ---------------------------------------------------------------------------
// Edge cases del PRD §18.1/§18.2
// ---------------------------------------------------------------------------

describe('useComments — 🔴 PRD §18.1/§18.2', () => {
  it('EC-5 el autor ve su propio comentario held_for_review en su hoja (RLS decide, el hook no filtra)', async () => {
    const { client } = build_client({
      comments: [{ data: [ROW_B], error: null }], // held_for_review, devuelto por RLS al autor
      agent_public_profiles: [{ data: [], error: null }],
    });

    const { result } = await renderHook(() => useComments(PROPERTY_ID, { supabase: client }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.status).toBe('held_for_review');
  });

  it('EC-6 fila "hidden" devuelta por RLS (gestor) no se filtra doble en el cliente', async () => {
    const HIDDEN_ROW: CommentRow = { ...ROW_A, id: 'c-hidden', status: 'hidden' };
    const { client } = build_client({
      comments: [{ data: [HIDDEN_ROW], error: null }],
      agent_public_profiles: [{ data: [], error: null }],
    });

    const { result } = await renderHook(() => useComments(PROPERTY_ID, { supabase: client }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.items.map((i) => i.id)).toEqual(['c-hidden']);
  });

  it('EC-7 sin más páginas: load_more() NO llama a la red', async () => {
    const { client, calls } = build_client({
      comments: [{ data: [ROW_A], error: null }], // 1 fila, page_size=2 → limit=3, no excede
      agent_public_profiles: [{ data: [], error: null }],
    });

    const { result } = await renderHook(() => useComments(PROPERTY_ID, { page_size: 2, supabase: client }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.has_more).toBe(false);

    await act(async () => {
      await result.current.load_more();
    });

    expect(calls.comments).toHaveLength(1);
  });

  it('EC-8 hay más páginas: load_more() usa cursor keyset EXACTO (created_at + id)', async () => {
    const R1: CommentRow = { id: 'c-10', property_id: PROPERTY_ID, user_id: 'u-1', body: 'r1', status: 'visible', created_at: '2026-09-05T12:00:00.000Z' };
    const R2: CommentRow = { id: 'c-9', property_id: PROPERTY_ID, user_id: 'u-1', body: 'r2', status: 'visible', created_at: '2026-09-05T11:00:00.000Z' };
    const R3_EXTRA: CommentRow = { id: 'c-8', property_id: PROPERTY_ID, user_id: 'u-1', body: 'r3', status: 'visible', created_at: '2026-09-05T10:00:00.000Z' };
    const R4: CommentRow = { id: 'c-7', property_id: PROPERTY_ID, user_id: 'u-1', body: 'r4', status: 'visible', created_at: '2026-09-05T09:00:00.000Z' };

    const { client, calls } = build_client({
      // page_size=2 → limit=3; 3 filas devueltas → has_more=true, R3_EXTRA se descarta.
      comments: [
        { data: [R1, R2, R3_EXTRA], error: null },
        { data: [R4], error: null },
      ],
      agent_public_profiles: [{ data: [], error: null }],
    });

    const { result } = await renderHook(() => useComments(PROPERTY_ID, { page_size: 2, supabase: client }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.items.map((i) => i.id)).toEqual(['c-10', 'c-9']);
    expect(result.current.has_more).toBe(true);

    await act(async () => {
      await result.current.load_more();
    });

    const second_call = calls.comments![1]!;
    const or_call = second_call.find((c) => c.method === 'or');
    expect(or_call?.args[0]).toBe(
      'created_at.lt.2026-09-05T11:00:00.000Z,and(created_at.eq.2026-09-05T11:00:00.000Z,id.lt.c-9)',
    );
    expect(result.current.items.map((i) => i.id)).toEqual(['c-10', 'c-9', 'c-7']);
    expect(result.current.has_more).toBe(false);
  });

  it('EC-9 load_more apenda SIN DUPLICAR ids que ya están en items', async () => {
    // 🔧 Fix guardián 289.7 (ciclo 1, m5): la versión original repetía R2 (una
    // fila que NUNCA había entrado a items — se descartó como extra del
    // LIMIT+1 en la 1ª página) y no probaba nada: sin el id realmente
    // presente en items, el filtro de dedupe nunca se ejercitaba (mutante
    // "load_more sin dedupe" sobrevivía, 0/21 fallan). Ahora la 2ª página
    // repite R1 (que SÍ está en items) junto con R2 (nuevo) — si el dedupe
    // se quita, R1 se duplicaría en el resultado.
    const R1: CommentRow = { id: 'c-10', property_id: PROPERTY_ID, user_id: 'u-1', body: 'r1', status: 'visible', created_at: '2026-09-05T12:00:00.000Z' };
    const R2: CommentRow = { id: 'c-9', property_id: PROPERTY_ID, user_id: 'u-1', body: 'r2', status: 'visible', created_at: '2026-09-05T11:00:00.000Z' };

    const { client } = build_client({
      comments: [
        { data: [R1, R2], error: null }, // page_size=1 → limit=2; 2 filas → has_more=true, se descarta R2 (extra), queda [R1]
        { data: [R1, R2], error: null }, // el servidor repite AMBAS filas (incluye R1, ya presente en items)
      ],
      agent_public_profiles: [{ data: [], error: null }],
    });

    const { result } = await renderHook(() => useComments(PROPERTY_ID, { page_size: 1, supabase: client }));
    await act(async () => {
      await Promise.resolve();
    });

    // page_size=1 → limit=2; 2 filas devueltas → has_more=true, se descarta R2 (extra), queda [R1].
    expect(result.current.items.map((i) => i.id)).toEqual(['c-10']);

    await act(async () => {
      await result.current.load_more();
    });

    // R1 (ya en items) se descarta por dedupe; solo R2 (nuevo) se apenda —
    // si el filtro se quita, R1 aparecería duplicado.

    expect(result.current.items.map((i) => i.id)).toEqual(['c-10', 'c-9']);
  });
});

// ---------------------------------------------------------------------------
// Ramas no obvias
// ---------------------------------------------------------------------------

describe('useComments — 🔴 ramas no obvias', () => {
  it('EC-10 sin comentarios en la página: NO llama a agent_public_profiles', async () => {
    const { client, calls } = build_client({
      comments: [{ data: [], error: null }],
      agent_public_profiles: [{ data: [], error: null }],
    });

    const { result } = await renderHook(() => useComments(PROPERTY_ID, { supabase: client }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.items).toEqual([]);
    expect(calls.agent_public_profiles ?? []).toHaveLength(0);
  });

  it('EC-19 opts NUEVO con el MISMO page_size no dispara refetch (dependencia por contenido)', async () => {
    const { client, calls } = build_client({
      comments: [{ data: [ROW_A], error: null }],
      agent_public_profiles: [{ data: [], error: null }],
    });

    const { result, rerender } = await renderHook(
      ({ opts }: { opts: { page_size: number; supabase: unknown } }) => useComments(PROPERTY_ID, opts),
      { initialProps: { opts: { page_size: 5, supabase: client } } },
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls.comments).toHaveLength(1);

    // Objeto NUEVO, mismo page_size (5) y mismo client — patrón del caller que
    // recrea el objeto de opciones inline en cada render.
    await rerender({ opts: { page_size: 5, supabase: client } });
    await act(async () => {
      await Promise.resolve();
    });

    expect(calls.comments).toHaveLength(1);
    expect(result.current.items.map((i) => i.id)).toEqual(['c-1']);
  });

  it('EC-13 cambio REAL de property_id dispara nuevo fetch y resetea items/cursor', async () => {
    const { client, calls } = build_client({
      comments: [
        { data: [ROW_A], error: null },
        { data: [{ ...ROW_A, id: 'c-otra-propiedad', property_id: OTHER_PROPERTY_ID }], error: null },
      ],
      agent_public_profiles: [{ data: [], error: null }],
    });

    const { result, rerender } = await renderHook(
      ({ id }: { id: string }) => useComments(id, { supabase: client }),
      { initialProps: { id: PROPERTY_ID } },
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.items.map((i) => i.id)).toEqual(['c-1']);

    await rerender({ id: OTHER_PROPERTY_ID });
    await act(async () => {
      await Promise.resolve();
    });

    expect(calls.comments).toHaveLength(2);
    const second_eq = calls.comments![1]!.find((c) => c.method === 'eq' && c.args[0] === 'property_id');
    expect(second_eq?.args[1]).toBe(OTHER_PROPERTY_ID);
    expect(result.current.items.map((i) => i.id)).toEqual(['c-otra-propiedad']);
  });
});

// ---------------------------------------------------------------------------
// Boundary / error
// ---------------------------------------------------------------------------

describe('useComments — boundary / error', () => {
  it('EC-11 sonda del primer render: loading=true, items=[], has_more=false, error=null', async () => {
    // 🔧 Fix RED (bug evidente, reportado en green-7.md): un mock que SÍ
    // resuelve (como el original con ROW_A) queda completamente drenado por
    // el propio `await renderHook(...)` — RNTL14/React18: `render()` envuelve
    // el montaje en `act()` AWAITED, que vacía la cola de microtareas hasta
    // quedar quieto, así que una cadena 100% basada en microtasks (como la de
    // este mock) siempre termina resuelta antes de que `renderHook` retorne.
    // Mismo patrón ya usado en useMyAds.test.tsx (EC-10/EC-11) y en EC-20 de
    // este mismo archivo: una promesa que NUNCA resuelve es la única forma de
    // aislar el estado SÍNCRONO del primer render.
    const pending = new Promise<{ data: unknown; error: unknown }>(() => {});
    const mock = make_binding_sensitive_supabase_mock({
      from: (table: string) =>
        table === 'comments'
          ? {
              select: jest.fn().mockReturnThis(),
              eq: jest.fn().mockReturnThis(),
              neq: jest.fn().mockReturnThis(),
              order: jest.fn().mockReturnThis(),
              limit: jest.fn().mockReturnThis(),
              then: (resolve: (v: unknown) => void) => pending.then(resolve),
            }
          : {
              select: jest.fn().mockReturnThis(),
              in: jest.fn().mockReturnThis(),
              then: (resolve: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(resolve),
            },
    });

    const { result } = await renderHook(() => useComments(PROPERTY_ID, { supabase: mock.client }));

    expect(result.current.loading).toBe(true);
    expect(result.current.items).toEqual([]);
    expect(result.current.has_more).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('EC-12 error de red en la query principal: error seteado, loading=false, items=[]', async () => {
    const { client } = build_client({
      comments: [{ data: null, error: { message: 'network error' } }],
      agent_public_profiles: [{ data: [], error: null }],
    });

    const { result } = await renderHook(() => useComments(PROPERTY_ID, { supabase: client }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect((result.current.error ?? '').length).toBeGreaterThan(0);
    expect(result.current.items).toEqual([]);
  });

  it('EC-14 error en refetch() NO borra los items previos (fail-soft)', async () => {
    const { client } = build_client({
      comments: [
        { data: [ROW_A], error: null },
        { data: null, error: { message: 'network error' } },
      ],
      agent_public_profiles: [{ data: [], error: null }],
    });

    const { result } = await renderHook(() => useComments(PROPERTY_ID, { supabase: client }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.items.map((i) => i.id)).toEqual(['c-1']);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.items.map((i) => i.id)).toEqual(['c-1']);
    expect((result.current.error ?? '').length).toBeGreaterThan(0);
  });

  it('EC-15 remove() quita el item localmente sin llamar a la red', async () => {
    const { client, calls } = build_client({
      comments: [{ data: [ROW_A, ROW_B], error: null }],
      agent_public_profiles: [{ data: [], error: null }],
    });

    const { result } = await renderHook(() => useComments(PROPERTY_ID, { supabase: client }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.remove(ROW_A.id);
    });

    expect(result.current.items.map((i) => i.id)).toEqual(['c-2']);
    expect(calls.comments).toHaveLength(1);
  });

  it('EC-16 update() muta un item por id localmente sin llamar a la red', async () => {
    const { client, calls } = build_client({
      comments: [{ data: [ROW_A, ROW_B], error: null }],
      agent_public_profiles: [{ data: [], error: null }],
    });

    const { result } = await renderHook(() => useComments(PROPERTY_ID, { supabase: client }));
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.update(ROW_B.id, { status: 'hidden' });
    });

    expect(result.current.items.find((i) => i.id === 'c-2')?.status).toBe('hidden');
    expect(result.current.items.find((i) => i.id === 'c-1')?.status).toBe('visible');
    expect(calls.comments).toHaveLength(1);
  });

  it('EC-17 prepend() inserta al inicio; si el id ya existe, no duplica', async () => {
    const { client } = build_client({
      comments: [{ data: [ROW_A], error: null }],
      agent_public_profiles: [{ data: [], error: null }],
    });

    const { result } = await renderHook(() => useComments(PROPERTY_ID, { supabase: client }));
    await act(async () => {
      await Promise.resolve();
    });

    const NEW_ITEM: CommentItem = {
      id: 'c-nuevo',
      property_id: PROPERTY_ID,
      user_id: 'u-3',
      body: 'Recién publicado',
      status: 'visible',
      created_at: '2026-09-06T08:00:00.000Z',
      author: null,
    };

    act(() => {
      result.current.prepend(NEW_ITEM);
    });
    expect(result.current.items.map((i) => i.id)).toEqual(['c-nuevo', 'c-1']);

    act(() => {
      result.current.prepend(NEW_ITEM); // id repetido — no debe duplicar
    });
    expect(result.current.items.map((i) => i.id)).toEqual(['c-nuevo', 'c-1']);
  });

  it('EC-20 unmount durante un fetch en vuelo no aplica estado tras desmontar (sin warning de act)', async () => {
    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    let resolve_fn!: (value: { data: unknown; error: unknown }) => void;
    const pending = new Promise<{ data: unknown; error: unknown }>((resolve) => {
      resolve_fn = resolve;
    });

    const queue = make_from_queue({});
    const original_from = queue.from;
    const mock = make_binding_sensitive_supabase_mock({
      from: (table: string) => {
        if (table === 'comments') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            neq: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            or: jest.fn().mockReturnThis(),
            then: (resolve: (v: unknown) => void) => pending.then(resolve),
          };
        }
        return original_from(table);
      },
    });

    const { unmount } = await renderHook(() => useComments(PROPERTY_ID, { supabase: mock.client }));

    await act(async () => {
      unmount();
    });

    resolve_fn({ data: [ROW_A], error: null });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const act_warnings = console_error_spy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes('not wrapped in act'),
    );
    expect(act_warnings).toHaveLength(0);
    console_error_spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 🔴 Integridad del cliente supabase-js (#205)
// ---------------------------------------------------------------------------

describe('useComments — 🔴 no desprender métodos de supabase-js (#205)', () => {
  it('EC-18 el flujo completo (from ligado al cliente) no lanza TypeError', async () => {
    const { client } = build_client({
      comments: [{ data: [ROW_A], error: null }],
      agent_public_profiles: [{ data: [], error: null }],
    });

    let threw: unknown = null;
    try {
      await renderHook(() => useComments(PROPERTY_ID, { supabase: client }));
      await act(async () => {
        await Promise.resolve();
      });
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeNull();
  });

  it('EC-21 la 2ª página (load_more) también usa from() ligado al cliente, no solo la 1ª', async () => {
    const R1: CommentRow = { id: 'c-10', property_id: PROPERTY_ID, user_id: 'u-1', body: 'r1', status: 'visible', created_at: '2026-09-05T12:00:00.000Z' };
    const R2: CommentRow = { id: 'c-9', property_id: PROPERTY_ID, user_id: 'u-1', body: 'r2', status: 'visible', created_at: '2026-09-05T11:00:00.000Z' };

    const { client } = build_client({
      comments: [
        { data: [R1, R2], error: null },
        { data: [], error: null },
      ],
      agent_public_profiles: [{ data: [], error: null }],
    });

    const { result } = await renderHook(() => useComments(PROPERTY_ID, { page_size: 1, supabase: client }));
    await act(async () => {
      await Promise.resolve();
    });

    let threw: unknown = null;
    try {
      await act(async () => {
        await result.current.load_more();
      });
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 🔴 Paginación exacta — LIMIT+1 y desempate por id (hallazgo guardián 289.7,
// ciclo 1: los mutantes "limit sin +1" y "sin .order('id')" sobrevivían
// porque ningún test aserta estos dos hechos directamente).
// ---------------------------------------------------------------------------

describe('useComments — 🔴 paginación exacta (LIMIT+1 y desempate)', () => {
  it('EC-22 la query pide .limit(page_size + 1) — el truco LIMIT+1 que hace has_more exacto', async () => {
    const { client, calls } = build_client({
      comments: [{ data: [], error: null }],
      agent_public_profiles: [{ data: [], error: null }],
    });

    await renderHook(() => useComments(PROPERTY_ID, { page_size: 7, supabase: client }));
    await act(async () => {
      await Promise.resolve();
    });

    const limit_call = calls.comments![0]!.find((c) => c.method === 'limit');
    expect(limit_call?.args[0]).toBe(8);
  });

  it("EC-23 ordena por (created_at desc, id desc) — el 2º order desempata el keyset", async () => {
    const { client, calls } = build_client({
      comments: [{ data: [], error: null }],
      agent_public_profiles: [{ data: [], error: null }],
    });

    await renderHook(() => useComments(PROPERTY_ID, { supabase: client }));
    await act(async () => {
      await Promise.resolve();
    });

    const orders = calls.comments![0]!.filter((c) => c.method === 'order').map((c) => c.args);
    expect(orders).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
  });
});
