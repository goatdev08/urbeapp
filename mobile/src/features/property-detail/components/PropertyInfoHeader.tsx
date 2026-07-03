/**
 * PropertyInfoHeader.tsx — Cabecera de información en la pantalla de detalle.
 *
 * Secciones:
 *   1. Fila de badges: operación (colored/filled) + tipo de propiedad (outline).
 *   2. Título: "{PropTypeLabel} en {address}".
 *      ponytail: sin campo zona/barrio en el modelo; se usa el campo `address`
 *      completo como stand-in para el encabezado de contexto. En producción
 *      conviene añadir un campo `neighborhood` (o extraerlo del PostGIS) para
 *      un encabezado más preciso tipo "Departamento en Colonia Santa Fe".
 *   3. Precio héroe con tick Salvia — patrón visual de PropertyGridCard.
 *   4. Fila de specs null-safe: recámaras | baños | m² con hairlines de plata.
 *      Si un valor es null, se omite ese spec (no se muestra '0' ni 'null').
 *
 * Tema: superficie gestión-claro (paper). El hero video oscuro vive en
 * PropertyVideoPlayer (sobre ink_feed) — esta cabecera siempre sobre fondo paper.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, fonts, radii, spacing, type_scale } from '@/theme/theme';
import type { PropertyDetail } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Constantes / helpers
// ─────────────────────────────────────────────────────────────────────────────

// ponytail: formatter instanciado fuera del componente — singleton reutilizado
// en cada render sin re-crear el objeto en cada llamada.
const MXN_FORMATTER = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});

const PROPERTY_TYPE_LABEL: Record<string, string> = {
  casa:         'Casa',
  departamento: 'Departamento',
  local:        'Local',
  oficina:      'Oficina',
  terreno:      'Terreno',
};

const OPERATION_LABEL: Record<string, string> = {
  rent: 'Renta',
  sale: 'Venta',
  both: 'Renta / Venta',
};

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export type PropertyInfoHeaderProps = {
  data: PropertyDetail;
};

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function PropertyInfoHeader({ data }: PropertyInfoHeaderProps): React.JSX.Element {
  const {
    price,
    operation_type,
    property_type,
    bedrooms,
    bathrooms,
    square_meters,
    address,
  } = data;

  // Casting a string para indexar los Records; los enums de DB son strings en runtime.
  const op_str   = operation_type as string;
  const prop_str = property_type as string;

  const op_label   = OPERATION_LABEL[op_str]       ?? op_str;
  const prop_label = PROPERTY_TYPE_LABEL[prop_str] ?? prop_str;

  // Badge de operación: arcilla para venta/ambas; salvia para renta.
  const is_sale      = op_str === 'sale' || op_str === 'both';
  // "/mes" solo si la operación incluye renta.
  const show_per_mes = op_str === 'rent' || op_str === 'both';

  // Specs null-safe — se incluyen solo los campos con valor numérico.
  type SpecItem = { icon: string; label: string };
  const specs: SpecItem[] = [];
  if (bedrooms      !== null) specs.push({ icon: 'bed-outline',    label: `${bedrooms} rec.` });
  if (bathrooms     !== null) specs.push({ icon: 'water-outline',  label: `${bathrooms} baños` });
  if (square_meters !== null) specs.push({ icon: 'resize-outline', label: `${square_meters} m²` });

  return (
    <View style={styles.container}>

      {/* ── Fila de badges ────────────────────────────────────────────────── */}
      <View style={styles.badge_row}>
        {/* Badge operación: filled — salvia (renta) o arcilla (venta/ambas) */}
        <View style={[styles.op_badge, is_sale && styles.op_badge_sale]}>
          <Text style={styles.op_badge_text}>{op_label}</Text>
        </View>

        {/* Etiqueta property_type: outline badge sobre paper */}
        <View style={styles.type_badge}>
          <Text style={styles.type_badge_text}>{prop_label}</Text>
        </View>
      </View>

      {/* ── Título ────────────────────────────────────────────────────────── */}
      {/* ponytail: "{PropTypeLabel} en {address}" — spec 10.3 sugiere este
          formato; address completo como stand-in de zona. Ver doc encabezado. */}
      <Text style={styles.title} numberOfLines={2}>
        {prop_label} en {address}
      </Text>

      {/* ── Precio héroe con tick Salvia ──────────────────────────────────── */}
      {/* Patrón visual idéntico a PropertyGridCard: tick 26×3 + precio + /mes */}
      <View style={styles.price_block}>
        <View style={styles.price_tick} />
        <View style={styles.price_row}>
          <Text style={styles.price_text}>{MXN_FORMATTER.format(price)}</Text>
          {show_per_mes && (
            <Text style={styles.price_per}>/mes</Text>
          )}
        </View>
      </View>

      {/* ── Fila de specs con hairlines de plata ──────────────────────────── */}
      {specs.length > 0 && (
        <View style={styles.specs_row}>
          {specs.map((spec, index) => (
            <React.Fragment key={spec.icon}>
              {/* Hairline vertical de plata entre specs (mockup #5) */}
              {index > 0 && <View style={styles.spec_separator} />}
              <View style={styles.spec_item}>
                <Ionicons
                   
                  name={spec.icon as any}
                  size={16}
                  color={colors.gray_2}
                />
                <Text style={styles.spec_text}>{spec.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      )}

    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.s_24,
    gap: spacing.s_16,
  },

  // ── Badges ───────────────────────────────────────────────────────────────
  badge_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8,
    flexWrap: 'wrap',
  },
  op_badge: {
    backgroundColor: colors.primary,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: radii.r_pill,
  },
  op_badge_sale: {
    backgroundColor: colors.accent,
  },
  op_badge_text: {
    fontFamily: fonts.sans_bold,
    fontSize: 12,
    // ponytail: blanco directo — no hay token white en theme; valor semántico fijo
    color: '#FFFFFF',
    letterSpacing: 0.1,
  },
  type_badge: {
    borderWidth: 1,
    borderColor: colors.silver,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: radii.r_pill,
    backgroundColor: colors.paper,
  },
  type_badge_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 12,
    color: colors.gray_2,
  },

  // ── Título ────────────────────────────────────────────────────────────────
  title: {
    fontFamily: type_scale.h1.fontFamily,
    fontSize: type_scale.h1.fontSize,
    lineHeight: type_scale.h1.lineHeight,
    letterSpacing: type_scale.h1.letterSpacing,
    color: colors.ink,
  },

  // ── Precio héroe ─────────────────────────────────────────────────────────
  // Replica el patrón de PropertyGridCard: tick 26×3 salvia sobre el precio.
  price_block: {
    // gap del container separa del título — no necesita margen extra
  },
  price_tick: {
    width: 26,
    height: 3,
    backgroundColor: colors.primary,
    borderRadius: 3,
    marginBottom: spacing.s_8,
  },
  price_row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.s_4,
  },
  price_text: {
    fontFamily: type_scale.price.fontFamily,
    fontSize: type_scale.price.fontSize,
    lineHeight: type_scale.price.lineHeight,
    letterSpacing: type_scale.price.letterSpacing,
    color: colors.ink,
  },
  price_per: {
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
    color: colors.gray_2,
  },

  // ── Specs ─────────────────────────────────────────────────────────────────
  specs_row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.s_4,
  },
  spec_separator: {
    width: 1,
    height: 18,
    backgroundColor: colors.silver,
    marginHorizontal: spacing.s_12,
  },
  spec_item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_4,
  },
  spec_text: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.gray_2,
  },
});
