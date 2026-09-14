/**
 * feedSection.test.ts — RED (#296.3): el chrome superior del feed pasa de 2
 * secciones (Venta·Renta, atadas a `filters.operation_types`) a 5 TABS
 * (Para ti · Siguiendo · Nuevos · Venta · Renta) sobre un estado PROPIO
 * `feed_tab`, separado de FilterState (exploración 050 + plan 296).
 *
 * Decisión de producto (Abraham, /tm-plan 2026-09-14):
 *  - El eje de fuente (feed_tab) NUNCA entra en FilterState — el mapa solo
 *    lee `filters.operation_types` derivado vía operation_types_for_tab.
 *  - Default: 'para_ti'. Orden de tabs: Para ti, Siguiendo, Nuevos, Venta, Renta.
 *  - Para ti / Siguiendo / Nuevos son tabs de FUENTE (no de operación): las
 *    tres muestran ambas operaciones ['sale','rent']. Venta/Renta siguen
 *    fijando la operación como antes (#241), ahora sobre el tab, no sobre
 *    FilterState directamente.
 *
 * SUT: src/features/search/lib/feedSection.ts
 *   - FeedTab (type), DEFAULT_FEED_TAB, FEED_TABS
 *   - is_feed_tab(value): type guard
 *   - operation_types_for_tab(tab): string[] (NUEVO array cada llamada)
 *   - with_tab(filters, tab): FilterState (puro, no muta)
 *
 * NOTA: FeedSection/FEED_SECTIONS/DEFAULT_FEED_SECTION/section_from_filters/
 * with_section quedan OBSOLETOS por este cambio (GREEN los elimina). Este
 * archivo YA NO los ejercita.
 */
import {
  DEFAULT_FEED_TAB,
  FEED_TABS,
  is_feed_tab,
  operation_types_for_tab,
  with_tab,
  type FeedTab,
} from '../lib/feedSection';
import { EMPTY_FILTERS } from '../lib/filterQuery';
import type { FilterState } from '../types';

const make_filters = (overrides: Partial<FilterState> = {}): FilterState => ({
  ...EMPTY_FILTERS,
  ...overrides,
});

describe('feedSection — constantes', () => {
  it('(EC-SEC-1) default_es_para_ti: DEFAULT_FEED_TAB === "para_ti"', () => {
    expect(DEFAULT_FEED_TAB).toBe('para_ti');
  });

  it('(EC-SEC-2) orden_y_labels: FEED_TABS = [Para ti, Siguiendo, Nuevos, Venta, Renta] en ese orden exacto', () => {
    expect(FEED_TABS).toEqual([
      { value: 'para_ti', label: 'Para ti' },
      { value: 'siguiendo', label: 'Siguiendo' },
      { value: 'nuevos', label: 'Nuevos' },
      { value: 'venta', label: 'Venta' },
      { value: 'renta', label: 'Renta' },
    ]);
  });
});

describe('is_feed_tab — type guard', () => {
  it.each([['para_ti'], ['siguiendo'], ['nuevos'], ['venta'], ['renta']] as const)(
    '(EC-SEC-3.%#) acepta_los_5_valores_validos: is_feed_tab(%s) → true',
    (value) => {
      expect(is_feed_tab(value)).toBe(true);
    },
  );

  it('(EC-SEC-4) rechaza_valor_legacy_sale: is_feed_tab("sale") → false', () => {
    expect(is_feed_tab('sale')).toBe(false);
  });

  it('(EC-SEC-5) rechaza_string_vacio: is_feed_tab("") → false', () => {
    expect(is_feed_tab('')).toBe(false);
  });

  it('(EC-SEC-6) rechaza_null: is_feed_tab(null) → false', () => {
    expect(is_feed_tab(null)).toBe(false);
  });

  it('(EC-SEC-7) rechaza_numero: is_feed_tab(1) → false', () => {
    expect(is_feed_tab(1)).toBe(false);
  });

  it('(EC-SEC-8) rechaza_mayusculas: is_feed_tab("PARA_TI") → false (sensible a mayúsculas)', () => {
    expect(is_feed_tab('PARA_TI')).toBe(false);
  });

  it('(EC-SEC-9) rechaza_undefined: is_feed_tab(undefined) → false', () => {
    expect(is_feed_tab(undefined)).toBe(false);
  });
});

describe('operation_types_for_tab', () => {
  it('(EC-SEC-10) venta_fija_sale: operation_types_for_tab("venta") → ["sale"]', () => {
    expect(operation_types_for_tab('venta')).toEqual(['sale']);
  });

  it('(EC-SEC-11) renta_fija_rent: operation_types_for_tab("renta") → ["rent"]', () => {
    expect(operation_types_for_tab('renta')).toEqual(['rent']);
  });

  it.each([['para_ti'], ['siguiendo'], ['nuevos']] as const)(
    '(EC-SEC-12.%#) tabs_de_fuente_muestran_ambas_operaciones: operation_types_for_tab(%s) → ["sale","rent"]',
    (tab) => {
      expect(operation_types_for_tab(tab)).toEqual(['sale', 'rent']);
    },
  );

  it('(EC-SEC-13) no_comparte_referencia_entre_llamadas: dos llamadas con el mismo tab devuelven arrays distintos', () => {
    const a = operation_types_for_tab('para_ti');
    const b = operation_types_for_tab('para_ti');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('(EC-SEC-14) mutar_el_resultado_no_afecta_la_siguiente_llamada: empujar al array devuelto no contamina llamadas futuras', () => {
    const first = operation_types_for_tab('venta');
    first.push('rent');
    expect(operation_types_for_tab('venta')).toEqual(['sale']);
  });
});

describe('with_tab', () => {
  it('(EC-SEC-15) fija_operation_types_segun_el_tab: with_tab(f, "renta").operation_types → ["rent"]', () => {
    const out = with_tab(make_filters({ operation_types: ['sale'] }), 'renta');
    expect(out.operation_types).toEqual(['rent']);
  });

  it('(EC-SEC-16) para_ti_fija_ambas_operaciones: with_tab(f, "para_ti").operation_types → ["sale","rent"]', () => {
    const out = with_tab(make_filters({ operation_types: ['rent'] }), 'para_ti');
    expect(out.operation_types).toEqual(['sale', 'rent']);
  });

  it('(EC-SEC-17) no_toca_el_resto: zone/price/booleanos/area/radius quedan idénticos', () => {
    const area = { center: { lat: 20.67, lng: -103.35 }, radius_m: 3000 };
    const input = make_filters({
      zone: 'Chapalita',
      price_max: 20000,
      pet_friendly: true,
      area,
      radius_m: 5000,
    });
    const out = with_tab(input, 'venta');
    expect(out).toEqual({ ...input, operation_types: ['sale'] });
    expect(out.area).toBe(area);
  });

  it('(EC-SEC-18) es_puro: no muta el FilterState de entrada', () => {
    const input = make_filters({ operation_types: ['sale'] });
    const frozen = Object.freeze({
      ...input,
      operation_types: Object.freeze(['sale']) as unknown as string[],
    });
    const out = with_tab(frozen as FilterState, 'renta');
    expect(frozen.operation_types).toEqual(['sale']);
    expect(out).not.toBe(frozen);
  });

  it('(EC-SEC-19) round_trip_para_venta_y_renta: operation_types de with_tab(f, tab) coincide con operation_types_for_tab(tab)', () => {
    for (const tab of ['venta', 'renta'] as const) {
      expect(with_tab(make_filters(), tab).operation_types).toEqual(operation_types_for_tab(tab));
    }
  });

  it('(EC-SEC-20) el_eje_de_fuente_nunca_entra_a_filterstate: with_tab no agrega ninguna key nueva al FilterState (solo re-escribe operation_types)', () => {
    const input = make_filters();
    const out = with_tab(input, 'siguiendo') as unknown as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(Object.keys(input).sort());
  });
});

describe('FeedTab — tipo', () => {
  it('(EC-SEC-21) los_5_values_de_feed_tabs_son_feed_tab_validos: cada FEED_TABS[i].value pasa is_feed_tab', () => {
    const values = FEED_TABS.map((t) => t.value) as FeedTab[];
    expect(values.every((v) => is_feed_tab(v))).toBe(true);
    expect(values).toEqual(['para_ti', 'siguiendo', 'nuevos', 'venta', 'renta']);
  });
});
