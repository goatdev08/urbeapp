---
tipo: proyecto      # feature | fix | refactor | chore | proyecto
nivel: XL           # XS | S | M | L | XL — se promueve como 4 tareas encadenadas (A→B→C→D) + 1 diferida (E)
fecha: 2026-08-14
estado: aprobado    # borrador → en-revision → aprobado | descartado — APROBADO por Abraham 2026-08-14
tarea_id: 168, 169, 170, 171, 172   # A=168 (L) → B=169 (L) → C=170 (L) → D=171 (M) · E=172 deferred (XL)
motivo_descarte:
---

# Cuenta comercial / anunciantes: monetización por publicidad de video nativo en el feed

> Documento de exploración/planeación de `/tm-explore`. Un archivo por idea.
> Puede **APROBARSE** (→ se promueve a tarea[s] en Taskmaster) o **DESCARTARSE**.
> NO edita los PRD maestros; "Impacto en PRD" es solo referencia.
> ✅ **Estado: en-revisión — sin preguntas abiertas bloqueantes.** Las 4 decisiones del intake y
> las 27 respuestas de la 2ª pasada son restricciones fijas (ver "Decisiones del intake").
> **Listo para promover** a 4 tareas encadenadas + 1 diferida.

## Historial de la exploración

| Pasada | Fecha | Qué cambió |
|---|---|---|
| 1ª | 2026-08-14 | Primera vez que la idea se pone en papel. **No existe NADA de publicidad en Taskmaster ni en el PRD**: §4.1 cierra la jerarquía de roles, `Alineacion.md` marca "Publicidad" como ❌ fuera del MVP y "Monetización / Alianzas con negocios" solo como bullet del Paso 4 (crecimiento). Las 4 decisiones de Abraham (formato, cobro, targeting, modelo de entidad) llegan ya tomadas. Se investigó el vault, `mapa-codebase`, el schema real y las épicas #71/#74/#76/#77/#80/#81/#84/#157. Resultado: **fase 1 no está bloqueada por ninguna épica pendiente** — todo lo que necesita (#71 patrón multi-tenant, #68 pipeline Stream, #112 telemetría cliente, #157 catálogo geo) ya está `done`. Nivel **XL**, corte propuesto en 4 tareas + 1 diferida. Cerró con **27 preguntas abiertas**. |
| 2ª (esta, final) | 2026-08-14 | ⭐ **Abraham respondió las 27 en 4 rondas.** Dos respuestas **cambian el diseño** de la 1ª pasada: (1) 🔴 **NO se crean `businesses`/`business_members`** — se **generaliza `agencies` a "organización con capacidades"** (`can_advertise`), migración aditiva con default = comportamiento actual; una inmobiliaria activa publicidad **sobre su misma cuenta**, y una cuenta solo-publicidad es una organización con solo `can_advertise`. Toda la membresía/invitaciones/RLS de #71 se reusa **tal cual** → la fase A se encoge y desaparecen 3 tablas, 2 enums y un helper. (2) 🔴 **La invitación del owner debe llegar por CORREO** — hoy **ningún** camino de invitación manda correo (investigado, ver §"Invitación por correo"), así que entra como pieza nueva de la tarea A. Además el **gate legal del aviso de privacidad es BLOQUEANTE** para la salida de la tarea C (no existe tarea previa de rewrite → la incluye C como subtarea). Criterios de aceptación reescritos completos y verificables por tarea. **Listo para promover.** |

> Nota de reloj: el intake y las decisiones de Abraham son del **2026-08-14**; el entorno marcó 2026-08-15 al redactar. Se conserva la fecha del intake.

---

## Idea original

> "Cuenta comercial / anunciantes: monetización por publicidad de video nativo en el feed."
>
> Negocios del sector inmobiliario adyacente —bancos y créditos hipotecarios, seguros de
> arrendamiento, mudanzas, limpieza, notarías, avalúos— pagan por distribuir publicidad dentro
> de Urbea. **Requisito de producto, no negociable: debe ofrecer VALOR REAL al usuario que
> navega, no solo ingreso.** Alguien que está viendo casas en renta en Zapopan tiene una
> necesidad real de seguro de arrendamiento y de mudanza; el anuncio correcto en ese momento
> es un servicio, no una interrupción.

## Lluvia de ideas (solo si la idea era abstracta)

**n/a para el formato** — la dirección llegó decidida (video vertical nativo, marcado
"Patrocinado", intercalado cada N). Las direcciones alternativas (banners, directorio de
proveedores, listado patrocinado en el mapa, deals/cupones) quedan **fuera de fase 1 por
decisión explícita**; se registran aquí solo como inventario para fases futuras, no como
opciones vivas.

Donde SÍ hubo lluvia de ideas real y quedó **sin resolver** es en tres puntos de arquitectura,
que se devuelven como preguntas abiertas con opciones: dónde vive el video del anuncio (R1),
cómo entra el anuncio al feed (resuelto con recomendación fuerte, §"Inserción en el feed"), y
si `ad_impressions` es tabla propia o una proyección de `events_raw` (R14). Las tres quedaron
resueltas en la 2ª pasada.

## Problema / Motivación

**Del lado del negocio.** El único modelo de ingreso especificado hoy (PRD §17) cobra al
**publicador**: $399 MXN/mes premium por 1 video, agente 3m $1,197 / 6m $1,194. Ese modelo
tiene un techo estructural — escala con el número de agentes, que es la parte difícil de
conseguir, y cobra justo a quien todavía no ha comprobado que la plataforma le trae clientes.
La publicidad cobra a un tercero que **ya tiene presupuesto de adquisición** (un banco gasta en
captar solicitantes de crédito con o sin Urbea) y no depende de que el agente esté convencido.

**Del lado del usuario.** El feed vertical es el diferenciador del producto y hoy solo tiene un
tipo de contenido. Rentar o comprar casa dispara una cadena de necesidades reales y con fecha:
crédito, seguro de arrendamiento, aval, mudanza, limpieza, notario, avalúo. Hoy el usuario sale
de Urbea a buscar cada una por su cuenta. Un anuncio de video **con targeting por zona** llega
en el momento exacto de intención — es la diferencia entre publicidad y servicio.

**Del lado del riesgo.** Es también la funcionalidad que más fácil degrada el producto. El feed
está en **producción viva** con testers reales ([[0009-produccion-viva]]); un anuncio mal
insertado es lo primero que hace que la app "se sienta spam". Por eso este documento pone tanto
peso en el fail-soft y en el kill-switch como en el modelo de datos.

**Encaje con el hito.** ⚠️ Este trabajo NO es de la demo cerrada de 3 semanas
([[0005-demo-cerrada-3-semanas]]) ni del camino a producción actual — es una **línea de negocio
nueva**. Su prioridad relativa contra las olas del backlog (#74–#84) es una decisión de Abraham,
no de esta exploración.

## Resultado esperado

**Happy path del usuario (comprador).** Baja por el feed en Zapopan. Después de N propiedades
aparece un video vertical de 15 segundos de una aseguradora, con un badge **"Patrocinado"**
visible y persistente, mismo lenguaje visual que el resto del feed. Tiene un CTA claro
("Cotizar mi seguro de arrendamiento"); si lo toca, se abre WhatsApp / el sitio del negocio. Si
no le interesa, sigue deslizando exactamente igual que con cualquier otro video. **Si no hay
anuncios para su zona, el feed es idéntico al de hoy — sin huecos, sin placeholders.**

**Happy path del anunciante.** Su organización ya existe (o la crea el admin y él llega
por **correo de invitación**), tiene la capacidad `can_advertise`, él es `owner`,
sube un video vertical con el mismo pipeline de Cloudflare Stream que usan los agentes, elige
zonas del catálogo nacional (municipios y/o colonias de #157), el admin lo aprueba, el anuncio
se sirve durante su vigencia y en su pantalla ve: **impresiones, vistas ≥3s, taps al CTA, y el
desglose por zona** ("tu video se vio 1,240 veces en Zapopan y 380 en Tlajomulco").

**Happy path del admin.** Da de alta el negocio, revisa el creativo antes de que salga, otorga
el slot (en beta, gratis por feature-flag), y puede apagar TODA la publicidad con un flip en
`app_config` sin publicar app.

## Alcance

**SÍ entra (fases A–D, lo que este doc propone construir):**
- ⭐ **Capacidad `can_advertise` sobre la organización existente (`agencies`)** — no una entidad
  nueva. Reusa membresía, invitaciones y RLS de #71 sin duplicar nada.
- ⭐ **Invitación del owner por correo electrónico** (hoy no existe ese camino en ningún flujo).
- Creativo de video (`ad_creatives`) reusando el pipeline de Cloudflare Stream existente.
- Campaña con vigencia fija (`ads`) + targeting por zona (`ad_zones` → municipio/colonia de #157).
- Moderación admin del creativo antes de servirse (máquina de estados + `admin_actions`).
- Inserción en el feed con frequency cap, marca "Patrocinado" y CTA.
- Medición **desde el día 1**: `ad_impressions` (impresión, duración vista, zona, tap al CTA).
- Reporte agregado al anunciante en la app.
- Otorgamiento manual del slot por admin (sin pasarela), flip-ready a #76/#84.
- ⭐ **Actualización del aviso de privacidad** (gate bloqueante de la salida de la fase C).

**NO entra (out of scope explícito):**
- **Banners, intersticiales, directorio de proveedores, deals/cupones** (decisión de Abraham).
- **CPM / CPC / subasta / presupuesto diario / pacing / antifraude** → fase 2 (#E, diferida).
  ⚠️ **La MEDICIÓN no se difiere** — solo la facturación por ella.
- **Perfilado de personas** (intereses, historial de comportamiento, look-alike) → DESCARTADO,
  no diferido. El targeting perfila el **lugar**, nunca a la persona.
- **Targeting por contexto de propiedad** (venta→hipotecario, renta→seguro) → puerta abierta,
  fase posterior. El modelo lo deja cableado (`advertiser_category`), no lo implementa.
- Cobro real con tarjeta (depende de #84, Ola 4) — en beta el slot se otorga manualmente.
- Facturación CFDI, contratos, órdenes de inserción → fuera de producto.
- Anuncios en el **mapa** o en el **detalle** de propiedad → solo feed en fase 1.

## Roles afectados

| Rol | Cómo le afecta |
|---|---|
| **Comprador / buscador** | Ve anuncios intercalados en el feed. Es el rol de mayor riesgo: la calidad de su experiencia es el techo de todo el modelo. No gana ninguna capacidad nueva; **gana o pierde confianza**. |
| **Agente individual (sin organización)** | ⚠️ Su video compite por atención con contenido pagado por un tercero. **No puede anunciarse**: la capacidad vive en la organización, y un agente independiente no tiene una. Si quiere anunciarse, primero registra organización (decisión de Abraham, R3/R4). |
| **Inmobiliaria (organización)** | ⭐ **Puede activar publicidad sobre su MISMA cuenta** — sin crear una segunda entidad, sin re-invitar a nadie, sin cambiar de sesión. El owner la solicita; en beta la enciende el **admin de Urbea**; en fase 2 la enciende el pago. |
| **Anunciante puro (rol NUEVO de facto, NO en el enum)** | 🔴 Restricción fija: **no es un valor nuevo de `user_role`**. Es una persona con su rol normal que ADEMÁS tiene membresía activa en una organización con `can_advertise`. Una aseguradora es simplemente una organización con `can_publish_properties=false` y `can_advertise=true`. |
| **Admin de plataforma** | Da de alta organizaciones, **enciende `can_advertise`**, modera creativos, otorga slots, opera el kill-switch. En beta por Studio/SQL (igual que #71.5 y #153), con UI en #81. |
| **Owner/admin de organización** | Gana la gestión de anuncios **si** su organización tiene la capacidad. La matriz de #71 se reusa sin cambios (owner todo; admin todo excepto la fila owner; viewer solo lectura). |

## Impacto en datos

Todo **aditivo**, sin tocar una sola tabla existente en su forma actual. Regla de producción
viva #1: la DB remota tiene datos reales ([[0009-produccion-viva]]).

### ⭐ Identidad: CERO tablas nuevas — se generaliza `agencies` (decisión R3/R4)

🔴 **La 1ª pasada proponía `businesses` + `business_members` + `business_invitation_tokens`.
Queda DESCARTADO.** La organización que anuncia es la organización que ya existe.

**Cambio aditivo sobre `agencies` (0003):**
```
alter table public.agencies
  add column if not exists can_publish_properties boolean not null default true,
  add column if not exists can_advertise          boolean not null default false,
  add column if not exists advertiser_category    advertiser_category;   -- nullable
```
- **Default = comportamiento actual, exacto.** Las ~N filas vivas quedan
  `(true, false, null)` = inmobiliaria que publica y no anuncia. **Cero backfill, cero riesgo**
  para los builds instalados: nadie lee columnas que no existían y `select('*')` simplemente
  recibe tres campos de más (compat hacia atrás, regla 2 de §0.5).
- **CHECK `agencies_al_menos_una_capacidad`**: `can_publish_properties or can_advertise` — cierra
  el único estado sin sentido que abren los booleanos (una organización que no puede hacer nada).
- `advertiser_category` (enum nuevo `advertiser_category`) solo tiene sentido con
  `can_advertise=true`; se deja **nullable** en vez de forzar un CHECK condicional, porque el
  valor lo llena el admin al encender la capacidad, no al crear la organización.
- **`comment on table`** se actualiza a *"Organización: entidad organizacional (no es un rol).
  Puede publicar propiedades y/o anunciarse según sus capacidades."*

**⭐ Por qué dos booleanos y NO un enum `kind` (agency | advertiser | both):**
1. **Un enum es un conjunto cerrado y esto va a crecer.** Con 2 capacidades el enum necesita 3
   valores; con una tercera capacidad futura necesita 7. Los booleanos escalan sumando una
   columna, no reescribiendo el dominio.
2. **`ALTER TYPE ... ADD VALUE` es un gotcha ya documentado dos veces en este repo**
   (`20260805000002`, `20260809000002`): el valor nuevo **no se puede usar en la misma
   transacción**, obliga a una migración SOLA. Cada capacidad futura pagaría ese peaje;
   `add column ... default` no lo paga.
3. **El default aditivo es literal con booleanos** (`default true` / `default false` = statu quo)
   y requiere backfill con un enum (toda fila existente tendría que mapearse a `'agency'`).
4. **Las policies y helpers leen la capacidad directo** (`can_advertise`) en vez de decodificar
   un enum en cada `using(...)`.
5. Costo honesto: los booleanos permiten combinaciones sin sentido → **por eso el CHECK**.

**Lo que NO se toca (y por qué es la mayor ganancia del cambio):**
- `agency_members`, `agency_invitation_tokens`, `agent_applications` → **reuso literal**.
- `private.agency_role_of`, `private.can_manage_agency_member`, `private.is_agency_admin_of` →
  **reuso literal**. La matriz RLS de 4 niveles de #71 aplica a los anuncios sin una línea nueva.
- 🔒 El invariante **"máx 1 organización activa por persona"** ya existe
  (`agency_members_one_active_per_user`) y **se mantiene** — decisión de Abraham. No hay nada que
  construir: la 1ª pasada iba a duplicar ese índice en una tabla paralela y a arriesgar que los
  dos invariantes se desincronizaran.
- ⚠️ **Consecuencia derivada, explícita:** un **agente independiente no puede anunciarse** (no
  tiene organización). *"Solo la inmobiliaria podrá hacer upgrade o añadir ese permiso de
  publicidad"* — el nivel de la capacidad es la organización, nunca la persona.

**Helper nuevo (uno solo):** `private.org_can_advertise(p_agency_id uuid) → boolean` —
`security definer`, `search_path` fijo; true si la organización existe, `deleted_at is null`,
`status='active'` y `can_advertise`. Se compone con `agency_role_of` en las policies:
*"eres owner/admin de esa organización **y** esa organización puede anunciarse"*.

**RPC nueva `set_org_advertising_atomic(p_agency_id, p_enabled, p_category)`** — solo
`service_role`: enciende/apaga la capacidad **y audita en `admin_actions`** en una transacción.
Razón de que sea RPC y no un UPDATE a mano: los column-grants de 0008 ya impiden que incluso un
admin con JWT toque `agencies.status`, y encender una capacidad **facturable** sin rastro de
auditoría sería el mismo agujero. En beta la invoca el admin (Studio/CLI); la UI llega con #81.

**`admin_create_agency_atomic` extendida** con `p_can_publish_properties boolean default true` y
`p_can_advertise boolean default false` — **params con DEFAULT al final = contrato publicado
intacto** (la firma actual de 9 params con defaults ya establece ese patrón). Una organización
solo-publicidad se crea con `(false, true)`.

### Tablas nuevas (solo el dominio de publicidad)

**`ad_creatives`** — el video del anuncio: `id`, `agency_id`, `cloudflare_uid` (unique),
`status` (enum `ad_creative_status`: `uploading | processing | ready | failed`, calca
`property_video_status`), `tus_upload_url`, `thumbnail_url`, `duration_seconds`, `ready_at`,
`failure_reason`, `created_by_user_id`, `deleted_at`.
👉 **Tabla propia, NO `property_videos`** (R1 decidido) — justificación en §"Enfoque técnico".
🔒 CHECK de duración **6–30 s** (R2) validado al pasar a `ready`, distinto del 60–120 s de las
propiedades.

**`ads`** — la campaña con vigencia (fase 1 = slot de N días a precio fijo):
`id`, `agency_id`, `ad_creative_id`, `title`, `cta_type` (enum `ad_cta_type`:
`external_url | whatsapp | phone`), `cta_value`, `status` (enum `ad_status`:
`draft | pending_review | active | paused | expired | rejected`),
`starts_at`, `ends_at`, `rejection_reason`, `purchase_id` (**nullable, cableado para #84**),
`created_at`, `updated_at`.
⚠️ **`approved` NO existe como estado** (R12/R13 decidido): la aprobación del admin lleva
`pending_review → active` directo, y la **vigencia** (`starts_at`/`ends_at`) decide si se sirve.
Un estado `approved` intermedio sería exactamente el deadlock que #153 tuvo que cortar en
propiedades.
🔒 Servir = `status='active' AND now() BETWEEN starts_at AND ends_at` (la vigencia manda, el
estado no basta).

**`ad_zones`** — targeting N:M contra el catálogo de #157:
`ad_id`, `municipality_id text` (FK `mx_municipalities`) **null**, `neighborhood_id uuid`
(FK `mx_neighborhoods`) **null**, CHECK "exactamente uno no nulo", índices por ambos.
🔒 **Cero filas para un `ad` = inventario NACIONAL** (R11 decidido) — no es un estado inválido,
es un alcance de venta.

**`ad_prices`** — precios en tabla configurable, **nunca en código** (PRD §17.2, regla ya
establecida para los planes de video), **creada AHORA aunque no se cobre en beta** (R19/R20):
`id`, `zone_scope` (enum `ad_zone_scope`: `neighborhood | municipality | national`), `days`,
`price_mxn numeric`, `active boolean`, `created_at`. Sembrada con los 3 alcances × la vigencia
estándar; el `purchase` de #76/#84 leerá de aquí el precio histórico.

**`ad_impressions`** — 🔴 la tabla que Abraham marcó como **requisito explícito de
escalabilidad**: se construye en fase 1 aunque no se cobre por ella.
`id uuid` (**generado en el CLIENTE** como clave de idempotencia — permite hacer upsert del tap
al CTA que ocurre después del envío del batch), `ad_id`, `agency_id` (denorm para el reporte),
`user_id` **+** `session_id` (R15 decidido), `municipality_id`, `neighborhood_id` (**la zona la
resuelve el SERVIDOR, no la manda el cliente**), `shown_at`, `watched_ms`, `viewed` (bool, ≥3 s —
misma definición que §26.1), `completed` (bool, ≥95 % — §26.3), `cta_tapped_at`, `device`,
`created_at`.
Índices: `(agency_id, created_at desc)`, `(ad_id, created_at desc)`, `(ad_id, municipality_id)`.

**`ad_impressions_monthly`** — rollup mensual permanente (R18): `agency_id`, `ad_id`,
`municipality_id`, `neighborhood_id`, `year_month`, `impressions`, `views`, `completions`,
`cta_taps`. Lo alimenta un job (`pg_cron`) que además **purga el crudo a los 90 días**. Es lo que
hace defendible guardar `user_id`: el dato identificable **caduca**, el agregado no.

### Enums nuevos
`advertiser_category` (`credito_hipotecario | seguros | mudanzas | limpieza | notaria |
avaluos | otro`), `ad_creative_status`, `ad_status`, `ad_cta_type`, `ad_zone_scope`.
⚠️ Los enums de identidad de la 1ª pasada (`business_status`, `business_member_role`) **ya no
existen**: se reusan `agency_status` y `agency_member_role`.
⚠️ **Gotcha documentado dos veces en el repo** (`20260805000002`, `20260809000002`):
`ALTER TYPE ... ADD VALUE` no se puede usar en la misma transacción que lo crea. Aquí los enums
son **nuevos** (no extensiones), así que no aplica — pero si una fase futura extiende
`advertiser_category` con una categoría más, **va en migración SOLA**.

### RLS (2ª capa, fail-closed, [[rls-seguridad]])
- **Helpers: se REUSAN los de #71** (`agency_role_of`, `can_manage_agency_member`). El único
  nuevo es `private.org_can_advertise(agency_id)`.
- `agencies` / `agency_members`: **sin cambios de policy**. Las columnas nuevas quedan cubiertas
  por las policies existentes; ⚠️ hay que verificar que los **column-grants de 0008** no dejen
  que `authenticated` escriba `can_advertise` por PostgREST (si el grant es a nivel de tabla,
  revocar esas columnas explícitamente — encender tu propia capacidad de anunciar sería un
  privilege escalation trivial).
- `ads` SELECT: `agency_role_of(agency_id) IS NOT NULL` (cualquier estado, es su anuncio)
  **OR** (`status='active'` AND vigente) para `authenticated` — el feed necesita leerlos.
  Escritura: exclusiva de EF/RPC `SECURITY DEFINER`, sin policy de INSERT/UPDATE para
  `authenticated` (patrón `property_revisions` / `property_video_slots`).
- `ad_creatives` SELECT: solo su negocio + admin. El feed **nunca** lee esta tabla directo —
  recibe la URL firmada por EF.
- 🔴 **`ad_impressions`: fail-closed total.** `revoke all from anon, authenticated`, **sin
  ninguna policy de SELECT para `authenticated`**. Escritura solo `service_role` (vía EF).
  Lectura del anunciante **solo por RPC agregada** (`ad_metrics_for_agency`), nunca fila a
  fila. Esta es la aplicación directa de la lección de 75.3: *abrir una tabla de comportamiento
  a la lectura es un acto de privacidad, no de permisos* ([[privacidad-datos]]).
- Todas las tablas nuevas en `public` **NO heredan** los grants de `anon`/`authenticated` (el
  blanket grant de 0008 solo cubrió las tablas de entonces) → hay que otorgar explícitamente,
  gotcha ya documentado en `20260809000004`.

### Requisitos de migración (CLAUDE.md §3 + §0.5)
Idempotentes (`create table if not exists`, `drop policy if exists` + `create policy`),
**rollback** en `supabase/migrations/rollbacks/`, **tests pgTAP** por migración,
`revoke truncate` en las append-only. **Cero** `DROP`, `TRUNCATE`, reset o seed contra el remoto.

## Impacto en UI

| Pantalla | Qué cambia | ¿En el mockup canónico? |
|---|---|---|
| **Feed** (`mobile/src/features/feed/FeedScreen.tsx`) | El item de la lista deja de ser homogéneo: aparece un `AdFeedItem` con badge "Patrocinado" + CTA. Toca `renderItem`, `key_extractor` y la viewability (`useFeedActiveIndex`). | ❌ **NO** |
| **"Mis anuncios"** (nueva, `mobile/app/(protected)/ads/`) | Lista de anuncios + estado + vigencia + 3 contadores + desglose por zona. **Sin gráficas** (R23). | ❌ **NO** |
| **Subir anuncio** (nueva) | Wizard corto: video (6–30 s) → título → CTA → zonas → enviar a revisión. Reusa `useVideoUpload`, `SelectionCard`, `StepIndicator`, `ZoneAutocomplete`/`usePlaceSearch` de #157. | ❌ **NO** |
| **Perfil** | Entrada nueva **condicional a la capacidad** `can_advertise` de la organización del usuario (R24) — patrón del gating de `my-listings` / invitaciones (#34.3). | Parcial |

🔴 **GATE DE DISEÑO.** El gate de branding #19 está **levantado** desde 2026-06-26 (CLAUDE.md
§8), así que no es *ese* gate el que bloquea. Lo que aplica es la otra regla de §8: **"cada
pantalla del mockup = techo de alcance de su tarea; lo que falte = trabajo nuevo"**. Ninguna de
estas pantallas está en `urbea-identidad-visual.html` ni en `Urbea Prototipo (standalone).html`.

Y el badge "Patrocinado" es, de todo el proyecto, el elemento visual **más delicado**: es donde
el usuario decide si Urbea se siente confiable o se siente spam, y además es una **obligación
legal** (publicidad identificable), no una decisión estética. Por eso: **componente de firma →
preview HTML aprobable por el cliente ANTES de portar a RN** (método de §8), no mini-spec
escrito.

## Reglas no obvias aplicables

- 🔒 **"Registrar ≠ exponer"** — el permiso se deriva de una *relación vigente con la persona*,
  no de "soy dueño del objeto" — [[privacidad-datos]] · `docs/PRD.md` §19.1/§19.2 · fuga cerrada
  en 75.3 (`20260809000001`). **Consecuencia directa aquí:** el anunciante no tiene ninguna
  relación con quien vio su anuncio → **jamás** lee filas de `ad_impressions`, solo agregados.
- 🔴 **`events_raw_insert` deja que cualquier `authenticated` inserte filas arbitrarias** con
  `user_id = auth.uid()` (`20260808000001:72`). Es aceptable para métricas de producto; es
  **inaceptable como base facturable** — un cliente modificado fabrica impresiones. Por eso la
  escritura de `ad_impressions` va por EF con `service_role`.
- 🔒 **Lógica de negocio en Edge Functions, RLS como 2ª capa, triggers solo atómicos** —
  `docs/lineamientos-desarrollo.md` · [[rls-seguridad]].
- 🔒 **Migraciones idempotentes + rollback + pgTAP**; tablas nuevas necesitan grants explícitos
  (`20260809000004`).
- 🔴 **Producción viva** ([[0009-produccion-viva]], CLAUDE.md §0.5): aditivo o
  expand→migrate→contract; no romper contratos que consumen builds instalados (`select('*')`,
  RPCs, EFs); merge a `main` = candidato a release.
- 🔴 **Ver video quema cuota real de Cloudflare Stream** — verificar que reproduce y **PARAR**;
  E2E terminan en `stopApp` (CLAUDE.md §0.5.5, [[video_playback_burns_quota]]). Un ad cada N
  items multiplica minutos facturados — es un **costo variable del modelo**, no un detalle.
- 🔒 **Invariante A1 "flaco" de las RPCs geoespaciales**: `properties_within_radius` /
  `properties_within_neighborhood` devuelven SOLO `{id, distance_m}`. Meter anuncios ahí
  rompería el contrato que consumen feed **y** mapa.
- 🔒 **Invariante de concurrencia de subida** (§13.2): `mint-upload-url` da 409 si el agente ya
  tiene un video `uploading`/`processing` — scoped por `agent_id`. Un anunciante que además sea
  agente colisionaría → **resuelto** con tabla y scope propios (`agency_id` sobre `ad_creatives`).
- 🔒 **Duración de video de propiedad: 60–120s inclusive** (`videoStatusChecker`,
  `maxDurationSeconds=120` en Stream). Un anuncio de 90 segundos es impensable → regla propia (R2).
- 🔒 **Precios en tabla configurable, nunca en código** — PRD §17.2 · [[monetizacion-pago-por-video]].
- 🔒 **`app_config` es fail-closed** (RLS ON, SELECT solo `private.is_admin()`, escribe solo
  `service_role`) y ya es el lugar canónico de las perillas de negocio (`video_slot_free`,
  `lead_score_threshold_*`) → es donde van `ads_enabled`, `ad_frequency_n`, `ads_free`.
  ⚠️ Gotcha registrado: `12_stream_schema_test.sql` fija `count(*)=3` sobre `app_config` — al
  sembrar keys nuevas ese test se cae si no se actualiza.
- 🔒 **Moderación de propiedades SUSPENDIDA** por #153 (no hay moderador ni interfaz). No es una
  decisión de arquitectura, es una decisión operativa temporal — **no se hereda automáticamente
  a los anuncios** (R12: los anuncios SÍ se moderan siempre).
- ⚠️ **Deuda viva #116**: `users_select` expone email/teléfono/fecha de nacimiento de todo
  agente verificado a cualquier autenticado. No la agrava esto, pero **no denormalizar** datos
  de contacto de la organización hacia lecturas públicas sin pensarlo dos veces.
- 🔴 **NINGÚN flujo de invitación manda correo hoy** (hallazgo de la 2ª pasada, ver
  §"Invitación por correo"): `create-invitation` (#34) devuelve un **código** que la UI muestra
  una vez, y `admin-create-agency` usa `auth.admin.generateLink({type:'invite'})`
  (`_shared/clients.ts:180`) que **genera** el link pero **no lo envía**.
- 🔴 **El SMTP remoto (Resend) NO está configurado** — `docs/TODO-pendientes.md` §1 y §2: falta
  API key y dominio (~$10–15 USD/año). Es config externa que **solo Abraham destraba**; en modo
  prueba Resend solo envía a `swacg08@gmail.com`. Local ya está probado E2E con **Mailpit**
  (`localhost:54324`, patrón de 72.3/72.5).
- 🔒 **El mecanismo de re-consentimiento legal YA EXISTE y funciona** (#72.6): índice único
  parcial `terms_versions_one_current_per_doctype` (a lo más **una vigente por doc_type**), RPC
  `pending_legal_consents()`, y `legal-wall.tsx` como **muro inline, no ruta** (una ruta se
  esquiva con deep link). Publicar una versión nueva de `privacy` **fuerza re-aceptación a todos
  automáticamente** — el trabajo del gate legal es el TEXTO, no la maquinaria.
- ⚠️ **Column-grants de 0008**: impiden que incluso un admin con JWT toque `agencies.status`
  (Studio es la única ruta). Las columnas de capacidad deben quedar igual de cerradas.

## Arquitectura / enfoque técnico  (L/XL)

### Principio rector
**Reusar el pipeline, no las tablas.** El video del anuncio recorre exactamente el mismo camino
físico que el de una propiedad (Direct Creator Upload → Cloudflare Stream → webhook → URL
firmada RS256 con el token en el PATH), pero sus **invariantes de negocio son distintos**:
duración, concurrencia, moderación, autz y ciclo de vida. Compartir el *código* de
`_shared/clients.ts` es reuso; compartir la *tabla* `property_videos` es acoplamiento.

### 1. Creativo y pipeline de video

**DECIDIDO (R1, opción A):** tabla `ad_creatives` hermana + EF `mint-ad-upload-url`
(calco de `mint-upload-url` con scope `agency_id` y `maxDurationSeconds=30`) +
**extensión ADITIVA de `stream-webhook`**: hoy hace `UPDATE ... WHERE cloudflare_uid = $1`
sobre `property_videos`; pasa a intentar `property_videos` y, si afecta **0 filas**, intentar
`ad_creatives` (el "0 filas → 200 idempotente" ya es su comportamiento actual, así que la rama
nueva es puramente aditiva). **No rompe compat**: el webhook lo llama Cloudflare, no los builds
instalados. + EF `mint-ad-urls` (calco de `mint-poster-urls`: batch, autz **por item**,
fail-closed, nunca una URL sin firmar) reusando `sign_stream_token` / `build_poster_url`.

**Por qué NO reusar `property_videos` (opción B):** es la tabla más caliente del producto —
la tocan el feed, el wizard de publicación, la moderación, 4 EFs y una matriz de RLS que ya
tuvo que corregirse dos veces (#100, #103.1-A). Meter ahí filas que **no son de una propiedad**
obliga a que *toda* query existente filtre el tipo nuevo, y **cada una que se olvide es una fuga
en producción viva** (un anuncio apareciendo como video de propiedad, o al revés). El costo de
la opción A —una EF calcada y una rama en el webhook— es mucho menor que el de auditar todas
las lecturas de `property_videos`.

🔒 **Bonus que resuelve un invariante espinoso:** el 409 de concurrencia de `mint-upload-url`
está scoped por `agent_id` **sobre `property_videos`**. Como `ad_creatives` es una tabla
distinta, ese checker **nunca ve filas de anuncios** — un owner que además es agente puede tener
un video de propiedad en vuelo y subir un anuncio al mismo tiempo sin colisión, **sin tocar una
línea del checker existente**. El anuncio tiene su propio invariante, scoped por `agency_id`
sobre `ad_creatives`. Separación por dominio, no por condicionales.

### 2. Targeting: perfilar el LUGAR, no a la persona

**RPC nueva `ads_for_zone(p_lat, p_lng, p_neighborhood_id, p_municipality_id)`**, patrón de las
RPCs de #157/#40 (`security definer`, `search_path` fijo, `revoke execute from public, anon` +
`grant to authenticated`):

1. ⭐ **Manda la zona VISTA** (R9): si el usuario tiene colonia seleccionada o "buscar en esta
   zona" activo (#157/#56), esa zona gana sobre el GPS. Está viendo Zapopan aunque esté sentado
   en CDMX, y el anuncio relevante es el de Zapopan.
2. Sin zona activa → **GPS**: resuelve el punto contra `mx_neighborhoods.geom` con
   `ST_Intersects` (usa el GiST existente, `geography` sin casts) → `neighborhood_id` → su
   `municipality_id`.
3. ⭐ **Fallback por hueco del DCAH** (R10): si el punto no cae en ningún polígono (la cobertura
   es por entrega municipal, **no completa** — gotcha de #157), resolver el **municipio por los
   bboxes precalculados** (`mx_municipalities.bbox_min/max_lat/lng`) y servir el inventario
   **municipal + nacional**. 🔒 **Nunca "sin anuncios" por un hueco del dataset** — un agujero de
   cobertura no puede convertirse en pérdida de inventario vendido.
4. Devuelve los `ads` elegibles: `status='active'`, dentro de vigencia, creativo `ready`, con
   `ad_zones` que matcheen esa colonia **o** ese municipio, **o sin zonas = nacional** (R11).

🔒 **El cliente nunca declara en qué zona está** — manda coordenadas (o el id de zona que ya
está viendo) y el servidor decide. Eso hace que la zona registrada en la impresión no sea
manipulable, y es lo que permite decir con honestidad "perfilamos el lugar, no a la persona":
no existe ninguna estructura que acumule "las zonas que esta persona ha visto".

### 3. Inserción en el feed — **opción (c), recomendada**

Estado actual verificado del feed:
`mobile/src/features/feed/lib/feedProperties.ts:183` `fetchFeedProperties(cursor, deps, filters)`
→ RPC `properties_within_radius` → `{id, distance_m}[]` ordenado → **paginación por offset sobre
los ids** (`ids.slice(offset, offset+10)` → `.in('id', page)`) → EF `mint-video-url` en batch →
merge fail-closed. Lo consume `useFeedProperties.ts:46` y lo renderiza `FeedScreen.tsx:182`
(FlashList v2, `pagingEnabled` + `snapToInterval(height)`).

| Opción | Qué implica | Veredicto |
|---|---|---|
| **(a)** El cliente pide ads en paralelo y los intercala inline en el hook | Rápido, pero la lógica de intercalado y del frequency cap queda dentro de un hook con estado → difícil de testear y **cae fuera de la vía TDD crítica por path**. | Descartada |
| **(b)** La RPC del feed devuelve items mixtos | 🔴 Rompe el contrato `{id, distance_m}` de `properties_within_radius`, que consumen **feed Y mapa** y que ya está desplegada en el remoto. Cambio destructivo en producción viva. Además ata el inventario publicitario al ranking §9.8 (#74.3), que todavía no existe. | **Descartada** |
| **(c) RPC `ads_for_zone` separada + función pura `interleave_ads()` en `lib/`** | El feed no se entera de que existe publicidad hasta el último paso. `properties_within_radius` intacta. La lógica que decide **qué ve el usuario y qué se factura** queda en una función pura en `mobile/src/features/feed/lib/interleaveAds.ts` → **vía TDD CRÍTICA por regla determinista de path** (CLAUDE.md §5: `mobile/**/lib/**`), que es exactamente donde debe estar. Fail-soft trivial: si `ads_for_zone` falla o devuelve vacío, `interleave_ads(props, [])` devuelve `props` tal cual. | ⭐ **RECOMENDADA** |

**Contrato propuesto de la función pura:**
```
interleave_ads(
  properties: FeedPropertyWithUrl[],
  ads: FeedAd[],
  opts: { every_n, max_per_session, min_gap_between_repeats,
          already_shown_count, skip_first_position }
) → FeedItem[]
```
donde `FeedItem = { kind: 'property', … } | { kind: 'ad', … }`.

⚠️ **Costo honesto de (c):** el tipo del feed deja de ser homogéneo, y eso se propaga a
`renderItem`, `key_extractor`, `useFeedActiveIndex` (viewability al 70%) y a la remoción
optimista de `propertyEvents.ts`. Es un refactor de tipo que atraviesa el feed — **la parte más
riesgosa de todo el proyecto**, sobre la pantalla más importante y en producción viva. Mitigación
propuesta: `AdFeedItem` como componente **separado** de `VideoFeedItem` (no una rama dentro de
él), y **kill-switch `app_config.ads_enabled`** desde el primer commit, para que apagar la
publicidad no requiera publicar app.

### 4. Frequency cap — **parámetros DECIDIDOS** (R6/R7/R8)

| Regla | Valor decidido | Dónde vive |
|---|---|---|
| Cada cuántos items | **N = 8** | `app_config.ad_frequency_n` (**configurable**) |
| Máximo por sesión | **5** | `app_config.ad_max_per_session` |
| Posición 0 | **Nunca** un anuncio | constante en `interleaveAds.ts` |
| Repetición del mismo anuncio | **No antes de 2N items** (= 16 con N=8) | derivado de `ad_frequency_n` |
| Sin inventario para la zona | **Feed idéntico al actual** | fail-soft |

- **N configurable** porque la base se puebla poco a poco (0009): hoy hay pocas propiedades por
  zona y con N=4 el usuario vería casi tantos anuncios como casas. Recalibrar sin publicar app es
  un patrón ya vivo (`recompute_lead_levels` al cambiar `app_config`).
- **Nunca dos anuncios consecutivos** (se deriva de N≥2, pero se afirma como invariante propio).
- Con menos inventario que huecos, rotar respetando el mínimo de 2N; si solo hay **un** anuncio
  elegible, se muestra a lo más una vez cada 2N items.
- 🔒 **Sin anuncios → sin huecos, sin placeholders, sin skeletons de anuncio.** Un error o
  timeout de `ads_for_zone` **jamás** puede convertirse en un error del feed.

### 5. Medición — `ad_impressions` (R14 DECIDIDO: **tabla propia**)

Cuatro razones concretas para NO proyectarla sobre `events_raw`:

1. **Privacidad.** `events_raw_select` está gobernada por el *lead gate* (`can_view_user_events`,
   `20260809000001`) — una policy que ya tuvo una fuga medida en producción con un JWT real
   (75.3). Un anunciante no es agente ni tiene leads; darle acceso exigiría **una 4ª rama en
   exactamente esa policy**. Es el peor lugar del schema para experimentar.
2. **Forma de los datos.** `events_raw` tiene FKs a `properties`/`property_videos`/`users`; un
   anuncio no tiene `property_id`. Todo iría a `payload jsonb` → facturar en fase 2 significaría
   indexar y agregar sobre jsonb.
3. **Integridad de lo facturable.** `events_raw_insert` permite a cualquier `authenticated`
   insertar filas con `event_type` arbitrario. Sobre eso **no se puede facturar**.
4. **Ciclo de vida distinto.** Las impresiones se agregan y se purgan (retención); `events_raw`
   es el crudo de producto de §26.8.

*Contra-argumento honesto:* duplica el pipeline de telemetría que #112 ya construyó.
**Mitigación:** reusar del lado del cliente todo lo que ya existe —
`mobile/src/features/feed/lib/videoEngagementDedupe.ts` (umbral 0.95 de compleción, dedupe por
sesión), `lib/appSession.ts` (`session_id` a nivel de módulo) y el patrón fire-and-forget de
`useVideoEngagementEvents.ts` — y **la misma definición de "visto" (≥3s, §26.1)**, para que
"vista" signifique lo mismo en el reporte del anunciante y en el del agente.

**Escritura (R17 decidido):** EF `record-ad-impressions` — **batch, fire-and-forget**,
`service_role`, que **valida elegibilidad** antes de escribir (el ad existe, está `active`, está
dentro de vigencia, y la zona la **recalcula el servidor**, no la acepta del cliente). El `id` de
cada impresión lo genera el cliente (uuid v4) → **idempotencia** y posibilidad de hacer *upsert*
del `cta_tapped_at`, que ocurre después de que el batch ya salió.

**Lectura (R15/R16 decididos):** RPC `ad_metrics_for_agency(p_agency_id, p_from, p_to)` —
`security definer`, autz por `agency_role_of` + `org_can_advertise`, devuelve **solo agregados**.
🔒 **k-anonimato mínimo 5**: una zona con menos de 5 impresiones **no se desglosa** — se suma a un
bucket "otras zonas". Sin ese umbral, "1 impresión en la colonia X" es un dato casi personal.
🔒 `user_id` se guarda pero **jamás sale de la RPC**: no aparece en el resultado, ni siquiera
hasheado. Retención **90 días** de crudo + rollup mensual permanente (R18) — lo identificable
caduca, el agregado no. Guardar `user_id` (y no un hash irreversible) es lo que permite **cumplir
un derecho ARCO de eliminación**; un hash irreversible parecería más privado y haría imposible
borrar los datos de quien lo pida.

### 6. Compra del slot en beta (sin pasarela)

> Textual de Abraham: *"va a tener que funcionar temporalmente sin pasarela de pago, no se hará
> ningún pago en la beta pero dejar lista para conexión con pasarela"*.

`app_config.ads_free = true` (calco exacto de `video_slot_free`) + RPC
`grant_ad_slot_atomic(p_agency_id, p_creative_id, p_zones jsonb, p_days)` solo `service_role`:
crea el `ad`, sus `ad_zones` y la vigencia **en una transacción**, y audita en `admin_actions`.
`ads.purchase_id` queda **nullable y sin usar** → cuando #84 (Stripe) aterrice, el enganche es
**llenar una columna que ya existe**, no una migración de datos ni un cambio de contrato. El
precio ya vive en `ad_prices` desde la fase B, así que la pasarela no tiene que inventar cuánto
cobrar: lee el precio histórico vigente, exactamente como manda PRD §17 para las compras de video.

### 7. ⭐ Invitación por correo (R5) — pieza NUEVA, hallazgo de la 2ª pasada

**Estado real investigado — hoy NINGÚN camino manda correo:**

| Camino existente | Qué hace hoy | ¿Manda correo? |
|---|---|---|
| `create-invitation` (#34) | Genera un token **hasheado**; la UI del owner muestra el código/link **una sola vez** | ❌ No |
| `admin-create-agency` (#7) | `auth.admin.generateLink({type:'invite'})` en `_shared/clients.ts:180` → devuelve `action_link`, que la UI del admin muestra una vez | ❌ **No** — `generateLink` **genera**, no envía |

**La infraestructura de correo sí existe a medias** (#72.3/#72.5): GoTrue + SMTP, probado E2E en
local contra **Mailpit** (`localhost:54324`). Lo que falta es **config externa del remoto**, ya
registrada en `docs/TODO-pendientes.md` §1 y §2: **API key de Resend** (la cuenta existe) y un
**dominio** (~$10–15 USD/año) para poder enviar a usuarios que no sean `swacg08@gmail.com`.

**Opciones y recomendación:**
- **(a) [REC] `auth.admin.inviteUserByEmail(email, {redirectTo})`** en lugar de `generateLink`.
  Es literalmente el caso de uso para el que existe: GoTrue envía con su plantilla "Invite user"
  y el SMTP configurado. **Footprint mínimo** — cambia una llamada dentro de
  `_shared/auth_user.ts` / `clients.ts`, conserva la compensación `deleteUser` y toda la
  atomicidad de `admin_create_agency_atomic`. Las plantillas de GoTrue son personalizables desde
  el Dashboard, así que el branding no obliga a salirse.
- (b) EF `send-transactional-email` que llame la **API HTTP de Resend** con `RESEND_API_KEY` como
  secret. Más control de plantilla y **reusable** por el aviso "tu anuncio expira en 7 días"
  (fase D) y por #77. Más superficie que mantener; se vuelve la opción correcta **cuando** haya
  un segundo tipo de correo transaccional — hoy no lo hay.
- (c) statu quo (mostrar el link en pantalla) → **descartado por la decisión**.

🔴 **Escape hatch obligatorio para no bloquear la tarea A:** el envío se **construye y verifica
E2E en local con Mailpit** (patrón ya probado en 72.3/72.5), y el flip remoto queda como
**checklist de despliegue** dependiente de la config de Abraham. Así la tarea A se puede
completar y mergear; lo único que espera a Resend es la entrega a un buzón real en producción.
Se registra en `docs/TODO-pendientes.md`, que ya lista exactamente ese pendiente.

### 8. ⭐ Gate legal del aviso de privacidad (R26) — BLOQUEANTE para la salida de C

**Investigado: no existe ninguna tarea de rewrite del aviso.** Lo que existe es:
- `docs/aviso-privacidad.md` — **borrador completo** ya redactado.
- El **vigente** en `terms_versions` es un **placeholder de 113 caracteres** que personas reales
  ya aceptaron ([[privacidad-datos]], deuda 🟡).
- ✅ **La maquinaria de versionado y re-aceptación ya está viva y probada** (#72.6): índice único
  parcial "a lo más una vigente por `doc_type`", RPC `pending_legal_consents()`, y
  `legal-wall.tsx` como **muro inline** montado en 3 consumidores.

**Consecuencia:** el gate es de **contenido y aprobación**, no de ingeniería. Publicar una fila
nueva de `privacy` es una migración de seed trivial; redactar el tratamiento publicitario
(qué se registra, para qué, cuánto se conserva, que no se perfila a la persona, que el anunciante
solo ve agregados) y aprobarlo es el trabajo real. **Entra como subtarea explícita de la tarea C
con aprobación de Abraham**, y su efecto secundario está aceptado conscientemente: publicar una
versión nueva **fuerza re-consentimiento a todos los usuarios vivos**.

## Fases / épicas  (L/XL)

**Corte DECIDIDO (R25): 4 tareas encadenadas A→B→C→D + E como `deferred`.** No una épica XL:
una tarea = una rama = un PR (CLAUDE.md §5.7). **Prioridad (R27): después de cerrar la Ola 1**
(#74/#75) — vender inventario sin audiencia es prematuro.

### A — `feat: organización con capacidad de publicidad + invitación por correo`
**Nivel L · prioridad `medium` · deps: 71 (done), 74, 75** *(74/75 son orden de prioridad, no
dependencia técnica: técnicamente A podría arrancar hoy).*

| Footprint previsto | Criticidad TDD (regla por path, §5) |
|---|---|
| `supabase/migrations/2026…_org_advertising_capability.sql` (+rollback) | 🔴 **CRÍTICA** |
| `supabase/migrations/2026…_set_org_advertising_rpc.sql` (+rollback) | 🔴 **CRÍTICA** |
| `supabase/tests/NN_org_advertising_test.sql` (pgTAP) | RED |
| `supabase/functions/_shared/auth_user.ts`, `_shared/clients.ts` (invite → correo) | 🔴 **CRÍTICA** |
| `supabase/functions/admin-create-agency/` (params de capacidad) | 🔴 **CRÍTICA** |
| `docs/TODO-pendientes.md` (checklist de flip remoto de Resend) | ligera |

### B — `feat: anuncios — creativo 6–30 s, campaña por zona y moderación admin`
**Nivel L · prioridad `medium` · deps: A, 157 (done), 68 (done)**

| Footprint previsto | Criticidad TDD |
|---|---|
| Migraciones `ad_creatives`, `ads`, `ad_zones`, `ad_prices` + máquina de estados por trigger + `grant_ad_slot_atomic` (+rollbacks, +pgTAP) | 🔴 **CRÍTICA** |
| `supabase/functions/mint-ad-upload-url/` (nueva) | 🔴 **CRÍTICA** |
| `supabase/functions/stream-webhook/` (rama aditiva por `cloudflare_uid`) | 🔴 **CRÍTICA** + no-regresión |
| `supabase/functions/mint-ad-urls/` (nueva, calco de `mint-poster-urls`) | 🔴 **CRÍTICA** |
| `mobile/src/features/ads/lib/validation.ts` (duración, CTA, zonas) | 🔴 **CRÍTICA** (`**/validation*`) |
| `mobile/src/features/ads/hooks/useAdUpload.ts` | 🔴 **CRÍTICA** (`**/hooks/**`) |
| `mobile/app/(protected)/ads/new/*.tsx` (wizard) | ligera |

### C — `feat: anuncios en el feed — inserción, impresiones, kill-switch y aviso de privacidad`
**Nivel L · prioridad `medium` · deps: B** · 🔴 **gate de diseño** + 🔴 **gate legal**
*(la de mayor riesgo de producto de las cuatro)*

| Footprint previsto | Criticidad TDD |
|---|---|
| Migración RPC `ads_for_zone` + `ad_impressions` + `ad_impressions_monthly` + purga (+rollback, +pgTAP) | 🔴 **CRÍTICA** |
| `supabase/functions/record-ad-impressions/` (nueva) | 🔴 **CRÍTICA** |
| `mobile/src/features/feed/lib/interleaveAds.ts` (**puro**) | 🔴 **CRÍTICA** (`**/lib/**`) |
| `mobile/src/features/feed/lib/adImpressionQueue.ts` (batch + dedupe) | 🔴 **CRÍTICA** |
| `mobile/src/features/feed/hooks/useFeedProperties.ts` (composición) | 🔴 **CRÍTICA** (`**/hooks/**`) |
| `mobile/src/features/feed/components/AdFeedItem.tsx`, `FeedScreen.tsx` | ligera |
| Migración de seed `terms_versions` con el aviso nuevo | 🔴 **CRÍTICA** |
| `docs/aviso-privacidad.md` (texto) | ligera (pero **gate de aprobación**) |

### D — `feat: panel del anunciante — mis anuncios y métricas por zona`
**Nivel M · prioridad `medium` · deps: C**

| Footprint previsto | Criticidad TDD |
|---|---|
| Migración RPC `ad_metrics_for_agency` (k-anonimato 5) (+rollback, +pgTAP) | 🔴 **CRÍTICA** |
| `mobile/src/features/ads/hooks/useAdMetrics.ts` | 🔴 **CRÍTICA** |
| `mobile/app/(protected)/ads/index.tsx` + componentes | ligera |
| Aviso de expiración → fila en `notifications` (sin push hasta #77) | ligera |

### E — `feat: publicidad fase 2 — CPM/CPC, subasta y antifraude`
**Nivel XL · estado `deferred` · deps: D, 76, 84.** Se crea **ahora** aunque no se trabaje, para
que el destino quede escrito y `ad_impressions` no parezca sobre-ingeniería en una revisión futura.

## Criterios de aceptación

> ✅ **Completos y verificables.** Cada criterio es observable (una query, un test, una pantalla)
> y no depende de ninguna decisión pendiente. El desglose fino en subtareas lo hace `/tm-plan` al
> promover.

### Tarea A — organización con capacidad de publicidad + invitación por correo

**Migración y compatibilidad**
- [ ] `agencies` gana `can_publish_properties` (default `true`), `can_advertise` (default
      `false`) y `advertiser_category` (nullable). La migración es **idempotente**, tiene
      rollback probado y pgTAP en verde.
- [ ] 🔴 **Toda fila de `agencies` preexistente queda en `(true, false, null)` sin backfill** y
      se comporta **exactamente** igual que antes: un test de no-regresión publica una propiedad
      con una organización preexistente y pasa sin cambios.
- [ ] El CHECK `agencies_al_menos_una_capacidad` rechaza `(false, false)` con error explícito.
- [ ] `select('*')` sobre `agencies` sigue funcionando desde un cliente v1.0.x (compat hacia
      atrás, §0.5 regla 2): el embed `agencies!properties_agency_id_fkey` de `usePropertyDetail`
      devuelve las columnas nuevas sin romper el parseo.

**Seguridad de la capacidad**
- [ ] 🔴 Un `authenticated` —incluido el **owner de la propia organización**— **no puede** poner
      `can_advertise = true` por PostgREST. Verificado por impersonación con JWT real, no leyendo
      la policy. (Si el grant de 0008 lo permite, la migración revoca esas columnas.)
- [ ] `set_org_advertising_atomic` es ejecutable **solo por `service_role`**
      (`revoke execute from public, anon, authenticated`), enciende/apaga la capacidad y escribe
      **una** fila en `admin_actions` en la misma transacción; fault-injection demuestra rollback
      total (patrón `38_property_video_slots_test.sql`).
- [ ] `private.org_can_advertise(id)` devuelve `false` para: organización inexistente,
      `deleted_at` no nulo, `status != 'active'`, y `can_advertise = false`. Cuatro asserts.

**Alta y membresía (reuso de #71)**
- [ ] `admin_create_agency_atomic` acepta los dos params de capacidad **con DEFAULT al final**;
      llamarla con la firma vieja produce **el mismo resultado que hoy** (contrato publicado
      intacto).
- [ ] Se puede crear una organización **solo-publicidad** (`can_publish_properties=false`,
      `can_advertise=true`) y su owner **no puede publicar propiedades** (la RLS/RPC de
      publicación lo bloquea con código explícito).
- [ ] 🔒 El invariante "**máx 1 organización activa por persona**" sigue vigente y **no se
      duplicó** en ninguna tabla nueva: `agency_members_one_active_per_user` es el único índice
      que lo sostiene.
- [ ] Una persona que es agente de una inmobiliaria con `can_advertise=true` **no** gana por eso
      ninguna capacidad sobre `leads`, `properties` ni `events_raw` de otros (no-regresión).

**Invitación por correo (pieza nueva)**
- [ ] Dar de alta una organización **envía un correo real de invitación** al owner, verificado
      **E2E en local contra Mailpit** (`localhost:54324`): el correo llega, su link abre la app y
      deja sesión iniciada.
- [ ] Si el envío del correo falla, la operación **no deja basura**: se conserva la compensación
      `deleteUser` y la atomicidad de la RPC (fault-injection).
- [ ] El `action_link` **deja de mostrarse como único canal** en la UI del admin (puede quedar
      como respaldo, pero el camino primario es el correo).
- [ ] El pendiente de **config remota de Resend** queda registrado en `docs/TODO-pendientes.md`
      con el checklist de flip; la tarea **no** se bloquea por él.

### Tarea B — creativo, campaña, targeting y moderación

**Creativo**
- [ ] Un creativo recorre `uploading → processing → ready` contra el **webhook real de Stream**
      (verificado en local, no contra un mock).
- [ ] 🔴 **No-regresión de `stream-webhook`**: los videos de propiedad se resuelven exactamente
      igual que hoy; la rama de anuncios solo se alcanza cuando el UPDATE sobre `property_videos`
      afecta **0 filas**. La suite Deno existente pasa sin modificarse.
- [ ] 🔒 Subir un anuncio **no** dispara el 409 de concurrencia de `mint-upload-url` aunque el
      mismo usuario tenga un video de propiedad en vuelo (test explícito de la separación por
      dominio).
- [ ] Un creativo con duración **fuera de 6–30 s** se rechaza con código propio
      (`AD_DURATION_INVALID`), tanto al elegir el archivo en el cliente como al pasar a `ready`
      en el servidor.
- [ ] `mint-ad-urls` **nunca** devuelve una URL sin firmar; la autz es fail-closed **por item**
      (patrón `mint-poster-urls`).

**Campaña y targeting**
- [ ] `grant_ad_slot_atomic` crea `ad` + sus `ad_zones` + la vigencia + la auditoría en **una**
      transacción; fault-injection demuestra rollback total.
- [ ] Un `ad` **sin filas en `ad_zones`** es válido y significa **inventario nacional**.
- [ ] `ad_zones` rechaza una fila con municipio **y** colonia, y una con ninguno de los dos.
- [ ] `ad_prices` existe con los 3 alcances sembrados; **ningún precio está hardcodeado en
      código** (grep sin resultados sobre montos en TS/SQL fuera de la tabla).
- [ ] `ads.purchase_id` existe, es nullable y **queda NULL en toda la beta**.

**Moderación**
- [ ] 🔴 Un anuncio **jamás** se sirve sin pasar por `pending_review → active` ejecutado por un
      admin, aunque su vigencia ya haya empezado.
- [ ] Las transiciones inválidas las bloquea un **trigger** de máquina de estados (no solo el
      cliente): `draft → active` directo falla; un estado terminal no se reabre.
- [ ] **Todas** las transiciones de moderación escriben en `admin_actions`; si la auditoría
      falla, la transición falla (no es best-effort — mismo criterio que `moderate-property`).
- [ ] El owner de la organización **no puede** poner su propio anuncio en `active` por ninguna
      ruta (PostgREST, RPC, EF). Verificado por impersonación.
- [ ] `rejected` exige `rejection_reason` no vacío.

**Cliente**
- [ ] El wizard de subida solo es accesible si la organización del usuario tiene
      `can_advertise = true`; sin la capacidad, la ruta no existe (no basta con ocultar el botón).
- [ ] `pnpm tsc --noEmit` y `pnpm lint` en verde.

### Tarea C — inserción en el feed, impresiones y gate legal

**Kill-switch y no-regresión (lo primero que debe existir)**
- [ ] 🔴 Con `app_config.ads_enabled = false`, el feed es **funcionalmente idéntico** al actual:
      la suite completa de feed existente pasa **sin modificarse**, y no se emite ninguna llamada
      a `ads_for_zone` ni a `record-ad-impressions`.
- [ ] El kill-switch se puede accionar **sin publicar app** (es `app_config`, no una constante).
- [ ] ⚠️ El test `12_stream_schema_test.sql` (que fija `count(*)` sobre `app_config`) se
      actualiza al sembrar las keys nuevas.

**Intercalado (`interleaveAds.ts`, función pura)**
- [ ] `interleave_ads(props, [], opts)` devuelve **la misma lista** (mismo orden, misma longitud).
- [ ] **Nunca** hay un anuncio en la posición 0.
- [ ] **Nunca** hay dos anuncios consecutivos.
- [ ] Con N=8, entre dos anuncios hay **al menos 8** propiedades.
- [ ] El mismo anuncio **no se repite antes de 2N (16) items**, ni siquiera cuando es el único
      elegible.
- [ ] Nunca se superan **5 anuncios por sesión**, contando a través de páginas y de refetch.
- [ ] N y el cap se leen de `app_config`; cambiarlos altera el resultado sin recompilar.
- [ ] La función es determinista: misma entrada → misma salida (testeable sin mocks de tiempo).

**Targeting y servido**
- [ ] Con una **zona activa** (colonia de #157 o "buscar en esta zona"), los anuncios servidos
      corresponden a **esa** zona y no a la del GPS.
- [ ] Sin zona activa, el servidor resuelve la colonia por `ST_Intersects`.
- [ ] 🔒 Un punto **fuera de todo polígono** del DCAH devuelve inventario **municipal (por bbox)
      + nacional** — nunca lista vacía por hueco de cobertura.
- [ ] Un anuncio cuyo creativo pasó a `failed`, o cuya vigencia expiró, **deja de servirse**.
- [ ] 🔴 Un error, timeout o respuesta malformada de `ads_for_zone` produce **feed normal sin
      anuncios**, nunca un error visible ni un skeleton colgado.

**Impresiones**
- [ ] Una exposición genera **exactamente una** fila pese a que el feed reproduce **en loop**
      (dedupe por `(session_id, ad_id)` — la trampa exacta que documentó #112).
- [ ] `viewed` se marca con el **mismo umbral ≥3 s** de §26.1 y `completed` con ≥95 % (§26.3).
- [ ] 🔴 La zona guardada la **recalcula el servidor**: una petición que declare otra zona no
      altera lo que queda en la fila.
- [ ] La EF **rechaza** impresiones de un ad inexistente, no `active` o fuera de vigencia.
- [ ] Reenviar el mismo batch (reintento) **no duplica filas** (idempotencia por `id` de cliente).
- [ ] El tap al CTA hace **upsert** sobre la impresión correcta aunque el batch ya se haya
      enviado; un doble tap no crea dos registros.
- [ ] 🔴 `select * from ad_impressions` con **cualquier** JWT `authenticated` devuelve **0 filas**;
      `anon` recibe `permission denied`. Verificado por impersonación.
- [ ] Estar offline **pierde** el batch sin romper la reproducción (subcontar es el error
      correcto; sobrecontar no).
- [ ] El job de retención purga crudo >90 días y el rollup mensual conserva los agregados.

**UI y gates**
- [ ] El badge **"Patrocinado"** es visible durante **toda** la reproducción, no solo al inicio.
- [ ] El CTA abre el destino correcto según `cta_type` (URL externa / WhatsApp / teléfono) y
      degrada con un mensaje si no hay app destino.
- [ ] 🔴 **Gate de diseño cerrado**: preview HTML del `AdFeedItem` aprobado por el cliente
      **antes** de portar a RN (método §8).
- [ ] 🔴 **Gate legal cerrado**: hay una versión nueva y vigente de `privacy` en `terms_versions`
      que **describe el tratamiento publicitario**, aprobada por Abraham, y el muro legal
      (`legal-wall`) pide re-aceptación a los usuarios existentes.
- [ ] Verificado en emulador **por CLI** (adb / simctl), terminando en `stopApp` — reproducir el
      anuncio quema cuota real de Stream.

### Tarea D — panel del anunciante

- [ ] El anunciante ve, de **sus** anuncios: estado, vigencia, **impresiones**, **vistas ≥3 s** y
      **taps al CTA**, con desglose por zona. Sin gráficas.
- [ ] 🔴 El anunciante **no puede** obtener ninguna fila individual de `ad_impressions` por
      ninguna ruta (PostgREST, RPC, EF). Verificado por impersonación.
- [ ] 🔒 **k-anonimato**: una zona con **menos de 5** impresiones no se desglosa; se agrupa en
      "otras zonas". Test con 4 y con 5 impresiones (frontera inclusiva).
- [ ] `user_id` **no aparece** en ningún campo de la respuesta de `ad_metrics_for_agency`, ni
      siquiera hasheado.
- [ ] Una organización **no** ve las métricas de otra: anti-IDOR con **0 filas / 404**, nunca un
      403 informativo que confirme la existencia del recurso.
- [ ] Un miembro `viewer` puede **leer** las métricas; un miembro `suspended` **no**.
- [ ] La entrada a la pantalla solo aparece si la organización tiene `can_advertise = true`.
- [ ] Un anuncio próximo a expirar genera una fila en `notifications` (sin push hasta #77).

## Dependencias

**Listas hoy (todas `done`) — nada del camino crítico está bloqueado:**
- **#71** — patrón multi-tenant completo: `agencies`/`agency_members`, `agency_role_of`,
  `can_manage_agency_member`, `admin_create_agency_atomic`, `manage-agency-member`,
  `create-invitation`/`redeem-invitation`, triggers de máquina de estados + `admin_actions`
  (`20260805000001`–`000011`). ⭐ **Ya no es "la plantilla" de la fase A: es la implementación.**
  Tras la decisión R3/R4 no se calca nada — se **extiende** lo que ya existe.
- **#72 / #72.3 / #72.5** — infraestructura de correo (GoTrue + SMTP, deep links, Mailpit local).
  Es lo que hace viable la invitación por correo **en local**; el flip remoto espera config
  externa de Abraham (Resend), ya registrada en `docs/TODO-pendientes.md`.
- **#72.6** — versionado legal + re-aceptación (`terms_versions`, `pending_legal_consents`,
  `legal-wall`). La maquinaria del gate legal de la fase C **ya existe y está probada**.
- **#68** — pipeline Cloudflare Stream: `mint-upload-url`, `stream-webhook`, `mint-video-url`,
  `mint-poster-urls`, `sign_stream_token`/`build_poster_url` en `_shared/clients.ts`.
- **#112** — telemetría de video en el cliente: `useVideoEngagementEvents`,
  `videoEngagementDedupe`, `appSession`.
- **#157** — catálogo geo nacional: `mx_municipalities` (2,478 + bboxes), `mx_neighborhoods`
  (75,516 polígonos, GiST sobre `geography`), RPCs `search_places`,
  `properties_within_neighborhood`, `get_neighborhood_geojson`; cliente `placeSearch.ts`,
  `usePlaceSearch`, `MapSearchSuggestions`.
- **#69** — R2 presigned (`mint-r2-url`) para el logo del negocio.
- **#40 / #42 / #56 / #62** — el feed por cercanía y su paginación por offset.

**Pendientes que NO bloquean fase 1:**
| Épica | Relación | ¿Bloquea? |
|---|---|---|
| **#76** — modelo de pagos (`purchase`/`video_slot`) | El slot se otorga a mano por admin, gratis por flag; enganche = `ads.purchase_id` nullable + precio en `ad_prices`. | **No** |
| **#84** — Stripe (Ola 4) | Bloquea el **cobro real**, no la fase 1. Su trabajo se reduce a **llenar `purchase_id`** y leer `ad_prices`. | **No** |
| **#74 / #75** — cierre de la Ola 1 | ⭐ **Orden de prioridad decidido (R27)**: esto va DESPUÉS. Se expresa como `dependencies` de la tarea A para que `task-master next` respete el orden, aunque técnicamente A podría arrancar hoy. | **Sí, por prioridad** |
| **#80** — métricas/eventos (`events_raw`, view ≥3s) | `ad_impressions` es independiente **a propósito** (ver §5). Conviene alinear la definición de "visto" ≥3s. | **No** |
| **#77** — notificaciones | "Tu anuncio expira en 7 días" se inserta en `notifications` (tabla 0007, existe); el **push** llega con #77. | **No** |
| **#81** — panel admin web | La moderación en beta se hace por Studio/SQL, igual que #71.5 y #153. | **No** |
| **#74.3** — ranking §9.8 | 🔒 **Contrato de convivencia:** los anuncios se intercalan **después** de que el ranking ordena. `interleave_ads` opera sobre una lista ya ordenada → #74.3 y esto no se pisan. | **No** |
| **#153** — moderación suspendida | Decisión operativa temporal de propiedades; **no se hereda automáticamente** — R12: los anuncios SÍ se moderan siempre. | **No** |
| **#116** — deuda de privacidad en `users_select` | No la agrava; sí obliga a no denormalizar contacto del negocio a lecturas públicas. | **No** |

## Edge cases / riesgos

**Riesgos mayores**
1. 🔴 **Degradar el feed.** Es el corazón del producto y está en producción con testers reales.
   Un anuncio repetido, en posición 0, sin video listo o con URL vencida es lo primero que hace
   que la app se sienta spam — y ese daño de percepción no se revierte con un hotfix.
   *Mitigación:* fail-soft absoluto + kill-switch `ads_enabled` desde el primer commit +
   preview aprobado antes de portar.
2. 🔴 **Vender inventario antes de tener audiencia.** El reporte honesto de fase 1 puede decir
   "tu video se vio 40 veces" — y eso quema una relación comercial que costó meses. Riesgo de
   negocio, no técnico. *Mitigación:* precio y expectativa de "early partner" explícitos; el
   reporte por zona es precisamente lo que hace defendible un número chico.
3. 🔴 **Impresiones falsificables.** Si la escritura pasara por RLS de cliente (como `events_raw`
   hoy), la fase 2 facturaría sobre datos que el cliente puede fabricar. *Mitigación:* EF con
   `service_role` + validación de elegibilidad **desde el día 1**, no cuando se empiece a cobrar.
4. 🟡 **Costo variable de Stream.** Un anuncio cada N items × todos los usuarios × todas las
   sesiones = minutos facturados que crecen con el éxito del feed. *Mitigación:* el costo entra
   en el precio del slot, y el cap por sesión lo acota.
5. 🟡 **Exposición legal/privacidad.** El aviso de privacidad vigente es un **placeholder de 113
   caracteres** que personas reales ya aceptaron ([[privacidad-datos]]). Publicidad + medición
   sin declararlo es exposición real. *Mitigación:* gate legal **bloqueante** en la fase C.
   **Costo aceptado conscientemente:** publicar el aviso nuevo **fuerza re-consentimiento a todos
   los usuarios vivos** — hay que elegir el momento (no en vísperas de una demo con inversores).
6. 🟡 **Refactor del tipo del feed.** Volver heterogénea la lista toca viewability, keys,
   remoción optimista y la suite de tests más grande del móvil.
7. 🟡 **Dependencia de config externa para el correo.** La invitación se puede construir y probar
   en local (Mailpit), pero **no llega a un buzón real** hasta que existan la API key de Resend y
   un dominio (~$10–15 USD/año). *Mitigación:* escape hatch declarado — la tarea A cierra con
   verificación local y el flip remoto queda como checklist en `docs/TODO-pendientes.md`, que ya
   lista ese pendiente desde 2026-07-31.
8. 🟡 **Escalación de privilegios por la capacidad.** `can_advertise` vive en una tabla que los
   owners ya actualizan parcialmente. Si el column-grant de 0008 no la cubre, un owner podría
   encenderse a sí mismo una capacidad **facturable**. *Mitigación:* criterio de aceptación
   explícito en la tarea A, verificado por impersonación con JWT real.

**Edge cases**
- El punto GPS no cae en ninguna colonia del DCAH (cobertura por entrega municipal, **no
  completa** — gotcha de #157) → **resuelto**: municipio por bbox + inventario nacional.
- El creativo pasa a `failed` **mientras** el anuncio está activo → debe dejar de servirse sin
  romper el feed (`ads_for_zone` exige creativo `ready`).
- El anuncio expira **entre** que el cliente pide la página y que el usuario llega a él → la
  impresión se registra pero la EF la rechaza por vigencia. ¿Se pierde o se cuenta? Decidir.
- El negocio se suspende con anuncios activos → deben dejar de servirse (¿y la vigencia pagada
  se pausa o se pierde?).
- Menos anuncios elegibles que huecos disponibles → rotación sin repetición consecutiva.
- El usuario cambia de zona a media sesión (viaja, o busca en otra zona) → el cap por sesión se
  conserva, el inventario cambia.
- Usuario **sin permiso de ubicación**: hoy el feed está tras un `LocationWall` (#41), así que
  siempre hay coordenadas — pero si eso cambia, ads sin zona = sin ads.
- `ad_impressions` en offline → el batch se pierde (fire-and-forget). Aceptable: **subcontar** es
  el error correcto en algo facturable; sobrecontar no lo es.
- Doble tap al CTA → `cta_tapped_at` es idempotente por el `id` generado en cliente.
- Un CTA `external_url` apunta a un sitio malicioso o caído → el gate es la moderación admin obligatoria (R12).

## Plan de pruebas (alto nivel)

**Vía CRÍTICA (TDD estricto RED → GREEN → guardian; regla determinista por path, CLAUDE.md §5):**
- `supabase/migrations/**` → **pgTAP** por migración: shape, constraints, invariantes, y **RLS
  verificada por impersonación con JWT reales**, no leyendo la policy. Ancla obligatoria: *"un
  `authenticated` cualquiera obtiene 0 filas de `ad_impressions`"*.
- `supabase/functions/**` → **Deno** con DI pura: `mint-ad-upload-url`, `mint-ad-urls`,
  `record-ad-impressions` (elegibilidad, idempotencia, batch parcial), y **no-regresión de
  `stream-webhook`** (la rama de propiedad intacta).
- `mobile/**/lib/**` y `mobile/**/hooks/**` → **Jest**: `interleaveAds.ts` es el corazón —
  frecuencia, cap, no-consecutivos, no-posición-0, inventario insuficiente, lista vacía,
  idempotencia; y el dedupe de impresiones bajo **loop** (la trampa de #112).
- Fault-injection en las RPCs atómicas (`set_org_advertising_atomic`, `grant_ad_slot_atomic`)
  para demostrar rollback total — patrón ya usado en `38_property_video_slots_test.sql`.

**Verificación ligera** (`pnpm tsc --noEmit` + `pnpm lint` + smoke): `AdFeedItem`, pantalla de
"Mi negocio", wizard de subida.

**⚠️ Lección de #73 aplicada aquí.** Los 3 defectos críticos que se escaparon con toda la suite
mockeada en verde fueron **adaptadores que proyectaban o transformaban datos cuyo shape define
otro componente**. En este proyecto los candidatos exactos son: el cableo params→RPC de
`ads_for_zone`, el despacho por `cloudflare_uid` del webhook extendido, y la proyección de
`ad_impressions` → reporte agregado. **Los tres exigen verificación contra el stack local real,
no contra dobles.**

**Smoke / E2E:** emulador **solo por CLI** (`adb` / `xcrun simctl` / Maestro, **nunca**
computer-use — CLAUDE.md §3), y **terminar en `stopApp`**: reproducir el video del anuncio quema
cuota real. Verificar que reproduce y **PARAR**.

**Datos de prueba:** negocio + creativo + campaña sembrados **en local**, nunca contra el remoto
(0009 regla 1).

## Impacto en PRD (solo referencia — NO se edita)

Hoy **no existe** ninguna sección de publicidad en `docs/PRD.md`. Si esto se aprueba, una
eventual actualización (decisión de Abraham, fuera de esta exploración) necesitaría:

- **§ NUEVA propuesta — "Publicidad y cuentas comerciales"**, ubicada después de §17 (modelo
  comercial): la **capacidad `can_advertise`** sobre la organización, categorías, formato del anuncio, marca "Patrocinado"
  obligatoria, targeting por zona, frequency cap, unidad de venta de fase 1 y el camino a
  CPM/CPC. Es la sección madre; el resto son referencias cruzadas.
- **§4.1** (jerarquía de roles) — nota aclaratoria: el anunciante **no** es un rol nuevo, es una
  membresía en una entidad organizacional, igual que la inmobiliaria.
- **§9.8** (ranking del feed) — punto nuevo: los anuncios se intercalan **después** del ranking,
  no compiten en él.
- **§17** (modelo comercial) — segunda línea de ingreso junto al pago por video.
- **§19** (privacidad) — qué se registra de una impresión, qué ve el anunciante (solo agregados)
  y retención.
- **§26** (métricas) — `ad_impressions` como fuente separada de `events_raw`, con la definición
  de "visto" **compartida** (≥3s).
- **§28** (panel admin) — pantalla de moderación de anuncios y alta de negocios.
- **`docs/Alineacion.md`** — hoy lista "Publicidad" como ❌ *No incluye* en MVP y "Monetización /
  Alianzas con negocios" solo como bullet del Paso 4. Aprobar esto **mueve la línea**: es un
  cambio de alcance del producto, no una feature más.

## Decisiones del intake

Tomadas por **Abraham el 2026-08-14**. 🔴 Son **restricciones fijas**: no se cuestionan ni se
re-preguntan en pasadas futuras.

| # | Decisión | Consecuencia en el plan |
|---|---|---|
| **1** | **Formato = video vertical nativo en el feed**, marcado "Patrocinado", intercalado cada N items. Reusa TODO el pipeline de video existente (Cloudflare Stream, `mint-upload-url`/`stream-webhook`, feed vertical, `expo-video`). **NO banners, NO directorio** en fase 1. | Define la fase C y descarta de entrada 4 formatos alternativos. El "reusa TODO el pipeline" se interpreta como **reusar el código y el camino físico**, con tabla propia — ver R1. |
| **2** | **Cobro = FASE 1 vigencia fija** (slot de N días por zona a precio fijo; reusa `purchase`/`video_slot` de §17.7 y la infra de Ola 4 Stripe #76/#84) → **FASE 2 CPM/CPC**. 🔴 **Requisito explícito de escalabilidad:** el tracking de impresiones se construye **DESDE FASE 1 aunque no se cobre por él** — en fase 1 alimenta el reporte ("tu video se vio X veces en Zapopan"), en fase 2 esa misma tabla se vuelve la base facturable. Lo diferido es **subasta/antifraude/presupuesto/pacing, NO la medición**. | `ad_impressions` entra en la fase C, no en la E. Y como será facturable, su escritura va por EF `service_role` desde el día 1 (no por RLS de cliente como `events_raw`). |
| **3** | **Targeting = por zona geográfica** (municipio y/o colonia) reusando `mx_municipalities`/`mx_neighborhoods` de #157. **Perfila el LUGAR, no a la persona** (CLAUDE.md §0.5 regla 4, [[privacidad-datos]]). Puerta abierta a "zona + contexto de propiedad" (venta→hipotecario, renta→seguro) como fase posterior. **Perfil de usuario/comportamiento DESCARTADO.** | `ad_zones` + RPC `ads_for_zone` con resolución **server-side** del punto. No existe ninguna estructura que acumule el historial de zonas de una persona. `advertiser_category` queda cableada para la fase posterior. |
| **4** | **Modelo = entidad tipo inmobiliaria**: owner/member, invitaciones, RLS, calcando el patrón de #71. La persona conserva su rol normal y ADEMÁS administra su organización. **NO es un rol nuevo en el enum.** | Fase A. El enum `user_role` (user/agent/admin) **no se toca**. ⚠️ **Refinado en la 2ª pasada (R3/R4): ya no se "calca" #71 — se EXTIENDE.** |

### 2ª pasada — las 27 respuestas (2026-08-14, 4 rondas)

🔴 También son **restricciones fijas**. ⭐ = cambia el diseño de la 1ª pasada.

**G1 — Creativo**
- **R1.** Tabla propia `ad_creatives` + `stream-webhook` extendido aditivamente.
- **R2.** Duración **6–30 s** (distinta del 60–120 s de propiedades).

**G2 — Entidad** ⭐ *(el cambio grande)*
- **R3/R4.** ⭐ **La entidad NO es nueva ni excluyente: se generaliza `agencies` a "organización
  con capacidades"** (`can_publish_properties` + `can_advertise`; migración **aditiva** con
  default = comportamiento actual). Una inmobiliaria **activa publicidad sobre su misma cuenta**,
  sin crear otra entidad; una cuenta solo-publicidad es una organización con solo `can_advertise`.
  **Se reusa TODA la membresía/invitaciones/RLS de #71.** Se mantiene **máx 1 organización por
  persona**. Nota textual: *"solo la inmobiliaria podrá hacer upgrade o añadir ese permiso de
  publicidad"* — el nivel de la capacidad es la **organización**, un agente individual no puede
  activarla. Advertencia recibida y atendida: **ojo al invariante de subida concurrente scoped
  por `agent_id`** → se separa por dominio (tabla propia), no por condicionales.
- **R5.** ⭐ Alta **por invitación** (el admin crea la organización, el owner entra por
  invitación) **PERO la invitación debe llegar por CORREO ELECTRÓNICO** — hoy no existe ese
  camino → pieza nueva dentro de la tarea A (ver §7 del enfoque técnico).
  **Activación de `can_advertise` en una inmobiliaria existente:** en beta **la enciende el admin
  de Urbea** (el owner la solicita); en fase 2 la enciende el pago.

**G3 — Feed**
- **R6/R7/R8.** N configurable en `app_config`, **default 8**; **máx 5 por sesión**; **nunca
  posición 0**; **no repetir el mismo anuncio en <2N items**; sin anuncios para la zona → **feed
  idéntico al actual**.
- **R9.** Manda la **zona VISTA** (colonia/municipio activo de #157); el GPS solo si no hay zona.
- **R10/R11.** **Sí hay inventario nacional** (`ad_zones` vacío = nacional). Punto fuera de todo
  polígono → **municipio por bbox precalculado** + municipales y nacionales. **Nunca "sin
  anuncios" por un hueco del DCAH.**

**G4 — Moderación**
- **R12.** **SÍ, aprobación admin SIEMPRE**, pese a #153.
- **R13.** Studio/SQL + trigger de máquina de estados + `admin_actions` (calcando 71.5); UI en
  #81 después. Estados: `draft → pending_review → active → paused | expired | rejected`
  (**sin `approved` intermedio**).

**G5 — Medición y privacidad**
- **R14.** Tabla propia `ad_impressions`, escrita **solo por EF `service_role`** que valida
  elegibilidad.
- **R15/R18.** `user_id` + `session_id`, **nunca expuestos al anunciante** (solo agregados);
  retención **90 d de crudo + rollup mensual**.
- **R16.** **k-anonimato mínimo 5** en el desglose por zona.
- **R17.** Envío en **batch fire-and-forget**.
- **R26.** ⭐ **Gate legal BLOQUEANTE**: actualizar el aviso de privacidad **antes de que la
  tarea C salga a producción**. Investigado: **no existe tarea previa de rewrite** → la tarea C
  la incluye como subtarea explícita.

**G6 — Comercial**
- **R19/R20/R21.** `ad_prices` mínima **AHORA** (slot de N días por alcance
  colonia/municipio/nacional, PRD §17.2); slot otorgado **a mano por admin** en beta (**ningún
  pago real**); `ads.purchase_id` nullable listo para que #84 solo lo llene.

**G7 — UI**
- **R22.** Badge "Patrocinado" **persistente** + CTA; **componente de firma con preview HTML
  aprobable antes de RN** (gate §8: UI ausente del mockup).
- **R23.** Pantalla mínima: lista + estado + **3 contadores** (impresiones, vistas ≥3 s, taps
  CTA) con desglose por zona, **sin gráficas**.
- **R24.** Entrada desde el **perfil, condicional a la capacidad**.

**G8 — Alcance**
- **R25.** **4 tareas encadenadas A→B→C→D + E (CPM/CPC) `deferred`.**
- **R27.** Prioridad **DESPUÉS de cerrar la Ola 1** (#74/#75).

## Preguntas abiertas

✅ **Ninguna bloqueante.** Las 27 de la 1ª pasada quedaron resueltas en la 2ª (ver "Decisiones del
intake → 2ª pasada"). Lo que sigue **no bloquea la promoción**: son decisiones de detalle que se
toman dentro de su tarea, con `/tm-plan`, o que dependen de algo externo ya rastreado.

**Se deciden dentro de su tarea (detalle de implementación, reversible):**
1. Vigencia estándar del slot en días (7 / 15 / 30) y los montos sembrados en `ad_prices` —
   tarea B; la tabla es configurable, cambiar un precio no es una migración.
2. Qué pasa con la vigencia pagada cuando se **suspende** la organización: ¿se pausa el reloj o
   se pierde? — tarea B. Recomendación técnica: pausar (`paused` conserva días restantes).
3. Si la impresión que llega **justo después** de expirar la vigencia se descarta o se cuenta —
   tarea C. Recomendación: descartar (la EF ya valida vigencia; subcontar es el error correcto).
4. Tamaño del batch de impresiones y momento del flush — tarea C, se calibra con medición real.
5. Copy exacto del badge ("Patrocinado" vs "Publicidad") — se resuelve en el preview aprobable
   de la tarea C, junto con el resto del diseño.

**Dependen de algo externo, ya rastreado, con escape hatch:**
6. **API key de Resend + dominio** para que la invitación llegue a un buzón real en producción.
   Ya está en `docs/TODO-pendientes.md` §1 desde 2026-07-31; la tarea A cierra con verificación
   local por Mailpit y deja el flip como checklist de despliegue.
7. **Momento** de publicar el aviso de privacidad nuevo (fuerza re-consentimiento a todos los
   usuarios vivos). El contenido es subtarea de C con aprobación de Abraham; **cuándo** se
   publica es una decisión de calendario, no de ingeniería.

## Promoción / descarte

**Estado: `aprobado` — Abraham aprobó y promovió el 2026-08-14.** Tareas creadas en Taskmaster: **#168 → #169 → #170 → #171** (pending, medium) y **#172** (deferred, low). Escritas directo en `tasks.json` (add-task roto), `validate-dependencies` en verde. Complejidad estimada (analyze-complexity también roto; estimación del doc): 168 = 7/10 (~6 subtareas) · 169 = 8/10 (~8) · 170 = 9/10 (~9) · 171 = 5/10 (~4) · 172 = n/a (deferred). Reporte: `.taskmaster/reports/exploracion-039-complexity.json`.

No quedaron preguntas bloqueantes ni criterios de aceptación incompletos. Los dos gates (diseño y legal) están **declarados dentro de la tarea C**,
no pendientes fuera del plan.

### Tareas a crear

⚠️ `add-task` está roto en este entorno (gotcha `generateObject`, CLAUDE.md §4) → se escriben
**directo en `.taskmaster/tasks/tasks.json`** (respaldo `.bak` + `task-master list` +
`validate-dependencies`). Esquema: `id` **string**, `dependencies` lista de **strings**,
subtask `id` **int**. Ids libres a partir de **168** (el máximo actual es 167).

| Id | Título | Nivel | Prioridad | `dependencies` |
|---|---|---|---|---|
| 168 | `feat: organización con capacidad de publicidad (can_advertise) + invitación por correo` | L | medium | `["71","74","75"]` |
| 169 | `feat: anuncios — creativo 6–30s, campaña por zona y moderación admin` | L | medium | `["168","157","68"]` |
| 170 | `feat: anuncios en el feed — inserción, impresiones, kill-switch y aviso de privacidad` | L | medium | `["169"]` |
| 171 | `feat: panel del anunciante — mis anuncios y métricas por zona` | M | medium | `["170"]` |
| 172 | `feat: publicidad fase 2 — CPM/CPC, subasta y antifraude` (`status: deferred`) | XL | low | `["171","76","84"]` |

**Trazabilidad obligatoria:** las 5 descripciones abren con
`Origen: exploración 039 (.taskmaster/docs/exploraciones/039-cuenta-comercial-anunciantes.md)`.

**Comando siguiente tras promover:** `/tm-plan 168`.

### Orden de ejecución y puntos de no retorno

1. **168** puede empezar en cuanto cierre la Ola 1. Es la única con dependencia externa (Resend)
   y tiene escape hatch.
2. **169** es donde el modelo queda fijado; después de esta, cambiar la forma de `ads`/`ad_zones`
   ya cuesta expand→migrate→contract sobre datos reales.
3. **170** es el punto de no retorno de **producto**: es la primera que toca lo que el usuario
   ve. No debe mergearse sin los dos gates cerrados y con el kill-switch verificado en el remoto.
4. **171** es aditiva y de bajo riesgo.

### Si se descarta

El registro de valor que queda: (1) el modelo de datos y el corte en fases están investigados
contra el schema real, no supuestos; (2) **la fase 1 no depende de ninguna épica pendiente**;
(3) el argumento de por qué una fuente de datos **facturable** no debe colgarse de `events_raw`
—cuya policy de INSERT deja al cliente escribir filas arbitrarias— sigue siendo válido para
cualquier otra métrica monetizable en el futuro; y (4) el hallazgo de que **ningún flujo de
invitación manda correo hoy**, que es una carencia real del producto con o sin publicidad.
