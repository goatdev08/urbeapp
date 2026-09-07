/**
 * UnmanagedLeadRow — fila de un lead SIN gestor en la banda "Sin gestor" del
 * segmento Equipo del CRM (subtarea 269.6).
 *
 * Preview aprobado: mobile/design-previews/269-crm-equipo.html (sección 2,
 * `.lead-row` — riel + anillo + "ENTRÓ hace" + TEMP + botón ASIGNAR). Sin
 * frase narrativa ni señales (el contrato de `crm_agency_overview` para
 * `kind='unmanaged'` no las trae — ver approve-box de esa sección: un lead
 * sin gestor no acumula historial de banda del que calcular una frase).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radii, spacing } from '@/theme/theme';
import { format_degrees, temperature_color } from '../utils/crm_temperature_format';
import { format_relative_time } from '../utils/relative_time';
import type { UnmanagedLeadRow as UnmanagedLeadRowData } from '../types';
import { TemperatureRing } from './TemperatureRing';

/** Iniciales del avatar fallback — mismo criterio que AgentSelector/CrmLeadRow. */
function get_initials(full_name: string | null): string {
  if (!full_name) return '?';
  const words = full_name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (words.length === 0) return '?';
  return words.map((word) => (word[0] ?? '').toUpperCase()).join('');
}

export interface UnmanagedLeadRowProps {
  row: UnmanagedLeadRowData;
  onPressAssign: () => void;
}

export function UnmanagedLeadRow({ row, onPressAssign }: UnmanagedLeadRowProps): React.JSX.Element {
  const display_name = row.lead_display_name ?? 'Usuario sin nombre';
  const grade_color = temperature_color(row.temperature);

  return (
    <View style={styles.row}>
      <View style={[styles.rail, { backgroundColor: grade_color }]} />
      <View style={styles.ring_col}>
        <TemperatureRing temperature={row.temperature}>
          <Text style={styles.initials}>{get_initials(row.lead_display_name)}</Text>
        </TemperatureRing>
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {display_name}
        </Text>
        {row.first_contact_at ? (
          <Text style={styles.time}>ENTRÓ {format_relative_time(row.first_contact_at)}</Text>
        ) : null}
        <View style={styles.temp_row}>
          <Text style={[styles.temp_num, { color: grade_color }]}>{format_degrees(row.temperature)}</Text>
          <Text style={styles.temp_label}>TEMP</Text>
        </View>
      </View>
      <Pressable
        onPress={onPressAssign}
        accessibilityRole="button"
        accessibilityLabel={`Asignar a ${display_name}`}
        style={styles.btn}
      >
        <Text style={styles.btn_text}>ASIGNAR</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
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
    gap: 2,
  },
  name: {
    fontFamily: fonts.outfit_semibold,
    fontSize: 15,
    color: colors.ink,
  },
  time: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.gray_2,
  },
  temp_row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: 2,
  },
  temp_num: {
    fontFamily: fonts.mono_medium,
    fontSize: 15,
  },
  temp_label: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: colors.gray_2,
  },
  btn: {
    flexShrink: 0,
    minHeight: 34,
    paddingHorizontal: spacing.s_16,
    borderRadius: radii.r_12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btn_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 11.5,
    color: colors.on_primary,
  },
});
