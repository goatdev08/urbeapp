/**
 * NarrativeHeader — cabecera narrativa del CRM (#267.5).
 *
 * Preview: mobile/design-previews/267-crm-santiago.html (sección 3 —
 * H1 23.5px/700 con highlight en temp_hot + línea secundaria 12.5px/300 con
 * la parte "N se están enfriando" en temp_cooling). Copy real:
 * `crm_header_narrative` (267.3) — este componente solo pinta, no decide
 * texto.
 *
 * `crm_header_narrative` no separa el segmento a resaltar del subline como
 * campo propio (solo lo hace para el headline, vía `highlight`) — se extrae
 * aquí con un `split` simple sobre la frase reconstruida
 * ("{n} se está(n) enfriando"), tal como pide la subtarea ("split, no regex
 * compleja"). Si el subline no contiene esa frase (casos "silent"/"0 leads"),
 * se pinta plano, sin highlight.
 *
 * Prop `narrative` (subtarea 269.6, narrativa de agencia del segmento
 * Equipo): `crm_header_narrative` SOLO sabe generar la narrativa "Míos"
 * (conteos por banda de UN agente) — la de agencia sale de
 * useCrmAgencyOverview, que no expone esos conteos (ver CRMScreen.tsx,
 * build_agency_narrative). Cuando se pasa `narrative`, se pinta TAL CUAL,
 * sin llamar a `crm_header_narrative`.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, spacing } from '@/theme/theme';
import { crm_header_narrative } from '../utils/crm_narrative';
import type { CrmBand } from '../types';

export interface AgencyNarrative {
  headline: string;
  highlight?: string | null;
  subline?: string | null;
  subline_highlight?: string | null;
}

export type NarrativeHeaderProps =
  | { counts: Record<CrmBand, number>; top_cooling?: { first_name: string; delta: number } | null; narrative?: undefined }
  | { narrative: AgencyNarrative; counts?: undefined; top_cooling?: undefined };

/** [antes, resaltado, después] — resaltado='' si `part` no aparece en `text`. */
function split_on(text: string, part: string | null): [string, string, string] {
  if (!part) return [text, '', ''];
  const idx = text.indexOf(part);
  if (idx === -1) return [text, '', ''];
  return [text.slice(0, idx), part, text.slice(idx + part.length)];
}

export function NarrativeHeader(props: NarrativeHeaderProps): React.JSX.Element {
  const { headline, highlight, subline, subline_highlight } = props.narrative
    ? {
        headline: props.narrative.headline,
        highlight: props.narrative.highlight ?? null,
        subline: props.narrative.subline ?? null,
        subline_highlight: props.narrative.subline_highlight ?? null,
      }
    : (() => {
        const n = crm_header_narrative(props.counts, props.top_cooling);
        const cooling_phrase =
          props.counts.cooling > 0
            ? `${props.counts.cooling} ${props.counts.cooling === 1 ? 'se está enfriando' : 'se están enfriando'}`
            : null;
        return { ...n, subline_highlight: cooling_phrase };
      })();

  const [h_before, h_hl, h_after] = split_on(headline, highlight);
  const [s_before, s_hl, s_after] = subline ? split_on(subline, subline_highlight) : ['', '', ''];

  return (
    <View style={styles.container}>
      <Text style={styles.headline}>
        {h_before}
        {h_hl ? <Text style={styles.headline_hl}>{h_hl}</Text> : null}
        {h_after}
      </Text>
      {subline ? (
        <Text style={styles.subline}>
          {s_before}
          {s_hl ? <Text style={styles.subline_hl}>{s_hl}</Text> : null}
          {s_after}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.s_20,
    paddingBottom: 14,
  },
  headline: {
    fontFamily: fonts.outfit_bold,
    fontSize: 23.5,
    lineHeight: 28,
    color: colors.ink,
  },
  headline_hl: {
    color: colors.temp_hot,
  },
  subline: {
    marginTop: spacing.s_8,
    fontFamily: fonts.outfit_light,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.gray_3,
  },
  subline_hl: {
    fontFamily: fonts.outfit_medium,
    color: colors.temp_cooling,
  },
});
