/**
 * constants.ts — constantes compartidas del mapa global (#11).
 *
 * Centrado por defecto: Guadalajara (la demo cerrada de 3 semanas opera ahí).
 * GDL_REGION es el FALLBACK mientras no hay coords reales: MapScreen usa
 * useLocation().coords cuando está disponible y recentra al llegar tarde
 * (tarea #42 / exploración 027); si el permiso de ubicación no se concede o
 * las coords nunca llegan, el mapa se queda en GDL.
 */

/** Región inicial del mapa global: Guadalajara, zoom de ciudad (~10 km). */
export const GDL_REGION = {
  latitude: 20.6736,
  longitude: -103.344,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
} as const;
