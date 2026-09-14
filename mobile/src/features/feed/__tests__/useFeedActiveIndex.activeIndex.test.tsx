/**
 * RED — #296.5 (parte B del contrato I1): useFeedActiveIndex expone
 * `activeIndex` (el índice activo actual, 0 al montar) — lo necesita
 * FeedScreen para `noteScrollIndex(activeIndex)` (#296.5-C/D, feedTabCache).
 * SUT: mobile/src/features/feed/hooks/useFeedActiveIndex.ts
 *
 * SEAM bajo test: la firma pública devuelta por el hook —
 * `UseFeedActiveIndexResult` gana el campo `activeIndex: number`, además de
 * `viewabilityConfigCallbackPairs`/`isItemActive` que ya existen.
 *
 * Mock mínimo de `expo-router.useFocusEffect`: mismo motivo que
 * useFeedActiveIndex.flush.test.tsx (el consumidor real vive fuera de un
 * NavigationContainer en el harness de test) pero simplificado — aquí no se
 * ejercen background/blur, solo el registro y disparo del callback.
 *
 * EDGE CASES (RED):
 * (EC-ACTIVEIDX-1) activeIndex_arranca_en_cero_al_montar: sin ninguna
 *                  llamada a onViewableItemsChanged, activeIndex === 0.
 * (EC-ACTIVEIDX-2) activeIndex_sigue_al_item_mas_visible: invocar
 *                  onViewableItemsChanged con el ítem más visible en
 *                  index=3 actualiza activeIndex a 3.
 * (EC-ACTIVEIDX-3) activeIndex_se_actualiza_de_nuevo_con_un_segundo_scroll:
 *                  tras EC-ACTIVEIDX-2, un segundo onViewableItemsChanged
 *                  con index=7 mueve activeIndex a 7 (no se queda pegado
 *                  al primer valor).
 */

import { renderHook, act } from '@testing-library/react-native';

// El consumidor real (FeedScreen) vive dentro de expo-router; aquí no se
// ejerce foco/blur (eso ya lo cubre useFeedActiveIndex.flush.test.tsx) —
// basta con que el callback de montaje corra una vez.
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => (() => void) | void) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const react = require('react') as typeof import('react');
    react.useEffect(() => cb(), [cb]);
  },
}));

import { useFeedActiveIndex } from '../hooks/useFeedActiveIndex';

function fire_viewable(
  result: { current: ReturnType<typeof useFeedActiveIndex> },
  index: number,
) {
  const on_viewable_items_changed = result.current.viewabilityConfigCallbackPairs[0]!
    .onViewableItemsChanged;
  on_viewable_items_changed?.({
    viewableItems: [
      { index, item: {}, key: `k${index}`, isViewable: true } as never,
    ],
    changed: [],
  });
}

describe('useFeedActiveIndex — activeIndex expuesto (#296.5)', () => {
  it('(EC-ACTIVEIDX-1) activeIndex_arranca_en_cero_al_montar', async () => {
    const { result } = await renderHook(() => useFeedActiveIndex());

    expect(result.current.activeIndex).toBe(0);
  });

  it('(EC-ACTIVEIDX-2) activeIndex_sigue_al_item_mas_visible', async () => {
    const { result } = await renderHook(() => useFeedActiveIndex());

    await act(async () => {
      fire_viewable(result, 3);
    });

    expect(result.current.activeIndex).toBe(3);
  });

  it('(EC-ACTIVEIDX-3) activeIndex_se_actualiza_de_nuevo_con_un_segundo_scroll', async () => {
    const { result } = await renderHook(() => useFeedActiveIndex());

    await act(async () => {
      fire_viewable(result, 3);
    });
    await act(async () => {
      fire_viewable(result, 7);
    });

    expect(result.current.activeIndex).toBe(7);
  });
});
