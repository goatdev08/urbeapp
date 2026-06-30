/**
 * whatsapp.ts — helper de deep link WhatsApp para property-detail.
 *
 * Compartido entre AgentCard (icono en card) y PropertyDetailScreen (CTA sticky).
 *
 * ponytail: función mínima sin side-effects de CRM. Registro de lead llega en #11.
 */
import { Linking } from 'react-native';

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
