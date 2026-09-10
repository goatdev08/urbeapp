/**
 * feedShuffle.ts — STUB RED (#285.2). Contrato en __tests__/feedShuffle.test.ts.
 */
export function hash_seed(_text: string): number {
  return 0;
}

export function shuffle_with_seed<T>(items: readonly T[], _seed: number): T[] {
  return [...items];
}
