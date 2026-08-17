/**
 * ProfessionalStats — fila de estadísticas del agente (a la derecha del avatar).
 *
 * 3 columnas iguales. Recibe los counts ya resueltos por useAgentStats
 * (subtarea 23.1) — este componente es puro, no hace fetching.
 *
 * ⚠️ 179.3 — tres cambios de fondo respecto a 23.2:
 *   1. Deja de ser un "sheet" con sombra centrado bajo la bio: ahora vive en la
 *      fila del avatar (layout de Instagram), sin fondo ni bordes.
 *   2. Las columnas dependen de QUIÉN mira (is_own_profile):
 *        propio → Publicaciones · Guardados · Me gusta
 *        ajeno  → Publicaciones · Me gusta
 *      ⚠️ 180.3: "Leads" salió de AMBOS — es un dato de gestión que se consulta
 *      en el CRM y solo el dueño de la cuenta; `useAgentStats` ya ni lo pide.
 *      El perfil ajeno tampoco muestra "Guardados": hacia afuera la señal
 *      pública es cuánto gusta el catálogo, no cuánta gente lo archivó.
 *   3. Ya NO se oculta cuando todo está en 0 — con la fila desaparecida el
 *      avatar quedaba solo en una fila a medias. Instagram también muestra 0s.
 *
 * Referencia visual: urbea-identidad-visual.html ~L1146 (.profstats) +
 * composición de perfil de Instagram (Abraham, 2026-08-16).
 *
 * Subtarea 23.2 · 179.3.
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
  /** Elige el juego de columnas: con Leads (propio) o sin él (ajeno). */
  is_own_profile: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Columnas
// ─────────────────────────────────────────────────────────────────────────────

interface StatColumn {
  key: keyof AgentStats;
  label: string;
}

/** Perfil propio: incluye los guardados, señal útil solo para el dueño. */
const OWN_COLUMNS: StatColumn[] = [
  { key: 'publications', label: 'Publicaciones' },
  { key: 'saves',        label: 'Guardados' },
  { key: 'likes',        label: 'Me gusta' },
];

/** Perfil ajeno: solo prueba social pública (180.3). */
const PUBLIC_COLUMNS: StatColumn[] = [
  { key: 'publications', label: 'Publicaciones' },
  { key: 'likes',        label: 'Me gusta' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function ProfessionalStats({ stats, loading, is_own_profile }: ProfessionalStatsProps) {
  const columns = is_own_profile ? OWN_COLUMNS : PUBLIC_COLUMNS;

  return (
    <View style={styles.row}>
      {columns.map((column) => (
        <View key={column.key} style={styles.column}>
          <Text style={styles.number} numberOfLines={1}>
            {loading || stats === null ? '—' : String(stats[column.key])}
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
      ))}
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
