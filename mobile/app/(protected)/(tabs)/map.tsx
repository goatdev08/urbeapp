/**
 * (tabs)/map.tsx — Tab "Mapa" (mapa global de propiedades).
 *
 * Solo delega a MapScreen; la lógica vive en features/map/ siguiendo
 * la convención del repo (rutas finas, feature fat).
 */

import { MapScreen } from '@/features/map/MapScreen';

export default function MapTab() {
  return <MapScreen />;
}
