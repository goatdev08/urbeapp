/**
 * Layout del grupo de rutas protegidas (Expo Router SDK 56).
 *
 * Thin wrapper: delega toda la lógica de guard a ProtectedLayout
 * (unit-testeable de forma aislada). Este archivo existe para satisfacer
 * el file-based routing de Expo Router — el grupo (protected) no afecta
 * la URL pública de las rutas que contiene.
 *
 * FilterProvider (#12.7) se monta aquí — por encima de las tabs (feed + mapa,
 * ambos dentro de (protected)/(tabs)) para que compartan un único FilterState.
 * LocationProvider (#41 Fase B) se monta al mismo nivel: TRAS el auth gate,
 * antes de feed/mapa que consumen la ubicación. Se monta UNA sola vez para todo
 * el grupo protegido → la coord queda cacheada por sesión (no se remonta por
 * pantalla). ProtectedLayoutWithLocation consume useLocation y renderiza el muro
 * bloqueante (LocationWall) en lugar del contenido cuando no hay ubicación real.
 * Regla uniforme: TODOS los roles (buscador, agente, owner, admin) pasan el muro,
 * sin ramas por rol.
 *
 * Orden de gates: auth gate (ProtectedLayout) → location gate → contenido (Slot).
 */
import ProtectedLayout from '@/features/auth/protected-layout';
import { FilterProvider } from '@/features/search/filterStore';
import { LocationProvider, useLocation } from '@/features/location/LocationProvider';
import { LocationWall } from '@/features/location/LocationWall';

function ProtectedLayoutWithLocation() {
  const { status } = useLocation();

  // Permiso negado → muro bloqueante.
  if (status === 'permission_denied') {
    return <LocationWall variant="permission_denied" />;
  }

  // Permiso concedido pero GPS del SO apagado → muro bloqueante con copy distinto.
  if (status === 'gps_off') {
    return <LocationWall variant="gps_off" />;
  }

  // 'loading' o 'granted' → continúa al contenido protegido (ProtectedLayout
  // maneja el loading del auth gate). La ventana 'loading' es un tick async.
  return <ProtectedLayout />;
}

export default function ProtectedLayoutWithFilters() {
  return (
    <FilterProvider>
      <LocationProvider>
        <ProtectedLayoutWithLocation />
      </LocationProvider>
    </FilterProvider>
  );
}
