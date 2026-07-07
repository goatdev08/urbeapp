/**
 * PropertyOverlay.tsx — Overlay de UI sobre el video en el feed vertical.
 *
 * Composición fiel al mockup de pantalla #4 (feed) de `urbea-identidad-visual.html`:
 * - Gradiente dual (oscuro top 0→26% + oscuro bottom 52→100%) para legibilidad.
 * - feed-info (abajo-izquierda): avatar agente, dirección, precio MXN, specs.
 * - feed-rail (abajo-derecha): corazón (like) + bookmark (guardar).
 *
 * ponytail: solo modo oscuro hardcodeado (#F6F2EB / rgba blancos sobre ink_feed).
 * El dual-mode formal (theme dark) queda pendiente al final de la tarea #9.
 * El avatar del agente muestra la inicial del owner_user_id como placeholder —
 * nombre y foto real requieren join con user_preferences (subtarea futura).
 * El handler onAgentPress es stub (sin ruta de perfil desde el feed aún).
 */

import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Bathtub, Bed, BookmarkSimple, Heart, type Icon, ShareNetwork, WhatsappLogo } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts, spacing } from '@/theme/theme';
import type { FeedPropertyWithUrl } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Formatea precio en MXN sin decimales: $15,000 */
function format_price(price: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(price);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type PropertyOverlayProps = {
  property: FeedPropertyWithUrl;
  isLiked: boolean;
  isSaved: boolean;
  onLike: () => void;
  onSave: () => void;
  onAgentPress: () => void;
  /** Tap sobre el bloque de info (dirección/precio) → abre el detalle. */
  onPropertyPress: () => void;
  /** Contacto WhatsApp directo desde el feed. null si el agente no tiene teléfono. */
  onWhatsApp: (() => void) | null;
  /** Compartir la propiedad como link al video. */
  onShare: () => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────────────

export function PropertyOverlay({
  property,
  isLiked,
  isSaved,
  onLike,
  onSave,
  onAgentPress,
  onPropertyPress,
  onWhatsApp,
  onShare,
}: PropertyOverlayProps) {
  const insets = useSafeAreaInsets();

  // ponytail: inicial como placeholder de avatar — foto/nombre del agente
  // requieren join con user_preferences; diferido a subtarea de enriquecimiento del feed.
  const agent_initial = property.owner_user_id.charAt(0).toUpperCase();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">

      {/* Gradiente dual — oscurece top (status bar) y bottom (info).
          Valores del CSS del mockup: rgba(23,20,15,.35) 0%, transparent 26% 52%,
          rgba(23,20,15,.86) 100%. Hardcodeado con ink_feed porque el feed es
          siempre oscuro (ponytail: dual-mode formal diferido a #9). */}
      <LinearGradient
        colors={[
          'rgba(23,20,15,0.35)',
          'transparent',
          'transparent',
          'rgba(23,20,15,0.86)',
        ]}
        locations={[0, 0.26, 0.52, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Rail derecho — like y guardar (estilo TikTok) */}
      <View
        style={[styles.rail, { bottom: insets.bottom + RAIL_BOTTOM }]}
        pointerEvents="box-none"
      >
        <ActionButton
          icon={Heart}
          active={isLiked}
          onPress={onLike}
          accessibilityLabel={isLiked ? 'Quitar like' : 'Dar like'}
        />
        <ActionButton
          icon={BookmarkSimple}
          active={isSaved}
          onPress={onSave}
          accessibilityLabel={isSaved ? 'Quitar de guardados' : 'Guardar propiedad'}
        />

        {/* WhatsApp directo — visible solo si el agente tiene teléfono.
            Verde de marca WhatsApp para reconocimiento inmediato. */}
        {onWhatsApp && (
          <Pressable
            onPress={onWhatsApp}
            style={({ pressed }) => [styles.whatsapp_btn, pressed && styles.btn_pressed]}
            accessibilityRole="button"
            accessibilityLabel="Contactar por WhatsApp"
          >
            <WhatsappLogo size={24} color="#FFFFFF" weight="fill" />
          </Pressable>
        )}

        {/* Compartir — link al video, glass neutro como like/guardar. */}
        <ActionButton
          icon={ShareNetwork}
          active={false}
          onPress={onShare}
          accessibilityLabel="Compartir propiedad"
        />
      </View>

      {/* Info inferior izquierda — avatar, dirección, precio, specs */}
      <View
        style={[styles.info, { bottom: insets.bottom + INFO_BOTTOM }]}
        pointerEvents="box-none"
      >
        {/* Avatar del agente */}
        <Pressable
          onPress={onAgentPress}
          style={styles.agent_row}
          accessibilityRole="button"
          accessibilityLabel="Ver perfil del agente"
        >
          <View style={styles.agent_avatar}>
            <Text style={styles.agent_initial} numberOfLines={1}>
              {agent_initial}
            </Text>
          </View>
        </Pressable>

        {/* Bloque de info tappable → abre el detalle (/property/[id]).
            Separado del avatar (onAgentPress) y del doble-tap del video (like). */}
        <Pressable
          onPress={onPropertyPress}
          accessibilityRole="button"
          accessibilityLabel="Ver detalle de la propiedad"
        >
          {/* Dirección (título en el feed) */}
          <Text style={styles.address} numberOfLines={2}>
            {property.address}
          </Text>

          {/* Precio en MXN */}
          <Text style={styles.price} numberOfLines={1}>
            {format_price(property.price)}
          </Text>

          {/* Specs: recámaras y baños con íconos */}
          <View style={styles.specs_row} pointerEvents="none">
            <Bed size={14} color={SPEC_COLOR} weight="bold" />
            <Text style={styles.spec_text}>{property.bedrooms}</Text>

            <View style={styles.spec_divider} />

            <Bathtub size={14} color={SPEC_COLOR} weight="bold" />
            <Text style={styles.spec_text}>{property.bathrooms}</Text>
          </View>
        </Pressable>
      </View>

    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponente ActionButton (rail)
// ─────────────────────────────────────────────────────────────────────────────

type ActionButtonProps = {
  icon: Icon;
  active: boolean;
  onPress: () => void;
  accessibilityLabel: string;
};

function ActionButton({
  icon: IconCmp,
  active,
  onPress,
  accessibilityLabel,
}: ActionButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      // Feedback táctil: encoge al presionar (fluidez percibida, flash 2026-07-06)
      style={({ pressed }) => [styles.action_btn, pressed && styles.btn_pressed]}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
    >
      <IconCmp
        size={22}
        // Activo = verde claro de marca (cohesión con el acento verde del logo)
        color={active ? colors.primary_soft : '#FFFFFF'}
        weight={active ? 'fill' : 'bold'}
      />
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de layout
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Offsets sobre insets.bottom para posicionar info y rail por encima del
 * tab bar (~49pt) con margen. Del mockup: info bottom:118, rail bottom:140
 * (relativos a una pantalla de ~580px de alto con tab bar de ~60px).
 * ponytail: valores hardcodeados (49pt tabBar + margen); se ajustan cuando
 * el feed pase a pantalla completa con tab bar oculto (ver task #9 final).
 */
const INFO_BOTTOM = 80;  // ~49pt tab bar + 31pt margen
const RAIL_BOTTOM = 100; // ~49pt tab bar + 51pt margen (rail arranca más arriba)

/** Color de texto de specs — blanco cálido semitransparente. Hardcodeado porque
 * el feed es siempre oscuro (ponytail: dual-mode diferido). */
const SPEC_COLOR = 'rgba(246,242,235,0.85)';

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Rail derecho
  rail: {
    position: 'absolute',
    right: 14,
    flexDirection: 'column',
    gap: 22,          // expo SDK 56 / RN 0.76+ soporta gap en estilos
    alignItems: 'center',
  },
  action_btn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    // ponytail: glass pill oscuro hardcodeado — colores del mockup .fbtn
    backgroundColor: 'rgba(23,20,15,0.36)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  whatsapp_btn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    // Verde WhatsApp sólido — CTA de contacto reconocible en el rail.
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Estado presionado de los botones del rail — encoge + atenúa. */
  btn_pressed: {
    transform: [{ scale: 0.88 }],
    opacity: 0.85,
  },

  // Info inferior izquierda
  info: {
    position: 'absolute',
    left: 16,
    right: 74, // deja margen para el rail (14px right + 46px ancho + 14px gap)
  },
  agent_row: {
    marginBottom: spacing.s_12,
    alignSelf: 'flex-start',
  },
  agent_avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    // ponytail: color placeholder marrón cálido — foto real requiere join user_preferences
    backgroundColor: '#6f5742',
    borderWidth: 2,
    borderColor: colors.primary_soft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agent_initial: {
    fontFamily: fonts.sans_bold,
    fontSize: 13,
    color: '#F6F2EB',
  },
  address: {
    fontFamily: fonts.display,
    fontSize: 19,
    lineHeight: 21,        // 1.1 del mockup
    letterSpacing: -0.19,  // -0.01em @ 19px
    // ponytail: colors.paper = #F6F2EB — blanco cálido que ya es el valor correcto
    color: colors.paper,
    marginBottom: spacing.s_4,
  },
  price: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: -0.22,
    color: '#FFFFFF',
    marginBottom: spacing.s_8,
  },
  specs_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  spec_text: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: SPEC_COLOR,
  },
  spec_divider: {
    width: 1,
    height: 12,
    // ponytail: hairline silver semitransparente sobre fondo oscuro — hardcodeado
    backgroundColor: 'rgba(194,194,189,0.35)',
    marginHorizontal: spacing.s_4,
  },
});
