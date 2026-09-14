/**
 * feedTabStorage.ts — STUB (fase RED, #296.3). Firma únicamente: la
 * implementación real (persistencia fail-safe del FeedTab, patrón idéntico a
 * filterStorage.ts) la escribe la fase GREEN de la subtarea 296.3.
 *
 * ponytail: no hay lógica de negocio aquí — solo el contrato exportado para
 * que feedTabStorage.test.ts y filterStore.tsx (vía mock) puedan importar el
 * módulo sin romper por "Cannot find module".
 */
import type { KeyValueStorage } from './filterStorage';

/** Key estable bajo la que se persistirá el FeedTab (GREEN). */
export const FEED_TAB_STORAGE_KEY = 'urbea_feed_tab';

export interface FeedTabStorageDeps {
  storage: KeyValueStorage;
}

export async function save_feed_tab(_tab: string, _deps?: FeedTabStorageDeps): Promise<void> {
  throw new Error('not_implemented');
}

export async function load_feed_tab(_deps?: FeedTabStorageDeps): Promise<string> {
  throw new Error('not_implemented');
}
