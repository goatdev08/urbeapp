/**
 * types.ts — tipos del dominio profile.
 *
 * AgentProfile: datos de un agente para la pantalla de perfil público.
 *
 * Fuentes:
 *   - `user_preferences`: full_name, profile_photo_url (columnas de migración 0015,
 *     escritas por el onboarding). No están en los tipos generados aún.
 *   - `users`: bio, created_at (member_since).
 *   - `agencies` (join vía users.agency_id): name.
 */

import type { Database } from '@/types/database';

type UserRow = Database['public']['Tables']['users']['Row'];
type AgencyRow = Database['public']['Tables']['agencies']['Row'];

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
