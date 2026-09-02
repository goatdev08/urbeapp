---
tipo: feature        # producto — segundo eje de suspensión
nivel: L             # toca migración + helper + ~15 puntos de escritura + EF + RPC + UI admin + catálogos de error
fecha: 2026-09-01
estado: borrador
tarea_id: 204        # la tarea YA existe; esta exploración es su desambiguación previa (testStrategy de #204 lo pide explícito)
motivo_descarte:
---

# Suspensión de PLATAFORMA — el admin puede suspender cualquier cuenta, incluida la del agente independiente

> Documento de exploración/planeación de `/tm-explore`. Un archivo por idea.
> Puede **APROBARSE** (→ se promueve a tarea[s] en Taskmaster) o **DESCARTARSE**
> (queda en el repo como registro de decisión, sin crear tarea).
> NO edita los PRD maestros; "Impacto en PRD" es solo referencia.
>
> ⚠️ **Esta exploración NO sustituye a la tarea #204: la desambigua.** #204 ya existe con
> `testStrategy` que dice literalmente *«Empezar por /tm-explore: las preguntas abiertas de
> details cambian el diseño, no solo la implementación»*. Al aprobarse, este doc se promueve
> como **plan de #204** (`/tm-plan 204`), no como tarea nueva.

## Idea original

De `task-master show 204` (derivada de #202, decisión de Abraham 2026-08-21):

> La suspensión que existe hoy es de MEMBRESÍA (`agency_members.status`, la ejerce el
> owner/admin de la inmobiliaria sobre los suyos). El agente INDEPENDIENTE no tiene quién lo
> suspenda: no pertenece a ninguna organización. 🔴 `public.users` NO tiene ninguna columna de
> estado — solo `deleted_at` y `deletion_pending_at`. **No es extender algo: es estrenarlo.**
> El admin de plataforma debe poder suspender CUALQUIER cuenta.

Definición de producto heredada de #202 (aplica a toda la plataforma):

> «Suspender congela la capacidad de ACTUAR en nombre de la agencia. Conserva la lectura de lo
> propio. Y lo que quedó vivo pasa al control de la agencia.»

El tercer tercio de esa frase es exactamente el que **no tiene respuesta** para el agente
independiente: no hay agencia a la que pase el control. Ese hueco es el corazón de esta
exploración (→ pregunta abierta **Q1**).

---

## Diagnóstico del estado actual (verificado en el código, 2026-09-01)

### 1. `public.users` no tiene estado — y el estado que sí declara está muerto

`supabase/migrations/20260604000002_identity_users.sql:6-26`:

```
role                user_role not null default 'user',
...
deleted_at          timestamptz,           -- línea 23
deletion_pending_at timestamptz,           -- línea 24
```

🔴 **`deletion_pending_at` no tiene un solo escritor en todo el repo.** Aparece únicamente en:
la definición de la tabla, el grant de columna (`20260604000008:406`), los tipos generados
(`supabase/types/database.types.ts:1792/1814/1836`) y un fixture de test
(`mobile/src/features/auth/__tests__/context.test.tsx:109`). Es una **columna declarada y
dormida**, exactamente como lo eran `property_reports` antes de #220 y los valores
`deleted_soft`/`deleted_hard` del enum de propiedades hoy. Cualquier diseño que la trate como
un estado vivo está asumiendo algo que no existe.

`deleted_at` sí está vivo: lo consumen los helpers (`private.current_user_role`,
`20260604000010:19`), los índices parciales (`users_email_unique_active`, `users_role_idx`) y
el fan-out de notificaciones a admins (`20260827000002`).

### 2. Lo que ya nos protege gratis (no hay que construirlo)

- 🔒 **Grants column-level** (`20260604000008:402-407`): `revoke update on public.users from
  authenticated` + `grant update (first_name, last_name, phone, bio, avatar_url, city, state,
  date_of_birth, last_login_at, deleted_at, deletion_pending_at)`. **Una columna nueva NO entra
  en ese grant, así que nace no-escribible por el cliente sin hacer nada.** Es el mismo blindaje
  que tiene `agencies.status` y por el que existe `set_agency_status_atomic`.
- **El perfil llega solo al cliente**: `mobile/src/features/auth/context.tsx:58-61` hace
  `.from('users').select('*')` y tipa el resultado como
  `Database['public']['Tables']['users']['Row']` (línea 26). Una columna aditiva **viaja al
  cliente sin cambiar ningún contrato** — los builds instalados la ignoran, el build nuevo la
  lee. Es la palanca que hace barata la ola OTA-primero.
- **`admin_actions`** (`20260604000007:78-96`): `admin_id`, `action_type`, `entity_type`,
  `entity_id`, `old_values`, `new_values`, `reason`, `ip_address`. Append-only, solo
  `service_role`, retención permanente. **`entity_type`/`action_type` son `text`, no enums** →
  auditar `entity_type='user'` es aditivo puro, sin migración de enum.

### 3. Los ≥3 sitios donde hoy se verifica la suspensión de MEMBRESÍA (y por qué duelen)

| # | Sitio | Ruta real | Forma |
|---|---|---|---|
| 1 | Policies RLS | `private.agency_role_of(uuid)` — `20260805000003:15-22` | filtra `status='active'`; devuelve NULL si no es miembro activo |
| 2 | RPC de publicación | `publish_property_atomic` — última definición `20260816000002:94` (antes `20260815000004:87`, `20260809000006:93`, `20260809000005:121`, `20260805000011:123`) | `raise exception 'AGENCY_MEMBERSHIP_SUSPENDED' using errcode='P0001'` |
| 3 | Resolver de la EF | `supabase/functions/edit-property/handler.ts:281-291` (`agencyRoleResolver.resolve`) | solo se consulta **si `is_owner` es falso** → el bypass que arregla #202 |

Los tres son **formas distintas de la misma pregunta**. La migración `20260816000002` es la
5ª reescritura del cuerpo de `publish_property_atomic` que arrastra ese `raise` copiado a mano:
la evidencia empírica de que un guard replicado se replica mal.

### 4. 🔴 Hallazgo que dimensiona el cableado: **no existe un verificador de caller compartido**

`supabase/functions/_shared/` tiene `admin_auth.ts` (`AdminVerifier`, para las EFs de admin)
pero **no tiene un `CallerVerifier` compartido**. Cada EF declara su propia interfaz en su
`types.ts` y la implementa **inline en su `index.ts`**:

- **18 EFs** definen su propio `verify_caller`: `archive-video`, `contact-agent`,
  `create-invitation`, `edit-property`, `manage-agency-member`, `mint-ad-upload-url`,
  `mint-ad-urls`, `mint-poster-urls`, `mint-r2-url`, `mint-thumbnail-url`, `mint-upload-url`,
  `publish-property`, `record-ad-impressions`, `register-agency`, `request-agent-upgrade`,
  `update-lead-note`, `update-lead-status`, `update-property-status`, `upgrade-to-agent`.
- Solo **4** consultan `public.users` (`edit-property/index.ts:52-59`, `publish-property`,
  `archive-video`, `request-agent-upgrade`); las demás se quedan en `auth.getUser(jwt)`.

**Consecuencia directa para el diseño:** el «único punto de estrangulamiento» que pide #204 en
la capa de Edge Functions **no existe todavía; hay que construirlo**. Si el gate se implementa
copiando 3 líneas en cada `index.ts`, se olvidará uno — es literalmente el modo de falla que la
tarea quiere evitar (ver §Arquitectura, `_shared/account_gate.ts` + test de guardia).

### 5. Las EFs escriben con `service_role` → la RLS **no** las detiene

`edit-property/index.ts` construye sus adaptadores sobre el `service_client()` de
`_shared/clients.ts`. Una policy nueva con `AND private.account_is_active(...)` es
**2ª capa real** para PostgREST directo (que sí existe: `property_reports` se inserta directo
desde el cliente desde #220, y `users_update`/`user_prefs_update` también), pero **no cubre**
lo que pasa por una EF con `service_role` ni por una RPC `SECURITY DEFINER`. Por eso el helper
tiene que componerse en **tres anillos**, no en uno.

### 6. Patrón vivo a calcar para el acto de admin (reusar > reescribir)

- **RPC** `public.set_agency_status_atomic(p_agency_id, p_next_status, p_admin_id)` —
  `supabase/migrations/20260823000003_suspend_agency_admin.sql:49-84`. Su cabecera documenta el
  problema exacto que también tendrá #204: *«Una Edge Function con `service_role` NO tiene
  `auth.uid()`»* → instala `p_admin_id` en el GUC `urbea.admin_actor_id` con
  `set_config(..., true)` (transacción-local), hace **un** UPDATE y devuelve `row_count` para
  distinguir 404 (0 filas) de 409 (excepción del trigger). 🔒 solo `service_role`, `SECURITY
  DEFINER` con `search_path` fijo.
- **RPC alterna** `public.set_org_advertising_atomic` — `20260815000002`: `SELECT … FOR UPDATE`
  (existe/no borrada → `P0001` explícito, nunca no-op silencioso) + UPDATE + `INSERT
  admin_actions` **en la misma invocación**; si la auditoría falla, todo revierte
  (fault-injection en pgTAP lo ancla).
- **EF** `supabase/functions/suspend-agency/` — `index.ts` delgado (12 líneas: construye
  `make_admin_verifier` + `make_agency_status_writer` e inyecta), lógica en `handler.ts` con
  suite DI. `types.ts` con contrato `action: 'suspend' | 'reactivate'`.
- **Hook** `mobile/src/features/admin/hooks/useSuspendAgency.ts` + catálogo
  `agency_status_error_messages.ts` — con las 3 reglas duras ya anotadas en su docblock (#200
  el mensaje sale del cuerpo, #205 no desprender `client.functions.invoke`, no doble-submit).

**Lectura:** el 70 % de #204 es **calcar `#211` sobre `users` en vez de `agencies`**. Lo
genuinamente nuevo son el helper compuesto, su cableado en los puntos de escritura, y la
decisión de producto sobre el inventario huérfano.

### 7. Qué NO existe en el panel admin

`mobile/app/admin/` tiene: `index.tsx` (home + colas), `ads/`, `agencies/[id].tsx`,
`agencies/create.tsx`, `reports/index.tsx`, `requests/index.tsx`, `revisions/index.tsx`.
**No hay pantalla de usuarios** — la «Gestión de usuarios» del PRD §28.3 punto 4 (búsqueda por
nombre/correo/teléfono + detalle + Suspender/Reactivar/Eliminar/Cambiar rol) no tiene una sola
línea. La exploración 041 (`:92`, `:155`) lo dejó anotado como *«continuación: gestión de
usuarios (§28.3-4, absorbería #204) — tarea futura»*. `user_reports` (#220.6) existe **sin cola
de resolución, a propósito y con asserts que custodian la ausencia** (`ABSENCE0-3` en
`supabase/tests/76_user_reports_test.sql`).

---

## Lluvia de ideas — 3 direcciones para `private.account_is_active(uuid)` y su cableado

### Dirección A — **[RECOMENDADA]** columna de estado + helper de 1 argumento, compuesto en 3 anillos

**En qué consiste.** `public.users` gana `account_status` (enum `account_status`:
`active | suspended`, `not null default 'active'`) + `suspended_at timestamptz`. El helper es
`private.account_is_active(p_user_id uuid) returns boolean`, `SECURITY DEFINER STABLE`,
`search_path` fijo, y **compone dentro de sí las dos verdades**:

```sql
select account_status = 'active' and deleted_at is null
  from public.users where id = p_user_id
```

(devuelve `false` si la fila no existe → fail-closed explícito, la lección de
`private.property_is_public(NULL)` en [[rls-seguridad]]).

🔴 **El argumento uuid es load-bearing, no cosmético.** Las RPC `SECURITY DEFINER` y las EFs
con `service_role` **no tienen `auth.uid()`** (la cabecera de `20260823000003` lo documenta como
el motivo de existir de esa RPC). Un helper que leyera `auth.uid()` por dentro sería inservible
justo donde más se necesita. Se puede añadir un overload de 0 argumentos
(`account_is_active() = account_is_active((select auth.uid()))`) como azúcar para las policies
— con `grant execute` solo a `authenticated`, y **revoke a PUBLIC** (deuda conocida #96).

Los tres anillos:
1. **RPC/SQL** — guard dentro de `publish_property_atomic` (junto al
   `AGENCY_MEMBERSHIP_SUSPENDED` que ya está ahí) y de cualquier RPC de escritura.
2. **Edge Functions** — `_shared/account_gate.ts` invocado tras el `verify_caller` de cada EF de
   escritura.
3. **RLS** — cláusula `and private.account_is_active(...)` en las policies de **escritura**
   (nunca en las de lectura: la regla 2 de #202 conserva la lectura de lo propio).

**Trade-off.** Es el más trabajo (3 anillos, ~15 puntos), pero es el único que sobrevive a las
tres rutas de escritura que hoy coexisten (PostgREST directo, RPC definer, EF service_role).
Encaja con el stack: helper `private.*` es el patrón establecido de 12 helpers; la composición
por AND en policies es exactamente cómo entró `agency_role_of`.

### Dirección B — helper único + gate SOLO en la frontera de Edge Functions

**En qué consiste.** Misma columna y helper, pero el cableado se limita a
`_shared/account_gate.ts` en las EFs. Ni policies ni RPCs.

**Trade-off.** Mucho más barato (1 archivo + 3 líneas por EF) y cubre el 90 % del tráfico real
de escritura hoy. Pero deja la 2ª capa sin dientes, contra el lineamiento explícito
(`CLAUDE.md §3`: *RLS = 2ª capa*), y **deja abiertas las rutas PostgREST directas que sí
existen**: `property_reports` INSERT directo (#220), `user_reports` INSERT directo (220.6),
`users_update`, `user_prefs_update`, `leads_update`. **Recomendación: es la fase 1 del
cableado de la Dirección A, no un destino.**

### Dirección C — ban a nivel GoTrue (`auth.admin.updateUserById(id, { ban_duration })`)

**En qué consiste.** No hay columna ni helper: se banea al usuario en Auth. Sin JWT válido,
`auth.getUser` falla en las 18 EFs y toda query RLS cae. **Es el único punto de
estrangulamiento verdaderamente único que existe.**

**Trade-off.** Rompe frontalmente la regla 2 de #202 (*«conserva la lectura de lo propio; una
cautelar que borra el acceso a tu propio trabajo es una sanción disfrazada»*) y produce un
fallo **ilegible**: el cliente ve sesión inválida → logout → no puede leer el motivo. Es
exactamente el bug que arregló #200. Verificado: `ban_duration`/`banned_until` **no se usan hoy
en ninguna parte del repo**.

**Recomendación: no como mecanismo primario.** Sí vale como **escalón 2 opcional
(«expulsar»)** para fraude flagrante, siempre encima del `account_status` (para que el motivo
quede registrado y el mensaje de la pantalla de login sea traducible). → pregunta **Q2**.

### Variante descartada — tabla `account_suspensions` (histórico con vigencia)

Una tabla append-only con actor, motivo y `until`. Más rica (suspensión temporal automática,
historial). Se descarta por ahora: **el historial ya existe** en `admin_actions` (append-only,
retención permanente, `entity_type` es `text`), y derivar «el estado de hoy» de un histórico
convierte el helper trivial en una consulta con `order by … limit 1` **en la ruta caliente de
cada escritura**. Reusar > reescribir. Se reconsidera si Q3 pide suspensión temporal con
vencimiento automático.

---

## Problema / Motivación

Hay **producción viva** (§0.5): personas reales publicando y contactando. Hoy la plataforma
**no tiene ninguna herramienta para congelar a una persona**. Si un agente independiente
comete fraude, el admin puede suspender su *propiedad* (`moderate-property` acción `suspend`,
#220) una por una, pero **no a la cuenta**: al minuto siguiente publica otra. El único botón
que existe (`suspend-agency`, #211) actúa sobre organizaciones, y un independiente no tiene.

Dicho al derecho: **`user_reports` (220.6) ya recolecta reportes de perfiles y no hay nada que
hacer con ellos.**

## Resultado esperado

1. Un admin abre el panel, encuentra a la persona, elige «Suspender», escribe/elige un motivo, y
   confirma.
2. La cuenta queda `suspended`: **no puede escribir nada** en la plataforma (publicar, editar,
   pausar, cerrar, subir video, crear campaña, gestionar miembros, invitar, contactar agentes),
   **tenga o no agencia**, y **sin la excepción «es mío»**.
3. La persona **sigue viendo lo suyo** y **entiende por qué**: mensaje legible en cada intento
   de escritura + estado visible en la app. Nunca un fallo mudo.
4. Los dos ejes se componen y **el peor caso manda**: activo en su agencia + suspendido por
   plataforma = bloqueado; suspendido en su agencia + activo en plataforma = bloqueado.
5. El acto queda **auditado en `admin_actions` en la misma transacción**, o no ocurre.
6. Reactivar devuelve exactamente el estado anterior, sin residuo.

## Alcance

- **SÍ entra:**
  - Columna de estado en `public.users` + enum + índice (aditivo, default `active`).
  - Helper `private.account_is_active(uuid)` (+ overload de 0 args para policies).
  - `_shared/account_gate.ts` + su **test de guardia** que enumera las EFs de escritura.
  - Cableado del helper en los puntos de escritura (lista en §Arquitectura).
  - RPC `set_account_status_atomic` + EF `suspend-account`, auditadas.
  - UI de admin mínima para ejercerla + catálogo de error nuevo + estado visible al suspendido.
  - Notificación al suspendido (según **Q4**).
- **NO entra (out of scope):**
  - La «Gestión de usuarios» completa del PRD §28.3.4 (historial completo, cambiar rol
    manualmente, eliminar cuenta). Solo suspender/reactivar + la búsqueda mínima para llegar.
  - La cola de resolución de `user_reports` (queda como derivada natural; hoy su ausencia está
    anclada por asserts en `76_user_reports_test.sql` — si se toca, se tocan esos asserts).
  - `deletion_pending_at` sigue **sin escritor**. Esta tarea no estrena la baja de cuenta; solo
    define cómo convive con la suspensión.
  - Push (FCM/APNs) — el centro de notificaciones sigue in-app (#219).
  - Ban de GoTrue, salvo que Q2 lo pida.

## Roles afectados

- **Admin de plataforma** — gana la capacidad; es el único actor.
- **Agente independiente** — 🔴 **el caso central, no el borde.** Es la razón de ser de #204.
- **Agente/owner con agencia** — gana un segundo eje encima del de membresía. Un owner
  suspendido por plataforma no puede gestionar su organización (→ **Q7**: ¿cascada a la
  organización? recomendación: no).
- **Owner/admin de agencia** — no gana ni pierde nada; sigue con su propio eje (#71.6).
- **Comprador/buscador (`role='user'`)** — alcanzado o no según **Q6**. Si sí: se le congela
  contactar agentes y reportar.
- **Comprador anónimo del feed** — solo lo nota si Q1 elige ocultar el inventario.

## Impacto en datos

Todo **aditivo, idempotente, con rollback y pgTAP** (§0.5: la DB remota tiene datos reales).

1. `create type public.account_status as enum ('active','suspended')` — 🔴 **migración sola**,
   por el gotcha `ALTER TYPE ADD VALUE` + uso en la misma transacción (precedente:
   `20260809000002`). Si se elige la matriz de 4 valores (**Q8**) esto cambia de forma.
2. `alter table public.users add column if not exists account_status public.account_status not
   null default 'active'` + `suspended_at timestamptz` (+ `suspension_reason`, según **Q3**).
   **Ningún usuario vivo cambia de comportamiento al desplegar.**
3. Índice parcial `users_suspended_idx on public.users (id) where account_status='suspended'`
   — la cardinalidad esperada es ~0; sirve al listado del panel, no al helper.
4. **NO tocar el grant de columna** (`20260604000008:403-405`): al no incluirla, el cliente
   nace sin poder escribirla. Verificarlo con un assert, no asumirlo.
5. Helper `private.account_is_active(uuid)`; `grant execute … to authenticated` (+ `service_role`
   explícito) y `revoke from public`.
6. RPC `public.set_account_status_atomic(p_user_id uuid, p_next_status text, p_admin_id uuid,
   p_reason text)` — `SECURITY DEFINER`, `search_path` fijo, 🔒 **solo `service_role`**,
   `SELECT … FOR UPDATE` (`USER_NOT_FOUND` explícito, nunca no-op), UPDATE + `INSERT
   admin_actions` en la misma invocación. `entity_type='user'`, `action_type='suspend_account'
   | 'reactivate_account'`, `old_values`/`new_values` = `{account_status}`, `reason`.
   ⚠️ **`admin_actions.admin_id` es NOT NULL** — el actor tiene que resolverse siempre
   (`private.resolve_admin_actor()` + GUC, patrón `20260823000003:74`).
7. Cláusula `and private.account_is_active(...)` en las policies de **escritura** (nunca de
   lectura).
8. Regenerar `supabase/types/database.types.ts` (el cliente lo consume vía
   `Database['public']['Tables']['users']['Row']`).
9. Si **Q1** elige ocultar inventario: o una columna reversible en `properties` estilo
   `ads.paused_by_suspension` (#211/169.2), o una cláusula en `properties_select` — decisiones
   con costos muy distintos, ver la pregunta.

## Impacto en UI

- **Admin**: pantalla nueva `mobile/app/admin/users/` (búsqueda mínima por nombre/correo +
  detalle con Suspender/Reactivar). Hook `useSuspendAccount` calcado de `useSuspendAgency.ts` +
  catálogo `account_status_error_messages.ts` calcado de `agency_status_error_messages.ts`.
  Punto de entrada: fila nueva en las «Colas» del home (`admin/index.tsx`) y/o acción desde el
  perfil reportado.
- **Suspendido**: banner/estado legible derivado de `users.account_status` (llega gratis por el
  `select('*')` de `context.tsx:61`) + entradas nuevas en los catálogos de error
  (`mobile/src/features/publish/publish_error_messages.ts` — **los dos mapas**, create y edit;
  `mobile/src/features/leads/lead_error_messages.ts`).
- ⚠️ **Branding: el gate está LEVANTADO** (CLAUDE.md §8, cliente 2026-06-26) — no bloquea. Pero
  §8 también dice que **cada pantalla del mockup es el techo de alcance de su tarea**, y
  `urbea-identidad-visual.html` **no tiene pantalla de gestión de usuarios**. La pantalla nueva
  se diseña con los tokens de `mobile/src/theme/theme.ts` calcando `/admin/reports`
  (`reports/index.tsx` es el estándar del repo: **0 hex sueltos**, contra 30 en `revisions/` y
  50 en `ads/`). Sin componentes de firma nuevos → sin preview aprobable.

## Reglas no obvias aplicables

- **RLS = 2ª capa, la lógica vive en Edge Functions; triggers solo atómicos** — [[rls-seguridad]]
  · `docs/lineamientos-desarrollo.md` · `CLAUDE.md §3`.
- **Acotar al DUEÑO, nunca a «membresía compartida»** (dos precedentes vivos, #100 y #103) —
  [[rls-seguridad]]. Aquí: el helper recibe el uuid del sujeto, jamás infiere por pertenencia.
- **Al dar visibilidad nueva se AMPLÍA SELECT, NUNCA la escritura** (#75.5) — su recíproca aquí:
  al restringir, se restringe **escritura**, nunca lectura de lo propio (regla 2 de #202).
- **Auditoría en la misma transacción o no ocurre** — [[panel-admin]] · `20260815000002` ·
  fault-injection pgTAP obligatorio.
- **`admin_actions.admin_id` es NOT NULL** — un acto sin actor humano no cabe ahí (por eso el
  trigger de auto-suspensión de #220 NO audita). Si alguna vez la suspensión se automatiza,
  necesita otro rastro.
- **Fail-closed ILEGIBLE es un bug** (#200) — todo `403` nuevo necesita su entrada en el
  catálogo del cliente antes de existir en el backend.
- **Orden OTA-primero** (§0.5 regla 2, precedente #116) — el cliente aprende el código, el
  backend endurece después.
- **`create or replace` de una función viva parte del cuerpo VIGENTE**, nunca del que asume el
  plan ([[inmobiliarias-y-agentes]], lección de `20260816000002` vs #167). Aplica literal a
  `publish_property_atomic`.
- **Un rollback debe fallar RUIDOSO** (lección 220.3) — el rollback del helper es `drop
  function`, para que quien lo llame reviente con 42883 en vez de degradar en silencio.
- **CHECK de «no vacío» = `~ '\S'` + `is not null` explícito** (#220) — si Q3 elige motivo
  obligatorio en texto libre, `trim()` de Postgres solo recorta ASCII y un CHECK que evalúa a
  NULL se considera CUMPLIDO.
- **`deep_link` de una notificación es un contrato con el Expo Router** (#223) — si Q4 pide
  aviso, la ruta destino debe existir en `mobile/app/` antes de escribir el assert.
- **No desprender `client.functions.invoke`** (#205) y **no doble-submit** (`useSuspendAgency`).

## Arquitectura / enfoque técnico

### El helper

```
private.account_is_active(p_user_id uuid) returns boolean    -- fuente de verdad, 1 argumento
private.account_is_active() returns boolean                  -- azúcar = account_is_active(auth.uid()), solo para policies
```

`SECURITY DEFINER STABLE`, `set search_path = public, pg_temp`, fail-closed si la fila no
existe. Compone **`account_status = 'active' AND deleted_at IS NULL`** — así el resto del
sistema nunca vuelve a preguntar por `deleted_at` a mano, que es cómo se regó el problema la
primera vez.

**El helper NO mira `agency_members`.** Los dos ejes se componen en el llamador
(`account_is_active(uid) AND agency_role_of(agency_id) IS NOT NULL`), porque solo el llamador
sabe cuál agencia importa. Fundirlos crearía un tercer helper con la semántica de los dos y sin
la de ninguno.

### Los puntos de escritura a cablear (footprint real — «≥3» eran optimistas)

**SQL / RPC**
- `publish_property_atomic` (`20260816000002:94`) — guard hermano del existente.
- `create_ad_campaign_atomic` y demás RPC de escritura de anuncios.
- Policies de escritura: `properties_insert`, `properties_update` (`20260805000011:254`),
  `leads_update`, `property_reports` INSERT (#220), `user_reports` INSERT (220.6),
  `user_prefs_update`, `users_update` (→ **Q6b**: ¿puede un suspendido editar su propio perfil?
  recomendación: sí — es lo propio, no es actuar; salvo que su perfil sea públicamente visible
  como agente, y entonces mejor congelarlo también).

**Edge Functions** (vía `_shared/account_gate.ts`, tras el `verify_caller` de cada una)
- Escritura de inventario: `publish-property`, `edit-property`, `update-property-status`,
  `archive-video`, `mint-upload-url`, `mint-thumbnail-url`, `mint-poster-urls`, `mint-r2-url`.
- CRM: `contact-agent`, `update-lead-status`, `update-lead-note`.
- Organización: `create-invitation`, `manage-agency-member`, `register-agency`,
  `request-agent-upgrade`, `upgrade-to-agent`, `redeem-invitation`.
- Publicidad: `mint-ad-upload-url`, `mint-ad-urls`.
- **Exentos a propósito** (documentarlo, no omitirlo): `record-ad-impressions` (telemetría),
  `validate-invitation` (lectura), `stream-webhook` (Cloudflare, sin caller humano), las EFs de
  admin (`moderate-*`, `set-org-advertising`, `suspend-agency`, `admin-create-agency`), que
  usan `AdminVerifier`.

### Cómo se evita «olvidar uno» (la pieza que de verdad importa)

`supabase/functions/_shared/account_gate.ts` exporta **una** función
`assert_account_active(client, user_id)` → `{ok:true} | {ok:false, error_code:'ACCOUNT_SUSPENDED'}`.
Cada EF de escritura la llama en 3 líneas justo después de su `verify_caller`.

Encima, un **test de guardia** calcado de
`supabase/functions/_shared/property_field_whitelist.test.ts` (el que parsea las migraciones
**por contenido** y truena con diff bidireccional): una lista explícita de EFs de escritura
que verifica, leyendo los `index.ts`/`handler.ts` del árbol, que **todas** invocan el gate y
que las exentas están en la lista de exentas **con su motivo**. Agregar una EF de escritura sin
gate rompe la suite. Es el mismo mecanismo que ya evita que el whitelist de 16 columnas
diverja entre TS y SQL.

### Cableado por pasos — expand → OTA aprende → contract (§0.5)

| Ola | Qué | Observable para un usuario vivo | Deployable sola |
|---|---|---|---|
| **0 — expand** | Enum + columna (default `active`) + `suspended_at` + helper + índice + tipos regenerados | **Nada.** Cero filas cambian de valor | Sí |
| **1 — OTA** | Catálogos de error aprenden `ACCOUNT_SUSPENDED`; banner derivado de `account_status`; hook + pantalla admin (aún sin backend) | Nada: el código todavía no lo emite nadie | Sí, y **debe ir antes de la ola 2** |
| **2 — contract** | `_shared/account_gate.ts` + su test de guardia; guard en `publish_property_atomic`; cláusulas en policies de escritura | Solo para cuentas explícitamente suspendidas — **hoy hay 0** | Sí |
| **3 — herramienta** | RPC `set_account_status_atomic` + EF `suspend-account` + auditoría + notificación | El admin ya puede ejercerla | Sí |
| **4 — opcional** | Corte de sesión (ban GoTrue) e/o inventario (según **Q1**/**Q2**) | Sí, alto impacto | Sí |

🔴 **La ola 3 NO puede adelantarse a la ola 2.** Un admin que suspende y no pasa nada es peor
que no tener el botón: cree que actuó. Si se quiere en un solo release, van juntas.

🔴 **Antes de desplegar la ola 2, contar en el remoto** (sonda de solo lectura, patrón
`prod_smoke_do_block_rollback`): cuántas cuentas quedarían suspendidas (esperado: 0), cuántos
miembros suspendidos hay y si tienen propiedades activas — el mismo checklist que #202 ya se
impuso.

### Inventario y leads de una cuenta suspendida (el hueco del independiente)

**Con agencia** — resuelto por composición: `properties.agency_id` está denormalizado
(`20260805000011`), `properties_update` autoriza a `agency_role_of(agency_id) in
('owner','admin')`, y `edit-property/handler.ts:281` replica ese criterio. **El owner ya puede
editar hoy** las propiedades de su agente suspendido; lo que #203 agrega es que las **vea**
marcadas «sin gestor». Nada nuevo que inventar aquí.

**Sin agencia (independiente) — nadie hereda.** Estado de hecho hoy:
- Su inventario **sigue en el feed**: `properties_select` (`20260805000011:233-238`) es
  `status='active' and deleted_at is null` — **no mira al dueño**.
- Su identidad **sigue pública**: la vista `agent_public_profiles` (`20260810000001`) expone
  nombre y foto de todo `role in ('agent','admin')`, sin mirar estado.
- **Los leads le siguen llegando**: `private.set_lead_agency_id()` (`20260807000006:85-100`)
  resuelve `agency_id` desde la membresía activa; para un independiente queda **NULL**.
- Y **nadie más los ve**: `leads_select` es `agent_id = auth.uid()` + owner/admin de agencia, y
  desde **#226 el admin de plataforma ya NO ve leads** (`20260901000001_leads_sin_admin_plataforma`
  — decisión deliberada, verificada por sonda en producción: admin=0, owner=3).

→ **Un independiente suspendido = un buzón congelado que sigue recibiendo mensajes de personas
reales y que literalmente nadie puede abrir.** Es el mismo daño que motivó #203, agravado
porque no hay agencia que herede. **Si Q1 se responde «se oculta el inventario», la fuente se
seca y el problema de leads desaparece sin tocar el trigger.** Esa es la razón de poner Q1
primero.

## Fases / épicas

Ver la tabla de olas arriba. Como subtareas de #204 (el desglose fino lo hace `/tm-plan`):

1. **204.1** — migración aditiva (enum + columnas + helper + índice + grants) con rollback y
   pgTAP. **CRÍTICA** (`supabase/migrations/**`).
2. **204.2** — `_shared/account_gate.ts` + test de guardia de cobertura de EFs. **CRÍTICA**.
3. **204.3** — cableado en `publish_property_atomic` + policies de escritura. **CRÍTICA**.
4. **204.4** — cableado en las EFs de escritura (mecánico una vez existe 204.2). **CRÍTICA**.
5. **204.5** — RPC `set_account_status_atomic` + auditoría + fault-injection. **CRÍTICA**.
6. **204.6** — EF `suspend-account` (calca `suspend-agency`). **CRÍTICA**.
7. **204.7** — UI admin + hook + catálogo de error + banner del suspendido. **No crítica**
   (verificación ligera: `pnpm tsc --noEmit`, `pnpm lint`, RNTL, smoke).
8. **204.8** — notificación al suspendido (si **Q4** = sí). **CRÍTICA** (migración/trigger).
9. **204.9** — decisión de **Q1** sobre inventario (puede salir como tarea derivada propia si
   la respuesta es «ocultar», porque su footprint es independiente).

## Criterios de aceptación

- [ ] `public.users.account_status` existe con default `active`; **ninguna fila viva cambió** al
      desplegar (verificado por sonda contra el remoto antes/después).
- [ ] El cliente **no** puede escribir la columna (assert explícito sobre los grants, no
      confianza en la omisión).
- [ ] `private.account_is_active(uuid)` devuelve `false` para: suspendida, borrada
      (`deleted_at`), e **inexistente** (fail-closed).
- [ ] 🔴 **Agente INDEPENDIENTE suspendido** (sin `agency_id`, sin membresía) no puede publicar,
      editar, pausar, cerrar, subir video, ni contactar. Caso central.
- [ ] Composición de los dos ejes, el peor caso manda: activo-en-agencia + suspendido-en-plataforma
      → bloqueado; suspendido-en-agencia + activo-en-plataforma → bloqueado; ambos activos → pasa
      (no-regresión).
- [ ] Cuenta suspendida **SÍ puede leer lo suyo** (sus propiedades, su histórico de leads) — el
      contacto de terceros queda oculto por la regla 2 de #202.
- [ ] Cuenta **activa**: comportamiento idéntico al de hoy (no-regresión medida, no asumida).
- [ ] `ACCOUNT_SUSPENDED` llega tipado al cliente y se traduce a mensaje en español; **nunca** un
      string crudo de supabase-js ni el código pelado en pantalla.
- [ ] El acto queda en `admin_actions` en la **misma transacción**; fault-injection verifica el
      rollback total.
- [ ] Reactivar restituye el estado exacto anterior, sin residuo (idempotente: re-suspender es
      no-op sin auditoría duplicada — precedente `20260823000003`).
- [ ] Ninguna EF de escritura queda sin gate: el test de guardia lo demuestra por enumeración.
- [ ] {? Q1 — criterio sobre inventario publicado, no redactable hasta la respuesta}
- [ ] {? Q2 — criterio sobre sesión viva vs cortada}

## Dependencias

- 🔴 **#202 primero, sin discusión.** Toca los **mismos archivos**
  (`edit-property/handler.ts:281`, policy `properties_update`, `publish_error_messages.ts`) y
  cierra la definición de «congelado». En paralelo = conflicto garantizado, y peor: los dos
  ejes se pisarían en el mismo `if`. `wiki/estado/estado-actual.md` ya fija el orden:
  *«Siguiente lote: #202 → #203/#204»*.
- **#203** — no bloqueante técnicamente, pero responde «a dónde va lo que quedó vivo» para el
  caso CON agencia. Q1 solo es difícil para el caso SIN agencia, y se beneficia de que #203 ya
  haya elegido su forma.
- **Reuso directo** (nada de esto se escribe de cero): `20260823000003_suspend_agency_admin.sql`
  (RPC), `20260815000002_set_org_advertising_rpc.sql` (auditoría atómica),
  `supabase/functions/suspend-agency/` (EF), `mobile/src/features/admin/hooks/useSuspendAgency.ts`
  + `agency_status_error_messages.ts` (hook y catálogo), `mobile/app/admin/reports/index.tsx`
  (estándar de tokens), `_shared/property_field_whitelist.test.ts` (patrón del test de guardia),
  `private.resolve_admin_actor()` (`20260805000007:52`).
- **Deuda que roza:** #96 (`revoke execute … from public` sobre los helpers `private.*`) — el
  helper nuevo debe nacer con el revoke, no heredar el hueco.

## Edge cases / riesgos

- 🔴 **Alcance oculto en las EFs**: 18 verificadores inline, cero compartidos. Si 204.2 no se
  hace primero, 204.4 degenera en copiar 3 líneas 18 veces y se olvidará una.
- 🔴 **`publish_property_atomic` ya se reescribió 5 veces.** Partir de `pg_get_functiondef` /
  la última migración real (`20260816000002`), jamás del cuerpo que asume el plan — el
  precedente #167/#168 borró 3 campos en silencio por hacerlo al revés.
- **Doble membresía**: el `ORDER BY (status='active') DESC` de `publish_property_atomic:113-119`
  desempata cuando alguien tiene una fila `active` y otra `suspended`. El eje de cuenta **no
  tiene ese problema** (una fila por persona), pero el guard nuevo debe ir **antes** o **después**
  del existente de forma explícita para que el error_code devuelto sea determinista (dos causas
  simultáneas → ¿cuál gana?). **Recomendación: el de cuenta gana** (es el más grave y el que el
  usuario no puede resolver hablando con su agencia).
- **Auto-suspensión del admin**: nada impide que un admin se suspenda a sí mismo o al otro
  super-admin (§28.2 dice que hay 2). Guard `p_user_id <> p_admin_id` + ¿bloquear suspender a un
  `role='admin'`? Recomendación: prohibir la auto-suspensión (P0001 explícito) y **permitir**
  suspender a otro admin (queda auditado).
- **`admin_actions.admin_id` NOT NULL con FK `on delete restrict`** a `public.users`: auditar
  suspensiones **impide borrar** físicamente al admin actor. Es correcto (retención permanente),
  pero conviene saberlo antes de que alguien intente un hard-delete.
- **Owner suspendido = organización sin owner operativo** (variante del #98 abierto: un owner
  puede dejar su agencia sin owner activo). No lo resuelve esta tarea; se anota.
- **Ruta caliente**: si Q1 elige tocar `properties_select`, es la policy **anon** del feed. Medir
  el plan antes y después, no asumir que un helper `STABLE` sale gratis.
- **Cuota real (§0.5 regla 5)**: cualquier smoke que abra el feed reproduce video de Cloudflare
  Stream → verificar y **PARAR**; los E2E terminan en `stopApp`.

## Plan de pruebas (alto nivel)

**pgTAP (CRÍTICO — TDD estricto, fase RED primero)**
- Helper: suspendida / borrada / inexistente → `false`; activa → `true`.
- Composición de los dos ejes, 4 combinaciones, por **impersonación con JWT real** (nunca
  leyendo el texto de la policy — regla de la casa).
- 🔴 El independiente suspendido: no escribe por **ninguna** ruta (RPC, PostgREST directo).
- Lectura de lo propio conservada (assert de **no-regresión**, no de feature).
- No-regresión completa de la cuenta activa.
- RPC: auditoría en la misma transacción + **fault-injection** que verifique rollback total;
  `USER_NOT_FOUND` explícito; re-suspender idempotente sin auditoría duplicada.
- Grants: el cliente no puede escribir `account_status` (assert directo sobre el privilegio).
- Rollback probado por round-trip.

**Deno (CRÍTICO)** — EF `suspend-account` (401/403/404/409/200, DI); `account_gate.ts`; el
**test de guardia** de cobertura de EFs de escritura.

**Jest/RNTL (ligero)** — hook `useSuspendAccount` (doble-submit, mensaje del cuerpo no de
`error.message`, `functions.invoke` no desprendido); el catálogo traduce `ACCOUNT_SUSPENDED`; el
banner aparece con `account_status='suspended'` y **no** aparece con `active`.

**Smoke en producción-viva** — sonda de solo lectura (patrón `DO block + RAISE`) contando
cuentas afectadas **antes** de la ola 2; después del deploy, suspender una cuenta de prueba,
verificar el 403 legible, reactivar, verificar restitución.

**Datos de prueba** — 4 usuarios: independiente activo, independiente suspendido, agente con
agencia activo, agente activo-en-agencia + suspendido-en-plataforma.

## Impacto en PRD (solo referencia — NO se edita)

- `docs/PRD.md` **§28.3 punto 4** («Gestión de usuarios… Acciones: Suspender / Reactivar /
  Eliminar / Cambiar rol manualmente») — esta tarea entrega **solo** Suspender/Reactivar.
- **§28.4** (motivo obligatorio, se envía al afectado y queda visible) — informa **Q3** y **Q4**.
- **§28.5** (auditoría en `admin_actions`, inmutable, retención permanente) — ya cumplido por el
  patrón elegido.
- **§24 / §15.6** — la suspensión de una **publicación** ya existe y es **otra cosa**; el propio
  PRD lo dice en `:1175`: *«no hay auto-suspensión de cuentas: suspender personas es §28.3-4 y
  es trabajo futuro, distinto de suspender una publicación»*.

## Decisiones del intake

{? Pendiente — este doc es la primera pasada. Las 8 preguntas de abajo se resuelven con Abraham
(`AskUserQuestion` del orquestador) y sus respuestas se registran aquí antes de promover.}

### Preguntas abiertas

**Q1 — ¿Qué pasa con el inventario PUBLICADO de una cuenta suspendida sin agencia?**
`properties_select` no mira al dueño; los leads siguen llegando y nadie más los ve (#226 quitó
al admin de `leads_select`).
- **(a) [REC]** Se **oculta del escaparate de forma reversible**, calcando
  `ads.paused_by_suspension` (#211/169.2): la suspensión pausa, la reactivación revive **solo lo
  que ella pausó**. *Costo:* 1 migración + trigger + cascada + pgTAP (~1 subtarea). No toca la
  policy anon caliente ni destruye estado. *Riesgo:* contradice literalmente el «🔴 NO se pausan
  las propiedades automáticamente» de #203 — pero esa regla se escribió para el caso **CON**
  agencia, donde la agencia hereda y sigue habiendo un humano detrás. Aquí no lo hay.
- **(b)** Sigue visible; la suspensión es de la persona, no de su inventario. *Costo:* 0.
  *Riesgo:* personas reales siguen escribiendo a un buzón congelado.
- **(c)** Se oculta con `and private.account_is_active(owner_user_id)` en `properties_select`.
  *Costo:* policy **anon** en la ruta caliente del feed + medición de plan + cambio de contrato
  de lectura publicado (§0.5).
- **(d)** Depende del motivo (fraude oculta, operativo no). *Costo:* el motivo pasa a ser enum,
  dos comportamientos y dos suites.

**Q2 — ¿La sesión sigue viva?**
- **(a) [REC]** **Sí**: sesión viva, escritura congelada, mensaje legible. Es la regla 2 de #202
  y la lección de #200. *Costo:* incluido en el alcance base.
- **(b)** Sí por default, **+ un botón separado «expulsar»** (ban GoTrue) para fraude flagrante.
  *Costo:* +1 EF con `auth.admin.updateUserById({ban_duration})` + traducir el error de login.
  *Nota:* `banned_until`/`ban_duration` **no se usan hoy en el repo**; sería mecanismo nuevo.
- **(c)** Siempre cortada. *Costo:* barato de implementar, caro en producto: rompe «conserva la
  lectura de lo propio» y produce el fallo mudo que #200 arregló.

**Q3 — ¿El motivo es obligatorio? ¿Texto libre o catálogo?**
- **(a) [REC]** **Obligatorio**, catálogo corto (enum: fraude, contenido inapropiado,
  suplantación, incumplimiento, otro) + nota libre opcional. *Costo:* CHECK + select en la UI.
  Coherente con §28.4 y con el precedente de `/admin/revisions` y `/admin/reports` (motivo
  obligatorio en la UI aunque la EF lo deje opcional).
- **(b)** Obligatorio, texto libre. *Costo:* menor, pero ojo con el gotcha `~ '\S'` + `is not
  null` (#220): con `trim()` un motivo de `"\r"` pasaría el CHECK.
- **(c)** Opcional. *No recomendado:* §28.4/§28.5 ya prometen motivo por escrito.

**Q4 — ¿Se le notifica al suspendido, y con el motivo?**
- **(a) [REC]** **Sí**: notificación in-app (catálogo v1 de #219) con el motivo, escrita en la
  **misma transacción** (regla bloqueante de #219), + banner persistente derivado de
  `account_status`. *Costo:* 1 `type` nuevo + `deep_link` a una ruta que **exista** (#223).
- **(b)** Solo banner, sin notificación. *Costo:* menor; pierde el registro con motivo en el
  centro de avisos.
- **(c)** Suspensión **silenciosa** (para investigar fraude sin alertar). *Costo:* contradice
  «nunca una app que falla en silencio»; solo defendible si Abraham lo pide explícito, y aun así
  el usuario lo descubrirá al primer intento de escritura.

**Q5 — ¿Quién puede ejecutarla: EF con `service_role` o RPC de admin directa?**
- **(a) [REC]** **EF `suspend-account` + RPC `set_account_status_atomic` solo `service_role`**,
  calcando `suspend-agency` (#211) + `20260823000003`. *Costo:* ~1 subtarea cada una; resuelve
  de fábrica el problema conocido de `auth.uid()` ausente bajo `service_role` (GUC
  `urbea.admin_actor_id`). Es lo que el panel in-app necesita ([[panel-admin]]: el admin opera
  desde el teléfono).
- **(b)** Solo RPC vía Studio/CLI, sin UI (como `agencies.status` antes de #211). *Costo:* 0 UI,
  pero deja la herramienta fuera del centro operativo — y #211 ya demostró que ese camino
  termina reescribiéndose.
- **(c)** UPDATE directo del admin por RLS + grant de columna. *Descartado:* rompe la auditoría
  en la misma transacción y abre la columna al cliente.

**Q6 — ¿A quién alcanza? ¿Solo agentes/owners, o también buscadores (`role='user'`)?**
- **(a) [REC]** **Cualquier cuenta.** El eje es de plataforma, no de rol; un buscador que acosa
  agentes o hace reportes falsos es exactamente a quien se necesita congelar. *Costo:* definir
  qué congela para un buscador: contactar agentes (`contact-agent`), reportar
  (`property_reports`/`user_reports`), y —cuando existan— comentar/seguir.
- **(b)** Solo cuentas con capacidad de publicar (agente/owner). *Costo:* menor alcance, pero
  deja sin respuesta los reportes de perfil de #220.6 sobre buscadores.

**Q6b (menor, derivada) — ¿Un suspendido puede editar su propio perfil (nombre, foto, bio)?**
- **(a) [REC]** **Sí** — es «lo propio» y no es actuar en la plataforma. *Costo:* 0 (no se toca
  `users_update`).
- **(b)** No, si es agente: su nombre y foto son superficie pública vía `agent_public_profiles`
  (`20260810000001`) y un suspendido podría usarla como canal. *Costo:* +1 cláusula y su test.

**Q7 — ¿Suspender al OWNER de una organización cascada a la organización?**
- **(a) [REC]** **No.** Son dos ejes distintos y `suspend-agency` (#211) ya existe para el otro;
  una cascada automática castigaría a agentes que no hicieron nada (el mismo argumento del «🔴
  NO se pausan las propiedades» de #203). *Costo:* 0 + una línea de copy en la UI advirtiendo
  que la organización sigue activa.
- **(b)** Sí, cascada. *Costo:* trigger + cascada reversible + decidir qué pasa con los agentes
  de esa organización.

**Q8 — ¿La columna es un enum de 2 valores o la matriz completa de 4?**
- **(a) [REC]** **Enum de 2 valores** (`active|suspended`) y los timestamps existentes siguen
  siendo la verdad de la baja; **`private.account_is_active` es el único lugar donde se
  componen**. *Costo:* mínimo, aditivo puro, **cero backfill** sobre datos reales, y ninguna
  contradicción posible entre dos representaciones del mismo hecho.
- **(b)** Enum de 4 (`active|suspended|deletion_pending|deleted`) + backfill derivado de los
  timestamps + CHECK que ate `account_status='deleted' ⟺ deleted_at is not null`. *Costo:*
  backfill sobre la tabla de personas reales (§0.5) + un invariante nuevo que custodiar. *A
  favor:* estado explícito y legible en una sola columna.
- ⚠️ Sin (a) o el CHECK de (b), quedan **dos fuentes de verdad para el mismo hecho** — el modo
  de falla que la propia #204 anticipa («son tres estados y hay que definir sus transiciones o
  se contradicen»).

### Matriz de estados y transiciones (bajo la recomendación Q8a)

Estado efectivo = `f(account_status, deletion_pending_at, deleted_at)`, derivado **solo** por
`private.account_is_active`:

| Estado efectivo | Cómo se representa | ¿Escribe? | ¿Lee lo suyo? | ¿Visible a terceros? |
|---|---|---|---|---|
| `active` | `account_status='active'`, ambos timestamps NULL | Sí | Sí | Sí |
| `suspended` | `account_status='suspended'` | **No** | **Sí** (regla 2 #202) | → **Q1** |
| `deletion_pending` | `deletion_pending_at is not null` | {? no definido — hoy **sin escritor**} | Sí | Sí |
| `deleted` | `deleted_at is not null` | No | No (sesión termina) | No (índices parciales ya lo excluyen) |

Transiciones:

| Desde → Hacia | Actor | Existe hoy | Nota |
|---|---|---|---|
| `active → suspended` | admin (RPC auditada) | **NO** | lo que estrena #204 |
| `suspended → active` | admin (RPC auditada) | **NO** | restitución exacta, sin residuo |
| `active → deletion_pending` | el propio usuario | **NO** (columna dormida) | fuera de alcance |
| `suspended → deletion_pending` | el propio usuario | **NO** | ¿un suspendido puede pedir su baja? **REC: sí** (derecho del titular); la baja no borra la auditoría |
| `deletion_pending → active` | el propio usuario | **NO** | cancelar la baja |
| `deletion_pending → deleted` | reaper/job | **NO** | fuera de alcance |
| `* → deleted` | admin | parcial (`users_delete` policy) | terminal |
| `deleted → *` | — | — | **terminal**: no se reactiva desde la app (`users_email_unique_active` permite reusar el correo) |

🔒 Invariante propuesto: **una cuenta `deleted` nunca se evalúa por `account_status`** — el
helper corta por `deleted_at` primero. Así el orden de los estados es total y no hay empates.

## Promoción / descarte

**Al aprobar:** este doc se adjunta como plan de la **tarea #204 ya existente** (no se crea
tarea nueva). Siguiente comando: `/tm-plan 204`. Si **Q1** resuelve «ocultar inventario», ese
trabajo sale mejor como **tarea derivada** (título `producto(204): …`, `dependencies: [204]`,
backlink `DERIVADAS:` en los details de #204) porque su footprint —`properties` y la ruta del
feed— es independiente del eje de cuenta.

**Bloqueo de orden:** #202 debe estar `done` antes de arrancar #204 (mismos archivos, misma
definición). `wiki/estado/estado-actual.md` ya lo fija: *«Siguiente lote: #202 → #203/#204»*.
