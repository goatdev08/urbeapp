/**
 * Tests fase RED — useEditProfile hook
 * Archivo: mobile/src/features/profile/hooks/useEditProfile.ts
 * Subtarea Taskmaster: 22.3 — Implement hybrid save logic
 *
 * SUT: useEditProfile(deps?) → { save, isSaving, error }
 *
 * Contrato:
 *   - save({ fullName, imageUri, bio, removePhoto? }) hace DOS escrituras independientes:
 *       1. saveProfileFn({ fullName, imageUri, userId }) → foto+user_preferences (profileService)
 *       2. supabase.from('users').update({ bio }).eq('id', userId) → users.bio
 *   - userId lo obtiene internamente de useAuth().user.id
 *   - isSaving: true durante la operación, false al terminar (éxito o error)
 *   - error: null en éxito; string con descripción en fallo de CUALQUIERA de las ops
 *
 * SEMÁNTICA DE ERROR ELEGIDA: manejo INDEPENDIENTE por operación.
 *   Si profileService lanza, el update de bio AÚN se intenta (no hay short-circuit).
 *   Si alguna operación falla, el error queda expuesto (no se traga).
 *   Si ambas fallan, error contiene información de al menos una de las fallas.
 *
 * PATRÓN DE MOCK:
 *   - supabase inyectado como dep: useEditProfile({ supabase: mock })
 *   - saveProfileFn inyectada como dep: useEditProfile({ saveProfileFn: mock })
 *   - useAuth() mockeado via jest.mock('@/features/auth/context')
 *
 * EDGE CASES CUBIERTOS (15 casos):
 *
 * ### Happy path
 * - (EC-1) guardado_normal_ambas_escrituras_ocurren
 * - (EC-2) exito_isSaving_false_error_null_y_operaciones_ejecutadas
 *
 * ### Tabla correcta del dual-write (Opción A)
 * - (EC-3) bio_se_escribe_en_tabla_users
 * - (EC-4) eq_recibe_userId_del_usuario_autenticado
 * - (EC-5) profileService_recibe_userId_correcto
 *
 * ### Fallo parcial no se silencia (invariante clave)
 * - (EC-6) fallo_profileService_expone_error
 * - (EC-7) fallo_profileService_aun_intenta_update_bio
 * - (EC-8) fallo_update_bio_expone_error
 * - (EC-9) fallo_update_bio_profileService_fue_llamado
 *
 * ### Quitar foto (removePhoto)
 * - (EC-10) removePhoto_true_profileService_recibe_imageUri_null
 * - (EC-11) removePhoto_true_imageUri_original_no_pasa_a_profileService
 *
 * ### Estado isSaving
 * - (EC-12) isSaving_true_durante_guardado
 * - (EC-13) isSaving_false_tras_exito_y_operaciones_ejecutadas
 * - (EC-14) isSaving_false_tras_error
 *
 * ### Estado inicial
 * - (EC-15) estado_inicial_isSaving_false_error_null
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mock de useAuth — no necesita AuthProvider real; userId viene del mock
// ---------------------------------------------------------------------------

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { useAuth } from '@/features/auth/context';
import { useEditProfile } from '../hooks/useEditProfile';
import type { SaveProfileParams, SaveProfileResult } from '@/lib/profileService';

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'usuario-test-uuid-abc123';
const TEST_FULL_NAME = 'María García López';
const TEST_BIO = 'Agente especialista en propiedades residenciales en CDMX';
const TEST_IMAGE_URI = 'file:///processed/avatar_q0.8.jpg';
const TEST_PHOTO_URL =
  'https://supabase.co/storage/v1/object/public/profile-photos/usuario-test-uuid-abc123/avatar.jpg';

// Parámetros de guardado por defecto para los tests de happy path
const DEFAULT_SAVE_PARAMS = {
  fullName: TEST_FULL_NAME,
  imageUri: TEST_IMAGE_URI,
  bio: TEST_BIO,
};

// ---------------------------------------------------------------------------
// Helpers — casts de mocks tipados
// ---------------------------------------------------------------------------

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

// ---------------------------------------------------------------------------
// Factories de mock
// ---------------------------------------------------------------------------

/**
 * Crea un mock del cliente Supabase con la cadena:
 *   supabase.from('users').update({ bio }).eq('id', userId)
 * Los métodos son jest.fn() para aserciones.
 */
function make_mock_supabase(opts: {
  update_bio_result?: { error: null | { message: string } };
} = {}) {
  const { update_bio_result = { error: null } } = opts;

  const mock_eq = jest.fn().mockResolvedValue(update_bio_result);
  const mock_update = jest.fn().mockReturnValue({ eq: mock_eq });
  const mock_from = jest.fn().mockReturnValue({ update: mock_update });

  return {
    from: mock_from,
    // Expuestos para aserciones directas
    _mock_from: mock_from,
    _mock_update: mock_update,
    _mock_eq: mock_eq,
  };
}

/**
 * Crea un mock de la función saveProfile de profileService.
 * Éxito por defecto; se puede configurar para lanzar.
 */
function make_mock_save_profile(opts: {
  result?: { profilePhotoUrl: string | null };
  throws?: Error;
} = {}): jest.MockedFunction<(params: SaveProfileParams) => Promise<SaveProfileResult>> {
  if (opts.throws) {
    return jest.fn().mockRejectedValue(opts.throws) as jest.MockedFunction<
      (params: SaveProfileParams) => Promise<SaveProfileResult>
    >;
  }
  return jest.fn().mockResolvedValue(
    opts.result ?? { profilePhotoUrl: TEST_PHOTO_URL }
  ) as jest.MockedFunction<(params: SaveProfileParams) => Promise<SaveProfileResult>>;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  // useAuth devuelve siempre el mismo usuario de prueba
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

describe('useEditProfile', () => {
  // ── (EC-15) Estado inicial ─────────────────────────────────────────────────

  it('(EC-15) estado_inicial_isSaving_false_error_null: al montar, isSaving=false y error=null', async () => {
    const { result } = await renderHook(() =>
      useEditProfile({
        supabase: make_mock_supabase() as never,
        saveProfileFn: make_mock_save_profile(),
      })
    );

    expect(result.current.isSaving).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // ── (EC-1) Happy path — ambas escrituras ocurren ───────────────────────────

  it('(EC-1) guardado_normal_ambas_escrituras_ocurren: profileService.saveProfile Y supabase.update de bio llamados en un guardado normal', async () => {
    const mock_supabase = make_mock_supabase();
    const mock_save = make_mock_save_profile();

    const { result } = await renderHook(() =>
      useEditProfile({ supabase: mock_supabase as never, saveProfileFn: mock_save })
    );

    await act(async () => {
      await result.current.save(DEFAULT_SAVE_PARAMS);
    });

    expect(mock_save).toHaveBeenCalledTimes(1);
    expect(mock_supabase._mock_update).toHaveBeenCalledTimes(1);
  });

  // ── (EC-2) Éxito: estado limpio + operaciones ejecutadas ──────────────────

  it('(EC-2) exito_isSaving_false_error_null_y_operaciones_ejecutadas: tras guardado exitoso, isSaving=false, error=null y ambas ops ocurrieron', async () => {
    const mock_supabase = make_mock_supabase();
    const mock_save = make_mock_save_profile();

    const { result } = await renderHook(() =>
      useEditProfile({ supabase: mock_supabase as never, saveProfileFn: mock_save })
    );

    await act(async () => {
      await result.current.save(DEFAULT_SAVE_PARAMS);
    });

    expect(result.current.isSaving).toBe(false);
    expect(result.current.error).toBeNull();
    // Ambas operaciones deben haberse ejecutado para que sea "guardado exitoso"
    expect(mock_save).toHaveBeenCalledTimes(1);
    expect(mock_supabase._mock_update).toHaveBeenCalledTimes(1);
  });

  // ── (EC-3) Tabla correcta: users (NO user_preferences) ────────────────────

  it('(EC-3) bio_se_escribe_en_tabla_users: supabase.from recibe "users" — NOT "user_preferences" (dual-write Opción A)', async () => {
    const mock_supabase = make_mock_supabase();
    const mock_save = make_mock_save_profile();

    const { result } = await renderHook(() =>
      useEditProfile({ supabase: mock_supabase as never, saveProfileFn: mock_save })
    );

    await act(async () => {
      await result.current.save(DEFAULT_SAVE_PARAMS);
    });

    expect(mock_supabase._mock_from).toHaveBeenCalledWith('users');
    expect(mock_supabase._mock_from).not.toHaveBeenCalledWith('user_preferences');
  });

  // ── (EC-4) .eq('id', userId) con el userId correcto ───────────────────────

  it('(EC-4) eq_recibe_userId_del_usuario_autenticado: .eq("id", userId) usa el id del usuario de sesión', async () => {
    const mock_supabase = make_mock_supabase();
    const mock_save = make_mock_save_profile();

    const { result } = await renderHook(() =>
      useEditProfile({ supabase: mock_supabase as never, saveProfileFn: mock_save })
    );

    await act(async () => {
      await result.current.save(DEFAULT_SAVE_PARAMS);
    });

    expect(mock_supabase._mock_eq).toHaveBeenCalledWith('id', TEST_USER_ID);
  });

  // ── (EC-5) profileService recibe userId correcto ───────────────────────────

  it('(EC-5) profileService_recibe_userId_correcto: saveProfileFn se llama con el userId del usuario autenticado', async () => {
    const mock_supabase = make_mock_supabase();
    const mock_save = make_mock_save_profile();

    const { result } = await renderHook(() =>
      useEditProfile({ supabase: mock_supabase as never, saveProfileFn: mock_save })
    );

    await act(async () => {
      await result.current.save(DEFAULT_SAVE_PARAMS);
    });

    const call_args = mock_save.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(call_args.userId).toBe(TEST_USER_ID);
  });

  // ── (EC-6) Fallo profileService → error expuesto ─────────────────────────

  it('(EC-6) fallo_profileService_expone_error: si profileService lanza, error != null (no se traga)', async () => {
    const mock_supabase = make_mock_supabase();
    const mock_save = make_mock_save_profile({
      throws: new Error('storage/upload: no se pudo subir la foto de perfil'),
    });

    const { result } = await renderHook(() =>
      useEditProfile({ supabase: mock_supabase as never, saveProfileFn: mock_save })
    );

    await act(async () => {
      await result.current.save(DEFAULT_SAVE_PARAMS);
    });

    expect(result.current.error).not.toBeNull();
  });

  // ── (EC-7) INVARIANTE CLAVE: fallo profileService no cancela update de bio ─

  it('(EC-7) fallo_profileService_aun_intenta_update_bio: si profileService lanza, supabase.update("users") AÚN se llama (manejo independiente por operación)', async () => {
    const mock_supabase = make_mock_supabase();
    const mock_save = make_mock_save_profile({
      throws: new Error('upsert/preferences: error al guardar en user_preferences'),
    });

    const { result } = await renderHook(() =>
      useEditProfile({ supabase: mock_supabase as never, saveProfileFn: mock_save })
    );

    await act(async () => {
      await result.current.save(DEFAULT_SAVE_PARAMS);
    });

    // Aunque profileService falló, el update de bio DEBE haberse intentado
    expect(mock_supabase._mock_update).toHaveBeenCalledTimes(1);
  });

  // ── (EC-8) Fallo update bio → error expuesto ──────────────────────────────

  it('(EC-8) fallo_update_bio_expone_error: si supabase.update retorna { error }, error != null', async () => {
    const mock_supabase = make_mock_supabase({
      update_bio_result: { error: { message: 'RLS policy violation: no puede actualizar users.bio' } },
    });
    const mock_save = make_mock_save_profile();

    const { result } = await renderHook(() =>
      useEditProfile({ supabase: mock_supabase as never, saveProfileFn: mock_save })
    );

    await act(async () => {
      await result.current.save(DEFAULT_SAVE_PARAMS);
    });

    expect(result.current.error).not.toBeNull();
  });

  // ── (EC-9) Fallo update bio no cancela profileService ─────────────────────

  it('(EC-9) fallo_update_bio_profileService_fue_llamado: si supabase.update falla, profileService.saveProfile igual fue invocado', async () => {
    const mock_supabase = make_mock_supabase({
      update_bio_result: { error: { message: 'network timeout' } },
    });
    const mock_save = make_mock_save_profile();

    const { result } = await renderHook(() =>
      useEditProfile({ supabase: mock_supabase as never, saveProfileFn: mock_save })
    );

    await act(async () => {
      await result.current.save(DEFAULT_SAVE_PARAMS);
    });

    expect(mock_save).toHaveBeenCalledTimes(1);
  });

  // ── (EC-10) removePhoto=true → imageUri=null a profileService ─────────────

  it('(EC-10) removePhoto_true_profileService_recibe_imageUri_null: removePhoto=true → saveProfileFn recibe imageUri=null (señal para borrar profile_photo_url)', async () => {
    const mock_supabase = make_mock_supabase();
    const mock_save = make_mock_save_profile({ result: { profilePhotoUrl: null } });

    const { result } = await renderHook(() =>
      useEditProfile({ supabase: mock_supabase as never, saveProfileFn: mock_save })
    );

    await act(async () => {
      await result.current.save({
        fullName: TEST_FULL_NAME,
        imageUri: null,
        bio: TEST_BIO,
        removePhoto: true,
      });
    });

    // saveProfileFn debe haberse llamado (con imageUri=null para borrar la foto)
    expect(mock_save).toHaveBeenCalledTimes(1);
    const call_args = mock_save.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(call_args.imageUri).toBeNull();
  });

  // ── (EC-11) removePhoto=true con imageUri presente → no pasa la URI ───────

  it('(EC-11) removePhoto_true_imageUri_original_no_pasa_a_profileService: con removePhoto=true e imageUri presente, profileService NO recibe la URI original sino null', async () => {
    const mock_supabase = make_mock_supabase();
    const mock_save = make_mock_save_profile({ result: { profilePhotoUrl: null } });

    const { result } = await renderHook(() =>
      useEditProfile({ supabase: mock_supabase as never, saveProfileFn: mock_save })
    );

    await act(async () => {
      await result.current.save({
        fullName: TEST_FULL_NAME,
        imageUri: TEST_IMAGE_URI, // hay URI, pero removePhoto=true debe ignorarla
        bio: TEST_BIO,
        removePhoto: true,
      });
    });

    // saveProfileFn debe haberse llamado (y recibir null, no la URI original)
    expect(mock_save).toHaveBeenCalledTimes(1);
    const call_args = mock_save.mock.calls[0]![0] as unknown as Record<string, unknown>;
    // Con removePhoto=true, la URI original no llega a profileService
    expect(call_args.imageUri).not.toBe(TEST_IMAGE_URI);
    expect(call_args.imageUri).toBeNull();
  });

  // ── (EC-12) isSaving=true durante el guardado ─────────────────────────────

  it('(EC-12) isSaving_true_durante_guardado: isSaving=true mientras la operación de guardado está pendiente', async () => {
    // Dejamos saveProfileFn colgada para observar el estado intermedio
    let resolve_save!: (v: { profilePhotoUrl: null }) => void;
    const pending_save = new Promise<{ profilePhotoUrl: null }>((res) => {
      resolve_save = res;
    });
    const mock_save_pending = jest.fn().mockReturnValue(pending_save);
    const mock_supabase = make_mock_supabase();

    const { result } = await renderHook(() =>
      useEditProfile({
        supabase: mock_supabase as never,
        saveProfileFn: mock_save_pending as never,
      })
    );

    // Inicia save SIN awaitar — Promise queda pendiente
    act(() => {
      void result.current.save(DEFAULT_SAVE_PARAMS);
    });

    // Debe estar en isSaving=true mientras la Promise no resuelva
    expect(result.current.isSaving).toBe(true);

    // Limpieza: resolvemos para no dejar Promises colgadas
    await act(async () => {
      resolve_save({ profilePhotoUrl: null });
    });
  });

  // ── (EC-13) isSaving=false tras éxito + ops ejecutadas ────────────────────

  it('(EC-13) isSaving_false_tras_exito_y_operaciones_ejecutadas: tras guardado exitoso, isSaving=false y ambas ops fueron invocadas', async () => {
    const mock_supabase = make_mock_supabase();
    const mock_save = make_mock_save_profile();

    const { result } = await renderHook(() =>
      useEditProfile({ supabase: mock_supabase as never, saveProfileFn: mock_save })
    );

    await act(async () => {
      await result.current.save(DEFAULT_SAVE_PARAMS);
    });

    expect(result.current.isSaving).toBe(false);
    // Las operaciones deben haberse ejecutado (no es trivialmente idle)
    expect(mock_save).toHaveBeenCalledTimes(1);
    expect(mock_supabase._mock_update).toHaveBeenCalledTimes(1);
  });

  // ── (EC-14) isSaving=false tras error ─────────────────────────────────────

  it('(EC-14) isSaving_false_tras_error: tras error en las operaciones, isSaving vuelve a false y error != null', async () => {
    const mock_supabase = make_mock_supabase({
      update_bio_result: { error: { message: 'network error' } },
    });
    const mock_save = make_mock_save_profile({
      throws: new Error('storage/upload: timeout al subir la foto'),
    });

    const { result } = await renderHook(() =>
      useEditProfile({ supabase: mock_supabase as never, saveProfileFn: mock_save })
    );

    await act(async () => {
      await result.current.save(DEFAULT_SAVE_PARAMS);
    });

    expect(result.current.isSaving).toBe(false);
    expect(result.current.error).not.toBeNull();
  });
});
