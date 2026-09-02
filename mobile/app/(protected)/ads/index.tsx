/**
 * Ruta Stack — panel del anunciante: sus anuncios + métricas por zona.
 *
 * Gate de CAPACIDAD ya resuelto por app/(protected)/ads/_layout.tsx
 * (useCanAdvertise + Redirect) — esta pantalla NO repite ese chequeo.
 *
 * Alcance fijado por R23 (subtarea 171.3, NO negociable hacia arriba):
 *   - Lista de SUS anuncios: título, estado y vigencia (starts_at→ends_at).
 *   - TRES contadores globales: impresiones, vistas (≥3s), taps al CTA.
 *   - Desglose de esos contadores por zona.
 *   - SIN GRÁFICAS (llegan con #80). Cualquier UI extra es tarea derivada.
 *   - #227 (tarea derivada de 171.3): entrada al wizard de alta — botón "+"
 *     en headerRight + CTA del estado vacío → /ads/new/step1. El wizard
 *     (169.9) existía completo pero NADA navegaba a él: 169.9 construyó las
 *     pantallas y este techo de R23 no incluía el botón — cada subtarea
 *     cumplió su lista y el producto quedó sin puerta. Ambas entradas se
 *     condicionan a useCanAdvertise(): esta ruta también es alcanzable con
 *     la capacidad REVOCADA (dashboard de anuncios históricos, gate del
 *     _layout) y ahí mint-ad-upload-url respondería 403.
 *
 * ⚠️ Pantalla ausente del mockup canónico (CLAUDE.md §8) — el techo es
 * exactamente lo listado arriba.
 *
 * Composición de datos — dos hooks ya cerrados con TDD (NO tocar):
 *   useMyAds()             → src/features/ads/hooks/useMyAds.ts
 *   useAdMetrics(agency_id) → src/features/ads/hooks/useAdMetrics.ts
 * Fallan cerrado por separado: un error de métricas no oculta la lista de
 * anuncios, y viceversa (ver ambos ListHeaderComponent/ListEmptyComponent
 * abajo — cada bloque lee su propio `.error`/`.loading`).
 *
 * 🔴 Nombres de zona resueltos AQUÍ, no en un hook/lib (decisión del PLAN):
 * la RPC ad_metrics_for_agency solo devuelve municipality_id (text) /
 * neighborhood_id (bigint) — nunca un nombre. mx_municipalities/
 * mx_neighborhoods son catálogo público (grant select a anon+authenticated,
 * 20260727000001:71 / 20260813000001:101), sin datos de inquilino — no
 * amerita un ciclo TDD, y las carpetas hooks/ o lib/ de mobile SÍ son
 * CRÍTICAS por la regla determinista de CLAUDE.md §5. Un solo `.in('id',…)`
 * por catálogo, nunca una consulta por zona. 🔴 Los NÚMEROS nunca esperan a
 * las ETIQUETAS: si esta consulta falla o tarda, los contadores se pintan
 * igual con el texto de reserva ("Zona sin nombre").
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Megaphone, Play, Plus } from 'phosphor-react-native';

import { supabase } from '@/lib/supabase/client';
import { EmptyState } from '@/features/profile/components/EmptyState';
import { useCanAdvertise } from '@/features/ads/hooks/useCanAdvertise';
import { useMyAds, type MyAd } from '@/features/ads/hooks/useMyAds';
import { useAdMetrics, type AdZoneMetrics, type AdZoneTotals } from '@/features/ads/hooks/useAdMetrics';
import { useAdStats, type AdStatsTotals } from '@/features/ads/hooks/useAdStats';
import { colors, fonts, radii, spacing, type_scale } from '@/theme/theme';

// ---------------------------------------------------------------------------
// Copy / mapas de estado
// ---------------------------------------------------------------------------

export interface BadgeConfig {
  label: string;
  bg: string;
  text: string;
}

// Mismo patrón que PropertyListItem.tsx (STATUS_BADGE + fallback humanizado):
// nunca se pinta el string crudo del enum en pantalla.
// Exportado: app/(protected)/ads/[id].tsx (212.5) reusa el MISMO badge —
// dos pantallas hermanas del mismo folder, no un componente de src/features/
// importando una ruta (la razón por la que AdZoneBarsChart SÍ duplica en vez
// de importar, ver su docblock).
export const AD_STATUS_BADGE: Record<string, BadgeConfig> = {
  draft:           { label: 'Borrador',    bg: colors.paper_2,     text: colors.gray_3 },
  pending_review:  { label: 'En revisión', bg: colors.primary_tint, text: colors.primary },
  active:          { label: 'Activo',      bg: colors.primary,      text: colors.on_primary },
  paused:          { label: 'Pausado',     bg: colors.accent_soft,  text: colors.ink },
  expired:         { label: 'Vencido',     bg: colors.paper_2,      text: colors.gray_3 },
  rejected:        { label: 'Rechazado',   bg: colors.danger,       text: '#FFFFFF' },
};

const OTHER_ZONES_LABEL = 'Otras zonas';
const OTHER_ZONES_CAPTION = 'Zonas con muy poca audiencia para mostrarlas por separado.';
const MUNICIPALITY_FALLBACK = 'Municipio sin nombre';
const NEIGHBORHOOD_FALLBACK = 'Colonia sin nombre';

function humanize_ad_status(status: string): string {
  const spaced = status.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function get_ad_badge(status: string): BadgeConfig {
  return AD_STATUS_BADGE[status] ?? { label: humanize_ad_status(status), bg: colors.gray_2, text: colors.ink };
}

export function format_date_short(iso: string): string {
  return new Date(iso).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Estados que NUNCA pudieron tener exposición real (ningún camino de la
 * máquina de estados los lleva a 'active' sin pasar antes por moderación) —
 * sus 3 métricas por card se fuerzan a "—" SIN llamar a useAdStats con su
 * id real (evita la RPC y evita que un 0 legítimo — "SIEMPRE una fila si la
 * autorización pasa, 0 si no hay actividad", ad_stats_totals — se confunda
 * con "aún no aplica"). Decisión del preview aprobado 212.2 ("en revisión
 * muestra '—', nunca '0'").
 *
 * 🔴 'rejected' queda FUERA a propósito: la matriz de transiciones
 * (supabase/migrations/20260816000006_ads_state_machine.sql:122-129) SOLO
 * permite active→rejected — nunca pending_review→rejected — así que un
 * anuncio rechazado SÍ estuvo activo y puede tener alcance real que reportar.
 */
const NEVER_EXPOSED_STATUSES = new Set(['draft', 'pending_review']);

/** Contador compacto: ≥1000 → "1.2k" (mismo criterio que PropertyListItem.tsx). */
function format_count(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

function zone_label(
  zone: AdZoneMetrics,
  municipality_names: Record<string, string>,
  neighborhood_names: Record<number, string>,
): string {
  if (zone.neighborhood_id !== null) {
    return neighborhood_names[zone.neighborhood_id] ?? NEIGHBORHOOD_FALLBACK;
  }
  if (zone.municipality_id !== null) {
    return municipality_names[zone.municipality_id] ?? MUNICIPALITY_FALLBACK;
  }
  // Defensivo — useAdMetrics ya separa el bucket (NULL,NULL) en other_zones,
  // esta rama no debería alcanzarse con datos reales.
  return OTHER_ZONES_LABEL;
}

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------

/**
 * Fila de un anuncio propio: thumbnail, título, estado, vigencia y las 3
 * métricas "Máximo" (subtarea 212.5, techo = design-previews/212-dashboard-
 * anuncios.html, frame A). Tap → navega al detalle (/ads/<id>, 212.5).
 */
function AdListItem({ ad }: { ad: MyAd }) {
  const router = useRouter();
  const badge = get_ad_badge(ad.status);
  const caption = ad.paused_by_suspension
    ? 'Pausado porque tu organización está suspendida'
    : ad.status === 'rejected' && ad.rejection_reason
      ? ad.rejection_reason
      : null;

  // "Máximo" implícito, sin selector (mismos totales que mostraría el tab
  // "Máximo" del detalle) — null para estados que nunca tuvieron exposición
  // (NEVER_EXPOSED_STATUSES) evita disparar las 3 RPCs y fuerza "—".
  const stats_ad_id = NEVER_EXPOSED_STATUSES.has(ad.status) ? null : ad.id;
  const stats = useAdStats(stats_ad_id, 'max');
  // 213: una promo no tiene creative propio — `title` es la dirección de la
  // propiedad (ads.title = properties.address). Prefijo mínimo (ponytail:
  // reusa el mismo Text/estilo, sin componente nuevo) para distinguirla de
  // un display en esta misma lista.
  const display_title = ad.property_id ? `Promoción · ${ad.title}` : ad.title;

  return (
    <Pressable
      style={({ pressed }) => [styles.ad_row, pressed && styles.ad_row_pressed]}
      onPress={() => router.push(`/ads/${ad.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Ver detalle de ${display_title}`}
    >
      <View style={styles.ad_card_top}>
        {/* ponytail: caja decorativa (color sólido + ícono ▶), sin
            thumbnail_url real de ad_creatives — el preview usa un gradiente
            puramente decorativo (sin <img> ni dato ligado), y cargarlo real
            exigiría tocar useMyAds.ts (mobile/**​/hooks/** es CRÍTICO por
            CLAUDE.md §5, fuera de alcance de esta subtarea de pantallas). */}
        <View style={styles.thumb}>
          <Play size={16} color="rgba(246,242,235,0.8)" weight="fill" />
        </View>
        <View style={styles.ad_card_info}>
          <View style={styles.ad_row_top}>
            <Text style={styles.ad_title} numberOfLines={2}>{display_title}</Text>
            <View style={[styles.badge, { backgroundColor: badge.bg }]}>
              <Text style={[styles.badge_label, { color: badge.text }]}>{badge.label}</Text>
            </View>
          </View>
          <Text style={styles.ad_vigencia}>
            {format_date_short(ad.starts_at)} – {format_date_short(ad.ends_at)}
          </Text>
          {caption && <Text style={styles.ad_caption}>{caption}</Text>}
        </View>
      </View>

      <AdCardMetricsRow totals={stats.totals} />
    </Pressable>
  );
}

const AD_CARD_METRIC_ITEMS: { key: keyof AdStatsTotals; label: string }[] = [
  { key: 'impressions', label: 'Impresiones' },
  { key: 'views', label: 'Vistas completas' },
  { key: 'cta_taps', label: 'Toques al contacto' },
];

/**
 * Fila de 3 métricas de UN anuncio (card de la lista). totals=null → "—" en
 * las 3 (carga, error, sin autorización o estado nunca-expuesto) — NUNCA un
 * "0" fabricado, mismo invariante que TotalsRow pero a nivel de un solo ad.
 */
function AdCardMetricsRow({ totals }: { totals: AdStatsTotals | null }) {
  return (
    <View style={styles.card_metrics_row}>
      {AD_CARD_METRIC_ITEMS.map((item, index) => (
        <View key={item.key} style={[styles.card_metric, index > 0 && styles.card_metric_divider]}>
          <Text style={[styles.card_metric_value, totals === null && styles.card_metric_value_dim]}>
            {totals === null ? '—' : format_count(totals[item.key])}
          </Text>
          <Text style={styles.card_metric_label}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

/** Los TRES contadores globales (R23) — null = cargando/error, NUNCA "0". */
function TotalsRow({ totals }: { totals: AdZoneTotals }) {
  return (
    <View style={styles.totals_row}>
      <View style={styles.total_item}>
        <Text style={styles.total_value}>{format_count(totals.impressions)}</Text>
        <Text style={styles.total_label}>Impresiones</Text>
      </View>
      <View style={styles.total_item}>
        <Text style={styles.total_value}>{format_count(totals.views)}</Text>
        <Text style={styles.total_label}>Vistas</Text>
      </View>
      <View style={styles.total_item}>
        <Text style={styles.total_value}>{format_count(totals.cta_taps)}</Text>
        <Text style={styles.total_label}>Taps al CTA</Text>
      </View>
    </View>
  );
}

/** Una fila del desglose por zona (zona real u "otras zonas"). */
function ZoneRow({ label, totals, caption }: { label: string; totals: AdZoneTotals; caption?: string }) {
  return (
    <View style={styles.zone_row}>
      <View style={styles.zone_row_top}>
        <Text style={styles.zone_name} numberOfLines={1}>{label}</Text>
        <Text style={styles.zone_counts}>
          {format_count(totals.impressions)} · {format_count(totals.views)} · {format_count(totals.cta_taps)}
        </Text>
      </View>
      {caption && <Text style={styles.zone_caption}>{caption}</Text>}
    </View>
  );
}

/**
 * Bloque de métricas (cabecera del FlatList de anuncios). Lee `metrics`
 * (useAdMetrics) de forma independiente al estado de `useMyAds` — un error
 * aquí no debe ocultar la lista de anuncios (y viceversa).
 */
function MetricsSummary({
  metrics,
  municipality_names,
  neighborhood_names,
}: {
  metrics: ReturnType<typeof useAdMetrics>;
  municipality_names: Record<string, string>;
  neighborhood_names: Record<number, string>;
}) {
  if (metrics.error) {
    return (
      <View style={styles.metrics_block}>
        <Text style={styles.metrics_error}>{metrics.error}</Text>
      </View>
    );
  }

  // totals === null cubre TODO estado de "aún no hay número": cargando, o
  // agency_id sin resolver todavía (useAdMetrics no dispara sin agencyId,
  // ver su docblock) — NUNCA lo tratamos como "0".
  if (metrics.loading || metrics.totals === null) {
    return (
      <View style={[styles.metrics_block, styles.metrics_loading]}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.metrics_block}>
      <Text style={styles.section_title}>Tus métricas</Text>
      <TotalsRow totals={metrics.totals} />

      {(metrics.zones.length > 0 || metrics.other_zones) && (
        <>
          <Text style={styles.section_title}>Por zona</Text>
          {metrics.zones.map((zone, index) => (
            <ZoneRow
              key={`${zone.municipality_id ?? ''}:${zone.neighborhood_id ?? ''}:${index}`}
              label={zone_label(zone, municipality_names, neighborhood_names)}
              totals={{ impressions: zone.impressions, views: zone.views, cta_taps: zone.cta_taps }}
            />
          ))}
          {metrics.other_zones && (
            <ZoneRow label={OTHER_ZONES_LABEL} totals={metrics.other_zones} caption={OTHER_ZONES_CAPTION} />
          )}
        </>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pantalla principal
// ---------------------------------------------------------------------------

export default function AdsScreen() {
  const router = useRouter();
  const my_ads = useMyAds();
  const metrics = useAdMetrics(my_ads.agency_id);
  // #227: el botón de alta solo aparece con la capacidad vigente — la ruta
  // también es alcanzable con can_advertise revocada (dashboard histórico,
  // gate del _layout) y ahí crear una campaña terminaría en 403.
  const { can_advertise } = useCanAdvertise();

  // Resolución de nombres de zona en lote — ver docblock de arriba (§decisión
  // del PLAN). No bloquea el pintado de los contadores/desglose.
  const [municipality_names, set_municipality_names] = useState<Record<string, string>>({});
  const [neighborhood_names, set_neighborhood_names] = useState<Record<number, string>>({});

  useEffect(() => {
    let ignore = false;

    const municipality_ids = Array.from(
      new Set(metrics.zones.map((z) => z.municipality_id).filter((id): id is string => id !== null)),
    );
    const neighborhood_ids = Array.from(
      new Set(metrics.zones.map((z) => z.neighborhood_id).filter((id): id is number => id !== null)),
    );

    if (municipality_ids.length === 0 && neighborhood_ids.length === 0) return;

    async function load_zone_names(): Promise<void> {
      if (municipality_ids.length > 0) {
        const { data } = await supabase.from('mx_municipalities').select('id, name').in('id', municipality_ids);
        if (!ignore && data) {
          set_municipality_names(Object.fromEntries(data.map((row) => [row.id, row.name])));
        }
      }
      if (neighborhood_ids.length > 0) {
        const { data } = await supabase.from('mx_neighborhoods').select('id, name').in('id', neighborhood_ids);
        if (!ignore && data) {
          set_neighborhood_names(Object.fromEntries(data.map((row) => [row.id, row.name])));
        }
      }
    }

    void load_zone_names();

    return () => {
      ignore = true;
    };
  }, [metrics.zones]);

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackButtonDisplayMode: 'minimal',
          title: 'Mis anuncios',
          headerStyle: { backgroundColor: colors.paper },
          headerTintColor: colors.primary,
          headerTitleStyle: {
            fontFamily: 'HankenGrotesk_600SemiBold',
            color: colors.ink,
            fontSize: 17,
          },
          // #227: entrada persistente al wizard de alta (mismo patrón de
          // headerRight que profile/edit.tsx). Spread condicional — con
          // exactOptionalPropertyTypes no se puede pasar undefined explícito.
          ...(can_advertise && {
            headerRight: () => (
              <Pressable
                onPress={() => router.push('/ads/new/step1')}
                style={({ pressed }) => [styles.header_add_btn, pressed && styles.header_add_btn_pressed]}
                accessibilityRole="button"
                accessibilityLabel="Crear anuncio"
                hitSlop={8}
              >
                <Plus size={22} color={colors.primary} weight="bold" />
              </Pressable>
            ),
          }),
        }}
      />

      <FlatList<MyAd>
        style={styles.list}
        contentContainerStyle={styles.list_content}
        data={my_ads.ads}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <AdListItem ad={item} />}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <MetricsSummary
            metrics={metrics}
            municipality_names={municipality_names}
            neighborhood_names={neighborhood_names}
          />
        }
        ListEmptyComponent={
          my_ads.loading ? (
            <View style={styles.center_inline}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : my_ads.error ? (
            <View style={styles.center_inline}>
              <Text style={styles.metrics_error}>{my_ads.error}</Text>
            </View>
          ) : (
            <EmptyState
              message="Aún no tienes anuncios"
              // #227: voz ACTIVA + CTA — el usuario sin anuncios es justo el
              // que quiere crear el primero. Sin capacidad vigente no hay
              // acción que ofrecer (solo dashboard histórico) y se conserva
              // el copy descriptivo.
              subtitle={
                can_advertise
                  ? 'Crea tu primera campaña de video y llega a más personas.'
                  : 'Cuando tengas una campaña activa aparecerá aquí.'
              }
              icon={Megaphone}
              {...(can_advertise && {
                cta_label: 'Crear anuncio',
                onPressCta: () => router.push('/ads/new/step1'),
              })}
            />
          )
        }
        showsVerticalScrollIndicator={false}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Estilos — modo gestión-claro (mismo registro visual que my-listings.tsx)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  list_content: {
    flexGrow: 1,
    paddingHorizontal: spacing.s_16,
    paddingBottom: spacing.s_32,
  },
  separator: {
    height: spacing.s_8,
  },
  center_inline: {
    paddingVertical: spacing.s_32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header_add_btn: {
    padding: spacing.s_4,
  },
  header_add_btn_pressed: {
    opacity: 0.6,
  },

  // ── Bloque de métricas ────────────────────────────────────────────────────
  metrics_block: {
    paddingTop: spacing.s_16,
    paddingBottom: spacing.s_8,
  },
  metrics_loading: {
    alignItems: 'center',
    paddingVertical: spacing.s_24,
  },
  metrics_error: {
    ...type_scale.body,
    color: colors.danger,
  },
  section_title: {
    ...type_scale.caption,
    color: colors.gray_2,
    marginTop: spacing.s_16,
    marginBottom: spacing.s_8,
  },

  totals_row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.paper_2,
    borderRadius: radii.r_16,
    paddingVertical: spacing.s_16,
    paddingHorizontal: spacing.s_12,
  },
  total_item: {
    alignItems: 'center',
    flex: 1,
  },
  total_value: {
    ...type_scale.h1,
    fontSize: 24,
    lineHeight: 28,
    color: colors.ink,
  },
  total_label: {
    ...type_scale.caption,
    color: colors.gray_2,
    marginTop: spacing.s_4,
  },

  zone_row: {
    paddingVertical: spacing.s_8,
    borderBottomWidth: 1,
    borderBottomColor: colors.paper_2,
  },
  zone_row_top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.s_8,
  },
  zone_name: {
    ...type_scale.body,
    color: colors.ink,
    flexShrink: 1,
  },
  zone_counts: {
    ...type_scale.body,
    color: colors.gray_2,
  },
  zone_caption: {
    ...type_scale.caption,
    textTransform: 'none',
    letterSpacing: 0,
    color: colors.gray_2,
    marginTop: spacing.s_4,
  },

  // ── Fila de anuncio ───────────────────────────────────────────────────────
  ad_row: {
    backgroundColor: colors.surface,
    borderRadius: radii.r_16,
    padding: spacing.s_12,
  },
  ad_row_pressed: {
    opacity: 0.85,
  },
  ad_card_top: {
    flexDirection: 'row',
    gap: spacing.s_12,
    alignItems: 'flex-start',
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: radii.r_12,
    backgroundColor: colors.ink_feed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ad_card_info: {
    flex: 1,
    minWidth: 0,
  },
  ad_row_top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.s_8,
  },
  ad_title: {
    ...type_scale.body,
    fontFamily: 'HankenGrotesk_600SemiBold',
    color: colors.ink,
    flexShrink: 1,
  },
  badge: {
    borderRadius: radii.r_pill,
    paddingVertical: spacing.s_4,
    paddingHorizontal: spacing.s_12,
  },
  badge_label: {
    ...type_scale.caption,
    fontSize: 11,
  },
  ad_vigencia: {
    ...type_scale.body,
    color: colors.gray_2,
    marginTop: spacing.s_4,
  },
  ad_caption: {
    ...type_scale.caption,
    textTransform: 'none',
    letterSpacing: 0,
    color: colors.accent,
    marginTop: spacing.s_4,
  },

  // ── Fila de 3 métricas por card (212.5) ─────────────────────────────────
  card_metrics_row: {
    flexDirection: 'row',
    marginTop: spacing.s_12,
    paddingTop: spacing.s_12,
    borderTopWidth: 1,
    borderTopColor: colors.paper_2,
  },
  card_metric: {
    flex: 1,
    alignItems: 'center',
  },
  card_metric_divider: {
    borderLeftWidth: 1,
    borderLeftColor: colors.paper_3,
  },
  card_metric_value: {
    fontFamily: fonts.sans_bold,
    fontSize: 19,
    lineHeight: 22,
    color: colors.ink,
  },
  card_metric_value_dim: {
    color: colors.gray_1,
  },
  card_metric_label: {
    ...type_scale.caption,
    fontSize: 9.5,
    lineHeight: 12,
    color: colors.gray_2,
    textAlign: 'center',
    marginTop: spacing.s_4,
  },
});
