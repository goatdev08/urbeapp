/**
 * ProfileActions — fila de acciones del perfil, entre la bio y la grilla.
 *
 * Subtarea 180.2 (referencia anotada por Abraham: los botones "Editar perfil"
 * / "Compartir perfil" de Instagram, a ancho completo bajo la bio).
 *
 * Antes estas acciones vivían SOLO dentro del menú "⋯" flotante: las dos que
 * se usan a diario ("Editar perfil" y "Guardados") quedaban a dos toques y sin
 * pista visual. Aquí salen a la superficie; el menú conserva el resto.
 *
 *   - Perfil propio → 2 botones iguales lado a lado: Editar perfil · Guardados.
 *   - Perfil ajeno  → 1 botón del mismo alto y forma: Contactar por WhatsApp.
 *     Se OMITE si el agente no tiene teléfono (nada que abrir).
 *
 * En los tres botones el texto va pegado a la izquierda y el ícono Phosphor al
 * extremo derecho (petición de Abraham, 2026-08-16).
 *
 * ponytail: botones locales en vez de `PrimaryButton` — ese es el CTA salvia
 * de acción principal (BlurView, alto 52); esta fila es secundaria y de
 * superficie clara, como la referencia. Sin componente nuevo en el design
 * system hasta que un segundo consumidor lo pida.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BookmarkSimple, PencilSimple, WhatsappLogo } from 'phosphor-react-native';

import { colors, fonts, radii, spacing } from '@/theme/theme';
import { open_whatsapp_text } from '@/features/property-detail/utils/whatsapp';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface ProfileActionsProps {
  is_own_profile: boolean;
  /** Perfil propio → navega a /profile/edit. */
  on_edit_profile: () => void;
  /** Perfil propio → navega a /saved. */
  on_saved: () => void;
  /** Perfil ajeno → teléfono del agente (users.phone). null → sin botón. */
  phone: string | null;
  /** Nombre del agente para el saludo del mensaje prefill. */
  agent_name: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function ProfileActions({
  is_own_profile,
  on_edit_profile,
  on_saved,
  phone,
  agent_name,
}: ProfileActionsProps): React.JSX.Element | null {
  if (is_own_profile) {
    return (
      <View style={styles.row}>
        <Pressable
          onPress={on_edit_profile}
          accessibilityRole="button"
          accessibilityLabel="Editar perfil"
          style={({ pressed }) => [styles.button, pressed && styles.button_pressed]}
        >
          <Text style={styles.button_text}>Editar perfil</Text>
          <PencilSimple size={ICON_SIZE} color={colors.ink} />
        </Pressable>

        <Pressable
          onPress={on_saved}
          accessibilityRole="button"
          accessibilityLabel="Ver guardados"
          style={({ pressed }) => [styles.button, pressed && styles.button_pressed]}
        >
          <Text style={styles.button_text}>Guardados</Text>
          {/* Mismo ícono que la pantalla de Guardados y el botón de guardar
              del feed (SaveButton) — una sola señal visual para el concepto. */}
          <BookmarkSimple size={ICON_SIZE} color={colors.ink} />
        </Pressable>
      </View>
    );
  }

  // Sin teléfono no hay nada que abrir: se omite la fila entera en vez de
  // pintar un botón muerto.
  if (phone === null || phone.trim() === '') return null;

  const greeting = agent_name != null ? `Hola ${agent_name}` : 'Hola';

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => open_whatsapp_text(phone, `${greeting}, vi tu perfil en Urbea y quiero contactarte.`)}
        accessibilityRole="button"
        accessibilityLabel="Contactar por WhatsApp"
        style={({ pressed }) => [styles.button, pressed && styles.button_pressed]}
      >
        <Text style={styles.button_text}>Contactar por WhatsApp</Text>
        <WhatsappLogo size={ICON_SIZE} color={colors.ink} weight="fill" />
      </Pressable>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const ICON_SIZE = 17;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.s_8,
    marginTop: spacing.s_16,
  },
  // Texto pegado a la izquierda e ícono al extremo derecho (petición de
  // Abraham, 2026-08-16): `space-between` en vez de centrar el par.
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s_8,
    paddingHorizontal: spacing.s_12,
    height: 38,
    borderRadius: radii.r_12,
    backgroundColor: colors.paper_2,
    borderWidth: 1,
    borderColor: colors.paper_3,
  },
  button_pressed: {
    backgroundColor: colors.paper_3,
  },
  button_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    color: colors.ink,
    flexShrink: 1,
  },
});
