/**
 * Tests fase RED — useFollow hook (subtarea 78.3, tarea #78 «follow de cuentas F1»)
 * Archivo SUT: mobile/src/features/profile/hooks/useFollow.ts
 *
 * SEAM bajo prueba: la firma pública del hook — nunca la tabla `follows`
 * directamente.
 *   useFollow({ followed_user_id, supabase? })
 *     → { is_following: boolean, loading: boolean, toggle_follow: () => Promise<void>, is_own: boolean }
 *
 * Contrato (migración 20260914100001_follows.sql, calcado de useLikeProperty.ts):
 *   - Precarga al montar: from('follows').select('followed_user_id')
 *       .eq('follower_user_id', user.id).eq('followed_user_id', followed_user_id)
 *       .maybeSingle() — el eq('follower_user_id', ...) es EXPLÍCITO aunque RLS
 *       ya filtre (memoria flatlist_numcolumns_row_keys: policies con
 *       OR is_admin() rompen el supuesto).
 *   - loading=true hasta que la precarga resuelve; error de precarga →
 *     is_following=false, loading=false, sin throw.
 *   - toggle_follow: no sigue → INSERT optimista {follower_user_id, followed_user_id};
 *     23505 → "ya sigue" (mantener true, no rollback); otro error → rollback a false.
 *     Sigue → DELETE optimista .eq('follower_user_id',...).eq('followed_user_id',...);
 *     error → rollback a true.
 *   - Idempotencia: doble toggle_follow() en vuelo → una sola llamada a insert/delete.
 *   - user null → is_following=false, loading=false, toggle_follow no-op sin llamar a `from`.
 *   - is_own (followed_user_id === user.id) → is_own=true, SIN precarga (0 llamadas
 *     a from), toggle_follow no-op. (Decisión documentada: "sin precarga", no
 *     "precarga permitida pero toggle no-op".)
 *   - user_id SIEMPRE de useAuth(), nunca de props externas.
 *   - Nunca desprender métodos del cliente (#205): encadenable
 *     from().select().eq().eq().maybeSingle() / from().insert() / from().delete().eq().eq().
 *
 * PATRÓN DE MOCK: idéntico a useLikeProperty.test.tsx (supabase inyectado,
 * useAuth mockeado). RNTL 14: `await renderHook`, `await act(async () => …)`,
 * `waitFor`; timers reales (memorias rntl14_renderhook_async y
 * rntl14_fireevent_promise_y_fake_timers_donotfake).
 *
 * EDGE CASES CUBIERTOS (13 casos):
 *
 * ### Happy path / estado inicial
 * - (EC-1) estado_inicial_sonda_primer_render_loading_true_luego_precarga_resuelve_true
 *
 * ### Edge cases de la precarga
 * - (EC-2) precarga_sin_fila_is_following_false
 * - (EC-3) precarga_con_error_is_following_false_sin_throw
 *
 * ### Toggle — optimista + rollback
 * - (EC-4) toggle_desde_false_optimista_antes_de_resolver_insert_llamado_con_ids_exactos
 * - (EC-5) toggle_insert_error_generico_rollback_a_false
 * - (EC-6) toggle_insert_23505_ya_sigue_no_revierte
 * - (EC-7) toggle_desde_true_delete_encadenado_eq_follower_eq_followed
 * - (EC-8) toggle_delete_error_rollback_a_true
 *
 * ### Ramas de reglas no obvias
 * - (EC-9) doble_tap_en_vuelo_una_sola_llamada_a_insert
 * - (EC-10) user_null_no_llama_from_y_no_crashea
 * - (EC-11) is_own_sin_precarga_toggle_no_op
 *
 * ### Boundary / error
 * - (EC-12) cambio_de_followed_user_id_entre_renders_nueva_precarga
 * - (EC-12b) precarga_vieja_que_resuelve_tarde_no_pisa_el_estado_del_id_nuevo (guardian)
 * - (EC-13) unmount_antes_de_resolver_precarga_sin_warning_de_act
 */

import { renderHook, act, waitFor } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { useAuth } from '@/features/auth/context';
import { useFollow } from '../hooks/useFollow';

// ---------------------------------------------------------------------------
// Mock de useAuth — debe declararse ANTES de cualquier import del SUT
// ---------------------------------------------------------------------------

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const FOLLOWER_ID = 'u-me';
const FOLLOWED_ID = 'u-x';
const OTHER_FOLLOWED_ID = 'u-y';

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

// ---------------------------------------------------------------------------
// Helper — promesa diferida controlable manualmente
// ---------------------------------------------------------------------------

function make_deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// ---------------------------------------------------------------------------
// Factory del mock de Supabase — encadenable (#205)
//
//   from('follows').select('followed_user_id')
//     .eq('follower_user_id', uid).eq('followed_user_id', fid).maybeSingle()
//   from('follows').insert({...})
//   from('follows').delete().eq('follower_user_id', uid).eq('followed_user_id', fid)
// ---------------------------------------------------------------------------

type PrecargaResult = { data: { followed_user_id: string } | null; error: { message: string } | null };
type MutResult = { error: { message: string; code?: string } | null };

function make_mock_supabase_follow(
  opts: {
    maybe_single?: () => Promise<PrecargaResult>;
    insert_result?: () => Promise<MutResult>;
    delete_result?: () => Promise<MutResult>;
  } = {}
) {
  const default_maybe_single = () => Promise.resolve<PrecargaResult>({ data: null, error: null });
  const default_insert = () => Promise.resolve<MutResult>({ error: null });
  const default_delete = () => Promise.resolve<MutResult>({ error: null });

  // ── cadena de precarga (select → eq → eq → maybeSingle) ──
  const mock_maybe_single = jest.fn(opts.maybe_single ?? default_maybe_single);
  const precarga_builder: { eq: jest.Mock; maybeSingle: jest.Mock } = {
    eq: jest.fn(),
    maybeSingle: mock_maybe_single,
  };
  precarga_builder.eq.mockReturnValue(precarga_builder);
  const mock_select = jest.fn().mockReturnValue(precarga_builder);

  // ── insert (thenable, resuelve al llamarse — igual que useLikeProperty) ──
  const insert_impl = opts.insert_result ?? default_insert;
  const mock_insert = jest.fn().mockImplementation(() => {
    const p = insert_impl();
    return {
      then: (onFulfilled: (v: MutResult) => unknown, onRejected?: (e: unknown) => unknown) =>
        p.then(onFulfilled, onRejected),
    };
  });

  // ── delete (chainable eq → thenable) ──
  const delete_impl = opts.delete_result ?? default_delete;
  const delete_builder: { eq: jest.Mock; then: (onF: unknown, onR?: unknown) => Promise<unknown> } = {
    eq: jest.fn(),
    then: (onFulfilled, onRejected) => delete_impl().then(onFulfilled as never, onRejected as never),
  };
  delete_builder.eq.mockReturnValue(delete_builder);
  const mock_delete = jest.fn().mockReturnValue(delete_builder);

  const mock_from = jest.fn().mockReturnValue({
    select: mock_select,
    insert: mock_insert,
    delete: mock_delete,
  });

  return {
    from: mock_from,
    _mock_from: mock_from,
    _mock_select: mock_select,
    _precarga_builder: precarga_builder,
    _mock_maybe_single: mock_maybe_single,
    _mock_insert: mock_insert,
    _mock_delete: mock_delete,
    _delete_builder: delete_builder,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mock_use_auth.mockReturnValue({

    user: { id: FOLLOWER_ID } as any,
    session: null,
    isLoading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
    requestPasswordReset: jest.fn(),
    updatePassword: jest.fn(),
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFollow', () => {
  // ── (EC-1) Sonda del primer render + resolución de la precarga ──────────

  it('(EC-1) estado_inicial_sonda_primer_render_loading_true_luego_precarga_resuelve_true: primer render loading=true/is_following=false; tras resolver con fila → loading=false/is_following=true; encadenamiento exacto', async () => {
    const { promise: precarga_promise, resolve: resolve_precarga } = make_deferred<PrecargaResult>();
    const mock_supabase = make_mock_supabase_follow({ maybe_single: () => precarga_promise });

    const { result } = await renderHook(() =>
      useFollow({ followed_user_id: FOLLOWED_ID, supabase: mock_supabase })
    );

    // Sonda del primer render: la precarga sigue pendiente.
    expect(result.current.loading).toBe(true);
    expect(result.current.is_following).toBe(false);

    await act(async () => {
      resolve_precarga({ data: { followed_user_id: FOLLOWED_ID }, error: null });
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.is_following).toBe(true);

    expect(mock_supabase._mock_from).toHaveBeenCalledWith('follows');
    expect(mock_supabase._mock_select).toHaveBeenCalledWith('followed_user_id');
    expect(mock_supabase._precarga_builder.eq).toHaveBeenNthCalledWith(1, 'follower_user_id', FOLLOWER_ID);
    expect(mock_supabase._precarga_builder.eq).toHaveBeenNthCalledWith(2, 'followed_user_id', FOLLOWED_ID);
    expect(mock_supabase._mock_maybe_single).toHaveBeenCalledTimes(1);
  });

  // ── (EC-2) Precarga sin fila ──────────────────────────────────────────────

  it('(EC-2) precarga_sin_fila_is_following_false: maybeSingle devuelve data:null → is_following=false, loading=false', async () => {
    const mock_supabase = make_mock_supabase_follow();
    const { result } = await renderHook(() =>
      useFollow({ followed_user_id: FOLLOWED_ID, supabase: mock_supabase })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.is_following).toBe(false);
    // No vacuo: la precarga SÍ debe haberse disparado (el mock resolvió data:null).
    expect(mock_supabase._mock_maybe_single).toHaveBeenCalledTimes(1);
  });

  // ── (EC-3) Precarga con error ─────────────────────────────────────────────

  it('(EC-3) precarga_con_error_is_following_false_sin_throw: maybeSingle devuelve error → is_following=false, loading=false, no lanza', async () => {
    const mock_supabase = make_mock_supabase_follow({
      maybe_single: () => Promise.resolve({ data: null, error: { message: 'network error' } }),
    });

    const { result } = await renderHook(() =>
      useFollow({ followed_user_id: FOLLOWED_ID, supabase: mock_supabase })
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.is_following).toBe(false);
    // No vacuo: la precarga SÍ debe haberse disparado (el mock resolvió con error).
    expect(mock_supabase._mock_maybe_single).toHaveBeenCalledTimes(1);
  });

  // ── (EC-4) Toggle desde false — optimista + insert exacto ────────────────

  it('(EC-4) toggle_desde_false_optimista_antes_de_resolver_insert_llamado_con_ids_exactos: is_following=true ANTES de que resuelva el insert; insert llamado con {follower_user_id, followed_user_id} exactos', async () => {
    const { promise: insert_promise, resolve: resolve_insert } = make_deferred<MutResult>();
    const mock_supabase = make_mock_supabase_follow({ insert_result: () => insert_promise });

    const { result } = await renderHook(() =>
      useFollow({ followed_user_id: FOLLOWED_ID, supabase: mock_supabase })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.is_following).toBe(false);

    let toggle_promise!: Promise<void>;
    act(() => {
      toggle_promise = result.current.toggle_follow();
    });

    // Optimista: ya es true aunque el insert no haya resuelto.
    expect(result.current.is_following).toBe(true);
    expect(mock_supabase._mock_insert).toHaveBeenCalledWith({
      follower_user_id: FOLLOWER_ID,
      followed_user_id: FOLLOWED_ID,
    });

    await act(async () => {
      resolve_insert({ error: null });
      await toggle_promise;
    });

    expect(result.current.is_following).toBe(true);
  });

  // ── (EC-5) Insert error genérico → rollback ──────────────────────────────

  it('(EC-5) toggle_insert_error_generico_rollback_a_false: INSERT devuelve error distinto de 23505 → is_following revierte a false', async () => {
    const mock_supabase = make_mock_supabase_follow({
      insert_result: () => Promise.resolve({ error: { message: 'db down', code: '50000' } }),
    });

    const { result } = await renderHook(() =>
      useFollow({ followed_user_id: FOLLOWED_ID, supabase: mock_supabase })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggle_follow();
    });

    // No vacuo: el rollback solo cuenta si el INSERT sí se intentó.
    expect(mock_supabase._mock_insert).toHaveBeenCalledTimes(1);
    expect(result.current.is_following).toBe(false);
  });

  // ── (EC-6) Insert 23505 → ya sigue, no revierte ──────────────────────────

  it('(EC-6) toggle_insert_23505_ya_sigue_no_revierte: INSERT devuelve 23505 (conflicto único) → is_following se queda en true', async () => {
    const mock_supabase = make_mock_supabase_follow({
      insert_result: () =>
        Promise.resolve({
          error: { message: 'duplicate key value violates unique constraint', code: '23505' },
        }),
    });

    const { result } = await renderHook(() =>
      useFollow({ followed_user_id: FOLLOWED_ID, supabase: mock_supabase })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggle_follow();
    });

    expect(result.current.is_following).toBe(true);
  });

  // ── (EC-7) Toggle desde true — delete encadenado ─────────────────────────

  it('(EC-7) toggle_desde_true_delete_encadenado_eq_follower_eq_followed: sigue → toggle_follow → DELETE con eq(follower_user_id) y eq(followed_user_id), is_following=false', async () => {
    const mock_supabase = make_mock_supabase_follow({
      maybe_single: () => Promise.resolve({ data: { followed_user_id: FOLLOWED_ID }, error: null }),
    });

    const { result } = await renderHook(() =>
      useFollow({ followed_user_id: FOLLOWED_ID, supabase: mock_supabase })
    );
    await waitFor(() => expect(result.current.is_following).toBe(true));

    await act(async () => {
      await result.current.toggle_follow();
    });

    expect(mock_supabase._mock_delete).toHaveBeenCalledTimes(1);
    const eq_calls = mock_supabase._delete_builder.eq.mock.calls as [string, string][];
    expect(eq_calls[0]).toEqual(['follower_user_id', FOLLOWER_ID]);
    expect(eq_calls[1]).toEqual(['followed_user_id', FOLLOWED_ID]);
    expect(result.current.is_following).toBe(false);
  });

  // ── (EC-8) Delete error → rollback a true ────────────────────────────────

  it('(EC-8) toggle_delete_error_rollback_a_true: DELETE devuelve error → is_following revierte a true', async () => {
    const mock_supabase = make_mock_supabase_follow({
      maybe_single: () => Promise.resolve({ data: { followed_user_id: FOLLOWED_ID }, error: null }),
      delete_result: () => Promise.resolve({ error: { message: 'connection lost' } }),
    });

    const { result } = await renderHook(() =>
      useFollow({ followed_user_id: FOLLOWED_ID, supabase: mock_supabase })
    );
    await waitFor(() => expect(result.current.is_following).toBe(true));

    await act(async () => {
      await result.current.toggle_follow();
    });

    expect(result.current.is_following).toBe(true);
  });

  // ── (EC-9) Doble tap en vuelo — una sola llamada a insert ────────────────

  it('(EC-9) doble_tap_en_vuelo_una_sola_llamada_a_insert: dos toggle_follow() mientras el primero está en vuelo → una sola llamada a insert', async () => {
    const { promise: insert_promise, resolve: resolve_insert } = make_deferred<MutResult>();
    const mock_supabase = make_mock_supabase_follow({ insert_result: () => insert_promise });

    const { result } = await renderHook(() =>
      useFollow({ followed_user_id: FOLLOWED_ID, supabase: mock_supabase })
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    let first_call!: Promise<void>;
    let second_call!: Promise<void>;
    act(() => {
      first_call = result.current.toggle_follow();
      second_call = result.current.toggle_follow();
    });

    expect(mock_supabase._mock_insert).toHaveBeenCalledTimes(1);
    // Guardian 78.3: sin el guard de vuelo el segundo tap lee prev=true y entra a la
    // rama DELETE (el insert seguiría en 1); el bug real es ese delete + el flip.
    expect(mock_supabase._mock_delete).not.toHaveBeenCalled();
    expect(result.current.is_following).toBe(true);

    await act(async () => {
      resolve_insert({ error: null });
      await Promise.all([first_call, second_call]);
    });

    expect(mock_supabase._mock_insert).toHaveBeenCalledTimes(1);
    expect(mock_supabase._mock_delete).not.toHaveBeenCalled();
  });

  // ── (EC-10) user null — no llama from, no crashea ────────────────────────

  it('(EC-10) user_null_no_llama_from_y_no_crashea: sin sesión → loading=false, is_following=false, toggle_follow no llama a from, sin excepción', async () => {
    mock_use_auth.mockReturnValue({
      user: null,
      session: null,
      isLoading: false,
      signIn: jest.fn(),
      signOut: jest.fn(),
      requestPasswordReset: jest.fn(),
      updatePassword: jest.fn(),
    });

    const mock_supabase = make_mock_supabase_follow();
    const { result } = await renderHook(() =>
      useFollow({ followed_user_id: FOLLOWED_ID, supabase: mock_supabase })
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.is_following).toBe(false);

    await act(async () => {
      await result.current.toggle_follow();
    });

    expect(mock_supabase._mock_from).not.toHaveBeenCalled();
    expect(result.current.is_following).toBe(false);
  });

  // ── (EC-11) is_own — sin precarga, toggle no-op ──────────────────────────

  it('(EC-11) is_own_sin_precarga_toggle_no_op: followed_user_id === user.id → is_own=true, loading=false SIN precarga (0 llamadas a from), toggle_follow es no-op', async () => {
    const mock_supabase = make_mock_supabase_follow();
    const { result } = await renderHook(() =>
      useFollow({ followed_user_id: FOLLOWER_ID, supabase: mock_supabase })
    );

    expect(result.current.is_own).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(mock_supabase._mock_from).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.toggle_follow();
    });

    expect(mock_supabase._mock_from).not.toHaveBeenCalled();
    expect(result.current.is_following).toBe(false);
  });

  // ── (EC-12) Cambio de followed_user_id entre renders — nueva precarga ───

  it('(EC-12) cambio_de_followed_user_id_entre_renders_nueva_precarga: al cambiar followed_user_id, se dispara una nueva precarga para el nuevo id', async () => {
    const mock_supabase = make_mock_supabase_follow();

    const { result, rerender } = await renderHook(
      ({ followed_user_id }: { followed_user_id: string }) =>
        useFollow({ followed_user_id, supabase: mock_supabase }),
      { initialProps: { followed_user_id: FOLLOWED_ID } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mock_supabase._mock_from).toHaveBeenCalledTimes(1);

    await act(async () => {
      rerender({ followed_user_id: OTHER_FOLLOWED_ID });
    });

    await waitFor(() => expect(mock_supabase._mock_from).toHaveBeenCalledTimes(2));
    expect(mock_supabase._precarga_builder.eq).toHaveBeenLastCalledWith('followed_user_id', OTHER_FOLLOWED_ID);
  });

  // ── (EC-12b) Carrera de precargas — gana la del id vigente ───────────────
  // Guardian 78.3: el flag `ignore` del cleanup no protege el unmount (React 18
  // ya no avisa) sino ESTA carrera: la precarga vieja resuelve DESPUÉS de la nueva.

  it('(EC-12b) precarga_vieja_que_resuelve_tarde_no_pisa_el_estado_del_id_nuevo', async () => {
    const old_precarga = make_deferred<PrecargaResult>();
    const new_precarga = make_deferred<PrecargaResult>();
    const precargas = [old_precarga.promise, new_precarga.promise];
    const mock_supabase = make_mock_supabase_follow({
      maybe_single: () => precargas.shift() ?? Promise.resolve({ data: null, error: null }),
    });

    const { result, rerender } = await renderHook(
      ({ followed_user_id }: { followed_user_id: string }) =>
        useFollow({ followed_user_id, supabase: mock_supabase }),
      { initialProps: { followed_user_id: FOLLOWED_ID } }
    );

    await act(async () => {
      rerender({ followed_user_id: OTHER_FOLLOWED_ID });
    });
    expect(mock_supabase._mock_maybe_single).toHaveBeenCalledTimes(2);

    // La nueva resuelve primero: sí sigue al id nuevo.
    await act(async () => {
      new_precarga.resolve({ data: { followed_user_id: OTHER_FOLLOWED_ID }, error: null });
      await Promise.resolve();
    });
    expect(result.current.is_following).toBe(true);
    expect(result.current.loading).toBe(false);

    // La vieja llega tarde con "no sigue": debe ignorarse.
    await act(async () => {
      old_precarga.resolve({ data: null, error: null });
      await Promise.resolve();
    });
    expect(result.current.is_following).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  // ── (EC-13) Unmount antes de resolver la precarga ────────────────────────

  it('(EC-13) unmount_antes_de_resolver_precarga_sin_warning_de_act: desmontar mientras la precarga está pendiente y resolverla después no produce warning de act ni crash', async () => {
    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { promise: precarga_promise, resolve: resolve_precarga } = make_deferred<PrecargaResult>();
    const mock_supabase = make_mock_supabase_follow({ maybe_single: () => precarga_promise });

    const { unmount } = await renderHook(() =>
      useFollow({ followed_user_id: FOLLOWED_ID, supabase: mock_supabase })
    );

    unmount();

    await act(async () => {
      resolve_precarga({ data: null, error: null });
      await Promise.resolve();
    });

    const act_warnings = console_error_spy.mock.calls.filter((args) =>
      String(args[0] ?? '').includes('not wrapped in act')
    );
    expect(act_warnings).toHaveLength(0);
    expect(mock_supabase._mock_from).toHaveBeenCalledWith('follows');
    console_error_spy.mockRestore();
  });
});
