/**
 * RadarAnonRow — fila anónima del radar (#267.5).
 *
 * Preview: mobile/design-previews/267-crm-santiago.html (sección 5 — Santiago
 * NO dibuja esta pieza; decisión R2 de la exploración 045 §7.5: registrar la
 * señal, nunca exponer a la persona). Mismo grid que `CrmLeadRow`, pero sin
 * `Pressable`, sin nombre, sin avatar con iniciales (el slot de avatar es un
 * círculo neutro con ícono `Eye`) y microcopy fijo "Alguien está mirando"
 * (decisión ya tomada — no reabrir).
 *
 * 🔒 Invariante de privacidad (verificado en RadarAnonRow.test.tsx): esta
 * fila NUNCA renderiza contacto ni identidad — sin botón, sin iniciales, sin
 * `Image`. Solo `property_label` (de la propiedad DEL AGENTE), grados, delta,
 * sparkline y señales agregadas.
 *
 * Riel, iconos y sparkline en temp_warming: el radar solo se pinta dentro de
 * "Calentando" (exploración 045 §7.3; band_accepts_anon lo decide en el
 * padre). // ponytail: sin prop `band` hasta que otra banda lo acepte.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Eye, HouseLine } from 'phosphor-react-native';

import { colors, fonts } from '@/theme/theme';
import { format_degrees, format_delta, temperature_color } from '../utils/crm_temperature_format';
import { format_relative_time } from '../utils/relative_time';
import type { CrmRadarRow } from '../types';
import { SignalIcons } from './SignalIcons';
import { Sparkline } from './Sparkline';

const MICROCOPY = 'Alguien está mirando';

export interface RadarAnonRowProps {
  row: CrmRadarRow;
}

export function RadarAnonRow({ row }: RadarAnonRowProps): React.JSX.Element {
  const grade_color = temperature_color(row.temperature);

  return (
    <View style={styles.row} testID="radar-anon-row">
      <View style={styles.rail} />
      <View style={styles.avatar}>
        <Eye size={16} color={colors.gray_1} />
      </View>
      <View style={styles.body}>
        <View style={styles.name_row}>
          <Text style={styles.label}>{MICROCOPY}</Text>
          {row.last_activity_at ? (
            <Text style={styles.time}>{format_relative_time(row.last_activity_at)}</Text>
          ) : null}
        </View>
        <View style={styles.property_row}>
          <HouseLine size={11} color={colors.gray_2} />
          <Text style={styles.property} numberOfLines={1}>
            {row.property_label}
          </Text>
        </View>
        <View style={styles.signals_row}>
          <SignalIcons signals={row.signals} color={colors.temp_warming} />
          <Sparkline values={row.sparkline} color={colors.temp_warming} />
        </View>
      </View>
      <View style={styles.grade_col}>
        <Text style={[styles.grade, { color: grade_color }]}>{format_degrees(row.temperature)}</Text>
        <Text style={styles.delta}>{format_delta(row.delta)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 13,
    borderTopWidth: 1,
    borderTopColor: colors.paper_3,
  },
  rail: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 3,
    flexShrink: 0,
    backgroundColor: colors.temp_warming,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper_2,
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
  label: {
    fontFamily: fonts.outfit_medium,
    fontStyle: 'italic',
    fontSize: 15,
    color: colors.gray_2,
  },
  time: {
    flexShrink: 0,
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.gray_2,
  },
  property_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  property: {
    flexShrink: 1,
    fontFamily: fonts.outfit,
    fontSize: 11,
    color: colors.gray_2,
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
