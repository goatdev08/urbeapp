// supabase/functions/edit-property/location.ts
// Compara el campo `location` (dirección/coordenadas, PRD §15.5 — "una sola
// unidad crítica") entre el payload del cliente y el snapshot actual de la
// propiedad.
//
// ⚠️ Formatos NO coinciden entre origen y destino (verificado en vivo,
// bitácora 73.6): el cliente manda EWKT con prefijo SRID
// ("SRID=4326;POINT(lng lat)" — mobile/usePublish.ts), pero PostgREST emite
// geography(Point,4326) como EWKB hex por defecto
// ("0101000020E6100000…" — confirmado con curl contra REST_URL local). Una
// comparación de strings crudos entre ambos SIEMPRE sería "distinto" aunque
// las coordenadas sean idénticas — dispararía re-revisión en CADA edición sin
// tocar el mapa. Se parsean ambos lados a {lat,lng} numéricos y se comparan
// como números, agnóstico al formato de origen (mismo parser EWKB que
// mobile/src/features/property-detail/utils/parseLocation.ts, portado aquí
// porque ese archivo es RN-only y esta EF corre en Deno).

const EWKT_POINT_RE =
  /^(?:SRID=\d+;)?POINT\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i;
const HEX_RE = /^[0-9a-fA-F]+$/;

interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Parsea EWKB hex de un Point PostGIS (little/big-endian, con o sin SRID
 * embebido). Devuelve null si no es un Point o el hex está incompleto.
 */
function parse_ewkb_point(hex: string): LatLng | null {
  if (hex.length % 2 !== 0 || !HEX_RE.test(hex)) return null;

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }

  const view = new DataView(bytes.buffer);
  let offset = 0;

  const order = bytes[offset];
  offset += 1;
  if (order !== 0 && order !== 1) return null; // 0 = XDR, 1 = NDR
  const little = order === 1;

  if (bytes.length < offset + 4) return null;
  const geo_type = view.getUint32(offset, little);
  offset += 4;

  if ((geo_type & 0xff) !== 1) return null; // solo Point (tipo base 1)

  const has_srid = (geo_type & 0x20000000) !== 0;
  if (has_srid) offset += 4;

  if (bytes.length < offset + 16) return null;

  const lng = view.getFloat64(offset, little); // X
  const lat = view.getFloat64(offset + 8, little); // Y

  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}

/** Acepta EWKT ("[SRID=n;]POINT(lng lat)") o EWKB hex. Null si no parsea. */
function parse_location_point(location: string): LatLng | null {
  const trimmed = location.trim();
  const match = EWKT_POINT_RE.exec(trimmed);
  if (match) {
    const raw_lng = match[1];
    const raw_lat = match[2];
    if (raw_lng === undefined || raw_lat === undefined) return null;
    const lng = parseFloat(raw_lng);
    const lat = parseFloat(raw_lat);
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat, lng };
  }
  return parse_ewkb_point(trimmed);
}

/**
 * true si el usuario SÍ tocó el mapa (`input_location` definido) Y las
 * coordenadas resultantes son distintas a las actuales.
 * `input_location` AUSENTE (undefined) = "no se tocaron las coordenadas" →
 * SIEMPRE false, sin evaluar nada (contrato de EditPropertyInput.location,
 * ver types.ts) — nunca fuerza una re-revisión por sí solo.
 */
export function location_changed(
  input_location: string | undefined,
  current_location: string | null,
): boolean {
  if (input_location === undefined) return false;

  const input_point = parse_location_point(input_location);
  const current_point = current_location === null
    ? null
    : parse_location_point(current_location);

  // Fail-safe: si alguno de los dos no parsea (formato inesperado/corrupto),
  // no perder el cambio silenciosamente — cae a comparación de strings crudos.
  if (input_point === null || current_point === null) {
    return input_location !== current_location;
  }

  return input_point.lat !== current_point.lat ||
    input_point.lng !== current_point.lng;
}
