/**
 * ProfessionalStats — fila de estadísticas del agente (a la derecha del avatar).
 *
 * 3 columnas iguales. Recibe los counts ya resueltos por useAgentStats
 * (subtarea 23.1) + follower_count (vista agent_public_profiles) — este
 * componente es puro, no hace fetching.
 *
 * ⚠️ 78.4 — las columnas dejan de depender de is_own_profile: propio Y ajeno
 * muestran las MISMAS 3 (Publicaciones · Seguidores · Me gusta). "Guardados"
 * sale del todo (decisión de Abraham, intake UI-b de la tarea #78 «follow de
 * cuentas F1»): "Seguidores" es la señal de prueba social que reemplaza tanto
 * a Guardados (propio) como al hueco de la 2ª columna (ajeno, que antes solo
 * tenía 2). Con las columnas ya idénticas, `is_own_profile` SALIÓ de las
 * props (no le quedaba ningún uso aquí) — ProfileHeader ya no la reenvía.
 *
 * ⚠️ 179.3 (histórico) — dejó de ser un "sheet" con sombra centrado bajo la
 * bio: vive en la fila del avatar (layout de Instagram), sin fondo ni bordes;
 * ya NO se oculta cuando todo está en 0 (Instagram también muestra 0s).
 *
 * Referencia visual: urbea-identidad-visual.html ~L1146 (.profstats) +
 * composición de perfil de Instagram (Abraham, 2026-08-16).
 *
 * Subtarea 23.2 · 179.3 · 78.4.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, spacing } from '@/theme/theme';
import type { AgentStats } from '../hooks/useAgentStats';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface ProfessionalStatsProps {
  stats: AgentStats | null;
  loading: boolean;
  /** Conteo de seguidores (agent_public_profiles.follower_count, tarea #78). */
  follower_count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Columnas
// ─────────────────────────────────────────────────────────────────────────────

/** Mismas 3 columnas para propio y ajeno (78.4): Publicaciones · Seguidores · Me gusta. */
const COLUMNS = [
  { key: 'publications', label: 'Publicaciones' },
  { key: 'followers',    label: 'Seguidores' },
  { key: 'likes',        label: 'Me gusta' },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function ProfessionalStats({ stats, loading, follower_count }: ProfessionalStatsProps) {
  return (
    <View style={styles.row}>
      {COLUMNS.map((column) => {
        const value =
          column.key === 'followers'
            ? follower_count
            : loading || stats === null
              ? null
              : stats[column.key];

        return (
          <View key={column.key} style={styles.column}>
            <Text style={styles.number} numberOfLines={1}>
              {value === null ? '—' : String(value)}
            </Text>
            {/* En Android de 360dp cada columna mide ~80px: "Publicaciones" se
                encoge en vez de partirse en dos líneas y desalinear la fila. */}
            <Text
              style={styles.label}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {column.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  column: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.s_4,
  },
  number: {
    fontFamily: fonts.display,
    fontSize: 19,
    lineHeight: 24,
    color: colors.ink,
  },
  label: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: colors.gray_2,
    textAlign: 'center',
  },
});
