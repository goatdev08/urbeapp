---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [.taskmaster/docs/exploraciones/041-panel-admin-centro-operativo.md, wiki/decisiones/0010-prd-canonico-beta-sin-pagos.md, docs/PRD.md §22.4 §28]
codigo:
  - mobile/app/admin/
  - mobile/src/features/admin/
  - mobile/src/features/admin/hooks/useAdminQueueCounts.ts
  - mobile/src/features/admin/hooks/useAdminRevisions.ts
  - mobile/src/features/admin/hooks/useModerateProperty.ts
  - mobile/app/admin/revisions/index.tsx
  - mobile/app/admin/reports/index.tsx
  - mobile/src/features/admin/hooks/useAdminReports.ts
  - mobile/src/features/admin/hooks/useResolveReport.ts
  - mobile/src/features/profile/ProfileScreen.tsx
  - supabase/functions/_shared/property_field_whitelist.ts
actualizado: 2026-08-28
---

# Panel admin (centro operativo)

> El panel admin **in-app** es el **centro operativo de la beta** ("beta = producción menos pagos", decisión [[0010-prd-canonico-beta-sin-pagos]]): todo lo que el admin opera —moderar anuncios, aprobar revisiones de edición, atender reportes y solicitudes— se hace desde el teléfono, en `mobile/app/admin/`. Módulo 041 (exploración aprobada 2026-08-24), tareas **#217–#222** (bloques M0–M5). El panel web (#81) sigue diferido.

## Cómo se llega HOY
- **Entrada en el menú ⋮ del perfil** («Panel de administrador»), visible **solo si `role='admin'`** — tarea 217.1, `ProfileScreen.tsx` (`router.push('/admin')`). Mató al deep link como única vía.
- El deep link **`urbea://admin`** sigue funcionando. La autorización real no es el botón: el layout del panel gatea por rol (ocultar la entrada no detiene un deep link — mismo principio que el gate de [[publicidad-anuncios]]).

## Qué contiene hoy (M0 + lo adelantado)
- **Home** (`mobile/app/admin/index.tsx`): lista de agencias (alta/suspensión/`can_advertise`, #209) + sección **«Colas»** con **5 contadores vivos** — anuncios `pending_review`, `property_revisions` `pending`, `property_reports` `new`, `agent_applications` `pending`, `agencies` `pending_approval`.
- Los counts los da `useAdminQueueCounts` (`mobile/src/features/admin/hooks/useAdminQueueCounts.ts`): 5 queries `count: 'exact', head: true` **en paralelo, sin RPC nueva** — las policies RLS con `private.is_admin()` ya autorizan los SELECT al admin. **Todo-o-nada** (patrón `useAdStats`): si UNA falla, `counts=null` + mensaje neutro — nunca 4 números reales y una mentira. Los badges no pueden mentir porque **son** la cola, no una copia.
- **Gestión de anuncios en `/admin/ads`** (#208): cola de `pending_review` con creativo firmado bajo demanda, aprobar/rechazar con motivo; pause/resume/reject de activos (#210). Ver [[publicidad-anuncios]].
- **Cola de revisiones en `/admin/revisions`** (#218, M1): revisiones `pending|needs_changes` FIFO con **diff campo a campo** (`useAdminRevisions`: embed a `properties`, sin RPC nueva; el diff filtra a valores realmente distintos — `edit-property` guarda el input COMPLETO en `changed_fields`) y **Aprobar / Pedir cambios / Rechazar** (`useModerateProperty` → EF `moderate-property`; **motivo obligatorio en la UI** para las dos últimas aunque la EF lo deje opcional). Aprobar aplica el snapshot vía la RPC atómica — el bug del precio editado que nadie podía aprobar está muerto. Lado publicador: bucket «En revisión» en Mis publicaciones + badge veraz `suspended`; el aviso con motivo al publicador nace en M2 ([[notificaciones]]).

- **Centro de notificaciones (#219, M2, vivo)**: 4 escritores admin por trigger + espejos de resolución en las 4 funciones de moderación (catálogo v1), hook `useNotifications`, campana con badge en el Perfil y pantalla `(protected)/notifications`. Detalle y decisiones en [[notificaciones]].
- **Cola de reportes en `/admin/reports` (#220, M3, viva)**: `mobile/app/admin/reports/index.tsx` lee `useAdminReports` (`property_reports` con `status='new'`, `order created_at desc` sobre `property_reports_queue_idx`, embed a `properties` **solo con campos de display**) y **agrupa por propiedad EN MEMORIA** — sin RPC nueva, preservando la primera aparición de cada `property_id` y el orden del server dentro del grupo. 🔴 **Nunca filtra por `reported_by_user_id`**: es la cola de ADMIN, no «mis reportes» (el gotcha invertido de la nota de FlashList). Las 4 acciones (`useResolveReport` → la MISMA EF `moderate-property`) se habilitan solo si la propiedad está `suspended`, y **pedir cambios / eliminar exigen motivo en la UI** aunque la EF lo deje opcional — mismo criterio que ya usaba `/admin/revisions`. La fila «Reportes» del home (`reports_new`) pasó de informativa a **navegable**; `useAdminQueueCounts` no se tocó (ya contaba `property_reports.status='new'`). La pantalla usa **tokens de `theme.ts`, cero hex sueltos** — el guardian contó 0 contra 30 en `revisions/index.tsx` y 50 en `ads/index.tsx`: mejora el estándar en vez de calcarlo.
- Lado usuario, misma tarea: botón «Reportar» en el detalle de la propiedad y «Reportar perfil» en la tarjeta del agente, ambos ocultos si el objeto es tuyo. Ver [[moderacion]].

## Qué llega (M4–M5, una tarea = una rama = un PR)
- **M4 (#221)** — cola `/admin/requests` unificada: solicitudes de agente, registros de inmobiliaria y el canal nuevo de cuenta comercial.
- **M5 (#222)** — testing profundo del ciclo comercial (checklist guiado + Maestro E2E), ponytail-audit de `features/admin`, OTA.

## Reglas
- Toda acción admin escribe en `admin_actions` (append-only) **en la misma transacción** — la auditoría no es best-effort.
- En beta **publicar propiedades NO pasa por este panel** (§15.1 suspendido, #153); lo que sí se modera aquí: anuncios, ediciones, reportes, solicitudes.

## Relacionados
[[moderacion]] · [[publicidad-anuncios]] · [[inmobiliarias-y-agentes]] · [[notificaciones]] · [[0010-prd-canonico-beta-sin-pagos]]
