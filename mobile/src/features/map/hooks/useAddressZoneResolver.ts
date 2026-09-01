/**
 * useAddressZoneResolver — estado de loading/error de la resolución
 * dirección→zona (#232.2).
 *
 * Envuelve lib/resolveAddressZone.resolve_address_to_zone (CRÍTICA, ya
 * probada por contrato) con `resolving`/`resolve_error` para que el
 * componente NUNCA haga try/catch directo — solo lee estado y reacciona al
 * discriminated union que `resolve()` devuelve.
 *
 * 'out_of_coverage' setea el copy PINNEADO ("Esa dirección está fuera de las
 * zonas disponibles por ahora") en resolve_error — mismo slot de mensaje que
 * un error real, porque la UI los muestra en el mismo lugar (ver #232.2).
 *
 * Anti-stale (mismo patrón que usePlaceSearch/useAddressSearch): solo el
 * ÚLTIMO resolve() en vuelo puede actualizar resolving/resolve_error. El
 * VALOR DEVUELTO de cada llamada es siempre el de esa llamada — quien tocó
 * una predicción específica recibe su propio resultado sin importar el
 * orden de resolución.
 *
 * Contrato completo en __tests__/useAddressZoneResolver.test.tsx (EC-AZ1..5).
 */

import { useCallback, useRef, useState } from 'react';

import { resolve_address_to_zone, type ResolveAddressZoneDeps } from '../lib/resolveAddressZone';
import type { PlaceSuggestion } from '../lib/placeSearch';

const OUT_OF_COVERAGE_MESSAGE = 'Esa dirección está fuera de las zonas disponibles por ahora';

export type AddressZoneResolution =
  | { kind: 'resolved'; zone: PlaceSuggestion; point: { lat: number; lng: number } }
  | { kind: 'out_of_coverage'; point: { lat: number; lng: number } }
  | { kind: 'error' };

export interface UseAddressZoneResolverState {
  resolving: boolean;
  resolve_error: string | null;
  resolve: (place_id: string) => Promise<AddressZoneResolution>;
}

export function useAddressZoneResolver(deps?: ResolveAddressZoneDeps): UseAddressZoneResolverState {
  const [resolving, set_resolving] = useState(false);
  const [resolve_error, set_resolve_error] = useState<string | null>(null);
  const request_id_ref = useRef(0);

  const resolve = useCallback(
    async (place_id: string): Promise<AddressZoneResolution> => {
      const request_id = ++request_id_ref.current;
      set_resolving(true);
      set_resolve_error(null);

      try {
        const result = await resolve_address_to_zone(place_id, deps);

        if (request_id === request_id_ref.current) {
          set_resolving(false);
          set_resolve_error(result.kind === 'out_of_coverage' ? OUT_OF_COVERAGE_MESSAGE : null);
        }

        return result;
      } catch (e) {
        if (request_id === request_id_ref.current) {
          set_resolving(false);
          set_resolve_error(e instanceof Error ? e.message : 'Error al resolver la dirección');
        }
        return { kind: 'error' };
      }
    },
    // ponytail: `deps` solo cambia en tests (DI); en prod es undefined estable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return { resolving, resolve_error, resolve };
}
