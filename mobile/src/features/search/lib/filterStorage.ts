/**
 * filterStorage.ts — persistencia del FilterState en almacenamiento clave/valor (#12.7).
 *
 * - save_filters serializa `filters` (JSON.stringify) y lo guarda bajo la key
 *   estable FILTERS_STORAGE_KEY ('urbea_filters').
 * - load_filters lee esa key y deserializa; fail-safe: si no hay valor, el JSON
 *   es inválido o el shape no es un objeto plano (p.ej. array) → devuelve
 *   EMPTY_FILTERS. NUNCA lanza.
 * - `deps.storage` es DI opcional (forma mínima getItem/setItem) para poder
 *   testear sin el módulo nativo @react-native-async-storage/async-storage;
 *   en producción se usa ese módulo por defecto (lazy-require, mismo patrón
 *   que feedProperties.ts / mapProperties.ts).
 */

import { EMPTY_FILTERS } from './filterQuery';
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

/** ponytail: lazy-require del módulo nativo — evita romper tests que inyectan storage. */
function default_storage(): KeyValueStorage {
   
  return (require('@react-native-async-storage/async-storage') as any).default;
}

/** Type guard mínimo: ¿es un objeto plano (no array, no null)? */
function is_plain_object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function save_filters(filters: FilterState, deps?: FilterStorageDeps): Promise<void> {
  const storage = deps?.storage ?? default_storage();
  await storage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
}

export async function load_filters(deps?: FilterStorageDeps): Promise<FilterState> {
  const storage = deps?.storage ?? default_storage();
  try {
    const raw = await storage.getItem(FILTERS_STORAGE_KEY);
    if (raw === null) return EMPTY_FILTERS;

    const parsed: unknown = JSON.parse(raw);
    if (!is_plain_object(parsed)) return EMPTY_FILTERS;

    return parsed as unknown as FilterState;
  } catch {
    return EMPTY_FILTERS;
  }
}
