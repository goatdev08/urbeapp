/**
 * useZoneSearchEvent.ts — telemetría de búsqueda de zona en el mapa
 * (colonia, municipio o el pill "Buscar en esta zona").
 *
 * Subtarea Taskmaster: 268.2. Implementación completa (GREEN); contrato
 * verificado en mobile/src/features/map/__tests__/useZoneSearchEvent.test.tsx.
 * Mismo patrón que useVideoEngagementEvents.ts (112.2): escritura DIRECTA a
 * public.events_raw con RLS, user_id siempre de useAuth(), fire-and-forget
 * (nunca rechaza), fail-closed sin session_id, store inyectable con
 * fallback por instancia (useRef).
 *
 * A diferencia de los eventos de video, la fila NUNCA lleva property_id,
 * property_video_id ni agent_id — una búsqueda de zona no nace de un video.
 */

import { useRef } from 'react';
import { useAuth } from '@/features/auth/context';
import {
  create_zone_search_store,
  normalize_zone_search_payload,
  zone_search_key,
  ZONE_SEARCH_EVENT_TYPE,
  type ZoneSearchPayload,
  type ZoneSearchStore,
} from '../lib/zoneSearchEvent';

export interface UseZoneSearchEventOpts {
  session_id: string;
  supabase?: any;
  store?: ZoneSearchStore;
}

export interface UseZoneSearchEventReturn {
  report_zone_search: (payload: ZoneSearchPayload) => Promise<void>;
}

export function useZoneSearchEvent(
  opts: UseZoneSearchEventOpts
): UseZoneSearchEventReturn {
  const { session_id, supabase: supabase_prop, store: store_prop } = opts;
  const { user } = useAuth();

  // Store por defecto: uno por instancia del hook (lazy-init en el ref, nunca
  // se recrea entre re-renders). Si el llamador inyecta `store`, ese SIEMPRE
  // gana — permite compartir dedupe entre remounts (MapScreen a nivel de
  // módulo) o aislarlo (tests).
  const own_store_ref = useRef<ZoneSearchStore | null>(null);
  if (own_store_ref.current === null) {
    own_store_ref.current = create_zone_search_store();
  }
  const store = store_prop ?? own_store_ref.current;

  // Resolución lazy del cliente — idéntico a useVideoEngagementEvents. Evita
  // que el module-level eval de client.ts (que lanza sin env vars) rompa los
  // tests.
  const get_client = (): any => {
    if (supabase_prop !== undefined) return supabase_prop;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@/lib/supabase/client') as { supabase: unknown }).supabase;
  };

  // report_zone_search NO es `async`: encadena con `.then()` directamente
  // sobre el builder de `.insert()` en vez de `await`-earlo. Con un builder
  // thenable-pero-no-Promise (el patrón de mock de este proyecto,
  // make_insert_builder), `await` añade un salto de microtask extra
  // (PromiseResolveThenableJob) que un `.then()` manual no paga — evita una
  // condición de carrera con `act()` de React (su propio `.then()` no
  // encadena como un Promise real) cuando el test envuelve el resultado en
  // `expect(act(...)).resolves`.
  const report_zone_search = (payload: ZoneSearchPayload): Promise<void> => {
    if (!user) return Promise.resolve();
    // Fail-closed sin PII: events_raw.session_id es nullable, así que sin
    // esta guarda se insertarían filas con session_id NULL en silencio y
    // corromperían el dedupe. El mensaje NUNCA incluye user_id.
    if (!session_id) {
      console.error(
        '[useZoneSearchEvent] session_id vacío/inválido — se descarta zone_search sin escribir (fail-closed)'
      );
      return Promise.resolve();
    }

    const normalized = normalize_zone_search_payload(payload);
    const key = zone_search_key(session_id, normalized);
    if (store.has_seen(key)) return Promise.resolve();
    // Marca ANTES de insertar (no tras resolver): dos taps rápidos del pill
    // sin await entre medias podrían solaparse mientras el primer INSERT
    // sigue en vuelo.
    store.mark_seen(key);

    const row = {
      event_type: ZONE_SEARCH_EVENT_TYPE,
      user_id: user.id,
      session_id,
      payload: normalized,
    };

    try {
      return get_client()
        .from('events_raw')
        .insert(row)
        .then(
          ({ error }: { error: unknown }) => {
            if (error) {
              console.error('[useZoneSearchEvent] fallo al insertar zone_search', error);
            }
          },
          (err: unknown) => {
            console.error('[useZoneSearchEvent] excepción al insertar zone_search', err);
          }
        );
    } catch (err) {
      console.error('[useZoneSearchEvent] excepción al insertar zone_search', err);
      return Promise.resolve();
    }
  };

  return { report_zone_search };
}
