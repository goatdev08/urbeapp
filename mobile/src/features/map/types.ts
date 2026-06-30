/**
 * types.ts — Tipos compartidos del mapa global (#11).
 *
 * MapProperty: forma que devuelve fetchMapProperties tras convertir la
 * geography(Point,4326) de PostGIS a coordenadas planas { lat, lng }.
 * Cada campo se usa directamente por el marcador del mapa.
 *
 * ponytail: bedrooms/bathrooms son null-able porque la DB permite NULL
 * para lotes y locales comerciales. operation_type es un union exacto.
 */

export type MapProperty = {
  id: string;
  price: number;
  lat: number;
  lng: number;
  operation_type: 'rent' | 'sale' | 'both';
  property_type: string;
  bedrooms: number | null;
  bathrooms: number | null;
  address: string;
};
