/**
 * Tests de validación del rango de precio del FilterSheet — funciones puras.
 * Subtarea 12.3 — validate_min_price, validate_max_price, validate_price_range,
 *                  validate_price_form, parse_price
 *
 * POLÍTICAS documentadas aquí (decide el test-author, respeta el implementador):
 *   - min == max → VÁLIDO (un filtro de precio exacto es razonable)
 *   - precio 0  → INVÁLIDO (consistente con publish §step2: price > 0;
 *                            para "sin mínimo" el usuario deja el campo vacío = null)
 *   - decimales → PERMITIDOS (la validación no redondea; el formateo es tarea de la UI)
 *   - NaN       → INVÁLIDO (parse_price nunca devuelve NaN; si llega al validador se rechaza)
 *   - coma de miles → NO SOPORTADA en parse_price (keyboardType numeric no la produce;
 *                      '1,500' → null)
 *   - notación científica → NO SOPORTADA ('1e3' → null)
 *
 * Fuente de reglas: PRD §9.4 (filtros rápidos sobre el feed), §publish step2,
 * columna properties.price (no negativa, positiva obligatoria al publicar).
 */

import {
  validate_min_price,
  validate_max_price,
  validate_price_range,
  validate_price_form,
  parse_price,
} from '../validation';

// ─────────────────────────────────────────────────────────────────────────────
// validate_min_price
// ─────────────────────────────────────────────────────────────────────────────

describe('validate_min_price', () => {
  it('null_es_valido — campo vacío (sin piso) no genera error', () => {
    expect(validate_min_price(null)).toBeUndefined();
  });

  it('positivo_es_valido — precio positivo típico (MXN)', () => {
    expect(validate_min_price(1500)).toBeUndefined();
  });

  it('decimal_es_valido — se permiten decimales, la UI formatea', () => {
    expect(validate_min_price(1500.5)).toBeUndefined();
  });

  it('cero_es_invalido — precio 0 inválido, consistente con publish §step2', () => {
    const error = validate_min_price(0);
    expect(error).toBeDefined();
    expect(error!.message.length).toBeGreaterThan(0);
  });

  it('negativo_es_invalido — precio negativo no existe en Urbea', () => {
    const error = validate_min_price(-1);
    expect(error).toBeDefined();
    expect(error!.message.length).toBeGreaterThan(0);
  });

  it('negativo_grande_es_invalido — -100_000 sigue siendo inválido', () => {
    const error = validate_min_price(-100_000);
    expect(error).toBeDefined();
    expect(error!.message.length).toBeGreaterThan(0);
  });

  it('nan_es_invalido — NaN puede llegar de un parseo malformado del TextInput', () => {
    const error = validate_min_price(NaN);
    expect(error).toBeDefined();
    expect(error!.message.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate_max_price
// ─────────────────────────────────────────────────────────────────────────────

describe('validate_max_price', () => {
  it('null_es_valido — campo vacío (sin techo) no genera error', () => {
    expect(validate_max_price(null)).toBeUndefined();
  });

  it('positivo_es_valido — precio positivo típico (MXN)', () => {
    expect(validate_max_price(5_000_000)).toBeUndefined();
  });

  it('decimal_es_valido — se permiten decimales, la UI formatea', () => {
    expect(validate_max_price(3000.25)).toBeUndefined();
  });

  it('cero_es_invalido — precio 0 inválido; para sin techo usar null', () => {
    const error = validate_max_price(0);
    expect(error).toBeDefined();
    expect(error!.message.length).toBeGreaterThan(0);
  });

  it('negativo_es_invalido — precio negativo inválido', () => {
    const error = validate_max_price(-500);
    expect(error).toBeDefined();
    expect(error!.message.length).toBeGreaterThan(0);
  });

  it('nan_es_invalido — NaN rechazado en max también', () => {
    const error = validate_max_price(NaN);
    expect(error).toBeDefined();
    expect(error!.message.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate_price_range
// ─────────────────────────────────────────────────────────────────────────────

describe('validate_price_range', () => {
  // Happy path — sin restricción de rango
  it('ambos_null_es_valido — sin filtro de precio no produce error de rango', () => {
    expect(validate_price_range(null, null)).toBeUndefined();
  });

  it('solo_min_null_max_es_valido — piso sin techo', () => {
    expect(validate_price_range(1500, null)).toBeUndefined();
  });

  it('solo_max_min_null_es_valido — techo sin piso', () => {
    expect(validate_price_range(null, 5000)).toBeUndefined();
  });

  it('min_menor_que_max_es_valido — rango normal', () => {
    expect(validate_price_range(1000, 5000)).toBeUndefined();
  });

  // POLÍTICA: min == max → VÁLIDO (precio exacto razonable como filtro)
  it('min_igual_max_es_valido — rango de un punto es un filtro de precio exacto', () => {
    expect(validate_price_range(3000, 3000)).toBeUndefined();
  });

  // POLÍTICA: decimales permitidos
  it('decimales_validos — rango con decimales es válido (la validación no redondea)', () => {
    expect(validate_price_range(1500.5, 3000.25)).toBeUndefined();
  });

  // Rama de regla no obvia: min > max → inválido
  it('min_mayor_que_max_es_invalido — mensaje de error en español', () => {
    const error = validate_price_range(5000, 1000);
    expect(error).toBeDefined();
    expect(error!.message).toEqual(expect.stringMatching(/[A-Za-záéíóúÁÉÍÓÚñÑ]/));
  });

  it('min_mayor_que_max_grande_es_invalido — 10_000_000 vs 100_000', () => {
    const error = validate_price_range(10_000_000, 100_000);
    expect(error).toBeDefined();
    expect(error!.message.length).toBeGreaterThan(0);
  });

  // validate_price_range solo valida la relación, no los valores individuales
  // (los valores individuales los valida validate_min/max_price)
  it('range_no_valida_negativos — negativos con min<max no producen error de rango', () => {
    // -100 < 500: la relación está bien; el error de negativo le toca a validate_min_price
    expect(validate_price_range(-100, 500)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate_price_form  (composite — PriceRangeErrors)
// ─────────────────────────────────────────────────────────────────────────────

describe('validate_price_form', () => {
  it('ambos_null_sin_errores — sin filtro no produce ningún error', () => {
    const errors = validate_price_form(null, null);
    expect(errors.min).toBeUndefined();
    expect(errors.max).toBeUndefined();
    expect(errors.range).toBeUndefined();
  });

  it('rango_valido_sin_errores — 1000–2000 pasa todas las validaciones', () => {
    const errors = validate_price_form(1000, 2000);
    expect(errors.min).toBeUndefined();
    expect(errors.max).toBeUndefined();
    expect(errors.range).toBeUndefined();
  });

  it('min_mayor_que_max_solo_range_error — 1500 > 500 → solo errors.range', () => {
    const errors = validate_price_form(1500, 500);
    expect(errors.range).toBeDefined();
    expect(errors.min).toBeUndefined();
    expect(errors.max).toBeUndefined();
  });

  it('min_negativo_solo_min_error — -100 < 500 (relación ok) → solo errors.min', () => {
    const errors = validate_price_form(-100, 500);
    expect(errors.min).toBeDefined();
    expect(errors.range).toBeUndefined();
    expect(errors.max).toBeUndefined();
  });

  it('max_cero_solo_max_error — max=0 es inválido individualmente', () => {
    const errors = validate_price_form(null, 0);
    expect(errors.max).toBeDefined();
    expect(errors.min).toBeUndefined();
    expect(errors.range).toBeUndefined();
  });

  it('ambos_invalidos_dos_errores — min y max negativos individualmente inválidos', () => {
    const errors = validate_price_form(-100, -50);
    // Ambos negativos: min e max tienen error individualmente.
    // La relación -100 < -50 es válida → no hay error de range.
    expect(errors.min).toBeDefined();
    expect(errors.max).toBeDefined();
    expect(errors.range).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parse_price  (helper string→number|null desde TextInput)
// ─────────────────────────────────────────────────────────────────────────────

describe('parse_price', () => {
  // Campo vacío → null (sin filtro)
  it('string_vacio_devuelve_null — campo sin texto = sin restricción', () => {
    expect(parse_price('')).toBeNull();
  });

  it('solo_espacios_devuelve_null — espacios = campo vacío', () => {
    expect(parse_price('   ')).toBeNull();
  });

  // Texto no numérico → null, nunca NaN
  it('texto_no_numerico_devuelve_null — "abc" no propaga NaN', () => {
    expect(parse_price('abc')).toBeNull();
  });

  it('string_nan_literal_devuelve_null — "NaN" como texto → null', () => {
    expect(parse_price('NaN')).toBeNull();
  });

  // Entero válido
  it('entero_valido_devuelve_numero — "1500" → 1500', () => {
    expect(parse_price('1500')).toBe(1500);
  });

  it('entero_grande_valido — "5000000" → 5_000_000', () => {
    expect(parse_price('5000000')).toBe(5_000_000);
  });

  // Decimal válido (política: se permiten)
  it('decimal_valido_devuelve_numero — "1500.50" → 1500.5', () => {
    expect(parse_price('1500.50')).toBe(1500.5);
  });

  // POLÍTICA: coma de miles NO soportada (el teclado numérico no la produce)
  it('coma_de_miles_devuelve_null — "1,500" no soportado, el keyboardType numeric no la genera', () => {
    expect(parse_price('1,500')).toBeNull();
  });

  // POLÍTICA: notación científica NO soportada
  it('notacion_cientifica_devuelve_null — "1e3" no soportado; solo dígitos y punto', () => {
    expect(parse_price('1e3')).toBeNull();
  });

  // parse_price NUNCA devuelve NaN — siempre null o un número finito válido
  it('resultado_nunca_es_nan — parse_price nunca devuelve NaN', () => {
    const inputs = ['abc', '', '  ', 'NaN', '1,500', '1e3', '...'];
    for (const input of inputs) {
      const result = parse_price(input);
      // null es ok; NaN nunca debe aparecer
      expect(result === null || (typeof result === 'number' && !Number.isNaN(result))).toBe(true);
    }
  });
});
