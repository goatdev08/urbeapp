/**
 * AssignLeadSheet — hoja "Asignar a…" del botón ASIGNAR (banda "Sin gestor",
 * segmento Equipo del CRM, subtarea 269.6).
 *
 * Preview aprobado: mobile/design-previews/269-crm-equipo.html sección 3,
 * alternativa A (RECOMENDADA — bottom sheet, decisión de Abraham
 * 2026-09-07): `AgentSelector` reusado en `mode="assign"` como lista
 * vertical, sin "Todos" ni suspendidos. Molde de Modal: CrmSearchSheet.tsx.
 *
 * Sección 7 del preview (UI_FUERA_DEL_MOCKUP, EN CONJUNTO — decisión de
 * Abraham): feedback de éxito/error tras elegir agente, dentro de la propia
 * hoja (banner de texto, sin componente nuevo — costo XS).
 *
 * 🪶 ponytail: sin deshabilitar filas mientras `reassign` está en vuelo — el
 * propio hook (`useReassignLead.is_working_ref`) ya gatea un segundo tap
 * concurrente (devuelve `{ok:false,message:null}` sin llamar la RPC de
 * nuevo), así que un doble tap no corrompe nada; solo se pierde el
 * indicador visual de "cargando", que el preview tampoco dibuja.
 */
import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableWithoutFeedback, View } from 'react-native';

import { colors, fonts, radii, spacing } from '@/theme/theme';
import type { Agent } from '../types';
import type { ReassignLeadResult } from '../hooks/useReassignLead';
import { AgentSelector } from './AgentSelector';

export interface AssignLeadSheetLead {
  lead_id: string;
  lead_display_name: string | null;
}

export interface AssignLeadSheetProps {
  visible: boolean;
  lead: AssignLeadSheetLead | null;
  /** Agentes de la agencia (activos Y suspendidos) — el filtro a solo
   * activos lo aplica AgentSelector en mode="assign". */
  agents: Agent[];
  reassign: (lead_id: string, to_agent: string) => Promise<ReassignLeadResult>;
  onClose: () => void;
  /** Llamado tras un reasignado EXITOSO (el padre refresca el overview). */
  onAssigned: () => void;
}

export function AssignLeadSheet({
  visible,
  lead,
  agents,
  reassign,
  onClose,
  onAssigned,
}: AssignLeadSheetProps): React.JSX.Element {
  const [feedback, set_feedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // Reabrir la hoja para OTRO lead no debe arrastrar el feedback del anterior.
  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resincroniza el feedback en cada apertura, mismo criterio que CrmSearchSheet con el input.
      set_feedback(null);
    }
  }, [visible]);

  async function handle_select_agent(agent_id: string): Promise<void> {
    if (!lead) return;
    const agent = agents.find((a) => a.id === agent_id);
    const result = await reassign(lead.lead_id, agent_id);
    if (result.ok) {
      set_feedback({
        kind: 'success',
        text: `${lead.lead_display_name ?? 'El lead'} ahora es de ${agent?.full_name ?? 'ese agente'}`,
      });
      onAssigned();
    } else {
      set_feedback({ kind: 'error', text: result.message ?? 'Ocurrió un error. Intenta de nuevo.' });
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose} accessibilityLabel="Cerrar hoja de asignar">
        <View style={styles.overlay} />
      </TouchableWithoutFeedback>

      <View style={styles.sheet}>
        <View style={styles.handle_wrap}>
          <View style={styles.handle} />
        </View>

        <Text style={styles.title}>Asignar a…</Text>
        <Text style={styles.subtitle}>{lead?.lead_display_name ?? 'Este lead'} · agentes activos de tu agencia</Text>

        {feedback ? (
          <View style={[styles.toast, feedback.kind === 'error' && styles.toast_err]}>
            <Text style={styles.toast_text}>{feedback.text}</Text>
          </View>
        ) : null}

        <AgentSelector agents={agents} selectedAgentId={null} onSelectAgent={(id) => void (id && handle_select_agent(id))} mode="assign" />
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
    maxHeight: '74%',
  },
  handle_wrap: {
    alignItems: 'center',
    paddingTop: spacing.s_12,
    paddingBottom: spacing.s_16,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.paper_3,
  },
  title: {
    fontFamily: fonts.outfit_bold,
    fontSize: 16,
    color: colors.ink,
  },
  subtitle: {
    marginTop: 2,
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.gray_2,
  },
  toast: {
    marginTop: spacing.s_12,
    backgroundColor: colors.ink,
    borderRadius: radii.r_12,
    paddingVertical: spacing.s_12,
    paddingHorizontal: spacing.s_16,
  },
  toast_err: {
    backgroundColor: colors.danger,
  },
  toast_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 12,
    color: '#FDFBF6',
  },
});
