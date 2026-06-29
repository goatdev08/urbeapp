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
  video: FeedPropertyVideo;
};

/** Lo que el feed consume: FeedProperty + signed_url resuelto + video_id plano. */
export type FeedPropertyWithUrl = FeedProperty & {
  signed_url: string;
  video_id: string;
};
