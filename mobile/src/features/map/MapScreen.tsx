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
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import MapView, { Region } from 'react-native-maps';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme/theme';
import { useLocation } from '@/features/location/LocationProvider';
import { useFilters } from '../search/filterStore';
import { GDL_REGION } from './constants';
import { useMapProperties } from './hooks/useMapProperties';
import { cluster_properties } from './lib/clusterMarkers';
import { viewport_to_area } from './lib/viewportToArea';
import { PropertyMarker } from './components/PropertyMarker';
import { ClusterMarker } from './components/ClusterMarker';
import { PropertyMiniCard } from './components/PropertyMiniCard';
import { AreaSearchPill } from './components/AreaSearchPill';
import { MapSearchBar } from './components/MapSearchBar';
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
  const { data, loading, error } = useMapProperties(undefined, filters);
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
  const [query, set_query] = useState('');
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
   * ponytail: filtro cliente sin geocoding ni nueva dependencia — cubre el scope #11.7.
   * Filtra por address y property_type; recalcula solo cuando data o query cambian.
   * clustered deriva de filtered → no recalcula todo el clustering ante un cambio
   * de región si el query no cambió. tracksViewChanges={false} en markers (ver
   * PropertyMarker.tsx) evita re-renders por frame con 50+ pins en pantalla.
   */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data ?? [];
    return (data ?? []).filter(
      (p) =>
        p.address.toLowerCase().includes(q) ||
        p.property_type.toLowerCase().includes(q),
    );
  }, [data, query]);

  const clustered = useMemo(
    () => cluster_properties(filtered, region),
    [filtered, region],
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
   */
  function handle_area_search(): void {
    const area = viewport_to_area(region);
    set_filter('area', area);
    set_show_area_pill(false);
    router.push('/');
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

      {/* ── Barra de búsqueda flotante — overlay superior (z-index último) ── */}
      {/*
       * Renderizado después del MapView y los overlays para quedar por encima
       * (orden de render = z-index en RN). Los taps en la barra no alcanzan
       * el onPress del MapView (set_selected(null)) porque la barra está fuera
       * del MapView y tiene mayor z-index.
       */}
      <MapSearchBar
        value={query}
        on_change={set_query}
        on_filter_press={() => set_filter_visible(true)}
        active_filter_count={active_filter_count}
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
