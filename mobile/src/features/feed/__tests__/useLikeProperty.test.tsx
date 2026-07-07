/**
 * Tests fase RED — useLikeProperty hook
 * Archivo SUT: mobile/src/features/feed/hooks/useLikeProperty.ts
 * Subtarea Taskmaster: 9.7 — persistencia like (parte crítica)
 *
 * SUT: useLikeProperty({ property_video_id, property_id, initialLiked?, supabase? })
 *        → { isLiked: boolean, toggleLike: () => Promise<void>, likeOnly: () => Promise<void> }
 *
 * Contrato (schema migración 0006):
 *   - tabla likes: (id, user_id, property_video_id, property_id, created_at)
 *     UNIQUE INDEX (user_id, property_video_id)
 *   - likeOnly: no-liked → INSERT {user_id, property_video_id, property_id}; ya-liked → NO-OP
 *   - toggleLike: no-liked → INSERT; liked → DELETE por (user_id, property_video_id)
 *   - Optimista: estado cambia ANTES de la respuesta; error → revierte
 *   - Unique conflict (code 23505) → tratado como "ya liked", NO revierte
 *   - user_id SIEMPRE del useAuth(), nunca de parámetros externos
 *
 * PATRÓN DE MOCK: idéntico a usePropertyActions.test.tsx
 *   - supabase inyectado como dep: useLikeProperty({ ..., supabase: mock })
 *   - useAuth() mockeado via jest.mock
 *
 * EDGE CASES CUBIERTOS (9 casos):
 *
 * ### Happy path
 * - (EC-1) like_exitoso_inserta_con_user_id_property_video_id_property_id
 * - (EC-2) toggle_like_nuevo_exitoso
 * - (EC-3) toggle_like_unlike_exitoso
 *
 * ### likeOnly idempotente
 * - (EC-4) like_only_idempotente_ya_liked_no_inserta
 *
 * ### Rollback
 * - (EC-5) rollback_like_error_revierte_a_false
 * - (EC-6) rollback_unlike_error_revierte_a_true
 *
 * ### Unique constraint (23505) → ya liked, no revertir
 * - (EC-7) conflicto_unico_like_insert_23505_estado_liked_no_revierte
 *
 * ### user_id del auth
 * - (EC-8) user_id_del_auth_no_de_params
 *
 * ### Sin sesión
 * - (EC-9) sin_sesion_usuario_null_like_only_no_inserta_y_no_crashea
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { useAuth } from '@/features/auth/context';
import { useLikeProperty } from '../hooks/useLikeProperty';

// ---------------------------------------------------------------------------
// Mock de useAuth — debe declararse ANTES de cualquier import del SUT
// ---------------------------------------------------------------------------

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'usuario-buscador-uuid-9';
const TEST_PROPERTY_VIDEO_ID = 'video-uuid-prop-video-abc';
const TEST_PROPERTY_ID = 'propiedad-uuid-def-456';

// ---------------------------------------------------------------------------
// Helper — cast tipado de mock
// ---------------------------------------------------------------------------

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

// ---------------------------------------------------------------------------
// Factories de mock
// ---------------------------------------------------------------------------

/**
 * Builder thenable para INSERT en likes.
 * supabase.from('likes').insert({...}) → { error }
 */
function make_insert_builder(result: { error: { message: string; code?: string } | null }) {
  return {
    then: (
      onFulfilled: (v: typeof result) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
}

/**
 * Builder thenable + chainable para DELETE.
 * supabase.from('likes').delete().eq('user_id', uid).eq('property_video_id', pvid) → { error }
 */
function make_delete_builder(result: { error: { message: string } | null }) {
  const builder: {
    eq: jest.Mock;
    then: (
      onFulfilled: (v: typeof result) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise<unknown>;
  } = {
    eq: jest.fn(),
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  builder.eq.mockReturnValue(builder);
  return builder;
}

/**
 * Mock del cliente Supabase para useLikeProperty.
 * Expone _mock_from, _mock_insert, _mock_delete, _delete_builder para aserciones.
 */
function make_mock_supabase_like(opts: {
  insert_result?: { error: { message: string; code?: string } | null };
  delete_result?: { error: { message: string } | null };
} = {}) {
  const {
    insert_result = { error: null },
    delete_result = { error: null },
  } = opts;

  const insert_builder = make_insert_builder(insert_result);
  const delete_builder = make_delete_builder(delete_result);

  const mock_insert = jest.fn().mockReturnValue(insert_builder);
  const mock_delete = jest.fn().mockReturnValue(delete_builder);

  const mock_from = jest.fn().mockReturnValue({
    insert: mock_insert,
    delete: mock_delete,
  });

  return {
    from: mock_from,
    _mock_from: mock_from,
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
     
    user: { id: TEST_USER_ID } as any,
    session: null,
    isLoading: false,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn(),
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useLikeProperty', () => {

  // ── (EC-1) Happy path — likeOnly inserta con los campos correctos ─────────

  it('(EC-1) like_exitoso_inserta_con_user_id_property_video_id_property_id: no-liked → likeOnly → INSERT recibe {user_id (del auth), property_video_id, property_id} exactos, isLiked=true tras éxito', async () => {
    const mock_supabase = make_mock_supabase_like();
    const { result } = await renderHook(() =>
      useLikeProperty({
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        property_id: TEST_PROPERTY_ID,
        initialLiked: false,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.likeOnly();
    });

    expect(mock_supabase._mock_from).toHaveBeenCalledWith('likes');
    expect(mock_supabase._mock_insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: TEST_USER_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        property_id: TEST_PROPERTY_ID,
      })
    );
    expect(result.current.isLiked).toBe(true);
  });

  // ── (EC-2) Happy path — toggleLike sin like previo inserta ───────────────

  it('(EC-2) toggle_like_nuevo_exitoso: no-liked → toggleLike → INSERT en likes, isLiked=true', async () => {
    const mock_supabase = make_mock_supabase_like();
    const { result } = await renderHook(() =>
      useLikeProperty({
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        property_id: TEST_PROPERTY_ID,
        initialLiked: false,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.toggleLike();
    });

    expect(mock_supabase._mock_insert).toHaveBeenCalledTimes(1);
    expect(result.current.isLiked).toBe(true);
  });

  // ── (EC-3) Happy path — toggleLike con like previo hace unlike ───────────

  it('(EC-3) toggle_like_unlike_exitoso: liked → toggleLike → DELETE con eq(user_id) y eq(property_video_id), isLiked=false', async () => {
    const mock_supabase = make_mock_supabase_like();
    const { result } = await renderHook(() =>
      useLikeProperty({
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        property_id: TEST_PROPERTY_ID,
        initialLiked: true,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.toggleLike();
    });

    expect(mock_supabase._mock_delete).toHaveBeenCalledTimes(1);
    // Verifica que el delete filtre por user_id y property_video_id
    const eq_calls = mock_supabase._delete_builder.eq.mock.calls as [string, string][];
    const eq_keys = eq_calls.map(([col]) => col);
    expect(eq_keys).toContain('user_id');
    expect(eq_keys).toContain('property_video_id');
    expect(result.current.isLiked).toBe(false);
  });

  // ── (EC-4) likeOnly idempotente — no inserta si ya liked ─────────────────

  it('(EC-4) like_only_idempotente_ya_liked_no_inserta: ya liked → likeOnly → NO llama INSERT, isLiked sigue true', async () => {
    const mock_supabase = make_mock_supabase_like();
    const { result } = await renderHook(() =>
      useLikeProperty({
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        property_id: TEST_PROPERTY_ID,
        initialLiked: true,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.likeOnly();
    });

    expect(mock_supabase._mock_insert).not.toHaveBeenCalled();
    expect(result.current.isLiked).toBe(true);
  });

  // ── (EC-5) Rollback — INSERT error revierte isLiked a false ──────────────

  it('(EC-5) rollback_like_error_revierte_a_false: no-liked → likeOnly → INSERT devuelve error genérico → isLiked revierte a false', async () => {
    const mock_supabase = make_mock_supabase_like({
      insert_result: { error: { message: 'network error', code: '50000' } },
    });
    const { result } = await renderHook(() =>
      useLikeProperty({
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        property_id: TEST_PROPERTY_ID,
        initialLiked: false,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.likeOnly();
    });

    // El estado optimista debe revertir: isLiked=false (estado original)
    expect(result.current.isLiked).toBe(false);
  });

  // ── (EC-6) Rollback — DELETE error revierte isLiked a true ───────────────

  it('(EC-6) rollback_unlike_error_revierte_a_true: liked → toggleLike → DELETE devuelve error → isLiked revierte a true', async () => {
    const mock_supabase = make_mock_supabase_like({
      delete_result: { error: { message: 'connection lost' } },
    });
    const { result } = await renderHook(() =>
      useLikeProperty({
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        property_id: TEST_PROPERTY_ID,
        initialLiked: true,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.toggleLike();
    });

    // El estado optimista debe revertir: isLiked=true (estado original)
    expect(result.current.isLiked).toBe(true);
  });

  // ── (EC-7) Unique constraint 23505 → ya liked, no revertir ───────────────

  it('(EC-7) conflicto_unico_like_insert_23505_estado_liked_no_revierte: INSERT devuelve error code 23505 → isLiked=true (ya existente, no error de red), NO revierte', async () => {
    const mock_supabase = make_mock_supabase_like({
      insert_result: {
        error: {
          message: 'duplicate key value violates unique constraint "likes_user_video_unique"',
          code: '23505',
        },
      },
    });
    const { result } = await renderHook(() =>
      useLikeProperty({
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        property_id: TEST_PROPERTY_ID,
        initialLiked: false,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.likeOnly();
    });

    // 23505 = ya existe → tratarlo como "ya liked", mantener isLiked=true
    expect(result.current.isLiked).toBe(true);
  });

  // ── (EC-8) user_id del auth, no de parámetros externos ───────────────────

  it('(EC-8) user_id_del_auth_no_de_params: el INSERT usa el user_id del mock useAuth (TEST_USER_ID), no uno arbitrario', async () => {
    const OTHER_USER_ID = 'otro-usuario-uuid-no-del-auth';
    const mock_supabase = make_mock_supabase_like();

    // El hook recibe property_id pero el user_id debe venir del auth, no de props
    const { result } = await renderHook(() =>
      useLikeProperty({
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        property_id: TEST_PROPERTY_ID,
        initialLiked: false,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.likeOnly();
    });

    // El INSERT debe usar TEST_USER_ID del auth, no OTHER_USER_ID ni undefined
    const insert_arg = mock_supabase._mock_insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(insert_arg.user_id).toBe(TEST_USER_ID);
    expect(insert_arg.user_id).not.toBe(OTHER_USER_ID);
  });

  // ── (EC-9) Sin sesión — no inserta y no crashea ───────────────────────────

  it('(EC-9) sin_sesion_usuario_null_like_only_no_inserta_y_no_crashea: user=null → likeOnly → NO llama insert, no lanza excepción', async () => {
    mock_use_auth.mockReturnValue({
      user: null,
      session: null,
      isLoading: false,
      signIn: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
    });

    const mock_supabase = make_mock_supabase_like();
    const { result } = await renderHook(() =>
      useLikeProperty({
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        property_id: TEST_PROPERTY_ID,
        initialLiked: false,
        supabase: mock_supabase,
      })
    );

    // No debe lanzar excepción
    await act(async () => {
      await result.current.likeOnly();
    });

    expect(mock_supabase._mock_insert).not.toHaveBeenCalled();
    // isLiked no cambia
    expect(result.current.isLiked).toBe(false);
  });

});
