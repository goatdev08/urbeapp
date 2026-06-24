---
tipo: concepto
dominio: arquitectura
estado: vivo
fuentes: [docs/lineamientos-desarrollo.md, supabase/README.md]
codigo: [supabase/migrations/0008_rls_helpers_and_policies.sql, supabase/migrations/0010_security_perf_hardening.sql]
actualizado: 2026-06-17
---

# RLS y seguridad

> Row Level Security como **2ª capa** de defensa, endurecida. La lógica de negocio vive en Edge Functions, no en RLS.

## Patrón (migraciones 0008 → 0010)
- RLS habilitado en las **20 tablas**, ~**65 políticas** (SELECT/INSERT/UPDATE/DELETE).
- **0008**: 10 helpers en schema `public`. **0010**: los mueve a schema **`private`** (no expuesto por PostgREST) y los reescribe con `(select auth.uid())` para evitar el *init-plan* recursivo; además blinda triggers (search_path fijo) y agrega 11 índices FK.
- **10 helpers** (`private.*`, SECURITY DEFINER STABLE): `current_user_role`, `is_admin`, `manages_agency`, `is_agency_owner_of`, `current_user_agency_id`, `owns_property`, `can_manage_property`, `property_is_public`, `can_view_lead`, `can_edit_lead`.

## Reglas clave
- 🔒 **Grants column-level** bloquean auto-escalación: el cliente no puede cambiar `users.role`, `agencies.status`, `is_verified_agent`, ni el contenido de `notifications`.
- 🔒 `events_raw` y `admin_actions` → **solo `service_role`** (sin políticas para anon/authenticated; append-only).
- **Público (anon):** `properties` con `status='active'` + `property_videos` con `status='ready'` + `agencies` approved|active + `terms_versions`.
- Lógica de negocio → **Edge Functions** (validación→autorización→lógica→persistencia). RLS no orquesta; triggers solo atómicos. Ver `docs/lineamientos-desarrollo.md`.

## Al construir features nuevas (demo)
Toda tabla/feature respeta este patrón: políticas idempotentes (`drop policy if exists … ; create policy …`), helpers `private.*`, grants mínimos. Cualquier dato sensible → test pgTAP en `02_rls_test.sql`.

## Detalle exhaustivo
- migraciones `0008` / `0010` · `supabase/tests/02_rls_test.sql` (15 asserts) · `docs/lineamientos-desarrollo.md`

## Relacionados
[[roles-y-permisos]] · [[inmobiliarias-y-agentes]] · [[crm-leads]] · [[db-schema-map]]
