/**
 * SignalIcons — 5 iconos de señal de actividad (CRM, #267.5).
 *
 * Preview: mobile/design-previews/267-crm-santiago.html (`.lead-signals`,
 * `renderSignals` — 5 <svg> en orden fijo, opacity 1 cuando la señal está
 * presente / .26 cuando no, contador numérico SOLO en el 1º).
 *
 * Orden fijo: video (vistas) · like · guardó · WhatsApp · completó. Acepta
 * las dos formas que trae el backend (`CrmLeadSignals` de crm_leads_page,
 * `CrmRadarSignals` de crm_radar_anon — #266) con un adaptador interno
 * pequeño, para no duplicar el layout de 5 iconos en dos componentes.
 *
 * `color` = color de la banda contenedora (el preview aprobado pinta los 5
 * iconos con él); default neutro.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BookmarkSimple, CheckCircle, Heart, Play, WhatsappLogo } from 'phosphor-react-native';

import { colors, fonts } from '@/theme/theme';
import type { CrmLeadSignals, CrmRadarSignals } from '../types';

const ICON_SIZE = 12;
const OFF_OPACITY = 0.26;
const ICON_COLOR = colors.gray_3;

interface NormalizedSignals {
  video_present: boolean;
  video_count: number;
  liked: boolean;
  saved: boolean;
  whatsapp: boolean;
  completed: boolean;
}

function is_lead_signals(signals: CrmLeadSignals | CrmRadarSignals): signals is CrmLeadSignals {
  return 'video_views' in signals;
}

function normalize_signals(signals: CrmLeadSignals | CrmRadarSignals): NormalizedSignals {
  if (is_lead_signals(signals)) {
    return {
      video_present: signals.video_views > 0,
      video_count: signals.video_views,
      liked: signals.likes > 0,
      saved: signals.saves > 0,
      // ponytail: crm_leads_page (#266) no expone "abrió WhatsApp sin
      // escribir" como campo propio hoy — siempre ausente hasta que el
      // backend lo agregue. Techo conocido, no inventado aquí.
      whatsapp: false,
      completed: signals.video_completed > 0,
    };
  }
  return {
    video_present: signals.views > 0,
    video_count: signals.views,
    liked: signals.liked,
    saved: signals.saved,
    whatsapp: false,
    completed: signals.completed,
  };
}

export interface SignalIconsProps {
  signals: CrmLeadSignals | CrmRadarSignals;
  color?: string;
}

export function SignalIcons({ signals, color = ICON_COLOR }: SignalIconsProps): React.JSX.Element {
  const n = normalize_signals(signals);

  return (
    <View style={styles.row}>
      <View style={[styles.icon, { opacity: n.video_present ? 1 : OFF_OPACITY }]}>
        <Play size={ICON_SIZE} color={color} weight={n.video_present ? 'fill' : 'regular'} />
        {n.video_count > 0 ? <Text style={[styles.count, { color }]}>{n.video_count}</Text> : null}
      </View>
      <View style={{ opacity: n.liked ? 1 : OFF_OPACITY }}>
        <Heart size={ICON_SIZE} color={color} weight={n.liked ? 'fill' : 'regular'} />
      </View>
      <View style={{ opacity: n.saved ? 1 : OFF_OPACITY }}>
        <BookmarkSimple size={ICON_SIZE} color={color} weight={n.saved ? 'fill' : 'regular'} />
      </View>
      <View style={{ opacity: n.whatsapp ? 1 : OFF_OPACITY }}>
        <WhatsappLogo size={ICON_SIZE} color={color} weight={n.whatsapp ? 'fill' : 'regular'} />
      </View>
      <View style={{ opacity: n.completed ? 1 : OFF_OPACITY }}>
        <CheckCircle size={ICON_SIZE} color={color} weight={n.completed ? 'fill' : 'regular'} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  icon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  },
  count: {
    fontFamily: fonts.mono,
    fontSize: 9,
    lineHeight: 10,
  },
});
