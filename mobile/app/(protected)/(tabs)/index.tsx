/**
 * (tabs)/index.tsx — Tab "Home" (feed vertical).
 *
 * Solo delega a FeedScreen; la lógica vive en features/feed/ siguiendo
 * la convención del repo (rutas finas, feature fat).
 */

import { FeedScreen } from '@/features/feed/FeedScreen';

export default function HomeScreen() {
  return <FeedScreen />;
}
