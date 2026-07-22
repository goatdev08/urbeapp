// supabase/functions/mint-thumbnail-url devuelve { baseUrl, token, durationSeconds }.
// build_thumbnail_frame_url arma la URL de UN frame concreto a partir del pct
// elegido por el usuario (thumbnail_pct) y la duración real del video.
//
// STUB — subtarea 68.7 (Taskmaster). Fase RED: solo signature, sin lógica.
export function build_thumbnail_frame_url(_params: {
  baseUrl: string;
  token: string;
  pct: number;
  durationSeconds: number | null;
}): string {
  throw new Error('not_implemented');
}
