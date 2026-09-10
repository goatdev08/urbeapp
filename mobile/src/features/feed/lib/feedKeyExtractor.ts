/**
 * feedKeyExtractor.ts — key ÚNICA y ESTABLE para FlashList sobre el feed
 * heterogéneo (propiedades + anuncios intercalados, subtarea 170.4).
 *
 * Subtarea Taskmaster: 170.4 — Composición en useFeedProperties + tipo
 * heterogéneo del feed.
 *
 * POR QUÉ VIVE EN SU PROPIO ARCHIVO (decisión de seam del test-author, NO
 * anticipada al 100% por el footprint del analista, que solo citaba
 * FeedScreen.tsx:41/:184 para `key_extractor`): FeedScreen.tsx importa
 * decenas de dependencias (navegación, safe-area, hooks de filtros, íconos)
 * que harían el test de "keys únicas con ids colisionantes" pesado y frágil
 * de mockear, y probar la función inline reimplementando su lógica en el
 * test caería en el antipatrón "se compara contra su propia copia". Extraer
 * la función pura a `lib/` la mete en la vía TDD CRÍTICA por la regla
 * determinista de path (igual que interleaveAds.ts en 170.3) y la hace
 * testeable en aislamiento real. FeedScreen.tsx (GREEN de esta subtarea)
 * debe importar `feed_key_extractor` en vez de mantener la lambda inline
 * `(item) => item.id` que asumía un solo tipo homogéneo.
 *
 * FASE GREEN (170.4). CONTRATO fijado por el test-author: `${item.kind}:${id}`
 * -- prefijo por `kind` ANTES del id (gotcha ya pagado en este repo, ver
 * flatlist_numcolumns_row_keys.md: FlashList advierte y rompe el render si
 * dos items comparten key). Un uuid de `ad` podria, en teoria, colisionar
 * con un uuid de `property`; el prefijo por kind lo hace imposible aunque
 * los ids literales colisionen byte a byte.
 */

import type { FeedItem } from './interleaveAds';

/**
 * #285.1 — vuelta del feed infinito (doc 047). `lap` es el número de vuelta
 * del ítem (0 o ausente = primera vuelta). Intersección de tipo declarada AQUÍ
 * y no en interleaveAds.ts: el intercalado de anuncios no sabe de vueltas, el
 * hook marca los ítems al apendear la vuelta y solo la key los distingue.
 */
export type LappedFeedItem = FeedItem & { lap?: number | undefined };

/**
 * `kind:id` en la primera vuelta (forma de 170.4, intacta) y `kind:id#lap`
 * desde la segunda: la misma propiedad repetida en vueltas distintas NO puede
 * compartir key o FlashList rompe el render (memoria flatlist_numcolumns_row_keys).
 */
export function feed_key_extractor(item: LappedFeedItem): string {
  const base = item.kind === 'property' ? `property:${item.property.id}` : `ad:${item.ad.id}`;
  return item.lap != null && item.lap > 0 ? `${base}#${item.lap}` : base;
}
