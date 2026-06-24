# Base de datos — Urbea MVP (Supabase)

Esquema PostgreSQL/PostGIS para el MVP de Urbea (app inmobiliaria tipo TikTok para Guadalajara),
**incluyendo la gestión de cuentas de inmobiliarias que administran a sus agentes**.

- **Proyecto Supabase:** `urbea-app` · ref `mvpvqmyhrrkwbnpctpuq` · org `Dabratech` · región `us-west-2`
- **Stack:** Supabase (Postgres 17 + PostGIS) · video en Cloudflare Stream (solo se referencia) · RLS en todas las tablas
- **Alcance:** MVP recomendado (`propuesta-cliente/03-mvp-recomendado.md`) + inmobiliarias (esencial). **Sin** pagos, versionado, VOH, scoring de leads, comentarios, follows.
- **Fuente de verdad arquitectónica:** `../lineamientos-desarrollo.md` (RLS como 2ª capa, triggers solo atómicos, soft deletes, `events_raw`).

> Esta entrega cubre **esquema + migraciones + RLS + tests**. Las **Edge Functions** (lógica de negocio:
> validación de tokens, consumo atómico, creación de leads, notificaciones, moderación, eliminación de
> cuenta) y la **app React Native** son la siguiente fase; aquí queda la BD que las soporta.

---

## Estructura

```
supabase/
  migrations/            12 migraciones .sql versionadas (idempotentes)
    rollbacks/           un rollback por migración (lineamientos §12.3)
  tests/                 tests pgTAP (constraints + RLS)
  types/database.types.ts  tipos TypeScript generados (para la app)
  seed.sql               datos de arranque para desarrollo local
  config.toml            config de Supabase CLI
```

### Migraciones (orden de aplicación)

| Archivo | Contenido |
|--------|-----------|
| `..._0001_extensions_and_enums` | Extensiones (postgis, pg_trgm, citext) + 20 enums + `set_updated_at()` |
| `..._0002_identity_users` | `users` (espejo de `auth.users`) + trigger `handle_new_user` |
| `..._0003_agencies_and_agents` | `agencies`, `agency_invitation_tokens`, `agency_members`, `agent_applications`, `agent_interest_submissions` |
| `..._0004_user_profile_legal` | `user_preferences`, `terms_versions`, `user_consents`, `account_deletion_requests` |
| `..._0005_properties_and_videos` | `properties`, `property_videos` + triggers (máx 5 videos, cascada soft-delete) |
| `..._0006_engagement_crm` | `likes`, `saves`, `leads`, `lead_origin_properties` |
| `..._0007_analytics_moderation_audit` | `events_raw`, `property_reports`, `notifications`, `admin_actions` |
| `..._0008_rls_helpers_and_policies` | Habilita RLS + 65 políticas + grants |
| `..._0009_seed_terms` | Versión vigente inicial de Términos y Aviso de Privacidad |
| `..._0010_security_perf_hardening` | Mueve helpers a esquema `private`, optimiza RLS (`(select auth.uid())`), índices de FK, blinda triggers |
| `..._0011_storage_property_videos` | Bucket `property-videos` (Storage) + políticas RLS de Storage: INSERT solo para el agente dueño, SELECT público para propiedades activas. **Solo para la demo** (sin transcoding); el video en producción irá en Cloudflare Stream. |
| `..._0012_property_videos_ready_requires_storage` | CHECK constraint `property_videos_ready_requires_storage`: un video con `status='ready'` exige al menos uno de `storage_path` o `cloudflare_uid`. Los estados `uploading`, `processing` y `failed` no requieren referencia. Complementa la política de Storage de `0011`; no tiene relación con billing. |

---

## Modelo de datos (20 tablas)

**Identidad / legal:** `users` · `user_preferences` · `terms_versions` · `user_consents` · `account_deletion_requests`
**Inmobiliarias / agentes:** `agencies` · `agency_members` · `agency_invitation_tokens` · `agent_applications` · `agent_interest_submissions`
**Propiedades / video:** `properties` · `property_videos`
**Engagement / CRM:** `likes` · `saves` · `leads` · `lead_origin_properties`
**Analítica / moderación / auditoría:** `events_raw` · `property_reports` · `notifications` · `admin_actions`

### Roles
`users.role ∈ {user, agent, admin}`. La **inmobiliaria es una entidad organizacional**, no un rol.
Dentro de la inmobiliaria, `agency_members.member_role ∈ {owner, agent}` (el `owner` administra).

### Reglas clave (invariantes garantizadas en BD)
- **Un agente pertenece a lo más a 1 inmobiliaria activa** → índice único parcial `agency_members (user_id) where status='active'`.
- **Un lead por par (agente, usuario)** → único parcial `leads (agent_id, user_id) where deleted_at is null`.
- **Like único por (usuario, video)**, **save único por (usuario, propiedad)**, **un reporte por (propiedad, usuario)**.
- **Máx 5 videos por propiedad** (trigger atómico) y **una posición por propiedad** (único parcial).
- **`status='closed'` exige `closed_reason`**; **`lead.agent_id <> user_id`**; **`current_uses <= max_uses`** en tokens.
- **Dirección exacta obligatoria y pública** (`properties.address NOT NULL`) + ubicación PostGIS `geography(Point,4326)`.

### Estados de publicación (6 de ciclo + 1 de moderación)
`draft → pending_review → needs_changes → active → paused → closed` (+ `suspended` por moderación).
Simplificado de los 16 del PRD. `closed_reason ∈ {rented, sold, withdrawn, expired}`.

### Seguridad (RLS — 2ª capa; la autorización fina irá en Edge Functions)
- **Público (anon/authenticated):** solo `properties` con `status='active'` y sus `property_videos` `ready`.
- **Agente:** ve/edita sus propias propiedades (cualquier estado) y **solo sus leads**; el buscador **no** ve el lead.
- **Owner de inmobiliaria:** ve propiedades y leads de **sus agentes activos** (no de independientes).
- **Admin:** todo. **user:** solo lo propio.
- **`events_raw`** y **`admin_actions`**: solo `service_role` / append-only.
- **Helpers de RLS** viven en el esquema `private` (no expuesto por la API). **Anti-escalación de privilegios**:
  grants a nivel de columna impiden que el cliente cambie `users.role`, `agencies.status` o el contenido de `notifications`.

### Triggers (todos atómicos — lineamientos §9.1)
`set_updated_at` (updated_at) · `handle_new_user` (crea perfil al registrarse) ·
`enforce_max_videos_per_property` (máx 5) · `cascade_soft_delete_property_videos` (propaga soft-delete).
**No** hay triggers de negocio: contadores `*_count`, notificaciones, consumo de tokens, auto-suspensión y
la cascada de baja de cuenta van en **Edge Functions** (write-time / orquestación).

---

## Cómo trabajar

### Aplicar el esquema a un proyecto Supabase
Las migraciones ya están aplicadas a `urbea-app`. Para un entorno nuevo o local:

```bash
# Vincular el proyecto remoto (una vez)
supabase link --project-ref mvpvqmyhrrkwbnpctpuq

# Desarrollo local: levanta Postgres + aplica migraciones + corre seed.sql
supabase db reset

# Aplicar migraciones pendientes al remoto
supabase db push
```

> Las migraciones se aplicaron vía el MCP de Supabase (`apply_migration`), no por el dashboard. El
> historial remoto (`supabase_migrations.schema_migrations`) ya está reconciliado: cada `version`
> coincide con el prefijo del archivo, por lo que `supabase db push` las reconoce como aplicadas.

### Correr los tests
```bash
supabase test db        # corre supabase/tests/*.sql con pgTAP
```
Cobertura: `01_constraints_test.sql` (13 asserts de constraints/triggers/únicos) y
`02_rls_test.sql` (15 asserts de visibilidad RLS por rol). Para impersonación más robusta en CI se
recomienda instalar `supabase_test_helpers` (`tests.authenticate_as`).

### Regenerar tipos TypeScript
```bash
supabase gen types typescript --project-id mvpvqmyhrrkwbnpctpuq > supabase/types/database.types.ts
```

### Estado de los advisors (al cierre de esta entrega)
- **Seguridad:** sin WARN/ERROR. Único INFO: `rls_enabled_no_policy` en `events_raw` — **intencional**
  (tabla solo para `service_role`, sin políticas por diseño).
- **Performance:** solo INFO `unused_index` (esperado en BD vacía; los índices se usarán con tráfico real).

---

## Riesgos / notas abiertas
- **`users.agency_id` es denormalización**; la verdad de la membresía es `agency_members`. Mantener
  sincronizado en write-time desde la Edge Function de alta/baja de agente; conviene un job de consistencia.
- **Contadores `*_count`** son denormalizados (write-time en Edge Functions) → posible drift; reconciliar por worker.
- **Múltiples `owner` por inmobiliaria** están permitidos. Si el negocio exige uno solo, agregar
  `unique (agency_id) where member_role='owner' and status='active'`.
- **Transiciones de estado** de `properties`/`leads` y la regla "no-admin no puede `suspended`" se gobiernan
  en la capa de Edge Functions (no en RLS/constraints).

## Dependencias de fases posteriores (NO en esta entrega)
Verificación de identidad INE+selfie (Storage + flujo) · push tokens FCM · pagos/créditos (Stripe) ·
versionado de publicaciones · auto-suspensión por reportes · purga programada (`pg_cron`/worker) ·
catálogo completo de notificaciones · comentarios · follows.
