/**
 * Tests fase RED — ProfileActions decide el botón de WhatsApp con `has_phone`
 * y resuelve el número vía RPC (tarea #255)
 * Archivo SUT: mobile/src/features/profile/components/ProfileActions.tsx
 *
 * OBJETIVO DEL RED:
 *   HOY el botón "Contactar por WhatsApp" decide con el prop `phone` (leído
 *   de `users.phone`), que RLS oculta para cualquier publicador role='admin'
 *   visto por un no-admin (#250, caso Vladimir en producción) — sin fila de
 *   users visible, `phone` llega null, el botón NUNCA se pinta aunque el
 *   publicador SÍ tenga teléfono capturado.
 *
 *   Contrato fijado (SEAM, tarea #255): ProfileActions pasa a recibir
 *   `has_phone: boolean` (derivado, de la vista agent_public_profiles — no
 *   requiere leer users.phone) y `agent_user_id: string` — pinta el botón si
 *   `has_phone`, y al pulsar resuelve el número real vía
 *   `supabase.rpc('whatsapp_phone_for_profile', { p_user_id })` (SEGURO:
 *   la RPC decide server-side si expone el teléfono — ver
 *   99_whatsapp_phone_for_profile_test.sql). Si la RPC no devuelve número
 *   (null/error), NO abre WhatsApp y no truena.
 *
 * SEAM bajo prueba: el comportamiento OBSERVABLE del componente (qué se
 * renderiza + qué llamadas dispara al pulsar), nunca sus internals. Se
 * mockean las DOS fronteras del sistema: el cliente Supabase
 * (`@/lib/supabase/client`, vía el doble sensible al binding de
 * `@/test-utils/supabaseMock` — candado #233.3: un mock de objeto plano no
 * detecta `const { rpc } = supabase` desprendido, precedente #205/170.4) y
 * el helper de deep-link (`@/features/property-detail/utils/whatsapp`).
 * NUNCA se mockea el propio ProfileActions ni su lógica de decisión.
 *
 * NOTA GREEN (#255): `ProfileActionsProps.phone` se quitó del componente real
 * (reemplazado por `has_phone` + `agent_user_id` — ver ProfileActions.tsx).
 * `build_props` ya no lo incluye; el resto de los asserts (a-d) no cambió.
 *
 * EDGE CASES CUBIERTOS (6 casos, del briefing de la tarea 255 + 2 post-guardian):
 *
 * ### Happy path
 * - (a) has_phone_true_pese_a_phone_prop_null_pinta_el_boton
 * - (b) tap_llama_la_rpc_con_el_user_id_y_abre_whatsapp_con_el_numero_devuelto
 *
 * ### Ramas de reglas no obvias (contrato de la RPC — fail-soft)
 * - (c) rpc_devuelve_data_null_no_abre_whatsapp
 * - (e) rpc_devuelve_error_no_abre_whatsapp (post-guardian): { data: null, error }
 *   -> no abre, no truena.
 * - (f) rpc_rechaza_no_truena_ni_abre_whatsapp (post-guardian): la promesa de
 *   rpc() rechaza (network/etc.) -> capturado por try/catch, sin unhandled
 *   rejection, no abre nada.
 *
 * ### Boundary
 * - (d) has_phone_false_no_pinta_el_boton
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { make_binding_sensitive_supabase_mock } from '@/test-utils/supabaseMock';
import { ProfileActions, type ProfileActionsProps } from '../components/ProfileActions';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks de módulos — ANTES de cualquier import del SUT que dependa de ellos
// ─────────────────────────────────────────────────────────────────────────────

/** Holder mutable — cada test lo reemplaza con el cliente apropiado antes de renderizar. */
const mock_supabase_holder: { client: unknown } = { client: null };

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

const mock_open_whatsapp_text = jest.fn();

jest.mock('@/features/property-detail/utils/whatsapp', () => ({
  open_whatsapp_text: (...args: unknown[]) => mock_open_whatsapp_text(...args),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_USER_ID = 'publicador-uuid-255-admin';

/** Props del contrato NUEVO (GREEN, tarea #255) — ya declaradas en ProfileActionsProps. */
function build_props(overrides: Partial<ProfileActionsProps> = {}): ProfileActionsProps {
  return {
    is_own_profile: false,
    on_edit_profile: jest.fn(),
    on_saved: jest.fn(),
    agent_name: 'Vladimir YEH',
    has_phone: true,
    agent_user_id: AGENT_USER_ID,
    ...overrides,
  };
}

/** Instala el cliente mock (doble sensible al binding) con la resolución de rpc dada. */
function set_supabase_rpc_result(result: { data: string | null; error: unknown }) {
  const { client, _mock_rpc } = make_binding_sensitive_supabase_mock({
    rpc: () => Promise.resolve(result),
  });
  mock_supabase_holder.client = client;
  return _mock_rpc;
}

beforeEach(() => {
  jest.clearAllMocks();
  mock_open_whatsapp_text.mockClear();
  set_supabase_rpc_result({ data: '+523312345678', error: null });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ProfileActions — WhatsApp por RPC (has_phone, #255)', () => {
  it('(a) has_phone_true_pese_a_phone_prop_null_pinta_el_boton: con has_phone=true y phone=null (caso Vladimir, #250) el botón "Contactar por WhatsApp" SÍ se renderiza', async () => {
    const { queryByLabelText } = await render(
      <ProfileActions {...build_props({ has_phone: true })} />
    );

    expect(queryByLabelText('Contactar por WhatsApp')).not.toBeNull();
  });

  it('(b) tap_llama_la_rpc_con_el_user_id_y_abre_whatsapp_con_el_numero_devuelto: al pulsar, se llama supabase.rpc con p_user_id y luego open_whatsapp_text con el número resuelto', async () => {
    const rpc = set_supabase_rpc_result({ data: '+523312345678', error: null });

    const { queryByLabelText } = await render(
      <ProfileActions {...build_props({ has_phone: true })} />
    );

    // Assert previo explícito (en vez de `fireEvent.press(null!)`, que
    // truena con un TypeError genérico de RNTL): HOY el botón no existe
    // (has_phone no forma parte del contrato viejo) — este assert por sí
    // solo ya es RED con mensaje diagnóstico.
    const button = queryByLabelText('Contactar por WhatsApp');
    expect(button).not.toBeNull();
    await fireEvent.press(button!);

    expect(rpc).toHaveBeenCalledWith('whatsapp_phone_for_profile', {
      p_user_id: AGENT_USER_ID,
    });
    expect(mock_open_whatsapp_text).toHaveBeenCalledWith(
      '+523312345678',
      expect.any(String)
    );
  });

  it('(c) rpc_devuelve_data_null_no_abre_whatsapp: si la RPC responde { data: null }, NO se llama open_whatsapp_text (y no truena)', async () => {
    set_supabase_rpc_result({ data: null, error: null });

    const { queryByLabelText } = await render(
      <ProfileActions {...build_props({ has_phone: true })} />
    );

    const button = queryByLabelText('Contactar por WhatsApp');
    expect(button).not.toBeNull();
    await fireEvent.press(button!);

    expect(mock_open_whatsapp_text).not.toHaveBeenCalled();
  });

  it('(d) has_phone_false_no_pinta_el_boton: con has_phone=false el botón NO se renderiza, aunque agent_user_id venga presente', async () => {
    const { queryByLabelText } = await render(
      <ProfileActions {...build_props({ has_phone: false })} />
    );

    expect(queryByLabelText('Contactar por WhatsApp')).toBeNull();
  });

  it('(e) rpc_devuelve_error_no_abre_whatsapp: si la RPC responde { data: null, error }, NO se llama open_whatsapp_text (y no truena)', async () => {
    const warn_spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    set_supabase_rpc_result({ data: null, error: { code: 'PGRST301', message: 'boom' } });

    const { queryByLabelText } = await render(
      <ProfileActions {...build_props({ has_phone: true })} />
    );

    const button = queryByLabelText('Contactar por WhatsApp');
    expect(button).not.toBeNull();
    await fireEvent.press(button!);

    expect(mock_open_whatsapp_text).not.toHaveBeenCalled();

    warn_spy.mockRestore();
  });

  it('(f) rpc_rechaza_no_truena_ni_abre_whatsapp: si la promesa de rpc() rechaza (red caída/etc.), no truena (sin unhandled rejection) y no abre nada', async () => {
    const warn_spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // Doble sensible al binding (candado #233.3) igual que set_supabase_rpc_result,
    // pero con rpc() rechazando en vez de resolviendo.
    const { client } = make_binding_sensitive_supabase_mock({
      rpc: () => Promise.reject(new Error('network down')),
    });
    mock_supabase_holder.client = client;

    const { queryByLabelText } = await render(
      <ProfileActions {...build_props({ has_phone: true })} />
    );

    const button = queryByLabelText('Contactar por WhatsApp');
    expect(button).not.toBeNull();
    await fireEvent.press(button!);

    expect(mock_open_whatsapp_text).not.toHaveBeenCalled();

    warn_spy.mockRestore();
  });
});
