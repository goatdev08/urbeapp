/**
 * ProtectedLayout — stub mínimo fase RED (subtarea 2.5).
 *
 * Firma del componente que el GREEN implementará:
 *   - isLoading=true  → indicador de carga (ActivityIndicator testID='loading-indicator')
 *   - !session        → <Redirect href="/login" />
 *   - session         → <Slot /> (contenido protegido)
 *
 * El stub renderiza null (no implementado) para que los tests fallen por aserción
 * ("unable to find element with testID ..."), no por error de import.
 */
import React from 'react';

export default function ProtectedLayout(): React.ReactElement | null {
  // Stub: sin implementación real. El GREEN reemplaza esto con la lógica real.
  return null;
}
