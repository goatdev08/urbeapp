/**
 * PropertyDetailRoute — ruta dinámica /property/[id].
 *
 * Bajo el grupo (protected): requiere autenticación (para like/save en 10.7).
 * El grupo no afecta la URL pública — se accede como /property/[uuid].
 *
 * Delega todo el layout a PropertyDetailScreen (subtarea 10.3).
 * El placeholder de 10.1 (JSON dump) fue reemplazado aquí.
 */

import { PropertyDetailScreen } from '@/features/property-detail/PropertyDetailScreen';

export default PropertyDetailScreen;
