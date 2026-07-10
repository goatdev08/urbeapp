/**
 * propertyEvents — señal compartida de mutación entre listas montadas
 * (profile grid, feed, saved). Mini pub/sub SIN dependencias.
 *
 * Subtarea Taskmaster 55.1 — fase GREEN.
 *
 * Contrato:
 *   - emitPropertyDeleted(property_id): itera un Set de listeners y llama
 *     a cada uno con el property_id.
 *   - onPropertyDeleted(listener): registra el listener en el Set, devuelve
 *     una función de unsubscribe que lo remueve del Set.
 */

const deleted_listeners = new Set<(property_id: string) => void>();

export function emitPropertyDeleted(property_id: string): void {
  deleted_listeners.forEach((listener) => listener(property_id));
}

export function onPropertyDeleted(listener: (property_id: string) => void): () => void {
  deleted_listeners.add(listener);
  return () => {
    deleted_listeners.delete(listener);
  };
}
