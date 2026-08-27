/**
 * Tests fase RED — useNotifications (centro de notificaciones in-app,
 * módulo 041-M2, tarea #219)
 * Archivo SUT: mobile/src/features/notifications/hooks/useNotifications.ts
 * Tipos SUT:   mobile/src/features/notifications/types.ts
 * Subtarea Taskmaster: 219.3
 *
 * ---------------------------------------------------------------------------
 * SEAMS BAJO TEST (firma pública, fijados por el test-author — no se
 * renegocian sin dejar rastro en la bitácora de 219.3):
 * ---------------------------------------------------------------------------
 *
 *   useNotifications(): {
 *     notifications: NotificationItem[] | null;  // null mientras carga o en error — nunca [] fabricado
 *     unread_count: number;                      // derivado de `notifications` (read_at===null); 0 si notifications es null
 *     is_loading: boolean;
 *     error_message: string | null;              // mensaje neutro es-MX
 *     refetch: () => void;                       // patrón ignore/generación (tick), calcado de useAdminRevisions
 *     mark_read: (id: string) => Promise<void>;
 *     mark_all_read: () => Promise<void>;
 *   }
 *
 *   NotificationItem = columnas EXACTAS de public.notifications
 *   (supabase/migrations/20260604000007_analytics_moderation_audit.sql:56-69):
 *     id, type, title, body, deep_link, related_entity_type,
 *     related_entity_id, data, read_at, created_at.
 *
 * ---------------------------------------------------------------------------
 * QUERY DE LISTA bajo test (SELECT — sin RPC nueva, notifications_select ya
 * autoriza `user_id = auth.uid() or public.is_admin()`,
 * supabase/migrations/20260604000008_rls_helpers_and_policies.sql:371-374):
 * ---------------------------------------------------------------------------
 *
 *   supabase
 *     .from('notifications')
 *     .select(<columnas del contrato>)
 *     .eq('user_id', user.id)                     // 🔴 EXPLÍCITO — ver invariante abajo
 *     .is('deleted_at', null)
 *     .order('created_at', { ascending: false })
 *     .limit(50)
 *
 * 🔴 INVARIANTE CENTRAL — RLS NO ES EL FILTRO AQUÍ (precedente #155
 * Guardados + useMyAds.ts 171.3, memoria flatlist_numcolumns_row_keys: "mis
 * X" siempre filtra .eq(user_id) aunque RLS "ya filtre"). La policy
 * `notifications_select` tiene la cláusula `OR public.is_admin()` — un
 * SELECT sin `.eq('user_id', ...)` explícito, ejecutado por una cuenta
 * admin, devolvería las notificaciones de TODOS los usuarios de la
 * plataforma en "mi" centro de notificaciones. Lo mismo aplica a
 * `notifications_update` (idéntica cláusula OR) para mark_read/mark_all_read
 * — sin el `.eq('user_id', ...)` explícito en el UPDATE, un admin marcando
 * "todo leído" marcaría leídas las notificaciones de otros usuarios.
 *
 * ---------------------------------------------------------------------------
 * mark_read(id) — semántica FIJADA en este RED: OPTIMISTA + revert en fallo.
 * ---------------------------------------------------------------------------
 *
 *   1. Si `notifications` es null (no ha cargado), el id no existe en la
 *      lista actual, o la notificación YA está leída (`read_at !== null`) →
 *      no-op: NINGUNA llamada a `supabase.from('notifications').update(...)`.
 *   2. En otro caso: local, de INMEDIATO (antes de que la red resuelva),
 *      `read_at` de esa notificación pasa a un timestamp ISO "ahora"
 *      (`unread_count` baja en el mismo tick porque es derivado).
 *   3. Dispara:
 *        supabase.from('notifications')
 *          .update({ read_at: <ISO ahora> })
 *          .eq('id', id)
 *          .eq('user_id', user.id)
 *   4. Si el UPDATE falla (error o rechazo de promesa) → revierte ESA
 *      notificación a `read_at = null` (estado previo exacto, veraz).
 *
 * ---------------------------------------------------------------------------
 * mark_all_read() — misma semántica OPTIMISTA + revert, a nivel de lote.
 * ---------------------------------------------------------------------------
 *
 *   1. Si no hay no-leídas (`unread_count === 0`, incluye notifications
 *      null) → no-op: ninguna llamada a `update`.
 *   2. En otro caso: snapshot de los ids actualmente no-leídos, local, de
 *      INMEDIATO, todos esos pasan a `read_at = <ISO ahora>`.
 *   3. Dispara:
 *        supabase.from('notifications')
 *          .update({ read_at: <ISO ahora> })
 *          .is('read_at', null)
 *          .eq('user_id', user.id)
 *   4. Si el UPDATE falla → revierte SOLO los ids del snapshot (no una
 *      recomputación "todos los que ahora estén leídos") a `read_at = null`.
 *
 * ---------------------------------------------------------------------------
 * PATRÓN DE MOCK — invocaciones con cadena capturada por método+args
 * (Proxy, tolerante a la FORMA de la cadena, estricto en los ARGUMENTOS —
 * calcado de useMyAds.test.tsx `make_chainable_query`), `.from()` verifica
 * su propio `this` para detectar un `const {from} = supabase` desprendido
 * (memoria supabase_js_metodo_desprendido, calcado de
 * useModerateProperty.test.tsx `functions.invoke` `this !== functions`).
 * `useAuth` mockeado vía jest.mock (patrón useMyAds.test.tsx `set_auth_user`).
 * ---------------------------------------------------------------------------
 *
 * GOTCHAS RNTL 14 ya pagados: `const { result } = await renderHook(...)`
 * (sin await, `result` es undefined); interacciones que mutan estado
 * envueltas en `await act(async () => {...})`; `unmount()` dentro de `act`.
 *
 * ---------------------------------------------------------------------------
 * EDGE CASES CUBIERTOS (27 + 3 de hardening post-guardian = 30):
 * ---------------------------------------------------------------------------
 *
 * Hardening post-guardian (219.3, ver describe('hardening post-guardian')):
 *   - EC-10 endurecido a igualdad EXACTA del string de columnas (antes
 *     `toContain` por columna dejaba pasar over-fetch — mutante h).
 *   - EC-26 reescrito: el assert original (`console.error` tras unmount) era
 *     vacuo (React 19 no emite ese warning para function components; el
 *     mutante f lo pasaba en verde). Ahora ancla un invariante real
 *     (snapshot de `result.current` congelado en el instante del unmount +
 *     sin throw/unhandledRejection) y documenta que el mutante f se mata en
 *     EC-25, no aquí — ver comentario inline.
 *   - (H-1..H-3) rama sin sesión (`user: null`): sin red, `is_loading` cae a
 *     `false`, `notifications`/`error_message` sin fabricar, `mark_read` y
 *     `mark_all_read` son no-op.
 *
 * ### Happy path
 * - (EC-1)  camino_feliz_dos_notificaciones_shape_completo_orden_del_server_respetado
 * - (EC-2)  lista_vacia_legitima_notifications_array_vacio_unread_count_cero_sin_error
 *
 * ### PRD §22.1 (marca de no leída, "marcar todo como leído")
 * - (EC-3)  unread_count_mezcla_read_unread_cuenta_exacta_solo_read_at_null
 * - (EC-4)  todas_leidas_unread_count_cero
 * - (EC-5)  mark_all_read_deja_unread_count_en_cero_tras_exito
 *
 * ### 🔴 Invariante central — filtro explícito de user_id, RLS no es el filtro
 * - (EC-6)  query_de_lista_filtra_eq_user_id_explicito_no_confia_en_rls_admin
 * - (EC-7)  mark_read_filtra_eq_user_id_explicito_ademas_del_eq_id
 * - (EC-8)  mark_all_read_filtra_eq_user_id_explicito_ademas_del_is_read_at_null
 *
 * ### Ramas de reglas no obvias — construcción exacta de la query de lista
 * - (EC-9)  la_query_de_lista_se_construye_is_deleted_at_order_created_at_desc_limit_50
 * - (EC-10) el_select_incluye_exactamente_las_columnas_del_contrato_ni_una_de_mas_ni_de_menos
 *
 * ### mark_read — semántica optimista
 * - (EC-11) mark_read_actualiza_local_de_inmediato_antes_de_que_resuelva_la_red
 * - (EC-12) mark_read_envia_la_cadena_update_read_at_eq_id_eq_user_id
 * - (EC-13) mark_read_en_notificacion_ya_leida_es_no_op_no_dispara_red
 * - (EC-14) mark_read_con_id_inexistente_en_la_lista_es_no_op_no_dispara_red
 * - (EC-15) mark_read_falla_revierte_read_at_a_null_estado_veraz
 *
 * ### mark_all_read — semántica optimista
 * - (EC-16) mark_all_read_actualiza_local_todas_las_no_leidas_de_inmediato
 * - (EC-17) mark_all_read_envia_la_cadena_update_read_at_is_read_at_null_eq_user_id
 * - (EC-18) mark_all_read_sin_no_leidas_es_no_op_no_dispara_red
 * - (EC-19) mark_all_read_falla_revierte_solo_los_ids_del_snapshot_estado_veraz
 *
 * ### Boundary / error de carga
 * - (EC-20) carga_inicial_is_loading_true_notifications_null_antes_de_resolver
 * - (EC-21) error_de_postgrest_notifications_null_mensaje_neutro_es_mx
 * - (EC-22) data_null_sin_error_se_trata_como_error_nunca_lista_vacia_fabricada
 * - (EC-23) rechazo_de_promesa_cae_en_mensaje_neutro_sin_lanzar
 *
 * ### Refetch / carrera / unmount
 * - (EC-24) refetch_vuelve_a_pedir_la_lista_y_refleja_una_notificacion_nueva_del_backend
 * - (EC-25) carrera_de_generaciones_respuesta_tardia_de_un_refetch_viejo_no_pisa_el_nuevo_estando_montado
 * - (EC-26) unmount_durante_fetch_en_vuelo_no_setState_sin_warning
 *
 * ### Infra del mock
 * - (EC-27) el_cliente_mock_depende_de_this_ligado_from_desprendido_se_detecta
 *
 * ---------------------------------------------------------------------------
 * 223.3 — RED de dos defectos confirmados por el code review del PR #106
 * (módulo 041-M2, sobre el contrato ya fijado arriba en 219.3). 10 tests
 * nuevos (EC-28..EC-36 + H-4); los 30 anteriores NO se tocan.
 * ---------------------------------------------------------------------------
 *
 * (a) BADGE MENTIROSO — `unread_count` se derivaba del arreglo YA CAPADO por
 * `.limit(50)`: con más de 50 notificaciones (o más de 50 no leídas) el
 * badge miente, y `mark_all_read` solo marcaba la primera página. FIX
 * FIJADO: el conteo viene de una query de CABECERA independiente
 * (el índice `notifications_unread_idx` existe exactamente para esto):
 *
 *   supabase
 *     .from('notifications')
 *     .select('id', { count: 'exact', head: true })
 *     .eq('user_id', user.id)          // 🔴 explícito — mismo invariante que la lista
 *     .is('deleted_at', null)
 *     .is('read_at', null)
 *
 * mark_read/mark_all_read siguen optimistas, pero el optimismo ahora opera
 * sobre este conteo de cabecera (no sobre `notifications.filter(...)`):
 * decremento/reseteo exacto, con revert exacto en fallo al valor previo del
 * conteo de cabecera (nunca una recomputación desde el arreglo capado).
 *
 * 🔴 DECISIÓN FIJADA — fallo SOLO de la query de conteo (lista con éxito):
 * la lista se muestra igual (sin `error_message`) y el conteo CAE A 0 — no
 * se conserva el último valor válido. Razón: 0 es el valor "seguro" (nunca
 * sobreestima un badge, coincide con el estado inicial antes de la primera
 * carga) y no exige guardar un estado adicional de "último conteo bueno"
 * que podría quedar obsoleto igual de mentiroso que el bug original. Ver
 * EC-35.
 *
 * (b) mark_all_read ESTAMPA BORRADAS — el UPDATE masivo no llevaba
 * `.is('deleted_at', null)` (el SELECT sí lo lleva), así que ponía
 * `read_at` sobre notificaciones borradas. Ver EC-36.
 *
 * ### Conteo real de cabecera (badge no capado) — PR #106 defecto (a)
 * - (EC-28) lista_de_50_con_8_no_leidas_visibles_pero_el_conteo_de_cabecera_es_73_unread_count_refleja_73_no_8
 * - (EC-29) la_query_de_conteo_de_cabecera_se_construye_select_id_count_exact_head_true_eq_user_id_is_deleted_at_null_is_read_at_null
 * - (EC-30) mark_read_de_una_no_leida_baja_el_conteo_optimista_en_exactamente_uno_73_a_72
 * - (EC-31) mark_read_falla_revierte_el_conteo_optimista_exactamente_a_73
 * - (EC-32) mark_all_read_pone_el_conteo_optimista_en_cero_usando_el_conteo_de_cabecera_no_el_derivado_de_la_lista
 * - (EC-33) mark_all_read_falla_revierte_el_conteo_optimista_al_valor_previo_exacto_73
 * - (EC-34) refetch_vuelve_a_pedir_el_conteo_de_cabecera
 * - (EC-35) fallo_solo_de_la_query_de_conteo_la_lista_se_muestra_igual_el_conteo_cae_a_cero
 *
 * ### mark_all_read respeta deleted_at — PR #106 defecto (b)
 * - (EC-36) mark_all_read_update_incluye_is_deleted_at_null_ademas_de_eq_user_id_e_is_read_at_null
 *
 * ### Hardening — sin sesión, extiende H-1..H-3
 * - (H-4)  sin_sesion_no_se_llama_la_query_de_conteo_de_cabecera
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks — ANTES de cualquier import del SUT.
// ---------------------------------------------------------------------------

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar los mocks
// ---------------------------------------------------------------------------

import { useAuth } from '@/features/auth/context';
import { useNotifications } from '../hooks/useNotifications';
import type { NotificationItem } from '../types';

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'usuario-uuid-notif-219-3';

const NEUTRAL_ERROR_MESSAGE = 'No se pudieron cargar tus notificaciones. Intenta de nuevo.';

/** Columnas del contrato — ver docblock NotificationItem. */
const CONTRACT_COLUMNS = [
  'id',
  'type',
  'title',
  'body',
  'deep_link',
  'related_entity_type',
  'related_entity_id',
  'data',
  'read_at',
  'created_at',
];

function make_notification_row(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'notif-uuid-1',
    type: 'lead_new',
    title: 'Nuevo interesado',
    body: 'Alguien contactó por tu propiedad',
    deep_link: '/leads/lead-uuid-1',
    related_entity_type: 'lead',
    related_entity_id: 'lead-uuid-1',
    data: {},
    read_at: null,
    created_at: '2026-08-20T10:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock del cliente Supabase — invocaciones con cadena capturada por
// método+args (tolerante a la forma, estricto en los argumentos), y `.from`
// this-sensible para detectar desprendido.
// ---------------------------------------------------------------------------

type SelectResult = { data: NotificationItem[] | null; error: null | { message: string } };
type UpdateResult = { data: null; error: null | { message: string } };
/** Respuesta de una query de cabecera `.select('id', { count: 'exact', head: true })`. */
type CountResult = { count: number | null; error: null | { message: string } };
type ResultLike<R> = R | Promise<R> | (() => Promise<R>);

type RecordedCall = { method: string; args: unknown[] };
interface Invocation {
  kind: 'select' | 'update' | 'count';
  table: string;
  entry_arg: string | Record<string, unknown>;
  /** Segundo argumento de `.select(cols, options)` — solo presente en `kind: 'count'`. */
  entry_options?: Record<string, unknown>;
  chain: RecordedCall[];
}

function resolve_result<R>(value: ResultLike<R>): Promise<R> {
  if (typeof value === 'function') return (value as () => Promise<R>)();
  return value instanceof Promise ? value : Promise.resolve(value);
}

function make_chain_proxy(promise: Promise<unknown>, chain: RecordedCall[]): unknown {
  const proxy: unknown = new Proxy(
    () => {
      /* target callable no-op — nunca se invoca directo */
    },
    {
      get(_target, prop: string | symbol) {
        if (prop === 'then') return promise.then.bind(promise);
        return (...args: unknown[]) => {
          chain.push({ method: String(prop), args });
          return proxy;
        };
      },
    },
  );
  return proxy;
}

interface MockOptions {
  select_result?: ResultLike<SelectResult>;
  /**
   * Respuesta de la query de cabecera (`count: 'exact', head: true`). Si se
   * omite, se DERIVA de `select_result` (no-leídas del arreglo de lista) —
   * mantiene en verde los 30 tests preexistentes que nunca mencionan el
   * conteo de cabecera explícitamente. Los tests de 223.3 que fijan el
   * defecto (a) SIEMPRE lo pasan explícito y distinto del derivado de la
   * lista, para poder discriminar "cuenta del arreglo capado" de "cuenta de
   * cabecera real".
   */
  count_result?: ResultLike<CountResult>;
  /** Consumidos en orden de invocación de `.update(...)`; el último se repite si se agotan. */
  update_results?: ResultLike<UpdateResult>[];
}

/** Deriva un `CountResult` por defecto a partir de `select_result` cuando el test no fija uno explícito. */
function default_count_from_select(select_result: ResultLike<SelectResult> | undefined): CountResult {
  if (!select_result || typeof select_result === 'function' || select_result instanceof Promise) {
    return { count: 0, error: null };
  }
  const data = select_result.data;
  if (!data) return { count: 0, error: null };
  return { count: data.filter((n) => n.read_at === null).length, error: null };
}

function make_supabase_mock(opts: MockOptions = {}) {
  const invocations: Invocation[] = [];
  let update_call_index = 0;
  let detached = false;

  const client = {
    // Función NOMBRADA (no arrow, no jest.fn envolviendo una arrow) — el
    // binding de `this` importa: si el SUT hace `const {from} = supabase`,
    // `this` deja de ser `client` al invocar `from(...)` desprendido, y esa
    // llamada queda marcada (EC-27), calcado del `this !== functions` de
    // useModerateProperty.test.tsx (memoria supabase_js_metodo_desprendido).
    from(this: unknown, table: string) {
      if (this !== client) detached = true;
      return {
        select: (cols: string, options?: { count?: string; head?: boolean }) => {
          if (options?.head) {
            const inv: Invocation = { kind: 'count', table, entry_arg: cols, entry_options: options, chain: [] };
            invocations.push(inv);
            return make_chain_proxy(
              resolve_result(opts.count_result ?? default_count_from_select(opts.select_result)),
              inv.chain,
            );
          }
          const inv: Invocation = { kind: 'select', table, entry_arg: cols, chain: [] };
          invocations.push(inv);
          const default_result: SelectResult = { data: [], error: null };
          return make_chain_proxy(resolve_result(opts.select_result ?? default_result), inv.chain);
        },
        update: (payload: Record<string, unknown>) => {
          const inv: Invocation = { kind: 'update', table, entry_arg: payload, chain: [] };
          invocations.push(inv);
          const list = opts.update_results ?? [];
          const item: ResultLike<UpdateResult> =
            list[Math.min(update_call_index, Math.max(list.length - 1, 0))] ??
            ({ data: null, error: null } as UpdateResult);
          update_call_index += 1;
          return make_chain_proxy(resolve_result(item), inv.chain);
        },
      };
    },
  };

  return {
    client,
    invocations,
    was_detached: () => detached,
    update_calls_made: () => update_call_index,
  };
}

const mock_supabase_holder: { client: ReturnType<typeof make_supabase_mock>['client'] } = {
  client: null as never,
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

// ---------------------------------------------------------------------------
// Helpers de aserción
// ---------------------------------------------------------------------------

/** `.select(cols)` de una invocación 'select'; explota si no hay ninguna (falla ruidoso, no silencioso). */
function select_invocation(mock: ReturnType<typeof make_supabase_mock>): Invocation {
  const inv = mock.invocations.find((i) => i.kind === 'select');
  if (!inv) throw new Error('ninguna invocación select() capturada — el SUT no consultó la lista');
  return inv;
}

function find_chain_call(chain: RecordedCall[], method: string): RecordedCall | undefined {
  return chain.find((c) => c.method === method);
}

/** Invocación 'count' (query de cabecera); `undefined` si el SUT nunca la construyó — se asserta explícito. */
function find_count_invocation(mock: ReturnType<typeof make_supabase_mock>): Invocation | undefined {
  return mock.invocations.find((i) => i.kind === 'count');
}

/**
 * Página de `total` notificaciones con exactamente `unread` no-leídas al
 * frente del arreglo — usada para EC-28: simula la respuesta real de
 * `.limit(50)` cuando hay MÁS de 50 (o más de 50 no-leídas) en la tabla.
 */
function make_notification_list(total: number, unread: number): NotificationItem[] {
  return Array.from({ length: total }, (_, i) =>
    make_notification_row({
      id: `notif-uuid-page-${i}`,
      read_at: i < unread ? null : '2026-08-19T00:00:00.000Z',
      created_at: '2026-08-20T10:00:00.000Z',
    }),
  );
}

/** Valor ISO "reciente", acotado por el reloj real de la prueba — no una recomputación del SUT. */
function expect_recent_iso(value: unknown, before_ms: number, after_ms: number): void {
  expect(typeof value).toBe('string');
  const parsed = Date.parse(value as string);
  expect(Number.isNaN(parsed)).toBe(false);
  expect(parsed).toBeGreaterThanOrEqual(before_ms - 1);
  expect(parsed).toBeLessThanOrEqual(after_ms + 1);
}

function set_auth_user(user_id: string): void {
  mock_use_auth.mockReturnValue({
    user: { id: user_id } as any,
    session: null,
    isLoading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
    requestPasswordReset: jest.fn(),
    updatePassword: jest.fn(),
  } as any);
}

/** Sin sesión — `user: null` (harness pedido por el guardian de 219.3). */
function set_auth_user_sin_sesion(): void {
  mock_use_auth.mockReturnValue({
    user: null,
    session: null,
    isLoading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
    requestPasswordReset: jest.fn(),
    updatePassword: jest.fn(),
  } as any);
}

const ROW_1 = make_notification_row({
  id: 'notif-uuid-1',
  type: 'lead_new',
  read_at: null,
  created_at: '2026-08-19T09:00:00.000Z',
});
const ROW_2 = make_notification_row({
  id: 'notif-uuid-2',
  type: 'property_approved',
  title: 'Publicación aprobada',
  body: null,
  deep_link: '/my-listings',
  related_entity_type: 'property',
  related_entity_id: 'prop-uuid-2',
  data: { foo: 'bar' },
  read_at: '2026-08-19T09:30:00.000Z',
  created_at: '2026-08-20T11:00:00.000Z',
});

beforeEach(() => {
  jest.clearAllMocks();
  mock_supabase_holder.client = make_supabase_mock({
    select_result: { data: [ROW_1, ROW_2], error: null },
  }).client;
  set_auth_user(TEST_USER_ID);
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('useNotifications — happy path', () => {
  it('(EC-1) camino_feliz_dos_notificaciones_shape_completo_orden_del_server_respetado', async () => {
    const mock = make_supabase_mock({ select_result: { data: [ROW_1, ROW_2], error: null } });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());

    expect(result.current.is_loading).toBe(false);
    expect(result.current.error_message).toBeNull();
    expect(result.current.notifications).toHaveLength(2);

    const items = result.current.notifications as NotificationItem[];
    // Orden NO re-ordenado client-side: refleja tal cual la respuesta del server.
    expect(items[0]).toEqual(ROW_1);
    expect(items[1]).toEqual(ROW_2);

    // EC-27 embebido: el flujo completo de carga no desprendió `.from`.
    expect(mock.was_detached()).toBe(false);
  });

  it('(EC-2) lista_vacia_legitima_notifications_array_vacio_unread_count_cero_sin_error', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      select_result: { data: [], error: null },
    }).client;

    const { result } = await renderHook(() => useNotifications());

    expect(result.current.error_message).toBeNull();
    expect(result.current.notifications).toEqual([]);
    expect(result.current.unread_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PRD §22.1 — marca de no leída / marcar todo como leído
// ---------------------------------------------------------------------------

describe('useNotifications — unread_count (§22.1)', () => {
  it('(EC-3) unread_count_mezcla_read_unread_cuenta_exacta_solo_read_at_null', async () => {
    const row_unread_a = make_notification_row({ id: 'n-a', read_at: null });
    const row_unread_b = make_notification_row({ id: 'n-b', read_at: null });
    const row_read = make_notification_row({ id: 'n-c', read_at: '2026-08-19T00:00:00.000Z' });
    mock_supabase_holder.client = make_supabase_mock({
      select_result: { data: [row_unread_a, row_unread_b, row_read], error: null },
    }).client;

    const { result } = await renderHook(() => useNotifications());

    expect(result.current.unread_count).toBe(2);
  });

  it('(EC-4) todas_leidas_unread_count_cero', async () => {
    const row_a = make_notification_row({ id: 'n-a', read_at: '2026-08-19T00:00:00.000Z' });
    const row_b = make_notification_row({ id: 'n-b', read_at: '2026-08-19T01:00:00.000Z' });
    mock_supabase_holder.client = make_supabase_mock({
      select_result: { data: [row_a, row_b], error: null },
    }).client;

    const { result } = await renderHook(() => useNotifications());

    expect(result.current.unread_count).toBe(0);
  });

  it('(EC-5) mark_all_read_deja_unread_count_en_cero_tras_exito', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      select_result: { data: [ROW_1, make_notification_row({ id: 'n-x', read_at: null })], error: null },
    }).client;

    const { result } = await renderHook(() => useNotifications());
    expect(result.current.unread_count).toBe(2);

    await act(async () => {
      await result.current.mark_all_read();
    });

    expect(result.current.unread_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 🔴 Invariante central — filtro explícito de user_id, RLS no es el filtro
// ---------------------------------------------------------------------------

describe('useNotifications — filtro user_id explícito (RLS tiene OR is_admin())', () => {
  it('(EC-6) query_de_lista_filtra_eq_user_id_explicito_no_confia_en_rls_admin', async () => {
    const mock = make_supabase_mock({ select_result: { data: [ROW_1, ROW_2], error: null } });
    mock_supabase_holder.client = mock.client;

    await renderHook(() => useNotifications());

    const inv = select_invocation(mock);
    expect(inv.table).toBe('notifications');
    const eq_calls = inv.chain.filter((c) => c.method === 'eq');
    expect(eq_calls).toContainEqual({ method: 'eq', args: ['user_id', TEST_USER_ID] });
  });

  it('(EC-7) mark_read_filtra_eq_user_id_explicito_ademas_del_eq_id', async () => {
    const mock = make_supabase_mock({
      select_result: { data: [ROW_1], error: null },
      update_results: [{ data: null, error: null }],
    });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());

    await act(async () => {
      await result.current.mark_read('notif-uuid-1');
    });

    const update_inv = mock.invocations.find((i) => i.kind === 'update');
    expect(update_inv).toBeDefined();
    const chain = update_inv!.chain;
    expect(chain).toContainEqual({ method: 'eq', args: ['id', 'notif-uuid-1'] });
    expect(chain).toContainEqual({ method: 'eq', args: ['user_id', TEST_USER_ID] });
  });

  it('(EC-8) mark_all_read_filtra_eq_user_id_explicito_ademas_del_is_read_at_null', async () => {
    const mock = make_supabase_mock({
      select_result: { data: [ROW_1], error: null },
      update_results: [{ data: null, error: null }],
    });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());

    await act(async () => {
      await result.current.mark_all_read();
    });

    const update_inv = mock.invocations.find((i) => i.kind === 'update');
    expect(update_inv).toBeDefined();
    const chain = update_inv!.chain;
    expect(chain).toContainEqual({ method: 'is', args: ['read_at', null] });
    expect(chain).toContainEqual({ method: 'eq', args: ['user_id', TEST_USER_ID] });
  });
});

// ---------------------------------------------------------------------------
// Ramas de reglas no obvias — construcción exacta de la query de lista
// ---------------------------------------------------------------------------

describe('useNotifications — construcción exacta de la query de lista', () => {
  it('(EC-9) la_query_de_lista_se_construye_is_deleted_at_order_created_at_desc_limit_50', async () => {
    const mock = make_supabase_mock({ select_result: { data: [], error: null } });
    mock_supabase_holder.client = mock.client;

    await renderHook(() => useNotifications());

    const inv = select_invocation(mock);
    const is_call = find_chain_call(inv.chain, 'is');
    const order_call = find_chain_call(inv.chain, 'order');
    const limit_call = find_chain_call(inv.chain, 'limit');

    expect(is_call?.args).toEqual(['deleted_at', null]);
    expect(order_call?.args).toEqual(['created_at', { ascending: false }]);
    expect(limit_call?.args).toEqual([50]);
  });

  it('(EC-10) el_select_incluye_exactamente_las_columnas_del_contrato_ni_una_de_mas_ni_de_menos', async () => {
    const mock = make_supabase_mock({ select_result: { data: [], error: null } });
    mock_supabase_holder.client = mock.client;

    await renderHook(() => useNotifications());

    const inv = select_invocation(mock);
    const select_arg = inv.entry_arg as string;
    // Endurecido post-guardian (mutante h — columnas de más como
    // `deleted_at, updated_at` sobrevivía a un `toContain` por columna):
    // igualdad EXACTA contra el string derivado de CONTRACT_COLUMNS, cuyo
    // orden viene de una fuente independiente del SUT — el DDL de la
    // migración (supabase/migrations/20260604000007_analytics_moderation_
    // audit.sql:56-69) — no del propio SELECT_COLUMNS del hook.
    expect(select_arg).toBe(CONTRACT_COLUMNS.join(', '));
  });
});

// ---------------------------------------------------------------------------
// mark_read — semántica optimista
// ---------------------------------------------------------------------------

describe('useNotifications — mark_read (optimista + revert)', () => {
  it('(EC-11) mark_read_actualiza_local_de_inmediato_antes_de_que_resuelva_la_red', async () => {
    let resolve_update!: (v: UpdateResult) => void;
    const pending_update = new Promise<UpdateResult>((resolve) => {
      resolve_update = resolve;
    });
    const mock = make_supabase_mock({
      select_result: { data: [ROW_1], error: null },
      update_results: [pending_update],
    });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());
    expect(result.current.unread_count).toBe(1);

    // Dispara mark_read pero NO espera a que la red resuelva todavía.
    let mark_read_promise!: Promise<void>;
    await act(async () => {
      mark_read_promise = result.current.mark_read('notif-uuid-1');
      // Deja correr solo el trabajo síncrono/microtask previo al await de red.
      await Promise.resolve();
    });

    // El estado local YA refleja leída, aunque la red siga pendiente.
    expect(result.current.unread_count).toBe(0);
    const item = (result.current.notifications as NotificationItem[]).find(
      (n) => n.id === 'notif-uuid-1',
    )!;
    expect(item.read_at).not.toBeNull();

    // Cierra la red pendiente para no dejar handles colgando en el test.
    await act(async () => {
      resolve_update({ data: null, error: null });
      await mark_read_promise;
    });
  });

  it('(EC-12) mark_read_envia_la_cadena_update_read_at_eq_id_eq_user_id', async () => {
    const mock = make_supabase_mock({
      select_result: { data: [ROW_1], error: null },
      update_results: [{ data: null, error: null }],
    });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());

    const before_ms = Date.now();
    await act(async () => {
      await result.current.mark_read('notif-uuid-1');
    });
    const after_ms = Date.now();

    const update_inv = mock.invocations.find((i) => i.kind === 'update')!;
    expect(update_inv.table).toBe('notifications');
    const payload = update_inv.entry_arg as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['read_at']);
    expect_recent_iso(payload.read_at, before_ms, after_ms);
  });

  it('(EC-13) mark_read_en_notificacion_ya_leida_es_no_op_no_dispara_red', async () => {
    const mock = make_supabase_mock({ select_result: { data: [ROW_2], error: null } }); // ROW_2 ya leída
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());
    expect(result.current.unread_count).toBe(0);

    await act(async () => {
      await result.current.mark_read('notif-uuid-2');
    });

    const update_inv = mock.invocations.find((i) => i.kind === 'update');
    expect(update_inv).toBeUndefined();
  });

  it('(EC-14) mark_read_con_id_inexistente_en_la_lista_es_no_op_no_dispara_red', async () => {
    const mock = make_supabase_mock({ select_result: { data: [ROW_1], error: null } });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());

    await act(async () => {
      await result.current.mark_read('id-que-no-existe-en-la-lista');
    });

    const update_inv = mock.invocations.find((i) => i.kind === 'update');
    expect(update_inv).toBeUndefined();
    // El resto de la lista no se ve afectado.
    expect(result.current.unread_count).toBe(1);
  });

  it('(EC-15) mark_read_falla_revierte_read_at_a_null_estado_veraz', async () => {
    const mock = make_supabase_mock({
      select_result: { data: [ROW_1], error: null },
      update_results: [{ data: null, error: { message: 'RLS denied' } }],
    });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());

    await act(async () => {
      await result.current.mark_read('notif-uuid-1');
    });

    // Estado veraz: el UPDATE falló, la notificación sigue no-leída.
    expect(result.current.unread_count).toBe(1);
    const item = (result.current.notifications as NotificationItem[]).find(
      (n) => n.id === 'notif-uuid-1',
    )!;
    expect(item.read_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mark_all_read — semántica optimista
// ---------------------------------------------------------------------------

describe('useNotifications — mark_all_read (optimista + revert)', () => {
  it('(EC-16) mark_all_read_actualiza_local_todas_las_no_leidas_de_inmediato', async () => {
    const row_c = make_notification_row({ id: 'n-c', read_at: null });
    const mock = make_supabase_mock({
      select_result: { data: [ROW_1, ROW_2, row_c], error: null }, // ROW_2 ya leída
      update_results: [{ data: null, error: null }],
    });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());
    expect(result.current.unread_count).toBe(2); // ROW_1 y row_c

    await act(async () => {
      await result.current.mark_all_read();
    });

    const items = result.current.notifications as NotificationItem[];
    expect(items.every((n) => n.read_at !== null)).toBe(true);
    expect(result.current.unread_count).toBe(0);
  });

  it('(EC-17) mark_all_read_envia_la_cadena_update_read_at_is_read_at_null_eq_user_id', async () => {
    const mock = make_supabase_mock({
      select_result: { data: [ROW_1], error: null },
      update_results: [{ data: null, error: null }],
    });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());

    const before_ms = Date.now();
    await act(async () => {
      await result.current.mark_all_read();
    });
    const after_ms = Date.now();

    const update_inv = mock.invocations.find((i) => i.kind === 'update')!;
    const payload = update_inv.entry_arg as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['read_at']);
    expect_recent_iso(payload.read_at, before_ms, after_ms);
  });

  it('(EC-18) mark_all_read_sin_no_leidas_es_no_op_no_dispara_red', async () => {
    const mock = make_supabase_mock({ select_result: { data: [ROW_2], error: null } }); // ya leída
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());
    expect(result.current.unread_count).toBe(0);

    await act(async () => {
      await result.current.mark_all_read();
    });

    const update_inv = mock.invocations.find((i) => i.kind === 'update');
    expect(update_inv).toBeUndefined();
  });

  it('(EC-19) mark_all_read_falla_revierte_solo_los_ids_del_snapshot_estado_veraz', async () => {
    const row_c = make_notification_row({ id: 'n-c', read_at: null });
    const mock = make_supabase_mock({
      select_result: { data: [ROW_1, ROW_2, row_c], error: null }, // ROW_2 ya leída
      update_results: [{ data: null, error: { message: 'network down' } }],
    });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());

    await act(async () => {
      await result.current.mark_all_read();
    });

    const items = result.current.notifications as NotificationItem[];
    // Revierte a como estaban: ROW_1 y n-c vuelven a null; ROW_2 sigue leída (no se tocó).
    expect(items.find((n) => n.id === 'notif-uuid-1')?.read_at).toBeNull();
    expect(items.find((n) => n.id === 'n-c')?.read_at).toBeNull();
    expect(items.find((n) => n.id === 'notif-uuid-2')?.read_at).toBe(ROW_2.read_at);
    expect(result.current.unread_count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Boundary / error de carga
// ---------------------------------------------------------------------------

describe('useNotifications — boundary / error de carga', () => {
  it('(EC-20) carga_inicial_is_loading_true_notifications_null_antes_de_resolver', async () => {
    const never_resolving = new Promise<SelectResult>(() => {
      /* nunca resuelve */
    });
    mock_supabase_holder.client = make_supabase_mock({ select_result: never_resolving }).client;

    const { result } = await renderHook(() => useNotifications());

    expect(result.current.is_loading).toBe(true);
    expect(result.current.notifications).toBeNull();
    expect(result.current.error_message).toBeNull();
    expect(result.current.unread_count).toBe(0);
  });

  it('(EC-21) error_de_postgrest_notifications_null_mensaje_neutro_es_mx', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      select_result: { data: null, error: { message: 'RLS denied' } },
    }).client;

    const { result } = await renderHook(() => useNotifications());

    expect(result.current.is_loading).toBe(false);
    expect(result.current.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(result.current.notifications).toBeNull();
  });

  it('(EC-22) data_null_sin_error_se_trata_como_error_nunca_lista_vacia_fabricada', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      select_result: { data: null, error: null },
    }).client;

    const { result } = await renderHook(() => useNotifications());

    expect(result.current.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(result.current.notifications).toBeNull();
  });

  it('(EC-23) rechazo_de_promesa_cae_en_mensaje_neutro_sin_lanzar', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      select_result: () => Promise.reject(new Error('network down')),
    }).client;

    let thrown: unknown = null;
    let final_state: { notifications: unknown; error_message: string | null } | undefined;
    try {
      const rendered = await renderHook(() => useNotifications());
      final_state = rendered.result.current;
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeNull();
    expect(final_state?.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(final_state?.notifications).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Refetch / carrera de generaciones / unmount
// ---------------------------------------------------------------------------

describe('useNotifications — refetch, carrera y unmount', () => {
  it('(EC-24) refetch_vuelve_a_pedir_la_lista_y_refleja_una_notificacion_nueva_del_backend', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      select_result: { data: [ROW_1], error: null },
    }).client;

    const { result } = await renderHook(() => useNotifications());
    expect(result.current.notifications).toHaveLength(1);

    const row_3 = make_notification_row({ id: 'notif-uuid-3', created_at: '2026-08-21T08:00:00.000Z' });
    mock_supabase_holder.client = make_supabase_mock({
      select_result: { data: [ROW_1, row_3], error: null },
    }).client;

    await act(async () => {
      result.current.refetch();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.notifications).toHaveLength(2);
    expect(result.current.notifications?.[1]?.id).toBe('notif-uuid-3');
  });

  it('(EC-25) carrera_de_generaciones_respuesta_tardia_de_un_refetch_viejo_no_pisa_el_nuevo_estando_montado', async () => {
    let resolve_gen1!: (v: SelectResult) => void;
    const pending_gen1 = new Promise<SelectResult>((resolve) => {
      resolve_gen1 = resolve;
    });
    mock_supabase_holder.client = make_supabase_mock({ select_result: pending_gen1 }).client;

    const { result } = await renderHook(() => useNotifications());
    expect(result.current.is_loading).toBe(true);
    expect(result.current.notifications).toBeNull();

    // gen2: swap del cliente ANTES del refetch — resuelve de inmediato con datos distintos.
    const row_gen2 = make_notification_row({ id: 'notif-uuid-gen2' });
    mock_supabase_holder.client = make_supabase_mock({
      select_result: { data: [row_gen2], error: null },
    }).client;

    await act(async () => {
      result.current.refetch();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.is_loading).toBe(false);
    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications?.[0]?.id).toBe('notif-uuid-gen2');

    // Recién ahora resuelve la promesa tardía de gen1 — hook sigue montado.
    await act(async () => {
      resolve_gen1({ data: [ROW_1, ROW_2], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Invariante: gen1 (vieja) no puede pisar el estado de gen2 (nueva).
    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications?.[0]?.id).toBe('notif-uuid-gen2');
  });

  it('(EC-26) unmount_durante_fetch_en_vuelo_no_setState_sin_warning', async () => {
    // ---------------------------------------------------------------------
    // Endurecido post-guardian: el `expect(...).not.toHaveBeenCalled()`
    // original era VACUO — React 19 nunca emite el warning legacy "state
    // update on an unmounted component" para componentes función, así que
    // el espía jamás dispara pase lo que pase con el SUT (verificado: el
    // mutante (f), quitar `return () => { ignore = true }`, seguía pasando
    // este assert en verde).
    //
    // Investigación (bitácora 219.3, hardening): tras instrumentar el hook
    // real con console.error/warn spies + listener de unhandledRejection +
    // snapshot de `result.current`, un unmount() real + resolución tardía
    // produce EXACTAMENTE la misma salida observable con y sin el cleanup
    // `ignore = true` — React descarta la actualización de un fiber ya
    // desmontado de forma total y silenciosa (sin log, sin excepción, sin
    // re-render), sea o no diligente el propio hook. Es decir: para el
    // escenario de UNMOUNT PURO, ningún test de caja negra puede discriminar
    // el mutante (f) — la garantía "no state tras unmount" ya la da React,
    // no el `ignore` del hook. El mutante SÍ muere en EC-25 (el `ignore`
    // existe para la generación viva-pero-obsoleta durante un re-render por
    // cambio de deps, no para el unmount).
    //
    // Este test se conserva como ancla de un invariante real y distinto:
    // el snapshot final expuesto a cualquier consumidor de `result.current`
    // queda CONGELADO tal cual estaba en el instante del unmount (nunca
    // "salta" a reflejar la respuesta tardía), y unmountear a media
    // descarga no revienta ni deja una promesa rechazada sin atrapar.
    // ---------------------------------------------------------------------
    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const console_warn_spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let unhandled_rejection: unknown = null;
    const on_unhandled_rejection = (reason: unknown) => {
      unhandled_rejection = reason;
    };
    process.on('unhandledRejection', on_unhandled_rejection);

    let resolve_select!: (v: SelectResult) => void;
    const pending = new Promise<SelectResult>((resolve) => {
      resolve_select = resolve;
    });
    mock_supabase_holder.client = make_supabase_mock({ select_result: pending }).client;

    const { result, unmount } = await renderHook(() => useNotifications());
    expect(result.current.is_loading).toBe(true);

    await act(async () => {
      unmount();
    });

    // Snapshot congelado en el instante exacto del unmount — ninguna
    // resolución posterior puede ya alcanzarlo.
    const frozen_snapshot = { ...result.current };

    await act(async () => {
      resolve_select({ data: [ROW_1, ROW_2], error: null });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.is_loading).toBe(frozen_snapshot.is_loading);
    expect(result.current.notifications).toBe(frozen_snapshot.notifications);
    expect(result.current.error_message).toBe(frozen_snapshot.error_message);
    expect(console_error_spy).not.toHaveBeenCalled();
    expect(console_warn_spy).not.toHaveBeenCalled();
    expect(unhandled_rejection).toBeNull();

    console_error_spy.mockRestore();
    console_warn_spy.mockRestore();
    process.off('unhandledRejection', on_unhandled_rejection);
  });
});

// ---------------------------------------------------------------------------
// Infra del mock — desprendido de `.from`
// ---------------------------------------------------------------------------

describe('useNotifications — métodos no desprendidos', () => {
  it('(EC-27) el_cliente_mock_depende_de_this_ligado_from_desprendido_se_detecta', async () => {
    const mock = make_supabase_mock({
      select_result: { data: [ROW_1], error: null },
      update_results: [{ data: null, error: null }],
    });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());

    await act(async () => {
      await result.current.mark_read('notif-uuid-1');
    });

    // Cadena completa (lista + mark_read) ligada correctamente: si el SUT
    // alguna vez desprende `supabase.from` (`const {from} = supabase`),
    // este flujo lo cazaría (memoria supabase_js_metodo_desprendido).
    expect(mock.was_detached()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 223.3 — Conteo real de cabecera (badge no capado por .limit(50))
// PR #106 defecto (a). Ver docblock superior para la query exacta y la
// decisión fijada sobre el fallo aislado del conteo.
// ---------------------------------------------------------------------------

describe('useNotifications — conteo real de cabecera (badge no capado, PR #106 defecto a)', () => {
  it('(EC-28) lista_de_50_con_8_no_leidas_visibles_pero_el_conteo_de_cabecera_es_73_unread_count_refleja_73_no_8', async () => {
    const page = make_notification_list(50, 8);
    const mock = make_supabase_mock({
      select_result: { data: page, error: null },
      count_result: { count: 73, error: null },
    });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());

    expect(result.current.notifications).toHaveLength(50);
    // El defecto: hoy `unread_count` se deriva del arreglo YA CAPADO por
    // `.limit(50)` y daría 8. El fix consulta una cabecera independiente
    // (count: 'exact', head: true) — notifications_unread_idx existe
    // exactamente para esto.
    expect(result.current.unread_count).toBe(73);
    expect(result.current.unread_count).not.toBe(8);
  });

  it("(EC-29) la_query_de_conteo_de_cabecera_se_construye_select_id_count_exact_head_true_eq_user_id_is_deleted_at_null_is_read_at_null", async () => {
    const mock = make_supabase_mock({
      select_result: { data: [], error: null },
      count_result: { count: 0, error: null },
    });
    mock_supabase_holder.client = mock.client;

    await renderHook(() => useNotifications());

    const count_inv = find_count_invocation(mock);
    expect(count_inv).toBeDefined();
    expect(count_inv!.table).toBe('notifications');
    expect(count_inv!.entry_arg).toBe('id');
    expect(count_inv!.entry_options).toEqual({ count: 'exact', head: true });

    const chain = count_inv!.chain;
    // 🔴 mismo invariante que la lista: `.eq('user_id', ...)` EXPLÍCITO, la
    // policy notifications_select lleva `OR is_admin()`.
    expect(chain).toContainEqual({ method: 'eq', args: ['user_id', TEST_USER_ID] });
    expect(chain).toContainEqual({ method: 'is', args: ['deleted_at', null] });
    expect(chain).toContainEqual({ method: 'is', args: ['read_at', null] });
  });

  it('(EC-30) mark_read_de_una_no_leida_baja_el_conteo_optimista_en_exactamente_uno_73_a_72', async () => {
    let resolve_update!: (v: UpdateResult) => void;
    const pending_update = new Promise<UpdateResult>((resolve) => {
      resolve_update = resolve;
    });
    const mock = make_supabase_mock({
      select_result: { data: [ROW_1], error: null }, // ROW_1 no-leída, visible en la página
      count_result: { count: 73, error: null }, // cabecera real: 73 (mayor que lo visible)
      update_results: [pending_update],
    });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());
    expect(result.current.unread_count).toBe(73);

    let mark_read_promise!: Promise<void>;
    await act(async () => {
      mark_read_promise = result.current.mark_read('notif-uuid-1');
      await Promise.resolve();
    });

    // Optimista sobre el conteo de CABECERA: 73 → 72 exacto, nunca una
    // recomputación desde el arreglo (ya capado) visible.
    expect(result.current.unread_count).toBe(72);

    await act(async () => {
      resolve_update({ data: null, error: null });
      await mark_read_promise;
    });
    expect(result.current.unread_count).toBe(72);
  });

  it('(EC-31) mark_read_falla_revierte_el_conteo_optimista_exactamente_a_73', async () => {
    const mock = make_supabase_mock({
      select_result: { data: [ROW_1], error: null },
      count_result: { count: 73, error: null },
      update_results: [{ data: null, error: { message: 'RLS denied' } }],
    });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());
    expect(result.current.unread_count).toBe(73);

    await act(async () => {
      await result.current.mark_read('notif-uuid-1');
    });

    // Estado veraz: el UPDATE falló, el conteo de cabecera vuelve a 73.
    expect(result.current.unread_count).toBe(73);
  });

  it('(EC-32) mark_all_read_pone_el_conteo_optimista_en_cero_usando_el_conteo_de_cabecera_no_el_derivado_de_la_lista', async () => {
    const mock = make_supabase_mock({
      select_result: {
        data: [ROW_1, make_notification_row({ id: 'n-x', read_at: null })], // solo 2 no-leídas visibles
        error: null,
      },
      count_result: { count: 73, error: null }, // cabecera real: 73
      update_results: [{ data: null, error: null }],
    });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());
    expect(result.current.unread_count).toBe(73);

    await act(async () => {
      await result.current.mark_all_read();
    });

    expect(result.current.unread_count).toBe(0);
  });

  it('(EC-33) mark_all_read_falla_revierte_el_conteo_optimista_al_valor_previo_exacto_73', async () => {
    const mock = make_supabase_mock({
      select_result: {
        data: [ROW_1, make_notification_row({ id: 'n-x', read_at: null })],
        error: null,
      },
      count_result: { count: 73, error: null },
      update_results: [{ data: null, error: { message: 'network down' } }],
    });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());
    expect(result.current.unread_count).toBe(73);

    await act(async () => {
      await result.current.mark_all_read();
    });

    // Revierte al valor previo EXACTO del conteo de cabecera (73), no a lo
    // que resultaría de recomputar desde el arreglo local (2).
    expect(result.current.unread_count).toBe(73);
  });

  it('(EC-34) refetch_vuelve_a_pedir_el_conteo_de_cabecera', async () => {
    const mock1 = make_supabase_mock({
      select_result: { data: [ROW_1], error: null },
      count_result: { count: 73, error: null },
    });
    mock_supabase_holder.client = mock1.client;

    const { result } = await renderHook(() => useNotifications());
    expect(result.current.unread_count).toBe(73);
    expect(mock1.invocations.filter((i) => i.kind === 'count')).toHaveLength(1);

    const mock2 = make_supabase_mock({
      select_result: { data: [ROW_1], error: null },
      count_result: { count: 40, error: null },
    });
    mock_supabase_holder.client = mock2.client;

    await act(async () => {
      result.current.refetch();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.unread_count).toBe(40);
    expect(mock2.invocations.filter((i) => i.kind === 'count')).toHaveLength(1);
  });

  it('(EC-35) fallo_solo_de_la_query_de_conteo_la_lista_se_muestra_igual_el_conteo_cae_a_cero', async () => {
    // Decisión fijada — ver docblock superior "223.3": fallo SOLO del
    // conteo de cabecera (la lista tiene éxito) ⇒ la lista se muestra
    // normal, SIN error_message, y el badge cae a 0 (no conserva el último
    // valor válido).
    const mock = make_supabase_mock({
      select_result: { data: [ROW_1, ROW_2], error: null },
      count_result: { count: null, error: { message: 'RLS denied en conteo' } },
    });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());

    expect(result.current.notifications).toHaveLength(2);
    expect(result.current.error_message).toBeNull();
    expect(result.current.unread_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 223.3 — mark_all_read respeta deleted_at (PR #106 defecto b)
// ---------------------------------------------------------------------------

describe('useNotifications — mark_all_read respeta deleted_at (PR #106 defecto b)', () => {
  it('(EC-36) mark_all_read_update_incluye_is_deleted_at_null_ademas_de_eq_user_id_e_is_read_at_null', async () => {
    const mock = make_supabase_mock({
      select_result: { data: [ROW_1], error: null },
      count_result: { count: 1, error: null },
      update_results: [{ data: null, error: null }],
    });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useNotifications());

    await act(async () => {
      await result.current.mark_all_read();
    });

    const update_inv = mock.invocations.find((i) => i.kind === 'update');
    expect(update_inv).toBeDefined();
    const chain = update_inv!.chain;
    // Defecto confirmado por code review PR #106: el SELECT ya lleva
    // `.is('deleted_at', null)` pero el UPDATE masivo no — estampaba
    // `read_at` sobre notificaciones borradas.
    expect(chain).toContainEqual({ method: 'is', args: ['deleted_at', null] });
    expect(chain).toContainEqual({ method: 'is', args: ['read_at', null] });
    expect(chain).toContainEqual({ method: 'eq', args: ['user_id', TEST_USER_ID] });
  });
});

// ---------------------------------------------------------------------------
// Hardening post-guardian (219.3) — rama sin sesión sin ancla.
// ---------------------------------------------------------------------------

describe('hardening post-guardian', () => {
  it('(H-1) sin_sesion_user_null_is_loading_false_notifications_null_sin_llamada_de_red_ni_error_fabricado', async () => {
    const mock = make_supabase_mock({ select_result: { data: [ROW_1, ROW_2], error: null } });
    mock_supabase_holder.client = mock.client;
    set_auth_user_sin_sesion();

    const { result } = await renderHook(() => useNotifications());

    expect(result.current.is_loading).toBe(false);
    expect(result.current.notifications).toBeNull();
    expect(result.current.error_message).toBeNull();
    expect(result.current.unread_count).toBe(0);
    // Sin user_id, el hook nunca debe tocar la red — ni una sola invocación
    // select() capturada, aunque el mock esté listo para responder con datos.
    expect(mock.invocations).toHaveLength(0);
  });

  it('(H-2) sin_sesion_mark_read_es_no_op_no_dispara_red', async () => {
    const mock = make_supabase_mock({
      select_result: { data: [ROW_1], error: null },
      update_results: [{ data: null, error: null }],
    });
    mock_supabase_holder.client = mock.client;
    set_auth_user_sin_sesion();

    const { result } = await renderHook(() => useNotifications());
    expect(result.current.notifications).toBeNull();

    await act(async () => {
      await result.current.mark_read('notif-uuid-1');
    });

    const update_inv = mock.invocations.find((i) => i.kind === 'update');
    expect(update_inv).toBeUndefined();
    // Estado sigue exactamente como antes — no hay lista que "marcar".
    expect(result.current.notifications).toBeNull();
    expect(result.current.unread_count).toBe(0);
  });

  it('(H-3) sin_sesion_mark_all_read_es_no_op_no_dispara_red', async () => {
    const mock = make_supabase_mock({
      select_result: { data: [ROW_1, ROW_2], error: null },
      update_results: [{ data: null, error: null }],
    });
    mock_supabase_holder.client = mock.client;
    set_auth_user_sin_sesion();

    const { result } = await renderHook(() => useNotifications());

    await act(async () => {
      await result.current.mark_all_read();
    });

    const update_inv = mock.invocations.find((i) => i.kind === 'update');
    expect(update_inv).toBeUndefined();
    expect(result.current.notifications).toBeNull();
    expect(result.current.unread_count).toBe(0);
  });

  it('(H-4) sin_sesion_no_se_llama_la_query_de_conteo_de_cabecera', async () => {
    const mock = make_supabase_mock({
      select_result: { data: [ROW_1, ROW_2], error: null },
      count_result: { count: 73, error: null },
    });
    mock_supabase_holder.client = mock.client;
    set_auth_user_sin_sesion();

    const { result } = await renderHook(() => useNotifications());

    expect(result.current.unread_count).toBe(0);
    // Sin user_id, tampoco se debe construir la query de conteo de
    // cabecera aunque el mock esté listo para responder con 73.
    expect(mock.invocations.filter((i) => i.kind === 'count')).toHaveLength(0);
  });
});
