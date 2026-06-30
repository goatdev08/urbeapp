/**
 * parseLocation.ts — Convierte WKT de PostGIS a { lat, lng } para react-native-maps.
 *
 * PostgREST devuelve geography(Point,4326) como texto WKT: "POINT(lng lat)".
 * ⚠️ Orden crítico: lng (X) primero, lat (Y) segundo. Invertirlos es un bug
 *    silencioso que pone el marker en el lugar equivocado del mapa.
 *
 * Fail-safe: cualquier entrada inválida devuelve null, nunca lanza.
 *
 * ponytail: regex mínimo — cubre el único formato que PostgREST emite con
 *   ST_Point(lng,lat,4326). Si en algún momento Supabase devolviera hex EWKB
 *   (ej. "0101000020E6100000..."), esta función devuelve null y lo ignoramos.
 */

/** Regex: captura dos números decimales (con signo opcional) en POINT(x y). */
const WKT_POINT_RE = /^POINT\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i;

export type LatLng = { lat: number; lng: number };

/**
 * Parsea un WKT "POINT(lng lat)" de PostGIS y devuelve { lat, lng }.
 * Devuelve null si la entrada es null, vacía, o no coincide con el patrón WKT.
 */
export function parse_location(wkt: string | null): LatLng | null {
  if (!wkt) return null;

  const match = WKT_POINT_RE.exec(wkt.trim());
  if (!match) return null;

  // match[1] = lng (X), match[2] = lat (Y) — PostGIS POINT(lng lat)
  // Strict TS: regex captures typed as string|undefined; guard after non-null match check.
  const raw_lng = match[1];
  const raw_lat = match[2];
  if (raw_lng === undefined || raw_lat === undefined) return null;

  const lng = parseFloat(raw_lng);
  const lat = parseFloat(raw_lat);

  if (isNaN(lat) || isNaN(lng)) return null;

  return { lat, lng };
}
