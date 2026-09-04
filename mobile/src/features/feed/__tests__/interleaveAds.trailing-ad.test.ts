/**
 * RED — #247: insertar el anuncio al FINAL de la página cuando ya tocaba.
 * SUT: mobile/src/features/feed/lib/interleaveAds.ts
 *
 * 170.3 solo empuja el anuncio al ENCONTRAR la siguiente propiedad (el push
 * vive dentro del `for (const property of properties)`), así que hacen falta
 * every_n + 1 propiedades para servir el primero. Con ad_frequency_n=8,
 * PAGE_SIZE=10 y 8 propiedades activas en Venta, el anuncio no entraba nunca:
 * ad_impressions=0 en producción al 2026-09-03 lo confirma. Con las secciones
 * Venta/Renta (#241) el umbral se evalúa por sección, así que es todavía más
 * difícil de alcanzar.
 *
 * DECISIÓN de Abraham (2026-09-03, smoke #222) — opción (a): se CONSERVAN los
 * invariantes 🔒 «nunca posición 0 en la primera página» y «every_n propiedades
 * antes del primer anuncio»; PERO si al terminar de recorrer `properties` queda
 * presupuesto de sesión y `since_last_ad >= every_n`, se agrega UN anuncio al
 * final del array, respetando min_gap_between_repeats y el pool_cursor. Aplica
 * a cualquier página. ad_frequency_n se queda en 8.
 *
 * SEAM: la firma exportada de interleave_ads (función pura). Sin mocks: no hay
 * red, tiempo ni aleatoriedad.
 *
 * EDGE CASES (RED):
 * - (EC-247-1) every_n_8_con_exactamente_8_propiedades_cierra_con_un_anuncio
 * - (EC-247-2) tres_propiedades_con_skip_first_position_no_producen_anuncios
 * - (EC-247-3) presupuesto_de_sesion_agotado_no_agrega_el_anuncio_de_cierre
 * - (EC-247-4) presupuesto_consumido_dentro_de_la_pagina_no_deja_anuncio_de_cierre
 * - (EC-247-5) el_anuncio_de_cierre_no_repite_uno_mostrado_antes_del_min_gap
 */

import type { FeedPropertyWithUrl } from '../types';
import { interleave_ads, type FeedAd, type FeedItem, type InterleaveAdsOptions } from '../lib/interleaveAds';

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
    address: `Calle Falsa 123 (${id})`,
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
    signed_url: `https://cdn.urbea.app/${id}.mp4`,
    video_id: `video-${id}`,
    posterUrl: null,
  } as unknown as FeedPropertyWithUrl;
}

const make_properties = (n: number): FeedPropertyWithUrl[] =>
  Array.from({ length: n }, (_, i) => make_property(`prop-${i + 1}`));

function make_ad(id: string): FeedAd {
  return {
    id,
    creative_id: `creative-${id}`,
    title: `Anuncio ${id}`,
    description: 'Descripción de prueba',
    cta_type: 'whatsapp',
    cta_value: '3312345678',
    cloudflare_uid: `cf-${id}`,
    agency_name: 'Inmobiliaria de Prueba',
    agency_logo_url: null,
  };
}

const make_ads = (n: number): FeedAd[] => Array.from({ length: n }, (_, i) => make_ad(`ad-${i + 1}`));

/** Config real de producción al 2026-09-03: ad_frequency_n=8, ad_max_per_session=5. */
const OPTS_PRODUCCION: InterleaveAdsOptions = {
  every_n: 8,
  max_per_session: 5,
  min_gap_between_repeats: 16,
  already_shown_count: 0,
  skip_first_position: true,
};

const count_ads = (result: FeedItem[]): number => result.filter((item) => item.kind === 'ad').length;

const ad_indices = (result: FeedItem[]): number[] =>
  result.flatMap((item, i) => (item.kind === 'ad' ? [i] : []));

describe('interleave_ads — anuncio de cierre de página (#247)', () => {
  it('(EC-247-1) every_n_8_con_exactamente_8_propiedades_cierra_con_un_anuncio: el caso exacto de producción sirve 1 anuncio, y va en la ÚLTIMA posición (las 8 propiedades quedan antes)', () => {
    const properties = make_properties(8);
    const ads = make_ads(3);

    const result = interleave_ads(properties, ads, OPTS_PRODUCCION);

    expect(count_ads(result)).toBe(1);
    expect(ad_indices(result)).toEqual([8]);
    expect(result).toHaveLength(9);
    expect(result[8]).toEqual({ kind: 'ad', ad: ads[0] });
  });

  it('(EC-247-2) tres_propiedades_con_skip_first_position_no_producen_anuncios: con menos de every_n propiedades el mínimo sigue siendo intocable, el resultado son las 3 propiedades tal cual', () => {
    const properties = make_properties(3);
    const ads = make_ads(3);

    const result = interleave_ads(properties, ads, OPTS_PRODUCCION);

    expect(count_ads(result)).toBe(0);
    expect(result).toEqual(properties.map((property) => ({ kind: 'property', property })));
  });

  it('(EC-247-3) presupuesto_de_sesion_agotado_no_agrega_el_anuncio_de_cierre: con already_shown_count=max_per_session el cierre no ocurre, aunque el hueco esté cumplido (el MISMO escenario con presupuesto sí lo agrega)', () => {
    const properties = make_properties(8);
    const ads = make_ads(3);

    const sin_presupuesto = interleave_ads(properties, ads, {
      ...OPTS_PRODUCCION,
      already_shown_count: 5,
    });
    expect(count_ads(sin_presupuesto)).toBe(0);

    // Control de presencia: el cierre sí ocurre cuando queda 1 de presupuesto.
    const con_presupuesto = interleave_ads(properties, ads, {
      ...OPTS_PRODUCCION,
      already_shown_count: 4,
    });
    expect(count_ads(con_presupuesto)).toBe(1);
  });

  it('(EC-247-4) presupuesto_consumido_dentro_de_la_pagina_no_deja_anuncio_de_cierre: si los anuncios del recorrido agotan el cap, la página termina en propiedad', () => {
    const properties = make_properties(9);
    const ads = make_ads(3);
    const opts: InterleaveAdsOptions = {
      every_n: 2,
      max_per_session: 1,
      min_gap_between_repeats: 4,
      already_shown_count: 0,
      skip_first_position: true,
    };

    const result = interleave_ads(properties, ads, opts);

    expect(count_ads(result)).toBe(1);
    expect(ad_indices(result)).toEqual([2]);
    expect(result[result.length - 1]!.kind).toBe('property');
  });

  it('(EC-247-5) el_anuncio_de_cierre_no_repite_uno_mostrado_antes_del_min_gap: con un solo anuncio en el pool y min_gap=16 el cierre se difiere; el MISMO escenario con min_gap=2 sí cierra con anuncio', () => {
    const properties = make_properties(4);
    const unico_ad = make_ad('unico');
    const opts: InterleaveAdsOptions = {
      every_n: 2,
      max_per_session: 5,
      min_gap_between_repeats: 16,
      already_shown_count: 0,
      skip_first_position: true,
    };

    const con_gap_grande = interleave_ads(properties, [unico_ad], opts);
    expect(count_ads(con_gap_grande)).toBe(1);
    expect(ad_indices(con_gap_grande)).toEqual([2]);
    expect(con_gap_grande[con_gap_grande.length - 1]!.kind).toBe('property');

    // Con un gap que sí se cumple (distancia 3 desde la aparición anterior),
    // el mismo anuncio vuelve como cierre — así se ve que arriba lo bloqueó
    // el min_gap y no que el cierre esté muerto.
    const con_gap_chico = interleave_ads(properties, [unico_ad], {
      ...opts,
      min_gap_between_repeats: 2,
    });
    expect(ad_indices(con_gap_chico)).toEqual([2, 5]);
  });
});
