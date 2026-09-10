/**
 * feedShuffle.ts — barajado PURO y DETERMINISTA para la vuelta del feed
 * infinito (#285.2, doc 047 dirección D).
 *
 * La vuelta N≥2 llega permutada con semilla `hash_seed(session_id) + lap`, así
 * la repetición no es idéntica pero sí reproducible (misma sesión y vuelta →
 * mismo orden en cualquier render). Sin Math.random() ni Date.now(): la lógica
 * se testea con reloj fijo (memoria tests_bomba_de_fecha_y_estado_inicial).
 *
 * ponytail: PRNG mulberry32 + Fisher–Yates en ~15 líneas — techo conocido: no
 * es criptográfico ni pretende serlo (solo reparte el orden de ≤ cientos de
 * ítems). Sin dependencia nueva.
 */

/** FNV-1a de 32 bits: entero ≥ 0 determinista para un texto (p. ej. session_id). */
export function hash_seed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: generador puro en [0, 1) a partir de una semilla entera. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates sobre una copia: no muta la entrada; misma semilla → misma permutación. */
export function shuffle_with_seed<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const next = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/**
 * avoid_adjacent_repeat — costura sin repetición pegada (#288.2, polish 288).
 *
 * PLAN (fase RED, NO implementado): si `items.length > 1` y
 * `is_repeat(items[0])` es true, debe devolver una COPIA con el primer
 * elemento movido al final (el resto conserva su orden relativo). En
 * cualquier otro caso, copia idéntica. Nunca muta la entrada.
 *
 * ponytail: stub mínimo de la fase RED — copia sin rotar. Deja pasar los EC
 * de "vacío", "1 ítem" y "no coincide" (una copia idéntica ya los cumple) y
 * falla el EC "coincide → primero al final" (fase GREEN, subtarea 288.2).
 */
export function avoid_adjacent_repeat<T>(items: readonly T[], is_repeat: (first: T) => boolean): T[] {
  void is_repeat;
  return [...items];
}
