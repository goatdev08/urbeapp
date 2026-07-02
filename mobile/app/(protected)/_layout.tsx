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
 * Envolver todo lo protegido (perfil, publish, property, crm) es inocuo: el
 * Context no hace nada hasta que algo llama useFilters().
 */
import ProtectedLayout from '@/features/auth/protected-layout';
import { FilterProvider } from '@/features/search/filterStore';

export default function ProtectedLayoutWithFilters() {
  return (
    <FilterProvider>
      <ProtectedLayout />
    </FilterProvider>
  );
}
