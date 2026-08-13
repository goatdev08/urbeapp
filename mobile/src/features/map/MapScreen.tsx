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
import type { PlaceSuggestion } from './lib/placeSearch';
import { PropertyMarker } from './components/PropertyMarker';
import { ClusterMarker } from './components/ClusterMarker';
import { PropertyMiniCard } from './components/PropertyMiniCard';
import { AreaSearchPill } from './components/AreaSearchPill';
import { MapSearchBar } from './components/MapSearchBar';
import { MapSearchSuggestions } from './components/MapSearchSuggestions';
import { FilterSheet } from '../search/components/FilterSheet';
import { ZoneActiveChip } from '../search/components/ZoneActiveChip';
import type { MapProperty } from './types';

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

  // ── Búsqueda de lugares + colonia seleccionada (#157) ─────────────────────
  // La colonia es estado LOCAL del mapa (decisión D6: no vive en FilterState —
  // el feed no la consume). neighborhood_id fluye como 3er parámetro a
  // useMapProperties; active_polygon pinta el perímetro.
  const place_search = usePlaceSearch();
  const [neighborhood_id, set_neighborhood_id] = useState<string | null>(null);
  const [active_polygon, set_active_polygon] = useState<NeighborhoodPolygon | null>(null);

  const { data, loading, error } = useMapProperties(undefined, filters, neighborhood_id);
  // Ubicación real (LocationProvider, permiso obligatorio #41): centra el mapa
  // en la ciudad del usuario en vez de GDL fija. Fallback: GDL_REGION.
  const { coords: user_coords } = useLocation();
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
   * #157 (D9): además limpia la colonia activa — colonia y area son
   * mutuamente excluyentes (dos acotaciones simultáneas serían ambiguas).
   */
  function handle_area_search(): void {
    const area = viewport_to_area(region);
    set_filter('area', area);
    set_show_area_pill(false);
    clear_neighborhood();
    router.push('/');
  }

  /** Quita la colonia activa (perímetro + filtro). */
  function clear_neighborhood(): void {
    set_neighborhood_id(null);
    set_active_polygon(null);
  }

  /**
   * Selección de una sugerencia del autocomplete (#157.8).
   * - Colonia: baja su polígono (get_neighborhood_geojson), lo dibuja, encuadra
   *   el bbox con fitToCoordinates y activa el filtro espacial (neighborhood_id
   *   → RPC properties_within_neighborhood). Limpia `filters.area` (D9).
   * - Municipio: no hay polígono municipal — encuadra su bbox precalculado
   *   (D4) y reusa el mecanismo de área de #56 (círculo del viewport, D5).
   *   bbox null (municipio sin colonias cargadas) → solo cierra el dropdown.
   * En ambos casos la barra se limpia: el estado visible queda en el CHIP
   * ("<Nombre> · Quitar"), no en el texto de la barra.
   */
  async function handle_select_place(suggestion: PlaceSuggestion): Promise<void> {
    place_search.clear();
    Keyboard.dismiss();

    if (suggestion.kind === 'neighborhood') {
      set_filter('area', null); // D9: excluyentes
      try {
        const polygon = await fetch_neighborhood_polygon(suggestion.id);
        if (polygon) {
          set_active_polygon(polygon);
          set_neighborhood_id(suggestion.id);
          fit_bbox(polygon.bbox);
          return;
        }
      } catch {
        // fail-soft: sin polígono no hay filtro; al menos encuadra si hay bbox.
      }
      if (suggestion.bbox) fit_bbox(suggestion.bbox);
      return;
    }

    // Municipio
    clear_neighborhood();
    if (!suggestion.bbox) return; // sin colonias cargadas → sin encuadre (D4)
    const muni_region = bbox_to_region(suggestion.bbox);
    map_ref.current?.animateToRegion(muni_region, 400);
    set_filter('area', viewport_to_area(muni_region));
    set_show_area_pill(false);
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
       * chip de area (D9: mutuamente excluyentes), así que comparten ancla.
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
      />

      {/* Dropdown de sugerencias (#157.8) — después de la barra en orden de
          render para quedar encima de los chips cuando está abierto. */}
      <MapSearchSuggestions
        suggestions={place_search.suggestions}
        on_select={(s) => void handle_select_place(s)}
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
