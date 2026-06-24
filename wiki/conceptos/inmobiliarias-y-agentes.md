---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §4, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/0003_agencies_and_agents.sql, supabase/migrations/0013_redeem_invitation_rpc.sql, supabase/functions/redeem-invitation/, supabase/functions/validate-invitation/, mobile/app/register.tsx]
actualizado: 2026-06-24
---

# Inmobiliarias y agentes

> Una inmobiliaria agrupa agentes; el owner los invita con códigos. Es el modelo de cuentas central de la demo y su área más pesada.

## Modelo de datos (migración 0003)
- **`agencies`** — entidad organizacional (NO un rol). `name` (citext), `slug`, `status` (`agency_status`: pending_approval, approved, active, suspended, rejected), `created_by_user_id`, soft-delete.
- **`agency_members`** — relación agente↔inmobiliaria. `user_id`, `agency_id`, `member_role` (owner | agent), `status` (active | removed).
  - 🔒 **INVARIANTE:** máx **1 inmobiliaria activa por agente** → índice único parcial `(user_id) WHERE status='active'`.
- **`agency_invitation_tokens`** — invitaciones. `token` (**HASH**, nunca en claro), `max_uses`, `current_uses`, `expires_at`, `revoked_at`.
  - 🔒 **CHECK** `current_uses ≤ max_uses`; el canje es **atómico** (agotado → 0 filas afectadas).
- `agent_applications` (independent | under_agency) y `agent_interest_submissions` (landing | app) → **diferido** en la demo.

## Flujo (demo)
1. **admin** da de alta `agency` + su **owner** (panel admin en la app).
2. **owner** genera un token de invitación para su agente.
3. **agente** canjea el token al registrarse → se crea `agency_member` (role=agent) bajo esa inmobiliaria. **(vivo, tarea #5)**: pantalla `mobile/app/register.tsx` en 2 fases — `validate-invitation` previsualiza `agency_name`, luego `redeem-invitation` orquesta el alta y auto-login.

## Reglas / gotchas
- Un agente = una inmobiliaria activa; cambiar implica dar de baja la anterior (`status='removed'`).
- El token vive **hasheado** (sha256) en BD; el canje es una **Edge Function** que delega la atomicidad a la RPC `redeem_invitation_atomic` (0013, `SECURITY DEFINER`): consumo de token + `agency_members` + denorm `users` + 4 `user_consents` en una transacción. Errores de negocio = `raise P0001` mapeados a HTTP. La creación de `auth.users` queda fuera de esa tx → **compensación** `deleteUser` si la RPC falla. Ver [[rls-seguridad]].
- `owner` puede ver propiedades/leads de los agentes **activos** de su inmobiliaria (no de independientes).

## En el código
- Backend: `0003_agencies_and_agents.sql` + RPC `0013_redeem_invitation_rpc.sql`. Edge Functions `validate-invitation/` y `redeem-invitation/` (**vivas**) → [[mapa-codebase]]. App: `mobile/app/register.tsx` + `mobile/src/features/registration/` (validation, registration-errors, api); `admin/` (alta de inmobiliarias, pendiente).

## Detalle exhaustivo
- `docs/PRD.md` §4 · migración `0003` · [[db-schema-map]] · helpers RLS `manages_agency`/`is_agency_owner_of` en [[rls-seguridad]]

## Relacionados
[[roles-y-permisos]] · [[onboarding-y-preferencias]] · [[propiedades-y-video]] · [[crm-leads]] · [[rls-seguridad]] · [[0005-demo-cerrada-3-semanas]]
