/**
 * Tests smoke — LocationProvider (mobile/src/features/location/LocationProvider.tsx)
 * Subtarea Taskmaster: 41.3 — crítica de facto (orquesta lógica de 3 estados)
 *
 * NOTA API: @testing-library/react-native v14 usa `await renderHook(...)` / `await waitFor(...)`.
 * NOTA JEST: jest.fn() se define DENTRO del factory de jest.mock para evitar hoisting.
 *
 * SUT real: se ejercita el LocationProvider/useLocation reales. Solo se mockea el
 * módulo nativo `expo-location` — NUNCA el SUT.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Resolución desde 'loading' a los 3 estados terminales
 * - EC-1: permiso NO concedido (canAskAgain true o false) → status='permission_denied', coords null.
 *         NO debe consultar hasServicesEnabledAsync ni getCurrentPositionAsync.
 * - EC-2: permiso concedido + hasServicesEnabledAsync=false → status='gps_off', coords null.
 *         NO debe consultar getCurrentPositionAsync (GPS del SO apagado ≠ permiso negado).
 * - EC-3: permiso concedido + hasServicesEnabledAsync=true + getCurrentPositionAsync devuelve
 *         coords → status='granted', coords correctas. Se llama con { accuracy: Accuracy.Balanced }.
 *
 * ### request()
 * - EC-4: request() llama requestForegroundPermissionsAsync y re-evalúa el flujo completo
 *         (si el usuario concede, termina en 'granted' con coords).
 *
 * ### refresh()
 * - EC-5: refresh() re-fetchea la coord (getCurrentPositionAsync se vuelve a llamar) SIN
 *         llamar requestForegroundPermissionsAsync (no re-pide permiso).
 *
 * ### Coord cacheada por sesión
 * - EC-6: getCurrentPositionAsync se llama exactamente 1 vez tras el mount (no en cada
 *         render/apertura) cuando el permiso ya está concedido.
 *
 * ### Guard
 * - EC-7: useLocation() fuera de LocationProvider lanza un error claro.
 *
 * ### Fix de robustez (bug cazado en smoke 41.6)
 * - EC-8: permiso concedido + servicios "on" pero getCurrentPositionAsync LANZA
 *         ("Current location is unavailable", típico en emulador sin fix) → status='gps_off',
 *         coords null, SIN rechazo de promesa sin capturar (no crashea la app).
 */

import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import * as Location from 'expo-location';

// Importamos el SUT DESPUÉS del mock (jest.mock más abajo se hoistea igual)
import { LocationProvider, useLocation } from '../LocationProvider';

// ---------------------------------------------------------------------------
// Mock de expo-location — jest.fn() DENTRO del factory para evitar hoisting
// ---------------------------------------------------------------------------
jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  hasServicesEnabledAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

const mock_get_foreground = Location.getForegroundPermissionsAsync as jest.Mock;
const mock_request_foreground = Location.requestForegroundPermissionsAsync as jest.Mock;
const mock_has_services = Location.hasServicesEnabledAsync as jest.Mock;
const mock_get_current_position = Location.getCurrentPositionAsync as jest.Mock;

function make_position(latitude = 20.6597, longitude = -103.3496) {
  return {
    coords: {
      latitude,
      longitude,
      altitude: null,
      accuracy: 5,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: Date.now(),
  };
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LocationProvider>{children}</LocationProvider>
);

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// EC-1: permiso NO concedido → 'permission_denied', coords null
// ===========================================================================
describe('EC-1: permiso_no_concedido_resuelve_permission_denied', () => {
  it('canAskAgain=true → status=permission_denied, coords=null, no consulta GPS ni posición', async () => {
    mock_get_foreground.mockResolvedValue({ granted: false, canAskAgain: true });

    const { result } = await renderHook(() => useLocation(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('permission_denied'));

    expect(result.current.coords).toBeNull();
    expect(mock_has_services).not.toHaveBeenCalled();
    expect(mock_get_current_position).not.toHaveBeenCalled();
  });

  it('canAskAgain=false (bloqueado por el SO) → status=permission_denied, coords=null', async () => {
    mock_get_foreground.mockResolvedValue({ granted: false, canAskAgain: false });

    const { result } = await renderHook(() => useLocation(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('permission_denied'));
    expect(result.current.coords).toBeNull();
  });
});

// ===========================================================================
// EC-2: permiso concedido + GPS apagado → 'gps_off', coords null
// ===========================================================================
describe('EC-2: gps_apagado_resuelve_gps_off', () => {
  it('granted + hasServicesEnabledAsync=false → status=gps_off, coords=null, no pide posición', async () => {
    mock_get_foreground.mockResolvedValue({ granted: true, canAskAgain: true });
    mock_has_services.mockResolvedValue(false);

    const { result } = await renderHook(() => useLocation(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('gps_off'));

    expect(result.current.coords).toBeNull();
    expect(mock_get_current_position).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// EC-3: permiso concedido + GPS activo → 'granted', coords correctas
// ===========================================================================
describe('EC-3: permiso_y_gps_activos_resuelve_granted_con_coords', () => {
  it('granted + hasServicesEnabledAsync=true + getCurrentPositionAsync → status=granted, coords', async () => {
    mock_get_foreground.mockResolvedValue({ granted: true, canAskAgain: true });
    mock_has_services.mockResolvedValue(true);
    mock_get_current_position.mockResolvedValue(make_position(19.4326, -99.1332));

    const { result } = await renderHook(() => useLocation(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('granted'));

    expect(result.current.coords).toEqual({ latitude: 19.4326, longitude: -99.1332 });
    expect(mock_get_current_position).toHaveBeenCalledWith({ accuracy: Location.Accuracy.Balanced });
  });
});

// ===========================================================================
// EC-4: request() pide permiso y re-evalúa el flujo completo
// ===========================================================================
describe('EC-4: request_pide_permiso_y_reevalua', () => {
  it('request() llama requestForegroundPermissionsAsync y termina en granted si el usuario concede', async () => {
    mock_get_foreground.mockResolvedValue({ granted: false, canAskAgain: true });

    const { result } = await renderHook(() => useLocation(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('permission_denied'));

    mock_request_foreground.mockResolvedValue({ granted: true, canAskAgain: true });
    mock_has_services.mockResolvedValue(true);
    mock_get_current_position.mockResolvedValue(make_position());

    await act(async () => {
      await result.current.request();
    });

    await waitFor(() => expect(result.current.status).toBe('granted'));
    expect(mock_request_foreground).toHaveBeenCalledTimes(1);
    expect(result.current.coords).not.toBeNull();
  });
});

// ===========================================================================
// EC-5: refresh() re-fetchea la coord SIN volver a pedir permiso
// ===========================================================================
describe('EC-5: refresh_refetchea_coord_sin_pedir_permiso', () => {
  it('refresh() llama getCurrentPositionAsync de nuevo pero NO requestForegroundPermissionsAsync', async () => {
    mock_get_foreground.mockResolvedValue({ granted: true, canAskAgain: true });
    mock_has_services.mockResolvedValue(true);
    mock_get_current_position.mockResolvedValue(make_position(10, 10));

    const { result } = await renderHook(() => useLocation(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('granted'));

    mock_get_current_position.mockResolvedValue(make_position(20, 20));

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => expect(result.current.coords).toEqual({ latitude: 20, longitude: 20 }));
    expect(mock_request_foreground).not.toHaveBeenCalled();
    expect(mock_get_current_position).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// EC-6: coord cacheada — getCurrentPositionAsync solo 1 vez tras el mount
// ===========================================================================
describe('EC-6: coord_cacheada_no_refetch_automatico', () => {
  it('getCurrentPositionAsync se llama exactamente 1 vez tras resolver granted (sin refetch en re-render)', async () => {
    mock_get_foreground.mockResolvedValue({ granted: true, canAskAgain: true });
    mock_has_services.mockResolvedValue(true);
    mock_get_current_position.mockResolvedValue(make_position());

    const { result, rerender } = await renderHook(() => useLocation(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('granted'));

    rerender({ children: null } as never);

    expect(mock_get_current_position).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// EC-7: Guard — useLocation() fuera de LocationProvider lanza error claro
// ===========================================================================
describe('EC-7: useLocation_fuera_de_provider_lanza_error', () => {
  it('useLocation() sin LocationProvider lanza un error descriptivo', async () => {
    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    let caught_error: unknown = null;
    try {
      await renderHook(() => useLocation());
    } catch (e) {
      caught_error = e;
    }

    expect(caught_error).not.toBe(null);
    expect((caught_error as Error).message).toMatch(/LocationProvider|location.*context|fuera.*provider/i);

    console_error_spy.mockRestore();
  });
});

// ===========================================================================
// EC-8: getCurrentPositionAsync LANZA → 'gps_off' sin crash (fix smoke 41.6)
// ===========================================================================
describe('EC-8: getCurrentPosition_lanza_cae_a_gps_off_sin_crash', () => {
  it('granted + servicios on pero getCurrentPositionAsync rechaza → status=gps_off, coords=null', async () => {
    mock_get_foreground.mockResolvedValue({ granted: true, canAskAgain: true });
    mock_has_services.mockResolvedValue(true);
    mock_get_current_position.mockRejectedValue(
      new Error('Current location is unavailable. Make sure that location services are enabled'),
    );

    const { result } = await renderHook(() => useLocation(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe('gps_off'));
    expect(result.current.coords).toBeNull();
  });

  it('tras el fallo, refresh() con getCurrentPositionAsync ya disponible recupera a granted', async () => {
    mock_get_foreground.mockResolvedValue({ granted: true, canAskAgain: true });
    mock_has_services.mockResolvedValue(true);
    mock_get_current_position.mockRejectedValue(new Error('Current location is unavailable'));

    const { result } = await renderHook(() => useLocation(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('gps_off'));

    // El SO ya tiene un fix: refresh() debe recuperar sin re-pedir permiso.
    mock_get_current_position.mockResolvedValue(make_position(20.6597, -103.3496));
    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => expect(result.current.status).toBe('granted'));
    expect(result.current.coords).toEqual({ latitude: 20.6597, longitude: -103.3496 });
    expect(mock_request_foreground).not.toHaveBeenCalled();
  });
});
