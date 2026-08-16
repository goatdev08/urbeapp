/**
 * types.ts — Tipos compartidos del feed vertical.
 *
 * FeedProperty: forma que devuelve la query 9.5 (join properties + property_videos).
 * FeedPropertyWithUrl: la misma forma enriquecida con signed_url tras llamar a
 *   la EF mint-video-url (subtarea 9.5). El feed consume esta variante.
 *
 * ponytail: sin playback_url — en la demo el video se sirve por signed URL
 * generada en cliente (mint-video-url). El campo se agrega en 9.5, no aquí.
 */

export type FeedPropertyVideo = {
  id: string;
  storage_path: string;
  position: number;
  /** Portada del video (frame medio) servida como URL pública. null si no hay. */
  thumbnail_url: string | null;
};

export type FeedProperty = {
  id: string;
  price: number;
  /**
   * Metadatos del listado (quick fix 2026-08-15) — chips de operación/tipo,
   * divisa del precio y respeto a price_visible en el overlay. Los tipos son
   * string (no el enum literal) porque el feed solo los PINTA; el mapa
   * label/color vive en el overlay y hace fallback al valor crudo.
   */
  operation_type: string;
  property_type: string;
  /** 'MXN' | 'USD'. Fail-open a 'MXN' si la fila no trae la columna. */
  currency: string;
  /** false → el overlay muestra "Precio a consultar". Fail-open a true. */
  price_visible: boolean;
  address: string;
  bedrooms: number;
  bathrooms: number;
  owner_user_id: string;
  agency_id: string | null;
  created_at: string;
  /** Teléfono del agente (users.phone) para el botón WhatsApp del feed. null si no hay. */
  agent_phone: string | null;
  /** Nombre público del agente (vista agent_public_profiles, #145). null si no hay fila. */
  agent_name: string | null;
  /**
   * Foto de perfil del agente EN CRUDO (#145): key R2 nueva o URL http(s)
   * legacy de Storage — la UI la resuelve con useR2Urls (passthrough de URLs,
   * mint de keys). null si el agente no tiene foto.
   */
  agent_photo_url: string | null;
  video: FeedPropertyVideo;
};

/** Lo que el feed consume: FeedProperty + signed_url resuelto + video_id plano. */
export type FeedPropertyWithUrl = FeedProperty & {
  signed_url: string;
  video_id: string;
  /**
   * Portada firmada de Cloudflare Stream (68.15) al frame de thumbnail_pct.
   * null para videos legacy (Storage) o si la EF no pudo firmarla — en ese
   * caso el feed cae a video.thumbnail_url (legacy) o al fondo oscuro.
   */
  posterUrl: string | null;
};
