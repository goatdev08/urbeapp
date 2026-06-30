/**
 * usePropertyDetail — hook de lectura para la pantalla de detalle de propiedad.
 *
 * Recibe `id` de la propiedad y devuelve { data, isLoading, error, refetch }.
 *
 * Estrategia de fetch en dos pasos:
 *   1. Query principal: properties (active, deleted_at null) + property_videos
 *      (client-side filter deleted_at null + sort by position) + users (phone) +
 *      agencies (name, logo_url) — todo en un select con joins embebidos.
 *   2. En paralelo: user_preferences (full_name, profile_photo_url — migración 0015
 *      sin regenerar tipos; mismo cast que useAgentProfile) + mint-video-url EF.
 *
 * Desambiguación de FKs PostgREST (igual que useAgentProfile):
 *   - users!properties_owner_user_id_fkey — FK properties.owner_user_id → users.id
 *   - agencies!properties_agency_id_fkey — FK properties.agency_id → agencies.id
 *
 * ponytail: si mint-video-url falla, la pantalla sigue mostrando info de la
 * propiedad sin signed_url (fail-soft para video, fail-hard para datos de negocio).
 * useEffect + useCallback es suficiente para este fetch de baja frecuencia.
 */

import { useState, useCallback, useEffect } from 'react';

import { supabase } from '@/lib/supabase/client';
import { localizeSignedUrl } from '@/lib/supabase/localizeSignedUrl';

import type { PropertyDetail, PropertyVideoDetail } from '../types';

// ---------------------------------------------------------------------------
// Tipo público del hook
// ---------------------------------------------------------------------------

export type UsePropertyDetailResult = {
  data: PropertyDetail | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

// ---------------------------------------------------------------------------
// Tipos internos (casts de query)
// ---------------------------------------------------------------------------

/** Respuesta de la Edge Function mint-video-url. */
type MintedVideo = {
  property_id: string;
  video_id: string;
  signed_url: string;
};

/**
 * Columnas de user_preferences que necesitamos (migración 0015).
 * No están en los tipos generados — mismo cast que useAgentProfile y profileService.
 */
type PrefsRow = {
  full_name: string | null;
  profile_photo_url: string | null;
};

/** Forma de la fila que devuelve el query principal (cast explícito). */
type QueryRow = {
  id: string;
  price: number;
  address: string;
  property_type: PropertyDetail['property_type'];
  operation_type: PropertyDetail['operation_type'];
  bedrooms: number | null;
  bathrooms: number | null;
  square_meters: number | null;
  description: string | null;
  pet_friendly: boolean;
  allows_no_guarantor: boolean;
  student_friendly: boolean;
  amenities: PropertyDetail['amenities'];
  /** PostGIS — llega como EWKB hex string desde PostgREST; parse_location lo decodifica. */
  location: unknown;
  owner_user_id: string;
  agency_id: string | null;
  /** Embed via properties_owner_user_id_fkey. */
  users: { id: string; phone: string | null } | null;
  /** Embed via properties_agency_id_fkey (nullable FK → puede ser null). */
  agencies: { id: string; name: string; logo_url: string | null } | null;
  property_videos: Array<{
    id: string;
    storage_path: string | null;
    position: number;
    deleted_at: string | null;
  }>;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePropertyDetail(id: string): UsePropertyDetailResult {
  const [data, set_data] = useState<PropertyDetail | null>(null);
  const [isLoading, set_is_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);

  const load_property = useCallback(async () => {
    set_is_loading(true);
    set_error(null);

    try {
      // ── Paso 1: query principal ────────────────────────────────────────
      // Desambiguar FKs con hint !<constraint_name> — PostgREST exige esto
      // cuando hay más de una relación entre las mismas tablas.
      const { data: row, error: row_error } = (await supabase
        .from('properties')
        .select(
          `id, price, address, property_type, operation_type,
           bedrooms, bathrooms, square_meters, description,
           pet_friendly, allows_no_guarantor, student_friendly,
           amenities, location, owner_user_id, agency_id,
           users!properties_owner_user_id_fkey(id, phone),
           agencies!properties_agency_id_fkey(id, name, logo_url),
           property_videos(id, storage_path, position, deleted_at)`,
        )
        .eq('id', id)
        .eq('status', 'active')
        .is('deleted_at', null)
        .single()) as {
        data: QueryRow | null;
        error: { message: string } | null;
      };

      if (row_error) throw new Error(row_error.message);
      if (!row) throw new Error('Propiedad no encontrada');

      // ── Paso 2: paralelo — user_preferences + mint-video-url ──────────
      // ponytail: cast `as never` para columnas de migración 0015 no regeneradas;
      // mismo patrón que useAgentProfile.ts y profileService.ts.
      const prefs_query = supabase
        .from('user_preferences')
        .select('full_name, profile_photo_url' as never)
        .eq('user_id', row.owner_user_id)
        .maybeSingle();

      const ef_query = supabase.functions.invoke('mint-video-url', {
        body: { property_ids: [id] },
      });

      const [prefs_result, ef_result] = await Promise.all([prefs_query, ef_query]);

      const { data: raw_prefs, error: prefs_error } = prefs_result;
      // ponytail: ef_error no bloquea — sin signed_url el video no se reproduce
      // pero los datos de la propiedad siguen visibles (fail-soft).
      const { data: ef_data } = ef_result as {
        data: { videos: MintedVideo[] } | null;
        error: { message: string } | null;
      };

      if (prefs_error) throw new Error(prefs_error.message);

      const prefs = raw_prefs as PrefsRow | null;

      // Índice por property_id para lookup O(1)
      const minted_map = new Map<string, MintedVideo>();
      for (const v of ef_data?.videos ?? []) {
        minted_map.set(v.property_id, v);
      }
      const minted = minted_map.get(id);

      // Videos: filter client-side (deleted_at null) + sort by position
      const videos_raw = row.property_videos
        .filter((v) => v.deleted_at === null)
        .sort((a, b) => a.position - b.position);

      const videos: PropertyVideoDetail[] = videos_raw.map((v) => {
        const video: PropertyVideoDetail = {
          id: v.id,
          position: v.position,
          storage_path: v.storage_path,
        };
        // Asigna signed_url al video que coincide con el minted por la EF
        if (minted !== undefined && minted.video_id === v.id) {
          video.signed_url = localizeSignedUrl(minted.signed_url);
        }
        return video;
      });

      const agent_user = row.users;
      const raw_agency = row.agencies;

      set_data({
        id: row.id,
        price: row.price,
        property_type: row.property_type,
        operation_type: row.operation_type,
        bedrooms: row.bedrooms,
        bathrooms: row.bathrooms,
        square_meters: row.square_meters,
        address: row.address,
        description: row.description,
        pet_friendly: row.pet_friendly,
        allows_no_guarantor: row.allows_no_guarantor,
        student_friendly: row.student_friendly,
        amenities: row.amenities,
        // PostGIS llega como EWKB hex string (PostgREST); parse_location lo decodifica.
        // null si no está georreferenciada.
        location: typeof row.location === 'string' ? row.location : null,
        agent: {
          // Fallback a owner_user_id si el embed llega null (no debería en prod)
          id: agent_user?.id ?? row.owner_user_id,
          full_name: prefs?.full_name ?? null,
          profile_photo_url: prefs?.profile_photo_url ?? null,
          phone: agent_user?.phone ?? null,
        },
        agency:
          raw_agency !== null
            ? { id: raw_agency.id, name: raw_agency.name, logo_url: raw_agency.logo_url }
            : null,
        videos,
      });
    } catch (e) {
      set_error(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      set_is_loading(false);
    }
  }, [id]);

  useEffect(() => {
    void load_property();
  }, [load_property]);

  return { data, isLoading, error, refetch: load_property };
}
