/**
 * /publish/step5 — Paso 5 del wizard de publicación (5 pasos, 73.3).
 * Selección, preview y upload del video de la propiedad.
 *
 * Origen: subtarea 8.8 (creó este screen como step3.tsx del wizard viejo de
 * 3 pasos). 73.3 lo renombra 1:1 — mismos campos, mismo comportamiento, solo
 * cambia su posición en la cadena (ahora paso 5 de 5, antes 3 de 3; el
 * número lo resuelve el StepIndicator del _layout vía STEP_MAP, no hay nada
 * hardcodeado aquí).
 *
 * Flujo:
 *   1. Usuario toca "Seleccionar video" → expo-image-picker abre galería.
 *   2. Al elegir: preview con expo-video + upload automático (useVideoUpload).
 *   3. Mientras sube: barra de progreso + estado 'Subiendo…'.
 *   4. En éxito: 'Listo' + botón "Publicar" habilitado.
 *   5. En error: mensaje de error + botón para reintentar.
 *
 * ponytail: UI state local (set_ui_status) para renderizar progreso — el hook
 *   usa refs (sin useState) para compatibilidad con el sync act() de EC-12.
 *   El re-render del screen lo dispara el estado local, no el hook.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
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


import { usePublishForm } from '@/features/publish/store/PublishFormContext';
import { useVideoUpload, type UploadStatus } from '@/features/publish/hooks/useVideoUpload';
import { useVideoReady } from '@/features/publish/hooks/useVideoReady';
import { usePublish } from '@/features/publish/hooks/usePublish';
import { validate_video_duration_ms } from '@/features/publish/validation';
import { ThumbnailPicker } from '@/features/publish/components/ThumbnailPicker';
import { UploadProgressBar } from '@/features/publish/components/UploadProgressBar';
import { PrimaryButton } from '@/components/PrimaryButton';

// ---------------------------------------------------------------------------
// Tokens (alineados con step1/step2/step3/step4)
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

export default function Step5Screen() {
  const router = useRouter();
  // #143.6: el CTA absoluto al fondo quedaba bajo la barra de botones de Android
  const insets = useSafeAreaInsets();

  const { state, update } = usePublishForm();
  // Edit mode se resuelve del CONTEXTO (propagado una vez en _layout), NO de la
  // URL: sobrevive a la navegación entre pasos, así que este screen ya no cae
  // en create mode por pérdida del param → fin de la duplicación (#53).
  const is_edit_mode = state.edit_mode;
  const property_id = state.property_id;

  // ── Local state para reactivity en la UI ──────────────────────────────────
  // useVideoUpload usa refs (sin useState) → el screen gestiona sus propios
  // estados de UI que reflejan el resultado del upload. Declarado ANTES del
  // hook: set_ui_status se le pasa como on_status_change (defecto O2 — ver
  // abajo).
  const [local_uri, set_local_uri] = useState<string | null>(null);
  const [ui_status, set_ui_status] = useState<UploadStatus>('idle');
  const [ui_error, set_ui_error] = useState<string | null>(null);
  // #150: progreso 0..1 espejado en vivo desde el hook (on_progress) para la
  // barra. Redondeado a centésimas — React descarta el setState si el valor
  // no cambió, así los ticks del uploader no fuerzan re-renders de más.
  const [ui_progress, set_ui_progress] = useState(0);
  const handle_progress = useCallback((p: number) => {
    set_ui_progress(Math.round(p * 100) / 100);
  }, []);
  // Estados de publicación (usePublish también usa refs — espejamos aquí para reactivity).
  const [publish_status, set_publish_status] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [publish_error, set_publish_error] = useState<string | null>(null);

  // O2 (guardian, tras 103.2): sin on_status_change, ui_status solo se leía
  // DESPUÉS de `await hook.upload(...)` — el estado transitorio 'verifying'
  // (hasta ~27s de poll silencioso) nunca llegaba a la pantalla. set_ui_status
  // es estable (useState) → no rompe la memoización de `upload` en el hook.
  const hook = useVideoUpload({ on_status_change: set_ui_status, on_progress: handle_progress });
  // Edit mode: UPDATE directo sin EF; create mode: invoca EF (sin cambios).
  const publish_hook = usePublish({
    editMode: is_edit_mode,
    propertyId: property_id,
  });

  // ── Video player (expo-video) ──────────────────────────────────────────────
  // ponytail: nativeControls=true → expo-video maneja play/pause, sin boilerplate.
  const video_player = useVideoPlayer(local_uri, (player) => {
    player.loop = true;
    // Fix #57: tope de buffer anti-OOM — ver rationale en VideoFeedItem.tsx
    player.bufferOptions = {
      preferredForwardBufferDuration: 10,
      maxBufferBytes: 25 * 1024 * 1024,
    };
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

    const asset = result.assets?.[0];
    const uri = asset?.uri;
    if (!uri) return;

    // #126: validar la duración AL ELEGIR (asset.duration en ms) — antes el
    // rechazo llegaba del server al final del wizard, con el video ya subido.
    const duration_check = validate_video_duration_ms(asset.duration);
    if (!duration_check.valid) {
      Alert.alert('Video fuera de rango', duration_check.error ?? '');
      return;
    }

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
    set_publish_status('submitting');
    set_publish_error(null);

    await publish_hook.publish();

    const final_status = publish_hook.status;
    const final_error = publish_hook.error;

    set_publish_status(final_status);
    set_publish_error(final_error);

    if (final_status === 'success') {
      // 73.6: en edit mode, la EF edit-property puede responder 'direct'
      // (cambios ya aplicados) o 'revision' (cambio crítico — PRD §15.5/§15.6
      // — quedó pendiente de aprobación admin; la propiedad publicada actual
      // NO cambió todavía).
      if (is_edit_mode && publish_hook.editResultMode === 'revision') {
        Alert.alert(
          'Cambios en revisión',
          'Tu edición incluye cambios importantes (ubicación, precio, tipo, etc.) que el equipo debe aprobar antes de publicarse. Mientras tanto, tu propiedad sigue visible con los datos actuales.',
          [{ text: 'Entendido', onPress: () => router.replace('/') }],
        );
        return;
      }

      // Portada: default 50% (Stream, 68.4) al publicar. El agente puede
      // refinarla en el editor una vez el video quede 'ready' (68.7, sección
      // "Portada" más abajo) — la generación de un frame local ya no aplica
      // con upload-first (cleanup P7 legacy, ver videoThumbnail.ts eliminado).
      Alert.alert(
        is_edit_mode ? '¡Cambios guardados!' : '¡Publicada!',
        is_edit_mode
          ? 'Tu propiedad se actualizó correctamente.'
          : 'Tu propiedad ya está disponible en el feed.',
        [
          {
            text: 'Aceptar',
            // Navega a la home del feed (app/(protected)/index.tsx).
            onPress: () => router.replace('/'),
          },
        ],
      );
    }
  }, [publish_hook, router, is_edit_mode]);

  // ── Derivados de estado ────────────────────────────────────────────────────

  const is_uploading = ui_status === 'uploading';
  // #103.2: uploadAsync() puede fallar leyendo la respuesta aunque el video
  // SÍ haya llegado a Stream — el hook verifica antes de marcar error.
  const is_verifying = ui_status === 'verifying';
  // Contrato 68.4: el binario terminó de subir y quedó 'processing' en
  // Cloudflare Stream (transcodificando) — nunca llega a 'success' en el
  // cliente; 'ready' se resuelve por webhook (68.5).
  const is_success = ui_status === 'processing';
  const is_error = ui_status === 'error';
  const has_video = local_uri !== null;
  const is_publishing = publish_status === 'submitting';
  const is_publish_error = publish_status === 'error';

  // ponytail: en edit mode sin video nuevo → se conserva el existente, no se requiere re-subir.
  const can_publish_without_new_video = is_edit_mode && !has_video;

  // #126: el binario subido NO basta — el gate del server exige el 'ready'
  // real de la DB (lo escribe el webhook de Stream). Pollear hasta entonces;
  // antes, tocar Publicar aquí daba 409 VIDEO_NOT_READY sin espera ni retry.
  // Solo aplica en create mode con upload terminado (uid en el form).
  const { status: ready_status } = useVideoReady(
    !is_edit_mode && is_success ? (state.cloudflare_uid ?? null) : null,
  );
  const is_video_processing = is_success && ready_status !== 'ready' && ready_status !== 'failed';
  const is_video_ready = is_success && ready_status === 'ready';
  const is_processing_failed = is_success && ready_status === 'failed';

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

      {/* ── Contenido scrolleable (video + status + Portada en edit mode) ── */}
      <ScrollView
        style={styles.scroll_area}
        contentContainerStyle={styles.scroll_content}
        showsVerticalScrollIndicator={false}
      >
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
          disabled={is_uploading || is_verifying}
          accessibilityLabel="Cambiar video"
        >
          <Text style={styles.change_video_text}>Cambiar video</Text>
        </TouchableOpacity>
      )}

      {/* ── Estado del upload (#150: barra de progreso, ya no spinner) ── */}
      <View style={styles.status_area}>
        {is_uploading && (
          // Antes del primer byte (mint-upload-url en vuelo) no hay progreso
          // medible → banda indeterminada; con bytes reales → % determinado.
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
        {is_verifying && (
          <UploadProgressBar indeterminate label="Verificando que el video llegó…" />
        )}
        {is_video_processing && (
          <UploadProgressBar
            indeterminate
            label="Procesando video… esto toma unos segundos"
          />
        )}
        {is_video_ready && (
          <View style={styles.status_row}>
            <Text style={styles.success_icon}>✓</Text>
            <Text style={[styles.status_text, styles.success_text]}>
              Video listo para publicar
            </Text>
          </View>
        )}
        {is_processing_failed && (
          <View style={styles.error_container}>
            <Text style={styles.error_text}>
              El video no se pudo procesar. Intenta subirlo de nuevo.
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

      {/* ── Portada del video (68.7) — solo edit mode, con video linkeado ── */}
      {is_edit_mode && state.cloudflare_uid && (
        <ThumbnailPicker
          cloudflareUid={state.cloudflare_uid}
          videoStatus={state.video_status ?? 'processing'}
          initialPct={state.video_thumbnail_pct}
        />
      )}
      </ScrollView>

      {/* ── CTA (fijo al fondo) ───────────────────────────────────────── */}
      <View style={[styles.cta_area, { paddingBottom: 16 + insets.bottom }]}>
        {is_publish_error && (
          <Text style={styles.error_text}>
            {publish_error ?? 'Error al publicar. Intenta de nuevo.'}
          </Text>
        )}
        <PrimaryButton
          label={is_publishing
            ? (is_edit_mode ? 'Guardando…' : 'Publicando…')
            : is_video_processing
            ? 'Procesando video…'
            : (is_edit_mode ? 'Guardar cambios' : 'Publicar')}
          onPress={handle_publish}
          surface="light"
          // #126: en create mode exige el 'ready' REAL de la DB (webhook), no
          // solo el binario subido — publicar antes daba 409 VIDEO_NOT_READY.
          disabled={(!is_video_ready && !can_publish_without_new_video) || is_publishing}
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

  // ── Contenido scrolleable ────────────────────────────────────────────────
  scroll_area: {
    flex: 1,
  },
  scroll_content: {
    paddingBottom: 100, // despeje del cta_area fijo (absolute) al fondo
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
