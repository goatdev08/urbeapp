import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { PrimaryButton } from '@/components/PrimaryButton';

export default function HomeScreen() {
  const router = useRouter();
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Urbea</Text>
      {/* ponytail: launcher temporal para llegar al wizard de publicación (#8).
          Retirar cuando exista la navegación/CTA definitiva (feed/tab bar). */}
      <View style={styles.cta}>
        <PrimaryButton
          label="Publicar propiedad"
          surface="light"
          onPress={() => router.push('/publish/step1')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
  },
  cta: {
    marginTop: 24,
  },
});
