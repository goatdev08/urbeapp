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
  address: string;
  bedrooms: number;
  bathrooms: number;
  owner_user_id: string;
  agency_id: string | null;
  created_at: string;
  /** Teléfono del agente (users.phone) para el botón WhatsApp del feed. null si no hay. */
  agent_phone: string | null;
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
