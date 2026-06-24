---
name: urbea-supabase
description: Best practices del backend de Urbea (Supabase): migraciones, RLS, Edge Functions y Storage. Usar al crear o modificar el esquema, políticas de seguridad, funciones de borde o la subida de video. Cubre el patrón RLS (schema private, helpers, 0008/0010), migraciones idempotentes + rollback + pgTAP, Edge Functions service layer, Storage, y naming snake_case. Disparar ante "migración", "rls", "política", "edge function", "supabase", "storage", "tabla", "trigger".
---

# urbea-supabase — backend

Convenciones para `supabase/`. Fuentes: `docs/lineamientos-desarrollo.md`, `wiki/conceptos/rls-seguridad.md`, `wiki/codebase/db-schema-map.md`.

## Reglas de oro (lineamientos)
- Lógica de negocio en **Edge Functions**, no en triggers ni RLS.
- **RLS = 2ª capa** de seguridad (no la primera).
- **Triggers solo atómicos** (`updated_at`, integridad). Nada de orquestación ni side-effects.
- Idempotencia en operaciones críticas y webhooks.

## Migraciones
- `supabase/migrations/YYYYMMDDHHMMSS_descripcion.sql`, **idempotente** (`create table if not exists`, `drop policy if exists … ; create policy …`).
- **Rollback** en `supabase/migrations/rollbacks/` + **tests pgTAP** en `supabase/tests/`.
- **NO aplicar al remoto** (`urbea-app`) sin indicación explícita; desarrollar con local/branch. La migración de billing (`0011`) sigue **latente**.
- Naming `snake_case`: tablas (plural), columnas, FKs (`<entidad>_id`), funciones. Timestamps `timestamptz`.

## RLS (patrón 0008 → 0010)
- Helpers en schema **`private`** (no expuesto), SECURITY DEFINER STABLE, con `(select auth.uid())`.
- Políticas idempotentes por tabla (select/insert/update/delete). Grants **column-level** anti-escalación (p.ej. el cliente no cambia `users.role`).
- Toda tabla nueva: RLS habilitado + políticas + **test pgTAP**.

## Edge Functions
- `supabase/functions/<dominio>/` (`invitations`, `properties`, `leads`…).
- Patrón service layer: **validación → autorización → lógica → persistencia**. Logging JSON con `correlation_id`. Idempotencia (canje de token, creación de lead).
- Son lógica crítica → **TDD** (Deno test / Vitest).

## Storage (demo)
- Bucket de video con políticas RLS de Storage (subida por el agente dueño; lectura pública de propiedades activas). Video **sin transcoding** (demo). Ver `wiki/conceptos/propiedades-y-video.md`.

## Verificación
pgTAP (`supabase test db` local) + tests de Edge Functions. No cierres una subtarea crítica sin el `guardian` en PASS.
