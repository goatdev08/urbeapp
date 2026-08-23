/**
 * AdvertiserCategorySelect — selector de categoría de anunciante, visible
 * SOLO cuando la organización tiene `can_advertise` encendido.
 *
 * Valores del enum `public.advertiser_category` — fuente de verdad:
 * `supabase/functions/set-org-advertising/types.ts` (ADVERTISER_CATEGORIES,
 * ya alineada con la DB por 209.1) y la migración
 * `20260815000001_org_advertising_capability.sql:20-25`. Se duplican aquí
 * como constante local porque `supabase/functions/` es un proyecto Deno
 * separado, no importable desde `mobile/`.
 *
 * Nace en la subtarea #209.2 (alta de organización); pensado para
 * reutilizarse en #209.3 (detalle de organización) — por eso vive en
 * `features/admin/components/` y no inline en la pantalla.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SelectionCard } from '@/features/publish/components/SelectionCard';

// ---------------------------------------------------------------------------
// Enum — espejo de ADVERTISER_CATEGORIES (ver comentario de módulo)
// ---------------------------------------------------------------------------

export const ADVERTISER_CATEGORIES = [
  'credito_hipotecario',
  'seguros',
  'mudanzas',
  'limpieza',
  'notaria',
  'avaluos',
  'otro',
] as const;

export type AdvertiserCategory = (typeof ADVERTISER_CATEGORIES)[number];

const ADVERTISER_CATEGORY_LABELS: Record<AdvertiserCategory, string> = {
  credito_hipotecario: 'Crédito hipotecario',
  seguros: 'Seguros',
  mudanzas: 'Mudanzas',
  limpieza: 'Limpieza',
  notaria: 'Notaría',
  avaluos: 'Avalúos',
  otro: 'Otro',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AdvertiserCategorySelectProps {
  value: AdvertiserCategory | null;
  onChange: (category: AdvertiserCategory) => void;
  error?: string | undefined;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function AdvertiserCategorySelect({
  value,
  onChange,
  error,
}: AdvertiserCategorySelectProps) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>Categoría de anunciante *</Text>
      <View style={styles.grid}>
        {ADVERTISER_CATEGORIES.map((category) => (
          <View key={category} style={styles.grid_item}>
            <SelectionCard
              label={ADVERTISER_CATEGORY_LABELS[category]}
              selected={value === category}
              onPress={() => onChange(category)}
            />
          </View>
        ))}
      </View>
      {error !== undefined && error.length > 0 && (
        <Text style={styles.error_text} accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  grid_item: {
    width: '47%',
  },
  error_text: {
    marginTop: 6,
    fontSize: 12,
    color: '#EF4444',
  },
});
