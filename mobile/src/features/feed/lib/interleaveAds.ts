/**
 * interleaveAds.ts — función PURA que intercala anuncios en el feed.
 *
 * Subtarea Taskmaster: 170.3 — interleaveAds.ts: función PURA con 8
 * invariantes (dependencia de 170.1 app_config y 170.2 ads_for_zone; el
 * contrato de esta función vive aparte de ambos: recibe `properties` y `ads`
 * YA resueltos y solo decide EL ORDEN de intercalado).
 *
 * FASE RED — STUB. Sin lógica de negocio: lanza siempre para que
 * mobile/src/features/feed/__tests__/interleaveAds.test.ts falle por
 * ASERCIÓN/EXCEPCIÓN, nunca por import roto. La implementación GREEN va en
 * una sesión aparte.
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
  title: string;
  description: string;
  cta_type: string;
  cta_value: string;
  cloudflare_uid: string;
  agency_name: string;
  /** null si la agencia no tiene logo cargado. */
  agency_logo_url: string | null;
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
}

/**
 * Intercala `ads` dentro de `properties` respetando los 8 invariantes de la
 * subtarea 170.3 (ver bitácora de la subtarea para el detalle completo).
 * Pura y determinista: misma entrada → misma salida, sin fecha/hora ni
 * aleatoriedad, sin mutar `properties` ni `ads`.
 *
 * Algoritmo (recorrido único + contador, ponytail: nada de motor de reglas):
 * - `since_last_ad` cuenta propiedades emitidas desde el último anuncio.
 *   Arranca en 0 si `skip_first_position` (exige `every_n` propiedades antes
 *   del primer anuncio) o en `every_n` si no (el primer anuncio puede caer
 *   en la posición 0 si ya está "due").
 * - Cuando `since_last_ad >= every_n` y queda presupuesto de sesión, se
 *   busca el primer anuncio del pool (round-robin determinista) cuya última
 *   aparición esté a >= `min_gap_between_repeats` posiciones; si ninguno
 *   califica se difiere el intercalado (nunca se rompe el invariante 5).
 */
export function interleave_ads(
  properties: FeedPropertyWithUrl[],
  ads: FeedAd[],
  opts: InterleaveAdsOptions
): FeedItem[] {
  const { every_n, max_per_session, min_gap_between_repeats, already_shown_count, skip_first_position } = opts;
  const budget = max_per_session - already_shown_count;

  if (properties.length === 0) return [];
  if (ads.length === 0 || budget <= 0) {
    return properties.map((property) => ({ kind: 'property', property }));
  }

  const result: FeedItem[] = [];
  const last_shown_at = new Map<string, number>(); // ad.id -> índice en `result`
  let since_last_ad = skip_first_position ? 0 : every_n;
  let ads_used = 0;
  let pool_cursor = 0;

  for (const property of properties) {
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

    result.push({ kind: 'property', property });
    since_last_ad++;
  }

  return result;
}
