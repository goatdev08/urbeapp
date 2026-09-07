/**
 * AgentSelector — rail horizontal de chips para filtrar leads por agente (CRM del owner).
 *
 * Primer chip fijo "Todos" (selectedAgentId === null) + un chip por agente
 * (avatar o iniciales de fallback + nombre). Componente presentacional puro:
 * sin fetching ni lógica de negocio, todo el estado lo maneja el padre.
 *
 * Paleta: gestión clara (paper). Estilo hermano de FilterTabs (pills en
 * ScrollView horizontal) y LeadCard (avatar circular con fallback de iniciales).
 *
 * ponytail: ScrollView horizontal + Pressable pill — sin librería extra.
 *
 * #203.2: `agents` ahora puede incluir agentes SUSPENDIDOS (useAgencyAgents
 * ya no filtra solo status='active') — su chip se etiqueta "(suspendido)"
 * para que el owner sepa, antes de tocarlo, que está viendo el pipeline de
 * una cuenta congelada.
 *
 * `mode="assign"` (subtarea 269.6, hoja ASIGNAR de la banda "Sin gestor" del
 * segmento Equipo — alternativa A aprobada del preview 269-crm-equipo.html
 * sección 3): variante de lista VERTICAL sin chip "Todos" y con SOLO
 * agentes `status==='active'` (`reassign_lead_atomic` rechaza
 * TARGET_NOT_ACTIVE_MEMBER — ofrecer un suspendido en el selector sería un
 * error garantizado). `selectedAgentId` no aplica en este modo (la hoja se
 * cierra al elegir, no hay chip "activo" que resaltar).
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { colors, fonts, radii, spacing } from '@/theme/theme';
import type { Agent } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Iniciales del avatar fallback: 1ª letra de las primeras 2 palabras de
 * full_name. Null-safe: devuelve '?' si full_name es null/vacío.
 */
function get_initials(full_name: string | null): string {
  if (!full_name) return '?';
  const words = full_name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (words.length === 0) return '?';
  return words.map((word) => (word[0] ?? '').toUpperCase()).join('');
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AgentSelectorProps {
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
  /** 'filter' (default) = rail horizontal de chips + "Todos". 'assign' = lista
   * vertical sin "Todos", solo agentes `status==='active'` (269.6, ver nota de cabecera). */
  mode?: 'filter' | 'assign';
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function AgentSelector({
  agents,
  selectedAgentId,
  onSelectAgent,
  mode = 'filter',
}: AgentSelectorProps): React.JSX.Element {
  if (mode === 'assign') {
    const active_agents = agents.filter((agent) => agent.status === 'active');
    return (
      <View style={styles.assign_list}>
        {active_agents.map((agent) => (
          <Pressable
            key={agent.id}
            onPress={() => onSelectAgent(agent.id)}
            accessibilityRole="button"
            accessibilityLabel={`Asignar a ${agent.full_name ?? 'Agente'}`}
            style={styles.assign_row}
          >
            <View style={styles.avatar}>
              {agent.profile_photo_url !== null ? (
                <Image
                  source={{ uri: agent.profile_photo_url }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={200}
                />
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.avatar_placeholder]}>
                  <Text style={styles.avatar_initial}>{get_initials(agent.full_name)}</Text>
                </View>
              )}
            </View>
            <Text style={styles.assign_name} numberOfLines={1}>
              {agent.full_name ?? 'Agente'}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {/* ── Chip "Todos" ──────────────────────────────────────────────────── */}
      <Pressable
        onPress={() => onSelectAgent(null)}
        accessibilityRole="button"
        accessibilityLabel="Ver leads de todos los agentes"
        accessibilityState={{ selected: selectedAgentId === null }}
        style={[styles.chip, selectedAgentId === null ? styles.chip_active : styles.chip_inactive]}
      >
        <Text style={[styles.label, selectedAgentId === null ? styles.label_active : styles.label_inactive]}>
          Todos
        </Text>
      </Pressable>

      {/* ── Un chip por agente ────────────────────────────────────────────── */}
      {agents.map((agent) => {
        const is_active = agent.id === selectedAgentId;
        const base_name = agent.full_name ?? 'Agente';
        // #203.2: sufijo visible para que el owner sepa que el pipeline que
        // está por filtrar pertenece a una cuenta suspendida.
        const display_name =
          agent.status === 'suspended' ? `${base_name} (suspendido)` : base_name;

        return (
          <Pressable
            key={agent.id}
            onPress={() => onSelectAgent(agent.id)}
            accessibilityRole="button"
            accessibilityLabel={`Ver leads de ${display_name}`}
            accessibilityState={{ selected: is_active }}
            style={[styles.chip, is_active ? styles.chip_active : styles.chip_inactive]}
          >
            <View style={styles.avatar}>
              {agent.profile_photo_url !== null ? (
                <Image
                  source={{ uri: agent.profile_photo_url }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={200}
                />
              ) : (
                <View style={[StyleSheet.absoluteFill, styles.avatar_placeholder]}>
                  <Text style={styles.avatar_initial}>{get_initials(agent.full_name)}</Text>
                </View>
              )}
            </View>
            <Text
              style={[styles.label, is_active ? styles.label_active : styles.label_inactive]}
              numberOfLines={1}
            >
              {display_name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing.s_8,
    paddingVertical: spacing.s_4,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8,
    borderRadius: radii.r_pill,
    borderWidth: 1,
    paddingVertical: spacing.s_8,
    paddingHorizontal: spacing.s_12,
  },
  chip_active: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chip_inactive: {
    backgroundColor: colors.paper_2,
    borderColor: colors.silver,
  },

  // ── Avatar circular ────────────────────────────────────────────────────────
  avatar: {
    width: 24,
    height: 24,
    borderRadius: radii.r_pill,
    overflow: 'hidden',
    backgroundColor: colors.primary,
    flexShrink: 0,
  },
  avatar_placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  avatar_initial: {
    fontFamily: fonts.sans_bold,
    fontSize: 10,
    color: '#FFFFFF',
  },

  // ── Texto ──────────────────────────────────────────────────────────────────
  label: {
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
  },
  label_active: {
    color: '#FFFFFF',
  },
  label_inactive: {
    color: colors.ink,
  },

  // ── mode="assign" — lista vertical (269.6) ────────────────────────────────
  assign_list: {
    paddingVertical: spacing.s_4,
  },
  assign_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_12,
    paddingVertical: spacing.s_12,
    borderTopWidth: 1,
    borderTopColor: colors.paper_3,
  },
  assign_name: {
    flex: 1,
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    color: colors.ink,
  },
});
