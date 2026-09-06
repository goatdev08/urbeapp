/**
 * BandHeader — cabecera de una banda de tendencia del CRM (#267.5).
 *
 * Preview: mobile/design-previews/267-crm-santiago.html (`.band-head` — ícono
 * 19px de color de banda + nombre + count mono + subtítulo + chevron
 * opcional). "En silencio" nace colapsada (decisión de Abraham 2026-09-06,
 * la aplica el padre vía `collapsed`/`onToggle`; este componente no decide
 * el estado inicial, solo lo pinta).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CaretDown } from 'phosphor-react-native';

import { colors, fonts, spacing } from '@/theme/theme';
import { BAND_META, band_color } from '../utils/crm_band_meta';
import type { CrmBand } from '../types';

const ICON_SIZE = 19;

export interface BandHeaderProps {
  band: CrmBand;
  count: number;
  collapsed?: boolean;
  onToggle?: () => void;
}

export function BandHeader({ band, count, collapsed = false, onToggle }: BandHeaderProps): React.JSX.Element {
  const meta = BAND_META[band];

  const content = (
    <View style={styles.container}>
      <View style={styles.top_row}>
        <View style={[styles.icon, { backgroundColor: band_color(band) }]} />
        <Text style={styles.name} numberOfLines={1}>
          {meta.label}
        </Text>
        <Text style={styles.count}>{count}</Text>
        {onToggle ? (
          <CaretDown
            size={14}
            color={colors.gray_2}
            weight="bold"
            style={collapsed ? styles.chevron_collapsed : undefined}
          />
        ) : null}
      </View>
      <Text style={styles.subtitle} numberOfLines={2}>
        {meta.subtitle}
      </Text>
    </View>
  );

  if (!onToggle) {
    return content;
  }

  return (
    <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: !collapsed }}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 2,
  },
  top_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8,
  },
  icon: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: 6,
    flexShrink: 0,
  },
  name: {
    flex: 1,
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
    color: colors.ink,
  },
  count: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.gray_2,
  },
  chevron_collapsed: {
    transform: [{ rotate: '-90deg' }],
  },
  subtitle: {
    marginLeft: ICON_SIZE + spacing.s_8,
    fontFamily: fonts.outfit_light,
    fontSize: 11,
    lineHeight: 14,
    color: colors.gray_2,
  },
});
