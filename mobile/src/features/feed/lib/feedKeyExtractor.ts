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
 * FASE RED — STUB. Sin lógica de negocio: lanza siempre para que
 * mobile/src/features/feed/__tests__/feedKeyExtractor.test.ts falle por
 * ASERCIÓN/EXCEPCIÓN, nunca por import roto. La implementación GREEN va en
 * una sesión aparte.
 *
 * CONTRATO fijado por este test-author: `${item.kind}:${id}` — prefijo por
 * `kind` ANTES del id (gotcha ya pagado en este repo, ver
 * flatlist_numcolumns_row_keys.md: FlashList advierte y rompe el render si
 * dos items comparten key). Un uuid de `ad` podría, en teoría, colisionar
 * con un uuid de `property`; el prefijo por kind lo hace imposible aunque
 * los ids literales colisionen byte a byte.
 */

import type { FeedItem } from './interleaveAds';

export function feed_key_extractor(_item: FeedItem): string {
  throw new Error('feed_key_extractor: not_implemented (RED — 170.4)');
}
