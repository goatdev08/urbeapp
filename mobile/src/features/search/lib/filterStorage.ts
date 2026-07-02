/**
 * filterStorage.ts — persistencia del FilterState en almacenamiento clave/valor (#12.7).
 *
 * STUB fase RED — sin lógica de negocio. Lanza `not_implemented` para que los
 * tests fallen por excepción, no por import.
 *
 * Contrato completo (a implementar en GREEN): ver
 * mobile/src/features/search/__tests__/filterStorage.test.ts
 *
 * - save_filters serializa `filters` (JSON.stringify) y lo guarda bajo la key
 *   estable FILTERS_STORAGE_KEY ('urbea_filters', ver subtarea 12.7).
 * - load_filters lee esa key y deserializa; fail-safe: si no hay valor, el JSON
 *   es inválido o el shape no es un objeto plano (p.ej. array) → devuelve
 *   EMPTY_FILTERS (NUNCA lanza — a diferencia de este stub, que sí lanza
 *   mientras no se implementa).
 * - `deps.storage` es DI opcional (forma mínima getItem/setItem) para poder
 *   testear sin el módulo nativo @react-native-async-storage/async-storage;
 *   en producción se usa ese módulo por defecto (lazy-require, mismo patrón
 *   que feedProperties.ts / mapProperties.ts).
 */

import type { FilterState } from '../types';

/** Key estable bajo la que se persiste el FilterState. */
export const FILTERS_STORAGE_KEY = 'urbea_filters';

/** Forma mínima de un storage clave/valor async (subset de AsyncStorage). */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface FilterStorageDeps {
  storage: KeyValueStorage;
}

export async function save_filters(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  filters: FilterState,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  deps?: FilterStorageDeps,
): Promise<void> {
  throw new Error('not_implemented');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function load_filters(deps?: FilterStorageDeps): Promise<FilterState> {
  throw new Error('not_implemented');
}
