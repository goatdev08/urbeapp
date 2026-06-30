/**
 * whatsapp.ts — helpers de deep link WhatsApp para property-detail.
 *
 * Funciones:
 *   open_whatsapp      — abre wa.me con número y dirección (AgentCard; sin lead CRM).
 *   open_whatsapp_ef   — abre WhatsApp con phone+message de la EF contact-agent (CTA sticky).
 *                        Incluye canOpenURL + fallback web + Alert nativo de confirmación.
 *
 * ponytail: registro de lead CRM llega en #11.
 */
import { Alert, Linking } from 'react-native';

/**
 * Abre WhatsApp con el número del agente y un mensaje prefill de la propiedad.
 *
 * ponytail: sin registro de lead CRM — llega en #11
 *
 * @param phone   Teléfono del agente (string | null). Si null/vacío, no hace nada.
 * @param address Dirección de la propiedad para el mensaje prefill.
 */
export function open_whatsapp(phone: string | null, address: string): void {
  if (phone === null || phone.length === 0) return;
  // Limpia caracteres no numéricos (espacios, guiones, paréntesis)
  const clean_phone = phone.replace(/\D/g, '');
  const text = encodeURIComponent(`Hola, me interesa la propiedad en ${address}`);
  void Linking.openURL(`https://wa.me/${clean_phone}?text=${text}`);
}

/**
 * open_whatsapp_ef — abre WhatsApp con el phone y message entregados por la EF contact-agent.
 * El phone ya viene solo-dígitos (sanitizado por el EF).
 *
 * Flujo:
 *   1. whatsapp:// disponible → abre app nativa con deep link.
 *   2. No disponible → fallback https://wa.me/ (web):
 *      - pre-llena número + mensaje en cualquier dispositivo
 *      - más robusto que SMS: el esquema sms: difiere entre iOS/Android y
 *        no pre-llena el número cuando se usa la forma `sms:?body=`.
 *      // ponytail: techo demo; SMS cross-platform es frágil y menos UX que wa.me.
 *   3. Cualquier apertura falla (try/catch) → Alert de error.
 *   4. Éxito → Alert.alert nativo '✓ Contacto enviado'.
 */
export async function open_whatsapp_ef(phone: string, message: string): Promise<void> {
  const encoded_text = encodeURIComponent(message);
  const native_url = `whatsapp://send?phone=${phone}&text=${encoded_text}`;
  const web_url    = `https://wa.me/${phone}?text=${encoded_text}`;

  try {
    const can_open = await Linking.canOpenURL(native_url);
    await Linking.openURL(can_open ? native_url : web_url);
    Alert.alert('✓ Contacto enviado', 'Se abrió WhatsApp con los datos de la propiedad.');
  } catch {
    Alert.alert(
      'No se pudo abrir',
      'Verifica que WhatsApp esté disponible e intenta de nuevo.',
    );
  }
}
