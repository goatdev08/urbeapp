/**
 * RED — shuffle_with_seed / hash_seed (#285.2, feed infinito, doc 047)
 * SUT: mobile/src/features/feed/lib/feedShuffle.ts
 *
 * La vuelta N≥2 del feed llega barajada con semilla `hash_seed(session_id) + lap`
 * para que la repetición no sea idéntica. El barajado tiene que ser PURO y
 * DETERMINISTA: misma semilla → misma permutación (dos renders/dos dispositivos
 * con la misma sesión y vuelta ven el mismo orden), sin Math.random() ni
 * Date.now() (memoria tests_bomba_de_fecha_y_estado_inicial: nada de reloj real
 * en lógica que se testea). Sin dependencias nuevas.
 */

import { avoid_adjacent_repeat, hash_seed, shuffle_with_seed } from '../lib/feedShuffle';

const EIGHT = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;

describe('shuffle_with_seed (#285.2)', () => {
  it('(EC-1) misma_semilla_misma_permutacion: dos llamadas con la misma semilla devuelven arrays idénticos elemento a elemento', () => {
    const first = shuffle_with_seed(EIGHT, 42);
    const second = shuffle_with_seed(EIGHT, 42);
    expect(first).toEqual(second);
  });

  it('(EC-2) conserva_los_mismos_elementos: el resultado es una permutación (mismo multiconjunto, misma longitud)', () => {
    const out = shuffle_with_seed(EIGHT, 7);
    expect(out).toHaveLength(EIGHT.length);
    expect([...out].sort()).toEqual([...EIGHT].sort());
  });

  it('(EC-3) semillas_distintas_dan_permutaciones_distintas: entre las semillas 1..4 hay al menos 3 órdenes diferentes sobre 8 elementos', () => {
    const orders = new Set([1, 2, 3, 4].map((seed) => shuffle_with_seed(EIGHT, seed).join('')));
    expect(orders.size).toBeGreaterThanOrEqual(3);
  });

  it('(EC-4) baraja_de_verdad: con 8 elementos y semilla 7 el orden NO es la identidad (la vuelta 2 no repite el orden de la 1)', () => {
    const out = shuffle_with_seed(EIGHT, 7);
    expect(out).not.toEqual([...EIGHT]);
  });

  it('(EC-5) no_muta_la_entrada_y_devuelve_un_array_nuevo', () => {
    const input = ['x', 'y', 'z', 'w', 'v'];
    const snapshot = [...input];
    const out = shuffle_with_seed(input, 3);
    expect(input).toEqual(snapshot);
    expect(out).not.toBe(input);
  });

  it('(EC-6) bordes: 0 elementos → [], 1 elemento → el mismo único elemento', () => {
    expect(shuffle_with_seed([], 5)).toEqual([]);
    expect(shuffle_with_seed(['solo'], 5)).toEqual(['solo']);
  });

  it('(EC-7) no_usa_reloj_ni_azar_del_runtime: Math.random y Date.now no se invocan durante el barajado', () => {
    const random_spy = jest.spyOn(Math, 'random');
    const now_spy = jest.spyOn(Date, 'now');
    shuffle_with_seed(EIGHT, 11);
    shuffle_with_seed(EIGHT, hash_seed('sesion-abc') + 2);
    expect(random_spy).not.toHaveBeenCalled();
    expect(now_spy).not.toHaveBeenCalled();
    random_spy.mockRestore();
    now_spy.mockRestore();
  });
});

describe('hash_seed (#285.2)', () => {
  it('(EC-8) determinista_y_entero_no_negativo: el mismo texto da el mismo número, entero y ≥ 0', () => {
    const a = hash_seed('11111111-2222-3333-4444-555555555555');
    const b = hash_seed('11111111-2222-3333-4444-555555555555');
    expect(a).toBe(b);
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
  });

  it('(EC-9) textos_distintos_dan_semillas_distintas: dos session_id que difieren en un carácter no comparten semilla', () => {
    expect(hash_seed('sesion-000a')).not.toBe(hash_seed('sesion-000b'));
  });

  it('(EC-10) la_semilla_de_vuelta_separa_vueltas: hash_seed(s)+1 y hash_seed(s)+2 producen órdenes distintos sobre 8 elementos', () => {
    const base = hash_seed('sesion-vueltas');
    expect(shuffle_with_seed(EIGHT, base + 1)).not.toEqual(shuffle_with_seed(EIGHT, base + 2));
  });
});

// Guardian 285.2 — mutante g: `Math.floor(next() * i)` (sin el +1) convierte
// Fisher–Yates en Sattolo: ningún elemento puede quedarse en su sitio y solo se
// alcanzan (n−1)! permutaciones. Esperado de fuente independiente (combinatoria):
// sobre 3 elementos existen 6 órdenes; con 50 semillas deben aparecer los 6.
describe('shuffle_with_seed — alcanza todas las permutaciones (#285.2, guardian)', () => {
  it('(EC-11) sobre_3_elementos_y_50_semillas_aparecen_los_6_ordenes_posibles_incluida_la_identidad', () => {
    const orders = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) orders.add(shuffle_with_seed(['a', 'b', 'c'], seed).join(''));
    expect(orders.size).toBe(6);
    expect(orders).toContain('abc');
  });
});

/**
 * avoid_adjacent_repeat (#288.2, costura sin repetición pegada)
 * SUT: mobile/src/features/feed/lib/feedShuffle.ts
 *
 * EDGE CASES (RED):
 * (EC-12) vacio_devuelve_copia_vacia: [] → [].
 * (EC-13) un_solo_item_devuelve_copia_identica: 1 ítem → copia con el mismo
 *   único elemento (NO se asegura si is_repeat se invoca o no con 1 ítem).
 * (EC-14) coincide_mueve_el_primero_al_final_y_el_resto_en_orden: is_repeat(items[0])
 *   true con length > 1 → [items[1], items[2], ..., items[0]].
 * (EC-15) no_coincide_devuelve_copia_identica: is_repeat(items[0]) false →
 *   mismo orden, misma longitud (toEqual) pero NO la misma referencia (not.toBe).
 * (EC-16) nunca_muta_la_entrada: la entrada se congela con Object.freeze antes
 *   de llamar; si el helper mutara, freeze la haría lanzar en modo estricto.
 */
describe('avoid_adjacent_repeat (#288.2)', () => {
  it('(EC-12) vacio_devuelve_copia_vacia', () => {
    const out = avoid_adjacent_repeat<string>([], () => true);
    expect(out).toEqual([]);
  });

  it('(EC-13) un_solo_item_devuelve_copia_identica', () => {
    const input = ['solo'];
    const out = avoid_adjacent_repeat(input, () => true);
    expect(out).toEqual(['solo']);
    expect(out).not.toBe(input);
  });

  it('(EC-14) coincide_mueve_el_primero_al_final_y_el_resto_en_orden', () => {
    const input = ['p1', 'p2', 'p3', 'p4'];
    const is_repeat = (first: string) => first === 'p1';
    const out = avoid_adjacent_repeat(input, is_repeat);
    expect(out).toEqual(['p2', 'p3', 'p4', 'p1']);
  });

  it('(EC-15) no_coincide_devuelve_copia_identica', () => {
    const input = ['p1', 'p2', 'p3', 'p4'];
    const is_repeat = (first: string) => first === 'OTRO_ID_QUE_NUNCA_COINCIDE';
    const out = avoid_adjacent_repeat(input, is_repeat);
    expect(out).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(out).not.toBe(input);
  });

  it('(EC-16) nunca_muta_la_entrada', () => {
    const input = Object.freeze(['p1', 'p2', 'p3']);
    expect(() => avoid_adjacent_repeat(input, (first) => first === 'p1')).not.toThrow();
    expect(input).toEqual(['p1', 'p2', 'p3']);
  });
});
