/**
 * Ruta Stack — detalle de UN anuncio propio (tarea #212, subtarea 212.5).
 *
 * Gate de CAPACIDAD/fallback ya resuelto por app/(protected)/ads/_layout.tsx
 * (useCanAdvertise + useMyAds + Redirect) — esta pantalla NO repite ese
 * chequeo. Llega empujada desde la card de app/(protected)/ads/index.tsx
 * (`router.push('/ads/'+id)`), bajo el <Stack> ambiental de
 * src/features/auth/protected-layout.tsx (mismo patrón que
 * app/(protected)/property/[id].tsx).
 *
 * Techo de alcance (OBLIGATORIO): mobile/design-previews/212-dashboard-
 * anuncios.html, frame B ("Detalle del anuncio") + las muestras de estado
 * (vacío/skeleton) fuera de los frames.
 *
 * Composición de datos:
 *   - Detalle del ad (título/estado/vigencia) — UNA query inline a `ads`
 *     por id (mismo patrón "resolución en el screen" que ya usa index.tsx
 *     para nombres de zona — no amerita un hook nuevo para un solo
 *     .maybeSingle()). Reusa el tipo `MyAd` de useMyAds.ts (mismas columnas)
 *     solo para tipar — sin importar el hook.
 *   - Estadísticas del periodo seleccionado — useAdStats(id, period)
 *     (212.3, ya cerrado con guardián — NO se toca).
 *   - AdDailyLineChart / AdZoneBarsChart (212.4, ya cerrados — se usan TAL
 *     CUAL, solo se les pasa la forma que devuelve useAdStats).
 *
 * 🔴 D-RANGO (bitácora tarea #212): más allá de 90 días la granularidad es
 * mensual. El preview muestra un bloque de "agregados mensuales" + una nota
 * explicativa para el tab "Máximo" — deliberadamente OMITIDOS aquí (briefing
 * de la subtarea: "el selector Hoy/30días/Máximo ya lo respeta vía las
 * RPCs; no inventes UI extra para eso"). `ad_stats_daily` NUNCA devuelve
 * días fuera de la ventana de retención de 90 (ver su comment on function en
 * supabase/migrations/20260824000001_ad_stats_per_ad.sql) — el gráfico
 * simplemente muestra los días disponibles; los TILES arriba (ad_stats_totals)
 * SÍ incluyen el histórico mensual completo en la suma, aunque el gráfico no
 * lo desglose día a día.
 *
 * Estados (según el preview):
 *   - Cargando detalle del ad, o cargando useAdStats → skeleton (bloques con
 *     pulso de opacidad, Animated.View — "sin librería de shimmer nueva",
 *     nota de diseño del preview).
 *   - Ad inexistente / error de red → mensaje neutro.
 *   - stats.error_message → mensaje neutro (useAdStats ya lo da en español).
 *   - stats.totals === null (sin error, sin loading) → EmptyState "Aún no
 *     hay datos" — EC-11 de useAdStats: 0 filas sin error = no autorizado
 *     (p.ej. can_advertise se apagó) o ad_id inexistente, nunca un "0".
 *   - Éxito → segmentado + 3 tiles (doblan como selector de métrica del
 *     gráfico) + AdDailyLineChart + AdZoneBarsChart + nota de vigencia.
 */
import React, { useEffect, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ChartLineUp } from 'phosphor-react-native';

import { supabase } from '@/lib/supabase/client';
import { EmptyState } from '@/features/profile/components/EmptyState';
import { useAdStats, type AdStatsPeriod } from '@/features/ads/hooks/useAdStats';
import type { MyAd } from '@/features/ads/hooks/useMyAds';
import {
  AdDailyLineChart,
  AD_STATS_METRIC_LABELS,
  type AdStatsMetricKey,
} from '@/features/ads/components/AdDailyLineChart';
import { AdZoneBarsChart } from '@/features/ads/components/AdZoneBarsChart';
import { get_ad_badge, format_date_short } from './index';
import { colors, fonts, radii, spacing, type_scale } from '@/theme/theme';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const AD_DETAIL_COLUMNS =
  'id, title, status, starts_at, ends_at, paused_at, paused_by_suspension, rejection_reason';

const AD_DETAIL_NEUTRAL_ERROR = 'No se pudo cargar el anuncio. Intenta de nuevo.';

const PERIOD_OPTIONS: { key: AdStatsPeriod; label: string }[] = [
  { key: 'today', label: 'Hoy' },
  { key: 'last30', label: '30 días' },
  { key: 'max', label: 'Máximo' },
];

const METRIC_KEYS: AdStatsMetricKey[] = ['impressions', 'views', 'cta_taps'];

// ---------------------------------------------------------------------------
// Skeleton — Animated.View + loop de opacity (nota de diseño del preview:
// "sin librería de shimmer nueva").
// ---------------------------------------------------------------------------

// Nombre en camelCase (useX) por exigencia del linter react-hooks —
// CLAUDE.md §naming: "hooks use_* salvo que el linter exija useX".
function usePulseOpacity(): Animated.Value {
  // useState (lazy initializer), NO useRef(...).current: el linter de
  // react-compiler (eslint-config-expo) prohíbe leer un ref durante el
  // render — useState garantiza la misma identidad estable sin ese acceso.
  const [opacity] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.5, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return opacity;
}

function AdDashboardSkeleton() {
  const opacity = usePulseOpacity();
  return (
    <Animated.View style={{ opacity }} testID="ad-detail-skeleton">
      <View style={styles.skel_row}>
        <View style={styles.skel_tile} />
        <View style={styles.skel_tile} />
        <View style={styles.skel_tile} />
      </View>
      <View style={[styles.skel_line, { width: '40%' }]} />
      <View style={styles.skel_chart} />
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Pantalla principal
// ---------------------------------------------------------------------------

export default function AdDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const ad_id = typeof params.id === 'string' && params.id.length > 0 ? params.id : null;

  // Detalle del ad (título/estado/vigencia) — query inline, mismo criterio
  // "resolución en el screen" que index.tsx ya usa para nombres de zona.
  const [ad, set_ad] = useState<MyAd | null>(null);
  const [ad_loading, set_ad_loading] = useState(true);
  const [ad_error, set_ad_error] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    async function load_ad(): Promise<void> {
      if (!ignore) {
        set_ad_loading(true);
        set_ad(null);
        set_ad_error(null);
      }

      if (!ad_id) {
        if (!ignore) set_ad_loading(false);
        return;
      }

      const { data, error } = await supabase
        .from('ads')
        .select(AD_DETAIL_COLUMNS)
        .eq('id', ad_id)
        .maybeSingle();

      if (ignore) return;

      if (error || !data) {
        set_ad(null);
        set_ad_error(AD_DETAIL_NEUTRAL_ERROR);
        set_ad_loading(false);
        return;
      }

      set_ad(data as unknown as MyAd);
      set_ad_error(null);
      set_ad_loading(false);
    }

    void load_ad();

    return () => {
      ignore = true;
    };
  }, [ad_id]);

  const [period, set_period] = useState<AdStatsPeriod>('last30');
  const [metric, set_metric] = useState<AdStatsMetricKey>('impressions');
  const stats = useAdStats(ad_id, period);

  // Nombres de zona — mismo patrón que index.tsx (resolución en el screen,
  // los NÚMEROS nunca esperan a las ETIQUETAS).
  const [municipality_names, set_municipality_names] = useState<Record<string, string>>({});
  const [neighborhood_names, set_neighborhood_names] = useState<Record<number, string>>({});

  useEffect(() => {
    let ignore = false;

    const municipality_ids = Array.from(
      new Set(stats.zones.map((z) => z.municipality_id).filter((id): id is string => id !== null)),
    );
    const neighborhood_ids = Array.from(
      new Set(stats.zones.map((z) => z.neighborhood_id).filter((id): id is number => id !== null)),
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
  }, [stats.zones]);

  const badge = ad ? get_ad_badge(ad.status) : null;
  const stats_pending = stats.is_loading;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackButtonDisplayMode: 'minimal',
          headerStyle: { backgroundColor: colors.paper },
          headerTintColor: colors.primary,
          headerTitle: () => (
            <View style={styles.header_title_wrap}>
              <Text style={styles.header_title} numberOfLines={1}>
                {ad?.title ?? 'Anuncio'}
              </Text>
              {badge && (
                <View style={[styles.header_badge, { backgroundColor: badge.bg }]}>
                  <Text style={[styles.header_badge_label, { color: badge.text }]}>{badge.label}</Text>
                </View>
              )}
            </View>
          ),
        }}
      />

      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {ad_loading ? (
          <AdDashboardSkeleton />
        ) : ad_error || !ad ? (
          <View style={styles.center_inline}>
            <Text style={styles.error_text}>{ad_error ?? 'Anuncio no encontrado.'}</Text>
          </View>
        ) : (
          <>
            {/* Selector segmentado Hoy / 30 días / Máximo */}
            <View style={styles.segmented}>
              {PERIOD_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.key}
                  onPress={() => set_period(opt.key)}
                  style={[styles.seg_btn, period === opt.key && styles.seg_btn_active]}
                  accessibilityRole="button"
                  accessibilityLabel={opt.label}
                  accessibilityState={{ selected: period === opt.key }}
                >
                  <Text style={[styles.seg_label, period === opt.key && styles.seg_label_active]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {stats_pending ? (
              <AdDashboardSkeleton />
            ) : stats.error_message ? (
              <View style={styles.center_inline}>
                <Text style={styles.error_text}>{stats.error_message}</Text>
              </View>
            ) : stats.totals === null ? (
              <EmptyState
                icon={ChartLineUp}
                message="Aún no hay datos"
                subtitle="Cuando tu anuncio reciba impresiones aparecerán aquí sus estadísticas."
              />
            ) : (
              <>
                {/* 3 tiles grandes — también seleccionan la métrica del gráfico */}
                <View style={styles.kpi_row}>
                  {METRIC_KEYS.map((key) => (
                    <Pressable
                      key={key}
                      onPress={() => set_metric(key)}
                      style={[styles.kpi_tile, metric === key && styles.kpi_tile_selected]}
                      accessibilityRole="button"
                      accessibilityLabel={AD_STATS_METRIC_LABELS[key]}
                      accessibilityState={{ selected: metric === key }}
                    >
                      <Text style={[styles.kpi_value, metric === key && styles.kpi_value_selected]}>
                        {stats.totals![key].toLocaleString('es-MX')}
                      </Text>
                      <Text style={styles.kpi_label}>{AD_STATS_METRIC_LABELS[key]}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.section_title}>Rendimiento por día</Text>
                <View style={styles.chart_card}>
                  <Text style={styles.chart_hint}>
                    {AD_STATS_METRIC_LABELS[metric]} · toca un tile arriba para cambiar la métrica
                  </Text>
                  <AdDailyLineChart daily={stats.daily} metric={metric} />
                </View>

                <Text style={styles.section_title}>Por zona</Text>
                <View style={styles.chart_card}>
                  <AdZoneBarsChart
                    zones={stats.zones}
                    municipality_names={municipality_names}
                    neighborhood_names={neighborhood_names}
                    metric={metric}
                  />
                </View>

                <View style={styles.vigencia_note}>
                  <Text style={styles.vigencia_text}>
                    Vigencia: {format_date_short(ad.starts_at)} – {format_date_short(ad.ends_at)}
                  </Text>
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.s_16,
    paddingBottom: spacing.s_32,
    paddingTop: spacing.s_16,
  },
  center_inline: {
    paddingVertical: spacing.s_32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error_text: {
    ...type_scale.body,
    color: colors.danger,
    textAlign: 'center',
  },

  // ── Título de header (nativo) con badge debajo ──────────────────────────
  header_title_wrap: {
    maxWidth: 230,
  },
  header_title: {
    fontFamily: fonts.sans_semibold,
    fontSize: 17,
    color: colors.ink,
  },
  header_badge: {
    alignSelf: 'flex-start',
    borderRadius: radii.r_pill,
    paddingVertical: 2,
    paddingHorizontal: spacing.s_8,
    marginTop: 3,
  },
  header_badge_label: {
    fontFamily: fonts.sans_semibold,
    fontSize: 9.5,
  },

  // ── Selector segmentado ──────────────────────────────────────────────────
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.paper_2,
    borderRadius: radii.r_pill,
    padding: 3,
    marginBottom: spacing.s_16,
  },
  seg_btn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.s_8,
    borderRadius: radii.r_pill,
  },
  seg_btn_active: {
    backgroundColor: colors.surface,
    shadowColor: '#1E160C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
  },
  seg_label: {
    fontFamily: fonts.sans_semibold,
    fontSize: 12.5,
    color: colors.gray_3,
  },
  seg_label_active: {
    color: colors.primary_deep,
  },

  // ── 3 tiles grandes ──────────────────────────────────────────────────────
  kpi_row: {
    flexDirection: 'row',
    gap: spacing.s_8,
    marginBottom: spacing.s_16,
  },
  kpi_tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.paper_3,
    borderRadius: radii.r_16,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  kpi_tile_selected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary_tint,
  },
  kpi_value: {
    fontFamily: fonts.display,
    fontSize: 22,
    letterSpacing: -0.44,
    lineHeight: 24,
    color: colors.ink,
  },
  kpi_value_selected: {
    color: colors.primary_deep,
  },
  kpi_label: {
    ...type_scale.caption,
    fontSize: 9.5,
    lineHeight: 13,
    color: colors.gray_2,
    textAlign: 'center',
    marginTop: 5,
  },

  // ── Secciones / tarjetas de gráfico ──────────────────────────────────────
  section_title: {
    ...type_scale.caption,
    color: colors.gray_2,
    marginTop: spacing.s_20,
    marginBottom: spacing.s_8,
  },
  chart_card: {
    backgroundColor: colors.surface,
    borderRadius: radii.r_16,
    borderWidth: 1,
    borderColor: colors.paper_3,
    shadowColor: '#1E160C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 1,
    padding: 14,
  },
  chart_hint: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.gray_2,
    marginBottom: spacing.s_8,
  },

  // ── Nota de vigencia ─────────────────────────────────────────────────────
  vigencia_note: {
    marginTop: spacing.s_20,
    backgroundColor: colors.paper_2,
    borderRadius: radii.r_12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  vigencia_text: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.gray_2,
    lineHeight: 16,
  },

  // ── Skeleton ──────────────────────────────────────────────────────────────
  skel_row: {
    flexDirection: 'row',
    gap: spacing.s_8,
    marginBottom: spacing.s_12,
  },
  skel_tile: {
    flex: 1,
    height: 52,
    borderRadius: radii.r_16,
    backgroundColor: colors.paper_2,
  },
  skel_line: {
    height: 12,
    borderRadius: radii.r_8,
    backgroundColor: colors.paper_2,
    marginBottom: spacing.s_8,
  },
  skel_chart: {
    height: 100,
    borderRadius: radii.r_16,
    backgroundColor: colors.paper_2,
    marginTop: spacing.s_4,
  },
});
