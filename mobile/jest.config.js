'use strict';

const path = require('path');

/** @type {import('jest-expo').Config} */
module.exports = {
  preset: 'jest-expo',
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
