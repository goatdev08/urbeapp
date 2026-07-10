/**
 * FeedScreen.tsx — Feed vertical inmersivo, estilo TikTok.
 *
 * Usa FlashList v2 (@shopify/flash-list 2.0.2) con snap por ítem full-screen.
 * Datos reales: hook useFeedProperties (query Supabase + signed URLs vía EF
 * mint-video-url). Paginación acumulativa con scroll infinito.
 *
 * ponytail: FlashList v2 recicla ítems → la paginación no monta ítems
 * ilimitados en memoria; drawDistance=height acota lo pre-renderizado.
 * RefreshControl + onEndReached cubren pull-to-refresh y scroll infinito;
 * la guardia contra disparos duplicados vive en loadMore (hook).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  Text,
  View,
  useWindowDimensions,
  RefreshControl,
} from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { SlidersHorizontal, VideoCamera } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme/theme';
import { EmptyState } from '@/features/profile/components/EmptyState';
import { useFilters } from '../search/filterStore';
import { FilterSheet } from '../search/components/FilterSheet';

import { VideoFeedItem } from './components/VideoFeedItem';
import { FeedSkeleton } from './components/FeedSkeleton';
import { useFeedActiveIndex } from './hooks/useFeedActiveIndex';
import { useFeedProperties } from './hooks/useFeedProperties';
import type { FeedPropertyWithUrl } from './types';

// ponytail: module-level — referencia estable, sin deps de closure.
const key_extractor = (item: FeedPropertyWithUrl): string => item.id;

export function FeedScreen() {
  const { height } = useWindowDimensions();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { viewabilityConfigCallbackPairs, isItemActive } = useFeedActiveIndex();
  const { filters, active_filter_count } = useFilters();
  const { data, isLoading, error, loadInitial, refetch, loadMore } = useFeedProperties(filters);
  const [filter_visible, set_filter_visible] = useState(false);

  // Carga la primera página al montar la pantalla.
  // loadInitial es estable (useCallback con deps vacías), por lo que
  // este effect solo dispara una vez.
  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // ponytail: useCallback con [isItemActive] — se recreará solo cuando cambie
  // activeIndex (es decir, al hacer swipe). React.memo en VideoFeedItem
  // garantiza que solo re-renderizan los dos ítems cuya prop `isActive` cambia
  // (el que sale y el que entra); el resto son bailout.
  const render_item = useCallback(
    ({ item, index }: ListRenderItemInfo<FeedPropertyWithUrl>) => (
      <VideoFeedItem property={item} isActive={isItemActive(index)} />
    ),
    [isItemActive],
  );

  // ── Estados de carga, error y vacío ─────────────────────────────────────────
  //
  // El botón de filtros + FilterSheet se renderizan UNA sola vez, fuera de
  // estos estados (ver return final), para ser alcanzables también desde el
  // empty state. Solo se ocultan en skeleton (carga inicial) y error — ver
  // `show_filters` más abajo.

  // Carga inicial (sin datos previos): muestra skeleton full-screen.
  // isLoading arranca en true en el hook, por lo que no hay flash de empty state.
  const is_skeleton = isLoading && data.length === 0;

  // Error sin datos previos: mensaje + reintentar.
  const is_error = error !== null && data.length === 0;

  // Sin propiedades tras carga exitosa — primera impresión con BD vacía.
  const is_empty = !isLoading && !is_error && data.length === 0;

  // El botón de filtros y el FilterSheet solo se ocultan en skeleton y error
  // (AC4: el estado de error solo expone "Reintentar"; smoke test D: el botón
  // no debe verse durante la carga inicial). Visibles en empty state y feed.
  const show_filters = !is_skeleton && !is_error;

  return (
    <View style={styles.root}>
      {is_skeleton && <FeedSkeleton />}

      {is_error && (
        <View style={styles.state_root}>
          <Text style={styles.state_text}>{error}</Text>
          <TouchableOpacity
            onPress={loadInitial}
            style={styles.retry_btn}
            accessibilityLabel="Reintentar carga del feed"
          >
            <Text style={styles.retry_text}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Sin propiedades tras carga exitosa — primera impresión con BD vacía:
          empty state de marca con CTA directo al wizard de publicación. */}
      {is_empty && (
        <View style={styles.state_root}>
          <EmptyState
            dark
            icon={VideoCamera}
            message="Aún no hay propiedades"
            subtitle="Sé el primero en publicar un video."
            cta_label="Publicar propiedad"
            onPressCta={() => router.push('/publish/step1')}
          />
        </View>
      )}

      {/* ── Feed principal ─────────────────────────────────────────────────── */}
      {!is_skeleton && !is_error && !is_empty && (
        <>
          {/* ponytail: FlashList v2 (2.0.2) mide ítems automáticamente (new arch);
              estimatedItemSize ya no existe. Los ítems fijan su propio height=screenHeight.
              viewabilityConfigCallbackPairs (ref estable) activa el reproductor del ítem visible;
              el hook combina viewability + AppState + foco de tab para el gating de isActive.
              drawDistance=height: pre-renderiza un ítem fuera de pantalla en cada dirección →
              su useVideoPlayer bufferea sin prefetch explícito (SDK56 no lo expone). */}
          {/* Snap vertical por ítem full-screen.
              snapToAlignment="start" + snapToInterval=height → cada swipe ancla al
              inicio del ítem siguiente/anterior.
              disableIntervalMomentum → corta la inercia: el swipe avanza UN ítem y se
              detiene ahí sin importar la velocidad (no se salta videos con el momentum).
              NO usamos pagingEnabled: RN ignora snapToInterval cuando está activo y
              deja pasar la inercia. decelerationRate="fast" → deceleración de snap limpio.
              bounces={false} → sin rebote en los extremos (iOS); Android ya no rebota.
              Todas estas props son ScrollViewProps, que FlashList v2 re-exporta
              directamente (extiende Omit<ScrollViewProps, 'maintainVisibleContentPosition'>). */}
          <FlashList
            data={data}
            keyExtractor={key_extractor}
            renderItem={render_item}
            snapToInterval={height}
            snapToAlignment="start"
            disableIntervalMomentum
            decelerationRate="fast"
            showsVerticalScrollIndicator={false}
            bounces={false}
            // 1.5 pantallas de colchón: el video entrante bufferea antes de aparecer
            // (SDK56 no expone prefetch explícito; costo en memoria aceptable en demo).
            drawDistance={height * 1.5}
            viewabilityConfigCallbackPairs={viewabilityConfigCallbackPairs}
            // Pull-to-refresh: resetea cursor y recarga desde el inicio.
            // refreshing solo true durante un refresh (ya hay datos en pantalla).
            refreshControl={
              <RefreshControl
                refreshing={isLoading && data.length > 0}
                onRefresh={refetch}
                tintColor={colors.gray_1}
              />
            }
            // Scroll infinito: dispara al estar a ~30% del final de la lista.
            // ponytail: loadMore ya guarda internamente contra !nextCursor / isLoading.
            onEndReached={loadMore}
            onEndReachedThreshold={0.3}
          />

          {/* El acceso a publicar vive en el botón central de la tab bar
              (PublishTabButton en (tabs)/_layout) — el FAB flotante que tapaba el
              rail de acciones se retiró en el pulido flash 2026-07-06. */}
        </>
      )}

      {/*
       * Botón de filtros — top-right flotante sobre el feed oscuro.
       * Estética: fondo semi-translúcido oscuro (ink_feed) + ícono gris claro,
       * para no romper la inmersión del feed de video.
       * Posición: safe-area top + s_12 de holgura, alineado a la derecha.
       * El FilterSheet (panel claro) se abre encima del feed vía Modal nativo.
       * Se renderiza una sola vez (feed principal + empty state) — oculto
       * en skeleton y error (ver show_filters).
       */}
      {show_filters && (
        <>
          <TouchableOpacity
            style={[styles.filter_btn, { top: insets.top + spacing.s_12 }]}
            onPress={() => set_filter_visible(true)}
            accessibilityLabel="Abrir filtros"
            accessibilityRole="button"
          >
            <SlidersHorizontal size={20} color={colors.gray_1} weight="bold" />
            {active_filter_count > 0 && (
              <View style={styles.filter_badge}>
                <Text style={styles.filter_badge_text}>{active_filter_count}</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* FilterSheet — abierto desde el botón de filtros del feed */}
          <FilterSheet
            visible={filter_visible}
            onClose={() => set_filter_visible(false)}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.ink_feed,
  },
  // Estado de error / empty: centrado en pantalla. flex:1 propio porque ahora
  // vive anidado dentro de `root` (ya no se combina con él vía array de estilos).
  state_root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  state_text: {
    color: colors.gray_1,
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  retry_btn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.gray_2,
  },
  retry_text: {
    color: colors.gray_1,
    fontSize: 15,
  },
  /**
   * Botón de filtros — píldora circular sobre el feed oscuro.
   * Fondo semi-translúcido oscuro (ink_feed a 0.60) para integrarse con la
   * estética inmersiva del feed sin opacar el video de fondo.
   * `top` es dinámico (safe area + s_12) — se inyecta via inline style.
   */
  filter_btn: {
    position: 'absolute',
    right: spacing.s_16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(23,20,15,0.60)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * Badge de conteo de filtros activos — píldora arcilla sobre el botón de
   * filtros, esquina superior derecha. Mismo patrón visual en MapScreen.
   */
  filter_badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filter_badge_text: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
});
