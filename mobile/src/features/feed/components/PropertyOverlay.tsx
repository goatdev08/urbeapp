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
 * #145.4: avatar con la FOTO real del agente (vista agent_public_profiles →
 * useR2Urls resuelve key R2 o passthrough de URL legacy) + nombre debajo;
 * fallback a la inicial (del nombre si existe) cuando no hay foto. El tap
 * (avatar o nombre) navega al perfil público vía onAgentPress con feedback
 * de presión (mismo scale/opacity que los botones del rail).
 *
 * 293.3: rail sin cápsula glass (solo caja táctil 46×46) — realce de
 * contraste variante B aprobada en 293.1 (preview
 * .taskmaster/docs/exploraciones/049-rediseno-layout-overlay-feed/preview/overlay.html):
 * cada ícono del rail se dibuja dos veces vía RailIcon (copia negra
 * semitransparente 1px detrás + ícono blanco/verde encima). Conteos bajo
 * like/comentarios con format_count (LikeButton.tsx), ocultos en 0. Fila del
 * agente en línea (avatar 36 · nombre · píldora «Seguir» pegada, gap fijo).
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Platform,
  StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Bathtub, Bed, BookmarkSimple, ChatCircle, Heart, type Icon, ShareNetwork, WhatsappLogo } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FollowButton } from '@/components/FollowButton';
import { format_count } from '@/components/LikeButton';
import { useR2Urls } from '@/hooks/useR2Urls';
import { format_price } from '@/lib/formatPrice';
import { colors, fonts, glass, radii, spacing } from '@/theme/theme';
import type { FeedPropertyWithUrl } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Texto cuando el agente ocultó el precio (price_visible=false). */
const PRICE_HIDDEN_LABEL = 'Precio a consultar';

/** Etiquetas de los chips — mismos mapas que PropertyGridCard (op-badge de la
 * identidad visual: Renta salvia / Venta arcilla). Fallback al valor crudo. */
const OPERATION_LABEL: Record<string, string> = {
  rent: 'Renta',
  sale: 'Venta',
  both: 'Renta/Venta',
};
const PROPERTY_TYPE_LABEL: Record<string, string> = {
  casa: 'Casa',
  departamento: 'Departamento',
  local: 'Local',
  oficina: 'Oficina',
  terreno: 'Terreno',
};

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
  /**
   * Botón de comentarios del rail (289.10) — abre CommentsSheet sobre el feed
   * (sustituye al 4º botón del detalle). Opcional para no romper
   * PropertyOverlay.cacheKey.test.tsx (no lo pasa): sin él el botón no se
   * renderiza.
   */
  onComments?: () => void;
  /** Contador vivo de comentarios (289.10). Fail-open a 0 si se omite. */
  commentCount?: number;
  /**
   * Conteo optimista de likes (293.3/293.2) — VideoFeedItem ya calcula
   * max(0, property.like_count + (isLiked?1:0)) atado a property.id; este
   * componente solo lo pinta. Fail-open a 0 si se omite (oculto, igual que
   * commentCount).
   */
  likeCount?: number;
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
  onComments,
  commentCount,
  likeCount,
}: PropertyOverlayProps) {
  const insets = useSafeAreaInsets();
  const comment_count = commentCount ?? 0;
  const like_count = likeCount ?? 0;

  // #145.4: foto real del agente. agent_photo_url es key R2 o URL legacy —
  // useR2Urls resuelve/pasa según corresponda (fail-soft → null → inicial).
  const { urls: avatar_urls } = useR2Urls([property.agent_photo_url]);
  const avatar_url = avatar_urls[0] ?? null;
  const [avatar_error, set_avatar_error] = useState(false);
  const show_photo = Boolean(avatar_url) && !avatar_error;

  // #263: cacheKey estable en expo-image = la KEY de R2 (no la URL firmada,
  // que cambia por invoke) — evita que cada item del feed re-descargue la
  // misma foto del publicador. Solo aplica a keys R2 reales; una URL legacy
  // http(s) ya es estable por sí misma.
  const avatar_cache_key =
    property.agent_photo_url && !property.agent_photo_url.startsWith('http')
      ? property.agent_photo_url
      : undefined;

  // Fallback: inicial del nombre público; sin nombre, la del owner_user_id
  // (comportamiento previo a #145).
  const agent_initial = (property.agent_name ?? property.owner_user_id).charAt(0).toUpperCase();

  // Chips de listado — mismo criterio de color que PropertyGridCard.
  const is_sale = property.operation_type === 'sale' || property.operation_type === 'both';
  const op_label = OPERATION_LABEL[property.operation_type] ?? property.operation_type;
  const type_label = PROPERTY_TYPE_LABEL[property.property_type] ?? property.property_type;

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
          count={like_count}
        />
        <ActionButton
          icon={BookmarkSimple}
          active={isSaved}
          onPress={onSave}
          accessibilityLabel={isSaved ? 'Quitar de guardados' : 'Guardar propiedad'}
        />

        {/* Comentarios (289.10) — sustituye al 4º botón del detalle, ahora
            vive en el rail del feed junto a like/guardar. onComments es
            opcional para no romper PropertyOverlay.cacheKey.test.tsx (no lo
            pasa) — sin él el botón simplemente no se renderiza. */}
        {onComments && (
          <Pressable
            testID="overlay-comments-btn"
            onPress={onComments}
            style={({ pressed }) => [styles.action_btn, pressed && styles.btn_pressed]}
            accessibilityRole="button"
            accessibilityLabel="Comentarios"
          >
            <RailIcon icon={ChatCircle} color="#FFFFFF" weight="bold" />
            {comment_count > 0 && (
              <Text style={styles.count_label} numberOfLines={1}>
                {format_count(comment_count)}
              </Text>
            )}
          </Pressable>
        )}

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
        {/* Fila del agente (78.4): DOS hermanos NO anidados — el Pressable de
            avatar+nombre (#145.4, en línea desde 293.3) y la píldora de
            «Seguir», PEGADA al nombre (follow_button_wrap: marginLeft fijo,
            recordatorio explícito de Abraham en la aprobación de 293.1 — ya
            no marginLeft:'auto' al extremo derecho como en el prototipo).
            box-none: la fila no captura toques fuera de sus hijos. */}
        <View style={styles.agent_row} pointerEvents="box-none">
          <Pressable
            onPress={onAgentPress}
            style={({ pressed }) => [styles.agent_info, pressed && styles.agent_info_pressed]}
            accessibilityRole="button"
            accessibilityLabel={
              property.agent_name
                ? `Ver perfil de ${property.agent_name}`
                : 'Ver perfil del agente'
            }
          >
            <View style={styles.agent_avatar}>
              {show_photo ? (
                <Image
                  source={{ uri: avatar_url!, ...(avatar_cache_key ? { cacheKey: avatar_cache_key } : {}) }}
                  style={styles.agent_photo}
                  contentFit="cover"
                  onError={() => set_avatar_error(true)}
                />
              ) : (
                <Text style={styles.agent_initial} numberOfLines={1}>
                  {agent_initial}
                </Text>
              )}
            </View>
            {property.agent_name && (
              <Text style={styles.agent_name} numberOfLines={1}>
                {property.agent_name}
              </Text>
            )}
          </Pressable>

          <View style={styles.follow_button_wrap}>
            <FollowButton followed_user_id={property.owner_user_id} variant="dark" testID="follow-button" />
          </View>
        </View>

        {/* Bloque de info tappable → abre el detalle (/property/[id]).
            Separado del avatar (onAgentPress) y del doble-tap del video (like). */}
        <Pressable
          onPress={onPropertyPress}
          accessibilityRole="button"
          accessibilityLabel="Ver detalle de la propiedad"
        >
          {/* Chips: operación (op-badge canónico) + tipo (glass neutro) —
              quick fix 2026-08-15. Van encima de la dirección como en el
              mockup del feed (op-badge sobre el título). */}
          <View style={styles.chips_row} pointerEvents="none">
            <View style={[styles.op_chip, is_sale && styles.op_chip_sale]}>
              <Text style={styles.op_chip_text}>{op_label}</Text>
            </View>
            <View style={styles.type_chip}>
              <Text style={styles.type_chip_text}>{type_label}</Text>
            </View>
          </View>

          {/* Dirección (título en el feed) */}
          <Text style={styles.address} numberOfLines={2}>
            {property.address}
          </Text>

          {/* Precio con divisa (sufijo siempre) o "Precio a consultar" si el
              agente lo ocultó (price_visible=false). */}
          <Text style={styles.price} numberOfLines={1}>
            {property.price_visible
              ? format_price(property.price, property.currency)
              : PRICE_HIDDEN_LABEL}
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
  /** Conteo bajo el ícono (solo like, 293.3). Oculto si es 0/undefined. */
  count?: number;
};

function ActionButton({
  icon: IconCmp,
  active,
  onPress,
  accessibilityLabel,
  count,
}: ActionButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      // Feedback táctil: encoge al presionar (fluidez percibida, flash 2026-07-06)
      style={({ pressed }) => [styles.action_btn, pressed && styles.btn_pressed]}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
    >
      <RailIcon
        icon={IconCmp}
        // Activo = verde claro de marca (cohesión con el acento verde del logo)
        color={active ? colors.primary_soft : '#FFFFFF'}
        weight={active ? 'fill' : 'bold'}
      />
      {count !== undefined && count > 0 && (
        <Text style={styles.count_label} numberOfLines={1}>
          {format_count(count)}
        </Text>
      )}
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponente RailIcon (293.3) — ícono con realce de contraste
// ─────────────────────────────────────────────────────────────────────────────

type RailIconProps = {
  icon: Icon;
  color: string;
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
};

/**
 * RailIcon — ícono outline del rail del feed con una copia negra
 * semitransparente desplazada 1px detrás del ícono de color (variante B
 * aprobada en 293.1: el rail perdió la cápsula glass de fondo y necesita su
 * propio realce de contraste contra fachadas claras/cielo blanco). Sin
 * dependencia nueva — el mismo componente Phosphor se renderiza dos veces.
 * Exportado: 293.6 (ActionButtons del detalle) lo reusa.
 */
export function RailIcon({ icon: IconCmp, color, weight = 'bold' }: RailIconProps) {
  return (
    <View style={styles.icon_slot}>
      <IconCmp
        size={RAIL_ICON_SIZE}
        color={ICON_SHADOW_COLOR}
        weight={weight}
        style={styles.icon_shadow_layer}
      />
      <IconCmp size={RAIL_ICON_SIZE} color={color} weight={weight} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de layout
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Offsets sobre insets.bottom para posicionar info y rail por encima de la
 * tab bar, con margen. Del mockup: info bottom:118, rail bottom:140
 * (relativos a una pantalla de ~580px de alto con tab bar de ~60px).
 * ponytail: valores hardcodeados; se ajustan cuando el feed pase a pantalla
 * completa con tab bar oculto (ver task #9 final).
 *
 * Platform-aware (#65.11, fix de ronda 5): en Android insets.bottom NO
 * incluye el alto de la GlassTabBar (pill flotante, el sistema no la conoce)
 * — se asume el viejo tab bar de 49pt + margen, igual que antes de #65.10.
 * En iOS NativeTabs es una barra nativa ANCLADA: `insets.bottom` YA incluye
 * su alto completo (confirmado en vivo: 83pt = ~49 tab bar + ~34 home
 * indicator) — sumar el mismo 80/100 duplicaba el despeje (bug reportado:
 * descripción/precio flotando con hueco grande sobre la barra). En iOS solo
 * hace falta el margen visual chico (glass.floating_content_bottom_offset_ios),
 * y RAIL_BOTTOM conserva el mismo delta (+20) que ya existía en Android para
 * que el rail siga arrancando un poco más arriba que el bloque de info.
 */
/**
 * Exportado desde #206: `AdFeedItem` monta su bloque inferior a la MISMA
 * altura que el de una propiedad — el feed alterna anuncio y propiedad, así
 * que dos offsets distintos se verían como un salto al deslizar. Vive aquí
 * (y no en `theme.ts`) porque el porqué es el comentario de arriba, y
 * `floating_content_clearance` está calibrado para las pantallas de (tabs),
 * no para el feed (ver el comentario de ese token).
 */
export const INFO_BOTTOM = Platform.OS === 'ios' ? glass.floating_content_bottom_offset_ios : 80;
const RAIL_BOTTOM = Platform.OS === 'ios' ? glass.floating_content_bottom_offset_ios + 20 : 100;

/** Color de texto de specs — blanco cálido semitransparente. Hardcodeado porque
 * el feed es siempre oscuro (ponytail: dual-mode diferido). */
const SPEC_COLOR = 'rgba(246,242,235,0.85)';

/** Tamaño de los íconos outline del rail (293.1, ~28px). */
const RAIL_ICON_SIZE = 28;
/** Copia negra detrás del ícono blanco — variante B aprobada en 293.1 (ver
 * preview .../049-rediseno-layout-overlay-feed/preview/overlay.html §legend). */
const ICON_SHADOW_COLOR = 'rgba(0,0,0,0.4)';

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
    // 293.3: sin cápsula glass (variante B aprobada en 293.1 — el realce de
    // contraste lo da RailIcon, no un fondo). Caja táctil 46×46 intacta
    // (#245: sustituir un componente = copiar su LAYOUT, no solo sus props).
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon_slot: {
    width: RAIL_ICON_SIZE,
    height: RAIL_ICON_SIZE,
  },
  /** Copia negra del ícono, 1px abajo/derecha, DETRÁS del ícono de color. */
  icon_shadow_layer: {
    position: 'absolute',
    top: 1,
    left: 1,
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
  /**
   * Conteo bajo like/comentarios (293.3) — mismo patrón que ANTES tenía solo
   * el botón de comentarios (Text absoluto bottom -16, mono_medium 11,
   * blanco), ahora con textShadow reforzado (variante B aprobada en 293.1:
   * sin cápsula de fondo, el conteo necesita su propio contraste).
   */
  count_label: {
    position: 'absolute',
    bottom: -16,
    fontFamily: fonts.mono_medium,
    fontSize: 11,
    color: '#FFFFFF',
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  // Info inferior izquierda
  info: {
    position: 'absolute',
    left: 16,
    right: 74, // deja margen para el rail (14px right + 46px ancho + 14px gap)
  },
  /** Fila del agente (78.4): avatar+nombre a la izquierda, píldora «Seguir»
   * pegada al nombre (293.3 — ya no empujada al extremo derecho). */
  agent_row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.s_12,
  },
  /** Pressable de avatar+nombre — angosto (alignSelf:'flex-start', #145.4)
   * para no capturar toques fuera de sí mismo dentro de la fila.
   * 293.3: EN LÍNEA (avatar · nombre a la derecha, antes apilados) — gap fijo
   * entre avatar y nombre, mismo lenguaje que el preview aprobado (293.1). */
  agent_info: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8,
    alignSelf: 'flex-start',
    // flexShrink:1 (default RN es 0): con la píldora de «Seguir» como hermana
    // en la fila, este bloque debe poder ceder ancho en vez de empujarla
    // fuera de `info` (right:74) con un nombre largo.
    flexShrink: 1,
  },
  /** Feedback de presión (#145.4) — mismo lenguaje que btn_pressed del rail. */
  agent_info_pressed: {
    transform: [{ scale: 0.94 }],
    opacity: 0.8,
  },
  /**
   * 293.3: píldora «Seguir» PEGADA al nombre (recordatorio explícito de
   * Abraham en la aprobación de 293.1) — gap fijo tras el nombre, NUNCA
   * marginLeft:'auto' al extremo derecho de la fila (comportamiento previo).
   * flexShrink:0: nunca se comprime, el nombre es el que cede ancho.
   */
  follow_button_wrap: {
    marginLeft: spacing.s_8,
    flexShrink: 0,
  },
  agent_avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    // Fondo del fallback de inicial; la foto lo cubre por completo cuando hay.
    backgroundColor: '#6f5742',
    borderWidth: 2,
    borderColor: colors.primary_soft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden', // la foto respeta el círculo
  },
  agent_photo: {
    width: '100%',
    height: '100%',
    borderRadius: 16, // 18 - 2 de borde
  },
  agent_initial: {
    fontFamily: fonts.sans_bold,
    fontSize: 13,
    color: '#F6F2EB',
  },
  /** Nombre público del agente, a la derecha del avatar (293.3: antes debajo,
   * con marginTop — ahora en línea, sin él). */
  agent_name: {
    flexShrink: 1,
    fontFamily: fonts.sans_bold,
    fontSize: 13,
    color: colors.paper,
    // Sombra sutil para legibilidad sobre video claro (mismo rol que el gradiente).
    textShadowColor: 'rgba(23,20,15,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // Chips de listado (quick fix 2026-08-15) — op-badge de la identidad
  // (salvia Renta / arcilla Venta) + tipo en glass oscuro como el rail.
  chips_row: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: spacing.s_8,
  },
  op_chip: {
    backgroundColor: colors.primary,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radii.r_pill,
  },
  op_chip_sale: {
    backgroundColor: colors.accent,
  },
  op_chip_text: {
    fontFamily: fonts.sans_bold,
    fontSize: 11,
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
  type_chip: {
    backgroundColor: 'rgba(23,20,15,0.36)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radii.r_pill,
  },
  type_chip_text: {
    fontFamily: fonts.sans_bold,
    fontSize: 11,
    color: colors.paper,
    letterSpacing: 0.1,
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
