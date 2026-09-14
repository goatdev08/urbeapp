/**
 * feedTabStorage.test.ts — RED (#296.3): persistencia del FeedTab activo.
 *
 * SUT: src/features/search/lib/feedTabStorage.ts
 *   - FEED_TAB_STORAGE_KEY = 'urbea_feed_tab'
 *   - save_feed_tab(tab, deps?): Promise<void>  — string PLANO (sin JSON).
 *   - load_feed_tab(deps?): Promise<FeedTab>    — fail-safe, NUNCA lanza.
 *
 * Patrón de mock: storage clave/valor en memoria vía jest.fn(), igual que
 * filterStorage.test.ts (DI — nunca se toca el módulo nativo AsyncStorage).
 *
 * EDGE CASES:
 * ### Happy path
 * - (EC-FTS-1) save_guarda_string_plano_sin_json_bajo_la_key_estable
 * - (EC-FTS-2) load_con_valor_guardado_valido_devuelve_ese_tab (parametrizado, 5 tabs)
 *
 * ### Fail-safe (nunca lanza) — arranque en frío / basura / storage roto
 * - (EC-FTS-3) load_sin_valor_guardado_devuelve_para_ti (nada guardado, primera vez)
 * - (EC-FTS-4) load_con_basura_legacy_sale_devuelve_para_ti (valor de la sección vieja #241)
 * - (EC-FTS-5) load_con_json_legacy_entrecomillado_devuelve_para_ti ('"venta"' no es 'venta')
 * - (EC-FTS-6) load_con_string_vacio_devuelve_para_ti
 * - (EC-FTS-7) load_con_getitem_que_rechaza_devuelve_para_ti_sin_lanzar
 *
 * ### Boundary / contrato de key
 * - (EC-FTS-8) load_usa_key_exacta_para_leer
 * - (EC-FTS-9) save_usa_key_exacta_para_escribir_una_sola_vez
 */
import type { KeyValueStorage } from '../lib/filterStorage';
import { FEED_TAB_STORAGE_KEY, load_feed_tab, save_feed_tab } from '../lib/feedTabStorage';

function make_mock_storage(initial: Record<string, string> = {}): KeyValueStorage & {
  getItem: jest.Mock;
  setItem: jest.Mock;
} {
  const store: Record<string, string> = { ...initial };
  return {
    getItem: jest.fn(async (key: string): Promise<string | null> =>
      Object.prototype.hasOwnProperty.call(store, key) ? store[key]! : null,
    ),
    setItem: jest.fn(async (key: string, value: string): Promise<void> => {
      store[key] = value;
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('feedTabStorage — key estable', () => {
  it('(EC-FTS-1) key_estable_es_urbea_feed_tab: FEED_TAB_STORAGE_KEY === "urbea_feed_tab"', () => {
    expect(FEED_TAB_STORAGE_KEY).toBe('urbea_feed_tab');
  });
});

describe('save_feed_tab', () => {
  it('(EC-FTS-2) save_guarda_string_plano_sin_json_bajo_la_key_estable: save_feed_tab("renta") llama setItem(key, "renta") — NO JSON.stringify("renta")', async () => {
    const storage = make_mock_storage();

    await save_feed_tab('renta', { storage });

    expect(storage.setItem).toHaveBeenCalledWith(FEED_TAB_STORAGE_KEY, 'renta');
  });

  it('(EC-FTS-3) save_usa_key_exacta_una_sola_vez: setItem se llama exactamente una vez con la key estable', async () => {
    const storage = make_mock_storage();

    await save_feed_tab('nuevos', { storage });

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect((storage.setItem.mock.calls[0] as unknown[])[0]).toBe(FEED_TAB_STORAGE_KEY);
  });
});

describe('load_feed_tab — happy path', () => {
  it.each([['para_ti'], ['siguiendo'], ['nuevos'], ['venta'], ['renta']] as const)(
    '(EC-FTS-4.%#) load_con_valor_guardado_valido_devuelve_ese_tab: storage tiene "%s" → load_feed_tab() resuelve a "%s"',
    async (tab) => {
      const storage = make_mock_storage({ [FEED_TAB_STORAGE_KEY]: tab });

      const loaded = await load_feed_tab({ storage });

      expect(loaded).toBe(tab);
    },
  );
});

describe('load_feed_tab — fail-safe, NUNCA lanza', () => {
  it('(EC-FTS-5) load_sin_valor_guardado_devuelve_para_ti: getItem devuelve null (arranque en frío) → "para_ti"', async () => {
    const storage = make_mock_storage();

    const loaded = await load_feed_tab({ storage });

    expect(loaded).toBe('para_ti');
  });

  it('(EC-FTS-6) load_con_basura_legacy_sale_devuelve_para_ti: valor guardado "sale" (sección vieja #241, ya no es un FeedTab) → "para_ti"', async () => {
    const storage = make_mock_storage({ [FEED_TAB_STORAGE_KEY]: 'sale' });

    const loaded = await load_feed_tab({ storage });

    expect(loaded).toBe('para_ti');
  });

  it('(EC-FTS-7) load_con_json_legacy_entrecomillado_devuelve_para_ti: valor guardado \'"venta"\' (con comillas de JSON.stringify) NO es igual a "venta" → "para_ti"', async () => {
    const storage = make_mock_storage({ [FEED_TAB_STORAGE_KEY]: '"venta"' });

    const loaded = await load_feed_tab({ storage });

    expect(loaded).toBe('para_ti');
  });

  it('(EC-FTS-8) load_con_string_vacio_devuelve_para_ti: valor guardado "" → "para_ti"', async () => {
    const storage = make_mock_storage({ [FEED_TAB_STORAGE_KEY]: '' });

    const loaded = await load_feed_tab({ storage });

    expect(loaded).toBe('para_ti');
  });

  it('(EC-FTS-9) load_con_getitem_que_rechaza_devuelve_para_ti_sin_lanzar: storage.getItem rechaza la promesa → load_feed_tab resuelve a "para_ti", NUNCA rechaza', async () => {
    const storage = make_mock_storage();
    storage.getItem.mockRejectedValueOnce(new Error('storage roto'));

    await expect(load_feed_tab({ storage })).resolves.toBe('para_ti');
  });
});

describe('load_feed_tab — contrato de key', () => {
  it('(EC-FTS-10) load_usa_key_exacta_para_leer: load_feed_tab llama storage.getItem("urbea_feed_tab") exactamente una vez', async () => {
    const storage = make_mock_storage();

    await load_feed_tab({ storage });

    expect(storage.getItem).toHaveBeenCalledWith(FEED_TAB_STORAGE_KEY);
    expect(storage.getItem).toHaveBeenCalledTimes(1);
  });
});
