/**
 * Ruta Stack — perfil público de un agente (acceso desde property cards).
 * Vive fuera del grupo (tabs) para comportarse como pantalla modal/stack
 * que puede abrirse desde cualquier parte de la app.
 * Stub de navegación (subtarea 16.1).
 *
 * TODO 16.x: reusar ProfileHeader + PropertiesGrid con el id de la ruta.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

export default function AgentProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Perfil agente {id}</Text>
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
  label: {
    fontSize: 20,
    fontWeight: '500',
  },
});
