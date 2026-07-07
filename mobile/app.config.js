// Config dinámica en JS plano (no TS) para evitar la transpilación con ts-node,
// que falla al leer el config en el servidor de EAS bajo pnpm. Ver tarea #1.
module.exports = ({ config }) => ({
  ...config,
  name: 'Urbea',
  slug: 'urbea',
  owner: 'deabratech',
  // 1.0.1: expo-image + expo-splash-screen (módulos nativos) → nuevo runtime
  // OTA; los builds 1.0.0 ya no reciben updates (instalar el APK nuevo).
  version: '1.0.1',
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
  // EAS Update (OTA): cambios de JS/assets llegan sin recompilar — `eas update
  // --channel preview`. runtimeVersion por appVersion: solo builds con la misma
  // `version` de arriba reciben el update (un módulo nativo nuevo → subir version
  // y recompilar). checkAutomatically ON_LOAD: el update se descarga al abrir y
  // se aplica al siguiente arranque.
  updates: {
    url: 'https://u.expo.dev/85c7157a-818c-43fd-a78f-9766c2bc6f6f',
    checkAutomatically: 'ON_LOAD',
  },
  runtimeVersion: {
    policy: 'appVersion',
  },
  plugins: [
    'expo-dev-client',
    'expo-router',
    // Splash de marca: isotipo carnita sobre el verde del logo (misma cara que
    // el ícono de app) — elimina el flash blanco del arranque. El JS lo suelta
    // con hideAsync() cuando las fuentes cargaron (app/_layout.tsx).
    ['expo-splash-screen', {
      image: './assets/android-icon-foreground.png',
      imageWidth: 220,
      resizeMode: 'contain',
      backgroundColor: '#1A5E44',
    }],
    ['expo-video', {
      supportsBackgroundPlayback: false,
      supportsPictureInPicture: false,
    }],
    ['expo-image-picker', {
      photosPermission: 'Urbea necesita acceso a tu galería para elegir tu foto de perfil.',
      cameraPermission: 'Urbea necesita acceso a la cámara para tomar tu foto de perfil.',
      microphonePermission: false,
    }],
    // Ubicación foreground (#41 Fase B): permiso "when in use". iOS declara
    // NSLocationWhenInUseUsageDescription con este string; Android agrega
    // ACCESS_FINE_LOCATION + ACCESS_COARSE_LOCATION automáticamente. Módulo
    // nativo → requiere un nuevo development build (no Expo Go).
    ['expo-location', {
      locationWhenInUsePermission: 'Urbea necesita acceso a tu ubicación para mostrarte propiedades cercanas.',
    }],
  ],
  extra: {
    eas: {
      projectId: '85c7157a-818c-43fd-a78f-9766c2bc6f6f',
    },
  },
});
