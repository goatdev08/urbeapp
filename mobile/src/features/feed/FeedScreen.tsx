/**
 * FeedScreen.tsx — Feed vertical inmersivo, estilo TikTok.
 *
 * Usa FlashList v2 (@shopify/flash-list 2.0.2) con snap por ítem full-screen.
 * Por ahora los datos son mock; la query real + signed URLs llegan en 9.5.
 *
 * ponytail: datos mock hardcoded (3 ítems) para validar el scaffold y el snap.
 * La query real (supabase + EF mint-video-url) se conecta en subtarea 9.5.
 */

import { StyleSheet, TouchableOpacity, Text, View, useWindowDimensions } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';

import { colors } from '@/theme/theme';

import { FeedItemPlaceholder } from './components/feed-item-placeholder';
import type { FeedPropertyWithUrl } from './types';

const MOCK_FEED: FeedPropertyWithUrl[] = [
  {
    id: '1',
    price: 250000,
    address: 'Av. Corrientes 1234, CABA',
    bedrooms: 2,
    bathrooms: 1,
    owner_user_id: 'u1',
    agency_id: null,
    created_at: '2024-01-01T00:00:00Z',
    video: { id: 'v1', storage_path: 'videos/v1.mp4', position: 0 },
    signed_url: '',
    video_id: 'v1',
  },
  {
    id: '2',
    price: 180000,
    address: 'Thames 532, Palermo, CABA',
    bedrooms: 1,
    bathrooms: 1,
    owner_user_id: 'u2',
    agency_id: 'a1',
    created_at: '2024-01-02T00:00:00Z',
    video: { id: 'v2', storage_path: 'videos/v2.mp4', position: 0 },
    signed_url: '',
    video_id: 'v2',
  },
  {
    id: '3',
    price: 320000,
    address: 'Libertador 4200, Núñez, CABA',
    bedrooms: 3,
    bathrooms: 2,
    owner_user_id: 'u3',
    agency_id: null,
    created_at: '2024-01-03T00:00:00Z',
    video: { id: 'v3', storage_path: 'videos/v3.mp4', position: 0 },
    signed_url: '',
    video_id: 'v3',
  },
];

export function FeedScreen() {
  const { height } = useWindowDimensions();
  const router = useRouter();

  return (
    <View style={styles.root}>
      {/* ponytail: FlashList v2 (2.0.2) mide ítems automáticamente (new arch);
          estimatedItemSize ya no existe. Los ítems fijan su propio height=screenHeight. */}
      <FlashList
        data={MOCK_FEED}
        keyExtractor={(item) => item.id}
        pagingEnabled
        snapToInterval={height}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <FeedItemPlaceholder item={item} height={height} />
        )}
      />

      {/* ponytail: botón flotante temporal — único acceso al wizard de publicación
          del #8 mientras el feed no tenga overlay CTA definitivo. Retirar en 9.6
          o cuando exista el CTA de overlay. */}
      <TouchableOpacity
        style={styles.publish_btn}
        onPress={() => router.push('/publish/step1')}
        accessibilityLabel="Publicar propiedad"
      >
        <Text style={styles.publish_btn_text}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.ink_feed,
  },
  publish_btn: {
    position: 'absolute',
    bottom: 32,
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  publish_btn_text: {
    color: '#FFFFFF',
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '400',
  },
});
