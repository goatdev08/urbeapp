/**
 * /admin/ads — cola de moderación (208.3) + vista de activos / takedown de
 * emergencia (210.3), como dos segmentos de la misma pantalla.
 *
 * Estética utilitaria/clara, misma que /admin (NO el feed oscuro). El techo de
 * alcance es lo que ya existe en el panel de administración: la identidad
 * visual no trae mockup de esta pantalla, así que se calca el lenguaje ya
 * usado aquí (208.3) en vez de inventar UI nueva.
 *
 * ## Segmento "Revisión" (sin cambios de 208.3)
 * Datos: usePendingAds — filtra `status='pending_review'` en el cliente.
 * Acción: useModerateAd.approve/reject.
 *
 * ## Segmento "Activos" (210.3, takedown de emergencia)
 * Datos: useActiveAds — filtra `status IN ('active','paused')` en el cliente,
 * MISMO gotcha de RLS que usePendingAds (la policy incluye
 * `private.is_admin()`). Acciones: useModerateAd.pause/resume (confirmación
 * nativa para pausar, reversible) y useModerateAd.reject vía
 * `RejectionReasonModal` — hoy su ÚNICO consumidor es esta sección de
 * Activos ("Revisión" rechaza inline dentro de ModerationSheet).
 *
 * 🔴 SEGUNDA PASADA (210.3, orquestador extendió el RED tras el primer GREEN):
 * la decisión original de esta vista era "solo `status='active'`" con un
 * estado local efímero (`recently_paused`) para deshacer un pause reciente —
 * un anuncio pausado en una sesión ANTERIOR desaparecía sin forma de
 * reanudarlo. `useActiveAds` ahora consulta `status IN ('active','paused')`
 * (21 tests, EC-19..EC-21 nuevos) y trae `paused_at`/`paused_by_suspension`;
 * el mecanismo local quedó REDUNDANTE y se eliminó — `refetch` (ya
 * encadenado al `onSuccess` de `useModerateAd`) trae el anuncio recién
 * pausado de vuelta con su estado real, sin estado paralelo en el cliente.
 * Un anuncio `paused` NO ofrece "Bajar": la matriz de transiciones de la base
 * (20260816000006, `active->{paused,expired,rejected}, paused->active`) NO
 * tiene `paused->rejected` — ofrecerlo terminaría en 409
 * `INVALID_AD_STATUS_TRANSITION`. Solo "Reanudar", deshabilitado si
 * `paused_by_suspension` (la cascada de #211 lo pausó; el único camino de
 * vuelta es reactivar la organización, useModerateAd EC-25).
 *
 * 🔴 CUOTA DE CLOUDFLARE STREAM. El creativo NUNCA se reproduce en ninguna de
 * las dos listas: en "Revisión" se firma bajo demanda al abrir el detalle
 * (mint-ad-urls); en "Activos" ni siquiera se ofrece — es la lista de
 * emergencia para pausar/bajar, no de revisión ([[video_playback_burns_quota]]).
 *
 * 🔴 BAJAR (reject) EXIGE MOTIVO EN AMBOS SEGMENTOS. Lo impone el CHECK
 * bidireccional `ads_rejection_reason_matches_status` en la base y lo duplica
 * useModerateAd en el cliente.
 */
import React, { useCallback, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackButton } from '@/components/BackButton';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { supabase } from '@/lib/supabase/client';
import { mint_videos } from '@/features/feed/lib/feedProperties';
import { usePendingAds, type PendingAd } from '@/features/ads/hooks/usePendingAds';
import { useActiveAds, type ActiveAd } from '@/features/ads/hooks/useActiveAds';
import { useModerateAd, type ModerateResult } from '@/features/ads/hooks/useModerateAd';
import { map_ad_moderation_error } from '@/features/ads/ad_moderation_error_messages';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function format_date(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Días que un anuncio lleva esperando en la cola. */
function days_waiting(created_at: string): number {
  const created = new Date(created_at).getTime();
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.floor((Date.now() - created) / 86_400_000));
}

type MintedAdUrl = { creative_id: string; posterUrl: string; videoUrl: string };

/**
 * Pide a mint-ad-urls la URL firmada de UN creativo. 🔴 #205: `invoke` se llama
 * ligado a `functions` — desprenderlo pierde el `this` y falla mudo.
 * Devuelve null si la EF falla o no autoriza (fail-closed por item).
 */
async function mint_one(creative_id: string): Promise<MintedAdUrl | null> {
  const { data, error } = await supabase.functions.invoke('mint-ad-urls', {
    body: { creative_ids: [creative_id] },
  });
  if (error) return null;
  const urls = (data as { urls?: unknown } | null)?.urls;
  if (!Array.isArray(urls) || urls.length === 0) return null;
  return urls[0] as MintedAdUrl;
}

/**
 * 213: pide a mint-video-url (la MISMA EF que resuelve el video de una
 * propiedad en el feed — `mint_videos`, sin duplicar el fetch) el video de
 * la propiedad promocionada. Nunca `mint_one(null)`: una promo no tiene
 * creative_id. Fail-closed por item, mismo criterio que mint_one.
 */
async function mint_one_promo(property_id: string): Promise<MintedAdUrl | null> {
  try {
    const videos = await mint_videos(supabase, [property_id]);
    const video = videos[0];
    if (!video) return null;
    return { creative_id: property_id, posterUrl: video.posterUrl ?? '', videoUrl: video.signed_url };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Modal de motivo — compartido entre "Rechazar" (Revisión) y "Bajar" (Activos)
// ---------------------------------------------------------------------------

/**
 * Modal genérico "escribe un motivo y confirma". Envuelve `reject` de
 * useModerateAd — el CHECK de la base exige el motivo para CUALQUIER
 * transición a `rejected`, sea desde `pending_review` (Revisión) o desde
 * `active` (Activos/takedown): la EF y el hook no distinguen origen.
 */
function RejectionReasonModal({
  title,
  subtitle,
  confirm_label,
  reject,
  is_moderating,
  error,
  on_close,
}: {
  title: string;
  subtitle: string;
  confirm_label: string;
  reject: (reason: string) => Promise<ModerateResult>;
  is_moderating: boolean;
  error: string | null;
  on_close: () => void;
}): React.ReactElement {
  const [reason, set_reason] = useState('');
  const can_confirm = reason.trim().length > 0 && !is_moderating;

  const handle_confirm = useCallback(async () => {
    const res = await reject(reason);
    if (res.ok) on_close();
  }, [reason, reject, on_close]);

  return (
    <Modal visible animationType="fade" transparent onRequestClose={on_close}>
      <View style={styles.modal_backdrop}>
        <View style={styles.modal_card}>
          <Text style={styles.sheet_title}>{title}</Text>
          <Text style={styles.placeholder_text}>{subtitle}</Text>
          <TextInput
            style={styles.reason_input}
            value={reason}
            onChangeText={set_reason}
            placeholder="Motivo obligatorio. El anunciante lo verá."
            placeholderTextColor="#9CA3AF"
            multiline
            editable={!is_moderating}
            testID="rejection-reason-modal-input"
          />

          {error !== null && (
            <Text style={styles.error_text} testID="rejection-reason-modal-error">
              {error}
            </Text>
          )}

          <View style={styles.actions}>
            <Pressable
              style={styles.secondary_button}
              onPress={on_close}
              disabled={is_moderating}
              accessibilityRole="button"
              accessibilityLabel="Cancelar"
              testID="rejection-reason-modal-cancel"
            >
              <Text style={styles.secondary_text}>Cancelar</Text>
            </Pressable>
            <Pressable
              style={[styles.reject_button, !can_confirm && styles.button_disabled]}
              disabled={!can_confirm}
              onPress={() => void handle_confirm()}
              accessibilityRole="button"
              accessibilityLabel={confirm_label}
              testID="rejection-reason-modal-confirm"
            >
              <Text style={styles.reject_text}>{confirm_label}</Text>
            </Pressable>
          </View>

          {is_moderating && (
            <ActivityIndicator
              testID="rejection-reason-modal-spinner"
              color="#5A8A5E"
              style={styles.moderating_spinner}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Segmento "Revisión" — cola de moderación (208.3, sin cambios de fondo)
// ---------------------------------------------------------------------------

function PendingAdCard({
  item,
  on_press,
}: {
  item: PendingAd;
  on_press: (ad: PendingAd) => void;
}): React.ReactElement {
  const waiting = days_waiting(item.created_at);
  // 213: una promo NO tiene creative propio — `title` es la dirección de la
  // propiedad (ads.title = properties.address, ajuste de contrato 213.2).
  // Prefijo "Promoción · " para que el admin distinga el origen sin abrir la
  // tarjeta.
  const display_title = item.property_id ? `Promoción · ${item.title}` : item.title;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.card_pressed]}
      onPress={() => on_press(item)}
      accessibilityRole="button"
      accessibilityLabel={`Revisar el anuncio ${display_title}`}
      testID={`pending-ad-${item.id}`}
    >
      <View style={styles.card_header}>
        <Text style={styles.card_title} numberOfLines={1}>
          {display_title}
        </Text>
        {waiting > 0 && (
          <View style={styles.waiting_badge}>
            <Text style={styles.waiting_text}>
              {waiting === 1 ? '1 día' : `${waiting} días`}
            </Text>
          </View>
        )}
      </View>
      <Text style={styles.card_agency} numberOfLines={1}>
        {item.agencies?.name ?? 'Organización desconocida'}
      </Text>
      <Text style={styles.card_dates}>
        {format_date(item.starts_at)} — {format_date(item.ends_at)}
      </Text>
    </Pressable>
  );
}

function ModerationSheet({
  ad,
  on_close,
  on_moderated,
}: {
  ad: PendingAd;
  on_close: () => void;
  on_moderated: () => void;
}): React.ReactElement {
  const [reason, set_reason] = useState('');
  const [video_url, set_video_url] = useState<string | null>(null);
  const [poster_url, set_poster_url] = useState<string | null>(null);
  const [is_minting, set_is_minting] = useState(false);
  const [mint_failed, set_mint_failed] = useState(false);

  const { approve, reject, is_moderating, error } = useModerateAd({
    onSuccess: on_moderated,
  });

  // El reproductor arranca en PAUSA y sin loop: verlo es dinero (minutos de
  // Cloudflare Stream), así que lo dispara el admin, no la pantalla.
  const player = useVideoPlayer(video_url, (p) => {
    p.loop = false;
  });

  // 213: una promo (ad.property_id no nulo) mintea su video con
  // mint-video-url por property_id — NUNCA mint_one(null), ad.creative_id es
  // null en una promo (CHECK ads_exactly_one_source).
  const load_video = useCallback(async () => {
    set_is_minting(true);
    set_mint_failed(false);
    const minted = ad.property_id
      ? await mint_one_promo(ad.property_id)
      : ad.creative_id
        ? await mint_one(ad.creative_id)
        : null;
    set_is_minting(false);
    if (!minted) {
      set_mint_failed(true);
      return;
    }
    set_video_url(minted.videoUrl);
    set_poster_url(minted.posterUrl);
  }, [ad.creative_id, ad.property_id]);

  const can_reject = reason.trim().length > 0 && !is_moderating;

  return (
    <Modal visible animationType="slide" onRequestClose={on_close} transparent={false}>
      <SafeAreaView style={styles.container}>
        <View style={styles.sheet_header}>
          <Pressable
            onPress={on_close}
            accessibilityRole="button"
            accessibilityLabel="Cerrar"
            testID="close-moderation"
          >
            <Text style={styles.close_text}>Cerrar</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.sheet_body}>
          <Text style={styles.sheet_title}>{ad.property_id ? `Promoción · ${ad.title}` : ad.title}</Text>
          <Text style={styles.card_agency}>{ad.agencies?.name ?? 'Organización desconocida'}</Text>

          {ad.description !== null && ad.description.length > 0 && (
            <Text style={styles.sheet_description}>{ad.description}</Text>
          )}

          <View style={styles.meta_row}>
            <Text style={styles.meta_label}>Vigencia</Text>
            <Text style={styles.meta_value}>
              {format_date(ad.starts_at)} — {format_date(ad.ends_at)}
            </Text>
          </View>
          <View style={styles.meta_row}>
            <Text style={styles.meta_label}>Destino</Text>
            <Text style={styles.meta_value} numberOfLines={1}>
              {/* 213: una promo no tiene CTA propio — tocarla lleva al
                  detalle de la propiedad, no a un destino externo. */}
              {ad.property_id ? 'Detalle de la publicación' : `${ad.cta_type}: ${ad.cta_value}`}
            </Text>
          </View>

          {/* ── Creativo ── */}
          {video_url === null ? (
            <View style={styles.video_placeholder}>
              {is_minting ? (
                <ActivityIndicator testID="minting-indicator" color="#5A8A5E" />
              ) : (
                <>
                  <Text style={styles.placeholder_text}>
                    {mint_failed
                      ? 'No se pudo cargar el video del anuncio.'
                      : 'Revisa el creativo antes de decidir.'}
                  </Text>
                  <Pressable
                    style={[styles.secondary_button, styles.secondary_button_standalone]}
                    onPress={() => void load_video()}
                    accessibilityRole="button"
                    accessibilityLabel="Cargar el video del anuncio"
                    testID="load-video"
                  >
                    <Text style={styles.secondary_text}>
                      {mint_failed ? 'Reintentar' : 'Ver el video'}
                    </Text>
                  </Pressable>
                </>
              )}
            </View>
          ) : (
            <VideoView
              player={player}
              style={styles.video}
              contentFit="contain"
              nativeControls
              testID="ad-video"
            />
          )}

          {/* ── Decisión ── */}
          <Text style={styles.section_label}>Motivo del rechazo</Text>
          <TextInput
            style={styles.reason_input}
            value={reason}
            onChangeText={set_reason}
            placeholder="Obligatorio para rechazar. El anunciante lo verá."
            placeholderTextColor="#9CA3AF"
            multiline
            editable={!is_moderating}
            testID="rejection-reason"
          />

          {error !== null && (
            <Text style={styles.error_text} testID="moderation-error">
              {error}
            </Text>
          )}

          <View style={styles.actions}>
            <Pressable
              style={[styles.reject_button, !can_reject && styles.button_disabled]}
              disabled={!can_reject}
              onPress={() => void reject(ad.id, reason)}
              accessibilityRole="button"
              accessibilityLabel="Rechazar el anuncio"
              testID="reject-ad"
            >
              <Text style={styles.reject_text}>Rechazar</Text>
            </Pressable>

            <Pressable
              style={[styles.approve_button, is_moderating && styles.button_disabled]}
              disabled={is_moderating}
              onPress={() => void approve(ad.id)}
              accessibilityRole="button"
              accessibilityLabel="Aprobar el anuncio"
              testID="approve-ad"
            >
              <Text style={styles.approve_text}>Aprobar</Text>
            </Pressable>
          </View>

          {is_moderating && (
            <ActivityIndicator
              testID="moderating-indicator"
              color="#5A8A5E"
              style={styles.moderating_spinner}
            />
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function PendingQueueSection(): React.ReactElement {
  const { ads, loading, error, refetch } = usePendingAds();
  const [selected, set_selected] = useState<PendingAd | null>(null);

  const handle_moderated = useCallback(() => {
    set_selected(null);
    void refetch();
  }, [refetch]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Anuncios por revisar</Text>
        {!loading && ads.length > 0 && (
          <Text style={styles.subtitle}>
            {ads.length === 1 ? '1 pendiente' : `${ads.length} pendientes`}
          </Text>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator testID="loading-indicator" size="large" color="#5A8A5E" />
        </View>
      ) : error !== null ? (
        <View style={styles.center}>
          <Text style={styles.error_text} testID="error-message">
            {error}
          </Text>
          <Pressable
            style={[styles.secondary_button, styles.secondary_button_standalone]}
            onPress={() => void refetch()}
            accessibilityRole="button"
            accessibilityLabel="Reintentar carga"
          >
            <Text style={styles.secondary_text}>Reintentar</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={ads}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <PendingAdCard item={item} on_press={set_selected} />}
          contentContainerStyle={
            ads.length === 0 ? styles.list_empty_container : styles.list_content
          }
          ListEmptyComponent={
            <View style={styles.empty_state} testID="empty-state">
              <Text style={styles.empty_text}>No hay anuncios esperando revisión.</Text>
            </View>
          }
          testID="pending-ads-list"
        />
      )}

      {selected !== null && (
        <ModerationSheet
          ad={selected}
          on_close={() => set_selected(null)}
          on_moderated={handle_moderated}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Segmento "Activos" — takedown de emergencia (210.3)
// ---------------------------------------------------------------------------

function ActiveAdCard({
  item,
  disabled,
  on_pause,
  on_resume,
  on_take_down,
}: {
  item: ActiveAd;
  disabled: boolean;
  on_pause: (ad: ActiveAd) => void;
  on_resume: (ad: ActiveAd) => void;
  on_take_down: (ad: ActiveAd) => void;
}): React.ReactElement {
  // `paused_at !== null ⟺ status === 'paused'` es una garantía del trigger de
  // la base (20260816000006), no una convención del cliente — ver docblock
  // de useActiveAds.
  const is_paused = item.paused_at !== null;
  // 213: misma convención que PendingAdCard — una promo no tiene creative
  // propio, `title` es la dirección de la propiedad.
  const display_title = item.property_id ? `Promoción · ${item.title}` : item.title;

  return (
    <View style={styles.card} testID={`active-ad-${item.id}`}>
      <View style={styles.card_header}>
        <Text style={styles.card_title} numberOfLines={1}>
          {display_title}
        </Text>
        {is_paused && (
          <View style={styles.paused_badge} testID={`paused-badge-${item.id}`}>
            <Text style={styles.paused_badge_text}>Pausado</Text>
          </View>
        )}
      </View>
      <Text style={styles.card_agency} numberOfLines={1}>
        {item.agencies?.name ?? 'Organización desconocida'}
      </Text>
      {item.description !== null && item.description.length > 0 && (
        <Text style={styles.card_description} numberOfLines={2}>
          {item.description}
        </Text>
      )}
      <Text style={styles.card_dates}>
        {format_date(item.starts_at)} — {format_date(item.ends_at)}
      </Text>

      {is_paused ? (
        // paused->rejected NO existe en la matriz de transiciones de la base
        // (20260816000006): un pausado solo puede reanudarse, nunca "bajarse"
        // directo — ofrecerlo terminaría en 409 INVALID_AD_STATUS_TRANSITION.
        <View style={styles.actions}>
          <Pressable
            style={[
              styles.approve_button,
              (disabled || item.paused_by_suspension) && styles.button_disabled,
            ]}
            disabled={disabled || item.paused_by_suspension}
            onPress={() => on_resume(item)}
            accessibilityRole="button"
            accessibilityLabel={`Reanudar ${item.title}`}
            testID={`resume-ad-${item.id}`}
          >
            <Text style={styles.approve_text}>Reanudar</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.actions}>
          <Pressable
            style={[styles.secondary_button, styles.actions_flex, disabled && styles.button_disabled]}
            disabled={disabled}
            onPress={() => on_pause(item)}
            accessibilityRole="button"
            accessibilityLabel={`Pausar ${item.title}`}
            testID={`pause-ad-${item.id}`}
          >
            <Text style={styles.secondary_text}>Pausar</Text>
          </Pressable>
          <Pressable
            style={[styles.reject_button, disabled && styles.button_disabled]}
            disabled={disabled}
            onPress={() => on_take_down(item)}
            accessibilityRole="button"
            accessibilityLabel={`Bajar ${item.title}`}
            testID={`takedown-ad-${item.id}`}
          >
            <Text style={styles.reject_text}>Bajar</Text>
          </Pressable>
        </View>
      )}

      {is_paused && item.paused_by_suspension && (
        // El botón ya queda deshabilitado arriba; este texto explica POR QUÉ
        // (mismo mensaje que traduciría el 409 AD_PAUSED_BY_SUSPENSION si el
        // botón no estuviera deshabilitado — una sola fuente de verdad).
        <Text style={styles.paused_hint_text} testID={`paused-by-suspension-hint-${item.id}`}>
          {map_ad_moderation_error('AD_PAUSED_BY_SUSPENSION')}
        </Text>
      )}
    </View>
  );
}

function ActiveAdsSection(): React.ReactElement {
  const { ads, loading, error, refetch } = useActiveAds();
  // onSuccess ya encadena refetch para pause/resume/reject: tras cualquier
  // acción exitosa la lista se vuelve a consultar y el anuncio aparece con su
  // estado REAL (paused_at/status) — ya no hace falta estado local paralelo.
  const { pause, reject, resume, is_moderating, error: moderate_error } = useModerateAd({
    onSuccess: refetch,
  });
  const [take_down_target, set_take_down_target] = useState<ActiveAd | null>(null);

  const handle_pause = useCallback(
    (ad: ActiveAd) => {
      Alert.alert(
        'Pausar anuncio',
        `Se pausará "${ad.title}". Mientras esté pausado no se muestra y su reloj de vigencia se congela — puedes reanudarlo cuando quieras.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Pausar', style: 'destructive', onPress: () => void pause(ad.id) },
        ],
      );
    },
    [pause],
  );

  const handle_resume = useCallback((ad: ActiveAd) => void resume(ad.id), [resume]);

  const handle_take_down_reject = useCallback(
    (reason: string): Promise<ModerateResult> => {
      if (take_down_target === null) return Promise.resolve({ ok: false, error: null });
      return reject(take_down_target.id, reason);
    },
    [reject, take_down_target],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Anuncios activos</Text>
        {!loading && ads.length > 0 && (
          <Text style={styles.subtitle}>{ads.length === 1 ? '1 anuncio' : `${ads.length} anuncios`}</Text>
        )}
      </View>

      {moderate_error !== null && (
        <Text style={styles.error_text} testID="active-moderate-error">
          {moderate_error}
        </Text>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator testID="active-loading-indicator" size="large" color="#5A8A5E" />
        </View>
      ) : error !== null ? (
        <View style={styles.center}>
          <Text style={styles.error_text} testID="active-error-message">
            {error}
          </Text>
          <Pressable
            style={[styles.secondary_button, styles.secondary_button_standalone]}
            onPress={() => void refetch()}
            accessibilityRole="button"
            accessibilityLabel="Reintentar carga"
          >
            <Text style={styles.secondary_text}>Reintentar</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={ads}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ActiveAdCard
              item={item}
              disabled={is_moderating}
              on_pause={handle_pause}
              on_resume={handle_resume}
              on_take_down={set_take_down_target}
            />
          )}
          contentContainerStyle={
            ads.length === 0 ? styles.list_empty_container : styles.list_content
          }
          ListEmptyComponent={
            <View style={styles.empty_state} testID="active-empty-state">
              <Text style={styles.empty_text}>No hay anuncios activos ni pausados en este momento.</Text>
            </View>
          }
          testID="active-ads-list"
        />
      )}

      {take_down_target !== null && (
        <RejectionReasonModal
          title={`Bajar "${take_down_target.title}"`}
          subtitle="Este anuncio dejará de mostrarse de inmediato."
          confirm_label="Bajar anuncio"
          reject={handle_take_down_reject}
          is_moderating={is_moderating}
          error={moderate_error}
          on_close={() => set_take_down_target(null)}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pantalla — segmentos "Revisión" / "Activos"
// ---------------------------------------------------------------------------

type Segment = 'review' | 'active';

export default function AdminAdsQueueScreen(): React.ReactElement {
  const [segment, set_segment] = useState<Segment>('review');

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, styles.header_row]}>
        <BackButton />
        <Text style={styles.title}>Anuncios</Text>
      </View>
      <View style={styles.segment_row}>
        <Pressable
          style={[styles.segment_button, segment === 'review' && styles.segment_button_active]}
          onPress={() => set_segment('review')}
          accessibilityRole="button"
          accessibilityLabel="Ver la cola de revisión"
          testID="segment-review"
        >
          <Text style={[styles.segment_text, segment === 'review' && styles.segment_text_active]}>
            Revisión
          </Text>
        </Pressable>
        <Pressable
          style={[styles.segment_button, segment === 'active' && styles.segment_button_active]}
          onPress={() => set_segment('active')}
          accessibilityRole="button"
          accessibilityLabel="Ver los anuncios activos"
          testID="segment-active"
        >
          <Text style={[styles.segment_text, segment === 'active' && styles.segment_text_active]}>
            Activos
          </Text>
        </Pressable>
      </View>

      {segment === 'review' ? <PendingQueueSection /> : <ActiveAdsSection />}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Estilos — calcados de mobile/app/admin/index.tsx
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  // #241.3: back visible — antes solo se salía con el gesto/hardware back.
  header_row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 28, fontWeight: '700', color: '#17140F' },
  subtitle: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },

  segment_row: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 12,
    backgroundColor: '#F2EEE6',
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  segment_button: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  segment_button_active: { backgroundColor: '#FFFFFF' },
  segment_text: { fontSize: 14, fontWeight: '600', color: '#6B7280' },
  segment_text_active: { color: '#17140F' },

  list_content: { paddingHorizontal: 20, paddingBottom: 32 },
  list_empty_container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  empty_state: { alignItems: 'center', paddingHorizontal: 32 },
  empty_text: { fontSize: 15, color: '#6B7280', textAlign: 'center' },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E7E2D8',
    padding: 16,
    marginBottom: 12,
  },
  card_pressed: { opacity: 0.7 },
  card_header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  card_title: { flex: 1, fontSize: 16, fontWeight: '600', color: '#17140F' },
  card_agency: { fontSize: 14, color: '#9A7150', marginTop: 4 },
  card_description: { fontSize: 13, color: '#3F3A33', marginTop: 6, lineHeight: 18 },
  card_dates: { fontSize: 13, color: '#6B7280', marginTop: 6 },
  waiting_badge: {
    backgroundColor: '#E5A02022',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginLeft: 8,
  },
  waiting_text: { fontSize: 12, fontWeight: '600', color: '#E5A020' },
  paused_badge: {
    backgroundColor: '#6B728022',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginLeft: 8,
  },
  paused_badge_text: { fontSize: 12, fontWeight: '600', color: '#6B7280' },
  paused_hint_text: { fontSize: 12, color: '#6B7280', marginTop: 8 },

  sheet_header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4, alignItems: 'flex-end' },
  close_text: { fontSize: 16, color: '#5A8A5E', fontWeight: '600' },
  sheet_body: { paddingHorizontal: 20, paddingBottom: 40 },
  sheet_title: { fontSize: 22, fontWeight: '700', color: '#17140F' },
  sheet_description: { fontSize: 15, color: '#3F3A33', marginTop: 12, lineHeight: 22 },

  meta_row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  meta_label: { fontSize: 13, color: '#6B7280' },
  meta_value: { flex: 1, fontSize: 13, color: '#17140F', textAlign: 'right', marginLeft: 12 },

  video_placeholder: {
    marginTop: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E7E2D8',
    backgroundColor: '#F2EEE6',
    paddingVertical: 32,
    alignItems: 'center',
  },
  placeholder_text: { fontSize: 14, color: '#6B7280', marginBottom: 12, textAlign: 'center' },
  video: { marginTop: 20, width: '100%', aspectRatio: 9 / 16, borderRadius: 12, backgroundColor: '#17140F' },

  section_label: { fontSize: 13, fontWeight: '600', color: '#6B7280', marginTop: 24, marginBottom: 8 },
  reason_input: {
    borderWidth: 1,
    borderColor: '#E7E2D8',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    padding: 12,
    minHeight: 88,
    fontSize: 15,
    color: '#17140F',
    textAlignVertical: 'top',
  },

  error_text: { fontSize: 14, color: '#D94A4A', marginTop: 12, textAlign: 'center' },

  actions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  actions_flex: { flex: 1 },
  reject_button: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D94A4A',
    paddingVertical: 14,
    alignItems: 'center',
  },
  reject_text: { fontSize: 16, fontWeight: '600', color: '#D94A4A' },
  approve_button: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#5A8A5E',
    paddingVertical: 14,
    alignItems: 'center',
  },
  approve_text: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  button_disabled: { opacity: 0.4 },
  moderating_spinner: { marginTop: 16 },

  secondary_button: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#5A8A5E',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  // Solo para usos AUTÓNOMOS (retry tras error, cargar video) — no dentro de
  // un `actions` row, donde ya hay marginTop:24 y desalinearía contra el
  // botón vecino (reject_button/approve_button no llevan marginTop propio).
  secondary_button_standalone: { marginTop: 12 },
  secondary_text: { fontSize: 15, fontWeight: '600', color: '#5A8A5E' },

  modal_backdrop: {
    flex: 1,
    backgroundColor: '#00000066',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modal_card: {
    width: '100%',
    backgroundColor: '#FAFAF8',
    borderRadius: 16,
    padding: 20,
  },
});
