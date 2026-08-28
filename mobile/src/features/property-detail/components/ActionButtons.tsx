/**
 * ActionButtons.tsx — Botones flotantes de like, save y reportar sobre el hero de video.
 *
 * Subtarea Taskmaster: 10.7 — GREEN phase (like/save). 220.5 añade "Reportar".
 *
 * Reutiliza SIN modificación:
 *   - useLikeProperty (feed/hooks) — like por property_video_id + property_id
 *   - useSaveProperty (feed/hooks) — save por property_id ÚNICO (schema 0006, sin video_id)
 *   - useReportProperty (property-detail/hooks, 220.5) — INSERT directo a property_reports
 *
 * Estilo: glass pill 46×46 px, borderRadius 23 — mismo patrón que PropertyOverlay.tsx.
 * ponytail: estilos glass copiados de PropertyOverlay.action_btn (rgba hardcoded).
 *
 * Reglas de visibilidad:
 *   - Like: SOLO cuando property_video_id !== null (likes.property_video_id es required).
 *   - Save: SIEMPRE presente (saves son por propiedad, sin relación de video).
 *   - Reportar: SOLO si se conoce owner_user_id Y la sesión NO es el owner
 *     (is_owner=false). El hook useReportProperty repite el guard como 2ª
 *     capa; owner_user_id/is_owner son opcionales para no romper callers
 *     existentes que aún no los pasan (el botón simplemente no aparece).
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Flag } from 'phosphor-react-native';

import { useLikeProperty } from '@/features/feed/hooks/useLikeProperty';
import { useSaveProperty } from '@/features/feed/hooks/useSaveProperty';
import { LikeButton } from '@/components/LikeButton';
import { SaveButton } from '@/components/SaveButton';
import { useReportProperty } from '../hooks/useReportProperty';
import { ReportPropertySheet } from './ReportPropertySheet';

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
  /**
   * owner_user_id de la propiedad (220.5) — habilita "Reportar". Sin él el
   * botón no se renderiza (evita invocar el hook con un owner_user_id vacío).
   */
  owner_user_id?: string;
  /** true si la sesión actual ES el owner — oculta "Reportar" (default false). */
  is_owner?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function ActionButtons({
  property_id,
  property_video_id,
  owner_user_id,
  is_owner = false,
}: ActionButtonsProps): React.JSX.Element {
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

  // El botón/sheet solo existen si hay owner_user_id conocido y no es la
  // sesión actual — el owner no puede reportar su propia publicación.
  // ReportAction (abajo) es un componente APARTE, montado condicionalmente:
  // así useReportProperty (que llama useAuth) nunca se invoca cuando no hace
  // falta — evita forzar un AuthProvider en callers que no reportan (p.ej.
  // ActionButtons.test.tsx, que no pasa owner_user_id).
  const can_report = owner_user_id !== undefined && !is_owner;

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

      {/* Reportar (220.5): ausente para el owner y cuando no se conoce owner_user_id */}
      {can_report && (
        <ReportAction property_id={property_id} owner_user_id={owner_user_id} />
      )}

    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ReportAction — botón "Reportar" + sheet + useReportProperty, aislados en su
// propio componente para que el hook (y su useAuth interno) solo se monte
// cuando can_report es true (ver comentario arriba).
// ─────────────────────────────────────────────────────────────────────────────

function ReportAction({
  property_id,
  owner_user_id,
}: {
  property_id: string;
  owner_user_id: string;
}): React.JSX.Element {
  const [sheet_visible, set_sheet_visible] = useState(false);
  const { submit_report, is_submitting, error_message } = useReportProperty({
    property_id,
    owner_user_id,
  });

  return (
    <>
      <Pressable
        onPress={() => set_sheet_visible(true)}
        style={styles.btn}
        accessibilityRole="button"
        accessibilityLabel="Reportar publicación"
      >
        <Flag size={20} color="#FFFFFF" weight="bold" />
      </Pressable>

      <ReportPropertySheet
        visible={sheet_visible}
        on_dismiss={() => set_sheet_visible(false)}
        on_submit={submit_report}
        is_submitting={is_submitting}
        error_message={error_message}
      />
    </>
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
