/**
 * Tests fase RED — interleaveAds (lib pura)
 * Archivo SUT: mobile/src/features/feed/lib/interleaveAds.ts
 * Subtarea Taskmaster: 170.3 — interleaveAds.ts: función PURA con 8
 * invariantes (dependencia declarada: 170.1 app_config sembrada,
 * 170.2 RPC ads_for_zone).
 *
 * SUT:
 *   interleave_ads(properties: FeedPropertyWithUrl[], ads: FeedAd[], opts: InterleaveAdsOptions) => FeedItem[]
 *
 * SEAM: la firma exportada de interleave_ads (función pura de mobile/src/features/feed/lib/interleaveAds.ts).
 * No hay networking ni estado — properties/ads YA vienen resueltos por el caller
 * (170.4 los arma desde useFeedProperties + ads_for_zone).
 *
 * DECISIÓN DE SEAM tomada por este test-author (contrato subespecificado por
 * el orquestador, fijada aquí porque `skip_first_position` no tenía semántica
 * exacta más allá del nombre): `skip_first_position` decide si el invariante
 * "nunca anuncio en la posición 0" aplica a ESTA llamada.
 *   - true  (primera página real del feed, posición 0 de la llamada ES la
 *     posición 0 global): se exige `every_n` propiedades antes del primer
 *     anuncio, igual que cualquier otro anuncio.
 *   - false (página de continuación: el índice 0 de este array NO es la
 *     posición 0 del feed completo): el primer anuncio puede caer en el
 *     índice 0 si ya está "due" -- por eso con every_n=1 y skip_first_position
 *     false el índice 0 puede ser el anuncio directamente (ver EC-16).
 * Los demás 7 invariantes son incondicionales (no dependen de ningún opt).
 *
 * EDGE CASES CUBIERTOS (17 casos):
 *
 * ### Los 8 invariantes (uno por bloque, salvo el 6 con 3 sub-casos)
 * - (EC-1)  invariante 1 — ads_vacio_devuelve_la_misma_lista_de_propiedades
 * - (EC-2)  invariante 2 — nunca_hay_anuncio_en_posicion_0_con_skip_first_position_true
 * - (EC-3)  invariante 3 — nunca_dos_anuncios_consecutivos
 * - (EC-4)  invariante 4 — con_every_n_8_hay_al_menos_8_propiedades_entre_dos_anuncios_consecutivos
 * - (EC-5)  invariante 5 — un_solo_anuncio_elegible_no_se_repite_antes_del_min_gap_aunque_sea_el_unico
 * - (EC-6)  invariante 6a — el_cap_de_sesion_se_alcanza_exacto_cuando_hay_cupo_de_sobra
 * - (EC-7)  invariante 6b — cap_de_sesion_respeta_el_presupuesto_restante_de_paginas_previas
 * - (EC-8)  invariante 6c — already_shown_count_igual_al_cap_produce_cero_anuncios_nuevos
 * - (EC-9)  invariante 7a — cambiar_every_n_en_opts_cambia_el_espaciado_sin_recompilar
 * - (EC-10) invariante 7b — cambiar_max_per_session_en_opts_cambia_el_tope_sin_recompilar
 * - (EC-11) invariante 8a — misma_entrada_misma_salida_sin_mocks_de_tiempo_ni_random
 * - (EC-12) invariante 8b — no_muta_los_arrays_de_entrada
 *
 * ### Casos adicionales (pedidos explícitamente además de los 8 invariantes)
 * - (EC-13) inventario_insuficiente_solo_usa_ids_del_pool_disponible_y_nunca_lanza
 * - (EC-14) lista_de_propiedades_vacia_devuelve_lista_vacia_incluso_con_ads_disponibles
 * - (EC-15) paginas_sucesivas_el_cap_global_se_respeta_entre_llamadas
 * - (EC-16) skip_first_position_false_permite_anuncio_en_la_posicion_0
 * - (EC-17) lista_de_propiedades_mas_corta_que_every_n_no_inserta_ningun_anuncio
 */

import type { FeedPropertyWithUrl } from '../types';
import { interleave_ads, type FeedAd, type FeedItem, type InterleaveAdsOptions } from '../lib/interleaveAds';

// ---------------------------------------------------------------------------
// Factories (snake_case, patrón del repo)
// ---------------------------------------------------------------------------

function make_property(id: string): FeedPropertyWithUrl {
  return {
    id,
    price: 1_650_000,
    operation_type: 'venta',
    property_type: 'departamento',
    currency: 'MXN',
    price_visible: true,
    address: `Calle Falsa 123, colonia de prueba (${id})`,
    bedrooms: 2,
    bathrooms: 1,
    owner_user_id: 'user-owner-uuid',
    agency_id: null,
    created_at: '2026-08-01T00:00:00.000Z',
    agent_phone: '3312345678',
    agent_name: 'Agente de Prueba',
    agent_photo_url: null,
    video: {
      id: `video-${id}`,
      storage_path: `videos/${id}.mp4`,
      position: 0,
      thumbnail_url: null,
    },
    signed_url: `https://cdn.example.com/${id}/signed`,
    video_id: `video-${id}`,
    posterUrl: null,
  };
}

function make_properties(n: number, prefix = 'prop'): FeedPropertyWithUrl[] {
  return Array.from({ length: n }, (_, i) => make_property(`${prefix}-${i + 1}`));
}

function make_ad(id: string): FeedAd {
  return {
    id,
    title: `Anuncio ${id}`,
    description: `Descripción del anuncio ${id}`,
    cta_type: 'external_url',
    cta_value: 'https://example.com',
    cloudflare_uid: `cf-${id}`,
    agency_name: 'Inmobiliaria de Prueba',
    agency_logo_url: null,
  };
}

function make_ads(n: number, prefix = 'ad'): FeedAd[] {
  return Array.from({ length: n }, (_, i) => make_ad(`${prefix}-${i + 1}`));
}

const BASE_OPTS: InterleaveAdsOptions = {
  every_n: 8,
  max_per_session: 5,
  min_gap_between_repeats: 16,
  already_shown_count: 0,
  skip_first_position: true,
};

// ---------------------------------------------------------------------------
// Helpers de inspección del resultado (estructurales -- NO reimplementan la
// lógica de colocación del SUT, solo leen el array ya producido)
// ---------------------------------------------------------------------------

function count_ads(result: FeedItem[]): number {
  return result.filter((item) => item.kind === 'ad').length;
}

function ad_indices(result: FeedItem[]): number[] {
  const out: number[] = [];
  result.forEach((item, i) => {
    if (item.kind === 'ad') out.push(i);
  });
  return out;
}

function ad_id_at(result: FeedItem[], i: number): string {
  const item = result[i]!;
  if (item.kind !== 'ad') throw new Error(`item ${i} no es un anuncio`);
  return item.ad.id;
}

// ---------------------------------------------------------------------------
// EC-1 — invariante 1: con ads=[] devuelve LA MISMA lista
// ---------------------------------------------------------------------------

describe('interleave_ads — invariante 1: fail-soft con ads=[]', () => {
  it('(EC-1) ads_vacio_devuelve_la_misma_lista_de_propiedades: mismo orden, misma longitud, mismos items', () => {
    const properties = make_properties(12);

    const result = interleave_ads(properties, [], BASE_OPTS);

    expect(result).toEqual(properties.map((property) => ({ kind: 'property', property })));
  });
});

// ---------------------------------------------------------------------------
// EC-2 — invariante 2: nunca posición 0 (skip_first_position=true)
// ---------------------------------------------------------------------------

describe('interleave_ads — invariante 2: nunca anuncio en la posición 0', () => {
  it('(EC-2) nunca_hay_anuncio_en_posicion_0_con_skip_first_position_true: index 0 siempre es property, pero SÍ hay anuncios más adelante', () => {
    const properties = make_properties(30);
    const ads = make_ads(3);

    const result = interleave_ads(properties, ads, BASE_OPTS);

    // ausencia
    expect(result[0]!.kind).toBe('property');
    // presencia sobre el MISMO resultado -- 30 propiedades / every_n=8 alcanza
    // para al menos 3 huecos (posiciones ~8, ~17, ~26), así que el checador
    // de arriba no es vacuo: si nunca hubiera anuncios, esto fallaría.
    expect(count_ads(result)).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// EC-3 — invariante 3: nunca dos anuncios consecutivos
// ---------------------------------------------------------------------------

describe('interleave_ads — invariante 3: nunca dos anuncios consecutivos', () => {
  it('(EC-3) nunca_dos_anuncios_consecutivos: ningún índice de anuncio es seguido inmediatamente por otro anuncio', () => {
    const properties = make_properties(50);
    const ads = make_ads(5);

    const result = interleave_ads(properties, ads, { ...BASE_OPTS, max_per_session: 5 });

    const indices = ad_indices(result);
    // presencia -- hay más de un anuncio, si no la comprobación de abajo sería vacua
    expect(indices.length).toBeGreaterThanOrEqual(2);

    for (let k = 0; k < indices.length - 1; k++) {
      expect(indices[k + 1]! - indices[k]!).toBeGreaterThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// EC-4 — invariante 4: >= every_n propiedades entre dos anuncios
// ---------------------------------------------------------------------------

describe('interleave_ads — invariante 4: >= every_n propiedades entre dos anuncios', () => {
  it('(EC-4) con_every_n_8_hay_al_menos_8_propiedades_entre_dos_anuncios_consecutivos', () => {
    const properties = make_properties(40);
    const ads = make_ads(5);
    const opts: InterleaveAdsOptions = { ...BASE_OPTS, every_n: 8, max_per_session: 10, min_gap_between_repeats: 16 };

    const result = interleave_ads(properties, ads, opts);

    const indices = ad_indices(result);
    // presencia -- 40 propiedades / every_n=8 da hueco para varios anuncios
    expect(indices.length).toBeGreaterThanOrEqual(2);

    for (let k = 0; k < indices.length - 1; k++) {
      const between = result.slice(indices[k]! + 1, indices[k + 1]!);
      expect(between.length).toBeGreaterThanOrEqual(8);
      expect(between.every((item) => item.kind === 'property')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// EC-5 — invariante 5: no repetir antes de min_gap_between_repeats, ni
// siquiera cuando es el único anuncio elegible
// ---------------------------------------------------------------------------

describe('interleave_ads — invariante 5: el mismo anuncio no se repite antes de min_gap_between_repeats items', () => {
  it('(EC-5) un_solo_anuncio_elegible_no_se_repite_antes_del_min_gap_aunque_sea_el_unico: distancia entre apariciones consecutivas >= 16', () => {
    const properties = make_properties(120);
    const single_ad = make_ad('unico');
    // max_per_session generoso a propósito: el gap es la ÚNICA restricción
    // que puede impedir la repetición aquí (si no existiera la regla, con un
    // solo ad disponible y cupo de sobra se repetiría en CADA hueco de
    // every_n=8, mucho antes de 16 items).
    const opts: InterleaveAdsOptions = {
      every_n: 8,
      max_per_session: 10,
      min_gap_between_repeats: 16,
      already_shown_count: 0,
      skip_first_position: true,
    };

    const result = interleave_ads(properties, [single_ad], opts);

    const occurrences = ad_indices(result);
    // presencia -- con 120 propiedades el único ad SÍ debe repetirse más de
    // una vez (si no, la comprobación del gap de abajo sería vacua)
    expect(occurrences.length).toBeGreaterThanOrEqual(2);

    for (let k = 0; k < occurrences.length - 1; k++) {
      expect(occurrences[k + 1]! - occurrences[k]!).toBeGreaterThanOrEqual(16);
    }
  });
});

// ---------------------------------------------------------------------------
// EC-6, EC-7, EC-8 — invariante 6: cap de sesión A TRAVÉS de páginas
// ---------------------------------------------------------------------------

describe('interleave_ads — invariante 6: nunca más de max_per_session anuncios por sesión', () => {
  it('(EC-6) el_cap_de_sesion_se_alcanza_exacto_cuando_hay_cupo_de_sobra: 200 propiedades / every_n=4 sobran huecos, pero el resultado trae EXACTAMENTE max_per_session=5 anuncios', () => {
    const properties = make_properties(200);
    const ads = make_ads(5);
    const opts: InterleaveAdsOptions = {
      every_n: 4,
      max_per_session: 5,
      min_gap_between_repeats: 8,
      already_shown_count: 0,
      skip_first_position: true,
    };

    const result = interleave_ads(properties, ads, opts);

    expect(count_ads(result)).toBe(5);
  });

  it('(EC-7) cap_de_sesion_respeta_el_presupuesto_restante_de_paginas_previas: already_shown_count=4 (1 de presupuesto) sobre el mismo escenario sobrado produce EXACTAMENTE 1 anuncio nuevo', () => {
    const properties = make_properties(200);
    const ads = make_ads(5);
    const opts: InterleaveAdsOptions = {
      every_n: 4,
      max_per_session: 5,
      min_gap_between_repeats: 8,
      already_shown_count: 4,
      skip_first_position: true,
    };

    const result = interleave_ads(properties, ads, opts);

    expect(count_ads(result)).toBe(1);
  });

  it('(EC-8) already_shown_count_igual_al_cap_produce_cero_anuncios_nuevos: con already_shown_count=5=max_per_session, CERO anuncios, aunque el MISMO escenario con presupuesto en 0 sí produce anuncios', () => {
    const properties = make_properties(200);
    const ads = make_ads(5);
    const opts_sin_presupuesto: InterleaveAdsOptions = {
      every_n: 4,
      max_per_session: 5,
      min_gap_between_repeats: 8,
      already_shown_count: 5,
      skip_first_position: true,
    };
    const opts_con_presupuesto_lleno: InterleaveAdsOptions = { ...opts_sin_presupuesto, already_shown_count: 0 };

    const result_sin_presupuesto = interleave_ads(properties, ads, opts_sin_presupuesto);
    const result_con_presupuesto = interleave_ads(properties, ads, opts_con_presupuesto_lleno);

    expect(count_ads(result_sin_presupuesto)).toBe(0);
    // presencia sobre el MISMO escenario -- si el checador de arriba fuera
    // vacuo (0 anuncios siempre, cap o no), esto lo cazaría.
    expect(count_ads(result_con_presupuesto)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// EC-9, EC-10 — invariante 7: every_n y el cap vienen de opts, no son constantes
// ---------------------------------------------------------------------------

describe('interleave_ads — invariante 7: every_n y max_per_session se leen de opts, no son constantes fijas', () => {
  it('(EC-9) cambiar_every_n_en_opts_cambia_el_espaciado_sin_recompilar: every_n=2 (apretado) produce MÁS anuncios que every_n=10 (holgado) sobre el mismo inventario', () => {
    const properties = make_properties(30);
    const ads = make_ads(5);
    const opts_apretado: InterleaveAdsOptions = {
      every_n: 2,
      max_per_session: 10,
      min_gap_between_repeats: 2,
      already_shown_count: 0,
      skip_first_position: true,
    };
    const opts_holgado: InterleaveAdsOptions = { ...opts_apretado, every_n: 10 };

    const result_apretado = interleave_ads(properties, ads, opts_apretado);
    const result_holgado = interleave_ads(properties, ads, opts_holgado);

    expect(count_ads(result_apretado)).toBeGreaterThan(count_ads(result_holgado));
  });

  it('(EC-10) cambiar_max_per_session_en_opts_cambia_el_tope_sin_recompilar: max_per_session=1 da EXACTAMENTE 1 anuncio, max_per_session=4 da EXACTAMENTE 4, sobre el mismo inventario sobrado (nunca los 5 "de siempre")', () => {
    const properties = make_properties(100);
    const ads = make_ads(5);
    const opts_base: InterleaveAdsOptions = {
      every_n: 2,
      max_per_session: 1,
      min_gap_between_repeats: 2,
      already_shown_count: 0,
      skip_first_position: true,
    };

    const result_tope_1 = interleave_ads(properties, ads, opts_base);
    const result_tope_4 = interleave_ads(properties, ads, { ...opts_base, max_per_session: 4 });

    expect(count_ads(result_tope_1)).toBe(1);
    expect(count_ads(result_tope_4)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// EC-11, EC-12 — invariante 8: determinismo, sin mocks de tiempo/random
// ---------------------------------------------------------------------------

describe('interleave_ads — invariante 8: determinista, sin mocks de tiempo ni de random', () => {
  it('(EC-11) misma_entrada_misma_salida_sin_mocks_de_tiempo_ni_random: dos llamadas con los mismos argumentos devuelven resultados idénticos', () => {
    const properties = make_properties(20);
    const ads = make_ads(3);

    const first_call = interleave_ads(properties, ads, BASE_OPTS);
    const second_call = interleave_ads(properties, ads, BASE_OPTS);

    expect(second_call).toEqual(first_call);
  });

  it('(EC-12) no_muta_los_arrays_de_entrada: properties y ads quedan exactamente igual después de llamar la función', () => {
    const properties = make_properties(10);
    const ads = make_ads(2);
    const properties_snapshot = JSON.parse(JSON.stringify(properties));
    const ads_snapshot = JSON.parse(JSON.stringify(ads));

    interleave_ads(properties, ads, BASE_OPTS);

    expect(properties).toEqual(properties_snapshot);
    expect(ads).toEqual(ads_snapshot);
  });
});

// ---------------------------------------------------------------------------
// EC-13 — inventario insuficiente
// ---------------------------------------------------------------------------

describe('interleave_ads — inventario insuficiente (menos ads que huecos disponibles)', () => {
  it('(EC-13) inventario_insuficiente_solo_usa_ids_del_pool_disponible_y_nunca_lanza: con solo 2 ads distintos, todo anuncio insertado pertenece a ese pool de 2, sin lanzar', () => {
    const properties = make_properties(150);
    const scarce_ads = make_ads(2, 'escaso');
    const opts: InterleaveAdsOptions = {
      every_n: 8,
      max_per_session: 10,
      min_gap_between_repeats: 16,
      already_shown_count: 0,
      skip_first_position: true,
    };
    const allowed_ids = new Set(scarce_ads.map((ad) => ad.id));

    let result: FeedItem[] = [];
    expect(() => {
      result = interleave_ads(properties, scarce_ads, opts);
    }).not.toThrow();

    const inserted_ids = ad_indices(result).map((i) => ad_id_at(result, i));
    // presencia -- con 150 propiedades y every_n=8 sí caben anuncios del pool
    expect(inserted_ids.length).toBeGreaterThan(0);
    expect(inserted_ids.every((id) => allowed_ids.has(id))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EC-14 — lista de propiedades vacía
// ---------------------------------------------------------------------------

describe('interleave_ads — lista de propiedades vacía', () => {
  it('(EC-14) lista_de_propiedades_vacia_devuelve_lista_vacia_incluso_con_ads_disponibles: sin propiedades no hay dónde intercalar, el resultado es []', () => {
    const ads = make_ads(3);

    const result = interleave_ads([], ads, BASE_OPTS);

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// EC-15 — páginas sucesivas
// ---------------------------------------------------------------------------

describe('interleave_ads — páginas sucesivas (already_shown_count acumulado entre llamadas)', () => {
  it('(EC-15) paginas_sucesivas_el_cap_global_se_respeta_entre_llamadas: la página 1 agota el cap (5) y la página 2, alimentada con ese conteo real, no trae NINGÚN anuncio nuevo', () => {
    const ads = make_ads(5);
    const opts_pagina_1: InterleaveAdsOptions = {
      every_n: 4,
      max_per_session: 5,
      min_gap_between_repeats: 8,
      already_shown_count: 0,
      skip_first_position: true,
    };
    const properties_pagina_1 = make_properties(60, 'p1');
    const properties_pagina_2 = make_properties(60, 'p2');

    const result_pagina_1 = interleave_ads(properties_pagina_1, ads, opts_pagina_1);
    const anuncios_mostrados_pagina_1 = count_ads(result_pagina_1);
    // el escenario está sobrado a propósito -- 60 props / every_n=4 da 15
    // huecos, mucho más que el cap de 5, así que la página 1 debió agotarlo.
    expect(anuncios_mostrados_pagina_1).toBe(5);

    const opts_pagina_2: InterleaveAdsOptions = {
      ...opts_pagina_1,
      already_shown_count: anuncios_mostrados_pagina_1,
      skip_first_position: false,
    };
    const result_pagina_2 = interleave_ads(properties_pagina_2, ads, opts_pagina_2);

    expect(count_ads(result_pagina_2)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// EC-16 — skip_first_position en ambos valores (false)
// ---------------------------------------------------------------------------

describe('interleave_ads — skip_first_position=false permite anuncio en la posición 0', () => {
  it('(EC-16) skip_first_position_false_permite_anuncio_en_la_posicion_0: con every_n=1, skip_first_position=true pone property en 0 y false pone el anuncio directo en 0', () => {
    const properties = make_properties(5);
    const single_ad = make_ad('continuacion');
    const opts_primera_pagina: InterleaveAdsOptions = {
      every_n: 1,
      max_per_session: 5,
      min_gap_between_repeats: 2,
      already_shown_count: 0,
      skip_first_position: true,
    };
    const opts_pagina_continuacion: InterleaveAdsOptions = { ...opts_primera_pagina, skip_first_position: false };

    const result_primera_pagina = interleave_ads(properties, [single_ad], opts_primera_pagina);
    const result_continuacion = interleave_ads(properties, [single_ad], opts_pagina_continuacion);

    expect(result_primera_pagina[0]!.kind).toBe('property');
    expect(result_continuacion[0]).toEqual({ kind: 'ad', ad: single_ad });
  });
});

// ---------------------------------------------------------------------------
// EC-17 — lista de propiedades más corta que every_n
// ---------------------------------------------------------------------------

describe('interleave_ads — lista de propiedades más corta que every_n', () => {
  it('(EC-17) lista_de_propiedades_mas_corta_que_every_n_no_inserta_ningun_anuncio: con solo 5 propiedades y every_n=8 nunca se completa el hueco, CERO anuncios; con 10 propiedades (>= every_n) el MISMO pool de ads SÍ entra', () => {
    const ads = make_ads(3);
    const opts = BASE_OPTS; // every_n: 8

    const properties_cortas = make_properties(5);
    const result_corto = interleave_ads(properties_cortas, ads, opts);
    expect(result_corto).toEqual(properties_cortas.map((property) => ({ kind: 'property', property })));

    // presencia -- el MISMO pool de ads con opts idénticos SÍ produce
    // anuncios cuando hay propiedades suficientes, así que el resultado
    // vacío de arriba es por el largo insuficiente, no porque la función
    // esté rota para todo.
    const properties_suficientes = make_properties(10);
    const result_suficiente = interleave_ads(properties_suficientes, ads, opts);
    expect(count_ads(result_suficiente)).toBeGreaterThan(0);
  });
});
