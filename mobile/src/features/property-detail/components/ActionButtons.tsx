/**
 * ActionButtons.tsx — Botones flotantes de like y save sobre el hero de video.
 *
 * Subtarea Taskmaster: 10.7 — like/save/skeleton/error states (pantalla detalle).
 *
 * Reutiliza sin modificación:
 *   - useLikeProperty (feature/feed/hooks) — like por property_video_id + property_id
 *   - useSaveProperty (feature/feed/hooks) — save por property_id (sin video_id, schema 0006)
 *
 * Estilo: glass pill 46x46 px, borderRadius 23 — mismo patrón que PropertyOverlay.tsx.
 * Active: icon color accent_soft (#C2A07C); inactivo: blanco (#FFFFFF).
 *
 * Props:
 *   property_id        — id de la propiedad (para like + save)
 *   property_video_id  — id del primer video (para like); null si la propiedad no tiene videos
 *
 * STUB MÍNIMO — fase RED (test-author 10.7).
 * No implementa lógica real. Los tests fallan por aserción contra este stub.
 * Implementación GREEN: agente `mobile`.
 */

import React from 'react';
import { View } from 'react-native';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type ActionButtonsProps = {
  /** ID de la propiedad — necesario para useSaveProperty y para useLikeProperty. */
  property_id: string;
  /**
   * ID del primer video — necesario para useLikeProperty (likes.property_video_id).
   * null cuando la propiedad no tiene videos; en ese caso el botón de like se omite.
   */
  property_video_id: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Componente (stub)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stub vacío — renderiza un View sin contenido ni lógica.
 * Los tests (fase RED) fallan porque:
 *   - No se renderizan botones con accessibilityLabel → queryByLabelText devuelve null.
 *   - useLikeProperty / useSaveProperty no se invocan → aserciones toHaveBeenCalledWith fallan.
 *   - toggleLike / toggleSave nunca se llaman → aserciones toHaveBeenCalledTimes fallan.
 */
export function ActionButtons(_props: ActionButtonsProps): React.JSX.Element {
  // ponytail: stub vacío — reemplazar en GREEN con botones glass + hooks conectados.
  return <View testID="action-buttons-stub" />;
}
