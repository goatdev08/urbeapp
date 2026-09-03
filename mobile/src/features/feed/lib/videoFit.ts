/**
 * videoFit.ts — presentación híbrida del video en el feed (#242.2).
 *
 * Decisión Abraham 2026-09-03: un video vertical se ve a pantalla completa
 * (contentFit 'cover', inmersivo — lo de siempre); uno horizontal o cuadrado se
 * ve COMPLETO ('contain') sobre su portada desenfocada, como TikTok/Reels.
 *
 * La frontera no es "portrait vs landscape" sino cuánto del cuadro perdería
 * cover: cover recorta el eje sobrante hasta igualar la relación de la
 * pantalla; si esa pérdida supera MAX_CROP_FRACTION → contain. Así un 9:16 en
 * un iPhone 19.5:9 sigue en cover (pierde ~18 %), pero un 4:5 (pierde ~42 %),
 * un 1:1 (~54 %) o un 16:9 (~74 %) pasan a contain.
 *
 * Tamaño desconocido o inválido → 'cover': es el comportamiento previo y evita
 * un salto a contain "por si acaso" mientras llega la metadata.
 *
 * ponytail: una función pura sin estado; el tamaño lo aporta el componente
 * (portada de Stream vía expo-image onLoad y luego player.videoTrack.size).
 */
export type MediaSize = { width: number; height: number };
export type VideoFit = 'cover' | 'contain';

/** Máximo del cuadro que aceptamos perder con cover antes de pasar a contain. */
export const MAX_CROP_FRACTION = 0.25;

const is_valid = (s: MediaSize | null | undefined): s is MediaSize =>
  s != null && Number.isFinite(s.width) && Number.isFinite(s.height) && s.width > 0 && s.height > 0;

export function fit_for_video(media: MediaSize | null | undefined, screen: MediaSize): VideoFit {
  if (!is_valid(media) || !is_valid(screen)) return 'cover';
  const media_ratio = media.width / media.height;
  const screen_ratio = screen.width / screen.height;
  // Fracción del cuadro que cover recorta (simétrico: sobra ancho o sobra alto).
  const crop = 1 - Math.min(media_ratio, screen_ratio) / Math.max(media_ratio, screen_ratio);
  return crop <= MAX_CROP_FRACTION ? 'cover' : 'contain';
}
