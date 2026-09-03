/**
 * feedSection.test.ts — RED (#241.1): la sección del feed (Venta · Renta) como
 * invariante del FilterState.
 *
 * Decisiones (AskUserQuestion 2026-09-02):
 *  - Default: Venta ('sale'). Orden de tabs: Venta, Renta.
 *  - Una sola verdad: la sección ES `filters.operation_types` (exactamente un
 *    valor). El FilterSheet ya no expone «Operación»; feed y mapa la comparten.
 *  - Compatibilidad: un FilterState persistido ANTES de #241 puede traer
 *    operation_types = [] (sin filtro), ['rent','sale'] (ambas) o incluso
 *    ['both'] (nunca fue opción de UI, pero es valor del enum). Todo lo que no
 *    sea exactamente ['rent'] o ['sale'] cae en la sección default.
 *
 * SUT: src/features/search/lib/feedSection.ts
 *   - DEFAULT_FEED_SECTION: FeedSection
 *   - FEED_SECTIONS: { value: FeedSection; label: string }[]
 *   - section_from_filters(filters): FeedSection
 *   - with_section(filters, section): FilterState  (puro, no muta)
 */
import {
  DEFAULT_FEED_SECTION,
  FEED_SECTIONS,
  section_from_filters,
  with_section,
} from '../lib/feedSection';
import { EMPTY_FILTERS } from '../lib/filterQuery';
import type { FilterState } from '../types';

const make_filters = (overrides: Partial<FilterState> = {}): FilterState => ({
  ...EMPTY_FILTERS,
  ...overrides,
});

describe('feedSection — constantes', () => {
  it('(EC-SEC-1) default_es_venta: DEFAULT_FEED_SECTION === "sale"', () => {
    expect(DEFAULT_FEED_SECTION).toBe('sale');
  });

  it('(EC-SEC-2) orden_y_labels: FEED_SECTIONS = [Venta(sale), Renta(rent)] en ese orden', () => {
    expect(FEED_SECTIONS).toEqual([
      { value: 'sale', label: 'Venta' },
      { value: 'rent', label: 'Renta' },
    ]);
  });
});

describe('section_from_filters', () => {
  it('(EC-SEC-3) vacio_cae_en_default: operation_types=[] (persistido pre-#241) → "sale"', () => {
    expect(section_from_filters(make_filters({ operation_types: [] }))).toBe('sale');
  });

  it('(EC-SEC-4) rent_exacto: operation_types=["rent"] → "rent"', () => {
    expect(section_from_filters(make_filters({ operation_types: ['rent'] }))).toBe('rent');
  });

  it('(EC-SEC-5) sale_exacto: operation_types=["sale"] → "sale"', () => {
    expect(section_from_filters(make_filters({ operation_types: ['sale'] }))).toBe('sale');
  });

  it('(EC-SEC-6) ambas_legacy_cae_en_default: operation_types=["rent","sale"] (sheet viejo) → "sale"', () => {
    expect(section_from_filters(make_filters({ operation_types: ['rent', 'sale'] }))).toBe('sale');
  });

  it('(EC-SEC-7) both_no_es_seccion: operation_types=["both"] → "sale" (both es valor de dato, no de UI)', () => {
    expect(section_from_filters(make_filters({ operation_types: ['both'] }))).toBe('sale');
  });

  it('(EC-SEC-8) basura_cae_en_default: operation_types=["lease"] → "sale"', () => {
    expect(section_from_filters(make_filters({ operation_types: ['lease'] }))).toBe('sale');
  });
});

describe('with_section', () => {
  it('(EC-SEC-9) fija_exactamente_un_valor: with_section(f, "rent").operation_types → ["rent"]', () => {
    const out = with_section(make_filters({ operation_types: ['rent', 'sale'] }), 'rent');
    expect(out.operation_types).toEqual(['rent']);
  });

  it('(EC-SEC-10) no_toca_el_resto: zone/price/booleanos/area/radius quedan idénticos', () => {
    const area = { center: { lat: 20.67, lng: -103.35 }, radius_m: 3000 };
    const input = make_filters({ zone: 'Chapalita', price_max: 20000, pet_friendly: true, area, radius_m: 5000 });
    const out = with_section(input, 'sale');
    expect(out).toEqual({ ...input, operation_types: ['sale'] });
    expect(out.area).toBe(area);
  });

  it('(EC-SEC-11) es_puro: no muta el FilterState de entrada', () => {
    const input = make_filters({ operation_types: [] });
    const frozen = Object.freeze({ ...input, operation_types: Object.freeze([]) as unknown as string[] });
    const out = with_section(frozen as FilterState, 'rent');
    expect(frozen.operation_types).toEqual([]);
    expect(out).not.toBe(frozen);
  });

  it('(EC-SEC-12) round_trip: section_from_filters(with_section(f, s)) === s para ambas secciones', () => {
    for (const s of ['sale', 'rent'] as const) {
      expect(section_from_filters(with_section(make_filters(), s))).toBe(s);
    }
  });
});
