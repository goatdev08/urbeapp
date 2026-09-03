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
  Platform,
  StyleSheet,
  TouchableOpacity,
  Text,
  View,
  useWindowDimensions,
  RefreshControl,
} from 'react-native';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { MagnifyingGlass, MapPinSimple, SlidersHorizontal, VideoCamera } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme/theme';
import { REFRESHING_CHIP_HEIGHT, RefreshingChip } from '@/components/RefreshingChip';
import { EmptyState } from '@/features/profile/components/EmptyState';
import { useFilters } from '../search/filterStore';
import { FilterSheet } from '../search/components/FilterSheet';
import { ZoneActiveChip } from '../search/components/ZoneActiveChip';

import { VideoFeedItem } from './components/VideoFeedItem';
import { AdFeedItem } from './components/AdFeedItem';
import { FeedSkeleton } from './components/FeedSkeleton';
import { FEED_SECTION_TABS_HEIGHT, FeedSectionTabs } from './components/FeedSectionTabs';
import { FEED_SECTIONS } from '@/features/search/lib/feedSection';
import { release_splash } from '@/lib/splash-gate';
import { useFeedActiveIndex } from './hooks/useFeedActiveIndex';
import { useFeedProperties } from './hooks/useFeedProperties';
import { feed_key_extractor } from './lib/feedKeyExtractor';
import type { FeedItem } from './lib/interleaveAds';

export function FeedScreen() {
  const { height } = useWindowDimensions();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { viewabilityConfigCallbackPairs, isItemActive } = useFeedActiveIndex();
  const { filters, active_filter_count, clear_filters, set_filter, section, set_section } =
    useFilters();
  // #241: label de la sección activa para el copy del vacío ("en venta"/"en renta").
  const section_label = (FEED_SECTIONS.find((s) => s.value === section)?.label ?? 'Venta').toLowerCase();
  // Coordenada superior compartida por tabs (centro) y botón de filtros (derecha).
  // #242.1: pegado al borde superior. En iOS con notch/Dynamic Island el inset
  // (44–62) trae ~10 pt de aire extra debajo del hardware → restamos 6 y la
  // pill queda a ~5 pt de la isla sin tocarla (smoke iPhone 17, 2026-09-03).
  // Con status bar clásica (iOS sin notch = 20, Android edge-to-edge = alto
  // exacto de la barra) NO hay aire: la hora/wifi viven dentro del inset, así
  // que ahí sumamos s_4.
  const top_row_y = insets.top > 40 ? insets.top - 6 : insets.top + spacing.s_4;
  // El botón de filtros (40) se centra con la pill (34).
  const filter_btn_y = top_row_y - (40 - FEED_SECTION_TABS_HEIGHT) / 2;
  const { data, isLoading, error, loadInitial, refetch, loadMore } = useFeedProperties(filters);
  // #243.2: refrescando = cargando con datos ya en pantalla (el arranque usa skeleton).
  const is_refreshing = isLoading && data.length > 0;
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
    ({ item, index }: ListRenderItemInfo<FeedItem>) =>
      item.kind === 'ad' ? (
        <AdFeedItem ad={item.ad} isActive={isItemActive(index)} />
      ) : (
        <VideoFeedItem property={item.property} isActive={isItemActive(index)} />
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

  // #143.4: el splash nativo aguanta hasta que el feed se RESUELVE (datos,
  // error o vacío) — el primer fetch corre debajo de la pantalla del logo,
  // así el usuario ya no ve el skeleton en el arranque normal. Los estados
  // post-arranque (refetch por filtros) no pasan por aquí: release es one-shot.
  useEffect(() => {
    if (!is_skeleton) release_splash();
  }, [is_skeleton]);

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

      {/* Sin resultados: se ramifica en 3 niveles, EN ESTE ORDEN:
          1. zona activa (filters.area != null) — PRIMERA condición: `area`
             NO cuenta en active_filter_count (decisión 56.1), así que una
             zona sin resultados y sin otros filtros caería por error en el
             "BD-vacía" de abajo (con CTA "Publicar propiedad", incorrecto
             para este caso) si no se revisa primero.
          2. filtered-empty (hay otros filtros activos): CTA limpia filtros;
             el cambio de identidad de `filters` re-dispara loadInitial
             (useEffect de useFeedProperties) — no hace falta un refetch
             manual aquí.
          3. BD-vacía (sin filtros de ningún tipo): primera impresión, CTA al
             wizard de publicación (comportamiento previo, sin cambios). */}
      {is_empty && (
        <View style={styles.state_root}>
          {filters.area != null ? (
            <EmptyState
              dark
              icon={MapPinSimple}
              message="No hay publicaciones en esta zona"
              subtitle="Prueba mover el mapa o limpia la zona."
              cta_label="Limpiar zona"
              onPressCta={() => set_filter('area', null)}
            />
          ) : active_filter_count > 0 ? (
            <EmptyState
              dark
              icon={MagnifyingGlass}
              message="No hay propiedades con estos filtros"
              subtitle="Intenta cambiar o limpiar los filtros."
              cta_label="Limpiar filtros"
              onPressCta={clear_filters}
            />
          ) : (
            <EmptyState
              dark
              icon={VideoCamera}
              message={`Aún no hay propiedades en ${section_label}`}
              subtitle="Cambia de sección o sé el primero en publicar un video."
              cta_label="Publicar propiedad"
              onPressCta={() => router.push('/publish/step1')}
            />
          )}
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
              bounces: ver el comentario en la prop (#241.2 — iOS necesita el rebote para el pull-to-refresh).
              Todas estas props son ScrollViewProps, que FlashList v2 re-exporta
              directamente (extiende Omit<ScrollViewProps, 'maintainVisibleContentPosition'>). */}
          <FlashList
            data={data}
            keyExtractor={feed_key_extractor}
            renderItem={render_item}
            snapToInterval={height}
            snapToAlignment="start"
            disableIntervalMomentum
            decelerationRate="fast"
            showsVerticalScrollIndicator={false}
            // #241.2: en iOS el RefreshControl SOLO se activa si el ScrollView
            // rebota en el borde superior — con bounces={false} (9.8) el
            // pull-to-refresh estaba muerto en iOS. El snap por intervalo sigue
            // mandando en el resto del recorrido. Android ignora `bounces`.
            bounces={Platform.OS === 'ios'}
            // 1 pantalla de colchón (fix #57, anti-OOM Android): menos players
            // ExoPlayer vivos. Trade-off aceptado: en swipes muy rápidos el póster
            // puede verse un instante más mientras el video entrante bufferea.
            drawDistance={height}
            viewabilityConfigCallbackPairs={viewabilityConfigCallbackPairs}
            // Pull-to-refresh: resetea cursor y recarga desde el inicio.
            // refreshing solo true durante un refresh (ya hay datos en pantalla).
            refreshControl={
              // #243.2/#243.4: el RefreshControl nativo queda solo como GESTO;
              // lo que se ve es el RefreshingChip con el UrbeaLoader debajo de
              // los tabs. En iOS basta con tintColor transparente. En Android
              // el color transparente NO basta — SwipeRefreshLayout sigue
              // pintando su círculo (reporte del smoke físico: "aparecen
              // ambos loaders a la vez") — hay que sacarlo de la pantalla con
              // progressViewOffset (Android ignora `tintColor`/`bounces`).
              <RefreshControl
                refreshing={is_refreshing}
                onRefresh={refetch}
                tintColor="transparent"
                colors={['transparent']}
                progressBackgroundColor="transparent"
                progressViewOffset={Platform.OS === 'android' ? -100 : undefined}
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
       * Posición: safe-area top + s_4 de holgura (#242.1), alineado a la derecha.
       * El FilterSheet (panel claro) se abre encima del feed vía Modal nativo.
       * Se renderiza una sola vez (feed principal + empty state) — oculto
       * en skeleton y error (ver show_filters).
       */}
      {show_filters && (
        <>
          {/* Scrim superior (#242.1): degradado oscuro → transparente detrás de
              la fila de tabs/filtros para que se lean sobre cielo o pared clara.
              pointerEvents none: no roba el tap ni el scroll del feed. */}
          <LinearGradient
            colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']}
            style={[styles.top_scrim, { height: top_row_y + FEED_SECTION_TABS_HEIGHT + spacing.s_24 }]}
            pointerEvents="none"
          />

          {/* Secciones Venta · Renta (#241) — centradas en la misma fila que el
              botón de filtros. set_section cambia la identidad de `filters` →
              useFeedProperties vacía la lista y loadInitial recarga (skeleton). */}
          <FeedSectionTabs section={section} on_change={set_section} style={{ top: top_row_y }} />

          <TouchableOpacity
            style={[styles.filter_btn, { top: filter_btn_y }]}
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

      {/*
       * Chip "Zona activa · Quitar" (#56.5) — persistente mientras haya una
       * zona de búsqueda activa (viene de "Buscar en esta zona" en el mapa,
       * #56.4). Visible en TODOS los estados del feed (skeleton/error/empty/
       * feed principal), no solo cuando show_filters — de ahí que se renderice
       * fuera del bloque anterior. onPress revierte a modo cercanía GPS (#42).
       * Mismo `top` que filter_btn; sin overlap porque el chip queda centrado
       * y el botón de filtros a la derecha (ver ZoneActiveChip.tsx).
       */}
      {/* #243.2: chip «Actualizando» (UrbeaLoader) debajo de los tabs mientras
          el pull-to-refresh recarga. Si además hay zona activa, esta cuelga debajo. */}
      <RefreshingChip
        visible={is_refreshing}
        tone="dark"
        top={top_row_y + FEED_SECTION_TABS_HEIGHT + spacing.s_8}
      />
      {filters.area != null && (
        <ZoneActiveChip
          dark
          on_press={() => set_filter('area', null)}
          // #241: cuelga DEBAJO de los tabs de sección (que ocupan el centro).
          style={{
            top:
              top_row_y +
              FEED_SECTION_TABS_HEIGHT +
              spacing.s_8 +
              (is_refreshing ? REFRESHING_CHIP_HEIGHT + spacing.s_8 : 0),
          }}
        />
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
  top_scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    // Sin zIndex: se pinta antes que tabs y filter_btn en el árbol → queda debajo.
  },
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
