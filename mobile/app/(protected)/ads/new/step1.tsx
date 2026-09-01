/**
 * /ads/new/step1 — Paso 1 del wizard de anuncios: creativo (video).
 * Subtarea 169.9.
 *
 * REUSO: useAdUpload (169.7) hace mint→binario→poll hasta 'ready'|'failed' —
 * este screen solo refleja su estado (mismo patrón que
 * app/(protected)/publish/step5.tsx: el hook usa refs, así que el screen
 * mantiene su propio estado local de UI vía on_status_change/on_progress).
 *
 * validate_ad_duration_ms (169.6) ya corre DENTRO de useAdUpload.upload()
 * antes de tocar la red — este screen no la reimplementa, solo muestra el
 * mensaje que el hook produce en `error`.
 */
import React, { useCallback, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Play } from 'phosphor-react-native';

import { useAdForm } from '@/features/ads/store/AdFormContext';
import { useAdUpload, type AdUploadStatus } from '@/features/ads/hooks/useAdUpload';
import { UploadProgressBar } from '@/features/publish/components/UploadProgressBar';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radii, spacing, type_scale } from '@/theme/theme';

export default function AdStep1Screen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state, update } = useAdForm();

  const [local_uri, set_local_uri] = useState<string | null>(state.video_local_uri);
  const [ui_status, set_ui_status] = useState<AdUploadStatus>(
    state.cloudflare_uid ? 'ready' : 'idle',
  );
  const [ui_error, set_ui_error] = useState<string | null>(null);
  const [ui_progress, set_ui_progress] = useState(state.cloudflare_uid ? 1 : 0);

  const hook = useAdUpload({
    on_status_change: set_ui_status,
    on_progress: (p) => set_ui_progress(Math.round(p * 100) / 100),
  });

  const video_player = useVideoPlayer(local_uri, (player) => {
    player.loop = true;
  });

  const handle_pick_video = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      quality: 1,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.length) return;

    const asset = result.assets[0];
    const uri = asset?.uri;
    if (!uri) return;

    set_local_uri(uri);
    set_ui_progress(0);
    set_ui_status('uploading');
    set_ui_error(null);
    // Limpia el uid previo — un nuevo pick reemplaza al anterior (supersede
    // dentro del hook), no queremos avanzar con el uid del video descartado.
    update({ video_local_uri: uri, video_duration_ms: asset.duration ?? null, cloudflare_uid: null });

    await hook.upload({ local_uri: uri, duration_ms: asset.duration ?? null });

    if (hook.status === 'idle') return; // superado por otro pick mientras tanto

    set_ui_status(hook.status);
    set_ui_error(hook.error);
    if (hook.status === 'ready' && hook.cloudflare_uid) {
      update({ cloudflare_uid: hook.cloudflare_uid });
    }
  }, [hook, update]);

  const handle_retry = useCallback(async () => {
    if (!local_uri) return;
    set_ui_status('uploading');
    set_ui_error(null);
    await hook.upload({ local_uri, duration_ms: state.video_duration_ms });
    set_ui_status(hook.status);
    set_ui_error(hook.error);
    if (hook.status === 'ready' && hook.cloudflare_uid) {
      update({ cloudflare_uid: hook.cloudflare_uid });
    }
  }, [hook, local_uri, state.video_duration_ms, update]);

  const handle_next = useCallback(() => {
    if (ui_status !== 'ready') return;
    router.push('/ads/new/step2');
  }, [ui_status, router]);

  const has_video = local_uri !== null;
  const is_uploading = ui_status === 'uploading';
  const is_polling = ui_status === 'polling';
  const is_ready = ui_status === 'ready';
  const is_failed = ui_status === 'failed';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scroll_content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.page_header}>
          <Text style={styles.page_title}>Video del anuncio</Text>
          <Text style={styles.page_subtitle}>
            Sube un video vertical de 10 segundos a 2 minutos.
          </Text>
        </View>

        <View style={styles.video_area}>
          {has_video ? (
            <VideoView
              player={video_player}
              style={styles.video_view}
              nativeControls
              contentFit="contain"
            />
          ) : (
            <TouchableOpacity
              style={styles.picker_placeholder}
              onPress={handle_pick_video}
              activeOpacity={0.7}
              accessibilityLabel="Seleccionar video del anuncio"
            >
              <Play size={32} color={colors.gray_2} weight="fill" />
              <Text style={styles.picker_text}>Seleccionar video</Text>
              <Text style={styles.picker_hint}>Toca para abrir la galería</Text>
            </TouchableOpacity>
          )}
        </View>

        {has_video && !is_uploading && !is_polling && (
          <TouchableOpacity
            style={styles.change_video_btn}
            onPress={handle_pick_video}
            accessibilityLabel="Cambiar video"
          >
            <Text style={styles.change_video_text}>Cambiar video</Text>
          </TouchableOpacity>
        )}

        <View style={styles.status_area}>
          {is_uploading && (
            <UploadProgressBar
              indeterminate={ui_progress === 0}
              progress={ui_progress}
              label={
                ui_progress === 0
                  ? 'Preparando la subida…'
                  : `Subiendo video… ${Math.round(ui_progress * 100)}%`
              }
            />
          )}
          {is_polling && (
            <UploadProgressBar indeterminate label="Procesando video… esto toma unos segundos" />
          )}
          {is_ready && (
            <View style={styles.status_row}>
              <Text style={styles.success_text}>✓ Video listo</Text>
            </View>
          )}
          {is_failed && (
            <View style={styles.error_container}>
              <Text style={styles.error_text}>{ui_error ?? 'Error al subir el video'}</Text>
              <TouchableOpacity onPress={handle_retry} style={styles.retry_btn}>
                <Text style={styles.retry_text}>Reintentar</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      <View style={[styles.cta_area, { paddingBottom: 16 + insets.bottom }]}>
        <PrimaryButton
          label="Siguiente"
          onPress={handle_next}
          surface="light"
          disabled={!is_ready}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  scroll: {
    flex: 1,
  },
  scroll_content: {
    paddingHorizontal: spacing.s_20,
    paddingTop: spacing.s_8,
    paddingBottom: spacing.s_24,
  },
  page_header: {
    marginBottom: spacing.s_24,
  },
  page_title: {
    ...type_scale.h1,
    fontSize: 22,
    color: colors.ink,
    marginBottom: spacing.s_4,
  },
  page_subtitle: {
    ...type_scale.body,
    fontSize: 14,
    color: colors.gray_2,
  },
  video_area: {
    borderRadius: radii.r_16,
    overflow: 'hidden',
    backgroundColor: colors.paper_2,
    aspectRatio: 9 / 16,
    maxHeight: 360,
  },
  video_view: {
    flex: 1,
  },
  picker_placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s_8,
  },
  picker_text: {
    ...type_scale.body,
    fontSize: 16,
    fontWeight: '600' as const,
    color: colors.ink,
  },
  picker_hint: {
    fontSize: 12,
    color: colors.gray_2,
  },
  change_video_btn: {
    alignSelf: 'center',
    marginTop: spacing.s_12,
    paddingVertical: spacing.s_4,
    paddingHorizontal: spacing.s_16,
  },
  change_video_text: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600' as const,
  },
  status_area: {
    marginTop: spacing.s_16,
    minHeight: 36,
  },
  status_row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  success_text: {
    color: colors.primary,
    fontWeight: '600' as const,
    fontSize: 14,
  },
  error_container: {
    gap: spacing.s_8,
  },
  error_text: {
    fontSize: 13,
    color: colors.danger,
    lineHeight: 18,
  },
  retry_btn: {
    alignSelf: 'flex-start',
  },
  retry_text: {
    fontSize: 13,
    color: colors.primary,
    fontWeight: '600' as const,
  },
  cta_area: {
    paddingHorizontal: spacing.s_20,
    paddingVertical: spacing.s_16,
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderTopColor: colors.paper_3,
  },
});
