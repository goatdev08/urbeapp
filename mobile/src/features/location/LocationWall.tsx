/**
 * LocationWall — muro bloqueante de pantalla completa para el permiso de ubicación (subtarea 41.4).
 *
 * Acabado FUNCIONAL con tokens de theme.ts + PrimaryButton — NO es pantalla de firma
 * ilustrada → NO dispara el gate de branding #19 (confirmado con el cliente, exploración 027).
 *
 * GUÍA, no solo pide. El muro anterior tenía un botón que "te mandaba a Ajustes sin
 * decirte qué hacer". Este resuelve los 3 escenarios reales con copy + PASOS numerados:
 *
 *   1. 'ask'      — permiso aún preguntable (canAskAgain) → botón dispara el diálogo del SO.
 *                   Hint corto: "elige Permitir cuando el sistema te pregunte".
 *   2. 'settings' — permiso bloqueado (!canAskAgain) → el diálogo ya no aparece; hay que
 *                   activarlo a mano en Ajustes → PASOS numerados (Permisos › Ubicación › Permitir › volver).
 *   3. 'gps_off'  — permiso OK pero el GPS del SO apagado → en Android se enciende INLINE con
 *                   enableNetworkProviderAsync (sin salir de la app); iOS/fallback → PASOS.
 *
 * En los 3 casos, botón secundario "Ya la activé — Reintentar" (refresh() sin re-pedir permiso):
 * el usuario nunca queda atascado tras volver de Ajustes. El AppState listener del Provider ya
 * re-evalúa al volver al foreground; este botón es el respaldo explícito y visible.
 *
 * UX uniforme iOS + Android salvo el atajo inline de Android para 'gps_off'. Bloqueante: se
 * renderiza en lugar del contenido protegido hasta que haya ubicación real (gate en
 * (protected)/_layout.tsx, 41.5).
 */
import React, { useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { MapPin } from 'phosphor-react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { theme } from '@/theme/theme';

import { useLocation } from './LocationProvider';

export interface LocationWallProps {
  variant: 'permission_denied' | 'gps_off';
}

// Modo de guía derivado del variant + el estado real del permiso.
//   - 'ask'      → aún se puede mostrar el diálogo del SO.
//   - 'settings' → el SO bloqueó el diálogo; hay que ir a Ajustes a mano.
//   - 'gps_off'  → permiso OK pero servicios de ubicación apagados.
type WallMode = 'ask' | 'settings' | 'gps_off';

interface ModeCopy {
  title: string;
  body: string;
  cta: string;
  /** Hint de una línea (modo 'ask') — el diálogo aparecerá solo. */
  hint?: string;
  /** Pasos numerados (modos que mandan a Ajustes) — qué togglear y volver. */
  steps?: string[];
}

const COPY: Record<WallMode, ModeCopy> = {
  ask: {
    title: 'Activa tu ubicación',
    body: 'Urbea te muestra las propiedades más cercanas a ti. Para empezar, necesitamos acceso a tu ubicación.',
    cta: 'Permitir ubicación',
    hint: 'Elige “Permitir” cuando tu teléfono te lo pregunte.',
  },
  settings: {
    title: 'Actívala desde Ajustes',
    body: 'El permiso de ubicación está desactivado, así que ya no podemos pedírtelo desde aquí. Actívalo en unos segundos:',
    cta: 'Abrir Ajustes',
    steps: [
      'Toca “Abrir Ajustes”.',
      'Entra a Permisos › Ubicación.',
      'Elige “Permitir”.',
      'Vuelve a Urbea y toca “Ya la activé”.',
    ],
  },
  gps_off: {
    title: 'Enciende la ubicación',
    body: 'El GPS de tu teléfono está apagado. Enciéndelo para mostrarte propiedades cerca de ti.',
    cta: Platform.OS === 'android' ? 'Encender ubicación' : 'Abrir Ajustes',
    // En Android el botón enciende el GPS inline (sin pasos); en iOS guía a Ajustes.
    ...(Platform.OS === 'android'
      ? {}
      : {
          steps: [
            'Abre los Ajustes de tu teléfono.',
            'Activa “Localización” / “Ubicación”.',
            'Vuelve a Urbea y toca “Ya la activé”.',
          ],
        }),
  },
};

export function LocationWall({ variant }: LocationWallProps): React.ReactElement {
  const { request, refresh } = useLocation();

  // Sub-modo del permiso, resuelto async: 'ask' si el SO aún deja preguntar,
  // 'settings' si ya lo bloqueó. Solo aplica cuando variant='permission_denied'.
  const [perm_mode, set_perm_mode] = useState<'ask' | 'settings'>('ask');
  const [busy, set_busy] = useState(false);

  // El modo mostrado se DERIVA del variant (gps_off es fijo) — sin setState en effect.
  const mode: WallMode = variant === 'gps_off' ? 'gps_off' : perm_mode;

  // Al montar con variant de permiso, lee canAskAgain para elegir 'ask' vs 'settings'.
  useEffect(() => {
    if (variant === 'gps_off') return;
    let alive = true;
    void Location.getForegroundPermissionsAsync().then((perm) => {
      if (alive) set_perm_mode(perm.canAskAgain ? 'ask' : 'settings');
    });
    return () => {
      alive = false;
    };
  }, [variant]);

  const copy = COPY[mode];

  // Acción primaria — despacha según el modo. Cierra con set_busy(false) siempre;
  // si la acción resuelve el gate, el Provider desmonta el muro antes (no pasa nada).
  const handle_primary = async (): Promise<void> => {
    set_busy(true);
    try {
      if (mode === 'ask') {
        await request();
        // Si el usuario negó y el SO ya no deja preguntar, pasa a modo Ajustes
        // (si concedió, el Provider desmonta el muro y esto ya no importa).
        const perm = await Location.getForegroundPermissionsAsync();
        set_perm_mode(perm.canAskAgain ? 'ask' : 'settings');
        return;
      }

      if (mode === 'gps_off' && Platform.OS === 'android') {
        // Android: enciende los servicios de ubicación con el diálogo nativo,
        // sin sacar al usuario de la app. Si falla o no está disponible → Ajustes.
        try {
          await Location.enableNetworkProviderAsync();
          await refresh();
        } catch {
          await Linking.openSettings();
        }
        return;
      }

      // 'settings' o 'gps_off' en iOS → Ajustes del sistema.
      await Linking.openSettings();
    } finally {
      set_busy(false);
    }
  };

  // Reintento explícito tras volver de Ajustes — relee permiso + servicios SIN
  // re-pedir el diálogo. El respaldo visible al AppState listener del Provider.
  const handle_retry = async (): Promise<void> => {
    set_busy(true);
    try {
      await refresh();
    } finally {
      set_busy(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.icon_ring}>
        <MapPin size={40} color={theme.colors.primary} weight="fill" />
      </View>

      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.body}>{copy.body}</Text>

      {copy.steps ? (
        <View style={styles.steps}>
          {copy.steps.map((step, i) => (
            <View key={step} style={styles.step_row}>
              <View style={styles.step_badge}>
                <Text style={styles.step_num}>{i + 1}</Text>
              </View>
              <Text style={styles.step_text}>{step}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {copy.hint ? <Text style={styles.hint}>{copy.hint}</Text> : null}

      <View style={styles.actions}>
        <PrimaryButton label={copy.cta} onPress={handle_primary} loading={busy} surface="light" />
        <PrimaryButton
          label="Ya la activé — Reintentar"
          onPress={handle_retry}
          variant="ghost"
          surface="light"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.paper,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.s_24,
  },
  icon_ring: {
    width: 88,
    height: 88,
    borderRadius: theme.radii.r_pill,
    backgroundColor: theme.colors.primary_tint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.s_24,
  },
  title: {
    ...theme.type_scale.h1,
    color: theme.colors.ink,
    marginBottom: theme.spacing.s_12,
    textAlign: 'center',
  },
  body: {
    ...theme.type_scale.body,
    color: theme.colors.gray_3,
    marginBottom: theme.spacing.s_24,
    textAlign: 'center',
  },
  steps: {
    alignSelf: 'stretch',
    backgroundColor: theme.colors.paper_2,
    borderRadius: theme.radii.r_16,
    paddingVertical: theme.spacing.s_16,
    paddingHorizontal: theme.spacing.s_16,
    marginBottom: theme.spacing.s_24,
    gap: theme.spacing.s_12,
  },
  step_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.s_12,
  },
  step_badge: {
    width: 24,
    height: 24,
    borderRadius: theme.radii.r_pill,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  step_num: {
    ...theme.type_scale.body,
    fontSize: 13,
    lineHeight: 16,
    color: theme.colors.on_primary,
    fontWeight: '700',
  },
  step_text: {
    ...theme.type_scale.body,
    flex: 1,
    color: theme.colors.ink,
  },
  hint: {
    ...theme.type_scale.body,
    color: theme.colors.gray_2,
    textAlign: 'center',
    marginBottom: theme.spacing.s_24,
  },
  actions: {
    alignSelf: 'stretch',
    gap: theme.spacing.s_12,
  },
});
