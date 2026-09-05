/**
 * interleaveAds.ts — función PURA que intercala anuncios en el feed.
 *
 * Subtarea Taskmaster: 170.3 — interleaveAds.ts: función PURA con 8
 * invariantes (dependencia de 170.1 app_config y 170.2 ads_for_zone; el
 * contrato de esta función vive aparte de ambos: recibe `properties` y `ads`
 * YA resueltos y solo decide EL ORDEN de intercalado).
 *
 * (El encabezado describía la fase RED de 170.3; la implementación lleva
 * verde desde entonces y los tests viven en
 * mobile/src/features/feed/__tests__/interleaveAds.test.ts +
 * interleaveAds.trailing-ad.test.ts.)
 *
 * POR QUÉ VIVE AQUÍ Y NO EN EL HOOK (arquitectura, doc de exploración 039,
 * opción c): la lógica que decide QUÉ VE EL USUARIO y QUÉ SE FACTURA
 * (impresiones) tiene que ser una función pura y determinista, testeable sin
 * mocks de tiempo/random — eso la mete en la vía TDD CRÍTICA de CLAUDE.md §5
 * por vivir bajo `**​/lib/**`. Metida dentro de un hook con estado sería
 * intesteable.
 */

import type { FeedPropertyWithUrl } from '../types';

/**
 * Anuncio elegible para el feed, forma devuelta por la RPC public.ads_for_zone
 * (subtarea 170.2, supabase/migrations/20260818000002_ads_for_zone.sql) — SIN
 * transformar: interleave_ads solo reordena, nunca reescribe estos campos.
 */
export interface FeedAd {
  id: string;
  /**
   * 170.8: id del creativo. El cliente lo necesita para pedirle a mint-ad-urls
   * la URL FIRMADA de reproducción — esa EF autoriza y firma por creativo, no
   * por anuncio. Sin él, el anuncio era una tarjeta estática en un feed de
   * video.
   *
   * 213: null en una promo (el video sale de property_videos vía
   * mint-video-url, no de un creativo propio — ver `property_id`).
   */
  creative_id: string | null;
  title: string;
  /** 213: null en una promo (sin creative propio, sin descripción). */
  description: string | null;
  /** 213: null en una promo (sin CTA propio — tocar el video abre el detalle). */
  cta_type: string | null;
  /** 213: null en una promo. */
  cta_value: string | null;
  /** 213: null en una promo. */
  cloudflare_uid: string | null;
  agency_name: string;
  /** null si la agencia no tiene logo cargado. */
  agency_logo_url: string | null;
  /**
   * 213: id de la propiedad promocionada (RPC `promote_property_atomic` +
   * columna `ads.property_id`, migración 20260903300001). No nulo ⟺ es una
   * PROMO, no un anuncio display — mutuamente excluyente con `creative_id`
   * (CHECK `ads_exactly_one_source` en la base).
   *
   * `undefined` (ausente por completo, no solo null) es el caso de un backend
   * anterior a esta migración: `ads_for_zone` todavía no manda esta columna.
   * El cliente lo trata igual que `null` — tolerancia OTA (este cliente puede
   * salir ANTES de que las 3 migraciones de #213 estén desplegadas).
   */
  property_id?: string | null;
  /**
   * URLs firmadas de Stream, adjuntadas durante la composición del feed (no
   * vienen de la RPC). null = el minteo falló para este anuncio.
   *
   * 🔴 Un anuncio sin `video_url` NO se sirve (ver compose_feed_items): una
   * impresión que el anunciante paga y que no muestra su video es peor que no
   * servir el anuncio.
   */
  video_url?: string | null;
  poster_url?: string | null;
}

/** Ítem heterogéneo del feed: una propiedad de siempre, o un anuncio intercalado. */
export type FeedItem =
  | { kind: 'property'; property: FeedPropertyWithUrl }
  | { kind: 'ad'; ad: FeedAd };

export interface InterleaveAdsOptions {
  /** Mínimo de propiedades entre dos anuncios consecutivos (app_config.ad_frequency_n, 170.1). */
  every_n: number;
  /** Tope de anuncios por SESIÓN, contando llamadas/páginas previas (app_config.ad_max_per_session). */
  max_per_session: number;
  /** Items mínimos entre dos apariciones del MISMO anuncio (2×every_n en producción; parámetro del caller, no derivado aquí). */
  min_gap_between_repeats: number;
  /** Anuncios ya mostrados en ESTA sesión antes de esta llamada (páginas/refetch previos). */
  already_shown_count: number;
  /**
   * true (primera página real del feed) → invariante "nunca posición 0" se
   * aplica: la llamada exige `every_n` propiedades antes del primer anuncio.
   * false (páginas de continuación: el índice 0 de ESTE array no es la
   * posición 0 del feed completo) → el primer anuncio puede caer en el
   * índice 0 de esta llamada si ya está due.
   */
  skip_first_position: boolean;
  /**
   * 256: propiedades ya emitidas desde el último anuncio AL CERRAR la página
   * ANTERIOR (el `since_last_ad` final que devuelve `interleave_ads_with_state`
   * para esa página previa). Cuando viene presente, SUSTITUYE el arranque por
   * defecto del contador interno (`skip_first_position ? 0 : every_n`) — SIN
   * IMPORTAR `skip_first_position`. Es lo que hace que el invariante "nunca
   * dos anuncios seguidos" se sostenga en la COSTURA entre páginas, no solo
   * dentro de cada llamada: sin esto, una página que cierra con un anuncio
   * (pasada de cierre, #247) y una continuación que arranca "due"
   * (`skip_first_position:false`) podían servir dos anuncios consecutivos.
   * `undefined` (el caso de siempre, primera página o caller que no rastrea
   * estado) deja el comportamiento previo intacto.
   */
  since_last_ad?: number;
}

/**
 * Intercala `ads` dentro de `properties` respetando los 8 invariantes de la
 * subtarea 170.3 (ver bitácora de la subtarea para el detalle completo).
 * Wrapper de `interleave_ads_with_state` (256) que descarta el `since_last_ad`
 * final — se conserva por compatibilidad: ningún test/caller preexistente
 * cambia de forma.
 */
export function interleave_ads(
  properties: FeedPropertyWithUrl[],
  ads: FeedAd[],
  opts: InterleaveAdsOptions
): FeedItem[] {
  return interleave_ads_with_state(properties, ads, opts).items;
}

/**
 * 256: MISMA lógica que `interleave_ads`, pero también devuelve el valor
 * FINAL del contador `since_last_ad` al cerrar la página (propiedades
 * emitidas desde el último anuncio; 0 si la página cerró con un anuncio en
 * la pasada de cierre de #247). El caller (`useFeedProperties.ts`) acumula
 * este valor entre páginas y lo pasa como `opts.since_last_ad` en la
 * siguiente llamada, para que la costura entre páginas respete el mismo
 * invariante que dentro de una sola llamada. No es una reescritura paralela:
 * `interleave_ads` es un wrapper de esta función que descarta `since_last_ad`.
 *
 * Pura y determinista: misma entrada → misma salida, sin fecha/hora ni
 * aleatoriedad, sin mutar `properties` ni `ads`.
 *
 * Algoritmo (recorrido único + contador, ponytail: nada de motor de reglas):
 * - `since_last_ad` cuenta propiedades emitidas desde el último anuncio.
 *   Arranca en `opts.since_last_ad` si viene presente (256 — costura entre
 *   páginas, manda SIN IMPORTAR `skip_first_position`); si no, en 0 si
 *   `skip_first_position` (exige `every_n` propiedades antes del primer
 *   anuncio) o en `every_n` si no (el primer anuncio puede caer en la
 *   posición 0 si ya está "due").
 * - Cuando `since_last_ad >= every_n` y queda presupuesto de sesión, se
 *   busca el primer anuncio del pool (round-robin determinista) cuya última
 *   aparición esté a >= `min_gap_between_repeats` posiciones; si ninguno
 *   califica se difiere el intercalado (nunca se rompe el invariante 5).
 * - #247: el recorrido da UNA pasada extra al terminar las propiedades, que
 *   solo evalúa la colocación. Así una página que ya cumplió el hueco cierra
 *   con un anuncio en vez de perderlo — el push vivía únicamente dentro del
 *   bucle, de modo que hacían falta `every_n + 1` propiedades para servir el
 *   primero. Los invariantes NO cambian: el de cierre pasa por las mismas
 *   condiciones (hueco, presupuesto, min_gap, cursor), y una página con menos
 *   de `every_n` propiedades sigue sin anuncios.
 */
export function interleave_ads_with_state(
  properties: FeedPropertyWithUrl[],
  ads: FeedAd[],
  opts: InterleaveAdsOptions
): { items: FeedItem[]; since_last_ad: number } {
  const { every_n, max_per_session, min_gap_between_repeats, already_shown_count, skip_first_position } = opts;
  const budget = max_per_session - already_shown_count;
  const initial_since_last_ad = opts.since_last_ad !== undefined ? opts.since_last_ad : (skip_first_position ? 0 : every_n);

  if (properties.length === 0) return { items: [], since_last_ad: initial_since_last_ad };
  if (ads.length === 0 || budget <= 0) {
    return {
      items: properties.map((property) => ({ kind: 'property', property })),
      since_last_ad: initial_since_last_ad + properties.length,
    };
  }

  const result: FeedItem[] = [];
  const last_shown_at = new Map<string, number>(); // ad.id -> índice en `result`
  let since_last_ad = initial_since_last_ad;
  let ads_used = 0;
  let pool_cursor = 0;

  // Se recorre UNA posición más que propiedades (#247). Esa pasada extra no
  // emite ninguna propiedad: solo le da su turno al anuncio de CIERRE, con las
  // mismas condiciones que cualquier otro (hueco cumplido, presupuesto,
  // min_gap, pool_cursor). Antes el push vivía solo dentro del recorrido, así
  // que hacían falta every_n + 1 propiedades para servir el primer anuncio y
  // una página de exactamente every_n no servía ninguno — con
  // ad_frequency_n=8 y 8 propiedades en Venta, jamás se sirvió uno
  // (ad_impressions=0 en producción, smoke #222).
  for (let i = 0; i <= properties.length; i++) {
    if (ads_used < budget && since_last_ad >= every_n) {
      const current_pos = result.length;
      for (let k = 0; k < ads.length; k++) {
        const idx = (pool_cursor + k) % ads.length;
        const candidate = ads[idx]!;
        const last_pos = last_shown_at.get(candidate.id);
        if (last_pos === undefined || current_pos - last_pos >= min_gap_between_repeats) {
          result.push({ kind: 'ad', ad: candidate });
          last_shown_at.set(candidate.id, current_pos);
          pool_cursor = (idx + 1) % ads.length;
          ads_used++;
          since_last_ad = 0;
          break;
        }
      }
    }

    const property = properties[i];
    if (property === undefined) break; // pasada de cierre: ya no queda propiedad que emitir
    result.push({ kind: 'property', property });
    since_last_ad++;
  }

  return { items: result, since_last_ad };
}
