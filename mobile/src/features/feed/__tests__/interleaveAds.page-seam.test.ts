/**
 * RED — #256: dos anuncios consecutivos en la costura entre páginas.
 * SUT: mobile/src/features/feed/lib/interleaveAds.ts
 *
 * Origen (tarea 256, derivada de #247/PR #144, hallazgo agente W3
 * 2026-09-03): el invariante «nunca dos anuncios seguidos» solo se garantiza
 * DENTRO de una llamada. `interleave_ads` siempre arranca `since_last_ad` en
 * `every_n` (o 0 si `skip_first_position`) — nunca sabe cuántas propiedades
 * llevaba la página anterior desde su último anuncio. Si la página 1 cierra
 * con un anuncio (#247, pasada de cierre) y la página 2 es una continuación
 * (`skip_first_position:false`, arranca "due"), su primer ítem puede ser
 * OTRO anuncio — dos anuncios consecutivos en la costura, violando el
 * invariante 3 (`interleaveAds.test.ts`, EC-3) a nivel de FEED COMPLETO
 * aunque cada llamada individual lo respete.
 *
 * SEAM (decisión de este test-author, contrato subespecificado por el
 * orquestador — footprint mínimo, ponytail):
 *
 *   1. `InterleaveAdsOptions` gana un campo opcional `since_last_ad?: number`
 *      — propiedades ya emitidas desde el último anuncio AL CERRAR la página
 *      anterior. Cuando viene presente, SUSTITUYE el arranque por defecto del
 *      contador interno (que hoy es `skip_first_position ? 0 : every_n`),
 *      SIN IMPORTAR el valor de `skip_first_position` — la opción manda
 *      sobre el default derivado de `skip_first_position` (EC-256-4 fija
 *      esta precedencia explícitamente: es la única forma de que una
 *      PRIMERA página real pueda, en teoría, heredar estado, y de que la
 *      costura entre páginas no dependa de adivinar `skip_first_position`
 *      correctamente).
 *   2. Nuevo export `interleave_ads_with_state(properties, ads, opts) =>
 *      { items: FeedItem[]; since_last_ad: number }` — MISMA lógica que
 *      `interleave_ads`, pero también devuelve el valor FINAL del contador
 *      `since_last_ad` al cerrar la página (propiedades emitidas desde el
 *      último anuncio, o 0 si la página cerró con un anuncio en la pasada
 *      de cierre de #247). El hook (`useFeedProperties.ts` ~L292) acumulará
 *      este valor entre páginas y lo pasará como `opts.since_last_ad` en la
 *      siguiente llamada — footprint fuera de este archivo, NO se toca aquí.
 *   3. `interleave_ads` (la función existente) SIGUE devolviendo únicamente
 *      `FeedItem[]` — ningún test existente (`interleaveAds.test.ts`,
 *      `interleaveAds.trailing-ad.test.ts`) cambia de forma; solo gana la
 *      capacidad de leer `opts.since_last_ad` si viene presente.
 *
 * Sin mocks: no hay red, tiempo ni aleatoriedad — misma naturaleza pura que
 * el resto de la suite de `interleave_ads`.
 *
 * EDGE CASES (RED):
 * - (EC-256-1) since_last_ad_cero_hereda_el_cierre_con_anuncio_de_la_pagina_anterior:
 *   página 1 cierra con anuncio (since_last_ad final = 0); página 2 llamada
 *   con `since_last_ad: 0` no trae anuncio en el índice 0, el primero cae
 *   tras `every_n` propiedades — CONTRASTE contra la MISMA llamada sin la
 *   opción, donde sí cae en el índice 0 (comportamiento actual, el bug).
 * - (EC-256-2) since_last_ad_k_desplaza_el_primer_anuncio_de_la_pagina_2_a_every_n_menos_k:
 *   página 1 cierra con k=3 propiedades tras el último anuncio (k < every_n);
 *   página 2 con `since_last_ad: 3` trae su primer anuncio exactamente tras
 *   `every_n - k` = 5 propiedades.
 * - (EC-256-3) sin_la_opcion_el_comportamiento_es_el_actual: sin
 *   `since_last_ad` en opts, `interleave_ads` arranca en `every_n` (o 0 con
 *   `skip_first_position`) — el default de siempre, sin regresión.
 * - (EC-256-4) since_last_ad_manda_sobre_skip_first_position_true: con
 *   `skip_first_position: true` (que por sí solo exigiría `every_n`
 *   propiedades) Y `since_last_ad: 5` presentes, GANA la opción — el primer
 *   anuncio cae tras `every_n - 5` propiedades, no tras `every_n`.
 * - (EC-256-5) since_last_ad_final_es_correcto_al_cerrar_con_anuncio_y_al_cerrar_con_propiedades:
 *   `interleave_ads_with_state` devuelve `since_last_ad: 0` cuando la página
 *   cierra con un anuncio (#247) y `since_last_ad: k` (k=3) cuando cierra con
 *   propiedades sin alcanzar el hueco.
 */

import type { FeedPropertyWithUrl } from '../types';
import {
  interleave_ads,
  interleave_ads_with_state,
  type FeedAd,
  type FeedItem,
  type InterleaveAdsOptions,
} from '../lib/interleaveAds';

// ---------------------------------------------------------------------------
// Factories (snake_case, mismo patrón que interleaveAds.test.ts)
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
    agent_has_phone: true,
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
    creative_id: `creative-${id}`,
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

const count_ads = (result: FeedItem[]): number => result.filter((item) => item.kind === 'ad').length;

const ad_indices = (result: FeedItem[]): number[] =>
  result.flatMap((item, i) => (item.kind === 'ad' ? [i] : []));

// ---------------------------------------------------------------------------
// EC-256-1 — since_last_ad:0 hereda el cierre-con-anuncio de la página 1
// ---------------------------------------------------------------------------

describe('interleave_ads — costura entre páginas: since_last_ad hereda el cierre de la página anterior', () => {
  it('(EC-256-1) since_last_ad_cero_hereda_el_cierre_con_anuncio_de_la_pagina_anterior: sin la opción el índice 0 de la página 2 es anuncio (el bug); con since_last_ad:0 no lo es, y el primero cae tras every_n propiedades', () => {
    const properties_pagina_1 = make_properties(8, 'p1');
    const ads = make_ads(3);
    const opts_pagina_1: InterleaveAdsOptions = {
      every_n: 8,
      max_per_session: 5,
      min_gap_between_repeats: 16,
      already_shown_count: 0,
      skip_first_position: true,
    };

    // Página 1: exactamente every_n propiedades → cierra con UN anuncio
    // (#247, pasada de cierre) y since_last_ad final = 0.
    const pagina_1 = interleave_ads_with_state(properties_pagina_1, ads, opts_pagina_1);
    expect(count_ads(pagina_1.items)).toBe(1);
    expect(pagina_1.since_last_ad).toBe(0);

    const properties_pagina_2 = make_properties(20, 'p2');
    const opts_pagina_2_sin_opcion: InterleaveAdsOptions = {
      every_n: 8,
      max_per_session: 5,
      min_gap_between_repeats: 16,
      already_shown_count: 1,
      skip_first_position: false, // página de continuación — hoy arranca "due"
    };

    // Control: sin la opción, el bug se reproduce — el índice 0 de la
    // página 2 SÍ es un segundo anuncio consecutivo con el de cierre de la
    // página 1 (el defecto que #256 corrige).
    const pagina_2_sin_opcion = interleave_ads(properties_pagina_2, ads, opts_pagina_2_sin_opcion);
    expect(pagina_2_sin_opcion[0]).toEqual({ kind: 'ad', ad: ads[0] });

    // Fijo: con since_last_ad:0 (lo que dejó la página 1), el índice 0 de la
    // página 2 es propiedad, y el primer anuncio cae tras every_n=8 props.
    const opts_pagina_2_con_opcion: InterleaveAdsOptions = {
      ...opts_pagina_2_sin_opcion,
      since_last_ad: pagina_1.since_last_ad,
    };
    const pagina_2_con_opcion = interleave_ads(properties_pagina_2, ads, opts_pagina_2_con_opcion);
    expect(pagina_2_con_opcion[0]!.kind).toBe('property');
    expect(ad_indices(pagina_2_con_opcion)[0]).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// EC-256-2 — since_last_ad:k (0<k<every_n) desplaza el primer anuncio a every_n-k
// ---------------------------------------------------------------------------

describe('interleave_ads — costura entre páginas: since_last_ad:k desplaza el primer anuncio de la página 2', () => {
  it('(EC-256-2) since_last_ad_k_desplaza_el_primer_anuncio_de_la_pagina_2_a_every_n_menos_k: página 1 cierra con k=3 propiedades tras su último anuncio; página 2 trae su primer anuncio exactamente tras every_n-k=5 propiedades', () => {
    // 11 propiedades, every_n=8: anuncio tras la 8ª propiedad (since resetea
    // a 0), luego 3 propiedades más (9,10,11) sin alcanzar el hueco de
    // nuevo → la página cierra con k=3 propiedades desde el último anuncio
    // (sin anuncio de cierre, #247 no aplica porque since_last_ad=3 < 8).
    const properties_pagina_1 = make_properties(11, 'p1');
    const ads = make_ads(3);
    const opts_pagina_1: InterleaveAdsOptions = {
      every_n: 8,
      max_per_session: 5,
      min_gap_between_repeats: 4,
      already_shown_count: 0,
      skip_first_position: true,
    };

    const pagina_1 = interleave_ads_with_state(properties_pagina_1, ads, opts_pagina_1);
    expect(count_ads(pagina_1.items)).toBe(1); // un solo anuncio, no de cierre
    expect(pagina_1.since_last_ad).toBe(3); // k=3

    const properties_pagina_2 = make_properties(20, 'p2');
    const opts_pagina_2: InterleaveAdsOptions = {
      every_n: 8,
      max_per_session: 5,
      min_gap_between_repeats: 4,
      already_shown_count: 1,
      skip_first_position: false,
      since_last_ad: pagina_1.since_last_ad, // 3
    };

    const pagina_2 = interleave_ads(properties_pagina_2, ads, opts_pagina_2);

    // every_n - k = 8 - 3 = 5 propiedades antes del primer anuncio.
    expect(ad_indices(pagina_2)[0]).toBe(5);
    expect(pagina_2.slice(0, 5).every((item) => item.kind === 'property')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EC-256-3 — sin la opción, el comportamiento es el actual (sin regresión)
// ---------------------------------------------------------------------------

describe('interleave_ads — sin since_last_ad en opts, el comportamiento no cambia', () => {
  it('(EC-256-3) sin_la_opcion_el_comportamiento_es_el_actual: interleave_ads_with_state sin since_last_ad arranca EXACTAMENTE igual que interleave_ads hoy (every_n si skip_first_position:false, 0 si true), items idénticos entre ambas funciones', () => {
    const properties = make_properties(20);
    const ads = make_ads(3);
    const opts_primera_pagina: InterleaveAdsOptions = {
      every_n: 8,
      max_per_session: 5,
      min_gap_between_repeats: 16,
      already_shown_count: 0,
      skip_first_position: true,
    };
    const opts_continuacion: InterleaveAdsOptions = { ...opts_primera_pagina, skip_first_position: false };

    const resultado_primera_pagina = interleave_ads_with_state(properties, ads, opts_primera_pagina);
    const resultado_continuacion = interleave_ads_with_state(properties, ads, opts_continuacion);

    // skip_first_position:true (default) → arranca en 0, primer anuncio tras every_n=8.
    expect(ad_indices(resultado_primera_pagina.items)[0]).toBe(8);
    // skip_first_position:false (default) → arranca "due" en every_n, anuncio en el índice 0.
    expect(resultado_continuacion.items[0]).toEqual({ kind: 'ad', ad: ads[0] });

    // La función legado interleave_ads (sin estado) debe seguir devolviendo
    // EXACTAMENTE los mismos items — el nuevo export no es una reescritura
    // paralela con semántica distinta, es la MISMA lógica con una salida
    // adicional.
    expect(interleave_ads(properties, ads, opts_primera_pagina)).toEqual(resultado_primera_pagina.items);
    expect(interleave_ads(properties, ads, opts_continuacion)).toEqual(resultado_continuacion.items);
  });
});

// ---------------------------------------------------------------------------
// EC-256-4 — precedencia: since_last_ad manda sobre skip_first_position:true
// ---------------------------------------------------------------------------

describe('interleave_ads — precedencia: since_last_ad presente manda sobre skip_first_position', () => {
  it('(EC-256-4) since_last_ad_manda_sobre_skip_first_position_true: con skip_first_position:true (que por sí solo exige every_n propiedades) y since_last_ad:5 presentes, el primer anuncio cae tras every_n-5=3 propiedades, NO tras every_n=8', () => {
    const properties = make_properties(10);
    const ads = make_ads(3);
    const opts_sin_opcion: InterleaveAdsOptions = {
      every_n: 8,
      max_per_session: 5,
      min_gap_between_repeats: 4,
      already_shown_count: 0,
      skip_first_position: true,
    };
    const opts_con_opcion: InterleaveAdsOptions = { ...opts_sin_opcion, since_last_ad: 5 };

    const resultado_sin_opcion = interleave_ads(properties, ads, opts_sin_opcion);
    const resultado_con_opcion = interleave_ads(properties, ads, opts_con_opcion);

    // Control: sin la opción, skip_first_position:true exige every_n=8 propiedades.
    expect(ad_indices(resultado_sin_opcion)[0]).toBe(8);
    // Con la opción presente, GANA sobre el default de skip_first_position:
    // solo every_n - since_last_ad = 8 - 5 = 3 propiedades antes del primer anuncio.
    expect(ad_indices(resultado_con_opcion)[0]).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// EC-256-5 — since_last_ad final correcto en ambos cierres de página
// ---------------------------------------------------------------------------

describe('interleave_ads_with_state — since_last_ad final de la página', () => {
  it('(EC-256-5) since_last_ad_final_es_correcto_al_cerrar_con_anuncio_y_al_cerrar_con_propiedades: 0 si la página cierra con anuncio (#247), k si cierra con propiedades sin alcanzar el hueco', () => {
    const ads = make_ads(3);

    // Cierra con anuncio: exactamente every_n=8 propiedades → pasada de
    // cierre de #247 sirve un anuncio y since_last_ad final = 0.
    const opts_cierra_con_anuncio: InterleaveAdsOptions = {
      every_n: 8,
      max_per_session: 5,
      min_gap_between_repeats: 4,
      already_shown_count: 0,
      skip_first_position: true,
    };
    const resultado_cierra_con_anuncio = interleave_ads_with_state(
      make_properties(8, 'a'),
      ads,
      opts_cierra_con_anuncio
    );
    expect(count_ads(resultado_cierra_con_anuncio.items)).toBe(1);
    expect(resultado_cierra_con_anuncio.since_last_ad).toBe(0);

    // Cierra con propiedades: 11 propiedades, every_n=8 → anuncio a mitad de
    // página, luego 3 propiedades más sin alcanzar el hueco de nuevo →
    // since_last_ad final = 3.
    const opts_cierra_con_propiedades: InterleaveAdsOptions = {
      every_n: 8,
      max_per_session: 5,
      min_gap_between_repeats: 4,
      already_shown_count: 0,
      skip_first_position: true,
    };
    const resultado_cierra_con_propiedades = interleave_ads_with_state(
      make_properties(11, 'b'),
      ads,
      opts_cierra_con_propiedades
    );
    expect(count_ads(resultado_cierra_con_propiedades.items)).toBe(1);
    expect(resultado_cierra_con_propiedades.since_last_ad).toBe(3);
  });
});
