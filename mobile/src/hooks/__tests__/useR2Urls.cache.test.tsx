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
 * - EC-U1 con todas las keys cacheadas → el PRIMER render (antes de que
 *   corra ningún efecto) ya trae `urls` listas y `loading=false`; 0 invokes
 *   a la EF; y el efecto NO dispara un segundo render (misma referencia de
 *   estado — sin render fantasma).
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
 *
 * ---------------------------------------------------------------------------
 * AJUSTE POST-GUARDIAN (#263, violación 1) — 2026-09-05
 * ---------------------------------------------------------------------------
 * EC-U1 original asertaba DESPUÉS de `await renderHook(...)`, que ya deja
 * correr y resolver el efecto — así que el assert quedaba satisfecho incluso
 * SIN la siembra síncrona (el efecto, al ver la key cacheada, no invoca la
 * EF y termina en el mismo `{urls, loading:false}` por la vía asíncrona). El
 * guardian confirmó esto quitando la siembra entera del hook: las 593
 * pruebas del footprint siguieron en verde. Se corrige AQUÍ (única edición
 * permitida: el SEAM del RED no cambia, solo la forma de observar el primer
 * render) con un componente sonda que empuja el valor de cada render a un
 * array — `states[0]` es el resultado del PRIMER render, ANTES de que el
 * efecto tenga oportunidad de correr, así que si la siembra síncrona falta,
 * `states[0]` es `{urls:[null], loading:true}` en vez del valor cacheado.
 * De paso cubre la violación 3 (sin render fantasma): `states.length===1`
 * verifica que el efecto, con todo cacheado, no dispara un segundo render.
 */

import React from 'react';
import { render, renderHook, act } from '@testing-library/react-native';

import { useR2Urls } from '../useR2Urls';
import type { UseR2UrlsResult } from '../useR2Urls';
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
  it('EC_U1_todas_las_keys_cacheadas_primer_render_urls_listas_loading_false_cero_invokes_sin_render_extra', async () => {
    // Precarga TEST_KEY_1 en la caché de módulo vía el resolver real.
    mock_invoke.mockResolvedValueOnce({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });
    await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });
    mock_invoke.mockClear();

    // Sonda: empuja el estado devuelto por useR2Urls en CADA render — a
    // diferencia de `result.current` de renderHook (que solo se lee DESPUÉS
    // de que renderHook ya drenó los efectos), esto captura el valor del
    // PRIMER render tal cual salió del cuerpo de la función, sin que el
    // efecto haya tenido oportunidad de correr todavía.
    const states: UseR2UrlsResult[] = [];
    function Probe() {
      const state = useR2Urls([TEST_KEY_1], { supabase: mock_supabase });
      states.push(state);
      return null;
    }

    await render(<Probe />);

    // Primer render: la siembra síncrona (peek_r2_urls) ya trae la URL
    // cacheada — sin esto, states[0] sería {urls:[null], loading:true}.
    expect(states[0]).toEqual({ urls: [TEST_URL_1], loading: false });
    expect(mock_invoke).not.toHaveBeenCalled();

    // Con TODO cacheado desde el primer render, el efecto no debe disparar
    // un segundo render (guardian #263, violación 3) — exactamente 1 push.
    expect(states.length).toBe(1);
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
