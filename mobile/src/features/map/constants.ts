/**
 * constants.ts — constantes compartidas del mapa global (#11).
 *
 * Centrado por defecto: Guadalajara (la demo cerrada de 3 semanas opera ahí).
 * Decisión del grilling #11: sin expo-location — el mapa siempre abre en GDL;
 * "centrar en mi ubicación" queda como trabajo futuro.
 */

/** Región inicial del mapa global: Guadalajara, zoom de ciudad (~10 km). */
export const GDL_REGION = {
  latitude: 20.6736,
  longitude: -103.344,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
} as const;
