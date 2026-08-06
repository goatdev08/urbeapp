---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §4, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/0003_agencies_and_agents.sql, supabase/migrations/0013_redeem_invitation_rpc.sql, supabase/migrations/0016_admin_create_agency_rpc.sql, supabase/functions/admin-create-agency/, supabase/functions/redeem-invitation/, supabase/functions/validate-invitation/, mobile/app/admin/, mobile/src/features/admin/, mobile/app/register.tsx, supabase/migrations/20260805000002_agency_member_role_values.sql, supabase/migrations/20260805000003_agency_role_matrix.sql, supabase/migrations/20260805000006_register_agency_rpc.sql, supabase/migrations/20260805000007_admin_approval_transitions.sql, supabase/migrations/20260805000008_agency_member_status_values.sql, supabase/migrations/20260805000009_switch_agency_and_suspension.sql, supabase/functions/register-agency/, supabase/functions/manage-agency-member/, mobile/app/(protected)/agency/register.tsx, mobile/app/(protected)/agency/members.tsx]
actualizado: 2026-08-05
---

# Inmobiliarias y agentes

> Una inmobiliaria agrupa agentes; el owner los invita con códigos. Es el modelo de cuentas central de la demo y su área más pesada.

## Modelo de datos (migración 0003)
- **`agencies`** — entidad organizacional (NO un rol). `name` (citext), `slug`, `status` (`agency_status`: pending_approval, approved, active, suspended, rejected), `created_by_user_id`, soft-delete.
- **`agency_members`** — relación agente↔inmobiliaria. `user_id`, `agency_id`, `member_role` (**owner | admin | agent | viewer**, 4 niveles desde #71.2), `status` (**active | removed | suspended**, `suspended` desde #71.6).
  - 🔒 **INVARIANTE:** máx **1 inmobiliaria activa por agente** → índice único parcial `(user_id) WHERE status='active'`.
  - **Matriz RLS 4 niveles (#71.2, 20260805000003):** helpers `private.agency_role_of(agency_id)` (rol ACTIVO del caller o NULL) y `private.can_manage_agency_member(agency_id, member_role)` (owner todo; **admin gestiona miembros y properties EXCEPTO la fila owner / promover a owner**; viewer solo SELECT). El owner de agencia ganó UPDATE sobre properties de sus agentes (gap real que cerró la matriz). ⚠️ política nueva scoped SOLO `authenticated` (no se tocó la policy anon existente — cuando #96 revoque EXECUTE a PUBLIC, una policy anon que use el helper rompería lecturas anónimas).
- **`agency_invitation_tokens`** — invitaciones. `token` (**HASH**, nunca en claro), `max_uses`, `current_uses`, `expires_at`, `revoked_at`.
  - 🔒 **CHECK** `current_uses ≤ max_uses`; el canje es **atómico** (agotado → 0 filas afectadas).
- `agent_applications` (independent | under_agency) — **VIVA desde #71.3** (estaba latente desde 0003; se reusó en vez de crear tabla nueva): el Camino B del upgrade a agente inserta aquí (`+reason`, 20260805000005); índice `agent_app_one_pending_per_user` ya existía. `agent_interest_submissions` sigue diferida.

## Flujo (demo)
1. **admin** da de alta `agency` + su **owner** (panel admin en la app). **(vivo, tarea #7)**: panel `mobile/app/admin/` (guard `role=admin` → `mobile/src/features/admin/admin-layout.tsx`), lista de inmobiliarias, form de alta que invoca la Edge Function `admin-create-agency`, y pantalla de detalle `[id].tsx` que muestra el token + invite-link **una sola vez** y lista los miembros.
2. **owner** genera un token de invitación para su agente. *(El alta del owner en #7 ya genera su **token inicial** de invitación.)*
3. **agente** canjea el token al registrarse → se crea `agency_member` (role=agent) bajo esa inmobiliaria. **(vivo, tarea #5)**: pantalla `mobile/app/register.tsx` en 2 fases — `validate-invitation` previsualiza `agency_name`, luego `redeem-invitation` orquesta el alta y auto-login.

## Reglas / gotchas
- Un agente = una inmobiliaria activa; cambiar implica dar de baja la anterior (`status='removed'`).
- El token vive **hasheado** (sha256) en BD; el canje es una **Edge Function** que delega la atomicidad a la RPC `redeem_invitation_atomic` (0013, `SECURITY DEFINER`): consumo de token + `agency_members` + denorm `users` + 4 `user_consents` en una transacción. Errores de negocio = `raise P0001` mapeados a HTTP. La creación de `auth.users` queda fuera de esa tx → **compensación** `deleteUser` si la RPC falla. Ver [[rls-seguridad]].
- `owner` puede ver propiedades/leads de los agentes **activos** de su inmobiliaria (no de independientes).
- **Alta de inmobiliaria + owner (Edge Function `admin-create-agency`, tarea #7)**: mismo patrón que el canje — la atomicidad SQL vive en la RPC **`admin_create_agency_atomic`** (0016, `SECURITY DEFINER`, **una sola firma de 9 params con DEFAULTs**): INSERT `agencies` (status `active`) + INSERT `agency_members` (member_role `owner`) + UPDATE `users` (role `agent`, agency_id) + INSERT `agency_invitation_tokens` (token **hasheado**, el plano se retorna 1 vez) + INSERT `admin_actions` (auditoría). El **owner se crea por invitación** (`auth.admin.generateLink({type:'invite'})`, sin password, devuelve `action_link`), fuera de la tx → **compensación** `deleteUser` si la RPC falla. La verificación de `role=admin` del caller usa su JWT (`auth.getUser` → `users.role`) → 403 si no admin. 🔒 **Gotcha:** el INSERT de member respeta el índice `agency_members_one_active_per_user` y levanta `P0001 ALREADY_ACTIVE_MEMBER` — **no** usar `ON CONFLICT DO NOTHING** (silenciaría el invariante).

## Ola 1 — multi-tenant completo (#71, 2026-08-05)
- **Registro self-service de inmobiliaria (#71.4):** EF `register-agency` (caller = prospecto autenticado) → RPC **`register_agency_atomic`** (20260805000006, solo service_role): agencia nace `pending_approval`, contact_* OBLIGATORIOS (`P0001 FIELDS_INCOMPLETE`), **SIN membresía ni promoción de rol** (eso llega con la aprobación). Flujo INVERSO a `admin-create-agency` (que crea active+owner de una) — por eso NO se extendió. Mobile: `agency/register.tsx` (logo diferido con `ponytail:` — sin uploader reutilizable aún).
- **Aprobaciones por estado (#71.5, beta SIN EFs approve/reject):** el super-admin hace UPDATE en Studio; **triggers BEFORE UPDATE** (20260805000007) validan la máquina de estados (`agencies`: {pending_approval→active|rejected}; `agent_applications`: {pending→approved|rejected}, `rejection_reason` obligatorio, finales inmutables) y auditan en **`admin_actions`** (0007, activada; REVOKE UPDATE/DELETE = inmutable). Aprobar agencia = crear membresía owner + promover rol + `users.agency_id`. Actor de auditoría: `coalesce(auth.uid(), GUC urbea.admin_actor_id)` — JWT SIEMPRE gana (anti-suplantación, test ancla). 🔒 los column-grants de 0008 ya impiden que incluso un admin vía JWT toque `agencies.status` → Studio es la única ruta para agencias; para applications el camino admin-JWT sí opera.
- **Gestión de miembros (#71.6):** EF `manage-agency-member` (`suspend|reactivate|remove`; owner/admin de agencia, **404 anti-IDOR** para miembros ajenos, `CANNOT_MANAGE_OWNER`; lógica en `member_manager.ts` CON tests unitarios propios). RPC **`switch_agency_atomic`** (cambio de agencia atómico: desactiva la vieja ANTES de activar la nueva — el orden es load-bearing para el índice único). **Suspensión bloquea publicar**: `properties_insert` ahora exige `agency_id is null OR agency_role_of(agency_id) is not null` (independiente sigue publicando). Followers al cambiar de agencia → diferido a #78 (tabla follows no existe). Mobile: `agency/members.tsx` (lista vía RLS `members_select`, sin EF de listado). ⚠️ Abierto en #98: un owner puede remove-arse/switch-ear dejando la agencia sin owner activo (decisión de producto pendiente).

## En el código
- Backend: `0003_agencies_and_agents.sql` + RPC `0013_redeem_invitation_rpc.sql`. Edge Functions `validate-invitation/` y `redeem-invitation/` (**vivas**) → [[mapa-codebase]]. App: `mobile/app/register.tsx` + `mobile/src/features/registration/` (validation, registration-errors, api); **panel admin (vivo, #7)** `mobile/app/admin/` (`_layout.tsx` guard, `index.tsx` lista, `agencies/create.tsx` form, `agencies/[id].tsx` detalle+token) + `mobile/src/features/admin/admin-layout.tsx`. Backend `supabase/functions/admin-create-agency/` + RPC `0016`.

## Detalle exhaustivo
- `docs/PRD.md` §4 · migración `0003` · [[db-schema-map]] · helpers RLS `manages_agency`/`is_agency_owner_of` en [[rls-seguridad]]

## Relacionados
[[roles-y-permisos]] · [[onboarding-y-preferencias]] · [[propiedades-y-video]] · [[crm-leads]] · [[rls-seguridad]] · [[0005-demo-cerrada-3-semanas]]
