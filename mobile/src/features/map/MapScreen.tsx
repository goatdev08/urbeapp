/**
 * MapScreen.tsx — Mapa global de propiedades (#11, pantalla canónica "6·MAPA").
 *
 * Integración completa (11.6): MapView centrado en GDL, pins + clusters,
 * mini-card flotante al seleccionar un pin, y navegación a /property/:id.
 *
 * Decisiones:
 * - Sin expo-location (grilling #11): centrado fijo en GDL_REGION.
 * - MapContent separado de MapErrorBoundary para poder usar hooks (hooks ≠ clases).
 * - PropertyMiniCard se monta FUERA del MapView para z-index correcto en Android
 *   (el Callout nativo tiene bugs en Android — ver PropertyMiniCard.tsx).
 * - zoom_to_cluster: animateToRegion con latitudeDelta/longitudeDelta / 2 → zoom-in.
 *
 * ponytail: useMemo en clustered — evita re-clusterizar en cada render;
 *   solo recalcula cuando data o region cambian.
 */
import React, { Component, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, StyleSheet, Text, View } from 'react-native';
import MapView, { Polygon, Region } from 'react-native-maps';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme/theme';
import { useLocation } from '@/features/location/LocationProvider';
import { useFilters } from '../search/filterStore';
import { GDL_REGION } from './constants';
import { useMapProperties } from './hooks/useMapProperties';
import { usePlaceSearch } from './hooks/usePlaceSearch';
import { cluster_properties } from './lib/clusterMarkers';
import { viewport_to_area } from './lib/viewportToArea';
import { bbox_to_region } from './lib/bboxRegion';
import { fetch_neighborhood_polygon, type NeighborhoodPolygon } from './lib/neighborhoodPolygon';
import type { PlaceBBox, PlaceSuggestion } from './lib/placeSearch';
import { PropertyMarker } from './components/PropertyMarker';
import { ClusterMarker } from './components/ClusterMarker';
import { PropertyMiniCard } from './components/PropertyMiniCard';
import { AreaSearchPill } from './components/AreaSearchPill';
import { MapSearchBar } from './components/MapSearchBar';
import { PlaceSearch } from './components/PlaceSearch';
import { FilterSheet } from '../search/components/FilterSheet';
import { ZoneActiveChip } from '../search/components/ZoneActiveChip';
import type { MapProperty } from './types';

/** Municipio activo (#232) — id/bbox para la RPC properties_within_municipality
 * + name para el chip. Estado local de MapScreen, mismo espíritu que
 * neighborhood_id (decisión D6 de #157: no vive en FilterState). */
interface ActiveMunicipality {
  id: string;
  bbox: PlaceBBox;
  name: string;
}

/**
 * Alto aproximado de MapSearchBar (#56.5, mini-spec): paddingVertical s_12*2
 * (24) + fila de contenido ~20px (ícono/input) + borde 1px*2 — el chip de
 * zona se ancla debajo de la barra con un gap de s_8 para no encimarse
 * (mismo patrón geométrico que AreaSearchPill.tsx: constantes locales
 * derivadas de spacing.*, sin token nuevo en theme.ts).
 */
const MAP_SEARCH_BAR_HEIGHT_APPROX = spacing.s_24 * 2;

/**
 * Debounce (ms) tras terminar de panear/zoomear antes de mostrar el pill
 * "Buscar en esta zona" — patrón Airbnb (#56.4, ver
 * .taskmaster/docs/exploraciones/030-buscar-en-esta-zona.md).
 */
const AREA_PILL_DEBOUNCE_MS = 500;

/**
 * Delta de zoom (#232.3) al centrar en un punto de dirección FUERA de
 * cobertura del catálogo (place_at_point → 0 filas): sin polígono ni bbox
 * que encuadrar, solo un zoom "a nivel de calle" fijo — mismo orden de
 * magnitud que MIN_DELTA de bboxRegion.ts pero un poco más abierto (una
 * dirección puntual, no un bbox ya calculado).
 */
const ADDRESS_POINT_DELTA = 0.01;

/**
 * Mensaje visible cuando el fetch del polígono de una colonia (RPC
 * get_neighborhood_geojson, vía fetch_neighborhood_polygon) rechaza —
 * candado del guardian (#233, hallazgo 1): el catch de handle_select_place
 * era MUDO pese a que el testStrategy de #161 pedía "mensaje visible".
 * Reusa el mecanismo de error ya existente en esta pantalla
 * (styles.error_overlay/error_text, hoy solo alimentado por el error de
 * useMapProperties) — cero UI nueva.
 */
export const NEIGHBORHOOD_POLYGON_ERROR_MESSAGE =
  'No se pudo cargar el polígono de esa colonia. Intenta de nuevo.';

// ─────────────────────────────────────────────────────────────────────────────
// Error Boundary — evita crash si el módulo nativo no está enlazado
// ─────────────────────────────────────────────────────────────────────────────

interface BoundaryState {
  error: boolean;
}

class MapErrorBoundary extends Component<{ children: React.ReactNode }, BoundaryState> {
  state: BoundaryState = { error: false };

  static getDerivedStateFromError(): BoundaryState {
    return { error: true };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.fallback}>
          <Text style={styles.fallback_text}>Mapa no disponible en este build.</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipo auxiliar — subconjunto de cluster usado por zoom_to_cluster
// ─────────────────────────────────────────────────────────────────────────────

type ClusterCoords = {
  latitude: number;
  longitude: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// MapContent — lógica + hooks (separado del class boundary)
// ─────────────────────────────────────────────────────────────────────────────

function MapContent(): React.JSX.Element {
  const router = useRouter();
  const map_ref = useRef<MapView>(null);
  const insets = useSafeAreaInsets();

  const { filters, set_filter, active_filter_count } = useFilters();

  // Ubicación real (LocationProvider, permiso obligatorio #41): centra el mapa
  // en la ciudad del usuario en vez de GDL fija. Fallback: GDL_REGION.
  const { coords: user_coords } = useLocation();

  // ── Búsqueda de lugares + colonia/municipio seleccionados (#157, #232) ────
  // Colonia/municipio son estado LOCAL del mapa (decisión D6: no viven en
  // FilterState — el feed no los consume). Fluyen como 3er/4to parámetro a
  // useMapProperties; active_polygon pinta el perímetro de colonia.
  // coords (#232): activa ranking por cercanía en search_places, igual que
  // el resto del mapa (useMapProperties ya usa user_coords para proximidad).
  const place_search = usePlaceSearch(
    undefined,
    user_coords ? { lat: user_coords.latitude, lng: user_coords.longitude } : null,
  );
  const [neighborhood_id, set_neighborhood_id] = useState<string | null>(null);
  const [active_polygon, set_active_polygon] = useState<NeighborhoodPolygon | null>(null);
  const [municipality, set_municipality] = useState<ActiveMunicipality | null>(null);
  // Candado #233.1: mensaje visible cuando el fetch del polígono rechaza.
  const [polygon_error, set_polygon_error] = useState<string | null>(null);

  const { data, loading, error } = useMapProperties(undefined, filters, neighborhood_id, municipality);
  const [initial_region] = useState<Region>(() =>
    user_coords !== null
      ? {
          latitude: user_coords.latitude,
          longitude: user_coords.longitude,
          latitudeDelta: GDL_REGION.latitudeDelta,
          longitudeDelta: GDL_REGION.longitudeDelta,
        }
      : GDL_REGION,
  );
  const [region, set_region] = useState<Region>(initial_region);
  const [selected, set_selected] = useState<MapProperty | null>(null);
  const [filter_visible, set_filter_visible] = useState(false);
  const [show_area_pill, set_show_area_pill] = useState(false);
  const area_pill_timer_ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Anti-stale (#161, bug 2): contador de request de handle_select_place —
  // solo el ÚLTIMO fetch de polígono en vuelo puede mutar el estado de zona
  // activa. Mismo patrón que usePlaceSearch/useAddressSearch.
  const select_request_id_ref = useRef(0);

  /*
   * coords_used_ref: arranca en true si ya montamos con coords reales (nada que
   * animar). Si montamos con el fallback GDL (coords aún null), arranca en
   * false y el effect de abajo recentra UNA sola vez cuando las coords lleguen
   * tarde — el gate de (protected)/_layout.tsx deja pasar el estado `loading`,
   * así que MapScreen puede montar antes de que useLocation() resuelva.
   */
  const coords_used_ref = useRef(user_coords !== null);

  useEffect(() => {
    if (user_coords !== null && !coords_used_ref.current && map_ref.current) {
      map_ref.current.animateToRegion(
        {
          latitude: user_coords.latitude,
          longitude: user_coords.longitude,
          latitudeDelta: GDL_REGION.latitudeDelta,
          longitudeDelta: GDL_REGION.longitudeDelta,
        },
        300,
      );
      coords_used_ref.current = true;
    }
  }, [user_coords]);

  /*
   * #157 (D7): el filtro cliente trivial de #11.7 (includes sobre address/
   * property_type) se SUSTITUYE por el autocomplete server-side — la barra
   * ahora busca LUGARES (colonias/municipios), no texto de propiedades.
   * clustered deriva directo de data. tracksViewChanges={false} en markers
   * (ver PropertyMarker.tsx) evita re-renders por frame con 50+ pins.
   */
  const clustered = useMemo(
    () => cluster_properties(data ?? [], region),
    [data, region],
  );

  // Limpia el timer del pill "Buscar en esta zona" al desmontar (evita fugas).
  useEffect(() => {
    return () => {
      if (area_pill_timer_ref.current !== null) {
        clearTimeout(area_pill_timer_ref.current);
      }
    };
  }, []);

  /**
   * Handler de `onRegionChangeComplete`: guarda la región (comportamiento
   * previo intacto) y arranca un debounce de 500ms — el pill "Buscar en esta
   * zona" solo aparece cuando el usuario TERMINA de panear/zoomear (patrón
   * Airbnb), no en cada frame intermedio.
   * ponytail: setTimeout/clearTimeout a mano, sin librería de debounce.
   */
  function handle_region_change_complete(next_region: Region): void {
    set_region(next_region);

    if (area_pill_timer_ref.current !== null) {
      clearTimeout(area_pill_timer_ref.current);
    }
    area_pill_timer_ref.current = setTimeout(() => {
      set_show_area_pill(true);
      area_pill_timer_ref.current = null;
    }, AREA_PILL_DEBOUNCE_MS);
  }

  /**
   * onPress del pill: convierte el viewport actual a {center, radius_m}
   * (#56.1), lo setea como `filters.area` y navega al feed — la capa de
   * datos (56.3) ya reacciona sola al cambio de `area`, sin plomería extra.
   * #157 (D9): además limpia la colonia/municipio activos — son todos
   * mutuamente excluyentes (dos acotaciones simultáneas serían ambiguas).
   */
  function handle_area_search(): void {
    const area = viewport_to_area(region);
    set_filter('area', area);
    set_show_area_pill(false);
    clear_neighborhood();
    set_municipality(null);
    router.push('/');
  }

  /** Quita la colonia activa (perímetro + filtro). */
  function clear_neighborhood(): void {
    set_neighborhood_id(null);
    set_active_polygon(null);
  }

  /**
   * Selección de una sugerencia del buscador unificado (#157.8, #232.3) —
   * catálogo directo O dirección ya resuelta a zona de catálogo (PlaceSearch
   * llama esta MISMA función con el resultado de resolve_address_to_zone;
   * `meta` se ignora aquí, solo lo usa ads/step4 para el hint de UI).
   *
   * - Colonia: baja su polígono (get_neighborhood_geojson), lo dibuja, encuadra
   *   el bbox con fitToCoordinates y activa el filtro espacial (neighborhood_id
   *   → RPC properties_within_neighborhood). Limpia `filters.area` + municipio
   *   (D9) — pero SOLO dentro del bloque de ÉXITO del fetch (#161 fix 1): un
   *   fetch fallido o tardío YA NO destruye la zona activa previa.
   * - Municipio (#232): filtra vía RPC properties_within_municipality (ya no
   *   el círculo clamped a 50km de #157) — encuadra su bbox precalculado (D4)
   *   con animateToRegion, igual que antes. bbox null (municipio sin colonias
   *   cargadas) → solo limpia colonia, sin encuadre ni filtro (D4, limitación
   *   pre-existente).
   * - Anti-stale (#161 fix 2): un request_id en ref descarta el fetch de
   *   polígono que resuelve TARDE si el usuario ya seleccionó otra cosa.
   *
   * En ambos casos la barra se limpia: el estado visible queda en el CHIP
   * ("<Nombre> · Quitar"), no en el texto de la barra.
   */
  async function handle_select_place(
    suggestion: PlaceSuggestion,
    _meta?: { source: 'address'; address_text: string },
  ): Promise<void> {
    const request_id = ++select_request_id_ref.current;
    place_search.clear();
    Keyboard.dismiss();
    set_polygon_error(null); // nueva selección — descarta el error de la anterior

    if (suggestion.kind === 'neighborhood') {
      try {
        const polygon = await fetch_neighborhood_polygon(suggestion.id);
        if (request_id !== select_request_id_ref.current) return; // selección más nueva ya ganó

        if (polygon) {
          set_filter('area', null); // D9: excluyentes — DENTRO del bloque de éxito
          set_municipality(null);
          set_active_polygon(polygon);
          set_neighborhood_id(suggestion.id);
          fit_bbox(polygon.bbox);
          return;
        }
        // Colonia sin polígono (not-found): fail-soft, encuadra si hay bbox,
        // pero NO toca el filtro/zona previamente activos.
        if (suggestion.bbox) fit_bbox(suggestion.bbox);
      } catch {
        // fail-soft (#161 fix 1): fetch falló — el filtro/zona ANTERIOR queda
        // intacto. Encuadra igual si hay bbox (best-effort visual). #233.1:
        // el catch ya NO es mudo — mensaje visible vía polygon_error.
        if (request_id === select_request_id_ref.current) {
          set_polygon_error(NEIGHBORHOOD_POLYGON_ERROR_MESSAGE);
          if (suggestion.bbox) fit_bbox(suggestion.bbox);
        }
      }
      return;
    }

    // Municipio (#232.3): RPC properties_within_municipality en vez del
    // círculo clamped a 50km (D4/D5 viejo, ver mapProperties.ts).
    clear_neighborhood();
    if (!suggestion.bbox) {
      set_municipality(null);
      return; // sin colonias cargadas → sin encuadre ni filtro (D4)
    }
    const muni_region = bbox_to_region(suggestion.bbox);
    map_ref.current?.animateToRegion(muni_region, 400);
    set_filter('area', null); // D9: el municipio ya no vive en filters.area
    set_municipality({ id: suggestion.id, bbox: suggestion.bbox, name: suggestion.name });
    set_show_area_pill(false);
  }

  /**
   * Dirección FUERA de cobertura del catálogo (#232.3 — place_at_point → 0
   * filas): centra la cámara en el punto geocodificado SIN aplicar ningún
   * filtro (el usuario ve dónde cae la dirección, pero el mapa no inventa
   * una zona). No toca neighborhood_id/municipality/filters.area existentes.
   */
  function handle_address_out_of_coverage(point: { lat: number; lng: number }): void {
    map_ref.current?.animateToRegion(
      {
        latitude: point.lat,
        longitude: point.lng,
        latitudeDelta: ADDRESS_POINT_DELTA,
        longitudeDelta: ADDRESS_POINT_DELTA,
      },
      400,
    );
  }

  /** Encuadra un bbox con padding — para el perímetro de colonia. */
  function fit_bbox(bbox: { min_lat: number; min_lng: number; max_lat: number; max_lng: number }): void {
    map_ref.current?.fitToCoordinates(
      [
        { latitude: bbox.min_lat, longitude: bbox.min_lng },
        { latitude: bbox.max_lat, longitude: bbox.max_lng },
      ],
      {
        edgePadding: { top: 140, right: 40, bottom: 140, left: 40 },
        animated: true,
      },
    );
  }

  /** Centra y hace zoom-in sobre el cluster tocado. */
  function zoom_to_cluster(cluster: ClusterCoords): void {
    map_ref.current?.animateToRegion(
      {
        latitude: cluster.latitude,
        longitude: cluster.longitude,
        latitudeDelta: region.latitudeDelta / 2,
        longitudeDelta: region.longitudeDelta / 2,
      },
      300,
    );
  }

  return (
    <View style={styles.container}>
      {/* ── Mapa principal ──────────────────────────────────────────────── */}
      <MapView
        ref={map_ref}
        style={styles.map}
        initialRegion={initial_region}
        onRegionChangeComplete={handle_region_change_complete}
        onPress={() => set_selected(null)}
        showsUserLocation
        showsMyLocationButton
      >
        {/*
         * #157: perímetro de la colonia seleccionada. Un <Polygon> por anillo
         * exterior (las colonias multipolígono del DCAH son raras pero existen).
         * Relleno primary al 10% + trazo primary — persiste al panear (D9);
         * solo lo quitan el chip o el pill "Buscar en esta zona".
         */}
        {active_polygon?.polygons.map((ring, index) => (
          <Polygon
            key={`${active_polygon.id}-${index}`}
            coordinates={ring}
            strokeColor={colors.primary}
            strokeWidth={2}
            fillColor="rgba(26, 94, 68, 0.10)"
          />
        ))}
        {clustered.map((item) => {
          if (item.type === 'point') {
            return (
              <PropertyMarker
                key={item.property.id}
                property={item.property}
                onPress={set_selected}
              />
            );
          }
          return (
            <ClusterMarker
              key={item.cluster.id}
              cluster={item.cluster}
              onPress={() => zoom_to_cluster(item.cluster)}
            />
          );
        })}
      </MapView>

      {/* ── Mini-card flotante (fuera del MapView → z-index correcto) ───── */}
      {selected !== null && (
        <PropertyMiniCard
          property={selected}
          onPress={() => router.push(`/property/${selected.id}`)}
        />
      )}

      {/* ── Pill "Buscar en esta zona" (#56.4) — aparece 500ms tras panear/zoomear ── */}
      {show_area_pill && (
        <AreaSearchPill
          on_press={handle_area_search}
          lifted={selected !== null}
        />
      )}

      {/* ── Overlay de carga — ActivityIndicator discreto arriba ─────────── */}
      {loading && (
        <View style={styles.loading_overlay} pointerEvents="none">
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      )}

      {/* ── Overlay de error — texto discreto, no rompe el mapa ─────────── */}
      {error !== null && !loading && (
        <View style={styles.error_overlay} pointerEvents="none">
          <Text style={styles.error_text}>{error}</Text>
        </View>
      )}

      {/*
       * ── Overlay de error del fetch de polígono (#233.1) ───────────────
       * Mismo mecanismo/estilo que el overlay de arriba (error_overlay/
       * error_text) — el catch de handle_select_place ya NO es mudo.
       */}
      {polygon_error !== null && (
        <View style={styles.error_overlay} pointerEvents="none">
          <Text style={styles.error_text}>{polygon_error}</Text>
        </View>
      )}

      {/*
       * Chip "Zona activa · Quitar" (#56.5) — persistente mientras
       * filters.area != null (viene del pill "Buscar en esta zona" de
       * arriba). Se ancla debajo de MapSearchBar (misma coordenada left/right
       * s_16 conceptual, pero centrado) para no encimarse con ella.
       * onPress revierte a modo cercanía GPS (#42).
       */}
      {filters.area != null && (
        <ZoneActiveChip
          on_press={() => set_filter('area', null)}
          style={{
            top: insets.top + spacing.s_8 + MAP_SEARCH_BAR_HEIGHT_APPROX + spacing.s_8,
          }}
        />
      )}

      {/*
       * Chip de colonia activa (#157.8) — mismo componente, con el nombre de
       * la colonia como label ("Chapalita · Quitar"). Nunca coexiste con el
       * chip de area ni con el de municipio (D9: mutuamente excluyentes), así
       * que comparten ancla.
       */}
      {active_polygon != null && (
        <ZoneActiveChip
          label={active_polygon.name}
          on_press={clear_neighborhood}
          style={{
            top: insets.top + spacing.s_8 + MAP_SEARCH_BAR_HEIGHT_APPROX + spacing.s_8,
          }}
        />
      )}

      {/* Chip de municipio activo (#232.3) — mismo mecanismo que colonia. */}
      {municipality != null && (
        <ZoneActiveChip
          label={municipality.name}
          on_press={() => set_municipality(null)}
          style={{
            top: insets.top + spacing.s_8 + MAP_SEARCH_BAR_HEIGHT_APPROX + spacing.s_8,
          }}
        />
      )}

      {/* ── Barra de búsqueda flotante — overlay superior (z-index último) ── */}
      {/*
       * Renderizado después del MapView y los overlays para quedar por encima
       * (orden de render = z-index en RN). Los taps en la barra no alcanzan
       * el onPress del MapView (set_selected(null)) porque la barra está fuera
       * del MapView y tiene mayor z-index.
       */}
      <MapSearchBar
        value={place_search.query}
        on_change={place_search.set_query}
        on_filter_press={() => set_filter_visible(true)}
        active_filter_count={active_filter_count}
        loading={place_search.loading}
      />

      {/* Buscador unificado (#232.2/.3) — catálogo + direcciones, después de
          la barra en orden de render para quedar encima de los chips. */}
      <PlaceSearch
        query={place_search.query}
        suggestions={place_search.suggestions}
        error={place_search.error}
        on_select_place={(s, meta) => void handle_select_place(s, meta)}
        on_address_out_of_coverage={handle_address_out_of_coverage}
        top={insets.top + spacing.s_8 + MAP_SEARCH_BAR_HEIGHT_APPROX + spacing.s_8}
      />

      {/* FilterSheet — abierto desde el ícono options-outline del MapSearchBar */}
      <FilterSheet
        visible={filter_visible}
        onClose={() => set_filter_visible(false)}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MapScreen — export público
// ─────────────────────────────────────────────────────────────────────────────

export function MapScreen(): React.JSX.Element {
  return (
    <MapErrorBoundary>
      <MapContent />
    </MapErrorBoundary>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // Feed/descubrimiento = oscuro; evita flash blanco al montar el mapa.
    backgroundColor: colors.ink,
  },
  map: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.s_16,
    backgroundColor: colors.paper_3,
  },
  fallback_text: {
    fontSize: 13,
    color: colors.gray_2,
    textAlign: 'center',
  },
  /**
   * Pequeño badge centrado arriba del mapa mientras carga.
   * pointerEvents="none" para no bloquear interacción con el mapa.
   */
  loading_overlay: {
    position: 'absolute',
    top: spacing.s_16,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderRadius: 20,
    padding: spacing.s_8,
  },
  /**
   * Overlay de error discreto arriba del mapa.
   * pointerEvents="none" para no bloquear la interacción.
   */
  error_overlay: {
    position: 'absolute',
    top: spacing.s_16,
    left: spacing.s_16,
    right: spacing.s_16,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    borderRadius: 8,
    padding: spacing.s_8,
  },
  error_text: {
    fontSize: 12,
    color: '#fff',
    textAlign: 'center',
  },
});
