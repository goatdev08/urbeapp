/**
 * whatsapp.ts — helpers de deep link WhatsApp para property-detail.
 *
 * Funciones:
 *   open_whatsapp      — abre wa.me con número y dirección (AgentCard; sin lead CRM).
 *   open_whatsapp_text — abre wa.me con un mensaje ya armado (botón del perfil de agente).
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
  open_whatsapp_text(phone, `Hola, me interesa la propiedad en ${address}`);
}

/**
 * open_whatsapp_text — abre wa.me con un mensaje YA armado (180.2).
 *
 * Extraído de `open_whatsapp` para que el botón de contacto del perfil de
 * agente reuse el mismo camino sin duplicar el sanitizado ni el encode: ahí
 * no hay propiedad de por medio, el mensaje es "quiero contactarte".
 *
 * ponytail: se queda en `wa.me` (abre la app si está instalada, web si no) en
 * vez de la escalera deep-link/fallback/Alert de `open_whatsapp_ef` — esa
 * confirma "✓ Contacto enviado", que aquí mentiría: NO se registra lead
 * (contactar al agente desde su perfil no nace de una propiedad, y el CRM
 * exige property_id).
 *
 * @param phone Teléfono del agente. null/vacío → no hace nada.
 * @param text  Mensaje prefill sin encodear.
 */
export function open_whatsapp_text(phone: string | null, text: string): void {
  if (phone === null || phone.length === 0) return;
  // Limpia caracteres no numéricos (espacios, guiones, paréntesis)
  const clean_phone = phone.replace(/\D/g, '');
  void Linking.openURL(`https://wa.me/${clean_phone}?text=${encodeURIComponent(text)}`);
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
