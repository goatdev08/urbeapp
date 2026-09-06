/**
 * FunnelCard — embudo de 30 días del CRM (#267.5).
 *
 * Preview: mobile/design-previews/267-crm-santiago.html (sección 2 — SVG de
 * 5 tramos gris→verde→arena→terracota + 5 KPIs en DM Mono + 4 caídas
 * porcentuales). Fuente de datos: `CrmFunnel` (public.crm_funnel, #266.4).
 *
 * Geometría del embudo (derivada del path literal del preview, no inventada
 * aquí): 5 puntos igualmente espaciados en X (viewBox 317×92); la altura en
 * cada punto escala con `sqrt(valor_i / valor_0)` sobre una altura máxima
 * fija de 76, centrada en y=38 — reproduce EXACTAMENTE las coordenadas del
 * `<path>` del preview para la serie de ejemplo (312/96/34/12/5 → alturas
 * 76/42.2/25/15/9.6), así que cualquier serie real se dibuja con la misma
 * fórmula sin necesidad de recalcular el path a mano.
 *
 * KPI 4 = "Te contactaron" (no "Te escribieron" de Santiago): coincide con
 * `crm_funnel.contactaron`, que cuenta `contact-agent` real (#75.4), no
 * WhatsApp sin registrar.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Line as SvgLine, LinearGradient, Path, Stop } from 'react-native-svg';

import { colors, fonts, radii, spacing } from '@/theme/theme';
import type { CrmFunnel } from '../types';

const VIEWBOX_W = 317;
const VIEWBOX_H = 92;
const CENTER_Y = 38;
const MAX_H = 76;
const MINUS_SIGN = '−';
const GRADIENT_ID = 'crmFunnelGradient';

const STAGES: { key: keyof CrmFunnel; label: string; highlight?: boolean }[] = [
  { key: 'vieron', label: 'Vieron tu\ncontenido' },
  { key: 'volvieron', label: 'Volvieron' },
  { key: 'guardaron', label: 'Guardaron' },
  { key: 'contactaron', label: 'Te contactaron', highlight: true },
  { key: 'agendaron', label: 'Agendaron' },
];

/** "1.6% agenda" — '—' si vieron=0 (no hay base para el porcentaje). */
function format_agenda_pct(agendaron: number, vieron: number): string {
  if (vieron === 0) return '—';
  return `${((agendaron / vieron) * 100).toFixed(1)}% agenda`;
}

/** "−69%" (U+2212) — '—' si la etapa anterior es 0 (no hay base). */
function format_drop(prev: number, cur: number): string {
  if (prev === 0) return '—';
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return '0%';
  const sign = pct < 0 ? MINUS_SIGN : '+';
  return `${sign}${Math.abs(pct)}%`;
}

export interface FunnelCardProps {
  funnel: CrmFunnel;
}

export function FunnelCard({ funnel }: FunnelCardProps): React.JSX.Element {
  const values = STAGES.map((s) => funnel[s.key]);
  const base = values[0] ?? 0;

  const points = values.map((v, i) => {
    const x = (i * VIEWBOX_W) / (STAGES.length - 1);
    const h = base > 0 ? MAX_H * Math.sqrt(Math.max(0, v) / base) : 0;
    return { x, top: CENTER_Y - h / 2, bottom: CENTER_Y + h / 2 };
  });

  const top_edge = points.map((p) => `${p.x.toFixed(1)},${p.top.toFixed(1)}`).join(' L');
  const bottom_edge = [...points]
    .reverse()
    .map((p) => `${p.x.toFixed(1)},${p.bottom.toFixed(1)}`)
    .join(' L');
  const path_d = `M${top_edge} L${bottom_edge} Z`;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.eyebrow}>TU EMBUDO · 30 DÍAS</Text>
        <Text style={styles.meta}>{format_agenda_pct(funnel.agendaron, funnel.vieron)}</Text>
      </View>

      <Svg width="100%" height={VIEWBOX_H} viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}>
        <Defs>
          <LinearGradient id={GRADIENT_ID} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0%" stopColor="#93A29B" stopOpacity={0.7} />
            <Stop offset="45%" stopColor="#2F7A5A" stopOpacity={0.78} />
            <Stop offset="78%" stopColor="#C2A07C" stopOpacity={0.92} />
            <Stop offset="100%" stopColor="#B4491E" stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Path d={path_d} fill={`url(#${GRADIENT_ID})`} />
        {points.slice(1).map((p) => (
          <SvgLine key={p.x} x1={p.x} y1={p.top} x2={p.x} y2={p.bottom} stroke="#FFFFFF" strokeWidth={2} />
        ))}
      </Svg>

      <View style={styles.kpi_grid}>
        {STAGES.map((s) => (
          <View key={s.key} style={styles.kpi_tile}>
            <Text style={styles.kpi_value}>{funnel[s.key]}</Text>
            <Text style={[styles.kpi_label, s.highlight ? styles.kpi_label_highlight : null]}>
              {s.label}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.drops_row}>
        {values.slice(1).map((v, i) => (
          <Text key={i} style={styles.drop}>
            {format_drop(values[i]!, v)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 14,
    paddingBottom: 10,
    backgroundColor: colors.surface,
    borderRadius: radii.r_16,
    borderWidth: 1,
    borderColor: colors.paper_3,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.s_8,
  },
  eyebrow: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.5,
    color: colors.gray_2,
  },
  meta: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.gray_2,
  },
  kpi_grid: {
    flexDirection: 'row',
    marginTop: spacing.s_8,
  },
  kpi_tile: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
  },
  kpi_value: {
    fontFamily: fonts.mono_medium,
    fontSize: 15,
    color: colors.ink,
  },
  kpi_label: {
    marginTop: 3,
    fontSize: 9.5,
    lineHeight: 12,
    textAlign: 'center',
    color: colors.gray_2,
  },
  kpi_label_highlight: {
    color: colors.temp_warming,
    fontFamily: fonts.sans_semibold,
  },
  drops_row: {
    flexDirection: 'row',
    marginTop: 2,
  },
  drop: {
    flex: 1,
    fontFamily: fonts.mono,
    fontSize: 9,
    textAlign: 'center',
    color: colors.temp_hot,
  },
});
