---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §4, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/20260604000002_identity_users.sql, supabase/migrations/20260708000001_signup_default_buscador.sql, supabase/migrations/20260729000001_register_user_atomic_rpc.sql, supabase/functions/register/, mobile/app/register.tsx, mobile/src/features/auth/context.tsx, mobile/src/features/auth/api.ts]
actualizado: 2026-07-30
---

# Roles y permisos

> Jerarquía simple de roles a nivel de usuario; la "inmobiliaria" es entidad organizacional, no rol.

## Modelo de datos (migración 0002)
- **`users`** — perfil espejo **1:1** de `auth.users`. `id`, `email` (citext), `role` (`user_role`: **user | agent | admin**), `agency_id` (denormalizado), `deleted_at` (soft-delete).
- **Trigger `handle_new_user`** (SECURITY DEFINER): al registrarse en `auth.users`, crea automáticamente la fila espejo en `public.users`. **Delega al default de columna `role='user'`** (el INSERT no lista `role`) → todo registro libre nace **buscador**. La subida a `agent` es exclusiva de `redeem_invitation_atomic`.

## Registro (dos flujos → dos roles)
`mobile/app/register.tsx` tiene dos modos:
- **Modo `user` (registro libre):** desde #93 (2026-07-30) ya NO llama `supabase.auth.signUp` directo — pasa por la **EF pública `register`** (`register_user`, `mobile/src/features/auth/api.ts`): `authAdmin.createUser` (API admin, con la metadata que lee `handle_new_user`) → RPC `register_user_atomic` (atómica, inserta los 4 consentimientos y valida que el perfil no quedó incompleto) → `200 {user_id}` → el cliente hace `signIn(email,password)`. Trigger `handle_new_user` sigue poniendo `role='user'` (buscador: explora, guarda favoritos, contacta agentes; **no** publica — el FAB del feed, la RLS `properties_insert` y la EF `publish-property` exigen `agent|admin`). El cambio es de **transporte** (EF en vez de `/auth/v1/signup` directo con la anon key) — cierra el hueco de cuenta incompleta + fuga de errores crudos de Postgres a `anon` documentado en #93; el rol resultante no cambió. Ver [[legal-consentimientos]] para el detalle del hueco cerrado.
- **Modo `agent` (código de invitación):** valida/canjea el código → `redeem_invitation_atomic` sube a `role='agent'` + `agency_id` **explícitos** → `/onboarding`. Alta de agente = SOLO por invitación de un owner. Mismo patrón atómico que #93 tomó como espejo para el registro libre.
- ⚠️ **Linaje del default:** `0002` sembró `role='user'` default. `20260707000001_signup_default_agent` (regresión del flash de demo, PR #15) forzó `role='agent'` para TODO registro. **`20260708000001_signup_default_buscador` (tarea #50) revierte** a la delegación al default. `pg_get_functiondef(handle_new_user)` ya no contiene `'agent'`. Verificado por pgTAP `supabase/tests/10_signup_default_role_test.sql` (signup→user + no-regresión invitación→agent).
- ⚠️ **`/auth/v1/signup` público cerrado a `anon`** (#93.4): `[auth] enable_signup=false` en `supabase/config.toml`, local verificado (`422 signup_disabled`), remoto pendiente del runbook de deploy (bitácora de 93.4). Ni el registro libre (EF `register`, API admin) ni `redeem_invitation_atomic` (también API admin) pasan por `/signup`, así que no se ven afectados.

## Actores en la demo
- **admin** — equipo Urbea; da de alta inmobiliarias y owners (panel admin).
- **owner** / **agente** — se modelan vía `agency_members` ([[inmobiliarias-y-agentes]]); `users.role` es `'agent'` incluso para owners (el rol de agencia vive en `agency_members.member_role`).
- **buscador** (`role='user'`) — usuario final público que llega por registro libre; consume el feed y contacta agentes.

## Reglas / gotchas
- 🔒 **Anti-escalación:** grants **column-level** impiden que el cliente modifique `users.role` o `users.agency_id`. El cambio de rol es **server-side** (Edge Function / admin). Ver [[rls-seguridad]].
- El rol determina visibilidad vía helpers RLS (`current_user_role`, `is_admin`).

## En el código
- Backend: `0002_identity_users.sql`. App: `mobile/src/features/auth/` (**Auth vivo, tarea #2**), `admin/` (pendiente).
- **Auth móvil (tarea #2):** `useAuth()` (`context.tsx`) carga el perfil de `public.users` por `id=auth.uid()` tras el login y lo expone como `user`; el `role` viene de ahí (read-only para el cliente por los column-grants). Login email/password (`signInWithPassword`). Rutas protegidas vía `protected-layout.tsx`.
- **Registro (`app/register.tsx`, #15/#20/#50/#93):** dos modos (ver "Registro" arriba) — libre→buscador (vía EF `register`, ya no `auth.signUp` directo), código→agente. El default de rol lo pone el trigger `handle_new_user`, no el cliente.

## Detalle exhaustivo
- `docs/PRD.md` §4 (jerarquía completa: visitante→registrado→premium→agente→admin, para fases futuras) · migración `0002` · [[db-schema-map]]

## Relacionados
[[inmobiliarias-y-agentes]] · [[rls-seguridad]] · [[onboarding-y-preferencias]] · [[legal-consentimientos]]
