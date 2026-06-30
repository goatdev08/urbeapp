/**
 * PropertyDetailScreen.tsx — Pantalla de detalle de propiedad.
 *
 * Layout:
 *   ┌─────────────────────────────┐
 *   │  PropertyVideoPlayer        │  ← hero video, full-bleed, sin inset lateral
 *   │  (fondo ink_feed #17140F)   │
 *   ├─────────────────────────────┤
 *   │  ScrollView                 │  ← fondo paper #F6F2EB, padding screen_inset
 *   │    PropertyInfoHeader       │
 *   │    // TODO 10.4             │
 *   │    // TODO 10.5             │
 *   │    // TODO 10.6             │
 *   │    // TODO 10.7             │
 *   └─────────────────────────────┘
 *
 * Lee `id` con useLocalSearchParams — el componente puede vivir fuera del
 * archivo de ruta (Expo Router propaga el contexto del router al árbol).
 *
 * Loading/error: ActivityIndicator y texto mínimo — skeleton formal y error
 * rico se implementan en subtarea 10.7.
 *
 * ponytail: no se oculta el header nativo de Stack — eso es responsabilidad
 * de la configuración de navegación (10.7 o tarea de navegación dedicada);
 * por ahora el video aparece bajo el header de Stack, lo cual es aceptable
 * para smoke-test de 10.3.
 */

import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { colors, fonts, layout, spacing } from '@/theme/theme';
import { PrimaryButton } from '@/components/PrimaryButton';
import { usePropertyDetail } from './hooks/usePropertyDetail';
import { PropertyVideoPlayer } from './components/PropertyVideoPlayer';
import { PropertyInfoHeader } from './components/PropertyInfoHeader';
import { AmenityChips } from './components/AmenityChips';
import { AgentCard } from './components/AgentCard';
import { PropertyMap } from './components/PropertyMap';
import { ActionButtons } from './components/ActionButtons';
import { DetailSkeleton } from './components/DetailSkeleton';
import { open_whatsapp } from './utils/whatsapp';

// Espacio inferior reservado para el CTA sticky:
// PrimaryButton height (54) + paddingTop (8) + paddingBottom (16) + margen visual (8)
const STICKY_CTA_CLEARANCE = 86;

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function PropertyDetailScreen(): React.JSX.Element {
  // useLocalSearchParams propaga el id del segmento dinámico /property/[id]
  const { id } = useLocalSearchParams<{ id: string }>();
  // Guard defensivo: id siempre debería ser string en este segmento
  const property_id = typeof id === 'string' ? id : '';

  const { data, isLoading, error } = usePropertyDetail(property_id);
  const insets = useSafeAreaInsets();

  // ── Loading — skeleton animado (10.7) ────────────────────────────────────
  if (isLoading) {
    return <DetailSkeleton />;
  }

  // ── Error / propiedad no encontrada ──────────────────────────────────────
  if (error !== null || data === null) {
    return (
      <View style={styles.state_container}>
        <Ionicons name="home-outline" size={48} color={colors.gray_1} style={{ marginBottom: 16 }} />
        <Text style={styles.error_title}>
          {error !== null ? 'No se pudo cargar la propiedad' : 'Propiedad no encontrada'}
        </Text>
        <Text style={styles.error_text}>
          {error ?? 'Es posible que esta propiedad ya no esté disponible.'}
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={styles.error_back_btn}
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <Text style={styles.error_back_label}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  // ID del video primario (menor position) — para useLikeProperty en ActionButtons.
  // ponytail: misma lógica que PropertyVideoPlayer.find_primary_video.
  const primary_video_id: string | null =
    data.videos.reduce<{ id: string; position: number } | undefined>(
      (acc, v) => (!acc || v.position < acc.position ? v : acc),
      undefined,
    )?.id ?? null;

  // ── Pantalla principal ─────────────────────────────────────────────────────
  return (
    <View style={styles.root}>

      {/* Hero video + overlays flotantes (botón volver + acciones) */}
      <View style={styles.hero_wrapper}>
        <PropertyVideoPlayer videos={data.videos} />

        {/* Botón volver — esquina superior izquierda, flotante sobre el hero */}
        <Pressable
          onPress={() => router.back()}
          style={[styles.back_btn, { top: insets.top + 8 }]}
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
        </Pressable>

        {/* Rail de acciones (like / save) — derecha, alineado al fondo del hero */}
        <View style={styles.action_overlay}>
          <ActionButtons
            property_id={property_id}
            property_video_id={primary_video_id}
          />
        </View>
      </View>

      {/* Contenido scrollable — fondo paper claro (gestión-claro per mockup #5) */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scroll_content}
        showsVerticalScrollIndicator={false}
      >
        <PropertyInfoHeader data={data} />

        {/* ── Dirección, descripción y amenidades (10.4) ───────────────────── */}
        <View style={styles.section_detail}>

          {/* Hairline separadora entre PropertyInfoHeader y esta sección */}
          <View style={styles.section_divider} />

          {/* Dirección completa con icono de ubicación */}
          <View style={styles.address_row}>
            <Ionicons name="location-outline" size={16} color={colors.primary} />
            <Text style={styles.address_text}>{data.address}</Text>
          </View>

          {/* Descripción multilínea — oculta si null/vacío */}
          {data.description ? (
            <Text style={styles.description_text}>{data.description}</Text>
          ) : null}

          {/* Chips de flags (pet, aval, estudiantes) + amenidades JSONB */}
          <AmenityChips
            pet_friendly={data.pet_friendly}
            allows_no_guarantor={data.allows_no_guarantor}
            student_friendly={data.student_friendly}
            amenities={data.amenities}
          />

        </View>

        {/* ── Agente (10.6) — va ANTES del mapa per mockup #5 ─────── */}
        <View style={styles.section_agent}>
          <View style={styles.section_divider} />
          <AgentCard
            agent={data.agent}
            agency={data.agency}
            address={data.address}
          />
        </View>

        <PropertyMap location={data.location} />

      </ScrollView>

      {/* ── CTA sticky "Contactar por WhatsApp" — anclado al fondo,
           fuera del ScrollView, visible solo si hay teléfono. ─────── */}
      {data.agent.phone !== null && (
        <View style={styles.sticky_cta}>
          <PrimaryButton
            label="Contactar por WhatsApp"
            surface="light"
            icon={<Ionicons name="logo-whatsapp" size={20} color="#FFFFFF" />}
            onPress={() => {
              // ponytail: sin registro de lead CRM — llega en #11
              open_whatsapp(data.agent.phone, data.address);
            }}
          />
        </View>
      )}

    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.paper,
  },

  // ── Hero wrapper — contiene el video + overlays flotantes ─────────────────
  hero_wrapper: {
    // RN default: position 'relative', overflow 'visible' — los overlays salen
    // del hero si lo necesitan (ej. el back_btn puede sobrepasar el top).
  },

  // Botón volver — glass pill flotante sobre el video, esquina superior izquierda
  // ponytail: mismos colores de glass que PropertyOverlay.action_btn
  back_btn: {
    position: 'absolute',
    left: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(23,20,15,0.36)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },

  // Rail de acciones (ActionButtons) — flotante, derecha, fondo del hero
  action_overlay: {
    position: 'absolute',
    right: 14,
    bottom: 16,
    zIndex: 10,
  },

  // ScrollView toma el espacio restante bajo el hero
  scroll: {
    flex: 1,
  },
  scroll_content: {
    paddingHorizontal: layout.screen_inset,
    // +STICKY_CTA_CLEARANCE para no quedar tapado por el CTA anclado al fondo
    paddingBottom: spacing.s_40 + STICKY_CTA_CLEARANCE,
  },

  // ── Sección 10.6: tarjeta del agente ─────────────────────────────────────
  section_agent: {
    gap: spacing.s_16,
    marginTop: spacing.s_8,
  },

  // ── CTA sticky inferior ───────────────────────────────────────────────────
  sticky_cta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: layout.screen_inset,
    paddingTop: spacing.s_8,
    paddingBottom: spacing.s_16,
    backgroundColor: colors.paper,
  },

  // ── Sección 10.4: dirección + descripción + amenidades ────────────────────
  section_detail: {
    gap: spacing.s_16,
    marginTop: spacing.s_8,
  },
  section_divider: {
    height: 1,
    backgroundColor: colors.paper_3,
  },
  address_row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.s_8,
  },
  address_text: {
    flex: 1,
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    lineHeight: 20,
    color: colors.gray_3,
  },
  description_text: {
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 23,
    color: colors.ink,
  },

  // ── Estado de error — centrado en pantalla completa ───────────────────────
  state_container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
    padding: layout.screen_inset,
  },
  error_title: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 24,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: spacing.s_8,
  },
  error_text: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.gray_2,
    textAlign: 'center',
    marginBottom: spacing.s_24,
  },
  error_back_btn: {
    paddingHorizontal: spacing.s_24,
    paddingVertical: spacing.s_12,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  error_back_label: {
    fontFamily: fonts.sans_semibold,
    fontSize: 15,
    color: '#FFFFFF',
  },
});
