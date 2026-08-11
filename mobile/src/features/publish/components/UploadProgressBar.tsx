/**
 * UploadProgressBar — barra de progreso de la subida del video (#150, step5).
 *
 * Dos modos:
 *   - determinate: la barra se rellena 0..1 con el verde Urbea, animada con
 *     un timing suave por cada tick de on_progress (useVideoUpload).
 *   - indeterminate: banda deslizante en loop para las fases SIN progreso
 *     medible (preparando la subida, verificando, transcodificando en Stream).
 *
 * ponytail: Animated de RN core con native driver (scaleX/translateX/opacity)
 * — sin reanimated ni dependencias nuevas; es una barra, no un player.
 */
import React, { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

const COLOR_TRACK = '#E5E7EB';
const COLOR_FILL = '#1A5E44'; // verde Urbea (mismo COLOR_ACCENT de los steps)
const COLOR_LABEL = '#6B7280';

/** Fracción del ancho del track que ocupa la banda indeterminada. */
const BAND_FRACTION = 0.35;

interface UploadProgressBarProps {
  /** Progreso 0..1 — se ignora en modo indeterminate. */
  progress?: number;
  /** Texto bajo la barra ("Subiendo video… 43%"). */
  label: string;
  /** true → banda deslizante (fase sin progreso medible). */
  indeterminate?: boolean;
}

export function UploadProgressBar({
  progress = 0,
  label,
  indeterminate = false,
}: UploadProgressBarProps) {
  // useState con init perezoso (no useRef.current: el lint react-hooks
  // prohíbe leer refs durante el render) — identidad estable entre renders.
  const [fill_anim] = useState(() => new Animated.Value(0));
  const [band_anim] = useState(() => new Animated.Value(0));
  const [track_width, set_track_width] = useState(0);

  // Relleno determinate: anima hacia el progreso actual en cada tick.
  useEffect(() => {
    if (indeterminate) return;
    Animated.timing(fill_anim, {
      toValue: progress,
      duration: 250,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, indeterminate, fill_anim]);

  // Banda indeterminada: loop de izquierda a derecha mientras el modo esté activo.
  useEffect(() => {
    if (!indeterminate || track_width === 0) return;
    band_anim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(band_anim, {
        toValue: 1,
        duration: 1200,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [indeterminate, track_width, band_anim]);

  const band_width = track_width * BAND_FRACTION;

  return (
    <View
      style={styles.wrap}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={
        indeterminate ? {} : { min: 0, max: 100, now: Math.round(progress * 100) }
      }
    >
      <View
        style={styles.track}
        onLayout={(e) => set_track_width(e.nativeEvent.layout.width)}
      >
        {indeterminate ? (
          track_width > 0 && (
            <Animated.View
              style={[
                styles.band,
                {
                  width: band_width,
                  transform: [
                    {
                      translateX: band_anim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-band_width, track_width],
                      }),
                    },
                  ],
                },
              ]}
            />
          )
        ) : (
          <Animated.View
            style={[styles.fill, { transform: [{ scaleX: fill_anim }] }]}
          />
        )}
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: COLOR_TRACK,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    width: '100%',
    borderRadius: 4,
    backgroundColor: COLOR_FILL,
    // scaleX crece desde la izquierda, no desde el centro.
    transformOrigin: 'left',
  },
  band: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: COLOR_FILL,
    opacity: 0.85,
  },
  label: {
    fontSize: 14,
    color: COLOR_LABEL,
  },
});
