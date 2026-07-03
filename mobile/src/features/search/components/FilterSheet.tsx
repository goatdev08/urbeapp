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
 * Estado (#12.7): todos los valores/setters vienen de FilterContext
 * (useFilters) — ya no hay useState local para los campos de filtro. Solo el
 * texto crudo de los inputs de precio sigue siendo estado local de UI (no es
 * parte de FilterState). "Limpiar" llama clear_filters(); "Aplicar" solo
 * cierra el sheet (los filtros ya viven en el Context, feed/mapa refetchean
 * al detectar el cambio).
 */

import React, { useEffect, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts, radii, spacing } from '@/theme/theme';
import { useFilters } from '../filterStore';
import { parse_price, validate_price_form } from '../validation';
import { BedroomsSelector } from './BedroomsSelector';
import { FilterChipGroup } from './FilterChipGroup';
import { ZoneAutocomplete } from './ZoneAutocomplete';

// ─────────────────────────────────────────────────────────────────────────────
// Opciones de filtro (constantes de módulo — no se recrean en cada render)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Operación: solo Renta y Venta como opciones de usuario.
 * 'both' (enum DB) indica que una propiedad soporta ambas modalidades y se
 * resuelve en la capa de query de 12.6 — no es una elección de UI.
 */
const OPERATION_OPTIONS: { value: string; label: string }[] = [
  { value: 'rent', label: 'Renta' },
  { value: 'sale', label: 'Venta' },
];

/**
 * Tipo de propiedad: los 5 valores del enum `property_type` del DB
 * (migración 0005). Labels en español capitalizado tal como se presentan
 * al usuario en el resto de la app (fichas, tarjetas, publicación).
 */
const PROPERTY_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'casa',         label: 'Casa' },
  { value: 'departamento', label: 'Departamento' },
  { value: 'local',        label: 'Local' },
  { value: 'oficina',      label: 'Oficina' },
  { value: 'terreno',      label: 'Terreno' },
];

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
// ToggleRow — fila de toggle booleano (local, no exportado)
//
// Contrato para 12.6 (FilterContext): value/onChange vendrán del Context en
// lugar del estado local de FilterSheet.
// ─────────────────────────────────────────────────────────────────────────────

interface ToggleRowProps {
  /** Texto visible al usuario. */
  label: string;
  /** Estado actual del switch. */
  value: boolean;
  /** Callback al cambiar el estado. */
  onChange: (v: boolean) => void;
}

function ToggleRow({ label, value, onChange }: ToggleRowProps): React.JSX.Element {
  return (
    <View style={styles.toggle_row}>
      <Text style={styles.toggle_label}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.paper_3, true: colors.primary_tint }}
        thumbColor={value ? colors.primary : colors.gray_1}
        ios_backgroundColor={colors.paper_3}
        accessibilityLabel={label}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function FilterSheet({ visible, onClose }: FilterSheetProps): React.JSX.Element {
  const insets = useSafeAreaInsets();

  // ── Estado — FilterContext (#12.7) ──────────────────────────────────────────
  // Todos los campos de filtro viven en el Context, compartido con feed/mapa.
  const { filters, set_filter, clear_filters } = useFilters();
  const {
    operation_types,
    property_types,
    price_min,
    price_max,
    zone,
    bedrooms_min: bedrooms,
    pet_friendly,
    allows_no_guarantor,
    student_friendly,
  } = filters;

  // Texto crudo para cada TextInput de precio (controla el valor mostrado al
  // usuario) — NO es parte de FilterState; se resincroniza desde el Context
  // solo al abrir el sheet (evita pisar lo que el usuario está tecleando).
  const [price_min_text, set_price_min_text] = useState('');
  const [price_max_text, set_price_max_text] = useState('');

  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resincroniza el texto local con el Context solo al abrir el sheet (ver comentario abajo).
      set_price_min_text(price_min !== null ? String(price_min) : '');
      set_price_max_text(price_max !== null ? String(price_max) : '');
    }
    // Solo al abrir/cerrar — un cambio de precio por tecleo propio no debe
    // reformatear el texto mientras el usuario escribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Errores de precio — función pura, se recalcula en cada render sin coste significativo
  const price_errors = validate_price_form(price_min, price_max);

  /** "Limpiar" — resetea el Context completo Y el texto local de precio. */
  function handle_clear(): void {
    clear_filters();
    set_price_min_text('');
    set_price_max_text('');
  }

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
          {/* ── 12.2 — Operación ─────────────────────────────────────────── */}
          {/*
           * Selección múltiple: el usuario puede elegir Renta, Venta, ambas o
           * ninguna (ninguna = sin filtro, equivale a mostrar todo).
           * 'both' es un valor de dato (una propiedad que acepta ambas modalidades)
           * y matchea automáticamente en la capa de query (build_filter_query) —
           * no se expone como opción de UI.
           */}
          <View style={styles.section}>
            <Text style={styles.section_title}>Operación</Text>
            <FilterChipGroup
              options={OPERATION_OPTIONS}
              selected={operation_types}
              onChange={(v) => set_filter('operation_types', v)}
            />
          </View>

          <View style={styles.section_sep} />

          {/* ── 12.2 — Tipo de propiedad ─────────────────────────────────── */}
          {/*
           * Multi-select de los 5 valores del enum property_type.
           * [] = sin filtro (muestra todos los tipos).
           */}
          <View style={styles.section}>
            <Text style={styles.section_title}>Tipo de propiedad</Text>
            <FilterChipGroup
              options={PROPERTY_TYPE_OPTIONS}
              selected={property_types}
              onChange={(v) => set_filter('property_types', v)}
            />
          </View>

          <View style={styles.section_sep} />

          {/* ── 12.3 — Rango de precio ───────────────────────────────────── */}
          {/*
           * Dos TextInput numéricos (Mínimo / Máximo). El texto crudo se guarda
           * en price_*_text y se convierte a number|null vía parse_price (nunca
           * NaN). validate_price_form deriva errores por campo y de relación.
           */}
          <View style={styles.section}>
            <Text style={styles.section_title}>Precio</Text>
            <View style={styles.price_row}>
              <View style={styles.price_field}>
                <Text style={styles.price_field_label}>Mínimo</Text>
                <TextInput
                  style={[styles.price_input, price_errors.min ? styles.price_input_error : null]}
                  value={price_min_text}
                  onChangeText={(t) => {
                    set_price_min_text(t);
                    set_filter('price_min', parse_price(t));
                  }}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  placeholder="Sin mínimo"
                  placeholderTextColor={colors.gray_1}
                  accessibilityLabel="Precio mínimo"
                />
              </View>
              <View style={styles.price_field}>
                <Text style={styles.price_field_label}>Máximo</Text>
                <TextInput
                  style={[styles.price_input, price_errors.max ? styles.price_input_error : null]}
                  value={price_max_text}
                  onChangeText={(t) => {
                    set_price_max_text(t);
                    set_filter('price_max', parse_price(t));
                  }}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  placeholder="Sin máximo"
                  placeholderTextColor={colors.gray_1}
                  accessibilityLabel="Precio máximo"
                />
              </View>
            </View>
            {(price_errors.min ?? price_errors.max ?? price_errors.range) ? (
              <Text style={styles.price_error_text}>
                {(price_errors.min ?? price_errors.max ?? price_errors.range)?.message}
              </Text>
            ) : null}
          </View>

          <View style={styles.section_sep} />

          {/* ── 12.4 — Zona / colonia ─────────────────────────────────────── */}
          {/*
           * Autocomplete de texto libre; el dropdown se renderiza inline
           * (ScrollView normal) porque el contenedor es un Modal de RN, no un
           * BottomSheet — evita el conflicto de z-index que motivó usar Modal.
           */}
          <View style={styles.section}>
            <Text style={styles.section_title}>Zona o colonia</Text>
            <ZoneAutocomplete value={zone} onChange={(v) => set_filter('zone', v)} />
          </View>

          <View style={styles.section_sep} />

          {/* ── 12.5 — Recámaras + Extras booleanos ──────────────────────── */}

          {/* Sección: Recámaras mínimas */}
          <View style={styles.section}>
            <Text style={styles.section_title}>Recámaras</Text>
            {/* Columna: properties.bedrooms int nullable (migración 0005). */}
            <BedroomsSelector value={bedrooms} onChange={(v) => set_filter('bedrooms_min', v)} />
          </View>

          <View style={styles.section_sep} />

          {/* Sección: Extras booleanos */}
          <View style={styles.section}>
            <Text style={styles.section_title}>Extras</Text>
            {/*
             * Columnas: properties.{pet_friendly, allows_no_guarantor, student_friendly}
             * boolean not null default false (migración 0005, índices parciales).
             */}
            <ToggleRow
              label="Acepta mascotas"
              value={pet_friendly}
              onChange={(v) => set_filter('pet_friendly', v)}
            />
            <ToggleRow
              label="Sin aval"
              value={allows_no_guarantor}
              onChange={(v) => set_filter('allows_no_guarantor', v)}
            />
            <ToggleRow
              label="Para estudiantes"
              value={student_friendly}
              onChange={(v) => set_filter('student_friendly', v)}
            />
          </View>
        </ScrollView>

        {/* ── Footer — acciones ────────────────────────────────────────────── */}
        {/*
         * "Limpiar" resetea el FilterContext completo (clear_filters) y el
         * texto local de precio — el sheet permanece abierto para mostrar el
         * estado limpio. "Aplicar" solo cierra el sheet: los filtros ya viven
         * en el Context, así que feed/mapa refetchean solos al detectar el
         * cambio (ver useFeedProperties/useMapProperties, #12.7).
         */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={styles.btn_clear}
            onPress={handle_clear}
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

  // ── Sección genérica ──────────────────────────────────────────────────────
  /**
   * Contenedor de cada bloque de filtros (Recámaras, Extras, etc.).
   * marginBottom separa secciones entre sí.
   */
  section: {
    marginBottom: spacing.s_4,
  },
  /**
   * Título de sección: overline uppercase (caption), gris medio.
   * Mismo estilo que FilterTabs.label pero como encabezado de grupo.
   */
  section_title: {
    fontFamily: fonts.sans_semibold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
    color: colors.gray_2,
    marginBottom: spacing.s_12,
  },
  /**
   * Línea hairline entre secciones (Recámaras / Extras).
   * marginBottom recrea el spacing.s_20 de separación visual.
   */
  section_sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.silver,
    marginBottom: spacing.s_20,
    marginTop: spacing.s_16,
  },

  // ── Precio (12.3) ─────────────────────────────────────────────────────────
  /** Fila con los dos campos Mín/Máx, uno junto al otro. */
  price_row: {
    flexDirection: 'row',
    gap: spacing.s_12,
  },
  price_field: {
    flex: 1,
  },
  /** Etiqueta pequeña sobre cada input. */
  price_field_label: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: colors.gray_2,
    marginBottom: spacing.s_4,
  },
  /** Input numérico bordeado, coherente con los form-field del proyecto. */
  price_input: {
    borderWidth: 1,
    borderColor: colors.paper_3,
    borderRadius: radii.r_8,
    paddingHorizontal: spacing.s_12,
    paddingVertical: spacing.s_12,
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.paper_2,
  },
  /** Borde de error cuando el campo es inválido. */
  price_input_error: {
    borderColor: colors.danger,
  },
  /** Mensaje de error del rango, debajo de los campos. */
  price_error_text: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: colors.danger,
    marginTop: spacing.s_8,
  },

  // ── ToggleRow ─────────────────────────────────────────────────────────────
  /**
   * Fila label + Switch. borderBottomWidth actúa de separador entre filas
   * dentro de la misma sección.
   */
  toggle_row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.s_12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.paper_3,
  },
  toggle_label: {
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
  },
});
