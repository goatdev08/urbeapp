/**
 * AgencyAgentRow — fila de un agente en la banda "Tus agentes" del segmento
 * Equipo del CRM (subtarea 269.6).
 *
 * Preview aprobado: mobile/design-previews/269-crm-equipo.html (sección 4,
 * `.agency-row`). Elecciones de Abraham (2026-09-07): etiqueta "RESPONDE EN"
 * corta (alternativa C — el footnote que la explica lo pinta el PADRE una
 * sola vez bajo la cabecera de la banda, no aquí); badge "SIN LEADS" gris
 * cuando el agente no tiene con qué medirse (alternativa B). Tap = drill-down
 * a los leads de ese agente (CRMScreen.tsx).
 *
 * 🪶 ponytail: sin caption de una línea explicando el umbral exacto que
 * cruzó el badge (sí la dibuja el preview) — `AgencyAgentRow` (crm_agency_
 * overview, 269.1) NO expone `stale_count` ni los umbrales de app_config
 * (configurables, pueden no ser "24 h"/"7 días"); inventar el número sería
 * mentirle al owner. Techo: exponer esos campos en la RPC (derivada
 * hardening(269.1)) lo habilita sin tocar este componente.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radii, spacing } from '@/theme/theme';
import { format_response_time } from '../utils/format_response_time';
import type { AgencyAgentRow as AgencyAgentRowData } from '../types';

/** Iniciales del avatar fallback — mismo criterio que AgentSelector/CrmLeadRow. */
function get_initials(full_name: string | null): string {
  if (!full_name) return '?';
  const words = full_name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (words.length === 0) return '?';
  return words.map((word) => (word[0] ?? '').toUpperCase()).join('');
}

const FLAG_META: Record<'pierde_leads' | 'acumula', { label: string; color: string }> = {
  pierde_leads: { label: 'PIERDE LEADS', color: colors.temp_hot },
  acumula: { label: 'ACUMULA', color: colors.temp_cooling },
};

/**
 * true = el agente no tiene ningún lead con el que medirse (badge "SIN
 * LEADS", alternativa B aprobada). Heurística sobre los 3 campos que SÍ trae
 * el contrato — `crm_agency_overview` no expone `total_leads`; sin flag y
 * con las 3 métricas en su valor "vacío" es la mejor aproximación disponible.
 */
function has_no_leads(row: AgencyAgentRowData): boolean {
  return row.flag === null && row.untouched_count === 0 && row.avg_temperature === null && row.response_hours === null;
}

export interface AgencyAgentRowProps {
  row: AgencyAgentRowData;
  onPress: () => void;
}

export function AgencyAgentRow({ row, onPress }: AgencyAgentRowProps): React.JSX.Element {
  const no_leads = has_no_leads(row);
  const flag_meta = row.flag ? FLAG_META[row.flag] : null;
  const display_name = row.agent_name ?? 'Agente';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Ver leads de ${display_name}`}
      style={styles.row}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatar_initial}>{get_initials(row.agent_name)}</Text>
      </View>
      <View style={styles.body}>
        <View style={styles.name_row}>
          <Text style={styles.name} numberOfLines={1}>
            {display_name}
          </Text>
          {flag_meta ? (
            <View style={[styles.badge, { backgroundColor: flag_meta.color }]}>
              <Text style={styles.badge_text}>{flag_meta.label}</Text>
            </View>
          ) : no_leads ? (
            <View style={[styles.badge, styles.badge_neutral]}>
              <Text style={[styles.badge_text, styles.badge_text_neutral]}>SIN LEADS</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.metrics}>
          <View style={styles.metric}>
            <Text style={styles.metric_label}>SIN TOCAR</Text>
            <Text style={[styles.metric_value, no_leads && styles.metric_value_dim]}>
              {no_leads ? '—' : row.untouched_count}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metric_label}>RESPONDE EN</Text>
            <Text style={[styles.metric_value, no_leads && styles.metric_value_dim]}>
              {format_response_time(row.response_hours)}
            </Text>
          </View>
          <View style={styles.metric}>
            <Text style={styles.metric_label}>SUS LEADS</Text>
            <Text style={[styles.metric_value, no_leads && styles.metric_value_dim]}>
              {row.avg_temperature === null ? '—' : `${row.avg_temperature}°`}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.s_12,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.paper_3,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radii.r_pill,
    backgroundColor: colors.paper_2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatar_initial: {
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    color: colors.gray_2,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  name_row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s_8,
  },
  name: {
    flexShrink: 1,
    fontFamily: fonts.outfit_semibold,
    fontSize: 15,
    color: colors.ink,
  },
  badge: {
    paddingVertical: 3,
    paddingHorizontal: spacing.s_8,
    borderRadius: radii.r_pill,
    flexShrink: 0,
  },
  badge_neutral: {
    backgroundColor: colors.paper_2,
  },
  badge_text: {
    fontFamily: fonts.mono_medium,
    fontSize: 9.5,
    letterSpacing: 0.3,
    color: '#FDFBF6',
  },
  badge_text_neutral: {
    color: colors.gray_2,
  },
  metrics: {
    flexDirection: 'row',
    gap: spacing.s_16,
    marginTop: spacing.s_8,
  },
  metric: {
    gap: 3,
  },
  metric_label: {
    fontFamily: fonts.mono,
    fontSize: 8.5,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: colors.gray_2,
  },
  metric_value: {
    fontFamily: fonts.mono_medium,
    fontSize: 13,
    color: colors.ink,
  },
  metric_value_dim: {
    color: colors.gray_2,
    fontFamily: fonts.mono,
  },
});
