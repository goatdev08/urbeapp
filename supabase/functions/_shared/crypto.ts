// _shared/crypto.ts

/**
 * Calcula el hash SHA-256 de un texto plano y lo devuelve como string hex.
 * Usado para comparar invitation tokens contra el campo `token` de
 * agency_invitation_tokens (que almacena el hash, nunca el valor plano).
 */
export async function sha256_hex(plaintext: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const hash_buffer = await crypto.subtle.digest("SHA-256", data);
  const hash_array = Array.from(new Uint8Array(hash_buffer));
  return hash_array.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Genera un código de invitación alfanumérico de `len` caracteres (default 8).
 * Usa crypto.getRandomValues para seguridad criptográfica.
 * El valor plano se entrega al admin y NUNCA se persiste en BD; lo que se persiste
 * es sha256_hex(código) en el campo agency_invitation_tokens.token.
 *
 * Alfabeto: A-Z, a-z, 0-9 (62 chars).
 *
 * STUB fase RED 7.6 — implementación pendiente en fase GREEN.
 */
export function generate_invitation_code(_len: number = 8): string {
  throw new Error("not_implemented: generate_invitation_code");
}
