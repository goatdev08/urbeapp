/**
 * ProfessionalStats — fila de estadísticas del agente (profstats sheet).
 *
 * 3 columnas iguales con divider: Publicaciones / Leads / Cerrados.
 * Recibe los counts ya resueltos por useAgentStats (subtarea 23.1) — este
 * componente es puro, no hace fetching.
 *
 * Se oculta por completo (return null) si no hay stats o si el agente no
 * tiene ninguna actividad (los 3 counts en 0) — no tiene sentido mostrar un
 * sheet vacío a un agente nuevo.
 *
 * Referencia visual: urbea-identidad-visual.html ~L1146 (.profstats.sheet).
 *
 * Subtarea 23.2.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radii, shadows, spacing, type_scale } from '@/theme/theme';
import type { AgentStats } from '../hooks/useAgentStats';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface ProfessionalStatsProps {
  stats: AgentStats | null;
  loading: boolean;
}

interface StatColumn {
  key: keyof AgentStats;
  label: string;
}

const COLUMNS: StatColumn[] = [
  { key: 'publications', label: 'PUBLICACIONES' },
  { key: 'leads', label: 'LEADS' },
  { key: 'closed', label: 'CERRADOS' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function ProfessionalStats({ stats, loading }: ProfessionalStatsProps) {
  const has_activity = stats != null && (stats.publications > 0 || stats.leads > 0 || stats.closed > 0);

  if (!loading && !has_activity) return null;

  return (
    <View style={styles.sheet}>
      {COLUMNS.map((column, index) => (
        <View
          key={column.key}
          style={[styles.column, index > 0 && styles.column_divider]}
        >
          <Text style={styles.number}>
            {loading ? '—' : String(stats![column.key])}
          </Text>
          <Text style={styles.label}>{column.label}</Text>
        </View>
      ))}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sheet: {
    flexDirection: 'row',
    backgroundColor: colors.paper,
    borderRadius: radii.r_12,
    paddingVertical: spacing.s_12,
    width: '100%',
    marginTop: spacing.s_16,
    ...shadows.sm,
  },
  column: {
    flex: 1,
    alignItems: 'center',
  },
  column_divider: {
    borderLeftWidth: 1,
    borderLeftColor: colors.paper_3,
  },
  number: {
    ...type_scale.h1,
    color: colors.ink,
  },
  label: {
    ...type_scale.caption,
    color: colors.gray_2,
    marginTop: spacing.s_4,
  },
});
