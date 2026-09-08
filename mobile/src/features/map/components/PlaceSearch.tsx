/**
 * PlaceSearch.tsx — buscador UNIFICADO de lugares: colonias + municipios +
 * direcciones (#232.2). Absorbe MapSearchSuggestions.tsx (mismo contrato de
 * catálogo — `suggestions`/`on_select_place`/`top`/`inline` — SUPERSET, no
 * reescritura) y agrega la sección "Direcciones" (Google Places API New).
 *
 * Arquitectura: el padre sigue siendo dueño del TextInput y de la búsqueda
 * de catálogo (usePlaceSearch, SIN cambios — MapSearchBar / el input de
 * ads/step4 no se tocan). Este componente es el DROPDOWN: recibe
 * `suggestions`/`loading`/`error` de catálogo como props (igual que
 * MapSearchSuggestions) y, con el MISMO texto (`query`), corre la búsqueda
 * de direcciones internamente (useAddressSearch) — un solo input, dos
 * búsquedas independientes.
 *
 * Flujo de selección de dirección (#232, contrato pinneado — la zona
 * guardada SIEMPRE es de catálogo, jamás inventada):
 *   1. Tap en una predicción → useAddressZoneResolver.resolve(place_id).
 *   2. 'resolved' → on_select_place(zone) — MISMA callback que una selección
 *      de catálogo; el padre no distingue el origen para el flujo de zona
 *      (colonia/municipio ya resuelta, XOR intacto).
 *   3. 'out_of_coverage' → on_address_out_of_coverage?.(point) (el mapa
 *      centra la cámara ahí sin filtro, #232.3); el mensaje pinneado
 *      ("Esa dirección está fuera de las zonas disponibles por ahora") se
 *      renderiza aquí mismo vía resolver.resolve_error.
 *   4. 'error' → resolver.resolve_error con el mensaje de la excepción.
 *
 * Degradación sin EXPO_PUBLIC_GOOGLE_PLACES_API_KEY: la sección "Direcciones"
 * simplemente NO aparece (useAddressSearch.available === false) — mismo
 * criterio silencioso que AddressAutocomplete.
 *
 * Dos modos de render (idénticos a MapSearchSuggestions, #157.8 lección
 * #231): `inline` en flujo (wizard, dentro de un ScrollView — un overlay
 * absoluto ahí es zona MUERTA al tacto en Android) y overlay flotante
 * (mapa, con `top` inyectado por el padre).
 *
 * Mini-spec (#282.2, UI fuera del mockup 6·MAPA con propuesta aceptada en
 * conjunto — exploración 046 dirección F, requerimiento explícito del
 * cliente: "los íconos... deben ser más claros o... identificarlas más
 * claramente"): `suggestions` llega YA rankeado por la RPC (282.1, ranking
 * por cercanía) — este componente solo AGRUPA por `kind`, nunca reordena.
 * Encabezados "Colonias" / "Municipios" (mismo estilo `section_header` que
 * ya usaba "Direcciones") aparecen solo si ese grupo tiene filas. Colonias
 * antes que Municipios antes que Direcciones. Sin etiqueta de texto por
 * fila: el ícono (MapPinSimple primary / Buildings accent / MapPin gray) +
 * el encabezado del grupo ya distinguen el tipo sin repetir texto en cada
 * fila (ponytail — ver bitácora 282.2). Cero tokens nuevos.
 */
import React, { useCallback } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Buildings, MapPin, MapPinSimple } from 'phosphor-react-native';

import { UrbeaLoader } from '@/components/UrbeaLoader';
import { colors, fonts, radii, shadows, spacing } from '@/theme/theme';
import type { AddressPlacesDeps, AddressPrediction } from '../lib/addressPlaces';
import type { PlaceSearchDeps, PlaceSuggestion } from '../lib/placeSearch';
import { useAddressSearch } from '../hooks/useAddressSearch';
import { useAddressZoneResolver } from '../hooks/useAddressZoneResolver';

export interface PlaceSearchDI {
  address?: AddressPlacesDeps;
  zone?: PlaceSearchDeps;
}

interface PlaceSearchProps {
  /** Texto actual del input del padre — dirige la búsqueda de direcciones. */
  query: string;
  /** Sugerencias de catálogo ya resueltas por el padre (usePlaceSearch). */
  suggestions: PlaceSuggestion[];
  /** true mientras el catálogo busca (#161) — spinner discreto en la fila. */
  loading?: boolean;
  /** Error del catálogo (#161) — texto discreto en el dropdown. */
  error?: string | null;
  /**
   * Colonia/municipio de catálogo elegido directo, O resuelto de una
   * dirección — el 2do argumento SOLO viene poblado en el caso de dirección
   * (el caller lo usa, p.ej., para el copy "Colonia resuelta de la
   * dirección" en ads/step4; el mapa puede ignorarlo).
   */
  on_select_place: (
    suggestion: PlaceSuggestion,
    meta?: { source: 'address'; address_text: string },
  ) => void;
  /** Dirección fuera de cobertura del catálogo (0 filas de place_at_point). */
  on_address_out_of_coverage?: (point: { lat: number; lng: number }) => void;
  /** Offset superior (bajo la barra) — lo calcula el padre. Solo overlay. */
  top?: number;
  /** Render EN FLUJO (wizard) en vez de overlay absoluto (mapa). */
  inline?: boolean;
  /** DI opcional para tests — mismo patrón que las libs subyacentes. */
  deps?: PlaceSearchDI;
}

export function PlaceSearch({
  query,
  suggestions,
  loading = false,
  error = null,
  on_select_place,
  on_address_out_of_coverage,
  top,
  inline = false,
  deps,
}: PlaceSearchProps): React.JSX.Element | null {
  const address_search = useAddressSearch(query, deps?.address);
  const resolver = useAddressZoneResolver(deps);

  const handle_select_address = useCallback(
    async (prediction: AddressPrediction) => {
      const result = await resolver.resolve(prediction.place_id);
      if (result.kind === 'resolved') {
        on_select_place(result.zone, { source: 'address', address_text: prediction.main_text });
      } else if (result.kind === 'out_of_coverage') {
        on_address_out_of_coverage?.(result.point);
      }
      // 'error' — resolver.resolve_error ya quedó seteado, se renderiza abajo.
    },
    [resolver, on_select_place, on_address_out_of_coverage],
  );

  const show_addresses = address_search.available;
  const has_address_content =
    show_addresses &&
    (address_search.predictions.length > 0 ||
      address_search.loading ||
      address_search.error != null ||
      resolver.resolving ||
      resolver.resolve_error != null);

  const has_content = suggestions.length > 0 || loading || error != null || has_address_content;
  if (!has_content) return null;

  // Agrupar por kind SIN reordenar (el ranking ya lo hizo la RPC, #282.1).
  const neighborhoods = suggestions.filter((s) => s.kind === 'neighborhood');
  const municipalities = suggestions.filter((s) => s.kind === 'municipality');
  // #283: el grupo que contiene la PRIMERA sugerencia de la RPC va primero —
  // con «zapo» desde GDL la fila 1 es el municipio Zapopan y el agrupado fijo
  // lo mandaba bajo siete colonias, fuera de la vista sin scroll.
  // ponytail: un booleano y dos bloques en orden condicional, sin sort.
  const municipalities_first = suggestions[0]?.kind === 'municipality';
  const neighborhood_group = neighborhoods.length > 0 && (
    <>
      <Text style={styles.section_header}>Colonias</Text>
      {neighborhoods.map((s) => (
        <PlaceRow key={`${s.kind}-${s.id}`} suggestion={s} on_select_place={on_select_place} />
      ))}
    </>
  );
  const municipality_group = municipalities.length > 0 && (
    <>
      <Text style={styles.section_header}>Municipios</Text>
      {municipalities.map((s) => (
        <PlaceRow key={`${s.kind}-${s.id}`} suggestion={s} on_select_place={on_select_place} />
      ))}
    </>
  );

  return (
    <View
      style={inline ? styles.container_inline : [styles.container, { top: top ?? 0 }]}
      pointerEvents="box-none"
    >
      <ScrollView
        style={styles.dropdown}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
      >
        {loading && <StatusRow text="Buscando…" spinner />}
        {error != null && <StatusRow text={error} variant="error" />}

        {municipalities_first ? municipality_group : neighborhood_group}
        {municipalities_first ? neighborhood_group : municipality_group}

        {has_address_content && (
          <>
            <Text style={styles.section_header}>Direcciones</Text>

            {address_search.loading && <StatusRow text="Buscando direcciones…" spinner />}
            {address_search.error != null && (
              <StatusRow text={address_search.error} variant="error" />
            )}

            {address_search.predictions.map((prediction) => (
              <TouchableOpacity
                key={prediction.place_id}
                style={[styles.row, styles.row_border]}
                onPress={() => void handle_select_address(prediction)}
                disabled={resolver.resolving}
                accessibilityRole="button"
                accessibilityLabel={`Usar dirección ${prediction.main_text}`}
              >
                <MapPin size={18} color={colors.gray_2} />
                <View style={styles.texts}>
                  <Text style={styles.name} numberOfLines={1}>
                    {prediction.main_text}
                  </Text>
                  {prediction.secondary_text != null && (
                    <Text style={styles.context} numberOfLines={1}>
                      {prediction.secondary_text}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            ))}

            {resolver.resolving && <StatusRow text="Resolviendo dirección…" spinner />}
            {resolver.resolve_error != null && (
              <StatusRow text={resolver.resolve_error} variant="error" />
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PlaceRow — fila de catálogo (colonia/municipio); ícono por tipo, sin
// etiqueta de texto (el section_header del grupo ya distingue el tipo, #282.2)
// ─────────────────────────────────────────────────────────────────────────────

function PlaceRow({
  suggestion: s,
  on_select_place,
}: {
  suggestion: PlaceSuggestion;
  on_select_place: (suggestion: PlaceSuggestion) => void;
}): React.JSX.Element {
  return (
    <TouchableOpacity
      style={[styles.row, styles.row_border]}
      onPress={() => on_select_place(s)}
      accessibilityRole="button"
      accessibilityLabel={`Buscar ${s.name}, ${s.context}`}
    >
      {s.kind === 'neighborhood' ? (
        <MapPinSimple size={18} weight="fill" color={colors.primary} />
      ) : (
        <Buildings size={18} weight="fill" color={colors.accent} />
      )}
      <View style={styles.texts}>
        <Text style={styles.name} numberOfLines={1}>
          {s.name}
        </Text>
        <Text style={styles.context} numberOfLines={1}>
          {s.context}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StatusRow — fila de loading/error/mensaje (sin ícono de zona)
// ─────────────────────────────────────────────────────────────────────────────

function StatusRow({
  text,
  spinner = false,
  variant = 'default',
}: {
  text: string;
  spinner?: boolean;
  variant?: 'default' | 'error';
}): React.JSX.Element {
  return (
    <View style={[styles.row, styles.row_border, styles.status_row]}>
      {spinner && <UrbeaLoader size="small" color={colors.primary} />}
      <Text
        style={[styles.status_text, variant === 'error' && styles.status_text_error]}
        numberOfLines={2}
      >
        {text}
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos — mismo lenguaje visual que MapSearchSuggestions (#157.8)
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.s_16,
    right: spacing.s_16,
  },
  container_inline: {
    marginTop: spacing.s_8,
  },
  dropdown: {
    maxHeight: 360,
    borderRadius: radii.r_16,
    borderWidth: 1,
    borderColor: 'rgba(227, 220, 207, 0.60)',
    backgroundColor: colors.surface,
    ...shadows.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_12,
    paddingHorizontal: spacing.s_16,
    paddingVertical: spacing.s_12,
  },
  row_border: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.paper_3,
  },
  texts: {
    flex: 1,
  },
  name: {
    fontFamily: fonts.sans_semibold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.ink,
  },
  context: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: colors.gray_2,
  },
  section_header: {
    fontFamily: fonts.sans_semibold,
    fontSize: 11,
    lineHeight: 16,
    color: colors.gray_2,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: spacing.s_16,
    paddingTop: spacing.s_12,
    paddingBottom: spacing.s_4,
  },
  status_row: {
    gap: spacing.s_8,
  },
  status_text: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.gray_2,
  },
  status_text_error: {
    color: colors.danger,
  },
});
