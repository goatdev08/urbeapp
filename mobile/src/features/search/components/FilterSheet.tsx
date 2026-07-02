/**
 * FilterSheet.tsx — Contenedor del panel de filtros de búsqueda (#12.1).
 *
 * Modal nativo de RN (sin @gorhom/bottom-sheet) con presentación slide-up.
 *
 * Decisión: Modal RN elegido sobre BottomSheet para evitar el conflicto de
 * z-index del autocomplete de zona (12.4) dentro de un bottom-sheet, y para
 * no requerir BottomSheetModalProvider en _layout.tsx. Ver notas de 12.1.
 *
 * Props controladas: `visible` + `onClose` — el estado vive en el padre (cada
 * screen que lo abre) hasta que el Context de filtros (12.6) lo centralice.
 *
 * Estética: paleta gestión-claro (colors.paper), coherente con el resto de
 * pantallas de gestión (CRM, perfil, mi-publicaciones). Fuente de tokens:
 * src/theme/theme.ts.
 *
 * Secciones del ScrollView reservadas con comentarios para subtareas 12.2–12.5.
 * Footer con "Limpiar" y "Aplicar" → placeholders visuales para 12.7; por ahora
 * ambos llaman onClose.
 */

import React from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts, radii, spacing } from '@/theme/theme';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface FilterSheetProps {
  /** Controla la visibilidad del Modal. */
  visible: boolean;
  /** Callback para cerrar el sheet (tap en overlay, botón ×, back gesture). */
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function FilterSheet({ visible, onClose }: FilterSheetProps): React.JSX.Element {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/*
       * Overlay: ocupa todo el espacio sobre el sheet (flex:1).
       * Un tap aquí cierra el modal. Fondo semi-translúcido idéntico al de
       * LeadExpandedView para coherencia visual entre modales del proyecto.
       */}
      <TouchableWithoutFeedback onPress={onClose} accessibilityLabel="Cerrar filtros">
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      {/* ── Sheet ─────────────────────────────────────────────────────────── */}
      {/*
       * Se posiciona debajo del overlay en el flujo natural del Modal
       * (el Modal es un flex-column). paddingBottom = safe area del dispositivo
       * + s_24 de holgura para el footer.
       */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.s_24 }]}>

        {/* Handle decorativo — indica que el sheet es desplazable */}
        <View style={styles.handle_wrap}>
          <View style={styles.handle} />
        </View>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Text style={styles.title}>Filtros</Text>

          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Cerrar filtros"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={22} color={colors.ink} />
          </TouchableOpacity>
        </View>

        {/* Divisor bajo el header */}
        <View style={styles.divider} />

        {/* ── Cuerpo con secciones de filtros ─────────────────────────────── */}
        {/*
         * ScrollView para acomodar secciones extensas en pantallas pequeñas.
         * keyboardShouldPersistTaps="handled" para que el autocomplete de
         * zona (12.4) pueda recibir taps en sus sugerencias sin que el teclado
         * se cierre antes.
         * minHeight garantiza que el sheet tenga masa visual mientras las
         * secciones de 12.2–12.5 están vacías.
         */}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scroll_content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* 12.2 — Tipo de operación: renta / venta / ambos */}

          {/* 12.3 — Tipo de propiedad: casa / depto / local / oficina / terreno */}

          {/* 12.4 — Zona / colonia (autocomplete de texto libre; usa TextInput
                directo de RN para evitar el conflicto de z-index que tendría
                dentro de un BottomSheet externo — razón principal de usar Modal) */}

          {/* 12.5 — Rango de precio (slider dual) */}
        </ScrollView>

        {/* ── Footer — acciones ────────────────────────────────────────────── */}
        {/*
         * "Limpiar" y "Aplicar" son placeholders visuales.
         * La lógica real (reset/apply del Context de filtros) se cableará en
         * la subtarea 12.7 cuando el FilterContext esté listo.
         * Por ahora ambos llaman onClose para cerrar el sheet.
         */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.btn_clear}
            onPress={onClose}
            accessibilityLabel="Limpiar filtros"
            accessibilityRole="button"
          >
            <Text style={styles.btn_clear_text}>Limpiar</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.btn_apply}
            onPress={onClose}
            accessibilityLabel="Aplicar filtros"
            accessibilityRole="button"
          >
            <Text style={styles.btn_apply_text}>Aplicar</Text>
          </TouchableOpacity>
        </View>

      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  /**
   * Capa translúcida sobre el contenido de la pantalla subyacente.
   * flex:1 consume todo el espacio por encima del sheet en el flex-column del Modal.
   * Color idéntico al overlay de LeadExpandedView para coherencia.
   */
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(30,26,21,0.45)',
  },

  /**
   * Panel claro que sube desde el borde inferior.
   * Esquinas superiores redondeadas + sombra hacia arriba para sensación de elevación.
   * maxHeight=600 evita que ocupe toda la pantalla antes de que 12.2–12.5 llenen contenido.
   */
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radii.r_24,
    borderTopRightRadius: radii.r_24,
    maxHeight: 600,
    // Sombra hacia arriba (iOS)
    shadowColor: '#1E160C',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 16,
  },

  // ── Handle ────────────────────────────────────────────────────────────────
  handle_wrap: {
    alignItems: 'center',
    paddingTop: spacing.s_12,
    paddingBottom: spacing.s_4,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.paper_3,
  },

  // ── Header ────────────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.s_20,
    paddingTop: spacing.s_8,
    paddingBottom: spacing.s_16,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 24,
    color: colors.ink,
    letterSpacing: -0.3,
  },

  // ── Divisor ───────────────────────────────────────────────────────────────
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.silver,
    marginHorizontal: spacing.s_20,
  },

  // ── Scroll body ───────────────────────────────────────────────────────────
  scroll: {
    flexGrow: 0,
  },
  scroll_content: {
    paddingHorizontal: spacing.s_20,
    paddingTop: spacing.s_20,
    paddingBottom: spacing.s_8,
    // Altura mínima mientras las secciones 12.2–12.5 están vacías;
    // garantiza que el sheet tenga masa visual en esta etapa scaffold.
    minHeight: 120,
  },

  // ── Footer ────────────────────────────────────────────────────────────────
  footer: {
    flexDirection: 'row',
    gap: spacing.s_12,
    paddingHorizontal: spacing.s_20,
    paddingTop: spacing.s_16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.silver,
  },

  /**
   * "Limpiar" — botón fantasma (ghost): borde ink, fondo paper.
   * Placeholder para 12.7 (reset del FilterContext).
   */
  btn_clear: {
    flex: 1,
    paddingVertical: spacing.s_12,
    borderRadius: radii.r_8,
    borderWidth: 1,
    borderColor: colors.paper_3,
    alignItems: 'center',
    backgroundColor: colors.paper_2,
  },
  btn_clear_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 15,
    color: colors.gray_3,
  },

  /**
   * "Aplicar" — botón primario: fondo salvia, texto blanco.
   * Placeholder para 12.7 (apply del FilterContext).
   */
  btn_apply: {
    flex: 2,
    paddingVertical: spacing.s_12,
    borderRadius: radii.r_8,
    alignItems: 'center',
    backgroundColor: colors.primary,
  },
  btn_apply_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 15,
    color: '#FFFFFF',
  },
});
