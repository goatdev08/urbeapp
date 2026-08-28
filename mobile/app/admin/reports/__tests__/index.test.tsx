/**
 * Tests — AdminReportsScreen (mobile/app/admin/reports/index.tsx)
 * Subtarea Taskmaster: 220.4 — hardening (el GREEN ya estaba implementado y
 * el guardian dio PASS; esta pasada solo AÑADE cobertura, cero cambios en la
 * pantalla).
 *
 * 🔴 Por qué existe: la pantalla tenía CERO tests. El guardian encontró 3
 * mutantes que sobreviven con la suite completa en verde:
 *
 * - P6 (el más grave): cruzar el cableado de "Eliminar" para que llame
 *   `on_resolve(..., 'keep_suspended', ...)`. Ninguna prueba distinguía los 4
 *   botones, aunque el hook sí distingue las 4 acciones — "Eliminar" podía
 *   dejar de eliminar y nada lo notaba.
 * - P1: `can_act = !is_submitting` (sin el check `status === 'suspended'`) →
 *   las 4 acciones quedan habilitadas sobre una propiedad que no está
 *   suspendida.
 * - P2: `can_confirm_with_reason = can_act` → `request_changes`/`delete`
 *   dejan de exigir motivo. Este invariante vive SOLO en la UI (la Edge
 *   Function `moderate-property` deja `reason` opcional a propósito) — sin
 *   este test no hay segunda capa que lo sostenga.
 *
 * SEAM BAJO TEST: el componente de ruta `AdminReportsScreen` (default export
 * de `index.tsx`), con `useAdminReports` y `useResolveReport` MOCKEADOS por
 * completo — ambos hooks ya tienen su propia cobertura crítica (220.2/220.3).
 * Aquí solo se prueba el CABLEADO entre lo que la pantalla pinta y lo que
 * invoca sobre el hook de resolución.
 *
 * Casos:
 * - (EC-R1) 🔴 el más importante: cada uno de los 4 botones llama `resolve`
 *   con SU acción propia (restore/request_changes/keep_suspended/delete) —
 *   mata P6. Un cableado cruzado entre dos de los 4 es imposible de pasar
 *   desapercibido: se afirma la secuencia completa de las 4 llamadas.
 * - (EC-R2) propiedad NO suspendida ('active') → las 4 acciones quedan
 *   deshabilitadas (`accessibilityState.disabled`) y un press no invoca
 *   `resolve` — mata P1. El motivo va pre-llenado para aislar el efecto de
 *   `can_act` del de `can_confirm_with_reason` (P2).
 * - (EC-R3) propiedad suspendida SIN motivo → `request_changes`/`delete`
 *   deshabilitados, `restore`/`keep_suspended` habilitados; CON motivo, los
 *   4 se habilitan — mata P2.
 * - (EC-R4/5/6) estados básicos: loading, error con reintento, vacío.
 *
 * GOTCHAS RNTL ya pagados (rntl14_renderhook_async): `render` con `await` +
 * `act()` async con `await`; `fireEvent` TAMBIÉN es async en 14.0.1 — sin el
 * `await` el árbol no refleja el estado nuevo antes de la siguiente
 * aserción. Precedente exacto de mock de hooks + `render_screen`:
 * `app/(protected)/ads/__tests__/index.test.tsx`. Precedente exacto del
 * patrón disabled (`.props.accessibilityState?.disabled` + press-no-llama):
 * `src/features/property-detail/components/__tests__/ReportPropertySheet.test.tsx`.
 */

import React from 'react';
import { render, act, cleanup, screen, fireEvent } from '@testing-library/react-native';

import type {
  AdminReportQueueItem,
  UseAdminReportsResult,
} from '@/features/admin/hooks/useAdminReports';
import type {
  ResolveReportResult,
  UseResolveReportReturn,
} from '@/features/admin/hooks/useResolveReport';
import { useAdminReports } from '@/features/admin/hooks/useAdminReports';
import { useResolveReport } from '@/features/admin/hooks/useResolveReport';
import AdminReportsScreen from '../index';

// ---------------------------------------------------------------------------
// Mocks — babel-plugin-jest-hoist iza estos jest.mock por ENCIMA de los
// imports de arriba, así que el SUT ya los ve registrados al importarse
// (por eso los imports pueden ir arriba y no disparan import/first).
// ---------------------------------------------------------------------------

jest.mock('@/features/admin/hooks/useAdminReports', () => ({
  useAdminReports: jest.fn(),
}));

jest.mock('@/features/admin/hooks/useResolveReport', () => ({
  useResolveReport: jest.fn(),
}));


const mock_use_admin_reports = useAdminReports as jest.MockedFunction<typeof useAdminReports>;
const mock_use_resolve_report = useResolveReport as jest.MockedFunction<typeof useResolveReport>;

type RenderResult = Awaited<ReturnType<typeof render>>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUSPENDED_ITEM: AdminReportQueueItem = {
  property_id: 'prop-1',
  property: {
    id: 'prop-1',
    address: 'Calle Falsa 123',
    operation_type: 'rent',
    property_type: 'house',
    price: 15000,
    status: 'suspended',
  },
  reports: [
    {
      report_id: 'report-1',
      reason: 'false_price',
      reason_text: null,
      reported_by_user_id: 'user-1',
      created_at: '2026-08-01T00:00:00Z',
    },
  ],
  report_count: 1,
};

const ACTIVE_ITEM: AdminReportQueueItem = {
  ...SUSPENDED_ITEM,
  property_id: 'prop-2',
  property: { ...SUSPENDED_ITEM.property, id: 'prop-2', status: 'active' },
};

function admin_reports(overrides: Partial<UseAdminReportsResult>): UseAdminReportsResult {
  return {
    reports: [],
    is_loading: false,
    error_message: null,
    refetch: jest.fn(),
    ...overrides,
  };
}

function resolve_report(overrides: Partial<UseResolveReportReturn>): UseResolveReportReturn {
  return {
    resolve: jest.fn<Promise<ResolveReportResult>, [any]>(() =>
      Promise.resolve({ ok: true, status: 'active' }),
    ),
    is_submitting: false,
    error_message: null,
    ...overrides,
  };
}

async function render_screen(): Promise<RenderResult> {
  let q!: RenderResult;
  await act(async () => {
    q = await render(<AdminReportsScreen />);
  });
  return q;
}

beforeEach(() => {
  mock_use_admin_reports.mockReturnValue(admin_reports({}));
  mock_use_resolve_report.mockReturnValue(resolve_report({}));
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-R1) 🔴 cada botón invoca resolve con SU acción propia — mata P6
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-R1: cada_boton_invoca_resolve_con_su_accion_propia', () => {
  it('propiedad suspendida + motivo lleno → restore/keep_suspended/request_changes/delete llaman resolve con la acción exacta de CADA botón, en orden, sin cruces', async () => {
    const mock_resolve = jest.fn<Promise<ResolveReportResult>, [any]>(() =>
      Promise.resolve({ ok: true, status: 'active' }),
    );
    mock_use_admin_reports.mockReturnValue(admin_reports({ reports: [SUSPENDED_ITEM] }));
    mock_use_resolve_report.mockReturnValue(resolve_report({ resolve: mock_resolve }));

    await render_screen();

    await fireEvent.changeText(screen.getByTestId('reason-input-prop-1'), 'Motivo de prueba');

    await fireEvent.press(screen.getByTestId('restore-prop-1'));
    await fireEvent.press(screen.getByTestId('keep-suspended-prop-1'));
    await fireEvent.press(screen.getByTestId('request-changes-prop-1'));
    await fireEvent.press(screen.getByTestId('delete-prop-1'));

    expect(mock_resolve).toHaveBeenCalledTimes(4);
    expect(mock_resolve).toHaveBeenNthCalledWith(1, { property_id: 'prop-1', action: 'restore' });
    expect(mock_resolve).toHaveBeenNthCalledWith(2, {
      property_id: 'prop-1',
      action: 'keep_suspended',
    });
    expect(mock_resolve).toHaveBeenNthCalledWith(3, {
      property_id: 'prop-1',
      action: 'request_changes',
      reason: 'Motivo de prueba',
    });
    // El caso crítico (P6): "Eliminar" debe llamar 'delete', NUNCA
    // 'keep_suspended' ni ninguna otra acción.
    expect(mock_resolve).toHaveBeenNthCalledWith(4, {
      property_id: 'prop-1',
      action: 'delete',
      reason: 'Motivo de prueba',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-R2) propiedad NO suspendida → las 4 acciones deshabilitadas — mata P1
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-R2: propiedad_no_suspendida_deshabilita_las_4_acciones', () => {
  it("status='active' (con motivo YA lleno, para aislar de P2) → los 4 botones están accessibilityState.disabled y un press no llama resolve", async () => {
    const mock_resolve = jest.fn<Promise<ResolveReportResult>, [any]>(() =>
      Promise.resolve({ ok: true, status: 'active' }),
    );
    mock_use_admin_reports.mockReturnValue(admin_reports({ reports: [ACTIVE_ITEM] }));
    mock_use_resolve_report.mockReturnValue(resolve_report({ resolve: mock_resolve }));

    await render_screen();

    await fireEvent.changeText(screen.getByTestId('reason-input-prop-2'), 'Motivo de prueba');

    const restore_btn = screen.getByTestId('restore-prop-2');
    const keep_btn = screen.getByTestId('keep-suspended-prop-2');
    const request_btn = screen.getByTestId('request-changes-prop-2');
    const delete_btn = screen.getByTestId('delete-prop-2');

    expect(restore_btn.props.accessibilityState?.disabled).toBe(true);
    expect(keep_btn.props.accessibilityState?.disabled).toBe(true);
    expect(request_btn.props.accessibilityState?.disabled).toBe(true);
    expect(delete_btn.props.accessibilityState?.disabled).toBe(true);

    await fireEvent.press(restore_btn);
    await fireEvent.press(keep_btn);
    await fireEvent.press(request_btn);
    await fireEvent.press(delete_btn);

    expect(mock_resolve).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-R3) motivo obligatorio SOLO para request_changes/delete — mata P2
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-R3: motivo_obligatorio_solo_para_request_changes_y_delete', () => {
  it('propiedad suspendida sin motivo → request_changes/delete deshabilitados, restore/keep_suspended habilitados; con motivo, los 4 se habilitan', async () => {
    const mock_resolve = jest.fn<Promise<ResolveReportResult>, [any]>(() =>
      Promise.resolve({ ok: true, status: 'active' }),
    );
    mock_use_admin_reports.mockReturnValue(admin_reports({ reports: [SUSPENDED_ITEM] }));
    mock_use_resolve_report.mockReturnValue(resolve_report({ resolve: mock_resolve }));

    await render_screen();

    const restore_btn = screen.getByTestId('restore-prop-1');
    const keep_btn = screen.getByTestId('keep-suspended-prop-1');
    const request_btn = screen.getByTestId('request-changes-prop-1');
    const delete_btn = screen.getByTestId('delete-prop-1');

    // Sin motivo: restore/keep_suspended YA habilitados (nunca piden motivo);
    // request_changes/delete deshabilitados.
    expect(restore_btn.props.accessibilityState?.disabled).not.toBe(true);
    expect(keep_btn.props.accessibilityState?.disabled).not.toBe(true);
    expect(request_btn.props.accessibilityState?.disabled).toBe(true);
    expect(delete_btn.props.accessibilityState?.disabled).toBe(true);

    await fireEvent.press(request_btn);
    await fireEvent.press(delete_btn);
    expect(mock_resolve).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('reason-input-prop-1'), 'Ahora sí hay motivo');

    expect(screen.getByTestId('request-changes-prop-1').props.accessibilityState?.disabled).not.toBe(
      true,
    );
    expect(screen.getByTestId('delete-prop-1').props.accessibilityState?.disabled).not.toBe(true);
  });

  it('motivo de solo espacios → request_changes/delete siguen deshabilitados (se exige texto real, no solo longitud > 0)', async () => {
    mock_use_admin_reports.mockReturnValue(admin_reports({ reports: [SUSPENDED_ITEM] }));

    await render_screen();

    await fireEvent.changeText(screen.getByTestId('reason-input-prop-1'), '   ');

    expect(
      screen.getByTestId('request-changes-prop-1').props.accessibilityState?.disabled,
    ).toBe(true);
    expect(screen.getByTestId('delete-prop-1').props.accessibilityState?.disabled).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (EC-R4/5/6) Estados básicos
// ═══════════════════════════════════════════════════════════════════════════

describe('EC-R4: estado_de_carga', () => {
  it('is_loading=true → pinta el indicador de carga, sin lista', async () => {
    mock_use_admin_reports.mockReturnValue(admin_reports({ reports: null, is_loading: true }));

    await render_screen();

    expect(screen.getByTestId('loading-indicator')).toBeTruthy();
    expect(screen.queryByTestId('reports-list')).toBeNull();
  });
});

describe('EC-R5: estado_de_error_con_reintento', () => {
  it('error_message presente → pinta el mensaje y un press en "Reintentar" llama refetch', async () => {
    const refetch = jest.fn();
    mock_use_admin_reports.mockReturnValue(
      admin_reports({
        reports: null,
        error_message: 'No se pudieron cargar los reportes pendientes. Intenta de nuevo.',
        refetch,
      }),
    );

    await render_screen();

    expect(
      screen.getByText('No se pudieron cargar los reportes pendientes. Intenta de nuevo.'),
    ).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Reintentar carga'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('EC-R6: estado_vacio', () => {
  it('reports=[] → pinta el empty-state, sin tarjetas', async () => {
    mock_use_admin_reports.mockReturnValue(admin_reports({ reports: [] }));

    await render_screen();

    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.queryByTestId('report-prop-1')).toBeNull();
  });
});
