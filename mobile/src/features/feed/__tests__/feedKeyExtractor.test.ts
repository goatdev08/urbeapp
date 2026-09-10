/**
 * RED — feed_key_extractor (170.4)
 * SUT: mobile/src/features/feed/lib/feedKeyExtractor.ts
 *
 * Gotcha ya pagado en este repo (flatlist_numcolumns_row_keys.md): keys
 * duplicadas en FlashList producen el warning "same key" y renders
 * equivocados. Con el feed heterogéneo (propiedades + anuncios
 * intercalados, 170.3/170.2), la key extraída de `item.id` a secas ya no
 * alcanza: un ad.id y un property.id son ambos uuid — pueden colisionar.
 *
 * Contrato fijado (documentado en el propio SUT): `${item.kind}:${id}`.
 */

import { feed_key_extractor, type LappedFeedItem } from '../lib/feedKeyExtractor';
import type { FeedAd, FeedItem } from '../lib/interleaveAds';
import type { FeedPropertyWithUrl } from '../types';

function make_property(id: string): FeedPropertyWithUrl {
  return {
    id,
    price: 12000,
    operation_type: 'rent',
    property_type: 'departamento',
    currency: 'MXN',
    price_visible: true,
    address: 'Av. Vallarta 1500, Col. Americana, Guadalajara',
    bedrooms: 2,
    bathrooms: 1,
    owner_user_id: 'owner-uuid-key-test',
    agency_id: null,
    created_at: '2026-01-01T00:00:00Z',
    agent_has_phone: false,
    agent_name: null,
    agent_photo_url: null,
    video: {
      id: `video-${id}`,
      storage_path: `properties/${id}/video.mp4`,
      position: 0,
      thumbnail_url: null,
    },
    signed_url: `https://cdn.urbea.app/signed/${id}.mp4`,
    video_id: `video-${id}`,
    posterUrl: null,
  };
}

function make_ad(id: string): FeedAd {
  return {
    id,
    creative_id: `creative-${id}`,
    title: 'Departamentos en preventa · Zapopan',
    description: 'Entrega 2027. Aparta con el 10%.',
    cta_type: 'external_url',
    cta_value: 'https://ejemplo.mx/preventa',
    cloudflare_uid: `cf-${id}`,
    agency_name: 'Constructora Ejemplo',
    agency_logo_url: null,
  };
}

// El mismo uuid literal usado como id de property Y de ad, a propósito —
// la colisión que el contrato debe hacer imposible.
const COLLIDING_UUID = 'a1b2c3d4-0000-0000-0000-000000000001';

describe('feed_key_extractor (170.4)', () => {
  it('(EC-1) key_de_property_lleva_el_prefijo_property_seguido_del_id_exacto: para {kind:"property", property:{id}} devuelve LITERALMENTE "property:<id>"', () => {
    const item: FeedItem = { kind: 'property', property: make_property('prop-uuid-111') };
    expect(feed_key_extractor(item)).toBe('property:prop-uuid-111');
  });

  it('(EC-2) key_de_ad_lleva_el_prefijo_ad_seguido_del_id_exacto: para {kind:"ad", ad:{id}} devuelve LITERALMENTE "ad:<id>"', () => {
    const item: FeedItem = { kind: 'ad', ad: make_ad('ad-uuid-222') };
    expect(feed_key_extractor(item)).toBe('ad:ad-uuid-222');
  });

  it('(EC-3) mismo_uuid_como_property_y_como_ad_produce_dos_keys_DISTINTAS: el prefijo por kind hace imposible la colisión aunque los ids literales sean idénticos byte a byte', () => {
    const property_item: FeedItem = { kind: 'property', property: make_property(COLLIDING_UUID) };
    const ad_item: FeedItem = { kind: 'ad', ad: make_ad(COLLIDING_UUID) };

    const property_key = feed_key_extractor(property_item);
    const ad_key = feed_key_extractor(ad_item);

    // Presencia: ambas keys existen y son las esperadas por el contrato.
    expect(property_key).toBe(`property:${COLLIDING_UUID}`);
    expect(ad_key).toBe(`ad:${COLLIDING_UUID}`);
    // Ausencia (lo que rompía antes del prefijo): NO son la misma key.
    expect(property_key).not.toBe(ad_key);
  });

  it('(EC-4) una_lista_heterogenea_con_ids_colisionantes_produce_keys_todas_unicas: Set de keys sobre [property(X), ad(X), property(Y), ad(Y)] tiene tamaño 4, no 2 — demuestra el escenario real de FlashList con datos duplicados', () => {
    const UUID_X = 'b2c3d4e5-1111-1111-1111-111111111111';
    const UUID_Y = 'c3d4e5f6-2222-2222-2222-222222222222';

    const items: FeedItem[] = [
      { kind: 'property', property: make_property(UUID_X) },
      { kind: 'ad', ad: make_ad(UUID_X) },
      { kind: 'property', property: make_property(UUID_Y) },
      { kind: 'ad', ad: make_ad(UUID_Y) },
    ];

    const keys = items.map(feed_key_extractor);
    const unique_keys = new Set(keys);

    // Presencia: las 4 keys se computaron (ninguna vino vacía/undefined).
    expect(keys).toHaveLength(4);
    keys.forEach((k) => expect(typeof k).toBe('string'));
    // El invariante real: cero colisiones.
    expect(unique_keys.size).toBe(4);
  });

  it('(EC-5) misma_instancia_de_item_produce_siempre_la_misma_key_pura_y_estable: dos llamadas consecutivas con el mismo item devuelven exactamente el mismo string (estabilidad entre re-renders de FlashList)', () => {
    const item: FeedItem = { kind: 'property', property: make_property('prop-uuid-estable') };

    const first_call = feed_key_extractor(item);
    const second_call = feed_key_extractor(item);

    expect(first_call).toBe('property:prop-uuid-estable');
    expect(second_call).toBe(first_call);
  });
});

// ── #285.1 — sufijo de vuelta (feed infinito, doc 047) ──────────────────────
// Al agotar el inventario el feed apende una VUELTA nueva con las mismas
// propiedades; sin sufijo de vuelta la key colisiona consigo misma y FlashList
// rompe el render (la misma trampa de 170.4, ahora entre vueltas).
// Contrato: lap undefined o 0 → la forma actual `kind:id` (retrocompatible con
// EC-1..EC-5); lap ≥ 1 → `kind:id#lap`.
describe('feed_key_extractor — sufijo de vuelta (#285.1)', () => {
  it('(EC-6) lap_0_conserva_la_forma_actual: {lap:0} produce exactamente la misma key que sin lap', () => {
    const base: FeedItem = { kind: 'property', property: make_property('prop-lap-0') };
    const lapped: LappedFeedItem = { ...base, lap: 0 };
    expect(feed_key_extractor(lapped)).toBe('property:prop-lap-0');
    expect(feed_key_extractor(lapped)).toBe(feed_key_extractor(base));
  });

  it('(EC-7) property_en_vuelta_1_lleva_el_sufijo_#1: devuelve LITERALMENTE "property:<id>#1"', () => {
    const item: LappedFeedItem = { kind: 'property', property: make_property('prop-lap-1'), lap: 1 };
    expect(feed_key_extractor(item)).toBe('property:prop-lap-1#1');
  });

  it('(EC-8) ad_en_vuelta_2_lleva_el_sufijo_#2: devuelve LITERALMENTE "ad:<id>#2"', () => {
    const item: LappedFeedItem = { kind: 'ad', ad: make_ad('ad-lap-2'), lap: 2 };
    expect(feed_key_extractor(item)).toBe('ad:ad-lap-2#2');
  });

  it('(EC-9) la_misma_propiedad_en_3_vueltas_produce_3_keys_distintas: Set de keys sobre [lap 0, lap 1, lap 2] del mismo id tiene tamaño 3', () => {
    const property = make_property('prop-lap-repetida');
    const items: LappedFeedItem[] = [
      { kind: 'property', property },
      { kind: 'property', property, lap: 1 },
      { kind: 'property', property, lap: 2 },
    ];
    const keys = items.map(feed_key_extractor);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
    // Ausencia: ninguna vuelta ≥1 reusa la key de la vuelta 0.
    expect(keys[1]).not.toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});
