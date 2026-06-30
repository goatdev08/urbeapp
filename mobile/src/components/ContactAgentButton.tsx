/**
 * ContactAgentButton — CTA de contacto al agente vía WhatsApp con registro de lead.
 *
 * Flujo:
 *   1. Usuario presiona el botón → estado loading.
 *   2. Llama a la EF `contact-agent` con { propertyId }.
 *   3. Éxito (200): invoca `onContactReady(phone, message)` para que
 *      el llamador abra WhatsApp (14.7 implementa deep link + fallback + Alert).
 *   4. Error (4xx/5xx): mapea el `error.code` de la EF a un mensaje en ES
 *      y lo muestra inline bajo el botón.
 *
 * Reusar PrimaryButton (liquid-glass salvia) como base visual: no reescribir el estilo.
 *
 * ponytail: onContactReady es un stub en PropertyDetailScreen hasta 14.7;
 * el EF gestiona el CRM — aquí solo el estado UI + llamada + manejo de errores.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '@/lib/supabase/client';
import { colors, fonts, spacing } from '@/theme/theme';
import { PrimaryButton } from './PrimaryButton';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos internos (respuesta de la EF)
// ─────────────────────────────────────────────────────────────────────────────

type ContactAgentSuccessBody = {
  success: true;
  phone: string;
  message: string;
  lead_id: string;
  property_id: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Mapeo de error codes → mensajes en español
// ─────────────────────────────────────────────────────────────────────────────

const EF_ERROR_MESSAGES: Record<string, string> = {
  UNAUTHENTICATED:        'Debes iniciar sesión para contactar al agente.',
  INVALID_INPUT:          'Datos incorrectos. Intenta de nuevo.',
  NOT_FOUND:              'Propiedad no encontrada.',
  INVALID_PROPERTY_STATE: 'Esta propiedad no está disponible para contacto.',
  AGENT_PHONE_MISSING:    'El agente no tiene número de WhatsApp registrado.',
  CANNOT_CONTACT_SELF:    'No puedes contactarte a ti mismo.',
  DB_ERROR:               'Error interno. Intenta de nuevo.',
};

function map_ef_error(code: string | undefined): string {
  if (code === undefined) return 'No se pudo conectar. Verifica tu conexión e intenta de nuevo.';
  return EF_ERROR_MESSAGES[code] ?? 'Ocurrió un error. Intenta de nuevo.';
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface ContactAgentButtonProps {
  /** UUID de la propiedad — se envía al EF para registrar el lead y obtener los datos del agente. */
  propertyId: string;
  /** Nombre del agente — usado en el accessibilityLabel del botón. */
  agentName: string;
  /**
   * Callback invocado cuando el EF responde con éxito.
   * Recibe el teléfono (solo dígitos, ya sanitizado por el EF) y el mensaje
   * prefill de WhatsApp generado por el EF.
   *
   * 14.7 implementa el deep link real + fallback a SMS + Alert de confirmación.
   * ponytail: la apertura mínima (Linking.openURL wa.me) vive en PropertyDetailScreen
   * como stub hasta que 14.7 la reemplace con la lógica completa.
   */
  onContactReady?: (phone: string, message: string) => void;
  /**
   * Deshabilita el botón externamente — ej. cuando ya se sabe que el agente
   * no tiene teléfono (gate temprano antes de llamar al EF).
   * El componente también es non-interactivo mientras `loading` es true.
   */
  disabled?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function ContactAgentButton({
  propertyId,
  agentName,
  onContactReady,
  disabled = false,
}: ContactAgentButtonProps): React.JSX.Element {
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  async function handle_contact_press(): Promise<void> {
    if (loading || disabled) return;

    set_loading(true);
    set_error(null);

    const { data, error: ef_error } = await supabase.functions.invoke<ContactAgentSuccessBody>(
      'contact-agent',
      { body: { propertyId } },
    );

    set_loading(false);

    // ── Errores de transporte o EF (4xx/5xx) ──────────────────────────────
    if (ef_error !== null) {
      let code: string | undefined;
      try {
        // FunctionsHttpError expone context como el Response crudo (body no consumido).
        // Documentado en @supabase/functions-js v2.108.x:
        //   const errorMessage = await error.context.json()
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        const body = await ef_error.context?.json?.();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        code = (body as { error?: { code?: string } })?.error?.code;
      } catch {
        // FunctionsFetchError (red error) — no tiene body JSON; usa mensaje genérico.
      }
      set_error(map_ef_error(code));
      return;
    }

    // ── Respuesta vacía (no debería ocurrir si el EF funciona) ───────────
    if (data === null) {
      set_error('Ocurrió un error inesperado. Intenta de nuevo.');
      return;
    }

    // ── Éxito — delegar apertura de WhatsApp al llamador (14.7) ──────────
    onContactReady?.(data.phone, data.message);
  }

  return (
    <View>
      <PrimaryButton
        label="Contactar por WhatsApp"
        surface="light"
        loading={loading}
        disabled={disabled}
        icon={<Ionicons name="logo-whatsapp" size={20} color="#FFFFFF" />}
        onPress={() => { void handle_contact_press(); }}
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
