/**
 * resolveAddressZone.ts — orquestación dirección→zona de catálogo (#232.2).
 *
 * 🔴 CRÍTICA (CLAUDE.md §5): esta función es el corazón del contrato pinneado
 * del carril de búsqueda unificada — "la zona guardada SIEMPRE es de
 * catálogo, jamás inventada". Compone dos libs ya probadas por separado:
 *   1. addressPlaces.fetch_place_location — Place Details (New) → lat/lng.
 *   2. placeAtPoint.resolve_place_at_point — RPC place_at_point → zona | null.
 *
 * Contrato (ver __tests__/resolveAddressZone.test.ts):
 *   - Sin location resoluble (Place Details sin `location`) → throw con un
 *     mensaje que MENCIONA "ubicación" — distinguible de "fuera de
 *     cobertura" (ese caso SÍ tiene point; este no tiene ni eso).
 *   - place_at_point → null (0 filas) → { kind: 'out_of_coverage', point }.
 *     El caller (hook/UI) es quien decide el copy exacto ("Esa dirección
 *     está fuera de las zonas disponibles por ahora") — este archivo solo
 *     entrega el dato estructurado, nunca un string de UI.
 *   - place_at_point → zona → { kind: 'resolved', zone, point }.
 *   - Cualquier error de las libs subyacentes se PROPAGA tal cual (throw) —
 *     mismo criterio que placeSearch/placeAtPoint (fail-loud a este nivel;
 *     el hook que llama decide el mensaje neutro).
 */

import { fetch_place_location, type AddressPlacesDeps } from './addressPlaces';
import { resolve_place_at_point } from './placeAtPoint';
import type { PlaceSearchDeps, PlaceSuggestion } from './placeSearch';

export interface ResolveAddressZoneDeps {
  address?: AddressPlacesDeps;
  zone?: PlaceSearchDeps;
}

export type ResolveAddressZoneResult =
  | { kind: 'resolved'; zone: PlaceSuggestion; point: { lat: number; lng: number } }
  | { kind: 'out_of_coverage'; point: { lat: number; lng: number } };

export async function resolve_address_to_zone(
  place_id: string,
  deps?: ResolveAddressZoneDeps,
): Promise<ResolveAddressZoneResult> {
  const point = await fetch_place_location(place_id, deps?.address);
  if (!point) {
    throw new Error('No se pudo obtener la ubicación de esa dirección');
  }

  const zone = await resolve_place_at_point(point.lat, point.lng, deps?.zone);
  if (!zone) {
    return { kind: 'out_of_coverage', point };
  }

  return { kind: 'resolved', zone, point };
}
