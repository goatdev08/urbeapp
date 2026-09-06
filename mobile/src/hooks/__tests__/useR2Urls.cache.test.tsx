/**
 * Tests fase RED — siembra síncrona de useR2Urls desde la caché de módulo
 * de resolve_r2_urls (r2Resolver.ts).
 * Tarea Taskmaster: 263 — polish(222): las fotos de perfil tardan en
 * aparecer en TODOS los perfiles (caché de URLs firmadas de R2).
 *
 * SEAM (interfaz bajo test):
 * - useR2Urls(keys, deps?): si peek_r2_urls(keys) cubre TODAS las keys
 *   reales, el PRIMER render trae `urls` listas y `loading=false` y no se
 *   invoca nada; si falta alguna, comportamiento actual (loading=true →
 *   resolve → loading=false), y la EF recibe SOLO las que faltan.
 *
 * Frontera del sistema a mockear: `supabase.functions.invoke` (inyectado
 * vía `deps.supabase`) — igual que useR2Urls.test.tsx; NUNCA se mockea
 * `resolve_r2_urls`/`peek_r2_urls` (colaboradores internos propios). La
 * caché se puebla llamando al `resolve_r2_urls` REAL antes de montar el
 * hook (mismo seam, sin atajos por canal lateral).
 *
 * EDGE CASES CUBIERTOS (RED):
 *
 * ### Happy path
 * - EC-U1 con todas las keys cacheadas → primer render (sin esperar ningún
 *   efecto) trae `urls` listas y `loading=false`; 0 invokes a la EF.
 *
 * ### Ramas no obvias
 * - EC-U2 con una key cacheada y otra no → `loading=true` al montar (la
 *   caché no cubre TODAS las keys), la EF recibe SOLO la key faltante, y al
 *   resolver ambas URLs quedan expuestas (la cacheada + la recién resuelta).
 *
 * NOTA DE VERIFICACIÓN (RED): `peek_r2_urls`/`clear_r2_url_cache` no
 * existen todavía en r2Resolver.ts → este archivo falla por TS/Jest
 * (import de símbolo inexistente) hasta la fase GREEN. Modo de fallo
 * aceptado explícitamente en el briefing; useR2Urls.ts no se toca en RED.
 */

import { renderHook, act } from '@testing-library/react-native';

import { useR2Urls } from '../useR2Urls';
import { resolve_r2_urls, clear_r2_url_cache } from '../../lib/r2Resolver';

const mock_invoke = jest.fn();

const mock_supabase = {
  functions: { invoke: mock_invoke },
};

const TEST_KEY_1 = 'avatars/user-1/uuid-1';
const TEST_KEY_2 = 'avatars/user-2/uuid-2';
const TEST_URL_1 = 'https://abc.r2.cloudflarestorage.com/urbea-assets/avatars/user-1/uuid-1?sig=1';
const TEST_URL_2 = 'https://abc.r2.cloudflarestorage.com/urbea-assets/avatars/user-2/uuid-2?sig=2';

beforeEach(() => {
  jest.clearAllMocks();
  clear_r2_url_cache();
});

describe('useR2Urls — siembra síncrona desde la caché de módulo (263)', () => {
  it('EC_U1_todas_las_keys_cacheadas_primer_render_urls_listas_loading_false_cero_invokes', async () => {
    // Precarga TEST_KEY_1 en la caché de módulo vía el resolver real.
    mock_invoke.mockResolvedValueOnce({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });
    await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });
    mock_invoke.mockClear();

    const { result } = await renderHook(() =>
      useR2Urls([TEST_KEY_1], { supabase: mock_supabase }),
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.urls).toEqual([TEST_URL_1]);
    expect(mock_invoke).not.toHaveBeenCalled();
  });

  it('EC_U2_una_key_cacheada_y_otra_no_loading_true_al_montar_ef_recibe_solo_la_faltante', async () => {
    // Precarga TEST_KEY_1 en la caché de módulo vía el resolver real.
    mock_invoke.mockResolvedValueOnce({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });
    await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });
    mock_invoke.mockClear();

    let resolve_invoke!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolve_invoke = resolve;
    });
    mock_invoke.mockReturnValueOnce(pending);

    const { result } = await renderHook(() =>
      useR2Urls([TEST_KEY_1, TEST_KEY_2], { supabase: mock_supabase }),
    );

    // Al montar: TEST_KEY_1 ya está en caché pero TEST_KEY_2 no la cubre
    // por completo → loading sigue true hasta que resuelva la EF.
    expect(result.current.loading).toBe(true);
    expect(mock_invoke).toHaveBeenCalledTimes(1);
    const [, options] = mock_invoke.mock.calls[0] as [string, { body: { keys: string[] } }];
    expect(options.body.keys).toEqual([TEST_KEY_2]);

    await act(async () => {
      resolve_invoke({
        data: { urls: [{ key: TEST_KEY_2, url: TEST_URL_2, expires: 3600 }] },
        error: null,
      });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.urls).toEqual([TEST_URL_1, TEST_URL_2]);
  });
});
