/**
 * /ads/new/step4 — Paso 4 del wizard de anuncios: zonas.
 * Subtarea 169.9.
 *
 * REUSO OBLIGATORIO (CLAUDE.md §0, verificado por el analista): usePlaceSearch
 * + MapSearchSuggestions (#157) — el selector de zonas NO escribe búsqueda
 * nueva, reusa `search_places` tal cual.
 *
 * 🔴 Lista VACÍA es VÁLIDA = inventario nacional (D3 de 169.1, ver cabecera
 * de lib/validation.ts) — este screen lo dice explícito en la UI, nunca lo
 * trata como error.
 */
import React, { useCallback } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Buildings, MapPin, X } from 'phosphor-react-native';

import { useAdForm } from '@/features/ads/store/AdFormContext';
import { usePlaceSearch } from '@/features/map/hooks/usePlaceSearch';
import { MapSearchSuggestions } from '@/features/map/components/MapSearchSuggestions';
import type { PlaceSuggestion } from '@/features/map/lib/placeSearch';
import { validate_ad_zones, type AdZoneInput } from '@/features/ads/lib/validation';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, radii, spacing, type_scale } from '@/theme/theme';

const SEARCH_INPUT_HEIGHT = 48;

function to_ad_zone_inputs(zones: PlaceSuggestion[]): AdZoneInput[] {
  return zones.map((z) => ({
    municipality_id: z.kind === 'municipality' ? z.id : null,
    neighborhood_id: z.kind === 'neighborhood' ? Number(z.id) : null,
  }));
}

export default function AdStep4Screen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state, update } = useAdForm();
  const place_search = usePlaceSearch();

  const handle_select = useCallback(
    (suggestion: PlaceSuggestion) => {
      const already_selected = state.zones.some(
        (z) => z.kind === suggestion.kind && z.id === suggestion.id,
      );
      if (!already_selected) {
        update({ zones: [...state.zones, suggestion] });
      }
      place_search.clear();
    },
    [state.zones, update, place_search],
  );

  const handle_remove = useCallback(
    (kind: string, id: string) => {
      update({ zones: state.zones.filter((z) => !(z.kind === kind && z.id === id)) });
    },
    [state.zones, update],
  );

  const handle_next = useCallback(() => {
    // Defensivo — la selección ya produce entradas XOR-válidas por
    // construcción (nunca ambos ids a la vez); validate_ad_zones (169.6) se
    // llama de todos modos para no bifurcar el contrato del cliente.
    const result = validate_ad_zones(to_ad_zone_inputs(state.zones));
    if (!result.valid) return;
    router.push('/ads/new/step5');
  }, [state.zones, router]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scroll_content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.page_header}>
          <Text style={styles.page_title}>Zonas</Text>
          <Text style={styles.page_subtitle}>
            Elige colonias o municipios. Sin selección, tu anuncio se muestra
            en todo el país.
          </Text>
        </View>

        <View style={styles.search_wrap}>
          <TextInput
            style={styles.input}
            value={place_search.query}
            onChangeText={place_search.set_query}
            placeholder="Buscar colonia o municipio"
            placeholderTextColor={colors.gray_1}
            accessibilityLabel="Buscar zona"
          />
          <MapSearchSuggestions
            suggestions={place_search.suggestions}
            on_select={handle_select}
            top={SEARCH_INPUT_HEIGHT + spacing.s_4}
          />
        </View>

        <View style={styles.zones_list}>
          {state.zones.length === 0 ? (
            <Text style={styles.empty_hint}>Cobertura nacional (sin zonas elegidas)</Text>
          ) : (
            state.zones.map((zone) => (
              <View key={`${zone.kind}-${zone.id}`} style={styles.zone_row}>
                {zone.kind === 'neighborhood' ? (
                  <MapPin size={18} weight="fill" color={colors.primary} />
                ) : (
                  <Buildings size={18} weight="fill" color={colors.accent} />
                )}
                <View style={styles.zone_texts}>
                  <Text style={styles.zone_name} numberOfLines={1}>
                    {zone.name}
                  </Text>
                  <Text style={styles.zone_context} numberOfLines={1}>
                    {zone.context}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => handle_remove(zone.kind, zone.id)}
                  accessibilityLabel={`Quitar ${zone.name}`}
                  hitSlop={8}
                >
                  <X size={18} color={colors.gray_2} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <View style={[styles.cta_area, { paddingBottom: 16 + insets.bottom }]}>
        <PrimaryButton label="Siguiente" onPress={handle_next} surface="light" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  scroll: {
    flex: 1,
  },
  scroll_content: {
    paddingHorizontal: spacing.s_20,
    paddingTop: spacing.s_8,
    paddingBottom: spacing.s_24,
  },
  page_header: {
    marginBottom: spacing.s_20,
  },
  page_title: {
    ...type_scale.h1,
    fontSize: 22,
    color: colors.ink,
    marginBottom: spacing.s_4,
  },
  page_subtitle: {
    ...type_scale.body,
    fontSize: 14,
    color: colors.gray_2,
  },
  search_wrap: {
    position: 'relative',
    zIndex: 10,
  },
  input: {
    height: SEARCH_INPUT_HEIGHT,
    borderWidth: 1.5,
    borderColor: colors.paper_3,
    borderRadius: radii.r_12,
    paddingHorizontal: spacing.s_16,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  zones_list: {
    marginTop: spacing.s_20,
    gap: spacing.s_8,
  },
  empty_hint: {
    fontSize: 13,
    color: colors.gray_2,
    fontStyle: 'italic' as const,
  },
  zone_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_12,
    paddingHorizontal: spacing.s_16,
    paddingVertical: spacing.s_12,
    borderRadius: radii.r_12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.paper_3,
  },
  zone_texts: {
    flex: 1,
  },
  zone_name: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: colors.ink,
  },
  zone_context: {
    fontSize: 12,
    color: colors.gray_2,
  },
  cta_area: {
    paddingHorizontal: spacing.s_20,
    paddingVertical: spacing.s_16,
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderTopColor: colors.paper_3,
  },
});
