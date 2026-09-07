/**
 * CrmFilterSheet — hoja de filtros del CRM (#271.3), ensanchada desde
 * CrmSearchSheet (#267.7, hoja mínima solo de búsqueda por nombre).
 *
 * Modal nativo de RN con el patrón de resincronización al abrir — se
 * conserva TAL CUAL de CrmSearchSheet, extendido a los 2 campos nuevos.
 *
 * Suma a la búsqueda:
 *   - Estado: multi-select de los 4 proyectados (FilterChipGroup,
 *     mobile/src/components/, cross-feature/controlado — no se inventa un
 *     componente de chips nuevo).
 *   - "En seguimiento": Switch — molde de ToggleRow en
 *     features/search/components/FilterSheet.tsx (615 líneas acopladas a
 *     FilterContext; sirve de precedente de layout, NO se importa).
 *
 * Contrato: UN SOLO `onSubmit` con el objeto completo de filtros — no
 * cuatro callbacks sueltos. La búsqueda SIGUE siendo server-side (D7 de
 * CRMScreen): esta hoja solo arma el objeto, nunca filtra en cliente.
 *
 * 🔴 D-STATUSNULL/D-STATUSEMPTY (contrato de useCrmLeadsPage, 271.2): un
 * array vacío EXPLÍCITO (`p_status: []`) es "cero estados elegidos" y la
 * RPC lo resuelve como 0 filas — nunca "sin filtro". Por eso, si NINGÚN
 * chip está seleccionado, `build_filters` manda `status: null` (sin
 * filtro), JAMÁS `[]` — quien lo desincronice vacía la pantalla sin
 * explicación.
 *
 * Limpiar deja los 3 filtros en su valor neutro (query='', sin chips,
 * switch apagado) Y aplica de inmediato (onSubmit + onClose) — mismo
 * comportamiento que ya tenía CrmSearchSheet.handle_clear.
 *
 * Reabrir la hoja resincroniza SIEMPRE con los filtros ACTIVOS
 * (initialFilters), nunca con un borrador de una apertura anterior sin
 * aplicar — mismo useEffect que ya tenía CrmSearchSheet para
 * `initialQuery`, extendido a status/followUp.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, TextInput, TouchableWithoutFeedback, View } from 'react-native';

import { FilterChipGroup } from '@/components/FilterChipGroup';
import { colors, fonts, radii, spacing } from '@/theme/theme';

import type { ProjectedStatus } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Opciones de estado — MISMO texto que la barra de 4 tramos de
// LeadInlineDetail.tsx (STAGES), la fuente que ya usa la pantalla para estos
// 4 tramos. No se importa ese módulo directamente: arrastra 6 hooks de datos
// propios (267.6) que este sheet ligero — y su test — no necesitan
// (CRMScreen.test.tsx reemplaza LeadInlineDetail por un stub exactamente por
// eso). Si alguno de los 2 arreglos cambia de texto, el otro debe seguirlo.
// ─────────────────────────────────────────────────────────────────────────────

export const PROJECTED_STATUS_OPTIONS: { value: ProjectedStatus; label: string }[] = [
  { value: 'nuevo', label: 'Nuevo' },
  { value: 'contactado', label: 'Contactado' },
  { value: 'visita', label: 'Visita' },
  { value: 'cerrado', label: 'Cerrado' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface CrmFilters {
  /** trim().length===0 → null ("sin búsqueda"). */
  query: string | null;
  /** null = sin filtro. NUNCA [] (D-STATUSEMPTY: [] es "cero estados", 0 filas). */
  status: ProjectedStatus[] | null;
  /** null = sin filtro. */
  followUp: boolean | null;
}

export interface CrmFilterSheetProps {
  visible: boolean;
  /** Filtros ACTIVOS al abrir la hoja — precargan los 3 campos (reabrir sin arrastrar un borrador). */
  initialFilters: CrmFilters;
  onClose: () => void;
  onSubmit: (filters: CrmFilters) => void;
}

const NEUTRAL_FILTERS: CrmFilters = { query: null, status: null, followUp: null };

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function CrmFilterSheet({
  visible,
  initialFilters,
  onClose,
  onSubmit,
}: CrmFilterSheetProps): React.JSX.Element {
  const [text, set_text] = useState(initialFilters.query ?? '');
  const [selected_status, set_selected_status] = useState<string[]>(initialFilters.status ?? []);
  // Switch de 2 estados (on/off) sobre un contrato de 3 (null/true/false,
  // D-FOLLOWUP en useCrmLeadsPage): apagado siempre manda `null` (sin
  // filtro) — un solo interruptor no puede representar "solo los que NO
  // están en seguimiento", y el mockup no pide esa 3ª opción.
  const [follow_up_on, set_follow_up_on] = useState(initialFilters.followUp === true);

  // Resincroniza los 3 campos con los filtros ACTIVOS cada vez que la hoja
  // se abre (si el agente la cierra sin aplicar, la próxima apertura no debe
  // arrastrar un borrador viejo de otra sesión de la hoja).
  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resincroniza los 3 campos con los filtros activos en cada apertura de la hoja.
      set_text(initialFilters.query ?? '');
      set_selected_status(initialFilters.status ?? []);
      set_follow_up_on(initialFilters.followUp === true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialFilters es un objeto nuevo en cada render del padre (CRMScreen); solo importa CUÁNDO cambia `visible` (mismo criterio que el useEffect original de CrmSearchSheet para initialQuery).
  }, [visible]);

  function build_filters(query_text: string, status_selected: string[], follow_up: boolean): CrmFilters {
    const trimmed = query_text.trim();
    return {
      query: trimmed.length > 0 ? trimmed : null,
      status: status_selected.length > 0 ? (status_selected as ProjectedStatus[]) : null,
      followUp: follow_up ? true : null,
    };
  }

  function handle_apply(): void {
    onSubmit(build_filters(text, selected_status, follow_up_on));
    onClose();
  }

  function handle_clear(): void {
    set_text('');
    set_selected_status([]);
    set_follow_up_on(false);
    onSubmit(NEUTRAL_FILTERS);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose} accessibilityLabel="Cerrar filtros">
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      <View style={styles.sheet}>
        <View style={styles.handle_wrap}>
          <View style={styles.handle} />
        </View>

        <TextInput
          style={styles.input}
          placeholder="Buscar por nombre"
          placeholderTextColor={colors.gray_1}
          value={text}
          onChangeText={set_text}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          onSubmitEditing={handle_apply}
          accessibilityLabel="Buscar por nombre"
        />

        <Text style={styles.section_label}>Estado</Text>
        <FilterChipGroup options={PROJECTED_STATUS_OPTIONS} selected={selected_status} onChange={set_selected_status} />

        <View style={styles.toggle_row}>
          <Text style={styles.toggle_label}>En seguimiento</Text>
          <Switch
            value={follow_up_on}
            onValueChange={set_follow_up_on}
            trackColor={{ false: colors.paper_3, true: colors.primary_tint }}
            thumbColor={follow_up_on ? colors.primary : colors.gray_1}
            ios_backgroundColor={colors.paper_3}
            accessibilityLabel="En seguimiento"
          />
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={handle_clear}
            accessibilityRole="button"
            accessibilityLabel="Limpiar"
            style={styles.clear_btn}
          >
            <Text style={styles.clear_text}>Limpiar</Text>
          </Pressable>
          <Pressable
            onPress={handle_apply}
            accessibilityRole="button"
            accessibilityLabel="Aplicar"
            style={styles.search_btn}
          >
            <Text style={styles.search_btn_text}>Aplicar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(30,26,21,0.45)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.r_24,
    borderTopRightRadius: radii.r_24,
    padding: spacing.s_20,
    paddingTop: 0,
  },
  handle_wrap: {
    alignItems: 'center',
    paddingTop: spacing.s_12,
    paddingBottom: spacing.s_16,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.paper_3,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.silver,
    borderRadius: radii.r_12,
    paddingHorizontal: spacing.s_16,
    paddingVertical: spacing.s_12,
    fontFamily: fonts.sans,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.paper,
  },
  section_label: {
    fontFamily: fonts.sans_semibold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
    color: colors.gray_2,
    marginTop: spacing.s_16,
    marginBottom: spacing.s_8,
  },
  toggle_row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.s_16,
    paddingVertical: spacing.s_8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.paper_3,
  },
  toggle_label: {
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.s_16,
    marginTop: spacing.s_16,
  },
  clear_btn: {
    paddingVertical: spacing.s_12,
    paddingHorizontal: spacing.s_8,
  },
  clear_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    color: colors.gray_2,
  },
  search_btn: {
    paddingVertical: spacing.s_12,
    paddingHorizontal: spacing.s_24,
    borderRadius: radii.r_pill,
    backgroundColor: colors.primary,
  },
  search_btn_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    color: colors.on_primary,
  },
});
