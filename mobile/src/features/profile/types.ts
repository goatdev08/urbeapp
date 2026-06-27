/**
 * types.ts — tipos del dominio profile.
 *
 * AgentProfile: datos de un agente para la pantalla de perfil público.
 * GridProperty: propiedad resumida para la grilla 2-col del perfil.
 *
 * Fuentes:
 *   - `user_preferences`: full_name, profile_photo_url (columnas de migración 0015,
 *     escritas por el onboarding). No están en los tipos generados aún.
 *   - `users`: bio, created_at (member_since).
 *   - `agencies` (join vía users.agency_id): name.
 *   - `properties`: columnas explícitas para la grilla.
 *   - `property_videos`: thumbnail del primer video (position mínimo).
 */

import type { Database } from '@/types/database';

type UserRow = Database['public']['Tables']['users']['Row'];
type AgencyRow = Database['public']['Tables']['agencies']['Row'];
type PropertyRow = Database['public']['Tables']['properties']['Row'];

/**
 * GridProperty — propiedad resumida para la grilla 2-columnas del perfil.
 *
 * El campo `thumbnail_url` vendrá null mientras publish #8 no lo pueble;
 * el card (16.5) muestra placeholder en ese caso.
 */
export interface GridProperty {
  id: PropertyRow['id'];
  price: PropertyRow['price'];
  operation_type: PropertyRow['operation_type'];
  property_type: PropertyRow['property_type'];
  status: PropertyRow['status'];
  address: PropertyRow['address'];
  published_at: PropertyRow['published_at'];
  /** URL del thumbnail del primer video (position mínimo). Puede ser null. */
  thumbnail_url: string | null;
  /** storage_path del primer video. Puede ser null (sin video aún). */
  storage_path: string | null;
}

export interface AgentProfile {
  /** Nombre completo — de user_preferences.full_name (migración 0015). */
  full_name: string | null;
  /** URL de foto de perfil — de user_preferences.profile_photo_url (migración 0015). */
  profile_photo_url: string | null;
  /** Biografía corta — de users.bio (null hasta que se implemente edición). */
  bio: UserRow['bio'];
  /** Fecha de alta del usuario — usada como "member since". */
  member_since: UserRow['created_at'];
  /** Nombre de la agencia (null si el agente es independiente). */
  agency_name: AgencyRow['name'] | null;
}
