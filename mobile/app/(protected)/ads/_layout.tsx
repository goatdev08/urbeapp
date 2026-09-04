/**
 * Layout del grupo `ads/` — gate de CAPACIDAD por RUTA (subtarea 169.8;
 * ampliado en 212.5 con el fallback de exploración 040).
 *
 * 🔴 Sin capacidad NI anuncios previos la RUTA NO EXISTE — no basta ocultar
 * un botón, porque un deep link (`urbea://ads/...`) la alcanzaría igual.
 * Mismo patrón que mobile/src/features/admin/admin-layout.tsx y
 * mobile/app/(protected)/agency/invitations.tsx (useAgencyRole().isOwner +
 * Redirect), aplicado aquí sobre useCanAdvertise() + useMyAds().
 *
 * 🔴 212.5 (decisión registrada en .taskmaster/docs/exploraciones/040-
 * comercial-completo-stats-y-promocion.md): la entrada es visible/alcanzable
 * si `can_advertise` **O** la organización YA tiene ≥1 anuncio propio — una
 * capacidad revocada DESPUÉS de haber anunciado no debe esconder el
 * dashboard de estadísticas de anuncios que ya circularon. useMyAds() ya
 * falla cerrado por su cuenta (ver su docblock: cualquier error ⇒ ads=[]) —
 * basta leer `.ads.length` aquí, sin duplicar su lógica de RLS/membresía.
 *
 * Contrato:
 *   - can_advertise loading=true → indicador de carga; el Stack NUNCA se
 *     monta (mismo criterio que antes de 212.5 — useMyAds() SIEMPRE se
 *     invoca porque los hooks no pueden ser condicionales, pero su
 *     resultado se ignora mientras la capacidad no resuelve).
 *   - can_advertise=true (ya resuelto) → <AdsStack/> DE INMEDIATO, sin esperar
 *     a useMyAds() — la capacidad sola ya autoriza; bloquear aquí solo
 *     agregaría latencia a la ruta más común (anunciante activo).
 *   - can_advertise=false (ya resuelto) → SOLO entonces se espera a
 *     useMyAds(): con ≥1 anuncio propio → <AdsStack/>; con 0 (o su propio
 *     error, que ya deja ads=[]) → <Redirect> fuera de ads/.
 *
 * 🔴 #251 — el contenido autorizado es un <Stack/>, NO un <Slot/>. Un <Slot/>
 * es un navigator SIN chrome: las pantallas hijas que declaran
 * `<Stack.Screen options={{ headerShown: true }}>` (index.tsx, [id].tsx) le
 * hablan a ESTE navigator, y con Slot su setOptions no pintaba nada — el
 * ScrollView del detalle arrancaba en y=0 y el selector Hoy/30 días/Máximo
 * quedaba bajo el reloj y los íconos de estado (smoke #222, iPhone 17). Las
 * demás pantallas de gestión con header nativo (agency/*, profile/*) no
 * tienen _layout propio y cuelgan directo del <Stack> de protected-layout,
 * por eso a ellas sí se les pinta. screenOptions calca ese Stack ambiental
 * (headerShown:false por defecto — el wizard ads/new/ trae su propio
 * WizardHeader; cada pantalla enciende el suyo si lo quiere).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';

import { UrbeaLoader } from '@/components/UrbeaLoader';
import { useCanAdvertise } from '@/features/ads/hooks/useCanAdvertise';
import { useMyAds } from '@/features/ads/hooks/useMyAds';
import { colors } from '@/theme/theme';

// ponytail: un componente de una línea en vez de repetir el <Stack> en los
// tres puntos de retorno del gate.
function AdsStack(): React.ReactElement {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        animation: 'slide_from_right',
      }}
    />
  );
}

export default function AdsLayout(): React.ReactElement {
  const { can_advertise, loading: capability_loading } = useCanAdvertise();
  // Invocado SIEMPRE (regla de hooks) — su resultado solo se consulta en la
  // rama can_advertise=false, ver docblock.
  const my_ads = useMyAds();

  if (capability_loading) {
    return (
      <View style={styles.center} testID="ads-gate-loading">
        <UrbeaLoader size="large" color={colors.primary} />
      </View>
    );
  }

  if (can_advertise) {
    return <AdsStack />;
  }

  if (my_ads.loading) {
    return (
      <View style={styles.center} testID="ads-gate-loading">
        <UrbeaLoader size="large" color={colors.primary} />
      </View>
    );
  }

  if (my_ads.ads.length > 0) {
    return <AdsStack />;
  }

  return <Redirect href="/(protected)/(tabs)/profile" />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
  },
});
