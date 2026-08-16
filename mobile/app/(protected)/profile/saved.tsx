/**
 * Ruta Stack — "Guardados" abierto desde el perfil (180.4).
 *
 * ⚠️ POR QUÉ EXISTE si ya hay una pantalla `(tabs)/saved`:
 * ese tab está registrado con `href: null` para los AGENTES (#65: Guardados
 * ocupa el 4º slot de la barra solo para no-agentes; el agente ve Leads ahí).
 * `href: null` no solo lo saca de la barra — expo-router deja de considerar la
 * ruta navegable, así que `router.push('/saved')` desde el perfil de un agente
 * se descartaba EN SILENCIO: el botón no hacía nada. El bug venía desde que
 * la opción vivía en el menú "⋯"; 180.2 solo lo hizo visible.
 *
 * Se resuelve con una ruta propia del Stack en vez de tocar la tab bar
 * (componente delicado, dos implementaciones por plataforma). Bonus: al ser
 * Stack trae header con regreso — antes, entrando desde el perfil, no había
 * forma de volver salvo la tab bar.
 *
 * Misma pantalla para ambos caminos (`SavedScreen`), sin duplicar nada: solo
 * cambian las dos props de layout (aquí no hay tab bar debajo).
 */
import React from 'react';
import { Stack } from 'expo-router';

import { SavedScreen } from '@/features/saved/SavedScreen';
import { colors } from '@/theme/theme';

export default function ProfileSavedRoute(): React.JSX.Element {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true, // el Stack de (protected) trae headerShown:false por defecto
          headerBackButtonDisplayMode: 'minimal', // solo chevron, sin "(tabs)"
          title: 'Guardados',
          headerStyle: { backgroundColor: colors.paper },
          headerTintColor: colors.primary,
          headerTitleStyle: {
            fontFamily: 'HankenGrotesk_600SemiBold',
            color: colors.ink,
            fontSize: 17,
          },
        }}
      />
      {/* Sin tab bar debajo (Stack) y con header propio: ni despeje inferior
          ni el respiro superior que el tab necesita bajo el status bar. */}
      <SavedScreen under_floating_tab_bar={false} has_header />
    </>
  );
}
