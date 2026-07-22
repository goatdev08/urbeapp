// supabase/functions/mint-thumbnail-url devuelve { baseUrl, token, durationSeconds }.
// build_thumbnail_frame_url arma la URL de UN frame concreto a partir del pct
// elegido por el usuario (thumbnail_pct) y la duración real del video.
//
// GREEN — subtarea 68.7 (Taskmaster).
export function build_thumbnail_frame_url(params: {
  baseUrl: string;
  token: string;
  pct: number;
  durationSeconds: number | null;
}): string {
  const { baseUrl, token, pct, durationSeconds } = params;

  // Sin duración conocida (video aún 'processing') nunca se puede calcular
  // time — se omite el parámetro y se deja que Stream sirva su frame default.
  if (durationSeconds === null) {
    return `${baseUrl}?token=${token}`;
  }

  const clamped_pct = Math.min(100, Math.max(0, pct));
  const time_seconds = (clamped_pct / 100) * durationSeconds;

  return `${baseUrl}?time=${time_seconds.toFixed(1)}s&token=${token}`;
}
