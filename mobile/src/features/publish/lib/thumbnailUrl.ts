// supabase/functions/mint-thumbnail-url devuelve { baseUrl, token, durationSeconds }.
// build_thumbnail_frame_url arma la URL de UN frame concreto a partir del pct
// elegido por el usuario (thumbnail_pct) y la duración real del video.
//
// ⚠️ CONTRATO DE CLOUDFLARE (verificado en vivo 2026-07-22, prueba E2E local):
// en un video con `requireSignedURLs=true` el token va **EN EL PATH** (sustituye
// al uid), NO como query param: `.../<uid>/thumbnails/thumbnail.jpg?token=<JWT>`
// devuelve 401, y `.../<TOKEN>/thumbnails/thumbnail.jpg` devuelve 200. Por eso
// `baseUrl` YA VIENE con el token incrustado desde la EF y aquí solo se le
// agrega `?time=<N>s`. El uid viaja dentro del JWT (claim `sub`).
//
// GREEN — subtarea 68.7 (Taskmaster).
export function build_thumbnail_frame_url(params: {
  baseUrl: string;
  pct: number;
  durationSeconds: number | null;
}): string {
  const { baseUrl, pct, durationSeconds } = params;

  // Sin duración conocida (video aún 'processing') nunca se puede calcular
  // time — se omite el parámetro y se deja que Stream sirva su frame default.
  if (durationSeconds === null) {
    return baseUrl;
  }

  const clamped_pct = Math.min(100, Math.max(0, pct));
  const time_seconds = (clamped_pct / 100) * durationSeconds;

  return `${baseUrl}?time=${time_seconds.toFixed(1)}s`;
}
