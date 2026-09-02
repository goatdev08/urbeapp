---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §22.4 §28.4, .taskmaster/docs/exploraciones/041-panel-admin-centro-operativo.md]
codigo:
  - supabase/migrations/20260825000001_notify_admin_events.sql
  - supabase/migrations/20260826000001_notify_moderation_mirrors.sql
  - supabase/migrations/20260827000001_fix_moderation_mirror_semantics.sql
  - supabase/migrations/20260827000002_fix_admin_notify_recipients.sql
  - supabase/migrations/20260828000002_property_reports_autosuspend.sql
  - supabase/migrations/20260828000004_resolve_property_reports_atomic.sql
  - supabase/tests/71_notify_admin_events_test.sql
  - supabase/tests/72_notify_moderation_mirrors_test.sql
  - supabase/tests/74_property_reports_autosuspend_test.sql
  - supabase/tests/75_moderate_property_report_resolution_test.sql
  - mobile/src/features/notifications/hooks/useNotifications.ts
  - mobile/src/features/notifications/types.ts
  - mobile/src/features/notifications/components/
  - mobile/app/(protected)/notifications.tsx
actualizado: 2026-08-28
---

# Notificaciones

> Centro in-app **vivo** desde la tarea #219 (041-M2): la tabla `notifications` (0007) tiene sus primeros **escritores** (catálogo v1, backend) y su primer **lector** (hook + campana + pantalla). **In-app solamente — push (FCM/APNs) = fase 2** (§28.4); el hook quedó diseñado para conectarle push sin rehacer nada. El catálogo creció con **#220 (M3, reportes §24)**: 7 types más, sin tocar ni la tabla ni el lector — el diseño de escritores aguanta módulos nuevos por agregación.

## Catálogo v1 (tipos vivos)
**Hacia admins de plataforma** (`role='admin'` **y `deleted_at is null`** — un admin dado de baja no recibe nada, y el predicado además habilita el índice parcial `users_role_idx` dentro de la transacción bloqueante; escritos por triggers — 219.1, corregido en 223.2):
- `admin_ad_pending` (ads `draft→pending_review`; la democión de sistema #192 NO dispara) → `/admin/ads`
- `admin_agency_pending` (agencies nace `pending_approval`) → `/admin` ⏳ *interino: la pantalla de solicitudes la construye #221 (M4) y entonces pasa a `/admin/requests`*
- `admin_agent_application` (applications nace `pending`) → `/admin` ⏳ *mismo interino*
- `admin_revision_pending` (revisión nace `pending` **y cada re-envío** `needs_changes→pending` — nunca deduplicado, a propósito) → `/admin/revisions`
- `admin_report_new` (**1er y 2º** reportante distinto de una propiedad en la ventana de 24h) → `/admin/reports`
- `admin_report_autosuspend` (el **3er** reportante distinto: la propiedad pasa a `suspended` en la misma transacción) → `/admin/reports`
- `admin_rollup_unhealthy` (**#215**, 2026-09-02, DESPLEGADO) → `/admin`. Lo escribe `public.check_rollup_health()` (pg_cron `check_rollup_health_daily`, 0 10 UTC): (A) las últimas 3 corridas del rollup sin ninguna `succeeded`, o (B) un mes con crudo fuera de la ventana de 90 d sin fila en `ad_impressions_monthly`. Dedupe por `(user_id, type, data->>'anchor')` (índice propio: `related_entity_id` va NULL y NULL nunca colisiona) — un aviso por día mientras el job siga caído, uno por mes congelado para siempre. Gotcha: `cron.job_run_details` tiene RLS por `username` y `postgres` no es superusuario → solo lo ve por ser security definer con owner postgres.

  Los dos últimos (220.2) nacen del mismo trigger `AFTER INSERT` en `property_reports`, comparten el guard «nunca el actor» (un admin que reporta no recibe el aviso de SU reporte, sí los ajenos) y **no escriben `admin_actions`**: no hay actor humano, y `admin_actions.admin_id` es NOT NULL. Un 4º reporte sobre una propiedad ya `suspended` es no-op total: se persiste como auditoría y no re-notifica.

**Espejos de resolución al usuario afectado** (escritos dentro de la función que resuelve el caso — 219.2; los dos últimos, dentro del trigger y la RPC de reportes de 220.2/220.3):
- `property_revision_{approved,needs_changes,rejected}` → `submitted_by` de la revisión (u `owner_user_id` sin revisión), motivo en data → `/profile/my-listings`
- `ad_{approved,rejected,paused}` → miembros ACTIVOS owner/admin de la agencia → `/ads`. ⚠️ `ad_approved` **solo desde `pending_review`**: un resume administrativo (`paused→active`) NO se espeja — un resume no es una resolución (223.1). Un type `ad_resumed` es la opción de fase 2 si algún día se quiere avisar.
- `agency_{approved,rejected}` → solicitante (`created_by_user_id`; `active↔suspended` NO es resolución, no espeja) → `/profile` · **#234**: `agency_rejected` lleva el motivo en `data.rejection_reason` **y en el body** (« Motivo: …», guard `~ '\S'`) porque `NotificationCard` solo pinta title/body; `agencies.rejection_reason` lo persiste (aprobar lo limpia). Los otros tres espejos de rechazo (`ad_rejected`, `property_revision_rejected`, `agent_application_rejected`) siguen con el motivo SOLO en data → **#237**.
- `agent_application_{approved,rejected}` → solicitante, `rejection_reason` en rejected → `/profile`
- `lead_unmanaged` (**#203**, 2026-09-02) → owner/admin ACTIVOS de la agencia donde el agente del lead está `suspended` (nunca el propio agente — excluido por `user_id`, no por rol: un owner activo puede arrastrar filas `suspended` propias) → `/crm`. Trigger AFTER INSERT en `leads` con `WHEN (new.agency_id is not null)`; ancla `(user_id, related_entity_id, type)`.
- `properties_reassigned` (**#203**) → el miembro que recibe el inventario de `reassign_member_properties_atomic` → `/profile/my-listings`; SIN ancla a propósito (cada reasignación es un hecho distinto con su conteo).
- `property_suspended_by_reports` → `owner_user_id` de la propiedad auto-suspendida, `data.reason='multiple_reports'` → `/profile/my-listings` (220.2; llega aunque no exista ni un admin vivo — la suspensión y su espejo no dependen del fan-out)
- `property_report_{restored,needs_changes,kept_suspended,deleted}` → `owner_user_id`, motivo del admin en `data.resolution` **solo si lo hubo** (nunca se fabrica texto por defecto) → `/profile/my-listings` (220.3). Esta RPC **nunca** notifica a admins: ese aviso ya salió al crearse el reporte.

## Decisiones de diseño (fijadas, no re-decidir)
- 🔒 **BLOQUEANTE** (Abraham 2026-08-25): el INSERT del aviso vive en la MISMA transacción del evento, SIN bloque EXCEPTION — si el escritor truena, el evento entero revierte (verificado por fault-injection en pgTAP).
- **Nunca el admin actor** recibe un espejo, ni siquiera siendo miembro de la agencia afectada (guard explícito en las 4 funciones, anclado por mutantes en las suites 71/72).
- **Idempotencia**: eventos de disparo único (a)-(c) → índice único parcial `(user_id, related_entity_id, type)` + `ON CONFLICT DO NOTHING`; `admin_revision_pending` SIN ancla (el re-envío debe avisar de nuevo); espejos de resolución → retry-dedup EN MEMORIA (estado anterior vs solicitado), sin índice.
- **Campana en PERFIL** (Abraham 2026-08-25): botón 40×40 junto al menú ⋮, badge de no-leídas (oculto en 0), única superficie común a todos los roles; NO tab nueva. ⚠️ Contradice PRD §22.1 (campana en header del feed) — **gana la decisión 041/219**.
- **Retención 30 días** por `created_at` (pg_cron `purge_notifications_daily`, 0 11 UTC), sin importar read_at/deleted_at.
- Lector: `useNotifications` — lista `deleted_at is null` desc limit 50, `mark_read`/`mark_all_read` **optimistas con revert exacto**, refetch por tick (sin realtime en beta). 🔴 SELECT y UPDATEs con `.eq('user_id')` EXPLÍCITO — las policies llevan `OR is_admin()`.
- **`unread_count` NO se deriva de la lista**: sale de una query de CABECERA propia (`count: 'exact', head: true`, filtrada a `read_at is null`), porque la lista viene capada a 50 y el badge mentía con más de 50 no leídas (223.3; el índice `notifications_unread_idx` existe para esa query). Al cambiar de sesión el conteo se resetea a 0 de inmediato — el badge de una persona nunca se le muestra a otra.
- 🔴 **Los `deep_link` son un contrato con el Expo Router**: el catálogo de arriba es la fuente de verdad y **cada ruta debe existir**. Ninguna suite pgTAP puede detectar una ruta muerta —el review del PR #106 encontró dos, `/my-listings` y `/admin/requests`, ambas escritas por migraciones y ambas anotadas como "esperadas" por su propio RED—. Al agregar un type nuevo, verifica la ruta contra `mobile/app/` antes de escribir el assert.
  - ⚠️ **«El `router.push` compila» no es evidencia de nada** (guardian de 220.4, vale para todo el repo): los typed routes de Expo Router están **desactivados** —no hay `.expo/types/router.d.ts` ni `experiments.typedRoutes` en `app.config.ts`—, así que `router.push('/ruta-inexistente')` pasa `pnpm tsc --noEmit` sin una queja. Se demostró mutando el push a una ruta falsa: tsc limpio. Es el agujero exacto por el que pasaron las dos rutas muertas del PR #106. La verificación real es **montar la pantalla** (sonda de render con los hooks mockeados) o comprobar el archivo bajo `mobile/app/`; el literal del `deep_link` debe coincidir byte a byte con el que escribe la migración.

## Deuda conocida (decisiones, no bugs)
- La **purga a 30 días** borra también los índices-ancla de idempotencia: un evento que siga pendiente al día 31 puede re-notificar. Se acepta a propósito — la retención le gana a la anti-duplicación.
- El filtro por enumeración de types en los asserts de las suites envejece si una función de moderación gana un espejo nuevo (la forma `type <> '...'` no envejecería). Trade-off aceptado en 219.2/219.6.

## Dónde está el detalle
Cabeceras de las suites pgTAP 71/72 (contrato completo, edge cases, mutantes) y **74/75** (los 7 types de reportes) · docblock de `useNotifications.test.tsx` (42 tests RNTL) · bitácoras de 219.1–219.6, 223.1–223.4 y 220.1–220.6 en Taskmaster.

## Relacionados
[[panel-admin]] · [[moderacion]] · [[publicidad-anuncios]] · [[inmobiliarias-y-agentes]] · [[privacidad-datos]]
