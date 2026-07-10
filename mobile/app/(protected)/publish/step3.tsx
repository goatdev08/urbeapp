/**
 * /publish/step3 — Paso 3 del wizard de publicación.
 * Selección, preview y upload del video de la propiedad.
 *
 * Subtarea 8.8 — Build Step 3 with video selection, preview and upload UI.
 *
 * Flujo:
 *   1. Usuario toca "Seleccionar video" → expo-image-picker abre galería.
 *   2. Al elegir: preview con expo-video + upload automático (useVideoUpload).
 *   3. Mientras sube: barra de progreso + estado 'Subiendo…'.
 *   4. En éxito: 'Listo' + botón "Publicar" habilitado (placeholder para esta demo).
 *   5. En error: mensaje de error + botón para reintentar.
 *
 * ponytail: UI state local (set_ui_status) para renderizar progreso — el hook
 *   usa refs (sin useState) para compatibilidad con el sync act() de EC-12.
 *   El re-render del screen lo dispara el estado local, no el hook.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useRouter } from 'expo-router';


import { usePublishForm } from '@/features/publish/store/PublishFormContext';
import { useVideoUpload, type UploadStatus } from '@/features/publish/hooks/useVideoUpload';
import { usePublish } from '@/features/publish/hooks/usePublish';
import { generate_and_store_thumbnail } from '@/features/publish/lib/videoThumbnail';
import { PrimaryButton } from '@/components/PrimaryButton';

// ---------------------------------------------------------------------------
// Tokens (alineados con step1/step2)
// ---------------------------------------------------------------------------

const COLOR_BG = '#FAFAF8';
const COLOR_TEXT_PRIMARY = '#1A1A1A';
const COLOR_TEXT_SECONDARY = '#6B7280';
const COLOR_BORDER = '#E5E7EB';
const COLOR_ACCENT = '#1A5E44'; // SALVIA
const COLOR_ERROR = '#DC2626';
const COLOR_SUCCESS = '#16A34A';
const COLOR_PICKER_BG = '#F3F4F6';

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function Step3Screen() {
  const router = useRouter();

  const { state, update } = usePublishForm();
  // Edit mode se resuelve del CONTEXTO (propagado una vez en _layout), NO de la
  // URL: sobrevive a la navegación step1→step2→step3, así que step3 ya no cae en
  // create mode por pérdida del param → fin de la duplicación (#53).
  const is_edit_mode = state.edit_mode;
  const property_id = state.property_id;
  const hook = useVideoUpload();
  // Edit mode: UPDATE directo sin EF; create mode: invoca EF (sin cambios).
  const publish_hook = usePublish({
    editMode: is_edit_mode,
    propertyId: property_id,
  });

  // ── Local state para reactivity en la UI ──────────────────────────────────
  // useVideoUpload usa refs (sin useState) → el screen gestiona sus propios
  // estados de UI que reflejan el resultado del upload.
  const [local_uri, set_local_uri] = useState<string | null>(null);
  const [ui_status, set_ui_status] = useState<UploadStatus>('idle');
  const [ui_error, set_ui_error] = useState<string | null>(null);
  // Estados de publicación (usePublish también usa refs — espejamos aquí para reactivity).
  const [publish_status, set_publish_status] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [publish_error, set_publish_error] = useState<string | null>(null);

  // ── Video player (expo-video) ──────────────────────────────────────────────
  // ponytail: nativeControls=true → expo-video maneja play/pause, sin boilerplate.
  const video_player = useVideoPlayer(local_uri, (player) => {
    player.loop = true;
  });

  // Auto-play cuando cambia la URI (setup solo corre al montar).
  useEffect(() => {
    if (local_uri) {
      video_player.play();
    }
  }, [local_uri, video_player]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handle_pick_video = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      quality: 1,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets?.length) return;

    const uri = result.assets?.[0]?.uri;
    if (!uri) return;

    // Guardar URI en el form (para persistencia entre pasos) y en estado local.
    update({ video_local_uri: uri });
    set_local_uri(uri);
    set_ui_status('uploading');
    set_ui_error(null);

    // Iniciar upload — la función es async y modifica refs internamente.
    await hook.upload(uri);

    // Leer del hook (refs, siempre actualizados tras el await).
    const final_status = hook.status;
    const final_error = hook.error;

    set_ui_status(final_status);
    set_ui_error(final_error);
  }, [update, hook]);

  const handle_retry = useCallback(async () => {
    if (!local_uri) return;
    set_ui_status('uploading');
    set_ui_error(null);
    await hook.upload(local_uri);
    set_ui_status(hook.status);
    set_ui_error(hook.error);
  }, [local_uri, hook]);

  const handle_publish = useCallback(async () => {
    // 8.10: submit a publish-property
    // Captura video_id/URI/duración ANTES de publicar: en create mode el éxito
    // dispara reset() y limpia el form → se perderían para la portada.
    const cap_video_id = state.video_id;
    const cap_local_uri = state.video_local_uri;
    const cap_duration = video_player.duration ?? null;

    set_publish_status('submitting');
    set_publish_error(null);

    await publish_hook.publish();

    const final_status = publish_hook.status;
    const final_error = publish_hook.error;

    set_publish_status(final_status);
    set_publish_error(final_error);

    if (final_status === 'success') {
      // Portada (P7): frame medio → bucket público → property_videos.thumbnail_url.
      // Solo create mode con video nuevo; fire-and-forget fail-soft (no bloquea).
      if (!is_edit_mode && cap_video_id && cap_local_uri) {
        void generate_and_store_thumbnail(cap_video_id, cap_local_uri, cap_duration);
      }
      Alert.alert('¡Publicada!', 'Tu propiedad ya está disponible en el feed.', [
        {
          text: 'Aceptar',
          // Navega a la home del feed (app/(protected)/index.tsx).
          onPress: () => router.replace('/'),
        },
      ]);
    }
  }, [publish_hook, router, state.video_id, state.video_local_uri, video_player, is_edit_mode]);

  // ── Derivados de estado ────────────────────────────────────────────────────

  const is_uploading = ui_status === 'uploading';
  const is_success = ui_status === 'success';
  const is_error = ui_status === 'error';
  const has_video = local_uri !== null;
  const is_publishing = publish_status === 'submitting';
  const is_publish_error = publish_status === 'error';

  // ponytail: en edit mode sin video nuevo → se conserva el existente, no se requiere re-subir.
  const can_publish_without_new_video = is_edit_mode && !has_video;

  return (
    <SafeAreaView style={styles.container}>
      {/* ── Encabezado ───────────────────────────────────────────────── */}
      <View style={styles.header}>
        <Text style={styles.page_title}>Video de la propiedad</Text>
        <Text style={styles.page_subtitle}>
          {is_edit_mode
            ? 'El video no se puede cambiar en modo edición.'
            : 'Sube un video vertical para mostrar la propiedad.'}
        </Text>
      </View>

      {/* ── Área de preview / picker ──────────────────────────────────── */}
      <View style={styles.video_area}>
        {has_video ? (
          <VideoView
            player={video_player}
            style={styles.video_view}
            nativeControls
            contentFit="contain"
          />
        ) : is_edit_mode ? (
          // Edit mode v1: el video no es reemplazable. Placeholder informativo
          // (sin picker) para no generar uploads huérfanos en Storage.
          <View style={styles.picker_placeholder}>
            <Text style={styles.picker_icon}>▶</Text>
            <Text style={styles.picker_text}>Video actual</Text>
            <Text style={styles.picker_hint}>
              El video no se puede cambiar en modo edición
            </Text>
          </View>
        ) : (
          // Área tocable para abrir el picker
          <TouchableOpacity
            style={styles.picker_placeholder}
            onPress={handle_pick_video}
            activeOpacity={0.7}
            accessibilityLabel="Seleccionar video de la galería"
          >
            <Text style={styles.picker_icon}>▶</Text>
            <Text style={styles.picker_text}>Seleccionar video</Text>
            <Text style={styles.picker_hint}>
              Toca para abrir la galería
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Botón de cambiar video (solo create mode; en edit no es reemplazable) ─ */}
      {has_video && !is_edit_mode && (
        <TouchableOpacity
          style={styles.change_video_btn}
          onPress={handle_pick_video}
          disabled={is_uploading}
          accessibilityLabel="Cambiar video"
        >
          <Text style={styles.change_video_text}>Cambiar video</Text>
        </TouchableOpacity>
      )}

      {/* ── Estado del upload ─────────────────────────────────────────── */}
      <View style={styles.status_area}>
        {is_uploading && (
          <View style={styles.status_row}>
            <ActivityIndicator size="small" color={COLOR_ACCENT} />
            <Text style={styles.status_text}>Subiendo video…</Text>
          </View>
        )}
        {is_success && (
          <View style={styles.status_row}>
            <Text style={styles.success_icon}>✓</Text>
            <Text style={[styles.status_text, styles.success_text]}>
              Video subido correctamente
            </Text>
          </View>
        )}
        {is_error && (
          <View style={styles.error_container}>
            <Text style={styles.error_text}>
              {ui_error ?? 'Error al subir el video'}
            </Text>
            <TouchableOpacity
              onPress={handle_retry}
              style={styles.retry_btn}
              accessibilityLabel="Reintentar subida del video"
            >
              <Text style={styles.retry_text}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ── CTA (fijo al fondo) ───────────────────────────────────────── */}
      <View style={styles.cta_area}>
        {is_publish_error && (
          <Text style={styles.error_text}>
            {publish_error ?? 'Error al publicar. Intenta de nuevo.'}
          </Text>
        )}
        <PrimaryButton
          label={is_publishing
            ? (is_edit_mode ? 'Guardando…' : 'Publicando…')
            : (is_edit_mode ? 'Guardar cambios' : 'Publicar')}
          onPress={handle_publish}
          surface="light"
          disabled={(!is_success && !can_publish_without_new_video) || is_publishing}
        />
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLOR_BG,
  },

  // ── Encabezado ────────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  page_title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLOR_TEXT_PRIMARY,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  page_subtitle: {
    fontSize: 14,
    color: COLOR_TEXT_SECONDARY,
    lineHeight: 20,
  },

  // ── Video / picker ────────────────────────────────────────────────────────
  video_area: {
    marginHorizontal: 20,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
    aspectRatio: 9 / 16,
    maxHeight: 360,
  },
  video_view: {
    flex: 1,
  },
  picker_placeholder: {
    flex: 1,
    backgroundColor: COLOR_PICKER_BG,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  picker_icon: {
    fontSize: 36,
    color: COLOR_TEXT_SECONDARY,
  },
  picker_text: {
    fontSize: 16,
    fontWeight: '600',
    color: COLOR_TEXT_PRIMARY,
  },
  picker_hint: {
    fontSize: 12,
    color: COLOR_TEXT_SECONDARY,
  },

  // ── Cambiar video ─────────────────────────────────────────────────────────
  change_video_btn: {
    alignSelf: 'center',
    marginTop: 10,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  change_video_text: {
    fontSize: 13,
    color: COLOR_ACCENT,
    fontWeight: '600',
  },

  // ── Status del upload ──────────────────────────────────────────────────────
  status_area: {
    paddingHorizontal: 20,
    marginTop: 16,
    minHeight: 36,
  },
  status_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  status_text: {
    fontSize: 14,
    color: COLOR_TEXT_SECONDARY,
  },
  success_icon: {
    fontSize: 16,
    color: COLOR_SUCCESS,
    fontWeight: '700',
  },
  success_text: {
    color: COLOR_SUCCESS,
    fontWeight: '600',
  },
  error_container: {
    gap: 8,
  },
  error_text: {
    fontSize: 13,
    color: COLOR_ERROR,
    lineHeight: 18,
  },
  retry_btn: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  retry_text: {
    fontSize: 13,
    color: COLOR_ACCENT,
    fontWeight: '600',
  },

  // ── CTA ──────────────────────────────────────────────────────────────────
  cta_area: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: COLOR_BG,
    borderTopWidth: 1,
    borderTopColor: COLOR_BORDER,
  },
});
