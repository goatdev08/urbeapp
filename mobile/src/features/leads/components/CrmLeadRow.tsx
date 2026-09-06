/**
 * CrmLeadRow — fila de un lead dentro de una banda del CRM (#267.5).
 *
 * Preview: mobile/design-previews/267-crm-santiago.html (sección 1,
 * `.lead-row` — grid riel 3px · anillo 46px · texto · grados/delta). Fuente
 * de datos: `CrmLeadRow` (public.crm_leads_page, #266.4).
 *
 * Alturas/flexShrink explícitos en vez de flex:1 sin altura — los tests RNTL
 * no calculan layout real (#113: un flex:1 colapsado a altura 0 pasó 99
 * tests sin que ninguno lo notara).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, spacing } from '@/theme/theme';
import { band_color } from '../utils/crm_band_meta';
import { crm_row_narrative } from '../utils/crm_narrative';
import { format_degrees, format_delta, temperature_color } from '../utils/crm_temperature_format';
import { format_relative_time } from '../utils/relative_time';
import type { CrmLeadRow as CrmLeadRowData } from '../types';
import { SignalIcons } from './SignalIcons';
import { Sparkline } from './Sparkline';
import { TemperatureRing } from './TemperatureRing';

/**
 * Iniciales del avatar fallback: 1ª letra de las primeras 2 palabras.
 *
 * ponytail: deuda — duplica `get_initials` de AgentSelector.tsx (2ª copia
 * casi idéntica en el repo, la 1ª en LeadCard.tsx solo toma 1 letra). No se
 * extrae a un util compartido aquí: el footprint de 267.5 es solo estos 8
 * componentes + tests, y una 3ª duplicación de ~5 líneas no justifica tocar
 * `utils/` fuera de alcance a media tarea. Candidato a limpiar si aparece
 * una 4ª necesidad de iniciales.
 */
function get_initials(full_name: string | null): string {
  if (!full_name) return '?';
  const words = full_name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (words.length === 0) return '?';
  return words.map((word) => (word[0] ?? '').toUpperCase()).join('');
}

export interface CrmLeadRowProps {
  row: CrmLeadRowData;
  onPress: () => void;
  expanded?: boolean;
}

export function CrmLeadRow({ row, onPress, expanded = false }: CrmLeadRowProps): React.JSX.Element {
  const rail_color = band_color(row.band);
  const grade_color = temperature_color(row.temperature);
  const display_name = row.full_name ?? 'Usuario sin nombre';
  // ponytail: crm_leads_page no distingue "abrió WhatsApp sin escribir" como
  // señal propia hoy (#266) — se pasa false hasta que el backend lo exponga.
  const narrative = crm_row_narrative(row.signals, row.origin_property?.address ?? null, false);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      style={styles.row}
    >
      <View style={[styles.rail, { backgroundColor: rail_color }]} />
      <View style={styles.ring_col}>
        <TemperatureRing temperature={row.temperature}>
          <Text style={styles.initials}>{get_initials(row.full_name)}</Text>
        </TemperatureRing>
      </View>
      <View style={styles.body}>
        <View style={styles.name_row}>
          <Text style={styles.name} numberOfLines={1}>
            {display_name}
          </Text>
          {row.last_activity_at ? (
            <Text style={styles.time}>{format_relative_time(row.last_activity_at)}</Text>
          ) : null}
        </View>
        <Text style={styles.narrative} numberOfLines={2}>
          {narrative}
        </Text>
        <View style={styles.signals_row}>
          <SignalIcons signals={row.signals} color={rail_color} />
          <Sparkline values={row.sparkline} color={rail_color} />
        </View>
      </View>
      <View style={styles.grade_col}>
        <Text style={[styles.grade, { color: grade_color }]}>{format_degrees(row.temperature)}</Text>
        <Text style={styles.delta}>{format_delta(row.delta)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.s_12,
    paddingVertical: 13,
    borderTopWidth: 1,
    borderTopColor: colors.paper_3,
  },
  rail: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 3,
    flexShrink: 0,
  },
  ring_col: {
    width: 46,
    height: 46,
    flexShrink: 0,
  },
  initials: {
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    color: colors.gray_2,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  name_row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 7,
  },
  name: {
    flexShrink: 1,
    fontFamily: fonts.outfit_semibold,
    fontSize: 15,
    color: colors.ink,
  },
  time: {
    flexShrink: 0,
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.gray_2,
  },
  narrative: {
    fontFamily: fonts.outfit_light,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.gray_3,
  },
  signals_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 4,
  },
  grade_col: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  grade: {
    fontFamily: fonts.mono_medium,
    fontSize: 19,
  },
  delta: {
    marginTop: 2,
    fontFamily: fonts.mono,
    fontSize: 9.5,
    color: colors.gray_2,
  },
});
