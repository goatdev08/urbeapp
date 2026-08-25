/**
 * AdZoneBarsChart — barras horizontales por zona del detalle de un anuncio
 * (tarea #212, subtarea 212.4). Componente PURO de presentación: recibe la
 * forma exacta que devuelve `useAdStats` (`zones: AdStatsZoneRow[]`) —
 * cero fetching, cero estado de red, cero resolución de nombres por red.
 *
 * Techo de alcance: mobile/design-previews/212-dashboard-anuncios.html
 * (frame B · "Por zona"). Igual que AdDailyLineChart, este componente NO
 * incluye el `chart-card` (fondo/borde/sombra) ni el título de sección —
 * eso es del screen 212.5.
 *
 * Barras HORIZONTALES (no verticales) — decisión ya fijada por el preview:
 * los nombres de colonia son largos/variables, horizontal deja leer la
 * etiqueta completa sin truncar.
 *
 * Resolución de nombre de zona: `municipality_id`/`neighborhood_id` son SOLO
 * ids (la RPC `ad_stats_zones` no devuelve nombre). Igual que
 * `app/(protected)/ads/index.tsx` (zone_label + carga en lote de
 * mx_municipalities/mx_neighborhoods), la resolución real es responsabilidad
 * del screen — este componente solo acepta los mapas ya resueltos
 * (`municipality_names`/`neighborhood_names`), con el mismo fallback
 * humanizado si el id no está en el mapa (nombre aún no cargó / catálogo sin
 * esa fila). Constantes de copy duplicadas a propósito de ese archivo (no
 * es importable desde src/features/ — vive en app/, y aunque lo fuera, un
 * componente no debe depender de una ruta).
 *
 * El bucket "Otras zonas" (`municipality_id`/`neighborhood_id` AMBOS null,
 * garantizado por la migración 20260824000001:384-390) siempre se pinta
 * AL FINAL con relleno rayado (patrón SVG diagonal) + texto en cursiva +
 * caption — mismo copy que OTHER_ZONES_CAPTION en ads/index.tsx, para dejar
 * claro que es un agregado de privacidad (k<5), no una zona real.
 *
 * Ancho de barra: proporcional a `impressions` (default) sobre el máximo de
 * TODAS las filas mostradas (zonas reales + bucket) — así reproduce
 * exactamente los porcentajes del preview (Providencia 100%, Chapalita 62%,
 * Puerta de Hierro 36%, Otras zonas 27% ≈ impressions/2140). Zonas reales
 * ordenadas descendente por esa misma métrica; el bucket queda último
 * SIEMPRE, sin importar su valor (es un agregado, no compite en el ranking).
 *
 * Los valores numéricos son `integer NOT NULL` garantizado por la RPC
 * (mismo COALESCE que en AdDailyLineChart) — el conteo se muestra con
 * separador de miles completo (`toLocaleString`), NO compactado a "k" como
 * en las cards de la lista (el preview usa "2,140 · 560 · 39", no "2.1k").
 */
import React, { useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Line as SvgLine, Pattern, Rect } from 'react-native-svg';

import { colors, fonts, radii, spacing } from '@/theme/theme';
import type { AdStatsZoneRow } from '../hooks/useAdStats';
import type { AdStatsMetricKey } from './AdDailyLineChart';

// ─── Copy (duplicado a propósito de app/(protected)/ads/index.tsx — ver docblock) ──

const MUNICIPALITY_FALLBACK = 'Municipio sin nombre';
const NEIGHBORHOOD_FALLBACK = 'Colonia sin nombre';
export const OTHER_ZONES_LABEL = 'Otras zonas';
export const OTHER_ZONES_CAPTION = 'Zonas con muy poca audiencia para mostrarlas por separado.';

function is_other_zones_row(row: AdStatsZoneRow): boolean {
  return row.municipality_id === null && row.neighborhood_id === null;
}

function zone_label(
  row: AdStatsZoneRow,
  municipality_names: Record<string, string>,
  neighborhood_names: Record<number, string>,
): string {
  if (row.neighborhood_id !== null) {
    return neighborhood_names[row.neighborhood_id] ?? NEIGHBORHOOD_FALLBACK;
  }
  if (row.municipality_id !== null) {
    return municipality_names[row.municipality_id] ?? MUNICIPALITY_FALLBACK;
  }
  // Defensivo — el bucket se separa antes de llegar aquí.
  return OTHER_ZONES_LABEL;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AdZoneBarsChartProps {
  /** Desglose por zona de useAdStats. null/undefined se trata igual que []. */
  zones: AdStatsZoneRow[] | null | undefined;
  municipality_names?: Record<string, string>;
  neighborhood_names?: Record<number, string>;
  /** Métrica que determina el ancho relativo de cada barra. Default: 'impressions' (igual que el preview). */
  metric?: AdStatsMetricKey;
  /** Ancho de la barra (track) — por props, no medido en runtime. */
  width?: number;
}

const DEFAULT_WIDTH = 342;
const BAR_HEIGHT = 8;
const BAR_RADIUS = radii.r_4;

// ─── Componente ───────────────────────────────────────────────────────────────

export function AdZoneBarsChart({
  zones,
  municipality_names = {},
  neighborhood_names = {},
  metric = 'impressions',
  width = DEFAULT_WIDTH,
}: AdZoneBarsChartProps): React.JSX.Element {
  const pattern_id = useId();
  const rows = zones ?? [];

  if (rows.length === 0) {
    return (
      <View style={styles.empty} accessible accessibilityLabel="Desglose por zona — sin datos.">
        <Text style={styles.empty_text}>Aún no hay datos por zona en este periodo.</Text>
      </View>
    );
  }

  const other = rows.find(is_other_zones_row) ?? null;
  const real = rows
    .filter((r) => !is_other_zones_row(r))
    .slice()
    .sort((a, b) => b[metric] - a[metric]);
  const ordered = other ? [...real, other] : real;

  const max_value = Math.max(...ordered.map((r) => r[metric])) || 1;

  const summary = `Desglose de audiencia por zona — ${real.length} zona${real.length === 1 ? '' : 's'}${other ? ' + otras zonas' : ''}.`;

  return (
    <View accessible accessibilityLabel={summary}>
      {ordered.map((row, index) => {
        const is_other = is_other_zones_row(row);
        const label = is_other
          ? OTHER_ZONES_LABEL
          : zone_label(row, municipality_names, neighborhood_names);
        const fill_width = (row[metric] / max_value) * width;
        const key = `${row.municipality_id ?? ''}:${row.neighborhood_id ?? ''}:${index}`;

        return (
          <View
            key={key}
            style={[styles.row, index === ordered.length - 1 ? styles.row_last : null]}
          >
            <View style={styles.row_top}>
              <Text style={[styles.zone_name, is_other ? styles.zone_name_muted : null]} numberOfLines={1}>
                {label}
              </Text>
              <Text style={styles.zone_counts}>
                {row.impressions.toLocaleString('es-MX')} · {row.views.toLocaleString('es-MX')} ·{' '}
                {row.cta_taps.toLocaleString('es-MX')}
              </Text>
            </View>

            <Svg width={width} height={BAR_HEIGHT}>
              {is_other && (
                <Defs>
                  <Pattern
                    id={pattern_id}
                    width={8}
                    height={8}
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(135)"
                  >
                    <Rect width={8} height={8} fill={colors.paper_2} />
                    <SvgLine x1={0} y1={0} x2={0} y2={8} stroke={colors.gray_1} strokeWidth={4} />
                  </Pattern>
                </Defs>
              )}
              <Rect width={width} height={BAR_HEIGHT} rx={BAR_RADIUS} fill={colors.paper_2} />
              <Rect
                width={fill_width}
                height={BAR_HEIGHT}
                rx={BAR_RADIUS}
                fill={is_other ? `url(#${pattern_id})` : colors.primary}
              />
            </Svg>

            {is_other && <Text style={styles.zone_caption}>{OTHER_ZONES_CAPTION}</Text>}
          </View>
        );
      })}
    </View>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.s_24,
    paddingHorizontal: spacing.s_20,
  },
  empty_text: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.gray_2,
    textAlign: 'center',
    lineHeight: 17,
  },
  row: {
    paddingVertical: spacing.s_8 + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.paper_2,
  },
  row_last: {
    borderBottomWidth: 0,
  },
  row_top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.s_8,
    marginBottom: 6,
  },
  zone_name: {
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
    color: colors.ink,
    flexShrink: 1,
  },
  zone_name_muted: {
    fontFamily: fonts.sans,
    fontStyle: 'italic',
    color: colors.gray_3,
  },
  zone_counts: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.gray_2,
  },
  zone_caption: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
    color: colors.gray_2,
    marginTop: 5,
    lineHeight: 15,
  },
});
