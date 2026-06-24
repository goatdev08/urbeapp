/**
 * Layout del grupo de rutas protegidas (Expo Router SDK 56).
 *
 * Thin wrapper: delega toda la lógica de guard a ProtectedLayout
 * (unit-testeable de forma aislada). Este archivo existe para satisfacer
 * el file-based routing de Expo Router — el grupo (protected) no afecta
 * la URL pública de las rutas que contiene.
 */
import ProtectedLayout from '@/features/auth/protected-layout';

export default ProtectedLayout;
