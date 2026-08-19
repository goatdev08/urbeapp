/**
 * AdFeedItem.tsx — PLACEHOLDER mínimo (subtarea 170.4, resolución del
 * acoplamiento oculto con 170.8 documentada en la bitácora de la tarea
 * padre 170).
 *
 * 170.8 (AdFeedItem real + gate de diseño, preview HTML aprobable) tiene una
 * aprobación humana de duración indeterminada. Este placeholder existe SOLO
 * para que `render_item` de FeedScreen.tsx (GREEN de 170.4) pueda rutear
 * `item.kind === 'ad'` hacia un componente real sin bloquear el cierre de
 * 170.4 en el gate de 170.8. 170.8 LO REEMPLAZA por completo tras la
 * aprobación del cliente — no inviertas esfuerzo en su apariencia aquí.
 *
 * ponytail: sin reproducción de video (mint/firma de video para anuncios NO
 * es parte del footprint de 170.4 — cloudflare_uid del anuncio todavía no
 * tiene un pipeline de signed URL propio) ni badge final: placeholder plano
 * oscuro + texto "Patrocinado" + título, para que 170.4 type-checkee.
 * 170.8 reemplaza esto entero.
 *
 * No es el SUT de ningún test de 170.4: es UI de scaffolding (categoría
 * "ligera" de CLAUDE.md §5, igual que 170.8 la clasifica), no lógica de
 * negocio — por eso no lleva stub-que-lanza ni test RED propio.
 */

import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { colors, spacing, type_scale } from '@/theme/theme';

import type { FeedAd } from '../lib/interleaveAds';

export type AdFeedItemProps = {
  ad: FeedAd;
  isActive: boolean;
};

export function AdFeedItem({ ad }: AdFeedItemProps) {
  const { height } = useWindowDimensions();

  return (
    <View style={[styles.root, { height }]}>
      <Text style={styles.badge}>Patrocinado</Text>
      <Text style={styles.title}>{ad.title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    backgroundColor: colors.ink_feed,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s_12,
  },
  badge: {
    color: colors.gray_1,
    fontSize: type_scale.caption.fontSize,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  title: {
    color: colors.gray_1,
    fontSize: type_scale.body.fontSize,
    paddingHorizontal: spacing.s_24,
    textAlign: 'center',
  },
});
