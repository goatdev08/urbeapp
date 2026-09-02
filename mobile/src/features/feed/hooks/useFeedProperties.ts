/**
 * useFeedProperties — hook React que envuelve fetchFeedProperties y compone
 * el feed heterogéneo (propiedades + anuncios intercalados, 170.4).
 *
 * Expone: data (FeedItem[]), isLoading, error, nextCursor, loadInitial,
 * refetch, loadMore. Paginación acumulativa: loadMore apende al array
 * existente.
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
 * ponytail: sin estado extra — loading único para initial y loadMore;
 * techo conocido: sin abort controller (el feed es efímero, sin race visible).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useLocation } from '@/features/location/LocationProvider';
import type { FilterState } from '@/features/search/types';
import { onPropertyDeleted } from '@/lib/propertyEvents';

import { get_app_session_id } from '../lib/appSession';
import {
  ads_failure_store,
  report_ads_failure,
  type AdsFailureClient,
  type AdsFailureStage,
} from '../lib/adsFailureSignal';
import { fetchFeedProperties, mint_videos, type FeedPropertiesDeps } from '../lib/feedProperties';
import { interleave_ads, type FeedAd, type FeedItem } from '../lib/interleaveAds';
import type { FeedPropertyWithUrl } from '../types';

export interface UseFeedPropertiesState {
  data: FeedItem[];
  isLoading: boolean;
  error: string | null;
  nextCursor: string | null;
  /** Carga la primera página (descarta estado previo). */
  loadInitial: () => Promise<void>;
  /** Alias de loadInitial para el patrón pull-to-refresh. */
  refetch: () => Promise<void>;
  /** Carga la siguiente página y apende al array existente. */
  loadMore: () => Promise<void>;
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

  const items = interleave_ads(properties, ads, {
    every_n: config.ad_frequency_n,
    max_per_session: config.ad_max_per_session,
    min_gap_between_repeats: config.ad_frequency_n * 2,
    already_shown_count: already_shown_ref.current,
    skip_first_position,
  });

  already_shown_ref.current += items.filter((item) => item.kind === 'ad').length;

  return items;
}

export function useFeedProperties(filters?: FilterState): UseFeedPropertiesState {
  const { coords } = useLocation();
  const [data, set_data] = useState<FeedItem[]>([]);
  // ponytail: arranca en true — FeedScreen siempre llama loadInitial en mount;
  // esto evita un frame de "empty state" antes de que useEffect dispare.
  const [isLoading, set_is_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [nextCursor, set_next_cursor] = useState<string | null>(null);
  // Anuncios mostrados en ESTA sesión (vida del hook): acumula entre
  // loadInitial/loadMore/refetch, nunca se resetea (170.4, decisión 5).
  const already_shown_ref = useRef(0);

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

  const load_initial = useCallback(async () => {
    // #59: no cargar hasta que haya coords reales. Sin este guard, el primer
    // loadInitial (coords null en cold start) traía el orden centrado en GDL
    // (fallback del lib) y luego saltaba al orden por proximidad al llegar la
    // coord real → "flash".
    if (!coords) return;
    set_is_loading(true);
    set_error(null);
    try {
      const deps = build_deps();
      const result = await fetchFeedProperties(undefined, deps, filters);
      const items = await compose_feed_items(deps?.supabase, resolve_ad_zone_coords(coords), result.data, already_shown_ref, true);
      set_data(items);
      set_next_cursor(result.nextCursor);
    } catch (e) {
      set_error(e instanceof Error ? e.message : 'Error al cargar el feed');
    } finally {
      set_is_loading(false);
    }
  }, [coords, resolve_ad_zone_coords, filters, build_deps]);

  const load_more = useCallback(async () => {
    if (!nextCursor || isLoading || !coords) return;
    set_is_loading(true);
    set_error(null);
    try {
      const deps = build_deps();
      const result = await fetchFeedProperties(nextCursor, deps, filters);
      const items = await compose_feed_items(deps?.supabase, resolve_ad_zone_coords(coords), result.data, already_shown_ref, false);
      set_data((prev) => [...prev, ...items]);
      set_next_cursor(result.nextCursor);
    } catch (e) {
      set_error(e instanceof Error ? e.message : 'Error al cargar más');
    } finally {
      set_is_loading(false);
    }
  }, [nextCursor, isLoading, coords, resolve_ad_zone_coords, filters, build_deps]);

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
    refetch: load_initial,
    loadMore: load_more,
  };
}
