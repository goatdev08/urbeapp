/**
 * parseLocation.ts — Convierte la ubicación PostGIS a { lat, lng } para react-native-maps.
 *
 * PostgREST devuelve geography(Point,4326) en DOS formatos posibles:
 *   1. EWKB hex (lo que emite por defecto): "0101000020E6100000……" — little-endian.
 *   2. WKT texto "POINT(lng lat)" — solo si la query castea a ::text con ST_AsText.
 * parse_location acepta ambos.
 *
 * ⚠️ Orden crítico: lng (X) primero, lat (Y) segundo. Invertirlos es un bug
 *    silencioso que pone el marker en el lugar equivocado del mapa.
 *
 * Fail-safe: cualquier entrada inválida devuelve null, nunca lanza.
 */

/** Regex: captura dos números decimales (con signo opcional) en POINT(x y). */
const WKT_POINT_RE = /^POINT\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i;

/** Solo dígitos hex (EWKB). */
const HEX_RE = /^[0-9a-fA-F]+$/;

export type LatLng = { lat: number; lng: number };

/**
 * Parsea EWKB hex de un Point PostGIS y devuelve { lat, lng }.
 * Estructura (little-endian, NDR): 1 byte orden · 4 bytes tipo (con flags Z/M/SRID)
 * · [4 bytes SRID si flag] · 8 bytes X (lng) double · 8 bytes Y (lat) double.
 * Devuelve null si no es un Point o el hex está incompleto/corrupto.
 */
function parse_ewkb_point(hex: string): LatLng | null {
  // Longitud par y solo hex; mínimo: 1+4 bytes header (= 10 hex) antes de coords.
  if (hex.length % 2 !== 0 || !HEX_RE.test(hex)) return null;

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }

  const view = new DataView(bytes.buffer);
  let offset = 0;

  const order = bytes[offset];
  offset += 1;
  if (order !== 0 && order !== 1) return null; // 0 = big-endian (XDR), 1 = little (NDR)
  const little = order === 1;

  if (bytes.length < offset + 4) return null;
  const geo_type = view.getUint32(offset, little);
  offset += 4;

  // Solo Point (tipo base 1). Los bits altos son flags Z(0x80000000)/M(0x40000000)/SRID(0x20000000).
  if ((geo_type & 0xff) !== 1) return null;

  const has_srid = (geo_type & 0x20000000) !== 0;
  if (has_srid) offset += 4; // saltar SRID

  // Necesitamos 16 bytes para los dos doubles (X, Y).
  if (bytes.length < offset + 16) return null;

  const lng = view.getFloat64(offset, little); // X
  const lat = view.getFloat64(offset + 8, little); // Y

  if (isNaN(lat) || isNaN(lng)) return null;

  return { lat, lng };
}

/**
 * Parsea la ubicación PostGIS (EWKB hex o WKT "POINT(lng lat)") y devuelve { lat, lng }.
 * Devuelve null si la entrada es null, vacía, o no es un Point parseable.
 */
export function parse_location(location: string | null): LatLng | null {
  if (!location) return null;

  const trimmed = location.trim();

  // WKT texto "POINT(lng lat)"
  const match = WKT_POINT_RE.exec(trimmed);
  if (match) {
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

  // EWKB hex (formato por defecto de PostgREST para geography)
  return parse_ewkb_point(trimmed);
}
