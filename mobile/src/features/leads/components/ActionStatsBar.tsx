/**
 * ActionStatsBar — "barra de acciones que se rellena" (tarea #112, decisión
 * del dueño): reemplaza el puntaje numérico y la temperatura frío/tibio/
 * caliente por HECHOS — 4 tramos que se van rellenando según lo que el
 * buscador realmente hizo con la propiedad de origen del lead.
 *
 * Mismo lenguaje visual que el embudo de estados de `urbea-identidad-visual.html`
 * (#funnel, `.fstep`/`.bar`/`.lab`): segmentos `flex:1` en fila con gap chico,
 * radio pill, tramo lleno vs. vacío por color — solo que aquí cada tramo es
 * una señal booleana independiente, no un paso secuencial de embudo.
 *
 * Tramos (orden fijo, el mismo en que un lead normalmente los genera):
 *   1. Dio like            — IMPLÍCITO: si `stats` existe, ya dio like (es
 *      el filtro de entrada de get_lead_stats — sin like no hay fila). Por
 *      eso este tramo está SIEMPRE lleno cuando la barra se pinta.
 *   2. Vio el video completo — stats.vio_completo
 *   3. Guardó                — stats.guardo
 *   4. Volvió a ver          — stats.veces_visto > 1
 *
 * "Contactó" NO es un tramo (decisión del dueño): un lead NACE del contacto
 * por WhatsApp, así que ese tramo estaría siempre lleno — cero información.
 *
 * `stats === undefined` → el usuario aún no dio like a la propiedad de origen
 * (get_lead_stats no devuelve fila; NO es un error, ver useLeadStats). En vez
 * de una barra vacía y muda se pinta un texto corto y honesto.
 *
 * `compact`: uso en LeadCard (lista) — SOLO la barra, sin etiquetas de tramo
 * ni texto de "última actividad" (LeadCard ya trae su propio "hace X" junto
 * al badge de estado; repetir un segundo timestamp — de una fecha DISTINTA,
 * la de la señal, no la del lead — confunde más de lo que informa en una
 * card angosta). Se lee de un vistazo sin competir por espacio. Sin
 * `compact` (LeadExpandedView, detalle): barra + etiqueta por tramo + última
 * actividad, como el `.fstep .lab` del embudo — ahí sí hay espacio y es la
 * señal que pidió el dueño explícitamente.
 *
 * Tokens: `colors`/`radii`/`spacing`/`fonts` de theme.ts, ninguno suelto.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radii, spacing } from '@/theme/theme';
import type { LeadStats } from '../types';
import { format_relative_time } from '../utils/relative_time';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Segment {
  key: string;
  label: string;
  filled: boolean;
}

export interface ActionStatsBarProps {
  /** undefined = el usuario todavía no dio like a la propiedad de origen. */
  stats: LeadStats | undefined;
  /** true en LeadCard (lista) — barra sin etiquetas. Default: false (detalle). */
  compact?: boolean;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function ActionStatsBar({ stats, compact = false }: ActionStatsBarProps): React.JSX.Element {
  if (!stats) {
    return (
      <Text style={compact ? styles.empty_compact : styles.empty}>
        Sin señales todavía
      </Text>
    );
  }

  const segments: Segment[] = [
    { key: 'like',   label: 'Like',           filled: true },
    { key: 'video',  label: 'Video completo', filled: stats.vio_completo },
    { key: 'guardo', label: 'Guardó',         filled: stats.guardo },
    { key: 'volvio', label: 'Volvió a ver',   filled: stats.veces_visto > 1 },
  ];

  const time_label = format_relative_time(stats.ultima_actividad);
  const summary = segments.map((s) => `${s.label}: ${s.filled ? 'sí' : 'no'}`).join(', ');

  return (
    <View accessible accessibilityLabel={`Actividad — ${summary}. Última actividad ${time_label}.`}>
      <View style={styles.bar_row}>
        {segments.map((s) => (
          <View
            key={s.key}
            style={[
              styles.segment,
              compact ? styles.segment_compact : styles.segment_full,
              { backgroundColor: s.filled ? colors.primary : colors.paper_3 },
            ]}
          />
        ))}
      </View>

      {!compact && (
        <View style={styles.label_row}>
          {segments.map((s) => (
            <Text
              key={s.key}
              style={[styles.label, { color: s.filled ? colors.primary_deep : colors.gray_2 }]}
              numberOfLines={1}
            >
              {s.label}
            </Text>
          ))}
        </View>
      )}

      {/* compact (LeadCard) NO repite el texto de tiempo — la fila de badge
          de estado ya trae un "hace X" (lead.updated_at); el de aquí
          (stats.ultima_actividad) es una fecha DISTINTA y mostrar ambas
          seguidas en una card angosta confunde más de lo que informa. El
          detalle (LeadExpandedView) sí lo pinta — ahí hay espacio y es la
          señal que pidió el dueño ("más última actividad"). El texto sigue
          en el accessibilityLabel de arriba en ambos modos. */}
      {!compact && <Text style={styles.time}>{time_label}</Text>}
    </View>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bar_row: {
    flexDirection: 'row',
    gap: 4,
  },
  segment: {
    flex: 1,
    borderRadius: radii.r_pill,
  },
  segment_compact: {
    height: 5,
  },
  segment_full: {
    height: 8,
  },

  label_row: {
    flexDirection: 'row',
    gap: 4,
    marginTop: spacing.s_4,
  },
  label: {
    flex: 1,
    fontFamily: fonts.sans_semibold,
    fontSize: 10,
    textAlign: 'center',
  },

  time: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.gray_2,
    marginTop: spacing.s_4,
  },

  empty: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.gray_2,
    fontStyle: 'italic',
  },
  empty_compact: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.gray_2,
    fontStyle: 'italic',
  },
});
