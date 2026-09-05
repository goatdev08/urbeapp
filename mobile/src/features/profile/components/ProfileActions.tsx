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
 * ── WhatsApp por RPC (#255) ──────────────────────────────────────────────
 * El botón decide con `has_phone` (derivado, vista agent_public_profiles) en
 * vez del `phone` crudo — así sobrevive a que RLS oculte la fila de `users`
 * de un publicador role='admin' (#250, caso Vladimir en producción). Al
 * pulsar, el número REAL se resuelve server-side vía
 * `supabase.rpc('whatsapp_phone_for_profile', { p_user_id })`: esa RPC decide
 * de nuevo (agent/admin, vivo, con teléfono) — el cliente nunca confía solo en
 * `has_phone` para abrir WhatsApp. Sin número (`data: null`) no abre nada:
 * fail-soft, nunca truena. `resolving` deshabilita el botón mientras la RPC
 * está en vuelo (barato, sin componente nuevo) para evitar doble toque.
 *
 * ponytail: botones locales en vez de `PrimaryButton` — ese es el CTA salvia
 * de acción principal (BlurView, alto 52); esta fila es secundaria y de
 * superficie clara, como la referencia. Sin componente nuevo en el design
 * system hasta que un segundo consumidor lo pida.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BookmarkSimple, PencilSimple, WhatsappLogo } from 'phosphor-react-native';

import { colors, fonts, radii, spacing } from '@/theme/theme';
import { supabase } from '@/lib/supabase/client';
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
  /**
   * Perfil ajeno → derivado (agent_public_profiles.has_phone, #255): true si
   * el agente tiene teléfono capturado. false → sin botón. El número crudo
   * NUNCA llega como prop — se resuelve al pulsar, vía RPC.
   */
  has_phone: boolean;
  /** Perfil ajeno → user_id del agente, para resolver su teléfono vía RPC al pulsar. */
  agent_user_id: string;
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
  has_phone,
  agent_user_id,
  agent_name,
}: ProfileActionsProps): React.JSX.Element | null {
  // Deshabilita el botón mientras la RPC resuelve el número — evita doble
  // toque (dos pestañas de WhatsApp / dos llamadas concurrentes).
  const [resolving, set_resolving] = useState(false);

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
  if (!has_phone) return null;

  const greeting = agent_name != null ? `Hola ${agent_name}` : 'Hola';

  async function handle_press(): Promise<void> {
    if (resolving) return; // candado anti doble-toque
    set_resolving(true);
    try {
      // El número crudo se resuelve AQUÍ, server-side — la RPC vuelve a
      // decidir (agent/admin, vivo, con teléfono) sin confiar en `has_phone`
      // como autorización.
      const { data: resolved_phone, error } = await supabase.rpc(
        'whatsapp_phone_for_profile',
        { p_user_id: agent_user_id }
      );
      if (error) {
        // Fail-soft: no abre nada, no truena. Sin PII en el log — nunca
        // agent_user_id ni el teléfono, solo el código del error.
        console.warn('[ProfileActions] whatsapp_phone_for_profile falló', error.code ?? 'rejected');
        return;
      }
      if (resolved_phone) {
        open_whatsapp_text(
          resolved_phone,
          `${greeting}, vi tu perfil en Urbea y quiero contactarte.`
        );
      }
    } catch (err) {
      // La RPC rechazó (red caída, etc.) en vez de resolver con {error} —
      // mismo trato: sin PII, no truena, no abre nada.
      const code = (err as { code?: string } | null)?.code ?? 'rejected';
      console.warn('[ProfileActions] whatsapp_phone_for_profile falló', code);
    } finally {
      set_resolving(false);
    }
  }

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => {
          void handle_press();
        }}
        disabled={resolving}
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
