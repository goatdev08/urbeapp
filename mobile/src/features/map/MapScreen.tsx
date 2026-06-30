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
import React, { Component, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import MapView, { Region } from 'react-native-maps';
import { useRouter } from 'expo-router';

import { colors, spacing } from '@/theme/theme';
import { GDL_REGION } from './constants';
import { useMapProperties } from './hooks/useMapProperties';
import { cluster_properties } from './lib/clusterMarkers';
import { PropertyMarker } from './components/PropertyMarker';
import { ClusterMarker } from './components/ClusterMarker';
import { PropertyMiniCard } from './components/PropertyMiniCard';
import { MapSearchBar } from './components/MapSearchBar';
import type { MapProperty } from './types';

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

  const { data, loading, error } = useMapProperties();
  const [region, set_region] = useState<Region>(GDL_REGION);
  const [selected, set_selected] = useState<MapProperty | null>(null);
  const [query, set_query] = useState('');

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
        initialRegion={GDL_REGION}
        onRegionChangeComplete={set_region}
        onPress={() => set_selected(null)}
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

      {/* ── Barra de búsqueda flotante — overlay superior (z-index último) ── */}
      {/*
       * Renderizado después del MapView y los overlays para quedar por encima
       * (orden de render = z-index en RN). Los taps en la barra no alcanzan
       * el onPress del MapView (set_selected(null)) porque la barra está fuera
       * del MapView y tiene mayor z-index.
       */}
      <MapSearchBar value={query} on_change={set_query} />
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
