/**
 * AdFormContext.tsx — Context + Provider + hook para el wizard de anuncios.
 *
 * Calco 1:1 del patrón de
 * mobile/src/features/publish/store/PublishFormContext.tsx (subtarea 169.9
 * reusa la forma, no reinventa un state manager): Context con `undefined`
 * como default → el hook lanza si se usa fuera del Provider. Expone state,
 * update(partial), reset().
 *
 * ponytail: React Context estándar — no Zustand (wizard de 5 pasos con
 * estado local, mismo criterio que el hermano de publish).
 */
import React, { createContext, useCallback, useContext, useState } from 'react';

import { INITIAL_AD_FORM_STATE, type AdFormState } from './types';

export interface AdFormContextValue {
  state: AdFormState;
  /** Merge parcial — equivalente a setState funcional pero sin callback. */
  update: (partial: Partial<AdFormState>) => void;
  reset: () => void;
}

const AdFormContext = createContext<AdFormContextValue | undefined>(undefined);

export function AdFormProvider({ children }: { children: React.ReactNode }) {
  const [state, set_state] = useState<AdFormState>(INITIAL_AD_FORM_STATE);

  const update = useCallback((partial: Partial<AdFormState>) => {
    set_state((prev) => ({ ...prev, ...partial }));
  }, []);

  const reset = useCallback(() => {
    set_state(INITIAL_AD_FORM_STATE);
  }, []);

  const value: AdFormContextValue = { state, update, reset };

  return <AdFormContext.Provider value={value}>{children}</AdFormContext.Provider>;
}

export function useAdForm(): AdFormContextValue {
  const ctx = useContext(AdFormContext);
  if (ctx === undefined) {
    throw new Error('useAdForm must be used within an AdFormProvider');
  }
  return ctx;
}
