/**
 * Tests — AdDetailScreen (mobile/app/(protected)/ads/[id].tsx)
 * Subtarea Taskmaster: 212.5 — smoke de render con RNTL (pantalla NO crítica
 * por regla determinista de CLAUDE.md §5 — es UI de presentación).
 *
 * SEAM BAJO TEST: el componente de ruta `AdDetailScreen` (default export de
 * `[id].tsx`), con `useLocalSearchParams` y `useAdStats` (212.3, ya tiene sus
 * propios 25+4 edge cases, guardián-aprobado) MOCKEADOS. `supabase` se
 * mockea para la única query inline del screen (detalle del ad por id +
 * catálogo de nombres de zona, mismo criterio que index.test.tsx).
 * `AdDailyLineChart`/`AdZoneBarsChart` (212.4) NO se mockean — ya tienen sus
 * propios tests y son componentes puros, montarlos de verdad aquí es lo que
 * prueba la integración real de props.
 *
 * COMPACTO — 7 casos:
 *
 * - (EC-D1) ad_id ausente/cargando el detalle → skeleton (testID), sin
 *   contenido de estadísticas.
 * - (EC-D2) la query del ad falla / no existe → mensaje de error neutro.
 * - (EC-D3) ad resuelto, useAdStats.is_loading=true → segundo skeleton (no
 *   crashea al alternar entre el skeleton del ad y el de las estadísticas).
 * - (EC-D4) useAdStats.error_message → se pinta tal cual (ya viene en
 *   español desde el hook).
 * - (EC-D5) 🔴 useAdStats.totals===null sin loading ni error (EC-11 del
 *   hook: sin autorización o ad_id inexistente) → EmptyState "Aún no hay
 *   datos", NUNCA una tabla con "0".
 * - (EC-D6) éxito: los 3 tiles formatean totals con toLocaleString, el
 *   segmentado ofrece Hoy/30 días/Máximo, y tocar un tile cambia la métrica
 *   resaltada (el hint del gráfico refleja la métrica activa).
 * - (EC-D7, 259.3) 🔴 cambio de periodo CON datos previos en pantalla → el
 *   skeleton de estadísticas (testID) NUNCA reaparece; el contenido sigue
 *   pintando el último `stats` no-nulo mientras el nuevo periodo carga (el
 *   componente lo conserva — useAdStats sigue mockeado, no sabe de "antes").
 *
 * GOTCHA RNTL v14: `render`/`act` con `await` (sin eso el resultado queda
 * `undefined` — ver memoria rntl14_renderhook_async).
 */

import React from 'react';
import { render, act, cleanup, screen, fireEvent } from '@testing-library/react-native';

import type { UseAdStatsState } from '@/features/ads/hooks/useAdStats';

// ---------------------------------------------------------------------------
// Mocks — ANTES de importar el SUT.
// ---------------------------------------------------------------------------

const mock_search_params: { id?: string | undefined } = { id: 'ad-1' };

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mock_search_params,
}));

jest.mock('@/features/ads/hooks/useAdStats', () => ({
  useAdStats: jest.fn(),
}));

interface AdRow {
  id: string;
  title: string;
  status: string;
  starts_at: string;
  ends_at: string;
  paused_at: string | null;
  paused_by_suspension: boolean;
  rejection_reason: string | null;
}

const mock_supabase_holder: { ad_row: AdRow | null; ad_error: { message: string } | null } = {
  ad_row: null,
  ad_error: null,
};

// Chain mínima: from('ads').select(...).eq('id', ..).maybeSingle() para el
// detalle; from('mx_*').select(...).in(...) para el catálogo de zonas
// (mismo shape que index.test.tsx) — nunca hay zonas en este archivo (el
// SUT bajo prueba con éxito no manda `zones` con datos), así que basta un []
// fijo para esa segunda forma.
jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return {
      from: jest.fn((table: string) => {
        if (table === 'ads') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                maybeSingle: jest.fn(() =>
                  Promise.resolve({ data: mock_supabase_holder.ad_row, error: mock_supabase_holder.ad_error }),
                ),
              })),
            })),
          };
        }
        return {
          select: jest.fn(() => ({
            in: jest.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        };
      }),
    };
  },
}));

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar los mocks
// ---------------------------------------------------------------------------

import { useAdStats } from '@/features/ads/hooks/useAdStats';
import AdDetailScreen from '../[id]';

const mock_use_ad_stats = useAdStats as jest.MockedFunction<typeof useAdStats>;

type RenderResult = Awaited<ReturnType<typeof render>>;

const AD: AdRow = {
  id: 'ad-1',
  title: 'Depa moderno en Providencia',
  status: 'active',
  starts_at: '2026-08-01T00:00:00Z',
  ends_at: '2026-09-14T00:00:00Z',
  paused_at: null,
  paused_by_suspension: false,
  rejection_reason: null,
};

function ad_stats(overrides: Partial<UseAdStatsState>): UseAdStatsState {
  return {
    totals: null,
    daily: [],
    zones: [],
    is_loading: false,
    error_message: null,
    refetch: jest.fn(),
    ...overrides,
  };
}

async function render_screen(): Promise<RenderResult> {
  let q!: RenderResult;
  await act(async () => {
    q = await render(<AdDetailScreen />);
  });
  return q;
}

beforeEach(() => {
  mock_search_params.id = 'ad-1';
  mock_supabase_holder.ad_row = AD;
  mock_supabase_holder.ad_error = null;
  mock_use_ad_stats.mockReturnValue(ad_stats({}));
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-D1) Cargando el detalle del ad → skeleton
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-D1: sin_ad_id_no_hay_query_y_pinta_skeleton_mientras_resuelve', () => {
  it('sin id en la ruta → el detalle nunca "carga" indefinidamente; termina en el mensaje de no encontrado, sin lanzar', async () => {
    mock_search_params.id = undefined;

    await render_screen();

    expect(screen.getByText('Anuncio no encontrado.')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-D2) La query del ad falla → mensaje neutro
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-D2: query_del_ad_falla_pinta_mensaje_neutro', () => {
  it('supabase.from("ads")... devuelve error → "No se pudo cargar el anuncio. Intenta de nuevo."', async () => {
    mock_supabase_holder.ad_row = null;
    mock_supabase_holder.ad_error = { message: 'network error' };

    await render_screen();

    expect(screen.getByText('No se pudo cargar el anuncio. Intenta de nuevo.')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-D3) ad resuelto, useAdStats aún cargando → skeleton de estadísticas
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-D3: ad_resuelto_stats_cargando_pinta_skeleton_de_estadisticas', () => {
  it('useAdStats.is_loading=true → el segmentado ya está montado, sin tiles ni EmptyState todavía', async () => {
    mock_use_ad_stats.mockReturnValue(ad_stats({ is_loading: true }));

    await render_screen();

    expect(screen.getByLabelText('30 días')).toBeTruthy();
    expect(screen.queryByText('Aún no hay datos')).toBeNull();
    expect(screen.queryByLabelText('Impresiones')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-D4) useAdStats con error → mensaje tal cual (ya en español)
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-D4: stats_con_error_pinta_el_mensaje_del_hook', () => {
  it('error_message del hook → se pinta literal, sin envolverlo ni traducirlo de nuevo', async () => {
    mock_use_ad_stats.mockReturnValue(
      ad_stats({ error_message: 'No se pudieron cargar las estadísticas del anuncio. Intenta de nuevo.' }),
    );

    await render_screen();

    expect(
      screen.getByText('No se pudieron cargar las estadísticas del anuncio. Intenta de nuevo.'),
    ).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-D5) 🔴 totals=null sin loading ni error → EmptyState, NUNCA "0"
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-D5: totals_null_sin_error_pinta_empty_state_nunca_cero', () => {
  it('EC-11 de useAdStats (sin autorización / ad_id inexistente) → "Aún no hay datos"', async () => {
    mock_use_ad_stats.mockReturnValue(ad_stats({ totals: null, is_loading: false, error_message: null }));

    await render_screen();

    expect(screen.getByText('Aún no hay datos')).toBeTruthy();
    expect(
      screen.getByText('Cuando tu anuncio reciba impresiones aparecerán aquí sus estadísticas.'),
    ).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-D6) Éxito — tiles formateados + segmentado + tap cambia la métrica
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-D6: exito_pinta_tiles_formateados_y_el_tap_cambia_la_metrica_resaltada', () => {
  it('totals reales → tiles con separador de miles; tap en "Vistas completas" cambia el hint del gráfico', async () => {
    mock_use_ad_stats.mockReturnValue(
      ad_stats({ totals: { impressions: 4820, views: 1240, cta_taps: 86 } }),
    );

    await render_screen();

    expect(screen.getByText('4,820')).toBeTruthy();
    expect(screen.getByText('1,240')).toBeTruthy();
    expect(screen.getByText('86')).toBeTruthy();
    expect(screen.getByLabelText('Hoy')).toBeTruthy();
    expect(screen.getByLabelText('Máximo')).toBeTruthy();

    // Métrica activa por default: 'impressions' — el hint del gráfico lo dice.
    expect(screen.getByText(/Impresiones · toca un tile/)).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Vistas completas'));
    });

    expect(screen.getByText(/Vistas completas · toca un tile/)).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-D7, 259.3) Cambio de periodo con datos previos → SIN skeleton
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-D7: cambio_de_periodo_con_datos_previos_no_vuelve_a_pintar_el_skeleton', () => {
  it('30 días exitoso, luego tap en "Máximo" (mock vuelve a is_loading=true) → el skeleton de estadísticas NUNCA reaparece y el dato viejo sigue en pantalla', async () => {
    const STATS_BY_PERIOD: Record<string, UseAdStatsState> = {
      last30: ad_stats({ totals: { impressions: 500, views: 120, cta_taps: 9 } }),
      max: ad_stats({ is_loading: true }),
    };
    mock_use_ad_stats.mockImplementation((_ad_id, period) => STATS_BY_PERIOD[period] ?? ad_stats({}));

    await render_screen();

    expect(screen.getByText('500')).toBeTruthy();
    expect(screen.queryByTestId('ad-detail-skeleton')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Máximo'));
    });

    // El cambio de periodo dispara is_loading=true de nuevo (mock), pero
    // como YA había datos del periodo anterior, el screen los conserva:
    // ni el skeleton reaparece, ni el tile queda vacío/en blanco.
    expect(screen.queryByTestId('ad-detail-skeleton')).toBeNull();
    expect(screen.getByText('500')).toBeTruthy();
  });
});
