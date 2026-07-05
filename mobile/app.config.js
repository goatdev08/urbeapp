// Config dinámica en JS plano (no TS) para evitar la transpilación con ts-node,
// que falla al leer el config en el servidor de EAS bajo pnpm. Ver tarea #1.
module.exports = ({ config }) => ({
  ...config,
  name: 'Urbea',
  slug: 'urbea',
  owner: 'deabratech',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'urbea',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.urbea.app',
    // Sin googleMapsApiKey: react-native-maps 1.27 ya no publica el pod de
    // Google Maps para iOS (el podspec react-native-google-maps no existe y
    // rompe `pod install`). En iOS el MapView usa Apple Maps (provider default).
  },
  android: {
    package: 'com.urbea.app',
    adaptiveIcon: {
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      // Sin monochromeImage: la capa themed-icon (Android 13+) del símbolo se leía
      // mal al tintarse; se usa el adaptive normal (foreground carnita + bg verde).
      backgroundColor: '#1A5E44', // verde del logo — fallback del adaptive icon (#43.3)
    },
    predictiveBackGestureEnabled: false,
    config: {
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_API_KEY ?? '',
      },
    },
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-dev-client',
    'expo-router',
    ['expo-video', {
      supportsBackgroundPlayback: false,
      supportsPictureInPicture: false,
    }],
    ['expo-image-picker', {
      photosPermission: 'Urbea necesita acceso a tu galería para elegir tu foto de perfil.',
      cameraPermission: 'Urbea necesita acceso a la cámara para tomar tu foto de perfil.',
      microphonePermission: false,
    }],
  ],
  extra: {
    eas: {
      projectId: '85c7157a-818c-43fd-a78f-9766c2bc6f6f',
    },
  },
});
