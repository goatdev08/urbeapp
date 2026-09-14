/**
 * RED — #296.5: caché en memoria por FeedTab (decisión I1, exploración 050 +
 * /tm-plan 296, orquestador 2026-09-14).
 * SUT: mobile/src/features/feed/lib/feedTabCache.ts (nuevo, puro — Map en
 * memoria de módulo, sin AsyncStorage/librería).
 *
 * SEAM bajo test: la firma pública exportada del módulo —
 * `feed_cache_key`, `get_feed_tab_entry`, `set_feed_tab_entry`,
 * `update_feed_tab_scroll`, `neighbor_tabs`, `reset_feed_tab_cache`,
 * `FEED_CACHE_TTL_MS`. Módulo puro: sin mocks de frontera necesarios.
 *
 * Reloj: `now` SIEMPRE se inyecta como argumento explícito a
 * `get_feed_tab_entry` — nunca se lee `Date.now()` real en este archivo
 * (memoria tests_bomba_de_fecha_y_estado_inicial: fijar el reloj en TODOS
 * los casos de tiempo).
 *
 * `reset_feed_tab_cache()` corre en `beforeEach`: cada test parte de caché
 * vacía y el caso de reset (EC-CACHE-18) se prueba DESDE ESTADO POBLADO
 * (memoria reset_solo_se_prueba_desde_estado_poblado) — puebla 2+ tabs y
 * verifica que AMBOS quedan en miss tras el reset, no solo uno.
 *
 * EDGE CASES (RED):
 * ### feed_cache_key — determinismo y sensibilidad a cada campo
 * (EC-CACHE-1)  mismo filters + mismo user_id → misma key (dos llamadas).
 * (EC-CACHE-2)  cambiar price_min → key distinta.
 * (EC-CACHE-3)  cambiar user_id (mismo filters) → key distinta.
 * (EC-CACHE-4)  cambiar SOLO operation_types → MISMA key (lo fija el tab, no
 *               el filtro — el cache_key lo ignora a propósito).
 * (EC-CACHE-5)  cambiar area (zona activa) → key distinta.
 * (EC-CACHE-6)  cambiar radius_m → key distinta.
 * ### get/set — hit, miss, independencia por tab
 * (EC-CACHE-7)  get sin ninguna entrada previa → undefined (miss limpio).
 * (EC-CACHE-8)  set seguido de get con el MISMO tab/filters_key/now dentro
 *               del TTL → devuelve la entrada completa (items/next_cursor/
 *               lap/scroll_index/fetched_at/filters_key) tal cual se guardó.
 * (EC-CACHE-9)  entrada guardada con filters_key A; get con filters_key B
 *               (mismo tab) → miss (undefined), aunque exista una entrada
 *               para ese tab.
 * (EC-CACHE-10) entradas independientes por tab: set en 'venta' y en 'renta'
 *               con la MISMA filters_key → get('venta') y get('renta')
 *               devuelven cada una SUS propios items, sin mezclarse.
 * ### staleness (TTL) — reloj inyectado, boundary exacto
 * (EC-CACHE-11) entrada escrita en fetched_at=T; get con
 *               now = T + FEED_CACHE_TTL_MS (edad EXACTA al TTL, no mayor)
 *               → sigue siendo HIT (la regla es "> TTL", no ">=").
 * (EC-CACHE-12) mismo escenario con now = T + FEED_CACHE_TTL_MS + 1 → MISS.
 * (EC-CACHE-13) tras el miss por staleness (EC-CACHE-12), un get POSTERIOR
 *               con el reloj retrocedido a T (dentro del TTL original)
 *               SIGUE siendo miss — la entrada stale se ELIMINÓ del Map, no
 *               solo se ignoró para esa llamada.
 * ### update_feed_tab_scroll
 * (EC-CACHE-14) con entrada existente, update_feed_tab_scroll cambia
 *               scroll_index; un get posterior (mismo now, dentro del TTL)
 *               lo refleja y el resto de la entrada (items/next_cursor/lap)
 *               queda intacto.
 * (EC-CACHE-15) sin entrada previa para ese tab, update_feed_tab_scroll es
 *               no-op: un get posterior SIGUE en miss (no crea la entrada).
 * ### get no muta (salvo borrar stale)
 * (EC-CACHE-16) dos gets consecutivos (mismo tab/filters_key/now, dentro del
 *               TTL) devuelven el mismo contenido — el primer get no
 *               modifica ni descarta una entrada vigente.
 * ### neighbor_tabs — las 5 adyacencias exactas de FEED_TABS
 * (EC-CACHE-17) para_ti → ['siguiendo'].
 * (EC-CACHE-18) siguiendo → ['para_ti','nuevos'].
 * (EC-CACHE-19) nuevos → ['siguiendo','venta'].
 * (EC-CACHE-20) venta → ['nuevos','renta'].
 * (EC-CACHE-21) renta → ['venta'].
 * ### reset — desde estado poblado
 * (EC-CACHE-22) con 'para_ti' y 'nuevos' pobladas, reset_feed_tab_cache()
 *               deja AMBAS en miss (no solo la primera que se pruebe).
 */

import type { FilterState } from '@/features/search/types';
import { EMPTY_FILTERS } from '@/features/search/lib/filterQuery';

import {
  FEED_CACHE_TTL_MS,
  feed_cache_key,
  get_feed_tab_entry,
  neighbor_tabs,
  reset_feed_tab_cache,
  set_feed_tab_entry,
  update_feed_tab_scroll,
  type FeedTabCacheEntry,
} from '../lib/feedTabCache';
import type { LappedFeedItem } from '../lib/feedKeyExtractor';

function make_property_item(id: string): LappedFeedItem {
  return { kind: 'property', property: { id } as never };
}

function make_entry(overrides: Partial<FeedTabCacheEntry> = {}): FeedTabCacheEntry {
  return {
    items: [make_property_item('p1'), make_property_item('p2')],
    next_cursor: '20',
    lap: 0,
    scroll_index: 0,
    fetched_at: 1_000_000,
    filters_key: 'key-base',
    ...overrides,
  };
}

beforeEach(() => {
  reset_feed_tab_cache();
});

describe('feedTabCache — feed_cache_key', () => {
  it('(EC-CACHE-1) mismo_filters_y_user_id_misma_key: dos llamadas idénticas devuelven la misma key', () => {
    const filters: FilterState = { ...EMPTY_FILTERS, price_min: 5000 };
    expect(feed_cache_key(filters, 'user-1')).toBe(feed_cache_key(filters, 'user-1'));
  });

  it('(EC-CACHE-2) cambiar_price_min_cambia_la_key', () => {
    const base: FilterState = { ...EMPTY_FILTERS, price_min: 5000 };
    const distinta: FilterState = { ...EMPTY_FILTERS, price_min: 9000 };
    expect(feed_cache_key(base, 'user-1')).not.toBe(feed_cache_key(distinta, 'user-1'));
  });

  it('(EC-CACHE-3) cambiar_user_id_cambia_la_key', () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    expect(feed_cache_key(filters, 'user-1')).not.toBe(feed_cache_key(filters, 'user-2'));
  });

  it('(EC-CACHE-4) cambiar_solo_operation_types_no_cambia_la_key: lo fija el tab, no el filtro', () => {
    const venta: FilterState = { ...EMPTY_FILTERS, operation_types: ['sale'] };
    const renta: FilterState = { ...EMPTY_FILTERS, operation_types: ['rent'] };
    expect(feed_cache_key(venta, 'user-1')).toBe(feed_cache_key(renta, 'user-1'));
  });

  it('(EC-CACHE-5) cambiar_area_cambia_la_key: una zona activa distinta es un dataset distinto', () => {
    const sin_zona: FilterState = { ...EMPTY_FILTERS };
    const con_zona: FilterState = {
      ...EMPTY_FILTERS,
      area: { center: { lat: 20.6597, lng: -103.3496 }, radius_m: 1500 },
    };
    expect(feed_cache_key(sin_zona, 'user-1')).not.toBe(feed_cache_key(con_zona, 'user-1'));
  });

  it('(EC-CACHE-6) cambiar_radius_m_cambia_la_key', () => {
    const radio_5km: FilterState = { ...EMPTY_FILTERS, radius_m: 5000 };
    const sin_limite: FilterState = { ...EMPTY_FILTERS, radius_m: null };
    expect(feed_cache_key(radio_5km, 'user-1')).not.toBe(feed_cache_key(sin_limite, 'user-1'));
  });
});

describe('feedTabCache — get/set: hit, miss e independencia por tab', () => {
  it('(EC-CACHE-7) get_sin_entrada_previa_es_miss', () => {
    expect(get_feed_tab_entry('para_ti', 'key-base', 1_000_000)).toBeUndefined();
  });

  it('(EC-CACHE-8) set_y_get_mismo_tab_key_y_now_dentro_del_ttl_es_hit_con_la_entrada_completa', () => {
    const entry = make_entry({ fetched_at: 1_000_000 });
    set_feed_tab_entry('nuevos', entry);

    const hit = get_feed_tab_entry('nuevos', 'key-base', 1_000_000 + 1000);

    expect(hit).toEqual(entry);
  });

  it('(EC-CACHE-9) filters_key_distinta_es_miss_aunque_el_tab_tenga_entrada', () => {
    set_feed_tab_entry('venta', make_entry({ filters_key: 'key-A', fetched_at: 1_000_000 }));

    expect(get_feed_tab_entry('venta', 'key-B', 1_000_000)).toBeUndefined();
  });

  it('(EC-CACHE-10) entradas_independientes_por_tab: set en venta no afecta renta', () => {
    const entry_venta = make_entry({
      items: [make_property_item('venta-1')],
      filters_key: 'misma-key',
      fetched_at: 1_000_000,
    });
    const entry_renta = make_entry({
      items: [make_property_item('renta-1')],
      filters_key: 'misma-key',
      fetched_at: 1_000_000,
    });
    set_feed_tab_entry('venta', entry_venta);
    set_feed_tab_entry('renta', entry_renta);

    expect(get_feed_tab_entry('venta', 'misma-key', 1_000_000)).toEqual(entry_venta);
    expect(get_feed_tab_entry('renta', 'misma-key', 1_000_000)).toEqual(entry_renta);
  });
});

describe('feedTabCache — staleness (TTL), reloj inyectado', () => {
  const FETCHED_AT = 5_000_000;

  it('(EC-CACHE-11) edad_exacta_al_ttl_sigue_siendo_hit: now - fetched_at === FEED_CACHE_TTL_MS', () => {
    set_feed_tab_entry('para_ti', make_entry({ fetched_at: FETCHED_AT }));

    const hit = get_feed_tab_entry('para_ti', 'key-base', FETCHED_AT + FEED_CACHE_TTL_MS);

    expect(hit).not.toBeUndefined();
  });

  it('(EC-CACHE-12) edad_ttl_mas_uno_es_miss: now - fetched_at === FEED_CACHE_TTL_MS + 1', () => {
    set_feed_tab_entry('para_ti', make_entry({ fetched_at: FETCHED_AT }));

    const miss = get_feed_tab_entry('para_ti', 'key-base', FETCHED_AT + FEED_CACHE_TTL_MS + 1);

    expect(miss).toBeUndefined();
  });

  it('(EC-CACHE-13) entrada_stale_se_elimina_no_solo_se_ignora: tras el miss, un get con el reloj retrocedido dentro del TTL original sigue en miss', () => {
    set_feed_tab_entry('para_ti', make_entry({ fetched_at: FETCHED_AT }));

    // Dispara el miss por staleness — debe borrar la entrada del Map.
    expect(get_feed_tab_entry('para_ti', 'key-base', FETCHED_AT + FEED_CACHE_TTL_MS + 1)).toBeUndefined();

    // Reloj "retrocedido": si la entrada solo se hubiera ignorado esa vez,
    // este get (dentro del TTL original) volvería a dar hit. Debe seguir en miss.
    expect(get_feed_tab_entry('para_ti', 'key-base', FETCHED_AT + 1000)).toBeUndefined();
  });
});

describe('feedTabCache — update_feed_tab_scroll', () => {
  it('(EC-CACHE-14) con_entrada_existente_actualiza_scroll_index_y_conserva_el_resto', () => {
    set_feed_tab_entry(
      'siguiendo',
      make_entry({ scroll_index: 0, next_cursor: '30', lap: 2, fetched_at: 1_000_000 }),
    );

    update_feed_tab_scroll('siguiendo', 7);

    const hit = get_feed_tab_entry('siguiendo', 'key-base', 1_000_000);
    expect(hit?.scroll_index).toBe(7);
    expect(hit?.next_cursor).toBe('30');
    expect(hit?.lap).toBe(2);
  });

  it('(EC-CACHE-15) sin_entrada_previa_es_no_op_no_crea_entrada', () => {
    update_feed_tab_scroll('renta', 3);

    expect(get_feed_tab_entry('renta', 'key-base', 1_000_000)).toBeUndefined();
  });
});

describe('feedTabCache — get no muta una entrada vigente', () => {
  it('(EC-CACHE-16) dos_gets_consecutivos_devuelven_el_mismo_contenido', () => {
    const entry = make_entry({ fetched_at: 1_000_000 });
    set_feed_tab_entry('nuevos', entry);

    const first = get_feed_tab_entry('nuevos', 'key-base', 1_000_500);
    const second = get_feed_tab_entry('nuevos', 'key-base', 1_001_000);

    expect(first).toEqual(entry);
    expect(second).toEqual(entry);
  });
});

describe('feedTabCache — neighbor_tabs (adyacencias exactas de FEED_TABS)', () => {
  it('(EC-CACHE-17) para_ti_vecino_siguiendo', () => {
    expect(neighbor_tabs('para_ti')).toEqual(['siguiendo']);
  });
  it('(EC-CACHE-18) siguiendo_vecinos_para_ti_y_nuevos', () => {
    expect(neighbor_tabs('siguiendo')).toEqual(['para_ti', 'nuevos']);
  });
  it('(EC-CACHE-19) nuevos_vecinos_siguiendo_y_venta', () => {
    expect(neighbor_tabs('nuevos')).toEqual(['siguiendo', 'venta']);
  });
  it('(EC-CACHE-20) venta_vecinos_nuevos_y_renta', () => {
    expect(neighbor_tabs('venta')).toEqual(['nuevos', 'renta']);
  });
  it('(EC-CACHE-21) renta_vecino_venta', () => {
    expect(neighbor_tabs('renta')).toEqual(['venta']);
  });
});

describe('feedTabCache — reset_feed_tab_cache (desde estado poblado)', () => {
  it('(EC-CACHE-22) reset_limpia_todos_los_tabs_poblados_no_solo_uno', () => {
    set_feed_tab_entry('para_ti', make_entry({ fetched_at: 1_000_000 }));
    set_feed_tab_entry('nuevos', make_entry({ fetched_at: 1_000_000 }));
    // Estado poblado confirmado ANTES del reset.
    expect(get_feed_tab_entry('para_ti', 'key-base', 1_000_000)).not.toBeUndefined();
    expect(get_feed_tab_entry('nuevos', 'key-base', 1_000_000)).not.toBeUndefined();

    reset_feed_tab_cache();

    expect(get_feed_tab_entry('para_ti', 'key-base', 1_000_000)).toBeUndefined();
    expect(get_feed_tab_entry('nuevos', 'key-base', 1_000_000)).toBeUndefined();
  });
});
