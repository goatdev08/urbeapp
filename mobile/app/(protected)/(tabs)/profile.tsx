/**
 * Tab "Perfil" — perfil propio del usuario autenticado.
 * Stub de navegación (subtarea 16.1).
 *
 * TODO 16.3/16.4/16.6: ProfileHeader + PropertiesGrid + acciones (editar, cerrar sesión).
 */
import { StyleSheet, Text, View } from 'react-native';

export default function OwnProfileScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Perfil</Text>
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
