/**
 * AmenityChips.tsx — Chips de amenidades y flags de convivencia.
 *
 * Renderiza los flags booleanos (pet_friendly, allows_no_guarantor, student_friendly)
 * y el array amenities JSONB como chips pill sobre fondo claro (paper_2).
 *
 * Retorna null si no hay chips — la sección padre desaparece limpiamente.
 *
 * ponytail: flexWrap wrap (multilínea automática) en lugar de ScrollView
 * horizontal — más simple, sin FlatList anidado. Techo conocido: si el catálogo
 * crece a +15 chips por propiedad, valorar carrusel horizontal.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PawPrint } from 'phosphor-react-native';

import { colors, fonts, radii, spacing } from '@/theme/theme';
import type { PropertyDetail } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// ponytail: diccionario mínimo — cubre los valores frecuentes en la demo.
// Valores fuera del diccionario se capitalizan genéricamente (ver format_amenity).
const AMENITY_LABELS: Record<string, string> = {
  parking:   'Estacionamiento',
  furnished: 'Amueblado',
  pool:      'Alberca',
  gym:       'Gimnasio',
  security:  'Seguridad',
  laundry:   'Lavandería',
  elevator:  'Elevador',
  garden:    'Jardín',
  storage:   'Bodega',
  ac:        'Clima',
  balcony:   'Balcón',
  terrace:   'Terraza',
  rooftop:   'Rooftop',
};

function format_amenity(key: string): string {
  return (
    AMENITY_LABELS[key] ??
    key.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
  );
}

// Cast defensivo Json → string[]; en la DB amenities es JSONB array de strings.
function parse_amenities(raw: PropertyDetail['amenities']): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string');
}

type ChipData = {
  key: string;
  label: string;
  with_paw?: true;
};

function build_chips(
  pet_friendly: boolean,
  allows_no_guarantor: boolean,
  student_friendly: boolean,
  amenities: PropertyDetail['amenities'],
): ChipData[] {
  const chips: ChipData[] = [];
  if (pet_friendly)        chips.push({ key: 'pet',  label: 'Pet Friendly', with_paw: true });
  if (allows_no_guarantor) chips.push({ key: 'aval', label: 'Sin Aval' });
  if (student_friendly)    chips.push({ key: 'stu',  label: 'Estudiantes' });
  for (const v of parse_amenities(amenities)) {
    chips.push({ key: v, label: format_amenity(v) });
  }
  return chips;
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export type AmenityChipsProps = {
  pet_friendly: boolean;
  allows_no_guarantor: boolean;
  student_friendly: boolean;
  amenities: PropertyDetail['amenities'];
};

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function AmenityChips({
  pet_friendly,
  allows_no_guarantor,
  student_friendly,
  amenities,
}: AmenityChipsProps): React.JSX.Element | null {
  const chips = build_chips(pet_friendly, allows_no_guarantor, student_friendly, amenities);

  if (chips.length === 0) return null;

  return (
    <View style={styles.container}>
      {chips.map(chip => (
        <View key={chip.key} style={styles.chip}>
          {chip.with_paw === true && (
            <PawPrint size={13} color={colors.gray_2} weight="bold" />
          )}
          <Text style={styles.chip_text}>{chip.label}</Text>
        </View>
      ))}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.s_8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_4,
    backgroundColor: colors.paper_2,
    borderWidth: 1,
    borderColor: colors.paper_3,
    borderRadius: radii.r_pill,
    paddingVertical: spacing.s_8,
    paddingHorizontal: spacing.s_12,
  },
  chip_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
    color: colors.gray_2,
  },
});
