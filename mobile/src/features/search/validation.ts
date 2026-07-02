/**
 * validation.ts — validación pura del rango de precio del FilterSheet.
 *
 * Subtarea 12.3.
 *
 * Funciones puras y testeables; sin side-effects ni dependencias externas.
 *
 * STUB — solo firmas exportadas. Implementación pendiente (fase GREEN).
 * Todos los métodos lanzan 'not_implemented' para que los tests fallen
 * por excepción en rojo (no por error de import).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export interface FieldError {
  message: string;
}

export interface PriceRangeErrors {
  min?: FieldError;
  max?: FieldError;
  range?: FieldError;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validadores individuales
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valida el precio mínimo ingresado.
 *
 * Reglas:
 *   - null → válido (campo vacío = sin piso de precio)
 *   - 0 → inválido (precios en Urbea son > 0, consistente con publish §step2)
 *   - negativo → inválido
 *   - NaN → inválido
 *   - positivo (entero o decimal) → válido
 *
 * @returns undefined si válido; FieldError con mensaje en español si inválido.
 */
export function validate_min_price(value: number | null): FieldError | undefined {
  throw new Error('not_implemented');
}

/**
 * Valida el precio máximo ingresado.
 *
 * Mismas reglas que validate_min_price.
 *
 * @returns undefined si válido; FieldError con mensaje en español si inválido.
 */
export function validate_max_price(value: number | null): FieldError | undefined {
  throw new Error('not_implemented');
}

/**
 * Valida la relación entre min y max (min <= max).
 *
 * No valida los valores individuales (eso es tarea de validate_min/max_price).
 *
 * Reglas:
 *   - Si min o max es null → válido (no hay rango que comparar)
 *   - min <= max → válido (incluyendo min == max: precio exacto razonable)
 *   - min > max → inválido
 *
 * @returns undefined si la relación es válida; FieldError si min > max.
 */
export function validate_price_range(
  min: number | null,
  max: number | null,
): FieldError | undefined {
  throw new Error('not_implemented');
}

// ─────────────────────────────────────────────────────────────────────────────
// Validador compuesto
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ejecuta validate_min_price, validate_max_price y validate_price_range
 * y agrega todos los errores en un PriceRangeErrors.
 *
 * @returns objeto con los errores encontrados; vacío si todo es válido.
 */
export function validate_price_form(
  min: number | null,
  max: number | null,
): PriceRangeErrors {
  throw new Error('not_implemented');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper de parseo (string desde TextInput → number | null)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parsea el texto crudo de un TextInput numérico a number | null.
 *
 * Políticas:
 *   - Vacío / solo espacios → null
 *   - No numérico ('abc', 'NaN') → null (nunca devuelve NaN)
 *   - Coma de miles ('1,500') → null (keyboardType numeric no la produce)
 *   - Notación científica ('1e3') → null (solo dígitos y punto decimal)
 *   - Entero ('1500') → 1500
 *   - Decimal ('1500.50') → 1500.5
 *
 * @returns number si el input representa un número válido; null en cualquier otro caso.
 */
export function parse_price(input: string): number | null {
  throw new Error('not_implemented');
}
