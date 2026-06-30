/**
 * parseLocation.test.ts — Tests unitarios para parse_location.
 *
 * Verifica el orden correcto de coordenadas WKT de PostGIS: POINT(lng lat).
 * El caso crítico es que lng y lat NO se inviertan.
 */
import { parse_location } from '../parseLocation';

describe('parse_location', () => {
  // ── Caso feliz ─────────────────────────────────────────────────────────────

  it('parsea "POINT(lng lat)" y devuelve { lat, lng } con el orden correcto', () => {
    const result = parse_location('POINT(-103.35 20.67)');
    expect(result).toEqual({ lat: 20.67, lng: -103.35 });
  });

  it('el primer número es lng y el segundo es lat (no invertidos)', () => {
    // -103.35 es longitud (México occidental), 20.67 es latitud
    const result = parse_location('POINT(-103.35 20.67)');
    expect(result?.lng).toBe(-103.35);
    expect(result?.lat).toBe(20.67);
  });

  it('parsea coordenadas positivas', () => {
    const result = parse_location('POINT(2.3488 48.8534)');
    expect(result).toEqual({ lat: 48.8534, lng: 2.3488 });
  });

  it('parsea sin decimales', () => {
    const result = parse_location('POINT(-99 19)');
    expect(result).toEqual({ lat: 19, lng: -99 });
  });

  it('tolera espacios extra dentro del POINT', () => {
    const result = parse_location('POINT(  -103.35  20.67  )');
    expect(result).toEqual({ lat: 20.67, lng: -103.35 });
  });

  it('es case-insensitive (POINT vs point)', () => {
    const result = parse_location('point(-103.35 20.67)');
    expect(result).toEqual({ lat: 20.67, lng: -103.35 });
  });

  // ── Casos null / vacío / malformado → null ─────────────────────────────────

  it('devuelve null cuando la entrada es null', () => {
    expect(parse_location(null)).toBeNull();
  });

  it('devuelve null cuando la entrada es string vacío', () => {
    expect(parse_location('')).toBeNull();
  });

  it('devuelve null con formato GeoJSON (no WKT)', () => {
    expect(parse_location('{"type":"Point","coordinates":[-103.35,20.67]}')).toBeNull();
  });

  it('devuelve null con hex EWKB', () => {
    // Formato que Supabase podría devolver si el cast no es TEXT
    expect(parse_location('0101000020E6100000...')).toBeNull();
  });

  it('devuelve null con WKT LineString', () => {
    expect(parse_location('LINESTRING(0 0, 1 1)')).toBeNull();
  });

  it('devuelve null con un número solo', () => {
    expect(parse_location('POINT(-103.35)')).toBeNull();
  });

  it('devuelve null con texto aleatorio', () => {
    expect(parse_location('no es un wkt')).toBeNull();
  });
});
