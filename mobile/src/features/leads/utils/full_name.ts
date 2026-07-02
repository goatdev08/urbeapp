/**
 * build_full_name — une first_name/last_name en un nombre completo.
 *
 * Compartido entre useAgencyAgents y useAgentLeads (subtarea 30.3): ambos
 * hooks leen la identidad de una persona desde `users.first_name` /
 * `users.last_name` con la MISMA regla de negocio (reusar > reescribir).
 */

/** Une first_name/last_name en un nombre completo; null si ambos vacíos. */
export function build_full_name(first: string | null, last: string | null): string | null {
  const full = [first, last].filter(Boolean).join(' ').trim();
  return full.length > 0 ? full : null;
}
