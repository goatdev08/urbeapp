/**
 * feed-item-placeholder.tsx — Item de feed temporal para validar el snap.
 *
 * ponytail: placeholder mínimo — muestra dirección + precio sobre fondo oscuro
 * para verificar que FlashList pagina correctamente. Reemplazar en 9.2/9.6
 * con el componente real de video (expo-video + overlay de datos).
 */

import { StyleSheet, Text, View } from 'react-native';

import { colors, type_scale } from '@/theme/theme';
import type { FeedPropertyWithUrl } from '../types';

type Props = {
  item: FeedPropertyWithUrl;
  height: number;
};

export function FeedItemPlaceholder({ item, height }: Props) {
  return (
    <View style={[styles.root, { height }]}>
      <Text style={styles.address}>{item.address}</Text>
      <Text style={styles.price}>${item.price.toLocaleString()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    backgroundColor: colors.ink_feed,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 80,
  },
  address: {
    ...type_scale.body,
    color: '#FFFFFF',
    marginBottom: 8,
  },
  price: {
    ...type_scale.h1,
    color: '#FFFFFF',
  },
});
