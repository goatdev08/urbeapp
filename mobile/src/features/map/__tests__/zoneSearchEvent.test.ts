/**
 * Tests fase RED — zoneSearchEvent (lib pura)
 * Archivo SUT: mobile/src/features/map/lib/zoneSearchEvent.ts
 * Subtarea Taskmaster: 268.2 — zone_search: evento desde el mapa con dedupe
 * por sesión+zona (parte crítica de la tarea 268 "señales nuevas del CRM").
 *
 * SUT:
 *   ZONE_SEARCH_EVENT_TYPE: 'zone_search'
 *   normalize_zone_search_payload(payload): ZoneSearchPayload
 *   zone_search_key(session_id, payload): string
 *   create_zone_search_store(): { has_seen, mark_seen }
 *
 * Contrato (contexto verificado en la subtarea 268.2, sin PRD § — feature
 * derivada de la exploración de señales CRM, patrón copiado de
 * videoEngagementDedupe.ts / 112.2):
 *   - El pill "Buscar en esta zona" produce un CÍRCULO (viewport_to_area):
 *     {kind:'area', center:{lat,lng}, radius_m}. Colonia/municipio son
 *     passthrough por id.
 *   - normalize_zone_search_payload: neighborhood/municipality pasan tal
 *     cual (mismo shape, SIN claves extra — nunca property_id). area redondea
 *     center.lat/center.lng a 3 decimales y radius_m a entero, sin -0.
 *     NUNCA lanza con coordenadas finitas.
 *   - zone_search_key: clave determinista por (session_id, zona normalizada).
 *     Formato `${session_id}::${kind}::${id}` para neighborhood/municipality
 *     y `${session_id}::area::${lat}:${lng}:${radius_m}` (normalizados) para
 *     área. Dos áreas con el MISMO redondeo → MISMA clave (esa es la base del
 *     dedupe: dos paneos casi idénticos del mapa no deben generar 2 filas).
 *     session_id distinto → clave distinta. Mismo id con kind distinto
 *     (neighborhood vs municipality) → clave distinta (NO deben colisionar
 *     solo porque comparten el mismo id numérico de catálogo).
 *   - El store de dedupe (Set) es independiente entre instancias — mismo
 *     espíritu que create_video_engagement_store, pero sin event_type ni
 *     property_id (la clave ya viene resuelta desde afuera).
 *
 * EDGE CASES CUBIERTOS (18 casos):
 *
 * ### Happy path — normalize
 * - (EC-1) normalize_neighborhood_pasa_a_traves_sin_cambios
 * - (EC-2) normalize_municipality_pasa_a_traves_sin_cambios
 * - (EC-3) normalize_area_redondea_lat_lng_a_3_decimales_y_radius_a_entero
 *
 * ### Happy path — zone_search_key
 * - (EC-4) zone_search_key_neighborhood_formato_esperado
 * - (EC-5) zone_search_key_municipality_formato_esperado
 * - (EC-6) zone_search_key_area_usa_valores_normalizados
 *
 * ### Ramas de reglas no obvias — dedupe determinista (requisito central 268.2)
 * - (EC-7) dos_areas_con_mismo_redondeo_producen_la_misma_clave
 * - (EC-8) mismo_session_distinta_zona_produce_clave_distinta
 * - (EC-9) distinto_session_misma_zona_produce_clave_distinta
 * - (EC-10) mismo_id_neighborhood_vs_municipality_producen_claves_distintas
 * - (EC-11) normalize_nunca_incluye_property_id
 *
 * ### Boundary / error — normalize de área
 * - (EC-12) normalize_area_evita_negative_zero_en_lat_o_lng
 * - (EC-13) normalize_area_no_lanza_con_coordenadas_finitas
 * - (EC-14) normalize_area_radius_decimal_intermedio_redondea_al_entero_mas_cercano
 *
 * ### Store de dedupe
 * - (EC-15) store_nuevo_no_ha_visto_nada
 * - (EC-16) mark_seen_hace_que_has_seen_devuelva_true
 * - (EC-17) mark_seen_repetido_es_idempotente
 * - (EC-18) stores_independientes_no_comparten_estado
 */

import {
  ZONE_SEARCH_EVENT_TYPE,
  normalize_zone_search_payload,
  zone_search_key,
  create_zone_search_store,
  type ZoneSearchPayload,
} from '../lib/zoneSearchEvent';

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const SESSION_A = 'sesion-uuid-primera-visita';
const SESSION_B = 'sesion-uuid-app-reabierta';

const NEIGHBORHOOD_PAYLOAD: ZoneSearchPayload = {
  kind: 'neighborhood',
  neighborhood_id: '42',
};

const MUNICIPALITY_PAYLOAD: ZoneSearchPayload = {
  kind: 'municipality',
  municipality_id: '42',
};

// ---------------------------------------------------------------------------
// ZONE_SEARCH_EVENT_TYPE
// ---------------------------------------------------------------------------

describe('ZONE_SEARCH_EVENT_TYPE', () => {
  it('es el literal "zone_search"', () => {
    expect(ZONE_SEARCH_EVENT_TYPE).toBe('zone_search');
  });
});

// ---------------------------------------------------------------------------
// normalize_zone_search_payload
// ---------------------------------------------------------------------------

describe('normalize_zone_search_payload', () => {
  it('(EC-1) normalize_neighborhood_pasa_a_traves_sin_cambios: {kind:"neighborhood", neighborhood_id} → mismo shape exacto', () => {
    expect(normalize_zone_search_payload(NEIGHBORHOOD_PAYLOAD)).toEqual({
      kind: 'neighborhood',
      neighborhood_id: '42',
    });
  });

  it('(EC-2) normalize_municipality_pasa_a_traves_sin_cambios: {kind:"municipality", municipality_id} → mismo shape exacto', () => {
    expect(normalize_zone_search_payload(MUNICIPALITY_PAYLOAD)).toEqual({
      kind: 'municipality',
      municipality_id: '42',
    });
  });

  it('(EC-3) normalize_area_redondea_lat_lng_a_3_decimales_y_radius_a_entero: center={19.4326001,-99.1332001}, radius_m=500.4 → {lat:19.433, lng:-99.133, radius_m:500}', () => {
    const input: ZoneSearchPayload = {
      kind: 'area',
      center: { lat: 19.4326001, lng: -99.1332001 },
      radius_m: 500.4,
    };
    expect(normalize_zone_search_payload(input)).toEqual({
      kind: 'area',
      center: { lat: 19.433, lng: -99.133 },
      radius_m: 500,
    });
  });

  it('(EC-11) normalize_nunca_incluye_property_id: ningún resultado de normalize (de ninguno de los 3 kinds) trae la clave property_id', () => {
    const area_input: ZoneSearchPayload = {
      kind: 'area',
      center: { lat: 20.5, lng: -103.3 },
      radius_m: 800,
    };
    expect(normalize_zone_search_payload(NEIGHBORHOOD_PAYLOAD)).not.toHaveProperty('property_id');
    expect(normalize_zone_search_payload(MUNICIPALITY_PAYLOAD)).not.toHaveProperty('property_id');
    expect(normalize_zone_search_payload(area_input)).not.toHaveProperty('property_id');
  });

  it('(EC-12) normalize_area_evita_negative_zero_en_lat_o_lng: center={-0.0001, 0.0001} (redondea a -0/0 crudo) → {lat:0, lng:0}, NUNCA -0', () => {
    const input: ZoneSearchPayload = {
      kind: 'area',
      center: { lat: -0.0001, lng: 0.0001 },
      radius_m: 300,
    };
    const result = normalize_zone_search_payload(input) as Extract<ZoneSearchPayload, { kind: 'area' }>;
    expect(Object.is(result.center.lat, -0)).toBe(false);
    expect(result.center.lat).toBe(0);
    expect(result.center.lng).toBe(0);
  });

  it('(EC-13) normalize_area_no_lanza_con_coordenadas_finitas: coordenadas extremas pero finitas (polos, antimeridiano) → no lanza', () => {
    const input: ZoneSearchPayload = {
      kind: 'area',
      center: { lat: 89.999999, lng: 179.999999 },
      radius_m: 50000,
    };
    expect(() => normalize_zone_search_payload(input)).not.toThrow();
  });

  it('(EC-14) normalize_area_radius_decimal_intermedio_redondea_al_entero_mas_cercano: radius_m=250.5 → 251 (Math.round)', () => {
    const input: ZoneSearchPayload = {
      kind: 'area',
      center: { lat: 20, lng: -100 },
      radius_m: 250.5,
    };
    const result = normalize_zone_search_payload(input) as Extract<ZoneSearchPayload, { kind: 'area' }>;
    expect(result.radius_m).toBe(251);
  });
});

// ---------------------------------------------------------------------------
// zone_search_key
// ---------------------------------------------------------------------------

describe('zone_search_key', () => {
  it('(EC-4) zone_search_key_neighborhood_formato_esperado: (session_id, {kind:"neighborhood", neighborhood_id:"42"}) → "sesion-uuid-primera-visita::neighborhood::42"', () => {
    expect(zone_search_key(SESSION_A, NEIGHBORHOOD_PAYLOAD)).toBe(
      'sesion-uuid-primera-visita::neighborhood::42'
    );
  });

  it('(EC-5) zone_search_key_municipality_formato_esperado: (session_id, {kind:"municipality", municipality_id:"42"}) → "sesion-uuid-primera-visita::municipality::42"', () => {
    expect(zone_search_key(SESSION_A, MUNICIPALITY_PAYLOAD)).toBe(
      'sesion-uuid-primera-visita::municipality::42'
    );
  });

  it('(EC-6) zone_search_key_area_usa_valores_normalizados: center={19.4326001,-99.1332001}, radius_m=500.4 → "sesion-uuid-primera-visita::area::19.433:-99.133:500" (usa el redondeo, NUNCA las coords crudas)', () => {
    const payload: ZoneSearchPayload = {
      kind: 'area',
      center: { lat: 19.4326001, lng: -99.1332001 },
      radius_m: 500.4,
    };
    expect(zone_search_key(SESSION_A, payload)).toBe(
      'sesion-uuid-primera-visita::area::19.433:-99.133:500'
    );
  });

  it('(EC-7) dos_areas_con_mismo_redondeo_producen_la_misma_clave: dos paneos casi idénticos del mapa (19.43299 vs 19.43301, ambos redondean a 19.433) con el mismo radius_m → MISMA clave — base del dedupe', () => {
    const payload_1: ZoneSearchPayload = {
      kind: 'area',
      center: { lat: 19.43299, lng: -99.13301 },
      radius_m: 500,
    };
    const payload_2: ZoneSearchPayload = {
      kind: 'area',
      center: { lat: 19.43301, lng: -99.13299 },
      radius_m: 500,
    };
    expect(zone_search_key(SESSION_A, payload_1)).toBe(zone_search_key(SESSION_A, payload_2));
  });

  it('(EC-8) mismo_session_distinta_zona_produce_clave_distinta: misma sesión, dos neighborhood_id distintos → claves distintas', () => {
    const key_1 = zone_search_key(SESSION_A, { kind: 'neighborhood', neighborhood_id: '42' });
    const key_2 = zone_search_key(SESSION_A, { kind: 'neighborhood', neighborhood_id: '43' });
    expect(key_1).not.toBe(key_2);
  });

  it('(EC-9) distinto_session_misma_zona_produce_clave_distinta: misma zona, session_id distinto → claves distintas (insumo de "volvió a buscar en otra sesión")', () => {
    const key_a = zone_search_key(SESSION_A, NEIGHBORHOOD_PAYLOAD);
    const key_b = zone_search_key(SESSION_B, NEIGHBORHOOD_PAYLOAD);
    expect(key_a).not.toBe(key_b);
  });

  it('(EC-10) mismo_id_neighborhood_vs_municipality_producen_claves_distintas: id de catálogo "42" compartido entre colonia y municipio (namespaces DISTINTOS) → NO deben colisionar', () => {
    const key_neighborhood = zone_search_key(SESSION_A, { kind: 'neighborhood', neighborhood_id: '42' });
    const key_municipality = zone_search_key(SESSION_A, { kind: 'municipality', municipality_id: '42' });
    expect(key_neighborhood).not.toBe(key_municipality);
  });
});

// ---------------------------------------------------------------------------
// create_zone_search_store
// ---------------------------------------------------------------------------

describe('create_zone_search_store', () => {
  it('(EC-15) store_nuevo_no_ha_visto_nada: has_seen(cualquier clave) → false en un store recién creado', () => {
    const store = create_zone_search_store();
    expect(store.has_seen('sesion-uuid-primera-visita::neighborhood::42')).toBe(false);
  });

  it('(EC-16) mark_seen_hace_que_has_seen_devuelva_true: mark_seen(key) seguido de has_seen(key) → true', () => {
    const store = create_zone_search_store();
    const key = 'sesion-uuid-primera-visita::neighborhood::42';
    store.mark_seen(key);
    expect(store.has_seen(key)).toBe(true);
  });

  it('(EC-17) mark_seen_repetido_es_idempotente: mark_seen(key) dos veces → has_seen(key) sigue true, sin lanzar', () => {
    const store = create_zone_search_store();
    const key = 'sesion-uuid-primera-visita::area::19.433:-99.133:500';
    store.mark_seen(key);
    expect(() => store.mark_seen(key)).not.toThrow();
    expect(store.has_seen(key)).toBe(true);
  });

  it('(EC-18) stores_independientes_no_comparten_estado: mark_seen en un store NO afecta a otro store distinto con la MISMA clave', () => {
    const store_1 = create_zone_search_store();
    const store_2 = create_zone_search_store();
    const key = 'sesion-uuid-primera-visita::municipality::42';
    store_1.mark_seen(key);
    expect(store_1.has_seen(key)).toBe(true);
    expect(store_2.has_seen(key)).toBe(false);
  });
});
