/**
 * Tests fase RED — useSaveProperty hook
 * Archivo SUT: mobile/src/features/feed/hooks/useSaveProperty.ts
 * Subtarea Taskmaster: 9.7 — persistencia save (parte crítica)
 *
 * SUT: useSaveProperty({ property_id, initialSaved?, supabase? })
 *        → { isSaved: boolean, toggleSave: () => Promise<void> }
 *
 * Contrato (schema migración 0006):
 *   - tabla saves: (id, user_id, property_id, created_at) — SIN property_video_id
 *     UNIQUE INDEX (user_id, property_id)
 *   - toggleSave: no-saved → INSERT {user_id, property_id}; saved → DELETE por (user_id, property_id)
 *   - Optimista: estado cambia ANTES; error → revierte al estado previo
 *   - Unique conflict (code 23505) → tratado como "ya saved", NO revierte
 *   - user_id SIEMPRE del useAuth(), nunca de parámetros externos
 *
 * PATRÓN DE MOCK: idéntico a usePropertyActions.test.tsx / useLikeProperty.test.tsx
 *
 * EDGE CASES CUBIERTOS (7 casos):
 *
 * ### Happy path
 * - (EC-10) save_exitoso_inserta_user_id_property_id_sin_video_id
 * - (EC-11) unsave_exitoso_delete_por_user_property
 *
 * ### Rollback
 * - (EC-12) rollback_save_error_revierte_a_false
 * - (EC-13) rollback_unsave_error_revierte_a_true
 *
 * ### Unique constraint (23505) → ya saved, no revertir
 * - (EC-14) conflicto_unico_save_insert_23505_estado_saved_no_revierte
 *
 * ### Tabla correcta (saves, no likes)
 * - (EC-15) save_inserta_en_tabla_saves_no_en_likes
 *
 * ### Sin sesión
 * - (EC-16) sin_sesion_usuario_null_save_no_inserta_y_no_crashea
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mock de useAuth — debe declararse ANTES de cualquier import del SUT
// ---------------------------------------------------------------------------

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { useAuth } from '@/features/auth/context';
import { useSaveProperty } from '../hooks/useSaveProperty';

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'usuario-buscador-uuid-9';
const TEST_PROPERTY_ID = 'propiedad-uuid-ghi-789';

// ---------------------------------------------------------------------------
// Helper — cast tipado de mock
// ---------------------------------------------------------------------------

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

// ---------------------------------------------------------------------------
// Factories de mock
// ---------------------------------------------------------------------------

/**
 * Builder thenable para INSERT en saves.
 * supabase.from('saves').insert({...}) → { error }
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
 * supabase.from('saves').delete().eq('user_id', uid).eq('property_id', pid) → { error }
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
 * Mock del cliente Supabase para useSaveProperty.
 * Expone _mock_from, _mock_insert, _mock_delete, _delete_builder para aserciones.
 */
function make_mock_supabase_save(opts: {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    user: { id: TEST_USER_ID } as any,
    session: null,
    isLoading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSaveProperty', () => {

  // ── (EC-10) Happy path — toggleSave inserta {user_id, property_id} ────────

  it('(EC-10) save_exitoso_inserta_user_id_property_id_sin_video_id: no-saved → toggleSave → INSERT {user_id, property_id} (SIN property_video_id), isSaved=true', async () => {
    const mock_supabase = make_mock_supabase_save();
    const { result } = renderHook(() =>
      useSaveProperty({
        property_id: TEST_PROPERTY_ID,
        initialSaved: false,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.toggleSave();
    });

    expect(mock_supabase._mock_from).toHaveBeenCalledWith('saves');
    expect(mock_supabase._mock_insert).toHaveBeenCalledTimes(1);

    const insert_arg = mock_supabase._mock_insert.mock.calls[0]![0] as Record<string, unknown>;
    expect(insert_arg.user_id).toBe(TEST_USER_ID);
    expect(insert_arg.property_id).toBe(TEST_PROPERTY_ID);
    // Crítico: saves NO tiene property_video_id (schema migración 0006)
    expect(insert_arg).not.toHaveProperty('property_video_id');
    expect(result.current.isSaved).toBe(true);
  });

  // ── (EC-11) Happy path — toggleSave saved hace delete ────────────────────

  it('(EC-11) unsave_exitoso_delete_por_user_property: saved → toggleSave → DELETE filtrado por (user_id, property_id), isSaved=false', async () => {
    const mock_supabase = make_mock_supabase_save();
    const { result } = renderHook(() =>
      useSaveProperty({
        property_id: TEST_PROPERTY_ID,
        initialSaved: true,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.toggleSave();
    });

    expect(mock_supabase._mock_delete).toHaveBeenCalledTimes(1);
    // Verifica filtros eq en el DELETE
    const eq_calls = mock_supabase._delete_builder.eq.mock.calls as [string, string][];
    const eq_keys = eq_calls.map(([col]) => col);
    expect(eq_keys).toContain('user_id');
    expect(eq_keys).toContain('property_id');
    expect(result.current.isSaved).toBe(false);
  });

  // ── (EC-12) Rollback — INSERT error revierte isSaved a false ─────────────

  it('(EC-12) rollback_save_error_revierte_a_false: no-saved → toggleSave → INSERT error genérico → isSaved revierte a false', async () => {
    const mock_supabase = make_mock_supabase_save({
      insert_result: { error: { message: 'network error', code: '50000' } },
    });
    const { result } = renderHook(() =>
      useSaveProperty({
        property_id: TEST_PROPERTY_ID,
        initialSaved: false,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.toggleSave();
    });

    // El optimismo debe revertir: isSaved=false (estado original)
    expect(result.current.isSaved).toBe(false);
  });

  // ── (EC-13) Rollback — DELETE error revierte isSaved a true ──────────────

  it('(EC-13) rollback_unsave_error_revierte_a_true: saved → toggleSave → DELETE error → isSaved revierte a true', async () => {
    const mock_supabase = make_mock_supabase_save({
      delete_result: { error: { message: 'connection lost' } },
    });
    const { result } = renderHook(() =>
      useSaveProperty({
        property_id: TEST_PROPERTY_ID,
        initialSaved: true,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.toggleSave();
    });

    // El optimismo debe revertir: isSaved=true (estado original)
    expect(result.current.isSaved).toBe(true);
  });

  // ── (EC-14) Unique constraint 23505 → ya saved, no revertir ──────────────

  it('(EC-14) conflicto_unico_save_insert_23505_estado_saved_no_revierte: INSERT devuelve error code 23505 → isSaved=true (ya existente), NO revierte', async () => {
    const mock_supabase = make_mock_supabase_save({
      insert_result: {
        error: {
          message: 'duplicate key value violates unique constraint "saves_user_property_unique"',
          code: '23505',
        },
      },
    });
    const { result } = renderHook(() =>
      useSaveProperty({
        property_id: TEST_PROPERTY_ID,
        initialSaved: false,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.toggleSave();
    });

    // 23505 = ya existe → mantener isSaved=true, no revertir
    expect(result.current.isSaved).toBe(true);
  });

  // ── (EC-15) Tabla correcta — saves, no likes ─────────────────────────────

  it('(EC-15) save_inserta_en_tabla_saves_no_en_likes: INSERT va a from("saves"), NO a from("likes")', async () => {
    const mock_supabase = make_mock_supabase_save();
    const { result } = renderHook(() =>
      useSaveProperty({
        property_id: TEST_PROPERTY_ID,
        initialSaved: false,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.toggleSave();
    });

    expect(mock_supabase._mock_from).toHaveBeenCalledWith('saves');
    expect(mock_supabase._mock_from).not.toHaveBeenCalledWith('likes');
  });

  // ── (EC-16) Sin sesión — no inserta y no crashea ─────────────────────────

  it('(EC-16) sin_sesion_usuario_null_save_no_inserta_y_no_crashea: user=null → toggleSave → NO llama insert, no lanza excepción', async () => {
    mock_use_auth.mockReturnValue({
      user: null,
      session: null,
      isLoading: false,
      signIn: jest.fn(),
      signOut: jest.fn(),
    });

    const mock_supabase = make_mock_supabase_save();
    const { result } = renderHook(() =>
      useSaveProperty({
        property_id: TEST_PROPERTY_ID,
        initialSaved: false,
        supabase: mock_supabase,
      })
    );

    // No debe lanzar excepción
    await act(async () => {
      await result.current.toggleSave();
    });

    expect(mock_supabase._mock_insert).not.toHaveBeenCalled();
    // isSaved no cambia
    expect(result.current.isSaved).toBe(false);
  });

});
