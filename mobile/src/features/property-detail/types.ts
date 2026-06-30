/**
 * types.ts — Tipos del feature property-detail.
 *
 * PropertyDetail: propiedad con datos completos para la pantalla de detalle.
 * Incluye agente (identidad desde user_preferences, migración 0015),
 * agencia (nullable, via agency_id de la propiedad), y videos con signed_url opcional.
 *
 * ponytail: enums y amenities typed vía DB row — sin redefinir tipos localmente.
 * location llega como WKT string desde PostgREST — se parsea en subtarea 10.5.
 */

import type { Database } from '@/types/database';

type DBPropertyRow = Database['public']['Tables']['properties']['Row'];

// ---------------------------------------------------------------------------
// Sub-tipos
// ---------------------------------------------------------------------------

export type AgentInfo = {
  id: string;
  /** full_name viene de user_preferences (migración 0015); puede ser null. */
  full_name: string | null;
  /** profile_photo_url viene de user_preferences (migración 0015); puede ser null. */
  profile_photo_url: string | null;
  phone: string | null;
};

export type AgencyInfo = {
  id: string;
  name: string;
  logo_url: string | null;
};

export type PropertyVideoDetail = {
  id: string;
  position: number;
  /** storage_path puede ser null en la DB (video aún processing). */
  storage_path: string | null;
  /**
   * signed_url: presente solo tras llamar a mint-video-url EF.
   * En la demo el storage_path directo está roto (#21), por eso se usa el minter.
   */
  signed_url?: string;
};

// ---------------------------------------------------------------------------
// Tipo principal
// ---------------------------------------------------------------------------

export type PropertyDetail = {
  id: string;
  price: number;
  property_type: DBPropertyRow['property_type'];
  operation_type: DBPropertyRow['operation_type'];
  bedrooms: number | null;
  bathrooms: number | null;
  square_meters: number | null;
  address: string;
  description: string | null;
  pet_friendly: boolean;
  allows_no_guarantor: boolean;
  student_friendly: boolean;
  /** amenities: blob JSON — estructura interna definida por el proveedor de datos. */
  amenities: DBPropertyRow['amenities'];
  /**
   * location: campo PostGIS devuelto por PostgREST como WKT "POINT(lng lat)".
   * null si la propiedad no tiene ubicación georreferenciada.
   * Parseo → subtarea 10.5.
   */
  location: string | null;
  agent: AgentInfo;
  agency: AgencyInfo | null;
  videos: PropertyVideoDetail[];
};
