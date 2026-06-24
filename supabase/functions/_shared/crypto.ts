// _shared/crypto.ts — stub mínimo (not_implemented)
// El agente supabase implementará el hash real en la fase GREEN.

/**
 * Calcula el hash SHA-256 de un texto plano (hex).
 * Usado para comparar invitation tokens contra el campo `token` de
 * agency_invitation_tokens (que almacena el hash, nunca el valor plano).
 * STUB: lanza para que los tests fallen en rojo.
 */
export async function sha256_hex(_plaintext: string): Promise<string> {
  throw new Error("not_implemented");
}
