/**
 * Tests — NotificationCard (mobile/src/features/notifications/components/NotificationCard.tsx)
 * Tarea Taskmaster: 240 — el motivo del rechazo llegaba y se leía mal.
 *
 * CONTEXTO. #234 y #237 metieron el motivo en el `body` porque esta tarjeta era
 * la única superficie que lo mostraba y solo pintaba `title` y `body`. Llegaba,
 * sí, pero al FINAL de una frase que abre con la dirección de la propiedad o el
 * título del anuncio —90+ caracteres— y con el cuerpo clampado: quedaba detrás
 * de una elipsis o escondido en la última línea. Ahora el motivo tiene bloque
 * propio, con su etiqueta.
 *
 * SEAM BAJO TEST: el componente es presentacional puro. Se asertan las props de
 * render y el texto visible. NO se mide layout: RNTL no ve layout
 * (rntl_no_ve_layout), así que "¿se alcanza a leer?" no es aserción posible;
 * "¿el motivo es su propio elemento y no la cola de otro?" sí.
 *
 * EDGE CASES:
 * - (EC-NC1) 🔴 espejo de rechazo → el motivo se pinta en su bloque, con su
 *   etiqueta, y NO se repite en el cuerpo. Mata el mutante "volver a dejarlo
 *   solo en el body".
 * - (EC-NC2) 🔴 el motivo se lee de `data`, no del body: una notificación
 *   ANTERIOR a #237 (body sin la cola, data con el motivo) también gana el
 *   bloque. Es lo que arregla las notificaciones históricas.
 * - (EC-NC3) sin motivo en data → no hay bloque y el body queda intacto, byte
 *   por byte.
 * - (EC-NC4) motivo en blanco (espacios/tabuladores) → se trata como sin
 *   motivo, mismo criterio que el guard de la base.
 * - (EC-NC5) body null → no truena y no pinta cuerpo.
 * - (EC-NC6) el título sigue clampado a 2 líneas.
 *
 * GOTCHAS RNTL ya pagados (rntl14_renderhook_async): `render` es async →
 * SIEMPRE con `await`.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { NotificationCard } from '../NotificationCard';
import type { NotificationItem } from '../../types';

const DIRECCION = '[PRUEBA INTERNA URBEA - no contactar] Av. Chapultepec 100, Guadalajara, Jalisco';
const MOTIVO = 'Las fotos no corresponden a la dirección';

/** Cuerpo tal como lo compone la base tras #237. */
const BODY_CON_COLA = `Tu propiedad en "${DIRECCION}" fue rechazada. Motivo: ${MOTIVO}`;
/** El mismo cuerpo antes de #237 (y lo que debe quedar visible ahora). */
const BODY_SIN_COLA = `Tu propiedad en "${DIRECCION}" fue rechazada.`;

function make_item(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'n-240',
    type: 'property_revision_rejected',
    title: 'Tu propiedad fue rechazada',
    body: BODY_CON_COLA,
    deep_link: '/profile/my-listings',
    related_entity_type: 'property',
    related_entity_id: 'p-1',
    data: { rejection_reason: MOTIVO },
    read_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('NotificationCard — el motivo del rechazo se lee de un vistazo', () => {
  it('EC-NC1: el motivo va en su propio bloque etiquetado y no se repite en el cuerpo', async () => {
    await render(<NotificationCard item={make_item()} on_press={jest.fn()} />);

    expect(screen.getByTestId('notification-reason-n-240')).toBeTruthy();
    expect(screen.getByText('Motivo')).toBeTruthy();
    expect(screen.getByText(MOTIVO)).toBeTruthy();

    // El cuerpo pierde la cola: decir el motivo dos veces en la misma tarjeta
    // es exactamente el ruido que este cambio venía a quitar.
    expect(screen.getByText(BODY_SIN_COLA)).toBeTruthy();
    expect(screen.queryByText(BODY_CON_COLA)).toBeNull();
  });

  it('EC-NC2: una notificación anterior a #237 también gana el bloque, porque el motivo se lee de data', async () => {
    await render(
      <NotificationCard item={make_item({ body: BODY_SIN_COLA })} on_press={jest.fn()} />,
    );

    expect(screen.getByText(MOTIVO)).toBeTruthy();
    // El body no traía la cola, así que se pinta tal cual, sin recortarle nada.
    expect(screen.getByText(BODY_SIN_COLA)).toBeTruthy();
  });

  it('EC-NC3: sin motivo en data no hay bloque y el cuerpo queda intacto', async () => {
    await render(
      <NotificationCard
        item={make_item({ body: BODY_SIN_COLA, data: {} })}
        on_press={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('notification-reason-n-240')).toBeNull();
    expect(screen.queryByText('Motivo')).toBeNull();
    expect(screen.getByText(BODY_SIN_COLA)).toBeTruthy();
  });

  it('EC-NC4: un motivo en blanco se trata como sin motivo', async () => {
    await render(
      <NotificationCard
        item={make_item({ body: BODY_SIN_COLA, data: { rejection_reason: ' \t\n ' } })}
        on_press={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('notification-reason-n-240')).toBeNull();
  });

  it('EC-NC5: sin cuerpo no truena y no pinta cuerpo', async () => {
    await render(
      <NotificationCard item={make_item({ body: null, data: {} })} on_press={jest.fn()} />,
    );

    expect(screen.getByText('Tu propiedad fue rechazada')).toBeTruthy();
    expect(screen.queryByText(BODY_SIN_COLA)).toBeNull();
  });

  it('EC-NC6: el título sigue clampado a dos líneas', async () => {
    await render(<NotificationCard item={make_item()} on_press={jest.fn()} />);

    expect(screen.getByText('Tu propiedad fue rechazada').props.numberOfLines).toBe(2);
  });
});
