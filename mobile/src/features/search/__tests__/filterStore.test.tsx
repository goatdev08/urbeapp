/**
 * filterStore.test.tsx — RED (#296.3): el FilterProvider sostiene `feed_tab`
 * como estado PROPIO, separado de FilterState (5 tabs: Para ti · Siguiendo ·
 * Nuevos · Venta · Renta — sustituye la `section` de 2 valores de #241.1).
 *
 * Invariante nuevo: `filters.operation_types` que el contexto expone es
 * SIEMPRE `operation_types_for_tab(feed_tab)` — derivado, el tab manda. El
 * eje de fuente (feed_tab) NUNCA entra a FilterState ni se persiste dentro
 * del JSON de filtros; vive en su propia key (feedTabStorage.ts).
 *
 * Cubre lo que feedSection.test.ts / feedTabStorage.test.ts no pueden: la
 * FRONTERA del store —
 *  - estado inicial antes de hidratar (arranque en frío, sonda del primer
 *    render — memoria: el estado inicial se verifica en el primer render);
 *  - hidratar desde AsyncStorage (dos fuentes independientes: filtros y tab)
 *    y cómo se combinan cuando el JSON de filtros trae un operation_types
 *    legacy pre-#296 (el tab manda, el JSON legacy de operation_types NO);
 *  - set_feed_tab escribe operation_types derivado Y persiste de inmediato
 *    (sin debounce — un tap es un evento discreto, decisión ponytail);
 *  - clear_filters conserva el tab (no es un filtro, es el "canal") — se
 *    prueba DESDE ESTADO POBLADO (memoria: un reset solo se prueba así);
 *  - feed_tab NO cuenta en active_filter_count (badge del sheet).
 *
 * Gotcha RNTL 14 ([[rntl14_renderhook_async]]): `await renderHook` y `await act`.
 */
import React from 'react';
import { act, renderHook } from '@testing-library/react-native';

import { FilterProvider, useFilters } from '../filterStore';
import { EMPTY_FILTERS } from '../lib/filterQuery';
import { load_filters } from '../lib/filterStorage';
import { load_feed_tab, save_feed_tab } from '../lib/feedTabStorage';
import type { FilterState } from '../types';

// jest.mock se iza por encima de los imports (babel-plugin-jest-hoist).
jest.mock('../lib/filterStorage', () => ({
  load_filters: jest.fn(),
  save_filters: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../lib/feedTabStorage', () => ({
  load_feed_tab: jest.fn(),
  save_feed_tab: jest.fn().mockResolvedValue(undefined),
}));

const mock_load_filters = load_filters as jest.MockedFunction<typeof load_filters>;
const mock_load_feed_tab = load_feed_tab as jest.MockedFunction<typeof load_feed_tab>;
const mock_save_feed_tab = save_feed_tab as jest.MockedFunction<typeof save_feed_tab>;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <FilterProvider>{children}</FilterProvider>
);

const persisted = (overrides: Partial<FilterState>): FilterState => ({ ...EMPTY_FILTERS, ...overrides });

// Deja la hidratación pendiente para poder observar el estado de arranque.
const never_resolves = () => new Promise<never>(() => {});

describe('FilterProvider — feed_tab (#296.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('(EC-ST-1) arranque_en_frio_ya_tiene_para_ti: antes de hidratar, feed_tab="para_ti" y operation_types=["sale","rent"]', async () => {
    mock_load_filters.mockImplementation(never_resolves);
    mock_load_feed_tab.mockImplementation(never_resolves);
    const { result } = await renderHook(() => useFilters(), { wrapper });

    expect(result.current.feed_tab).toBe('para_ti');
    expect(result.current.filters.operation_types).toEqual(['sale', 'rent']);
  });

  it('(EC-ST-2) hidratar_json_legacy_de_filtros_sin_tab_guardado_el_tab_manda: filtros persistidos operation_types=["rent"] (pre-#296) + sin tab guardado (load_feed_tab→"para_ti") → feed_tab="para_ti", operation_types=["sale","rent"], y el resto del JSON legacy (zone) sí hidrata', async () => {
    mock_load_filters.mockResolvedValue(persisted({ operation_types: ['rent'], zone: 'Providencia' }));
    mock_load_feed_tab.mockResolvedValue('para_ti');
    const { result } = await renderHook(() => useFilters(), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.filters.zone).toBe('Providencia');
    expect(result.current.feed_tab).toBe('para_ti');
    expect(result.current.filters.operation_types).toEqual(['sale', 'rent']);
  });

  it('(EC-ST-3) hidratar_tab_guardado_renta: load_feed_tab resuelve "renta" → feed_tab="renta", operation_types=["rent"]', async () => {
    mock_load_filters.mockResolvedValue(persisted({}));
    mock_load_feed_tab.mockResolvedValue('renta');
    const { result } = await renderHook(() => useFilters(), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.feed_tab).toBe('renta');
    expect(result.current.filters.operation_types).toEqual(['rent']);
  });

  it('(EC-ST-4) load_feed_tab_que_rechaza_no_rompe_el_provider: aunque en producción load_feed_tab es fail-safe, si la promesa se rechaza el store sigue en "para_ti" sin lanzar', async () => {
    mock_load_filters.mockResolvedValue(persisted({}));
    mock_load_feed_tab.mockRejectedValue(new Error('feedTabStorage roto'));
    const { result } = await renderHook(() => useFilters(), { wrapper });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.feed_tab).toBe('para_ti');
    expect(result.current.filters.operation_types).toEqual(['sale', 'rent']);
  });

  it('(EC-ST-5) set_feed_tab_venta_deriva_operation_types_y_persiste_de_inmediato: set_feed_tab("venta") → feed_tab="venta", operation_types=["sale"], save_feed_tab("venta") llamado sin esperar debounce', async () => {
    mock_load_filters.mockImplementation(never_resolves);
    mock_load_feed_tab.mockImplementation(never_resolves);
    const { result } = await renderHook(() => useFilters(), { wrapper });

    await act(async () => {
      result.current.set_feed_tab('venta');
    });

    expect(result.current.feed_tab).toBe('venta');
    expect(result.current.filters.operation_types).toEqual(['sale']);
    expect(mock_save_feed_tab).toHaveBeenCalledWith('venta');
  });

  it('(EC-ST-6) set_feed_tab_siguiendo_deriva_ambas_operaciones: set_feed_tab("siguiendo") → operation_types=["sale","rent"]', async () => {
    mock_load_filters.mockImplementation(never_resolves);
    mock_load_feed_tab.mockImplementation(never_resolves);
    const { result } = await renderHook(() => useFilters(), { wrapper });

    await act(async () => {
      result.current.set_feed_tab('siguiendo');
    });

    expect(result.current.feed_tab).toBe('siguiendo');
    expect(result.current.filters.operation_types).toEqual(['sale', 'rent']);
  });

  it('(EC-ST-7) clear_filters_conserva_el_tab: renta + zona poblada → clear → zona vuelve a null, feed_tab sigue "renta", operation_types sigue ["rent"]', async () => {
    mock_load_filters.mockImplementation(never_resolves);
    mock_load_feed_tab.mockImplementation(never_resolves);
    const { result } = await renderHook(() => useFilters(), { wrapper });

    await act(async () => {
      result.current.set_feed_tab('renta');
      result.current.set_filter('zone', 'Chapalita');
      result.current.set_filter('pet_friendly', true);
    });
    expect(result.current.active_filter_count).toBe(2);

    await act(async () => {
      result.current.clear_filters();
    });

    expect(result.current.filters.zone).toBeNull();
    expect(result.current.filters.pet_friendly).toBe(false);
    expect(result.current.feed_tab).toBe('renta');
    expect(result.current.filters.operation_types).toEqual(['rent']);
  });

  it('(EC-ST-8) el_feed_tab_no_cuenta_en_el_badge: solo tab activo (incluso Venta/Renta) → active_filter_count=0', async () => {
    mock_load_filters.mockImplementation(never_resolves);
    mock_load_feed_tab.mockImplementation(never_resolves);
    const { result } = await renderHook(() => useFilters(), { wrapper });

    expect(result.current.active_filter_count).toBe(0);
    await act(async () => {
      result.current.set_feed_tab('renta');
    });
    expect(result.current.active_filter_count).toBe(0);
  });
});
