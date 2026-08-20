/**
 * AdFeedItem — el anuncio dentro del feed vertical. Subtarea 170.8 (+ #192).
 *
 * COMPONENTE SEPARADO de VideoFeedItem, no una rama dentro de él: así apagar
 * la publicidad no puede degradar el render de propiedades, y el diff del feed
 * queda acotado.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 EL BADGE "PATROCINADO" ES UNA OBLIGACIÓN LEGAL, no una decoración.
 * Publicidad identificable: va montado FUERA del bloque de contenido, con
 * posición fija, y NO se condiciona a `isActive`, ni al scroll, ni a un fade.
 * Un badge que aparece y desaparece es un badge que se puede no ver.
 *
 * Diseño aprobado (gate de 170.8, preview en urbea-preview-anuncio-feed.html):
 *   · Copy: "Patrocinado".
 *   · Variante A: arriba, aislado. Se eligió sobre la B (integrada en el
 *     bloque inferior) porque un título de dos líneas nunca puede empujarlo ni
 *     taparlo — en el elemento legal, la posición constante gana a la
 *     coherencia visual.
 *   · Color accent_soft sólido (#C2A07C) + texto ink. NO usa primary ni accent
 *     puros: esos son los chips Renta/Venta de PropertyOverlay, y reusar su
 *     color en el badge legal crearía justo la ambigüedad que hay que evitar.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * #192 — identidad del anunciante (logo + nombre, mismo tratamiento que la
 * identidad del agente en una propiedad) y descripción AUTOLINKIFICADA. La
 * descripción es texto plano con URLs detectadas, NUNCA markdown: el texto
 * visible ES el destino (ver lib/adCtaLink.ts para el porqué y el invariante).
 *
 * 🔴 EL CTA DEGRADA, NUNCA SE QUEDA MUDO. Si no hay app destino (WhatsApp sin
 * instalar, sin marcador), se muestra el valor para que la persona lo copie —
 * un botón que no hace nada es peor que no tener botón.
 *
 * MEDICIÓN (170.7): la exposición se encola UNA vez, al TERMINAR — cuando el
 * anuncio deja de estar activo o el componente se desmonta — con el
 * `watched_ms` ya definitivo. Encolar antes produciría una fila con el tiempo
 * equivocado y ninguna forma de notarlo (el servidor hace ON CONFLICT DO
 * NOTHING y descarta el segundo valor en silencio).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Clipboard from 'expo-clipboard';
import { Megaphone, Phone, WhatsappLogo, ArrowSquareOut, type Icon } from 'phosphor-react-native';

import { colors, radii, spacing, type_scale } from '@/theme/theme';
import { useLocation } from '@/features/location/LocationProvider';
import { build_cta_target, linkify_description } from '@/features/ads/lib/adCtaLink';

import { ad_impression_queue } from '../lib/adImpressionQueue';
import { get_app_session_id } from '../lib/appSession';
import type { FeedAd } from '../lib/interleaveAds';

export type AdFeedItemProps = {
  ad: FeedAd;
  isActive: boolean;
};

const CTA_LABEL: Record<string, string> = {
  external_url: 'Ver más',
  whatsapp: 'Enviar WhatsApp',
  phone: 'Llamar',
};

const CTA_ICON: Record<string, Icon> = {
  external_url: ArrowSquareOut,
  whatsapp: WhatsappLogo,
  phone: Phone,
};

/** Ratio de compleción, el MISMO de #112 — "visto completo" no puede significar dos cosas. */
const COMPLETION_RATIO = 0.95;

export function AdFeedItem({ ad, isActive }: AdFeedItemProps) {
  const { height } = useWindowDimensions();
  const { coords } = useLocation();

  const [fallback_message, set_fallback_message] = useState<string | null>(null);
  const [copied, set_copied] = useState(false);

  const target = build_cta_target(ad.cta_type, ad.cta_value);
  const segments = linkify_description(ad.description);

  // ── Reproducción ──────────────────────────────────────────────────────────
  // Mismo patrón que VideoFeedItem: player ESTABLE por instancia (fix #61).
  // FlashList recicla, así que la fuente inicial se congela y los cambios
  // entran por replaceAsync.
  const [initial_source] = useState(ad.video_url ?? null);
  const player = useVideoPlayer(initial_source, (p) => {
    p.loop = true;
    p.muted = false;
    p.bufferOptions = { preferredForwardBufferDuration: 10, maxBufferBytes: 25 * 1024 * 1024 };
    // > 0 obligatorio: con el default (0) expo-video NO emite timeUpdate y la
    // detección de compleción queda muerta con la suite en verde (#112).
    p.timeUpdateEventInterval = 0.5;
  });

  const applied_source_ref = useRef(initial_source);
  useEffect(() => {
    const next = ad.video_url ?? null;
    if (next === applied_source_ref.current) return;
    applied_source_ref.current = next;
    if (!next) return;
    void player.replaceAsync(next).catch(() => undefined);
  }, [player, ad.video_url]);

  useEffect(() => {
    if (isActive) player.play();
    else player.pause();
  }, [isActive, player]);

  // ── Medición de la exposición (170.7) ─────────────────────────────────────
  const shown_at_ref = useRef<string | null>(null);
  const active_since_ref = useRef<number | null>(null);
  const watched_ms_ref = useRef(0);
  const completed_ref = useRef(false);
  // coords en ref: la exposición se cierra en el cleanup, y meter coords a las
  // deps re-dispararía ese cleanup con cada actualización del GPS.
  const coords_ref = useRef(coords);
  useEffect(() => {
    coords_ref.current = coords;
  }, [coords]);

  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      const duration = player.duration;
      if (duration > 0 && currentTime >= duration * COMPLETION_RATIO) {
        completed_ref.current = true;
      }
    });
    return () => sub.remove();
  }, [player]);

  /**
   * Cierra la exposición y la encola. Idempotente por (session_id, ad_id) a
   * nivel del propio queue, pero además se acumula el tiempo acá para que el
   * `watched_ms` que sale sea el DEFINITIVO — ese es el contrato de 170.7.
   */
  const close_exposure = useCallback(() => {
    if (active_since_ref.current !== null) {
      watched_ms_ref.current += Date.now() - active_since_ref.current;
      active_since_ref.current = null;
    }
    const shown_at = shown_at_ref.current;
    const gps = coords_ref.current;
    if (!shown_at || watched_ms_ref.current <= 0 || !gps) return;

    ad_impression_queue.enqueue_impression({
      ad_id: ad.id,
      session_id: get_app_session_id(),
      shown_at,
      watched_ms: watched_ms_ref.current,
      completed: completed_ref.current,
      lat: gps.latitude,
      lng: gps.longitude,
    });
  }, [ad.id]);

  useEffect(() => {
    if (isActive) {
      if (shown_at_ref.current === null) shown_at_ref.current = new Date().toISOString();
      active_since_ref.current = Date.now();
      return;
    }
    close_exposure();
  }, [isActive, close_exposure]);

  // Desmontar con el anuncio todavía activo (salir del feed) también cierra.
  useEffect(() => close_exposure, [close_exposure]);

  // ── CTA ───────────────────────────────────────────────────────────────────
  const open_cta = useCallback(async () => {
    if (!target) return;
    // El tap se registra ANTES de salir de la app: si openURL nos manda a
    // WhatsApp, este componente puede no volver a ejecutar nada.
    ad_impression_queue.report_cta_tap({
      ad_id: ad.id,
      session_id: get_app_session_id(),
      cta_tapped_at: new Date().toISOString(),
    });

    try {
      const can_open = await Linking.canOpenURL(target.url);
      if (!can_open) throw new Error('sin app destino');
      await Linking.openURL(target.url);
    } catch {
      // 🔴 Degrada, nunca se queda mudo ni crashea.
      set_fallback_message(
        target.kind === 'external_url'
          ? 'No se pudo abrir el enlace. Cópialo y ábrelo en tu navegador.'
          : 'No se pudo abrir la app. Copia el número y márcalo a mano.',
      );
    }
  }, [ad.id, target]);

  const copy_value = useCallback(async () => {
    if (!target) return;
    await Clipboard.setStringAsync(target.kind === 'external_url' ? target.url : ad.cta_value);
    set_copied(true);
  }, [target, ad.cta_value]);

  const open_link = useCallback((url: string) => {
    void Linking.openURL(url).catch(() => set_fallback_message('No se pudo abrir el enlace.'));
  }, []);

  const CtaIcon = CTA_ICON[ad.cta_type] ?? ArrowSquareOut;
  const cta_style = ad.cta_type === 'whatsapp' ? styles.cta_whatsapp : styles.cta_primary;

  return (
    <View style={[styles.root, { height }]} testID="ad-feed-item">
      {ad.video_url ? (
        <VideoView player={player} style={styles.video} contentFit="cover" nativeControls={false} />
      ) : (
        <View style={styles.video_placeholder}>
          <ActivityIndicator color={colors.gray_1} />
        </View>
      )}

      {/* 🔴 Badge legal — fuera del bloque de contenido, sin condicionar a nada. */}
      <View style={styles.badge} testID="ad-sponsored-badge">
        <Megaphone size={14} weight="fill" color={colors.ink} />
        <Text style={styles.badge_text}>Patrocinado</Text>
      </View>

      <View style={styles.content}>
        <View style={styles.identity}>
          {ad.agency_logo_url ? (
            <Image source={{ uri: ad.agency_logo_url }} style={styles.logo} contentFit="cover" />
          ) : (
            <View style={[styles.logo, styles.logo_empty]} />
          )}
          <Text style={styles.agency} numberOfLines={1}>
            {ad.agency_name}
          </Text>
        </View>

        <Text style={styles.title} numberOfLines={2}>
          {ad.title}
        </Text>

        {segments.length > 0 && (
          <Text style={styles.description} numberOfLines={3}>
            {segments.map((segment, index) =>
              segment.kind === 'link' && segment.url ? (
                <Text
                  key={`${segment.value}-${index}`}
                  style={styles.link}
                  onPress={() => open_link(segment.url as string)}
                >
                  {segment.value}
                </Text>
              ) : (
                <Text key={`${segment.value}-${index}`}>{segment.value}</Text>
              ),
            )}
          </Text>
        )}

        {/* Sin destino utilizable no se pinta el botón: mejor sin CTA que con
            uno que no abre nada. */}
        {target && (
          <Pressable
            onPress={() => void open_cta()}
            style={({ pressed }) => [styles.cta, cta_style, pressed && styles.cta_pressed]}
            accessibilityRole="button"
            accessibilityLabel={CTA_LABEL[ad.cta_type] ?? 'Ver más'}
            testID="ad-cta-button"
          >
            <CtaIcon size={18} weight="fill" color={colors.on_primary} />
            <Text style={styles.cta_text}>{CTA_LABEL[ad.cta_type] ?? 'Ver más'}</Text>
          </Pressable>
        )}

        {fallback_message && (
          <View style={styles.fallback} testID="ad-cta-fallback">
            <Text style={styles.fallback_text}>{fallback_message}</Text>
            <Pressable onPress={() => void copy_value()} accessibilityRole="button">
              <Text style={styles.fallback_action}>{copied ? 'Copiado' : 'Copiar'}</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', backgroundColor: colors.ink_feed },
  video: { ...StyleSheet.absoluteFill },
  video_placeholder: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: spacing.s_40 + spacing.s_8,  // safe-area del notch + aire
    left: spacing.s_16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_4,
    paddingHorizontal: spacing.s_8,
    paddingVertical: spacing.s_4,
    borderRadius: radii.r_8,
    backgroundColor: colors.accent_soft,
  },
  badge_text: {
    color: colors.ink,
    fontSize: type_scale.caption.fontSize,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  content: {
    position: 'absolute',
    left: spacing.s_16,
    right: spacing.s_16,
    bottom: spacing.s_32,
    gap: spacing.s_8,
  },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.s_8 },
  logo: { width: 28, height: 28, borderRadius: 14 },
  logo_empty: { backgroundColor: colors.gray_1, opacity: 0.4 },
  agency: { color: colors.gray_1, fontSize: type_scale.caption.fontSize, flexShrink: 1 },
  title: { color: colors.on_primary, fontSize: type_scale.h1.fontSize, fontWeight: '700' },
  description: { color: colors.gray_1, fontSize: type_scale.body.fontSize },
  link: { color: colors.accent_soft, textDecorationLine: 'underline' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s_8,
    paddingVertical: spacing.s_12,
    borderRadius: radii.r_12,
    marginTop: spacing.s_4,
  },
  cta_primary: { backgroundColor: colors.primary },
  cta_whatsapp: { backgroundColor: colors.whatsapp },
  cta_pressed: { opacity: 0.85 },
  cta_text: { color: colors.on_primary, fontSize: type_scale.body.fontSize, fontWeight: '700' },
  fallback: { flexDirection: 'row', alignItems: 'center', gap: spacing.s_8 },
  fallback_text: { color: colors.gray_1, fontSize: type_scale.caption.fontSize, flexShrink: 1 },
  fallback_action: {
    color: colors.accent_soft,
    fontSize: type_scale.caption.fontSize,
    fontWeight: '700',
  },
});
