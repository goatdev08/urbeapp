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
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fonts, spacing } from '@/theme/theme';
import { crm_header_narrative } from '../utils/crm_narrative';
import type { CrmBand } from '../types';

export interface NarrativeHeaderProps {
  counts: Record<CrmBand, number>;
  top_cooling?: { first_name: string; delta: number } | null;
}

/** [antes, resaltado, después] — resaltado='' si `part` no aparece en `text`. */
function split_on(text: string, part: string | null): [string, string, string] {
  if (!part) return [text, '', ''];
  const idx = text.indexOf(part);
  if (idx === -1) return [text, '', ''];
  return [text.slice(0, idx), part, text.slice(idx + part.length)];
}

export function NarrativeHeader({ counts, top_cooling }: NarrativeHeaderProps): React.JSX.Element {
  const { headline, highlight, subline } = crm_header_narrative(counts, top_cooling);
  const [h_before, h_hl, h_after] = split_on(headline, highlight);

  const cooling_phrase =
    counts.cooling > 0
      ? `${counts.cooling} ${counts.cooling === 1 ? 'se está enfriando' : 'se están enfriando'}`
      : null;
  const [s_before, s_hl, s_after] = subline ? split_on(subline, cooling_phrase) : ['', '', ''];

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
