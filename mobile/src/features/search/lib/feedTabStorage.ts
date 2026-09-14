/**
 * feedTabStorage.ts — persistencia del FeedTab activo (#296.3), mismo patrón
 * que filterStorage.ts pero como string PLANO (sin JSON.stringify): el valor
 * guardado es directamente uno de los 5 FeedTab.
 *
 * - save_feed_tab guarda el tab tal cual bajo la key estable FEED_TAB_STORAGE_KEY
 *   ('urbea_feed_tab').
 * - load_feed_tab es fail-safe: sin valor guardado, string vacío, basura legacy
 *   ('sale' de #241), JSON entrecomillado ('"venta"') o storage.getItem que
 *   rechaza → DEFAULT_FEED_TAB ('para_ti'). NUNCA lanza.
 * - `deps.storage` es DI opcional (mismo KeyValueStorage de filterStorage.ts)
 *   para testear sin el módulo nativo; en producción, lazy-require de
 *   @react-native-async-storage/async-storage.
 */
import { DEFAULT_FEED_TAB, is_feed_tab, type FeedTab } from './feedSection';
import type { KeyValueStorage } from './filterStorage';

/** Key estable bajo la que se persiste el FeedTab. */
export const FEED_TAB_STORAGE_KEY = 'urbea_feed_tab';

export interface FeedTabStorageDeps {
  storage: KeyValueStorage;
}

/** ponytail: lazy-require del módulo nativo — evita romper tests que inyectan storage. */
function default_storage(): KeyValueStorage {

  return (require('@react-native-async-storage/async-storage') as any).default;
}

export async function save_feed_tab(tab: FeedTab, deps?: FeedTabStorageDeps): Promise<void> {
  const storage = deps?.storage ?? default_storage();
  await storage.setItem(FEED_TAB_STORAGE_KEY, tab);
}

export async function load_feed_tab(deps?: FeedTabStorageDeps): Promise<FeedTab> {
  const storage = deps?.storage ?? default_storage();
  try {
    const raw = await storage.getItem(FEED_TAB_STORAGE_KEY);
    if (raw !== null && is_feed_tab(raw)) return raw;
    return DEFAULT_FEED_TAB;
  } catch {
    return DEFAULT_FEED_TAB;
  }
}
