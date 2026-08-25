/**
 * Tests — AdsScreen (mobile/app/(protected)/ads/index.tsx)
 * Subtarea Taskmaster: 171.3 — smoke de render con RNTL.
 *
 * 🔴 Por qué existe (pedido del orquestador, 2026-08-21): CLAUDE.md §5 exige
 * un smoke para toda subtarea NO crítica. El smoke real en emulador no es
 * viable todavía (la RPC ad_metrics_for_agency y el resto del schema de
 * 168-172 aún no están desplegados, y la pantalla va montada tras el gate de
 * 170.8 epic-wide). Este archivo lo sustituye con un render RNTL —
 * precedente exacto: `_layout.test.tsx` de esta misma carpeta.
 *
 * SEAM BAJO TEST: el componente de ruta `AdsScreen` (default export de
 * `index.tsx`), con `useMyAds` y `useAdMetrics` MOCKEADOS por completo — ya
 * tienen sus propios 18 tests cada uno (171.2/171.3 fase crítica, cerrados
 * con guardián). Aquí solo se prueba lo que la PANTALLA hace con esos
 * valores: qué pinta, qué NO pinta, y que un fallo en un hook no arrastra al
 * otro. `supabase` se mockea solo para la resolución de nombres de zona
 * (mx_municipalities/mx_neighborhoods), que la pantalla hace inline a
 * propósito (ver el docblock de index.tsx).
 *
 * COMPACTO por pedido explícito — 6 casos, no más:
 *
 * - (EC-S1) 🔴 invariante central: `totals === null` con `loading=false` NO
 *   pinta ningún "0" en pantalla. Para quien pagó el slot, "0 impresiones" y
 *   "no pudimos cargar" son mensajes opuestos — ver el docblock de
 *   useAdMetrics.ts, regla 3 del brief de 171.3.
 * - (EC-S2) estado vacío LEGÍTIMO (`totals={0,0,0}`, error=null, ads=[]) sí
 *   pinta el EmptyState intencional (contraste directo con EC-S1: aquí los
 *   "0" de los contadores SÍ son reales).
 * - (EC-S3) el bucket `other_zones` se pinta como "Otras zonas" con su
 *   explicación, con sus propios contadores — nunca fusionado con los de
 *   una zona real ni mostrado con un nombre de zona.
 * - (EC-S4a) fallo aislado: `useAdMetrics` con error + `useMyAds` con
 *   anuncios ⇒ la lista de anuncios SIGUE visible.
 * - (EC-S4b) el recíproco: `useMyAds` con error + `useAdMetrics` sano ⇒ las
 *   métricas SIGUEN visibles (y el EmptyState de anuncios NO se pinta —
 *   es un error, no "aún no tienes anuncios").
 * - (EC-S5) la consulta de catálogo (nombres de zona) falla ⇒ los
 *   contadores por zona se pintan igual, con el texto de reserva. Los
 *   números no esperan a las etiquetas.
 *
 * GOTCHAS RNTL ya pagados: `render` con `await` + `act()` async con `await`
 * (RNTL 14 — sin `await` el resultado queda `undefined`). PROHIBIDO
 * `expect(act(...)).resolves.not.toThrow()` (vacuo, ver CLAUDE.md/nota
 * rntl14_renderhook_async).
 *
 * 🔴 Ampliado en 212.5 (cada card gana thumbnail + fila de 3 métricas
 * "Máximo" vía useAdStats, y navega al detalle) — CAMBIOS a este archivo:
 *   - `useAdStats` se mockea (igual que useMyAds/useAdMetrics): cada
 *     AdListItem lo invoca por su cuenta y, sin mock, intentaría llamar
 *     `.rpc()` sobre el mock de supabase de este archivo (que solo
 *     implementa `.from().select().in()` para el catálogo de zonas) y
 *     tronaría.
 *   - `expo-router` gana `useRouter` (mockeado con un `push` espiable) —
 *     AdListItem navega al detalle con `router.push`.
 *   - (EC-S6/EC-S7) nuevos: la fila de métricas por card formatea los
 *     totales de useAdStats, el tap navega, y un anuncio 'pending_review'
 *     fuerza ad_id=null hacia useAdStats (nunca dispara su RPC) y pinta "—".
 */

import React from 'react';
import { render, act, cleanup, screen, fireEvent } from '@testing-library/react-native';

import type { MyAd, UseMyAdsResult } from '@/features/ads/hooks/useMyAds';
import type { UseAdMetricsState } from '@/features/ads/hooks/useAdMetrics';
import type { UseAdStatsState } from '@/features/ads/hooks/useAdStats';

// ---------------------------------------------------------------------------
// Mocks — ANTES de importar el SUT.
// ---------------------------------------------------------------------------

const mock_router_push = jest.fn();

jest.mock('expo-router', () => ({
  // Stack.Screen es solo configuración de header — sin navigator real bajo
  // RNTL no aporta nada al smoke, mismo criterio que _layout.test.tsx con
  // Redirect/Slot.
  Stack: { Screen: () => null },
  useRouter: () => ({ push: mock_router_push }),
}));

jest.mock('@/features/ads/hooks/useMyAds', () => ({
  useMyAds: jest.fn(),
}));

jest.mock('@/features/ads/hooks/useAdMetrics', () => ({
  useAdMetrics: jest.fn(),
}));

jest.mock('@/features/ads/hooks/useAdStats', () => ({
  useAdStats: jest.fn(),
}));

// Chain mínima .from(table).select(cols).in(col, ids) → Promise — la
// pantalla solo usa esta forma para resolver nombres de zona.
function make_catalog_mock(rows: { id: string | number; name: string }[] | null, error: unknown = null) {
  return {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        in: jest.fn(() => Promise.resolve({ data: rows, error })),
      })),
    })),
  };
}

const mock_supabase_holder: { client: ReturnType<typeof make_catalog_mock> } = {
  client: make_catalog_mock([]),
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar los mocks
// ---------------------------------------------------------------------------

import { useMyAds } from '@/features/ads/hooks/useMyAds';
import { useAdMetrics } from '@/features/ads/hooks/useAdMetrics';
import { useAdStats } from '@/features/ads/hooks/useAdStats';
import AdsScreen from '../index';

const mock_use_my_ads = useMyAds as jest.MockedFunction<typeof useMyAds>;
const mock_use_ad_metrics = useAdMetrics as jest.MockedFunction<typeof useAdMetrics>;
const mock_use_ad_stats = useAdStats as jest.MockedFunction<typeof useAdStats>;

type RenderResult = Awaited<ReturnType<typeof render>>;

const AD: MyAd = {
  id: 'ad-1',
  title: 'Anuncio Uno',
  status: 'active',
  starts_at: '2026-08-01T00:00:00Z',
  ends_at: '2026-09-01T00:00:00Z',
  paused_at: null,
  paused_by_suspension: false,
  rejection_reason: null,
};

function my_ads(overrides: Partial<UseMyAdsResult>): UseMyAdsResult {
  return { ads: [], agency_id: 'agency-1', loading: false, error: null, ...overrides };
}

function metrics(overrides: Partial<UseAdMetricsState>): UseAdMetricsState {
  return { zones: [], other_zones: null, totals: null, loading: false, error: null, ...overrides };
}

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
    q = await render(<AdsScreen />);
  });
  return q;
}

beforeEach(() => {
  mock_supabase_holder.client = make_catalog_mock([]);
  // Default seguro: cualquier card renderizada sin override explícito pinta
  // "—" (totals=null) en vez de tronar contra un mock de RPC inexistente.
  mock_use_ad_stats.mockReturnValue(ad_stats({}));
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-S1) 🔴 totals=null, loading=false → SIN "0" en pantalla
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-S1: totals_null_no_es_cero_nunca_pinta_0', () => {
  it('totals=null, loading=false, error=null → ningún "0" en pantalla; sección de métricas ausente', async () => {
    mock_use_my_ads.mockReturnValue(my_ads({ agency_id: null, loading: false }));
    mock_use_ad_metrics.mockReturnValue(metrics({ totals: null, loading: false, error: null }));

    await render_screen();

    expect(screen.queryAllByText('0')).toHaveLength(0);
    expect(screen.queryByText('Tus métricas')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-S2) Estado vacío legítimo — EmptyState intencional
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-S2: estado_vacio_legitimo_pinta_empty_state', () => {
  it('ads=[], error=null, totals={0,0,0} → EmptyState visible y los 3 contadores SÍ muestran "0" real', async () => {
    mock_use_my_ads.mockReturnValue(my_ads({ ads: [], loading: false, error: null }));
    mock_use_ad_metrics.mockReturnValue(
      metrics({ totals: { impressions: 0, views: 0, cta_taps: 0 }, loading: false, error: null }),
    );

    await render_screen();

    expect(screen.getByText('Aún no tienes anuncios')).toBeTruthy();
    // Contraste directo con EC-S1: aquí SÍ hay datos reales (0 legítimo).
    expect(screen.queryAllByText('0')).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-S3) other_zones — nunca fusionado ni con nombre de zona
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-S3: other_zones_se_pinta_tal_cual_sin_fusionar_ni_nombre', () => {
  it('zona real + bucket "otras zonas" → cada uno con SUS propios contadores, el bucket con su etiqueta fija', async () => {
    mock_supabase_holder.client = make_catalog_mock([{ id: '14039', name: 'Zapopan' }]);
    mock_use_my_ads.mockReturnValue(my_ads({ ads: [], loading: false, error: null }));
    mock_use_ad_metrics.mockReturnValue(
      metrics({
        zones: [{ municipality_id: '14039', neighborhood_id: null, impressions: 30, views: 15, cta_taps: 3 }],
        other_zones: { impressions: 20, views: 5, cta_taps: 2 },
        totals: { impressions: 50, views: 20, cta_taps: 5 },
        loading: false,
        error: null,
      }),
    );

    await render_screen();

    expect(screen.getByText('Zapopan')).toBeTruthy();
    expect(screen.getByText('Otras zonas')).toBeTruthy();
    expect(screen.getByText('Zonas con muy poca audiencia para mostrarlas por separado.')).toBeTruthy();
    // Contadores SEPARADOS — nunca fusionados en una sola fila con la suma.
    expect(screen.getByText('30 · 15 · 3')).toBeTruthy();
    expect(screen.getByText('20 · 5 · 2')).toBeTruthy();
    expect(screen.queryByText('50 · 20 · 5')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-S4) Fallo aislado — un hook en error no arrastra al otro
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-S4a: error_de_metricas_no_oculta_la_lista_de_anuncios', () => {
  it('useAdMetrics con error + useMyAds con anuncios → el anuncio SIGUE visible; sin sección de métricas', async () => {
    mock_use_my_ads.mockReturnValue(my_ads({ ads: [AD], loading: false, error: null }));
    mock_use_ad_metrics.mockReturnValue(
      metrics({ error: 'No se pudieron cargar las métricas del anuncio. Intenta de nuevo.' }),
    );

    await render_screen();

    expect(screen.getByText('Anuncio Uno')).toBeTruthy();
    expect(screen.getByText('No se pudieron cargar las métricas del anuncio. Intenta de nuevo.')).toBeTruthy();
    expect(screen.queryByText('Tus métricas')).toBeNull();
  });
});

describe('EC-S4b: error_de_anuncios_no_oculta_las_metricas', () => {
  it('useMyAds con error + useAdMetrics sano → las métricas SIGUEN visibles; sin EmptyState (es un error, no "aún no tienes")', async () => {
    mock_use_my_ads.mockReturnValue(
      my_ads({ ads: [], loading: false, error: 'No se pudieron cargar tus anuncios. Intenta de nuevo.' }),
    );
    mock_use_ad_metrics.mockReturnValue(
      metrics({ totals: { impressions: 10, views: 4, cta_taps: 1 }, loading: false, error: null }),
    );

    await render_screen();

    expect(screen.getByText('No se pudieron cargar tus anuncios. Intenta de nuevo.')).toBeTruthy();
    expect(screen.getByText('Tus métricas')).toBeTruthy();
    expect(screen.queryByText('Aún no tienes anuncios')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-S5) Catálogo de nombres falla — los números no esperan a las etiquetas
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-S5: catalogo_de_nombres_falla_los_numeros_se_pintan_igual', () => {
  it('mx_municipalities falla → la fila de zona muestra el conteo real con la etiqueta de reserva, nunca el id crudo', async () => {
    mock_supabase_holder.client = make_catalog_mock(null, { message: 'network error' });
    mock_use_my_ads.mockReturnValue(my_ads({ ads: [], loading: false, error: null }));
    mock_use_ad_metrics.mockReturnValue(
      metrics({
        zones: [{ municipality_id: '14039', neighborhood_id: null, impressions: 7, views: 2, cta_taps: 1 }],
        other_zones: null,
        totals: { impressions: 7, views: 2, cta_taps: 1 },
        loading: false,
        error: null,
      }),
    );

    await render_screen();

    expect(screen.getByText('7 · 2 · 1')).toBeTruthy();
    expect(screen.getByText('Municipio sin nombre')).toBeTruthy();
    expect(screen.queryByText('14039')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-S6) 212.5 — card pinta thumbnail + 3 métricas por anuncio, tap navega
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-S6: tarjeta_pinta_metricas_por_anuncio_y_navega_al_detalle', () => {
  it('ad activo con totals reales → formatea las 3 métricas (12.5k/3.9k/214) y el tap navega a /ads/<id>', async () => {
    mock_use_my_ads.mockReturnValue(my_ads({ ads: [AD], loading: false, error: null }));
    mock_use_ad_metrics.mockReturnValue(metrics({}));
    mock_use_ad_stats.mockReturnValue(
      ad_stats({ totals: { impressions: 12500, views: 3900, cta_taps: 214 } }),
    );

    await render_screen();

    expect(mock_use_ad_stats).toHaveBeenCalledWith('ad-1', 'max');
    expect(screen.getByText('12.5k')).toBeTruthy();
    expect(screen.getByText('3.9k')).toBeTruthy();
    expect(screen.getByText('214')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Ver detalle de Anuncio Uno'));
    expect(mock_router_push).toHaveBeenCalledWith('/ads/ad-1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-S7) 212.5 — 'pending_review' fuerza "—" sin pedirle su id a la RPC
// ═══════════════════════════════════════════════════════════════════════════

describe("EC-S7: anuncio_en_revision_fuerza_guiones_sin_pedir_su_id_a_useAdStats", () => {
  it("status='pending_review' → useAdStats se llama con ad_id=null (nunca dispara su RPC) y la card pinta '—' en las 3 métricas", async () => {
    const pending_ad: MyAd = { ...AD, id: 'ad-2', status: 'pending_review' };
    mock_use_my_ads.mockReturnValue(my_ads({ ads: [pending_ad], loading: false, error: null }));
    mock_use_ad_metrics.mockReturnValue(metrics({}));
    mock_use_ad_stats.mockReturnValue(ad_stats({ totals: null }));

    await render_screen();

    expect(mock_use_ad_stats).toHaveBeenCalledWith(null, 'max');
    expect(screen.queryAllByText('—')).toHaveLength(3);
  });
});
