/**
 * /admin/ads — cola de moderación de anuncios (tarea #208, subtarea 208.3).
 *
 * Estética utilitaria/clara, misma que /admin (NO el feed oscuro). El techo de
 * alcance es lo que ya existe en el panel de administración: la identidad
 * visual no trae mockup de esta pantalla, así que se calca el lenguaje de
 * mobile/app/admin/index.tsx en vez de inventar UI.
 *
 * Datos: usePendingAds (208.2) — filtra `status='pending_review'` en el
 * cliente, porque la policy ads_select incluye `private.is_admin()` y sin el
 * filtro llegaría el inventario completo de la plataforma.
 * Acción: useModerateAd (208.2) — traduce los 9 códigos de la EF a español.
 *
 * 🔴 CUOTA DE CLOUDFLARE STREAM. El video NO se firma al abrir la lista ni se
 * reproduce solo: se pide la URL a mint-ad-urls SOLO cuando el admin abre un
 * anuncio, y el reproductor arranca en pausa mostrando la portada. Cada
 * reproducción son minutos facturados ([[video_playback_burns_quota]]).
 *
 * 🔴 RECHAZAR EXIGE MOTIVO. Lo impone el CHECK bidireccional
 * ads_rejection_reason_matches_status en la base y lo duplica useModerateAd en
 * el cliente; aquí el botón simplemente queda deshabilitado sin texto, para que
 * el admin lo vea antes de intentarlo.
 */
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { supabase } from '@/lib/supabase/client';
import { usePendingAds, type PendingAd } from '@/features/ads/hooks/usePendingAds';
import { useModerateAd } from '@/features/ads/hooks/useModerateAd';

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

// ---------------------------------------------------------------------------
// Tarjeta de la cola
// ---------------------------------------------------------------------------

function PendingAdCard({
  item,
  on_press,
}: {
  item: PendingAd;
  on_press: (ad: PendingAd) => void;
}): React.ReactElement {
  const waiting = days_waiting(item.created_at);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.card_pressed]}
      onPress={() => on_press(item)}
      accessibilityRole="button"
      accessibilityLabel={`Revisar el anuncio ${item.title}`}
      testID={`pending-ad-${item.id}`}
    >
      <View style={styles.card_header}>
        <Text style={styles.card_title} numberOfLines={1}>
          {item.title}
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

// ---------------------------------------------------------------------------
// Detalle + decisión
// ---------------------------------------------------------------------------

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

  const load_video = useCallback(async () => {
    set_is_minting(true);
    set_mint_failed(false);
    const minted = await mint_one(ad.creative_id);
    set_is_minting(false);
    if (!minted) {
      set_mint_failed(true);
      return;
    }
    set_video_url(minted.videoUrl);
    set_poster_url(minted.posterUrl);
  }, [ad.creative_id]);

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
          <Text style={styles.sheet_title}>{ad.title}</Text>
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
              {ad.cta_type}: {ad.cta_value}
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
                    style={styles.secondary_button}
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

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

export default function AdminAdsQueueScreen(): React.ReactElement {
  const { ads, loading, error, refetch } = usePendingAds();
  const [selected, set_selected] = useState<PendingAd | null>(null);

  const handle_moderated = useCallback(() => {
    set_selected(null);
    void refetch();
  }, [refetch]);

  return (
    <SafeAreaView style={styles.container}>
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
            style={styles.secondary_button}
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
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Estilos — calcados de mobile/app/admin/index.tsx
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FAFAF8' },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  title: { fontSize: 28, fontWeight: '700', color: '#17140F' },
  subtitle: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },

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
  card_dates: { fontSize: 13, color: '#6B7280', marginTop: 6 },
  waiting_badge: {
    backgroundColor: '#E5A02022',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginLeft: 8,
  },
  waiting_text: { fontSize: 12, fontWeight: '600', color: '#E5A020' },

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
    marginTop: 12,
  },
  secondary_text: { fontSize: 15, fontWeight: '600', color: '#5A8A5E' },
});
