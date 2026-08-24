/**
 * AdDailyLineChart — línea de rendimiento diario del detalle de un anuncio
 * (tarea #212, subtarea 212.4). Componente PURO de presentación: recibe la
 * forma exacta que devuelve `useAdStats` (`daily: AdStatsDailyPoint[]`) más
 * la métrica seleccionada — cero fetching, cero estado de red.
 *
 * Techo de alcance: mobile/design-previews/212-dashboard-anuncios.html
 * (frame B · "Rendimiento por día"). El componente dibuja SOLO el SVG + el
 * eje de fechas; el `chart-card` (fondo blanco/borde/sombra), el título de
 * sección y el texto de "toca un tile para cambiar la métrica" son del
 * screen 212.5 (necesitan estado de selección de tile que este componente
 * no tiene).
 *
 * Estados (según el preview):
 *   - 0 días  → "Sin datos de rendimiento en este periodo." (vacío real).
 *   - 1 día   → "Un solo día no arma una tendencia." (copy literal del
 *     preview: un solo punto no arma una línea) — este componente decide
 *     esto por la LONGITUD del arreglo recibido, no por el `period`
 *     seleccionado (no lo conoce; ver decisión de eje más abajo).
 *   - ≥2 días → línea recta por segmentos (sin bezier, igual que el preview
 *     — más simple de portar) + área de relleno + punto en el último día.
 *
 * Eje de fechas: el preview usa copy fijo por rango ("hace 30 días" / "hace
 * 15 días" / "hoy"). Este componente no recibe `period`, así que en vez de
 * eso deriva las etiquetas de los propios `daily[i].day`: extremo izquierdo
 * = primer día formateado, extremo derecho = "hoy" (el día más reciente de
 * la serie SIEMPRE es hoy o el último día con datos — mismo significado que
 * el "hoy" fijo del preview), punto medio = día intermedio formateado (se
 * omite si coincide con un extremo, caso de exactamente 2 puntos).
 *
 * Los valores numéricos de `daily` (impressions/views/cta_taps) son
 * `integer NOT NULL` garantizado por la RPC (COALESCE en cada rama —
 * supabase/migrations/20260824000001_ad_stats_per_ad.sql:216-218) — nunca
 * hace falta un "—" por null AQUÍ; ese caso (totals=null) es de las cards/
 * KPI tiles, fuera del alcance de este componente.
 *
 * ponytail: sin librería de gráficas — react-native-svg (ya instalada) con
 *   un <Path> de segmentos rectos es lo mínimo que funciona; nada de
 *   suavizado bezier ni interpolación (el preview lo deja como mejora
 *   futura opcional).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line as SvgLine, Path } from 'react-native-svg';

import { colors, fonts, spacing } from '@/theme/theme';
import type { AdStatsDailyPoint } from '../hooks/useAdStats';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type AdStatsMetricKey = 'impressions' | 'views' | 'cta_taps';

/** Copy compartido con AdZoneBarsChart y con el screen 212.5. */
export const AD_STATS_METRIC_LABELS: Record<AdStatsMetricKey, string> = {
  impressions: 'Impresiones',
  views: 'Vistas completas',
  cta_taps: 'Toques al contacto',
};

export interface AdDailyLineChartProps {
  /** Serie diaria de useAdStats. null/undefined se trata igual que []. */
  daily: AdStatsDailyPoint[] | null | undefined;
  metric: AdStatsMetricKey;
  /** Dimensiones del SVG — por props, no medidas en runtime (ver
   *  memoria rntl_no_ve_layout: los tests RNTL no ven layout real). */
  width?: number;
  height?: number;
}

// ─── Geometría (calca el preview 1:1, escalado por width/height) ─────────────

const DEFAULT_WIDTH = 342;
const DEFAULT_HEIGHT = 120;
const TOP_PAD = 10;
const BOTTOM_PAD = 10;
// Fracciones de las 2 líneas guía decorativas del preview (y=32/76 sobre
// viewBox de 130 de alto).
const GRIDLINE_FRACTIONS = [32 / 130, 76 / 130];

/** 'YYYY-MM-DD' → "20 ago" (es-MX). Parseo manual (no `new Date(iso)`) para
 *  evitar el corrimiento de un día que da el parseo UTC de un string sin
 *  hora en zonas horarias negativas (México = UTC-6). */
function format_day(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' }).format(date);
}

function build_axis_labels(daily: AdStatsDailyPoint[]): string[] {
  const n = daily.length;
  const first = format_day(daily[0]!.day);
  const last = 'hoy';
  if (n === 2) return [first, last];
  const mid_index = Math.floor((n - 1) / 2);
  const mid = format_day(daily[mid_index]!.day);
  return [first, mid, last];
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function AdDailyLineChart({
  daily,
  metric,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
}: AdDailyLineChartProps): React.JSX.Element {
  const points = daily ?? [];
  const label = AD_STATS_METRIC_LABELS[metric];

  if (points.length === 0) {
    return (
      <View
        style={[styles.empty, { height }]}
        accessible
        accessibilityLabel={`Gráfico de ${label} por día — sin datos.`}
      >
        <Text style={styles.empty_text}>Sin datos de rendimiento en este periodo.</Text>
      </View>
    );
  }

  if (points.length === 1) {
    return (
      <View
        style={[styles.empty, { height }]}
        accessible
        accessibilityLabel={`Gráfico de ${label} por día — un solo día, sin tendencia que mostrar.`}
      >
        <Text style={styles.empty_text}>Un solo día no arma una tendencia.</Text>
      </View>
    );
  }

  const values = points.map((p) => p[metric]);
  const baseline = height - BOTTOM_PAD;
  const usable = baseline - TOP_PAD;
  const max_value = Math.max(...values) * 1.15 || 1;
  const step_x = width / (values.length - 1);

  const coords = values.map((v, i) => {
    const x = i * step_x;
    const y = baseline - (v / max_value) * usable;
    return { x, y };
  });

  const line_d = `M${coords.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L')}`;
  const last = coords[coords.length - 1]!;
  const first = coords[0]!;
  const area_d = `${line_d} L${last.x.toFixed(1)},${height} L${first.x.toFixed(1)},${height} Z`;

  const axis_labels = build_axis_labels(points);
  const last_value = values[values.length - 1]!;

  return (
    <View
      accessible
      accessibilityLabel={`Gráfico de ${label} por día, ${points.length} días. Último valor: ${last_value.toLocaleString('es-MX')}.`}
    >
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {GRIDLINE_FRACTIONS.map((frac) => (
          <SvgLine
            key={frac}
            x1={0}
            y1={height * frac}
            x2={width}
            y2={height * frac}
            stroke={colors.paper_3}
            strokeWidth={1}
          />
        ))}
        <Path d={area_d} fill={colors.primary_tint} opacity={0.7} />
        <Path
          d={line_d}
          fill="none"
          stroke={colors.primary}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <Circle cx={last.x} cy={last.y} r={4} fill={colors.primary} stroke={colors.surface} strokeWidth={2} />
      </Svg>
      <View style={styles.axis_row}>
        {axis_labels.map((text, i) => (
          <Text key={`${text}-${i}`} style={styles.axis_label}>
            {text}
          </Text>
        ))}
      </View>
    </View>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.s_20,
  },
  empty_text: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.gray_2,
    textAlign: 'center',
    lineHeight: 17,
  },
  axis_row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.s_4,
  },
  axis_label: {
    fontFamily: fonts.sans,
    fontSize: 10,
    color: colors.gray_2,
  },
});
