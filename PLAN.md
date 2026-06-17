# Plan — Urbea: fundación de desarrollo + memoria de proyecto en Obsidian

> Plan a refinar por Ultraplan. Basado en el análisis del codebase existente
> (`docs/`, `supabase/`). Ver fuentes citadas en cada sección.

## Contexto

Urbea es una plataforma inmobiliaria móvil (React Native + Expo) con feed vertical de video
tipo TikTok, mapa, búsqueda, CRM básico de agentes y panel admin web, más entidad
"inmobiliaria" que agrupa agentes. La documentación de producto/negocio está madura
(`docs/`) y la base de datos Supabase ya está migrada y endurecida (20 tablas, RLS, tests
pgTAP; migraciones `0001`–`0010` aplicadas al proyecto live `urbea-app`, ref
`mvpvqmyhrrkwbnpctpuq`).

El usuario quiere por fin **empezar a desarrollar** con dos restricciones y un entregable nuevo:

1. **Alcance** = el "MVP recomendado" (`docs/propuesta-cliente/03-mvp-recomendado.md`).
2. **Monetización** = la **original del PRD §17**: *pago por video / créditos*, NO el modelo
   híbrido de suscripción que sugería el análisis de mercado. Planes: Premium $399 MXN/mes
   (1 video), Agente 3m $1,197, Agente 6m $1,194; crédito caduca a 90 días; Stripe post-beta.
   El PRD §17.7 ya define el modelo de datos: `purchase` + `video_slot` + enlace a `property_video`.
3. **Memoria del proyecto en Obsidian** (estilo "LLM Knowledge Base" de Karpathy): un vault de
   `.md` con backlinks que funcione como **red/grafo** para encontrar conexiones con el codebase
   sin recurrir a `grep`, que documente el proyecto y la toma de decisiones, y se actualice de
   forma continua para dar **continuidad de contexto entre sesiones**.

### Veredicto de base de datos para la monetización

**La DB NO está preparada para la monetización.** El MVP excluye explícitamente pagos/créditos
(`supabase/README.md` líneas 8 y 137). No existe ninguna tabla de `purchase`, `video_slot`,
catálogo de planes/precios, ni idempotencia de webhooks de Stripe. Todo lo demás (identidad,
agencias/agentes, propiedades/video, engagement, CRM básico, moderación, auditoría) **sí
soporta** el MVP recomendado. → Se diseña la migración `0011` (sin aplicar al remoto).

### Decisiones tomadas con el usuario
- Vault Obsidian dentro del repo (`wiki/`); `docs/` queda como fuentes "raw". Versionado en git.
- Esta sesión = **fundación completa**: vault + migración `0011` + scaffolding.
- Migración `0011` = diseñar `.sql` (+rollback +tests) **sin aplicar** al proyecto remoto (beta omite pagos).

---

## Parte 1 — Vault Obsidian `wiki/` (memoria/red del proyecto)

Modelo Karpathy: `docs/` = fuentes raw; `wiki/` = wiki compilada con artículos de conceptos,
backlinks `[[wikilink]]`, MOCs (Maps of Content) como índices, bitácora de decisiones y un
**mapa concepto→archivo del codebase** que es la pieza clave para navegar sin `grep`.

Estructura a crear:

```
wiki/
  README.md                      # cómo funciona el vault (para humanos y para el LLM)
  _index/
    00-MOC-home.md               # hub raíz: enlaza todo
    MOC-producto.md              # conceptos de producto
    MOC-arquitectura.md          # stack, lineamientos, capas
    MOC-datos.md                 # mapa de la DB (tabla → migración → concepto)
    MOC-negocio.md               # monetización, mercado, alcance
  conceptos/                     # notas atómicas backlinkeadas
    feed-vertical-video.md
    monetizacion-pago-por-video.md
    roles-y-permisos.md
    inmobiliarias-y-agentes.md
    propiedades-y-video.md
    crm-leads.md
    moderacion.md
    rls-seguridad.md
    onboarding-y-preferencias.md
    legal-consentimientos.md
  codebase/
    mapa-codebase.md             # PIEZA CLAVE: dominio/concepto → archivos exactos
    db-schema-map.md             # cada tabla → archivo de migración → artículo de concepto
  decisiones/                    # ADRs (bitácora de toma de decisiones)
    _template-decision.md
    0001-alcance-mvp-recomendado.md
    0002-monetizacion-pago-por-video.md
    0003-vault-obsidian-como-memoria.md
  estado/
    estado-actual.md             # "dónde estamos hoy" — se actualiza cada sesión
    roadmap.md                   # fases del desarrollo
    bitacora-sesiones.md         # log append-only de sesiones
  raw/
    INDEX.md                     # índice resumido de todos los docs en ../docs y ../supabase
```

Reglas del vault:
- Backlinks `[[nombre]]` (compatibles con el grafo de Obsidian) entre conceptos, decisiones y
  el mapa de codebase. Enlazar liberalmente.
- Cada artículo de `conceptos/` cita su fuente en `docs/` y enlaza a los archivos de código/migración
  relevantes (vía `codebase/mapa-codebase.md`).
- El LLM mantiene el vault; rara vez se edita a mano (filosofía Karpathy).

## Parte 2 — Continuidad entre sesiones

- Crear `CLAUDE.md` en la raíz que instruya a toda sesión nueva a leer primero
  `wiki/_index/00-MOC-home.md` y `wiki/estado/estado-actual.md`, y a actualizar
  `wiki/estado/estado-actual.md` + `wiki/estado/bitacora-sesiones.md` al cerrar trabajo.
- `estado-actual.md` es la fuente única de "qué está hecho / qué sigue".
- (Opcional, futuro) un hook `Stop` en `.claude/settings.json` para recordar la actualización del
  vault automáticamente — se ofrece más adelante, no en esta sesión.

## Parte 3 — Migración `0011` de monetización (diseño, sin aplicar)

Archivos nuevos siguiendo el patrón existente (idempotentes, con rollback y tests):
- `supabase/migrations/20260616000011_billing_credits.sql`
- `supabase/migrations/rollbacks/20260616000011_billing_credits.sql`
- ampliar `supabase/tests/01_constraints_test.sql` y `02_rls_test.sql` (o un test nuevo `03_billing_test.sql`)

Contenido (basado en PRD §17 y lineamientos):
- **Enums nuevos**: `purchase_status` (pending, completed, failed, refunded, cancelled);
  `payment_method` (card, apple_pay, google_pay, oxxo, spei); `video_slot_status`
  (available, consumed, expired). Añadir `expired` a `property_video_status` (PRD §17.6).
- **`plans`** — catálogo de precios configurable (PRD §17.2: "precios en tabla, no en código"):
  `code`, `audience` (premium|agent), `duration_months`, `price_mxn`, `is_active`. Seed:
  premium-1m=$399, agent-3m=$1197, agent-6m=$1194.
- **`purchases`** — pago/crédito (PRD §17.7): `user_id`, `plan_id`, `amount_mxn` (snapshot de
  precio histórico), `payment_method`, `status`, `stripe_payment_intent_id`, timestamps.
- **`video_slots`** — derecho a publicar (PRD §17.7): `purchase_id`, `user_id`, `duration_months`,
  `credit_expires_at` (=compra+90d), `status`, `property_video_id` (nullable, se fija al consumir),
  `active_period_start`/`active_period_end`. Constraint: `credit_expires_at = purchase + 90d`.
- **Alter `property_videos`**: añadir `video_slot_id uuid references video_slots` (nullable; en beta
  los slots pueden otorgarse sin `purchase`).
- **`stripe_events`** — idempotencia de webhooks (lineamientos: `external_events_received`):
  `event_id` unique, `type`, `payload jsonb`, `received_at`, `processed_at`.
- **RLS**: usuario ve solo sus `purchases`/`video_slots`; admin todo; `plans` legible por
  authenticated; `stripe_events` solo `service_role`. Reusar helpers de `private.*` y el patrón
  idempotente `drop policy if exists … ; create policy …` de la migración `0008`/`0010`.
- **Comentarios SQL** y índices de FK como en el resto del esquema.
- Nota: en beta los pagos se omiten; estas tablas quedan **presentes pero latentes** ("infra
  preparada para activar post-beta", PRD §17.1/§17.7). El **consumo atómico de slots** y la
  integración Stripe son Edge Functions (fase siguiente), no triggers.

## Parte 4 — Scaffolding de desarrollo (fundación de código)

Siguiendo `docs/lineamientos-desarrollo.md` (TS strict, ESLint, Prettier, estructura por feature):
- **`git init`** + `.gitignore` (node_modules, `.expo`, `.env*`, `.DS_Store`, builds). **(YA HECHO:
  repo en `main`, remoto `goatdev08/urbeapp`.)**
- **App móvil** `mobile/` (Expo + TypeScript strict, Expo Router):
  `src/features/{feed,auth,search,map,publish,profile,leads}`, `src/lib/supabase/`,
  `src/components/`, `src/theme/`. Cliente Supabase tipado con `supabase/types/database.types.ts`.
- **Edge Functions** `supabase/functions/`: `_shared/` (auth, validación, respuestas, logging con
  `correlation_id`) + una carpeta por dominio (`auth`, `properties`, `leads`, `billing`,
  `moderation`, `notifications`, `account`) con patrón Service Layer
  (validación → autorización → lógica → persistencia). Solo estructura + stubs en esta sesión.
- **Tooling raíz**: `tsconfig` base strict, ESLint + Prettier compartidos.
- **Admin web (Next.js)** y **landing (Astro)** quedan para una fase posterior (el README sitúa
  app + Edge Functions como la fase inmediata tras la DB).
- Refrescar tipos TS desde la DB cuando aplique (`supabase gen types`).

---

## Archivos críticos
- Lectura/fuente: `docs/PRD.md` (§4 roles, §17 monetización), `docs/propuesta-cliente/03-mvp-recomendado.md`,
  `docs/lineamientos-desarrollo.md`, `supabase/README.md`, `supabase/migrations/0008`/`0010` (patrón RLS).
- Creación: todo `wiki/`, `CLAUDE.md`, `supabase/migrations/...0011_billing_credits.sql` (+rollback +tests),
  scaffolding en `mobile/` y `supabase/functions/`, configs de tooling.

## Verificación
- **Vault**: abrir `wiki/` en Obsidian y confirmar que el grafo conecta conceptos↔decisiones↔codebase;
  validar que `wiki/codebase/mapa-codebase.md` resuelve "concepto → archivo" sin `grep`. Revisar que
  no haya `[[enlaces]]` rotos a notas existentes.
- **Migración 0011 (sin aplicar)**: validar sintáctica/localmente con `supabase db reset` en entorno
  local (no al remoto) y correr `supabase test db` (pgTAP) con los nuevos asserts de constraints y RLS.
  Confirmar que `supabase/README.md` describe la nueva fase de billing.
- **Scaffolding**: `mobile/` arranca (`expo start` compila), `tsc --noEmit` sin errores, ESLint/Prettier
  pasan; `supabase/functions/_shared` importa sin errores de tipos.
- **Continuidad**: confirmar que `CLAUDE.md` apunta a `wiki/estado/estado-actual.md` y que éste refleja
  el estado tras esta sesión.

## Notas / riesgos
- No se aplica `0011` al proyecto remoto `urbea-app` (decisión del usuario); solo diseño versionado.
- `docs/por-definir.md` aún tiene decisiones de producto abiertas; se registrarán como ADRs "pendientes"
  en `wiki/decisiones/` a medida que se resuelvan, sin bloquear la fundación.
