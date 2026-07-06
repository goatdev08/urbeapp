/**
 * LocationProvider — Context + Provider + hook para la ubicación del usuario (subtarea 41.3).
 *
 * Patrón: igual que features/auth/context.tsx (is_mounted ref) y
 *   features/search/filterStore.tsx (Context con undefined default + guard).
 *
 * Contrato: 3 estados terminales + 'loading' inicial.
 *   - 'permission_denied' — el usuario no concedió el permiso de ubicación foreground.
 *   - 'gps_off'            — permiso concedido, pero el GPS/servicios de ubicación del
 *                            SO están apagados (hasServicesEnabledAsync === false).
 *   - 'granted'            — permiso concedido + servicios activos → coords disponibles.
 *
 * La decisión de permiso (granted/request/open_settings) SE DELEGA a
 * decide_permission_action (41.2) — este Provider no duplica esa lógica; solo la usa
 * para decidir si debe intentar leer la coordenada o quedarse en 'permission_denied'.
 *
 * Coord CACHEADA por sesión: getCurrentPositionAsync solo se llama en mount, en
 * request() (si el permiso queda concedido) y en refresh() — nunca en cada apertura
 * de pantalla ni en cada render.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';

import { decide_permission_action } from './lib/permissionDecision';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type LocationStatus = 'loading' | 'permission_denied' | 'gps_off' | 'granted';

export interface LocationCoords {
  latitude: number;
  longitude: number;
}

export interface LocationContextValue {
  status: LocationStatus;
  coords: LocationCoords | null;
  /** Dispara requestForegroundPermissionsAsync y re-evalúa el flujo completo. */
  request: () => Promise<void>;
  /** Re-fetch explícito de la coordenada. NO re-pide permiso. */
  refresh: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context — undefined como default activa el guard del hook
// ---------------------------------------------------------------------------

const LocationContext = createContext<LocationContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Helper: lee la coordenada actual con precisión Balanced (batería, exploración 027).
// ---------------------------------------------------------------------------

async function fetch_current_coords(): Promise<LocationCoords> {
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { latitude: position.coords.latitude, longitude: position.coords.longitude };
}

// ---------------------------------------------------------------------------
// LocationProvider
// ---------------------------------------------------------------------------

export function LocationProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [status, set_status] = useState<LocationStatus>('loading');
  const [coords, set_coords] = useState<LocationCoords | null>(null);

  // Ref para evitar setear estado tras desmontaje (patrón auth/context.tsx)
  const is_mounted = useRef(true);

  // Evalúa el flujo permiso → GPS → coord a partir de un permission response ya leído.
  // NO vuelve a pedir permiso — solo decide qué hacer con el que ya se tiene.
  const evaluate_from_permission = useCallback(
    async (permission: { granted: boolean; canAskAgain: boolean }) => {
      const action = decide_permission_action(permission);

      if (action !== 'granted') {
        // 'request' u 'open_settings' — sin permiso concedido, no hay coord.
        if (!is_mounted.current) return;
        set_status('permission_denied');
        set_coords(null);
        return;
      }

      const services_enabled = await Location.hasServicesEnabledAsync();
      if (!is_mounted.current) return;

      if (!services_enabled) {
        set_status('gps_off');
        set_coords(null);
        return;
      }

      const next_coords = await fetch_current_coords();
      if (!is_mounted.current) return;
      set_status('granted');
      set_coords(next_coords);
    },
    [],
  );

  useEffect(() => {
    is_mounted.current = true;

    const initialize = async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (!is_mounted.current) return;
      await evaluate_from_permission(permission);
    };

    initialize();

    return () => {
      is_mounted.current = false;
    };
  }, [evaluate_from_permission]);

  const request = useCallback(async (): Promise<void> => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!is_mounted.current) return;
    await evaluate_from_permission(permission);
  }, [evaluate_from_permission]);

  const refresh = useCallback(async (): Promise<void> => {
    // Re-fetch explícito SIN re-pedir permiso: relee el permiso actual (para
    // detectar si el usuario apagó el GPS o revocó el permiso desde Ajustes)
    // pero nunca dispara el diálogo del SO.
    const permission = await Location.getForegroundPermissionsAsync();
    if (!is_mounted.current) return;
    await evaluate_from_permission(permission);
  }, [evaluate_from_permission]);

  const value: LocationContextValue = { status, coords, request, refresh };

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

// ---------------------------------------------------------------------------
// useLocation — guard: lanza si se usa fuera de LocationProvider
// ---------------------------------------------------------------------------

export function useLocation(): LocationContextValue {
  const ctx = useContext(LocationContext);
  if (ctx === undefined) {
    throw new Error('useLocation must be used within a LocationProvider');
  }
  return ctx;
}
