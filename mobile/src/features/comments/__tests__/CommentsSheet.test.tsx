/**
 * Tests — CommentsSheet (hoja de comentarios, subtarea 289.8, tarea #289)
 * SUT: mobile/src/features/comments/components/CommentsSheet.tsx
 *
 * Componente NO crítico (UI) → verificación ligera (tsc + lint + smoke),
 * este archivo cubre el smoke mínimo pedido por la subtarea: pinta lista,
 * chip "En revisión" solo si soy el autor, CTA sin sesión, "Ocultar" solo
 * con can_hide.
 *
 * PATRÓN DE MOCK: los 4 hooks de comments (useComments/usePostComment/
 * useHideComment/useReportComment) y useAuth se mockean a nivel de módulo —
 * este componente NO tiene lógica de red propia, solo orquesta lo que los
 * hooks devuelven (igual que ReportPropertySheet.test.tsx). expo-router se
 * mockea porque el CTA "sin sesión" navega a /login.
 *
 * NOTA RNTL v14: render() retorna Promise → todos los tests son async + await render(...).
 *
 * CASOS:
 * - (EC-1) pinta_lista_de_comentarios_con_nombre_y_cuerpo
 * - (EC-2) chip_en_revision_solo_si_soy_el_autor_del_comentario
 * - (EC-3) sin_sesion_muestra_cta_inicia_sesion_y_no_el_input
 * - (EC-4) long_press_ocultar_solo_aparece_con_can_hide
 * - (EC-5) long_press_ocultar_ausente_sin_can_hide
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

import { useComments } from '../hooks/useComments';
import { usePostComment } from '../hooks/usePostComment';
import { useHideComment } from '../hooks/useHideComment';
import { useReportComment } from '../hooks/useReportComment';
import { useAuth } from '@/features/auth/context';
import { CommentsSheet } from '../components/CommentsSheet';
import type { CommentItem } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks de módulos
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('../hooks/useComments', () => ({ useComments: jest.fn() }));
jest.mock('../hooks/usePostComment', () => ({ usePostComment: jest.fn() }));
jest.mock('../hooks/useHideComment', () => ({ useHideComment: jest.fn() }));
jest.mock('../hooks/useReportComment', () => ({ useReportComment: jest.fn() }));
jest.mock('@/features/auth/context', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

const mock_use_comments = useComments as jest.MockedFunction<typeof useComments>;
const mock_use_post_comment = usePostComment as jest.MockedFunction<typeof usePostComment>;
const mock_use_hide_comment = useHideComment as jest.MockedFunction<typeof useHideComment>;
const mock_use_report_comment = useReportComment as jest.MockedFunction<typeof useReportComment>;
const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

const PROPERTY_ID = 'propiedad-uuid-289-8';
const ME_ID = 'yo-uuid-289-8';
const OTHER_ID = 'otro-usuario-uuid-289-8';

function make_comment(overrides: Partial<CommentItem>): CommentItem {
  return {
    id: 'comentario-1',
    property_id: PROPERTY_ID,
    user_id: OTHER_ID,
    body: 'Comentario de prueba',
    status: 'visible',
    created_at: new Date().toISOString(),
    author: { full_name: 'Karla Ibarra', profile_photo_url: null },
    ...overrides,
  };
}

function make_comments_return(items: CommentItem[]) {
  return {
    items,
    loading: false,
    error: null,
    has_more: false,
    load_more: jest.fn(),
    refetch: jest.fn(),
    remove: jest.fn(),
    update: jest.fn(),
    prepend: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  mock_use_post_comment.mockReturnValue({ post: jest.fn(), posting: false, error: null });
  mock_use_hide_comment.mockReturnValue({ set_status: jest.fn().mockResolvedValue(true), busy: false, error: null });
  mock_use_report_comment.mockReturnValue({
    report: jest.fn().mockResolvedValue({ ok: true }),
    reporting: false,
    error: null,
    reported: false,
  });
  mock_use_auth.mockReturnValue({
    user: { id: ME_ID } as any,
    session: null,
    isLoading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
    requestPasswordReset: jest.fn(),
    updatePassword: jest.fn(),
  });
});

describe('CommentsSheet', () => {

  // ── (EC-1) Pinta lista ──────────────────────────────────────────────────

  it('(EC-1) pinta_lista_de_comentarios_con_nombre_y_cuerpo: 2 comentarios → nombre y cuerpo de ambos visibles', async () => {
    mock_use_comments.mockReturnValue(
      make_comments_return([
        make_comment({ id: 'c1', user_id: OTHER_ID, body: '¿Acepta crédito Infonavit?' }),
        make_comment({
          id: 'c2',
          user_id: OTHER_ID,
          body: 'Se ve espectacular',
          author: { full_name: 'Renata Solís', profile_photo_url: null },
        }),
      ]),
    );

    const { queryByText } = await render(
      <CommentsSheet visible property_id={PROPERTY_ID} comment_count={2} can_hide={false} on_dismiss={jest.fn()} />,
    );

    expect(queryByText('¿Acepta crédito Infonavit?')).not.toBeNull();
    expect(queryByText('Karla Ibarra')).not.toBeNull();
    expect(queryByText('Se ve espectacular')).not.toBeNull();
    expect(queryByText('Renata Solís')).not.toBeNull();
  });

  // ── (EC-2) Chip "En revisión" solo si soy el autor ──────────────────────

  it('(EC-2) chip_en_revision_solo_si_soy_el_autor_del_comentario: held_for_review propio muestra el chip; ajeno no', async () => {
    mock_use_comments.mockReturnValue(
      make_comments_return([
        make_comment({ id: 'mio', user_id: ME_ID, status: 'held_for_review', body: 'Mi comentario en revisión' }),
        make_comment({ id: 'ajeno', user_id: OTHER_ID, status: 'held_for_review', body: 'Comentario ajeno en revisión' }),
      ]),
    );

    const { queryAllByText } = await render(
      <CommentsSheet visible property_id={PROPERTY_ID} comment_count={2} can_hide={false} on_dismiss={jest.fn()} />,
    );

    // Solo debe aparecer UNA vez (la fila del propio autor)
    expect(queryAllByText('En revisión')).toHaveLength(1);
  });

  // ── (EC-3) Sin sesión → CTA, sin input de comentar ──────────────────────

  it('(EC-3) sin_sesion_muestra_cta_inicia_sesion_y_no_el_input: user=null → CTA visible y sin el campo de escribir', async () => {
    mock_use_auth.mockReturnValue({
      user: null,
      session: null,
      isLoading: false,
      signIn: jest.fn(),
      signOut: jest.fn(),
      requestPasswordReset: jest.fn(),
      updatePassword: jest.fn(),
    });
    mock_use_comments.mockReturnValue(make_comments_return([]));

    const { queryByText, queryByLabelText } = await render(
      <CommentsSheet visible property_id={PROPERTY_ID} comment_count={2} can_hide={false} on_dismiss={jest.fn()} />,
    );

    expect(queryByText('Inicia sesión para comentar')).not.toBeNull();
    expect(queryByLabelText('Escribe un comentario')).toBeNull();
  });

  // ── (EC-4/5) Long-press → "Ocultar" solo con can_hide ───────────────────

  it('(EC-4) long_press_ocultar_solo_aparece_con_can_hide: can_hide=true → Alert.alert incluye botón "Ocultar"', async () => {
    const alert_spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mock_use_comments.mockReturnValue(
      make_comments_return([make_comment({ id: 'c1', user_id: OTHER_ID, status: 'visible' })]),
    );

    const { getByLabelText } = await render(
      <CommentsSheet visible property_id={PROPERTY_ID} comment_count={1} can_hide on_dismiss={jest.fn()} />,
    );

    fireEvent(getByLabelText('Comentario de Karla Ibarra'), 'longPress');

    expect(alert_spy).toHaveBeenCalledTimes(1);
    const buttons = alert_spy.mock.calls[0]?.[2] as { text: string }[];
    expect(buttons.some((b) => b.text === 'Ocultar')).toBe(true);
  });

  it('(EC-5) long_press_ocultar_ausente_sin_can_hide: can_hide=false → Alert.alert NO incluye "Ocultar"', async () => {
    const alert_spy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mock_use_comments.mockReturnValue(
      make_comments_return([make_comment({ id: 'c1', user_id: OTHER_ID, status: 'visible' })]),
    );

    const { getByLabelText } = await render(
      <CommentsSheet visible property_id={PROPERTY_ID} comment_count={2} can_hide={false} on_dismiss={jest.fn()} />,
    );

    fireEvent(getByLabelText('Comentario de Karla Ibarra'), 'longPress');

    expect(alert_spy).toHaveBeenCalledTimes(1);
    const buttons = alert_spy.mock.calls[0]?.[2] as { text: string }[];
    expect(buttons.some((b) => b.text === 'Ocultar')).toBe(false);
    // Ajeno (no autor) → sí debe ofrecer "Reportar"
    expect(buttons.some((b) => b.text === 'Reportar')).toBe(true);
  });

});
