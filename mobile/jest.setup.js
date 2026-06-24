// Mock AsyncStorage — evita que los tests que tocan el cliente Supabase exploten
// Patrón oficial: https://react-native-async-storage.github.io/async-storage/docs/advanced/jest/
import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import { jest } from '@jest/globals';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
