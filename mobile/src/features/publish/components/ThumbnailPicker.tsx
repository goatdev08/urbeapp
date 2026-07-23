/**
 * ThumbnailPicker — selección de la portada (thumbnail) del video en Cloudflare
 * Stream: 3 frames sugeridos (25/50/75 % de la duración) + slider de ajuste fino.
 *
 * Subtarea 68.7 (Taskmaster) — pieza NO crítica (UI). Consume las piezas críticas
 * ya implementadas (GREEN): `useThumbnail` (firma + persistencia) y
 * `build_thumbnail_frame_url` (armado de la URL de un frame). Este componente NO
 * reimplementa esa lógica — solo la orquesta.
 *
 * Visibilidad: la decide el CALLER (step3.tsx) según `property_videos.status` —
 * este componente asume que solo se monta cuando aplica, pero es defensivo: si
 * recibe `videoStatus !== 'ready'` muestra el aviso de "procesando" (o nada, para
 * estados terminales que no tienen sección propia, ver spec §3 Decisión A).
 *
 * Slider: `@react-native-community/slider` NO está instalado (spec §5, §9.4).
 * // ponytail: recreado con una primitiva RN (View "track" + PanResponder, mismo
 * patrón que RadiusSelector.tsx #58.2) en vez de agregar la dependencia — es un
 * único scrubber 0..100, no justifica una lib. Techo conocido: sin soporte de
 * teclado/D-pad (accesibilidad táctil solamente); si eso se vuelve un requisito,
 * ahí sí vale la pena la dependencia oficial.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  type LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, fonts, radii, spacing } from '@/theme/theme';

import { useThumbnail, type ThumbnailSource } from '../hooks/useThumbnail';
import { build_thumbnail_frame_url } from '../lib/thumbnailUrl';

const SUGGESTED_PCTS = [25, 50, 75] as const;
const DEFAULT_PCT = 50;
const SLIDER_DEBOUNCE_MS = 150;
const SLIDER_THUMB_SIZE = 18;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ThumbnailPickerProps {
  /** uid de Cloudflare Stream del video linkeado (property_videos.cloudflare_uid). */
  cloudflareUid: string;
  /** Estado del video linkeado — decide si el picker o el aviso "procesando" se muestra. */
  videoStatus: string;
  /** thumbnail_pct actual en DB — null si nunca se eligió (usa el default 50). */
  initialPct?: number | null;
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function ThumbnailPicker({ cloudflareUid, videoStatus, initialPct }: ThumbnailPickerProps) {
  const thumbnail = useThumbnail();

  const [source, set_source] = useState<ThumbnailSource | null>(null);
  const [loading, set_loading] = useState<boolean>(videoStatus === 'ready');
  const [load_error, set_load_error] = useState(false);
  const [selected_pct, set_selected_pct] = useState<number>(initialPct ?? DEFAULT_PCT);
  const [draft_pct, set_draft_pct] = useState<number>(initialPct ?? DEFAULT_PCT);
  const [adjust_open, set_adjust_open] = useState(false);
  const [saving, set_saving] = useState(false);
  const [save_error, set_save_error] = useState<string | null>(null);

  const load_source = useCallback(async () => {
    set_loading(true);
    set_load_error(false);
    const result = await thumbnail.fetch_source(cloudflareUid);
    set_loading(false);
    if (!result) {
      set_load_error(true);
      return;
    }
    set_source(result);
  }, [cloudflareUid, thumbnail]);

  useEffect(() => {
    if (videoStatus === 'ready') {
      // fetch-on-mount: dispara la carga async (load_source maneja su propio loading/error).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load_source();
    } else {
      set_loading(false);
    }
  }, [videoStatus, load_source]);

  const persist_pct = useCallback(
    async (pct: number) => {
      set_selected_pct(pct); // optimista (spec §5 "Guardando")
      set_saving(true);
      set_save_error(null);
      const ok = await thumbnail.save_pct(cloudflareUid, pct);
      set_saving(false);
      if (!ok) {
        // fail-soft: la portada default sigue vigente, solo avisamos.
        set_save_error(thumbnail.error ?? 'No se pudo guardar la portada. Intenta de nuevo.');
      }
    },
    [cloudflareUid, thumbnail],
  );

  const handle_confirm_adjust = useCallback(
    (pct: number) => {
      set_adjust_open(false);
      void persist_pct(pct);
    },
    [persist_pct],
  );

  // ── Video aún no listo: aviso o nada (spec §3 Decisión A) ──────────────────
  if (videoStatus !== 'ready') {
    if (videoStatus === 'processing') {
      return (
        <View style={styles.section}>
          <Text style={styles.title}>Portada del video</Text>
          <View style={styles.notice_card}>
            <Text style={styles.notice_icon}>▶</Text>
            <Text style={styles.notice_text}>
              Tu video se está procesando. Vuelve en un momento para elegir la portada.
            </Text>
          </View>
        </View>
      );
    }
    return null;
  }

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Portada del video</Text>
      <Text style={styles.hint}>Elige el frame que se mostrará en el feed.</Text>

      {loading && (
        <View style={styles.row}>
          {SUGGESTED_PCTS.map((pct) => (
            <View key={pct} style={styles.skeleton} />
          ))}
        </View>
      )}

      {!loading && load_error && (
        <View style={styles.error_card}>
          <Text style={styles.error_text}>
            No se pudo cargar la vista previa.
          </Text>
          <Pressable onPress={() => void load_source()} accessibilityLabel="Reintentar cargar portada">
            <Text style={styles.retry_text}>Reintentar</Text>
          </Pressable>
        </View>
      )}

      {!loading && !load_error && source && (
        <>
          <View style={styles.row}>
            {SUGGESTED_PCTS.map((pct) => {
              const is_active = selected_pct === pct;
              const url = build_thumbnail_frame_url({ ...source, pct });
              return (
                <Pressable
                  key={pct}
                  onPress={() => void persist_pct(pct)}
                  accessibilityRole="radio"
                  accessibilityLabel={`Usar frame al ${pct} por ciento`}
                  accessibilityState={{ selected: is_active }}
                  style={[styles.thumb, is_active && styles.thumb_active]}
                >
                  <Image source={{ uri: url }} style={styles.thumb_image} resizeMode="cover" />
                  {is_active && (
                    <View style={styles.check_badge}>
                      <Text style={styles.check_text}>✓</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={() => set_adjust_open((prev) => !prev)}
            style={styles.adjust_toggle}
            accessibilityLabel={adjust_open ? 'Cerrar ajuste de portada' : 'Ajustar portada'}
          >
            <Text style={styles.adjust_text}>
              ¿Ningún momento convence?{'  '}
              <Text style={styles.adjust_text_accent}>{adjust_open ? 'Cerrar ▾' : 'Ajustar ▸'}</Text>
            </Text>
          </Pressable>

          {adjust_open && (
            <ThumbnailAdjustPanel
              source={source}
              initial_pct={draft_pct}
              on_change={set_draft_pct}
              on_confirm={handle_confirm_adjust}
            />
          )}

          {saving && (
            <ActivityIndicator size="small" color={colors.primary} style={styles.saving_spinner} />
          )}
          {save_error && <Text style={styles.error_text}>{save_error}</Text>}
        </>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Panel de ajuste fino — preview grande + slider (primitiva RN, patrón
// RadiusSelector.tsx #58.2: track_width en estado, PanResponder vía useMemo —
// leer/crear un PanResponder desde un ref durante el render dispara
// react-hooks/refs; useMemo lo evita sin perder la identidad estable).
// ---------------------------------------------------------------------------

interface ThumbnailAdjustPanelProps {
  source: ThumbnailSource;
  initial_pct: number;
  on_change: (pct: number) => void;
  on_confirm: (pct: number) => void;
}

function ThumbnailAdjustPanel({ source, initial_pct, on_change, on_confirm }: ThumbnailAdjustPanelProps) {
  const [pct, set_pct] = useState(initial_pct);
  // El preview se actualiza con debounce — evita pedir una imagen nueva en cada
  // pixel de arrastre (spec §4: "preview en vivo del frame (debounced)"). Efecto
  // en vez de un timer en ref: react-hooks/refs marca cualquier ref leído desde
  // una closure alcanzable por PanResponder.create (ver pan_responder abajo).
  const [preview_pct, set_preview_pct] = useState(initial_pct);
  const [track_width, set_track_width] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => set_preview_pct(pct), SLIDER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [pct]);

  const handle_track_layout = useCallback((e: LayoutChangeEvent) => {
    set_track_width(e.nativeEvent.layout.width);
  }, []);

  const update_pct = useCallback(
    (next_pct: number) => {
      const clamped = Math.min(100, Math.max(0, Math.round(next_pct)));
      set_pct(clamped);
      on_change(clamped);
    },
    [on_change],
  );

  const pan_responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => track_width > 0,
        onMoveShouldSetPanResponder: () => track_width > 0,
        onPanResponderMove: (evt) => {
          if (track_width <= 0) return;
          update_pct((evt.nativeEvent.locationX / track_width) * 100);
        },
      }),
    [track_width, update_pct],
  );

  const preview_url = build_thumbnail_frame_url({ ...source, pct: preview_pct });

  return (
    <View style={styles.adjust_panel}>
      <View style={styles.preview_box}>
        <Image source={{ uri: preview_url }} style={styles.preview_image} resizeMode="cover" />
      </View>

      <View
        onLayout={handle_track_layout}
        style={styles.slider_track}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Posición de la portada"
        accessibilityValue={{ min: 0, max: 100, now: pct }}
      >
        <View style={[styles.slider_fill, { width: `${pct}%` }]} />
        <View style={[styles.slider_thumb, { left: `${pct}%` }]} />
        {/* Overlay separado para el PanResponder — mismo motivo que
            RadiusSelector.tsx: panHandlers en el nodo con accessibilityValue
            confunde a @testing-library/react-native (isEventEnabled con
            track_width=0 en test → filtra eventos). */}
        <View style={StyleSheet.absoluteFill} {...pan_responder.panHandlers} />
      </View>
      <Text style={styles.slider_value}>{pct}%</Text>

      <Pressable
        onPress={() => on_confirm(pct)}
        style={styles.use_frame_btn}
        accessibilityLabel="Usar este frame"
      >
        <Text style={styles.use_frame_text}>Usar este frame</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Estilos — modo gestión-claro, tokens de theme.ts
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  section: {
    marginHorizontal: spacing.s_20,
    marginTop: spacing.s_24,
    padding: spacing.s_16,
    borderRadius: radii.r_16,
    backgroundColor: colors.paper,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 17,
    color: colors.ink,
    marginBottom: spacing.s_4,
  },
  hint: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.gray_3,
    marginBottom: spacing.s_16 - 2,
  },

  row: {
    flexDirection: 'row',
    gap: spacing.s_12,
  },

  skeleton: {
    flex: 1,
    aspectRatio: 9 / 16,
    borderRadius: radii.r_12,
    backgroundColor: colors.paper_3,
  },

  thumb: {
    flex: 1,
    aspectRatio: 9 / 16,
    borderRadius: radii.r_12,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.paper_3,
    backgroundColor: colors.surface,
  },
  thumb_active: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  thumb_image: {
    width: '100%',
    height: '100%',
  },
  check_badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: radii.r_pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check_text: {
    color: colors.on_primary,
    fontSize: 12,
    fontWeight: '700',
  },

  adjust_toggle: {
    marginTop: spacing.s_16 - 2,
    alignSelf: 'flex-start',
  },
  adjust_text: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.gray_3,
  },
  adjust_text_accent: {
    fontFamily: fonts.sans_bold,
    color: colors.primary,
  },

  adjust_panel: {
    marginTop: spacing.s_16,
    gap: spacing.s_8 + 2,
  },
  preview_box: {
    alignSelf: 'center',
    width: '55%',
    aspectRatio: 9 / 16,
    borderRadius: radii.r_12,
    overflow: 'hidden',
    backgroundColor: colors.paper_3,
  },
  preview_image: {
    width: '100%',
    height: '100%',
  },

  slider_track: {
    height: 24,
    justifyContent: 'center',
  },
  slider_fill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: radii.r_pill,
    backgroundColor: colors.primary,
  },
  slider_thumb: {
    position: 'absolute',
    width: SLIDER_THUMB_SIZE,
    height: SLIDER_THUMB_SIZE,
    borderRadius: radii.r_pill,
    marginLeft: -SLIDER_THUMB_SIZE / 2,
    backgroundColor: colors.primary,
  },
  slider_value: {
    alignSelf: 'center',
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
    color: colors.ink,
  },

  use_frame_btn: {
    alignSelf: 'center',
    paddingVertical: spacing.s_8 + 2,
    paddingHorizontal: spacing.s_20,
    borderRadius: radii.r_pill,
    backgroundColor: colors.primary_tint,
  },
  use_frame_text: {
    fontFamily: fonts.sans_bold,
    color: colors.primary,
    fontSize: 14,
  },

  notice_card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8 + 2,
    padding: spacing.s_16 - 2,
    borderRadius: radii.r_12,
    backgroundColor: colors.surface,
  },
  notice_icon: {
    fontSize: 18,
    color: colors.gray_3,
  },
  notice_text: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.gray_3,
    lineHeight: 18,
  },

  error_card: {
    padding: spacing.s_16 - 2,
    borderRadius: radii.r_12,
    backgroundColor: colors.surface,
    gap: spacing.s_4 + 2,
  },
  error_text: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.danger,
    lineHeight: 18,
  },
  retry_text: {
    fontFamily: fonts.sans_bold,
    fontSize: 13,
    color: colors.primary,
  },

  saving_spinner: {
    marginTop: spacing.s_8,
  },
});

export default ThumbnailPicker;
