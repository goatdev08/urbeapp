// Config dinámica en JS plano (no TS) para evitar la transpilación con ts-node,
// que falla al leer el config en el servidor de EAS bajo pnpm. Ver tarea #1.
module.exports = ({ config }) => ({
  ...config,
  name: 'Urbea',
  slug: 'urbea',
  owner: 'deabratech',
  // 1.0.1: expo-image + expo-splash-screen (módulos nativos) → nuevo runtime
  // OTA; los builds 1.0.0 ya no reciben updates (instalar el APK nuevo).
  // 1.0.2: expo-glass-effect (módulo nativo, tab bar glass) → nuevo runtime OTA.
  // 1.0.3: expo-web-browser (módulo nativo, Google OAuth #72) → nuevo runtime OTA;
  // los builds 1.0.2 (2026-07-24) ya no reciben updates (instalar build nuevo).
  // 1.0.4: splash e ícono corregidos (#114) — sin módulos nativos nuevos, pero el
  // asset del isotipo entra en la huella del fingerprint (`expoConfigExternalFile`),
  // así que el runtime cambia igual y los 1.0.3 dejan de recibir estos updates.
  // Se sube `version` para que dos builds con splash distinto no se llamen igual.
  // 1.0.5 (#143.3/#143.5): ícono y splash regenerados EXACTOS del spec
  // urbea-logo-final.html (verde #1A5E44 + U carnita #EEE4D0, misma cara en
  // iOS y Android) + splash con asset recortado propio (splash-icon.png).
  // Assets nativos → fingerprint nuevo → los 1.0.4 no reciben estos updates.
  // 1.0.6 (#148/#154): el re-export de #143 horneó fondo BLANCO en splash-icon
  // y android-icon-foreground (alpha uniforme opaco — la 1.0.5 muestra el cuadro
  // blanco tras la U). PNGs des-mezclados a alfa real (PR #69). Assets nativos →
  // fingerprint nuevo → los 1.0.5 no reciben los updates de este runtime.
  version: '1.0.6',
  orientation: 'portrait',
  scheme: 'urbea',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.urbea.app',
    infoPlist: {
      // Urbea solo usa HTTPS estándar (Supabase, Google APIs) → cifrado exento.
      // Declararlo salta el prompt de "export compliance" en cada build de TestFlight.
      ITSAppUsesNonExemptEncryption: false,
    },
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
  // --channel preview`. runtimeVersion por `fingerprint` (#67): EAS calcula la
  // huella del código nativo (deps, config, plugins) y decide solo si un cambio
  // cabe por OTA o exige rebuild — se acaba el adivinar y subir `version` a mano.
  // Un cambio nativo genera huella distinta → EAS lo separa del canal OTA viejo
  // automáticamente. checkAutomatically ON_LOAD: el update se descarga al abrir y
  // se aplica al siguiente arranque.
  updates: {
    url: 'https://u.expo.dev/85c7157a-818c-43fd-a78f-9766c2bc6f6f',
    checkAutomatically: 'ON_LOAD',
  },
  runtimeVersion: {
    policy: 'fingerprint',
  },
  plugins: [
    'expo-dev-client',
    'expo-router',
    // Splash de marca: isotipo carnita sobre el verde del logo (misma cara que
    // el ícono de app) — elimina el flash blanco del arranque. El JS lo suelta
    // con hideAsync() cuando las fuentes cargaron (app/_layout.tsx).
    //
    // #114 — `image` DEBE tener alfa real. Hasta 2026-08-08 el PNG venía con el
    // fondo BLANCO OPACO horneado, así que el splash salía como un cuadro blanco
    // de 220pt sobre el verde (y en Android ese mismo foreground tapaba el
    // background verde del adaptive icon). El plugin no aplana nada: sin
    // backgroundColor ni removeTransparency, @expo/image-utils preserva el alfa
    // — el defecto estaba en el asset. Si alguien vuelve a exportarlo, verificar
    // el canal alfa ANTES de commitear.
    //
    // #143.3: asset propio del splash (splash-icon.png) = la U RECORTADA a su
    // caja (75% del ancho del PNG, sin el colchón del adaptive foreground).
    // imageWidth 96 → la marca mide ~72dp: la proporción de la referencia
    // aprobada (logo carnita centrado y discreto sobre el verde pleno).
    ['expo-splash-screen', {
      image: './assets/splash-icon.png',
      imageWidth: 96,
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
