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
