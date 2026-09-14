/**
 * useFeedProperties — hook React que envuelve fetch_feed_page (feedSources.ts)
 * y compone el feed heterogéneo (propiedades + anuncios intercalados, 170.4).
 *
 * Expone: data (FeedItem[]), isLoading, error, nextCursor, loadInitial,
 * refetch, loadMore. Paginación acumulativa: loadMore apende al array
 * existente.
 *
 * `feed_tab`/`user_id` (#296.4, default 'para_ti'/null): viajan tal cual a
 * `fetch_feed_page` como `{tab, user_id}` — el despacho por fuente
 * (proximidad/por_owner/ordenada) vive en feedSources.ts, no aquí. Ambos
 * entran a las deps de loadInitial/loadMore (cambiar de tab o de usuario
 * recarga igual que cambiar `filters`). Única excepción propia del hook: la
 * VUELTA de "Nuevos" (`feed_tab === 'nuevos'`) NO se baraja — se re-sirve la
 * página 1 en el orden exacto que devolvió fetch_feed_page (decisión de
 * Abraham); el resto de tabs conserva el barajado de #285.3/#288.2.
 *

 * `filters` (opcional, #12.7): al cambiar de identidad (el FilterProvider crea
 * un objeto nuevo en cada set_filter/clear_filters), loadInitial cambia de
 * identidad y el efecto de FeedScreen que depende de loadInitial se vuelve a
 * disparar — refetch automático al aplicar/limpiar filtros, sin plumbing extra.
 *
 * Coords (#42.2): useLocation().coords fluye a fetchFeedProperties vía deps
 * para la RPC de proximidad. Mientras coords sea null (gate de ubicación en
 * 'loading', ver (protected)/_layout.tsx) se pasa deps=undefined y el lib usa
 * su propio fallback GDL + lazy-require del cliente real. Igual que `filters`,
 * coords entra a las deps de loadInitial/loadMore → cuando la coord real llega
 * (cambia de null a objeto), loadInitial cambia de identidad y el efecto de
 * FeedScreen dispara el refetch automáticamente.
 *
 * Composición de anuncios (170.4, dependencias 170.1/170.2/170.3):
 *   - Tras cada fetch exitoso, se consulta el kill-switch `ads_feed_config()`
 *     (sin argumentos). Si `ads_enabled` es false, o la RPC falla/está
 *     malformada, o `deps.supabase` no expone `.rpc` (mock legado de los 14
 *     tests preexistentes de feed/__tests__) ⇒ FAIL-SOFT ABSOLUTO: el feed
 *     se compone solo de propiedades, sin lanzar ni marcar `error`.
 *   - Con ads_enabled=true, se consulta `ads_for_zone` con las coords del
 *     usuario y zona null/null (#195 — el feed hoy no tiene "zona vista"
 *     propia; el RPC resuelve por GPS). Cualquier fallo de esta RPC (error
 *     explícito, promesa rechazada, respuesta no-array) también degrada a
 *     feed normal.
 *   - `interleave_ads` (170.3, pura) decide el orden final; `already_shown_ref`
 *     acumula anuncios mostrados A TRAVÉS de loadInitial/loadMore/refetch
 *     durante la vida del hook (nunca se resetea) para sostener el cap de
 *     sesión (`ad_max_per_session`) entre páginas.
 *
 * #288.1 — `isLoading` es SOLO la carga inicial/refetch (skeleton y chip
 * «Actualizando» en FeedScreen). loadMore (página o vuelta) carga en silencio:
 * su reentrada se guarda con `load_more_in_flight_ref`, no con estado —
 * encenderlo pintaba «Actualizando» en cada costura y hacía visible la vuelta.
 *
 * Concurrencia (#249): la race SÍ era visible. Al aplicar un filtro, la carga
 * anterior sigue en vuelo y, si resolvía tarde, pisaba la página filtrada — el
 * feed se quedaba mostrando lo de antes hasta el pull-to-refresh. Se resuelve
 * con `request_seq_ref` (ver abajo): solo la carga vigente escribe estado.
 * Techo conocido: la petición desechada igual viaja por red (no hay abort).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';

import { useLocation } from '@/features/location/LocationProvider';
import { EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';
import { onPropertyDeleted } from '@/lib/propertyEvents';

import { get_app_session_id } from '../lib/appSession';
import {
  ads_failure_store,
  report_ads_failure,
  type AdsFailureClient,
  type AdsFailureStage,
} from '../lib/adsFailureSignal';
import type { LappedFeedItem } from '../lib/feedKeyExtractor';
import { mint_videos, type FeedPropertiesDeps } from '../lib/feedProperties';
import { fetch_feed_page } from '../lib/feedSources';
import {
  feed_cache_key,
  get_feed_tab_entry,
  neighbor_tabs,
  set_feed_tab_entry,
  update_feed_tab_scroll,
} from '../lib/feedTabCache';
import { avoid_adjacent_repeat, hash_seed, shuffle_with_seed } from '../lib/feedShuffle';
import { interleave_ads_with_state, type FeedAd, type FeedItem } from '../lib/interleaveAds';
import { with_tab, type FeedTab } from '@/features/search/lib/feedSection';
import type { FeedPropertyWithUrl } from '../types';

export interface UseFeedPropertiesState {
  data: LappedFeedItem[];
  isLoading: boolean;
  error: string | null;
  nextCursor: string | null;
  /**
   * Carga la primera página. #296.5 — cache-first por tab: con entrada
   * vigente en feedTabCache restaura data/nextCursor/lapCount/scroll SIN
   * fetch y sin encender isLoading; sin entrada (o vencida) cae al flujo de
   * red de siempre y escribe la entrada al resolver.
   */
  loadInitial: () => Promise<void>;
  /**
   * #296.5: YA NO es alias de loadInitial — salta la caché siempre (pull-to-
   * refresh pide datos frescos a propósito) y reescribe la entrada del tab.
   */
  refetch: () => Promise<void>;
  /** Carga la siguiente página y apende al array existente. */
  loadMore: () => Promise<void>;
  /**
   * #285.3: vueltas del feed infinito cruzadas en esta sesión del hook. 0 al
   * montar; se resetea en loadInitial/refetch/cambio de filters. Desde #288
   * FeedScreen ya no lo consume (sin chip de vuelta): queda como observable
   * para tests y smoke (useFeedProperties.lap-wrap.test.tsx).
   */
  lapCount: number;
  /** #296.5: scroll_index restaurado desde la caché en el último loadInitial-hit; null sin restauración (miss/refetch). */
  restoredScrollIndex: number | null;
  /** #296.5: guarda `index` como scroll_index del tab actualmente cargado (feedTabCache). */
  noteScrollIndex: (index: number) => void;
}

/** Config del kill-switch, forma de la fila de `ads_feed_config()`. */
type AdsFeedConfigRow = {
  ads_enabled: boolean;
  ad_frequency_n: number;
  ad_max_per_session: number;
};

const to_property_items = (properties: FeedPropertyWithUrl[]): FeedItem[] =>
  properties.map((property) => ({ kind: 'property', property }));

/** Fila de mint-ad-urls. */
type MintedAdUrlRow = { creative_id: string; posterUrl: string; videoUrl: string };

/** Anuncio "display": trae creative propio (170.8). Mutuamente excluyente con promo (213). */
type DisplayAd = FeedAd & { creative_id: string };
/** Anuncio "promo" (213): es una propiedad publicada, sin creative propio. */
type PromoAd = FeedAd & { property_id: string };

const is_display_ad = (ad: FeedAd): ad is DisplayAd => ad.creative_id != null;
// 213: `property_id` puede venir ausente (undefined, backend sin la migración
// 213.3-SQL) — se trata igual que null (tolerancia OTA, ver docblock de FeedAd).
const is_promo_ad = (ad: FeedAd): ad is PromoAd => ad.property_id != null;

/**
 * Pide a mint-ad-urls las URLs firmadas de estos anuncios DISPLAY y devuelve
 * SOLO los que quedaron firmados. `null` = la EF falló entera (distinto de
 * "firmó cero", que es una lista vacía y también deja el feed sin esos
 * anuncios pero por una razón legítima: ningún creativo autorizado/disponible).
 */
async function mint_ad_urls(client: unknown, ads: DisplayAd[]): Promise<FeedAd[] | null> {
  // 🔴 #205: se comprueba el tipo sobre el método, pero se LLAMA LIGADO a
  // `functions`. Desprenderlo (`const call = ...functions.invoke`) pierde
  // `this` y el invoke real devuelve `{data:null, error:{}}` — un error MUDO
  // que el `if (error) return null` de abajo confunde con "la EF falló", y el
  // feed se queda sin anuncios para siempre. La guarda de tipo (fail-soft de
  // 170.4 decisión 6) se conserva: comprobar y ligar no se estorban.
  const fns = (client as { functions?: { invoke?: unknown } } | null | undefined)?.functions;
  if (typeof fns?.invoke !== 'function') return null;
  const bound_invoke = fns.invoke as (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>;
  const call = (...args: unknown[]) => bound_invoke.apply(fns, args);

  const { data, error } = await call('mint-ad-urls', {
    body: { creative_ids: ads.map((ad) => ad.creative_id) },
  });
  if (error) return null;

  const urls = (data as { urls?: unknown } | null | undefined)?.urls;
  if (!Array.isArray(urls)) return null;

  const by_creative = new Map(
    (urls as MintedAdUrlRow[]).map((row) => [row.creative_id, row]),
  );

  const signed: FeedAd[] = [];
  for (const ad of ads) {
    const minted = by_creative.get(ad.creative_id);
    // Sin firma no se sirve: ver el comentario de compose_feed_items.
    if (minted) signed.push({ ...ad, video_url: minted.videoUrl, poster_url: minted.posterUrl });
  }
  return signed;
}

/**
 * 213.3: pide a mint-video-url (la MISMA EF/helper que feedProperties.ts usa
 * para las propiedades del feed — `mint_videos`, sin duplicar el fetch) el
 * video de cada propiedad promocionada, y devuelve SOLO las promos que
 * quedaron firmadas. Una promo sin video autorizado/ready NO se sirve —
 * mismo criterio que un display sin firma (compose_feed_items).
 */
async function mint_promo_video_urls(client: unknown, ads: PromoAd[]): Promise<FeedAd[]> {
  const videos = await mint_videos(client, ads.map((ad) => ad.property_id));
  const by_property = new Map(videos.map((v) => [v.property_id, v]));

  const signed: FeedAd[] = [];
  for (const ad of ads) {
    const minted = by_property.get(ad.property_id);
    if (minted) {
      signed.push({ ...ad, video_url: minted.signed_url, poster_url: minted.posterUrl ?? null });
    }
  }
  return signed;
}

/**
 * #196: deja rastro del fail-soft SIN cambiarlo. Fire-and-forget deliberado
 * (`void`, nunca `await`): el feed no espera a la telemetría, y
 * report_ads_failure jamás rechaza, así que este `void` no puede producir una
 * promesa colgada. 🔴 Solo se llama ante un FALLO — `ads_enabled=false` es un
 * apagado deliberado, no un fallo, y no emite nada (EC-SIG-6).
 */
function signal_ads_failure(client: unknown, stage: AdsFailureStage): void {
  void report_ads_failure({
    client: client as AdsFailureClient,
    session_id: get_app_session_id(),
    stage,
    store: ads_failure_store,
  });
}

/**
 * Compone `properties` con anuncios intercalados, o degrada a solo-propiedades
 * ante CUALQUIER falla (gate 170.1 / fail-soft absoluto). `already_shown_ref`
 * se actualiza in-place con los anuncios usados en ESTA llamada.
 */
async function compose_feed_items(
  client: unknown,
  /**
   * #195: el punto que se usa para RESOLVER LA ZONA de los anuncios. NO es
   * necesariamente el GPS — ver `ad_zone_coords` en el hook.
   */
  coords: { latitude: number; longitude: number },
  properties: FeedPropertyWithUrl[],
  already_shown_ref: { current: number },
  skip_first_position: boolean,
  /**
   * 256: `since_last_ad` final que dejó la página ANTERIOR (undefined en
   * loadInitial/refetch — una carga nueva no tiene página previa que
   * heredar). Se pasa como `opts.since_last_ad` SOLO en páginas de
   * continuación (loadMore), y ahí manda sobre `skip_first_position` (ver
   * docblock de `InterleaveAdsOptions.since_last_ad`) — así se cierra la
   * costura que #247 dejó abierta: un cierre-con-anuncio de la página 1 ya
   * no puede toparse con otro anuncio en el índice 0 de la página 2.
   */
  since_last_ad_ref: { current: number | undefined },
): Promise<FeedItem[]> {
  // 🔴 #205: mismo motivo que en mint_ad_urls, pero aquí el fallo es más
  // ruidoso y por eso fue el que dejó rastro: el `rpc` real hace
  // `return this.rest.rpc(...)`, así que desprendido LANZA TypeError, el catch
  // de abajo lo traga y marca `stage: 'config'`. Fue el síntoma que delató el
  // bug (dos filas ads_fetch_failed en events_raw). Se comprueba el tipo y se
  // llama ligado al cliente.
  //
  // Se reenvían los argumentos con `...args` en vez de `(fn, params)`: así se
  // preserva la ARIDAD. `call_rpc('ads_feed_config')` debe llegar con UN
  // argumento, no con `(fn, undefined)` — EC-WIRE-1 de 170.4 afirma la forma
  // exacta de la llamada (`toHaveBeenCalledWith('ads_feed_config')`).
  const c = client as { rpc?: unknown } | null | undefined;
  if (typeof c?.rpc !== 'function') return to_property_items(properties);
  const bound_rpc = c.rpc as (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>;
  const call_rpc = (...args: unknown[]) => bound_rpc.apply(c, args);

  let config: AdsFeedConfigRow;
  try {
    const { data, error } = await call_rpc('ads_feed_config');
    if (error || !Array.isArray(data) || data.length === 0) {
      signal_ads_failure(client, 'config');
      return to_property_items(properties);
    }
    if (!data[0]?.ads_enabled) {
      // Kill-switch apagado a propósito: NO es un fallo, no se señala.
      return to_property_items(properties);
    }
    config = data[0] as AdsFeedConfigRow;
  } catch {
    signal_ads_failure(client, 'config');
    return to_property_items(properties);
  }

  let ads: FeedAd[];
  try {
    const { data, error } = await call_rpc('ads_for_zone', {
      p_lat: coords.latitude,
      p_lng: coords.longitude,
      // #195: la zona DECLARADA (por id de colonia/municipio) sigue en null y
      // es una limitación conocida, no un olvido: ese id vive hoy solo en el
      // useState local de MapScreen y propagarlo exige tocar FilterState, su
      // persistencia y los consumidores del mapa. Lo que SÍ se ejerce ya es la
      // precedencia por PUNTO: cuando hay "buscar en esta zona" activa, el
      // punto que llega aquí es el centro de lo que el usuario está viendo, no
      // su GPS. Ver EC-ZONE-1/2/3 en useFeedProperties.ads.test.tsx.
      p_neighborhood_id: null,
      p_municipality_id: null,
    });
    if (error || !Array.isArray(data)) {
      signal_ads_failure(client, 'zone');
      return to_property_items(properties);
    }
    ads = data as FeedAd[];
  } catch {
    signal_ads_failure(client, 'zone');
    return to_property_items(properties);
  }

  // 170.8 — FIRMA DE LA URL DE REPRODUCCIÓN.
  // ads_for_zone da el creative_id pero no una URL reproducible: los creativos
  // de Stream tienen requireSignedURLs. mint-ad-urls (169.5, ampliada en 170.8)
  // devuelve póster y manifest HLS firmados con el MISMO token.
  //
  // 🔴 Un anuncio cuya URL no se pudo firmar NO SE SIRVE. Una impresión que el
  // anunciante PAGA y que no muestra su video es peor que no servir el anuncio
  // — y se registraría igual, porque el registro de impresiones no sabe si el
  // video llegó a pintar.
  //
  // 213.3 — PARTICIÓN display/promo. ads_for_zone ahora puede devolver DOS
  // formas mutuamente excluyentes (CHECK ads_exactly_one_source en la base):
  // "display" (creative_id) se firma con mint-ad-urls como siempre; "promo"
  // (property_id) se firma con mint-video-url — el mismo minteo que usan las
  // propiedades del feed. Cada partición falla CERRADO por su cuenta: si una
  // de las dos EFs falla entera, esa partición queda sin anuncios (señal
  // 'mint') pero la otra no se ve afectada — el feed sigue sirviendo lo que
  // sí se pudo firmar.
  const display_ads = ads.filter(is_display_ad);
  const promo_ads = ads.filter(is_promo_ad);
  const signed_ads: FeedAd[] = [];

  if (display_ads.length > 0) {
    try {
      const signed = await mint_ad_urls(client, display_ads);
      if (signed === null) signal_ads_failure(client, 'mint');
      else signed_ads.push(...signed);
    } catch {
      signal_ads_failure(client, 'mint');
    }
  }

  if (promo_ads.length > 0) {
    try {
      signed_ads.push(...(await mint_promo_video_urls(client, promo_ads)));
    } catch {
      signal_ads_failure(client, 'mint');
    }
  }

  ads = signed_ads;

  // `exactOptionalPropertyTypes`: solo se agrega la clave si hay un valor real
  // (undefined explícito no es lo mismo que ausente bajo este flag).
  const result = interleave_ads_with_state(properties, ads, {
    every_n: config.ad_frequency_n,
    max_per_session: config.ad_max_per_session,
    min_gap_between_repeats: config.ad_frequency_n * 2,
    already_shown_count: already_shown_ref.current,
    skip_first_position,
    ...(since_last_ad_ref.current !== undefined ? { since_last_ad: since_last_ad_ref.current } : {}),
  });

  already_shown_ref.current += result.items.filter((item) => item.kind === 'ad').length;
  since_last_ad_ref.current = result.since_last_ad;

  return result.items;
}

export function useFeedProperties(
  filters?: FilterState,
  feed_tab: FeedTab = 'para_ti',
  user_id: string | null = null,
): UseFeedPropertiesState {
  const { coords } = useLocation();
  const [data, set_data] = useState<LappedFeedItem[]>([]);
  // ponytail: arranca en true — FeedScreen siempre llama loadInitial en mount;
  // esto evita un frame de "empty state" antes de que useEffect dispare.
  const [isLoading, set_is_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [nextCursor, set_next_cursor] = useState<string | null>(null);
  // Anuncios mostrados en ESTA sesión (vida del hook): acumula entre
  // loadInitial/loadMore/refetch, nunca se resetea (170.4, decisión 5).
  const already_shown_ref = useRef(0);
  // 256: `since_last_ad` final que dejó la ÚLTIMA página compuesta — cruza la
  // costura entre loadMore consecutivos. `undefined` = "sin página anterior":
  // loadInitial/refetch lo reinicia ANTES de componer (una carga nueva no
  // hereda el cierre de una sesión de scroll distinta).
  const since_last_ad_ref = useRef<number | undefined>(undefined);
  // #285.3 — feed infinito (doc 047 A+D): número de vuelta vigente. 0 = el
  // inventario todavía no se agotó; N≥1 = ya se re-sirvió N veces. Vive en un
  // ref (lo lee la carga en vuelo) y se espeja en `lapCount` para la UI (285.5).
  // SIN TECHO por decisión de Abraham (§20 Q5): la mitigación de cuota es que
  // useFeedActiveIndex corta la reproducción fuera de foreground/tab.
  const lap_ref = useRef(0);
  const [lapCount, set_lap_count] = useState(0);
  // #296.5 — tab cuyo dataset está actualmente en `data` (lo usan
  // noteScrollIndex/loadMore para escribir la entrada correcta de
  // feedTabCache; puede diferir de `feed_tab` un instante entre el cambio de
  // prop y el loadInitial que lo sigue).
  const loaded_tab_ref = useRef<FeedTab>(feed_tab);
  // #296.5 — scroll_index restaurado en el último HIT de caché; null tras un
  // miss/refetch (dataset fresco, sin scroll heredado).
  const [restoredScrollIndex, set_restored_scroll_index] = useState<number | null>(null);
  // #296.5 — señal para disparar el prefetch de vecinos vía efecto (en vez de
  // llamar InteractionManager.runAfterInteractions in-line dentro del propio
  // fetch): así el prefetch corre en un tick de React separado del que
  // resuelve loadInitial, no en el flujo síncrono que el propio loadInitial
  // todavía está desenrollando.
  const [prefetch_trigger, set_prefetch_trigger] = useState<{
    tab: FeedTab;
    filters_key: string;
    deps: FeedPropertiesDeps | undefined;
  } | null>(null);

  // #249 — SOLO LA PETICIÓN VIGENTE ESCRIBE ESTADO.
  // Al aplicar un filtro, la petición del filtro ANTERIOR sigue en vuelo (no se
  // cancela). Si resolvía DESPUÉS de la nueva, su set_data pisaba la página ya
  // filtrada y el feed se quedaba mostrando lo de antes; el pull-to-refresh,
  // que es una sola petición sin solapamiento, sí aplicaba los filtros — el
  // síntoma exacto del smoke #222. Cada carga toma un número de turno y solo
  // escribe si sigue siendo el último al volver del await.
  // ponytail: un contador en un ref, no AbortController ni librería de fetching
  // — la respuesta tardía se descarta, que es todo lo que el feed necesita.
  // Techo conocido: la petición desechada igual viaja por red (no se aborta).
  const request_seq_ref = useRef(0);
  // #288.1 — loadMore en vuelo (página o vuelta). Ref, no estado: la carga de
  // continuación no tiene UI propia; `isLoading` queda para initial/refetch.
  const load_more_in_flight_ref = useRef(false);

  // #195 — LA ZONA VISTA GANA SOBRE EL GPS, del lado cliente.
  // `filters.area` es "buscar en esta zona" (#56): su centro sale del viewport
  // del mapa, o sea que es literalmente el punto que la persona está mirando.
  // Sin esto, quien explora Guadalajara desde CDMX veía anuncios de CDMX y el
  // inventario de Guadalajara —que alguien pagó— no se servía nunca.
  // 🔴 Solo afecta a los ANUNCIOS: las propiedades ya resuelven `area` por su
  // propio camino (properties_within_radius), y mezclarlos aquí rompería el
  // invariante A1 de #42.
  // Se resuelve dentro de cada callback (no en el cuerpo del hook) para no
  // perder el estrechamiento de `coords`, que ahí ya pasó el guard de null.
  const resolve_ad_zone_coords = useCallback(
    (gps: { latitude: number; longitude: number }): { latitude: number; longitude: number } =>
      filters?.area
        ? { latitude: filters.area.center.lat, longitude: filters.area.center.lng }
        : gps,
    [filters],
  );

  // ponytail: deps solo se arma cuando ya hay coords reales; sin ellas se pasa
  // undefined y fetchFeedProperties usa su propio lazy-require del singleton
  // + fallback GDL (evita importar '@/lib/supabase/client' en top-level aquí,
  // que lanza sin env vars — mismo motivo que en feedProperties.ts).
  const build_deps = useCallback((): FeedPropertiesDeps | undefined => {
    if (!coords) return undefined;
    const { supabase } = require('@/lib/supabase/client') as { supabase: unknown };
    return { supabase, coords };
  }, [coords]);

  // #296.5 — prefetch en idle de la página 1 de los vecinos de `tab` (doc 050,
  // opción I1) SIN entrada vigente. Corre tras CUALQUIER loadInitial exitoso
  // (hit o miss) — un hit también deja la puerta abierta a que sus propios
  // vecinos sigan sin caché. SOLO datos/URLs — nunca
  // compone anuncios (evita el costo de ads_for_zone/mint en background) ni
  // toca data/isLoading/error del tab visible. Fallos por vecino se ignoran
  // en silencio: es trabajo de fondo, no una carga que el usuario pidió.
  const schedule_neighbor_prefetch = useCallback(
    (tab: FeedTab, filters_key: string, deps: FeedPropertiesDeps | undefined) => {
      const active_filters = filters ?? EMPTY_FILTERS;
      InteractionManager.runAfterInteractions(async () => {
        for (const vecino of neighbor_tabs(tab)) {
          if (get_feed_tab_entry(vecino, filters_key, Date.now())) continue;
          try {
            const result = await fetch_feed_page(undefined, deps, with_tab(active_filters, vecino), {
              tab: vecino,
              user_id,
            });
            set_feed_tab_entry(vecino, {
              items: to_property_items(result.data),
              next_cursor: result.nextCursor,
              lap: 0,
              scroll_index: 0,
              fetched_at: Date.now(),
              filters_key,
            });
          } catch {
            // ponytail: un vecino caído no es un error del feed — es trabajo
            // de fondo que nadie pidió todavía; se reintenta en el próximo
            // loadInitial real de ese tab.
          }
        }
      });
    },
    [filters, user_id],
  );

  // #296.5 — flujo de red compartido por loadInitial (rama miss) y refetch
  // (siempre lo usa, salta la caché a propósito): fetch + composición +
  // escritura de la entrada del tab + prefetch de vecinos.
  const fetch_and_store = useCallback(
    async (filters_key: string) => {
      // #59: no cargar hasta que haya coords reales. Sin este guard, el primer
      // loadInitial (coords null en cold start) traía el orden centrado en GDL
      // (fallback del lib) y luego saltaba al orden por proximidad al llegar la
      // coord real → "flash".
      if (!coords) return;
      const seq = ++request_seq_ref.current;
      lap_ref.current = 0; // 285.3: carga nueva = vuelta 0; una vuelta en vuelo llega tarde y se descarta
      set_lap_count(0);
      set_is_loading(true);
      set_error(null);
      set_restored_scroll_index(null); // 296.5: dataset fresco, sin scroll heredado
      try {
        const deps = build_deps();
        const result = await fetch_feed_page(undefined, deps, filters, { tab: feed_tab, user_id });
        // Se corta ANTES de componer: una página que ya no se va a pintar no
        // debe firmar anuncios ni sumar a `already_shown_ref` (el cap de sesión
        // contaría impresiones que nadie llegó a ver).
        if (seq !== request_seq_ref.current) return;
        since_last_ad_ref.current = undefined; // 256: carga nueva, sin página anterior que heredar
        const items = await compose_feed_items(deps?.supabase, resolve_ad_zone_coords(coords), result.data, already_shown_ref, true, since_last_ad_ref);
        if (seq !== request_seq_ref.current) return; // llegó tarde: ya hay otra carga
        set_data(items);
        set_next_cursor(result.nextCursor);
        loaded_tab_ref.current = feed_tab;
        set_feed_tab_entry(feed_tab, {
          items,
          next_cursor: result.nextCursor,
          lap: 0,
          scroll_index: 0,
          fetched_at: Date.now(),
          filters_key,
        });
        set_prefetch_trigger({ tab: feed_tab, filters_key, deps });
      } catch (e) {
        if (seq !== request_seq_ref.current) return;
        set_error(e instanceof Error ? e.message : 'Error al cargar el feed');
      } finally {
        if (seq === request_seq_ref.current) set_is_loading(false);
      }
    },
    [coords, resolve_ad_zone_coords, filters, feed_tab, user_id, build_deps],
  );

  const load_initial = useCallback(async () => {
    const filters_key = feed_cache_key(filters ?? EMPTY_FILTERS, user_id);
    // #296.5 — el cache-check SOLO aplica al CAMBIAR de tab (loaded_tab_ref
    // distinto de feed_tab): una llamada repetida a loadInitial() para el tab
    // que YA está en pantalla (mismo identity de loadInitial, o un caller que
    // lo invoca de nuevo a mano) sigue refrescando de red como siempre — es
    // el comportamiento que #285.3/#249 ya tenían y varias suites verifican
    // (p.ej. que una vuelta/lap se resetea al recargar). Sin este guard, una
    // segunda llamada al MISMO tab "restauraba" su propio último estado en
    // vez de refrescar. ponytail: techo conocido — un remount real de
    // FeedScreen con el mismo tab (no solo un cambio de props) tampoco
    // restaura desde caché; no lo cubre ningún caso de uso ni test dado.
    const cached =
      loaded_tab_ref.current !== feed_tab
        ? get_feed_tab_entry(feed_tab, filters_key, Date.now())
        : undefined;
    if (cached) {
      // #296.5 — HIT: restaura sin fetch, SIN encender isLoading ni siquiera
      // un instante (ninguna rama de este bloque tiene `await`). Invalida
      // cualquier carga anterior en vuelo (seq) para que una respuesta tardía
      // no pise este tab recién restaurado.
      ++request_seq_ref.current;
      lap_ref.current = cached.lap;
      set_lap_count(cached.lap);
      since_last_ad_ref.current = undefined;
      set_error(null);
      set_data(cached.items);
      set_next_cursor(cached.next_cursor);
      set_restored_scroll_index(cached.scroll_index);
      loaded_tab_ref.current = feed_tab;
      set_prefetch_trigger({ tab: feed_tab, filters_key, deps: build_deps() });
      return;
    }
    await fetch_and_store(filters_key);
  }, [filters, feed_tab, user_id, fetch_and_store, build_deps]);

  const refetch = useCallback(async () => {
    const filters_key = feed_cache_key(filters ?? EMPTY_FILTERS, user_id);
    await fetch_and_store(filters_key);
  }, [filters, user_id, fetch_and_store]);

  const note_scroll_index = useCallback((index: number) => {
    update_feed_tab_scroll(loaded_tab_ref.current, index);
  }, []);

  useEffect(() => {
    if (!prefetch_trigger) return;
    schedule_neighbor_prefetch(prefetch_trigger.tab, prefetch_trigger.filters_key, prefetch_trigger.deps);
  }, [prefetch_trigger, schedule_neighbor_prefetch]);

  const load_more = useCallback(async () => {
    if (isLoading || load_more_in_flight_ref.current || !coords) return;
    // #285.3 — VUELTA: sin cursor y con inventario ya servido, en vez de
    // quedarse quieto (el feed "colgado" del doc 047) se re-pide la página 1
    // (URLs firmadas re-minteadas: el TTL de 4 h vencería si se reusara
    // memoria), se baraja con semilla `session + vuelta` (determinista: misma
    // sesión y vuelta → mismo orden) y se APENDEA como continuación. El wrap
    // es sobre los ítems compuestos de esa página, nunca módulo rpc_ids. Con
    // data vacío no hay nada que repetir: is_empty se mantiene.
    const is_lap = nextCursor === null;
    if (is_lap && data.length === 0) return;
    const seq = ++request_seq_ref.current;
    load_more_in_flight_ref.current = true;
    set_error(null);
    try {
      const deps = build_deps();
      const result = await fetch_feed_page(is_lap ? undefined : nextCursor, deps, filters, {
        tab: feed_tab,
        user_id,
      });
      if (seq !== request_seq_ref.current) return; // mismo corte previo a componer
      // Las páginas 2+ de una vuelta heredan su número (mismas keys `#lap`);
      // solo la página 1 de la vuelta se baraja — hoy el inventario cabe en una.
      const lap = is_lap ? lap_ref.current + 1 : lap_ref.current;
      // #288.2 — la vuelta no abre con el último video servido: si el feed
      // termina en propiedad y el barajado la repite en la posición 0, esa
      // propiedad se va al final (si termina en anuncio no hay pegado posible).
      const last = data[data.length - 1];
      const last_property_id = last?.kind === 'property' ? last.property.id : null;
      // #296.4 — decisión de Abraham: "Nuevos" (única tab que resuelve a la
      // fuente `ordenada`, ver source_for_tab en feedSources.ts) NO se baraja
      // en la vuelta: re-sirve la página 1 en el mismo orden exacto de
      // fetch_feed_page. El resto de tabs conserva #285.3/#288.2 intacto.
      // ponytail: comparación directa contra el tab (no una llamada a
      // source_for_tab) — el seam de este hook es fetch_feed_page, no el
      // resolutor de fuente; evita depender de un segundo export del mismo
      // módulo mockeado en useFeedProperties.tabs.test.tsx.
      const is_ordered_tab = feed_tab === 'nuevos';
      const page =
        is_lap && !is_ordered_tab
          ? avoid_adjacent_repeat(
              shuffle_with_seed(result.data, hash_seed(get_app_session_id()) + lap),
              (first) => first.id === last_property_id,
            )
          : result.data;
      const composed = await compose_feed_items(deps?.supabase, resolve_ad_zone_coords(coords), page, already_shown_ref, false, since_last_ad_ref);
      // Una página pedida ANTES de aplicar el filtro no se apende al feed ya
      // refiltrado: sería contenido de la búsqueda anterior colado al final.
      if (seq !== request_seq_ref.current) return;
      const items: LappedFeedItem[] = lap > 0 ? composed.map((item) => ({ ...item, lap })) : composed;
      if (is_lap) {
        lap_ref.current = lap;
        set_lap_count(lap);
      }
      set_data((prev) => [...prev, ...items]);
      set_next_cursor(result.nextCursor);
      // #296.5 — el tab cargado sigue siendo el mismo (loadMore nunca cambia
      // de tab): actualiza SU entrada con los items acumulados y el cursor
      // nuevo, preservando el scroll_index que ya tuviera.
      const filters_key = feed_cache_key(filters ?? EMPTY_FILTERS, user_id);
      const existing_entry = get_feed_tab_entry(loaded_tab_ref.current, filters_key, Date.now());
      set_feed_tab_entry(loaded_tab_ref.current, {
        items: [...data, ...items],
        next_cursor: result.nextCursor,
        lap: lap_ref.current,
        scroll_index: existing_entry?.scroll_index ?? 0,
        fetched_at: Date.now(),
        filters_key,
      });
    } catch (e) {
      if (seq !== request_seq_ref.current) return;
      set_error(e instanceof Error ? e.message : 'Error al cargar más');
    } finally {
      load_more_in_flight_ref.current = false;
    }
  }, [nextCursor, isLoading, coords, data, resolve_ad_zone_coords, filters, feed_tab, user_id, build_deps]);

  // #241.2: al cambiar la identidad de `filters` (sección Venta/Renta, sheet,
  // zona) se VACÍA la lista antes de que llegue la página nueva. Sin esto el
  // feed seguía mostrando —y reproduciendo— videos de la sección anterior con
  // un spinner arriba hasta que resolvía el fetch; ahora FeedScreen cae al
  // skeleton (isLoading && data.length === 0) y el FlashList se remonta desde
  // el primer ítem. El pull-to-refresh NO pasa por aquí (misma identidad).
  // ponytail: sin flag de "razón del reload" — la identidad de filters ya es la
  // señal; loadInitial la sigue en el mismo flush de efectos (FeedScreen).
  const is_first_filters = useRef(true);
  useEffect(() => {
    if (is_first_filters.current) {
      is_first_filters.current = false;
      return;
    }
    set_data([]);
    set_next_cursor(null);
    lap_ref.current = 0; // 285.3: filtros nuevos = inventario nuevo, la cuenta de vueltas vuelve a 0
    set_lap_count(0);
  }, [filters]);

  useEffect(
    () =>
      onPropertyDeleted((id) =>
        set_data((prev) => prev.filter((item) => item.kind !== 'property' || item.property.id !== id)),
      ),
    [],
  );

  return {
    data,
    isLoading,
    error,
    nextCursor,
    loadInitial: load_initial,
    refetch,
    loadMore: load_more,
    lapCount,
    restoredScrollIndex,
    noteScrollIndex: note_scroll_index,
  };
}
