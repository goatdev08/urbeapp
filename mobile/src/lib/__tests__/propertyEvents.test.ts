/**
 * Tests fase RED — propertyEvents (mini pub/sub de señal compartida de mutación)
 * Subtarea Taskmaster: 55.1 — Señal compartida de mutación + emitir en el
 * soft-delete (módulo lib + hook)
 *
 * SUT: mobile/src/lib/propertyEvents.ts
 *   - emitPropertyDeleted(property_id: string): void
 *       Itera un Set de listeners y llama a cada uno con el property_id.
 *   - onPropertyDeleted(listener: (id: string) => void): () => void
 *       Registra el listener en el Set; devuelve una función de unsubscribe
 *       que lo remueve.
 *
 * Sin dependencias externas — no requiere mocks de módulos de terceros.
 *
 * EDGE CASES CUBIERTOS (RED):
 *
 * ### Happy path
 * - (EC-1) listener_recibe_exactamente_el_property_id_emitido
 *
 * ### Edge cases del plan (55.1)
 * - (EC-2) tras_unsubscribe_el_listener_no_recibe_eventos_futuros
 * - (EC-3) multiples_listeners_independientes_reciben_el_mismo_evento
 * - (EC-4) emitir_sin_listeners_no_lanza_error
 *
 * ### Boundary / conteo exacto
 * - (EC-5) emitir_dos_veces_invoca_al_listener_dos_veces_con_los_ids_en_orden
 * - (EC-6) unsubscribe_de_un_listener_no_afecta_a_los_demas
 */

import { emitPropertyDeleted, onPropertyDeleted } from '../propertyEvents';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROPERTY_ID_A = 'propiedad-uuid-aaa-111';
const PROPERTY_ID_B = 'propiedad-uuid-bbb-222';

describe('propertyEvents — señal compartida de mutación (pub/sub)', () => {
  // ── (EC-1) Happy path — el listener recibe exactamente el id emitido ─────

  it('(EC-1) listener_recibe_exactamente_el_property_id_emitido: onPropertyDeleted + emitPropertyDeleted entrega el mismo id', () => {
    const listener = jest.fn();
    onPropertyDeleted(listener);

    emitPropertyDeleted(PROPERTY_ID_A);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(PROPERTY_ID_A);
  });

  // ── (EC-2) Unsubscribe detiene eventos futuros ────────────────────────────

  it('(EC-2) tras_unsubscribe_el_listener_no_recibe_eventos_futuros: llamar a la función de unsubscribe remueve el listener del Set', () => {
    const listener = jest.fn();
    const unsubscribe = onPropertyDeleted(listener);

    unsubscribe();
    emitPropertyDeleted(PROPERTY_ID_A);

    expect(listener).not.toHaveBeenCalled();
  });

  // ── (EC-3) Múltiples listeners independientes ─────────────────────────────

  it('(EC-3) multiples_listeners_independientes_reciben_el_mismo_evento: dos listeners registrados por separado reciben ambos el mismo property_id', () => {
    const listener_1 = jest.fn();
    const listener_2 = jest.fn();
    onPropertyDeleted(listener_1);
    onPropertyDeleted(listener_2);

    emitPropertyDeleted(PROPERTY_ID_B);

    expect(listener_1).toHaveBeenCalledTimes(1);
    expect(listener_1).toHaveBeenCalledWith(PROPERTY_ID_B);
    expect(listener_2).toHaveBeenCalledTimes(1);
    expect(listener_2).toHaveBeenCalledWith(PROPERTY_ID_B);
  });

  // ── (EC-4) Emitir sin listeners no lanza ──────────────────────────────────

  it('(EC-4) emitir_sin_listeners_no_lanza_error: emitPropertyDeleted sin ningún listener registrado no lanza', () => {
    expect(() => emitPropertyDeleted(PROPERTY_ID_A)).not.toThrow();
  });

  // ── (EC-5) Conteo exacto tras múltiples emisiones ─────────────────────────

  it('(EC-5) emitir_dos_veces_invoca_al_listener_dos_veces_con_los_ids_en_orden: dos emisiones consecutivas producen dos llamadas, en el orden emitido', () => {
    const listener = jest.fn();
    onPropertyDeleted(listener);

    emitPropertyDeleted(PROPERTY_ID_A);
    emitPropertyDeleted(PROPERTY_ID_B);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0]).toEqual([PROPERTY_ID_A]);
    expect(listener.mock.calls[1]).toEqual([PROPERTY_ID_B]);
  });

  // ── (EC-6) Unsubscribe de un listener no afecta a los demás ───────────────

  it('(EC-6) unsubscribe_de_un_listener_no_afecta_a_los_demas: remover un listener deja intactos los demás listeners registrados', () => {
    const listener_1 = jest.fn();
    const listener_2 = jest.fn();
    const unsubscribe_1 = onPropertyDeleted(listener_1);
    onPropertyDeleted(listener_2);

    unsubscribe_1();
    emitPropertyDeleted(PROPERTY_ID_A);

    expect(listener_1).not.toHaveBeenCalled();
    expect(listener_2).toHaveBeenCalledTimes(1);
    expect(listener_2).toHaveBeenCalledWith(PROPERTY_ID_A);
  });
});
