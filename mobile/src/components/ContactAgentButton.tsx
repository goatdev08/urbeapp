/**
 * ContactAgentButton — CTA de contacto al agente vía WhatsApp con registro de lead.
 *
 * Flujo: presionar → `useContactAgent` invoca la EF `contact-agent` (que crea el
 * lead en `whatsapp_opened`) → si responde 200, abre WhatsApp con el template
 * §19.3 que arma el servidor → si falla, mensaje inline en español y NO se abre.
 *
 * 75.4: la llamada, el mapa de errores y la apertura vivían aquí duplicados. Se
 * movieron al hook porque el feed y la tarjeta de agente necesitaban exactamente
 * lo mismo y estaban resolviéndolo por su cuenta, sin registrar el lead.
 *
 * Reusar PrimaryButton (liquid-glass salvia) como base visual: no reescribir el estilo.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { WhatsappLogo } from 'phosphor-react-native';

import { useContactAgent } from '@/hooks/useContactAgent';
import { colors, fonts, spacing } from '@/theme/theme';
import { PrimaryButton } from './PrimaryButton';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface ContactAgentButtonProps {
  /** UUID de la propiedad — se envía al EF para registrar el lead y obtener los datos del agente. */
  propertyId: string;
  /** Nombre del agente — usado en el accessibilityLabel del botón. */
  agentName: string;
  /**
   * Deshabilita el botón externamente — ej. cuando ya se sabe que el agente
   * no tiene teléfono (gate temprano antes de llamar al EF).
   * El componente también es non-interactivo mientras `is_contacting` es true.
   */
  disabled?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function ContactAgentButton({
  propertyId,
  agentName,
  disabled = false,
}: ContactAgentButtonProps): React.JSX.Element {
  const { contact_agent, is_contacting, error } = useContactAgent();

  return (
    <View>
      <PrimaryButton
        label="Contactar por WhatsApp"
        surface="light"
        loading={is_contacting}
        disabled={disabled}
        icon={<WhatsappLogo size={20} color="#FFFFFF" weight="bold" />}
        onPress={() => { if (!disabled) void contact_agent(propertyId); }}
        accessibilityLabel={`Contactar a ${agentName} por WhatsApp`}
      />
      {error !== null && (
        <Text style={styles.error_text}>{error}</Text>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  error_text: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: colors.danger,
    textAlign: 'center',
    marginTop: spacing.s_4,
    paddingHorizontal: spacing.s_8,
  },
});
