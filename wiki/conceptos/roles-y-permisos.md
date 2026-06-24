---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §4, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/0002_identity_users.sql, mobile/src/features/auth/context.tsx]
actualizado: 2026-06-24
---

# Roles y permisos

> Jerarquía simple de roles a nivel de usuario; la "inmobiliaria" es entidad organizacional, no rol.

## Modelo de datos (migración 0002)
- **`users`** — perfil espejo **1:1** de `auth.users`. `id`, `email` (citext), `role` (`user_role`: **user | agent | admin**), `agency_id` (denormalizado), `deleted_at` (soft-delete).
- **Trigger `handle_new_user`** (SECURITY DEFINER): al registrarse en `auth.users`, crea automáticamente la fila en `public.users` (role por defecto = `user`).

## Actores en la demo
- **admin** — equipo Urbea; da de alta inmobiliarias y owners (panel admin).
- **owner** / **agente** — se modelan vía `agency_members` ([[inmobiliarias-y-agentes]]), no como roles de `users`.
- (Sin rol "buscador/usuario final" público: en la demo los agentes consumen el feed.)

## Reglas / gotchas
- 🔒 **Anti-escalación:** grants **column-level** impiden que el cliente modifique `users.role` o `users.agency_id`. El cambio de rol es **server-side** (Edge Function / admin). Ver [[rls-seguridad]].
- El rol determina visibilidad vía helpers RLS (`current_user_role`, `is_admin`).

## En el código
- Backend: `0002_identity_users.sql`. App: `mobile/src/features/auth/` (**Auth vivo, tarea #2**), `admin/` (pendiente).
- **Auth móvil (tarea #2):** `useAuth()` (`context.tsx`) carga el perfil de `public.users` por `id=auth.uid()` tras el login y lo expone como `user`; el `role` viene de ahí (read-only para el cliente por los column-grants). Login email/password (`signInWithPassword`); **solo login**, cuentas sembradas en la demo (sin signup). El canje de código de invitación que asigna `agency_id`/rol agente es **tarea #3** (server-side). Rutas protegidas vía `protected-layout.tsx`.

## Detalle exhaustivo
- `docs/PRD.md` §4 (jerarquía completa: visitante→registrado→premium→agente→admin, para fases futuras) · migración `0002` · [[db-schema-map]]

## Relacionados
[[inmobiliarias-y-agentes]] · [[rls-seguridad]] · [[onboarding-y-preferencias]] · [[legal-consentimientos]]
