---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §22.4 §28.4, .taskmaster/docs/exploraciones/041-panel-admin-centro-operativo.md]
codigo:
  - supabase/migrations/20260825000001_notify_admin_events.sql
  - supabase/migrations/20260826000001_notify_moderation_mirrors.sql
  - supabase/tests/71_notify_admin_events_test.sql
  - supabase/tests/72_notify_moderation_mirrors_test.sql
  - mobile/src/features/notifications/hooks/useNotifications.ts
  - mobile/src/features/notifications/types.ts
  - mobile/src/features/notifications/components/
  - mobile/app/(protected)/notifications.tsx
actualizado: 2026-08-27
---

# Notificaciones

> Centro in-app **vivo** desde la tarea #219 (041-M2): la tabla `notifications` (0007) tiene sus primeros **escritores** (catálogo v1, backend) y su primer **lector** (hook + campana + pantalla). **In-app solamente — push (FCM/APNs) = fase 2** (§28.4); el hook quedó diseñado para conectarle push sin rehacer nada.

## Catálogo v1 (tipos vivos)
**Hacia admins de plataforma** (`role='admin'`, escritos por triggers — 219.1):
- `admin_ad_pending` (ads `draft→pending_review`; la democión de sistema #192 NO dispara) → `/admin/ads`
- `admin_agency_pending` (agencies nace `pending_approval`) → `/admin/requests`
- `admin_agent_application` (applications nace `pending`) → `/admin/requests`
- `admin_revision_pending` (revisión nace `pending` **y cada re-envío** `needs_changes→pending` — nunca deduplicado, a propósito) → `/admin/revisions`

**Espejos de resolución al usuario afectado** (escritos dentro de las funciones de moderación — 219.2):
- `property_revision_{approved,needs_changes,rejected}` → `submitted_by` de la revisión (u `owner_user_id` sin revisión), motivo en data → `/my-listings`
- `ad_{approved,rejected,paused}` → miembros ACTIVOS owner/admin de la agencia → `/ads`
- `agency_{approved,rejected}` → solicitante (`created_by_user_id`; `active↔suspended` NO es resolución, no espeja) → `/profile`
- `agent_application_{approved,rejected}` → solicitante, `rejection_reason` en rejected → `/profile`

## Decisiones de diseño (fijadas, no re-decidir)
- 🔒 **BLOQUEANTE** (Abraham 2026-08-25): el INSERT del aviso vive en la MISMA transacción del evento, SIN bloque EXCEPTION — si el escritor truena, el evento entero revierte (verificado por fault-injection en pgTAP).
- **Nunca el admin actor** recibe un espejo, ni siquiera siendo miembro de la agencia afectada (guard explícito en las 4 funciones, anclado por mutantes en las suites 71/72).
- **Idempotencia**: eventos de disparo único (a)-(c) → índice único parcial `(user_id, related_entity_id, type)` + `ON CONFLICT DO NOTHING`; `admin_revision_pending` SIN ancla (el re-envío debe avisar de nuevo); espejos de resolución → retry-dedup EN MEMORIA (estado anterior vs solicitado), sin índice.
- **Campana en PERFIL** (Abraham 2026-08-25): botón 40×40 junto al menú ⋮, badge de no-leídas (oculto en 0), única superficie común a todos los roles; NO tab nueva. ⚠️ Contradice PRD §22.1 (campana en header del feed) — **gana la decisión 041/219**.
- **Retención 30 días** por `created_at` (pg_cron `purge_notifications_daily`, 0 11 UTC), sin importar read_at/deleted_at.
- Lector: `useNotifications` — lista `deleted_at is null` desc limit 50, `unread_count` derivado, `mark_read`/`mark_all_read` **optimistas con revert exacto**, refetch por tick (sin realtime en beta). 🔴 SELECT y UPDATEs con `.eq('user_id')` EXPLÍCITO — las policies llevan `OR is_admin()`.

## Dónde está el detalle
Cabeceras de las suites pgTAP 71/72 (contrato completo, edge cases, mutantes) · docblock de `useNotifications.test.tsx` (30 tests RNTL) · bitácoras de 219.1–219.5 en Taskmaster.

## Relacionados
[[panel-admin]] · [[moderacion]] · [[publicidad-anuncios]] · [[inmobiliarias-y-agentes]] · [[privacidad-datos]]
