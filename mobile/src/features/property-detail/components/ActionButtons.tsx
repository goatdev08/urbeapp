/**
 * ActionButtons.tsx — Botones flotantes de like y save sobre el hero de video.
 *
 * Subtarea Taskmaster: 10.7 — GREEN phase.
 *
 * Reutiliza SIN modificación:
 *   - useLikeProperty (feed/hooks) — like por property_video_id + property_id
 *   - useSaveProperty (feed/hooks) — save por property_id ÚNICO (schema 0006, sin video_id)
 *
 * Estilo: glass pill 46×46 px, borderRadius 23 — mismo patrón que PropertyOverlay.tsx.
 * ponytail: estilos glass copiados de PropertyOverlay.action_btn (rgba hardcoded).
 *
 * Reglas de visibilidad:
 *   - Like: SOLO cuando property_video_id !== null (likes.property_video_id es required).
 *   - Save: SIEMPRE presente (saves son por propiedad, sin relación de video).
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useLikeProperty } from '@/features/feed/hooks/useLikeProperty';
import { useSaveProperty } from '@/features/feed/hooks/useSaveProperty';
import { LikeButton } from '@/components/LikeButton';
import { SaveButton } from '@/components/SaveButton';

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
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function ActionButtons({ property_id, property_video_id }: ActionButtonsProps): React.JSX.Element {
  // Hooks siempre llamados (reglas de hooks — no pueden ser condicionales).
  // Cuando no hay video se pasa '' como fallback; el botón like no se renderiza,
  // así que la llamada vacía no tiene efecto en la UI.
  const { isLiked, toggleLike } = useLikeProperty({
    property_video_id: property_video_id ?? '',
    property_id,
  });

  // ponytail: useSaveProperty recibe SOLO property_id —
  //   schema saves (migración 0006) no incluye property_video_id.
  const { isSaved, toggleSave } = useSaveProperty({
    property_id,
  });

  return (
    <View style={styles.container}>

      {/* Like: solo si hay video asociado a la propiedad */}
      {property_video_id !== null && (
        <LikeButton
          active={isLiked}
          onPress={toggleLike}
          style={styles.btn}
        />
      )}

      {/* Save: siempre presente (save es por propiedad, independiente de video) */}
      <SaveButton
        active={isSaved}
        onPress={toggleSave}
        style={styles.btn}
      />

    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 12,
  },
  // ponytail: glass pill 46×46 idéntico a PropertyOverlay.action_btn
  //   (rgba hardcoded del mockup .fbtn — no hay token en theme.ts todavía)
  btn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(23,20,15,0.36)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
