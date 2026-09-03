/**
 * filterStore.test.tsx — RED (#241.1): el FilterProvider sostiene la sección
 * del feed como invariante (siempre exactamente ['sale'] o ['rent']).
 *
 * Cubre lo que feedSection.test.ts no puede: la FRONTERA del store —
 *  - estado inicial antes de hidratar (arranque en frío) ya trae la sección;
 *  - hidratar desde AsyncStorage normaliza lo persistido (pre-#241 → default);
 *  - set_section escribe operation_types exacto;
 *  - clear_filters conserva la sección (no es un filtro, es el "canal");
 *  - la sección NO cuenta en active_filter_count (badge del sheet).
 *
 * Gotcha RNTL 14 ([[rntl14_renderhook_async]]): `await renderHook` y `await act`.
 */
import React from 'react';
import { act, renderHook } from '@testing-library/react-native';

import { FilterProvider, useFilters } from '../filterStore';
import { EMPTY_FILTERS } from '../lib/filterQuery';
import { load_filters } from '../lib/filterStorage';
import type { FilterState } from '../types';

// jest.mock se iza por encima de los imports (babel-plugin-jest-hoist).
jest.mock('../lib/filterStorage', () => ({
  load_filters: jest.fn(),
  save_filters: jest.fn().mockResolvedValue(undefined),
}));

const mock_load = load_filters as jest.MockedFunction<typeof load_filters>;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <FilterProvider>{children}</FilterProvider>
);

const persisted = (overrides: Partial<FilterState>): FilterState => ({ ...EMPTY_FILTERS, ...overrides });

// Deja la hidratación pendiente para poder observar el estado de arranque.
const never_resolves = () => new Promise<FilterState>(() => {});

describe('FilterProvider — sección del feed (#241.1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('(EC-ST-1) arranque_en_frio_ya_tiene_seccion: antes de hidratar, section="sale" y operation_types=["sale"]', async () => {
    mock_load.mockImplementation(never_resolves);
    const { result } = await renderHook(() => useFilters(), { wrapper });

    expect(result.current.section).toBe('sale');
    expect(result.current.filters.operation_types).toEqual(['sale']);
  });

  it('(EC-ST-2) hidratar_pre_241_normaliza: persistido operation_types=[] → ["sale"]', async () => {
    mock_load.mockResolvedValue(persisted({ operation_types: [], zone: 'Providencia' }));
    const { result } = await renderHook(() => useFilters(), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.filters.zone).toBe('Providencia');
    expect(result.current.filters.operation_types).toEqual(['sale']);
    expect(result.current.section).toBe('sale');
  });

  it('(EC-ST-3) hidratar_respeta_renta: persistido operation_types=["rent"] → section="rent"', async () => {
    mock_load.mockResolvedValue(persisted({ operation_types: ['rent'] }));
    const { result } = await renderHook(() => useFilters(), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.section).toBe('rent');
    expect(result.current.filters.operation_types).toEqual(['rent']);
  });

  it('(EC-ST-4) set_section_escribe_operation_types_exacto: set_section("rent") → ["rent"]; set_section("sale") → ["sale"]', async () => {
    mock_load.mockImplementation(never_resolves);
    const { result } = await renderHook(() => useFilters(), { wrapper });

    await act(async () => {
      result.current.set_section('rent');
    });
    expect(result.current.section).toBe('rent');
    expect(result.current.filters.operation_types).toEqual(['rent']);

    await act(async () => {
      result.current.set_section('sale');
    });
    expect(result.current.section).toBe('sale');
    expect(result.current.filters.operation_types).toEqual(['sale']);
  });

  it('(EC-ST-5) clear_filters_conserva_la_seccion: renta + zona → clear → zona null, sigue renta', async () => {
    mock_load.mockImplementation(never_resolves);
    const { result } = await renderHook(() => useFilters(), { wrapper });

    await act(async () => {
      result.current.set_section('rent');
      result.current.set_filter('zone', 'Chapalita');
      result.current.set_filter('pet_friendly', true);
    });
    expect(result.current.active_filter_count).toBe(2);

    await act(async () => {
      result.current.clear_filters();
    });

    expect(result.current.filters.zone).toBeNull();
    expect(result.current.filters.pet_friendly).toBe(false);
    expect(result.current.section).toBe('rent');
    expect(result.current.filters.operation_types).toEqual(['rent']);
  });

  it('(EC-ST-6) la_seccion_no_cuenta_en_el_badge: solo sección activa → active_filter_count=0', async () => {
    mock_load.mockImplementation(never_resolves);
    const { result } = await renderHook(() => useFilters(), { wrapper });

    expect(result.current.active_filter_count).toBe(0);
    await act(async () => {
      result.current.set_section('rent');
    });
    expect(result.current.active_filter_count).toBe(0);
  });
});
