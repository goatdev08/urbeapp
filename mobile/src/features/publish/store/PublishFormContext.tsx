/**
 * PublishFormContext.tsx — Context + Provider + hook para el wizard de publicación.
 *
 * Patrón: igual que mobile/src/features/auth/context.tsx
 *   - Context con undefined como default → el hook lanza si se usa fuera del Provider.
 *   - Expone: state, update(partial), reset().
 *
 * ponytail: React Context estándar — no Zustand (nueva dependencia no justificada para
 *   un wizard de 3 pasos con estado local).
 */
import React, { createContext, useCallback, useContext, useState } from 'react';

import {
  INITIAL_PUBLISH_FORM_STATE,
  type PublishFormState,
} from './types';

// ---------------------------------------------------------------------------
// Contrato del contexto
// ---------------------------------------------------------------------------

export interface PublishFormContextValue {
  state: PublishFormState;
  /** Merge parcial — equivalente a setState funcional pero sin callback */
  update: (partial: Partial<PublishFormState>) => void;
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Context — undefined activa el guard del hook
// ---------------------------------------------------------------------------

const PublishFormContext = createContext<PublishFormContextValue | undefined>(
  undefined,
);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function PublishFormProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, set_state] = useState<PublishFormState>(
    INITIAL_PUBLISH_FORM_STATE,
  );

  const update = useCallback((partial: Partial<PublishFormState>) => {
    set_state((prev) => ({ ...prev, ...partial }));
  }, []);

  const reset = useCallback(() => {
    set_state(INITIAL_PUBLISH_FORM_STATE);
  }, []);

  const value: PublishFormContextValue = { state, update, reset };

  return (
    <PublishFormContext.Provider value={value}>
      {children}
    </PublishFormContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// usePublishForm — guard: lanza si se usa fuera de PublishFormProvider
// ---------------------------------------------------------------------------

export function usePublishForm(): PublishFormContextValue {
  const ctx = useContext(PublishFormContext);
  if (ctx === undefined) {
    throw new Error(
      'usePublishForm must be used within a PublishFormProvider',
    );
  }
  return ctx;
}
