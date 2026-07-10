'use strict';

/* global __dirname */
const path = require('path');

/** @type {import('jest-expo').Config} */
module.exports = {
  preset: 'jest-expo',
  // Mock oficial de react-native-gesture-handler (RNGestureHandlerModule nativo
  // no existe bajo Jest) — necesario desde #58.2: RadiusSelector usará
  // GestureDetector/Gesture para el slider continuo (drag). setupFiles (no
  // setupFilesAfterEnv) porque debe correr ANTES del registro de mocks del
  // framework, tal como recomienda la doc oficial del paquete.
  setupFiles: ['react-native-gesture-handler/jestSetup'],
  setupFilesAfterEnv: ['./jest.setup.js'],
  // En pnpm hoisted el path real de node_modules es:
  //   node_modules/.pnpm/<pkg@ver>/node_modules/<pkg>/...
  // El regex del preset de jest-expo falla porque el segundo "/node_modules/"
  // vuelve a activar el ignore. Usamos el patrón que excluye el bloque .pnpm
  // completo + los paquetes RN/Expo habituales.
  transformIgnorePatterns: [
    'node_modules/(?!.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@supabase)',
  ],
  // Resuelve el alias @/ → src/ (espeja tsconfig paths)
  moduleNameMapper: {
    '^@/(.*)$': path.resolve(__dirname, 'src/$1'),
  },
};
