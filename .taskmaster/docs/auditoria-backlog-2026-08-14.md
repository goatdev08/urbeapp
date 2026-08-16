---
tipo: auditoria
fecha: 2026-08-14
estado: aplicado          # borrador → decidido → aplicado (Abraham aprobó las 14 acciones el 2026-08-14)
alcance: 72 tareas no-done de Taskmaster (67 pending · 2 review · 2 deferred · 1 in-progress)
verificacion: código en main + queries al remoto (mvpvqmyhrrkwbnpctpuq) — cada claim cita su evidencia
resultado: 72 → 55 no-done · 11 canceladas por fusión · 2 diferidas · 2 tareas nuevas (#166, #167)
---

# Auditoría del backlog — qué ya está hecho, qué se duplica, cómo simplificar

> Objetivo: clasificar los 72 pendientes en (A) ya hechos en la práctica, (B) obsoletos por cambio de
> contexto, (C) parcialmente hechos, (D) familias fusionables, (E) huecos de trazabilidad, (F) intactos.
> **Ninguna tarea se tocó todavía** — este doc es para decidir; la sección 7 lista las acciones propuestas.

---

## 1. ✅ Ya hechas en la práctica — cerrar (verificado en código)

| Tarea | Qué pedía | Evidencia de que ya está | Acción propuesta |
|---|---|---|---|
| **#39** | Quitar el FAB de publicar que tapaba el rail + CTA definitivo | `FeedScreen.tsx:213`: *"el FAB flotante que tapaba el rail se retiró en el pulido flash 2026-07-06"*; el acceso definitivo es `PublishTabButton` (botón central de la tab bar, `(tabs)/_layout.tsx`) | `done` con nota "resuelto por pulido flash 2026-07-06" |
| **#51** | Nombre del agente en el detalle desde `public.users` (no `user_preferences`) | `usePropertyDetail.ts:134`: *"#145.3: se lee la VISTA agent_public_profiles, no user_preferences"* — la #145 (done) lo resolvió con una vista dedicada, mejor que lo pedido | `done` con nota "superseded por #145.3" |
| **74.1** (subtarea) | Extender catálogo MX con colonias/CP | #157 lo hizo **con polígonos y cobertura nacional**: `mx_neighborhoods` = 75,493 filas / 32 estados en el remoto (verificado 2026-08-14). La nota de supersede ya está en 74.1 | subtarea → `done` |
| **74.7** (subtarea) | Mapa: autocompletado + clustering + pin cards | Autocomplete = #157 (`MapSearchSuggestions`, `usePlaceSearch`); clustering = `ClusterMarker.tsx` + `clusterMarkers.ts`; pin cards = `PropertyMiniCard.tsx` — los 3 existen y están vivos | subtarea → `done` |

**#44 (back button iOS) — 90% hecha.** `src/components/BackButton.tsx` existe y lo usan 8+ pantallas
(property-detail, profile, upgrade, agency/members, invitations, register…); la #147 (done) lo reforzó en el
perfil público. Lo único vivo del enunciado es "auditar TODAS las pantallas". → Propuesta: re-scope a
"barrido de verificación de cobertura BackButton" (XS) o cerrar tras un smoke de 10 min.

---

## 2. 🔄 Obsoletas o congeladas por la #153 (moderación suspendida)

La #153 (done) suspendió la moderación: **publicar sale directo a `active`**, ya no a `pending_review`.
Eso cambia el estatus real de 3–4 derivadas de la 73 que asumen moderación viva:

| Tarea | Situación real hoy | Acción propuesta |
|---|---|---|
| **#152** — el alert de éxito "ya está en el feed" miente | **Ya no miente**: con moderación suspendida la propiedad SÍ entra al feed de inmediato | `deferred` con nota "reactivar si vuelve la moderación (#153)" — o cerrar |
| **#131** — draft→active se salta la moderación (high) | Con moderación suspendida, ese ES el comportamiento oficial | `deferred`, atada a la reactivación de moderación |
| **#136** — my-listings sin pestañas pending_review/needs_changes/rejected | Menos urgente (no nacen filas nuevas en esos estados), pero filas históricas pueden existir y su parte (2) "alert miente" **duplica #152** | Mantener `pending` bajada a `low`; quitarle la parte del alert (es #152) |
| **#133** — `published_at` se sella en pending_review + default 'active' | Mitad afectada por #153; el default peligroso de la RPC sigue siendo real | Mantener, revisar alcance al planear |

⭐ **Decisión implícita que conviene explicitar:** si la moderación va a volver en beta, estas 4 se
re-activan juntas como grupo "reactivar moderación" (junto con la propia reversión de #153). Si NO va a
volver pronto, conviene una tarea paraguas "moderación v2" que las absorba y el resto se cierra.

---

## 3. 🟡 Parcialmente hechas — re-scope

| Tarea | Hecho | Falta | Propuesta |
|---|---|---|---|
| **#74** (Ola 1 mapa/búsqueda, 0/9 marcadas) | En la práctica 2/9: 74.1 y 74.7 (ver §1). 74.4 a medias: la expansión de radio ya existe (#42) | 74.2 código público (=**#88**, ver §4-F1), 74.3 ranking §9.8, 74.4 anti-clustering feed, 74.5 filtros rápidos, 74.6 popup+galería, 74.8 pantalla búsqueda | Marcar 74.1/74.7 done; mover 74.2 a #88; #74 queda como épica de ranking+búsqueda con 5 subtareas reales |
| **#75** (CRM, 6/8) | 75.1–75.6 done | 75.7 export CSV + retención §19.10, 75.8 ingest | Terminarla — es la única `in-progress`; 2 subtareas la cierran |
| **#106** | Parte (a) — detalle sin autoplay — **superseded por #148 (hero colapsable, done)** | Parte (b) sigue viva: `step5.tsx:109` aún tiene `player.loop = true` (la preview de subida reproduce en loop indefinido = quema recursos) | Cancelar #106 per exploración 038 y crear tarea XS solo para (b) — o re-scope #106 a solo (b) |
| **#118** (template WhatsApp §19.3) | El template base existe (75.4) | `public_code` y deep link al video — bloqueada por la familia F1 (§4) | Sin cambio; su dependencia real es #88+#83 |

---

## 4. 👯 Familias de tareas duplicadas o solapadas — propuestas de fusión

### F1 · Código público + compartir + deep links — `#88 ≡ 74.2` + #78(parte) + #82(parte) + #83(parte) + #118
- **#88** y **74.2** piden LO MISMO (código corto público `URB-XXXXX` / `urbea.app/p/AB12CD`).
- Lo consumen: **#118** (template WhatsApp), **#78** (compartir con deep links), **#82** (landing `/v/[id]`), **#83** (deep links transversales).
- **Propuesta:** #88 es LA tarea del código público (absorbe 74.2, que se cierra apuntando a #88). Los
  deep links viven una sola vez en #83 (transversal); #78/#82/#118 los consumen como dependencia, no los re-implementan.
  Cadena resultante: `#88 → #83 → {#118, #78, #82}`.

### F2 · Grants / defensa en profundidad — `#46 + #92 + #96` (+ #97 pariente)
- Verificado en el remoto (2026-08-14): **anon tiene EXECUTE en las 22 funciones de `private.*` y en las 4
  SECURITY DEFINER de public** (`has_function_privilege` = true en todas), y **TRUNCATE sigue concedido a
  anon/authenticated en 18 tablas** (35 grants).
- Las tres tareas son el mismo tipo de trabajo: UNA migración de barrido (revokes) + pgTAP de grants + un
  patrón para tablas/funciones futuras.
- **Propuesta:** fusionar #46+#92+#96 en una sola tarea "hardening: barrido de grants (EXECUTE + TRUNCATE)"
  — una migración, un PR. #97 (INSERT directo de agencies) es RLS de negocio, va aparte (→ F5).

### F3 · `search_places` — `#159 + #163`
- Misma función SQL, mismo archivo de migración, mismos tests pgTAP. #163 (escape LIKE + bbox tras LIMIT)
  y #159 (ranking por cercanía) se hacen en el MISMO `create or replace`.
- **Propuesta:** fusionar en una tarea "search_places v2: escape + perf + ranking por cercanía". Ya lo
  recomendé al cerrar el review; este doc lo formaliza.

### F4 · FilterSheet — `#162 + #115`
- Mismo componente: #162 (Limpiar no limpia la colonia) toca el handler; #115 (patrón flex sin verificar)
  toca el layout. Verificado: `FilterSheet.tsx:440/488` sigue con `maxHeight:600 + flexGrow:0`.
- **Propuesta:** una tarea "FilterSheet: limpiar colonia + verificación flex" (S).

### F5 · RLS de escritura properties/agencies + TOCTOU — `#101 + #121 + #132` (+ #97)
- Los cuatro son la misma zona: policies de UPDATE/INSERT que permiten saltarse las EFs
  (`properties_update` sin WITH CHECK espejo (#101a), UPDATE directo sin re-revisión (#121), edit-property
  sin precondición de estado + TOCTOU (#132), INSERT directo de agencies (#97)).
- **Propuesta:** una épica corta "RLS de escritura = solo vía EF" con 3–4 subtareas; una sola pasada de
  diseño de policies evita parcharlas de a una y romperse entre sí.

### F6 · publish-property (subtarea 73.4) — `#120 + #133 + #135`
- Mismo EF + misma migración: cableo params→RPC sin tests (#120), default 'active' + published_at (#133),
  checker de duplicados fail-open que no excluye draft (#135 — ya mitigado en parte por #151 done).
- **Propuesta:** una tarea "hardening publish-property" con 3 subtareas.

### F7 · edit-property (subtarea 73.6) — `#122 + #134 + #137` (+ #132 de F5)
- Mismo EF: parseo del body de error (#122), null vs '' + location_changed (#134), upsert sin ON CONFLICT
  (#137). #132 es RLS y queda en F5.
- **Propuesta:** una tarea "hardening edit-property" con 3 subtareas.

### F8 · Máquina de estados de propiedad — `#139 ⊃ #138 + #125`
- #139 (el enum de 17 estados vive en 5+ literales a mano) es la CAUSA; #138 (SUSPEND_BLOCKED_STATES
  incompleto) y #125 (dos representaciones de rentada/vendida) son SÍNTOMAS. Resolver #139 con una fuente
  única de verdad resuelve #138 casi gratis y decide #125.
- **Propuesta:** #139 absorbe #138; #125 se mantiene aparte solo por su decisión de producto (migrar datos
  viejos closed+closed_reason o aceptar ambas).

### F9 · Cloudflare Stream ops — `#104 + #105`
- Mismo dashboard, mismos secretos: rotar STREAM_API_TOKEN (#105, high, ya expuesto) y arreglar la descarga
  firmada de archive-video (#104 — verificado: `make_stream_archiver.ts` sigue sin manejo de token).
- **Propuesta:** hacerlas en la MISMA sesión (la rotación invalida el token que #104 necesita configurar);
  pueden seguir siendo 2 tareas pero con dependencia #104→#105 explícita.

### F10 · Media/R2 secundario — `#85 + #86 + #91 + #87`
- Avatares CRM sin useR2Urls (#85 — verificado: `useAgentLeads.ts:139` mapea `avatar_url` crudo), UI de
  logo de agencia (#86), paridad de portada en seed local (#91), pg_cron de limpieza (#87).
- **Propuesta:** no fusionar (dominios distintos) pero etiquetarlas como lote "media/R2" para agarrarlas en
  una misma tanda de contexto.

### F11 · Privacidad/abuso de endpoints en beta — `#94 + #95 + #116`
- Consent WhatsApp no verificado (#94 — verificado: contact-agent no menciona consent), rate limiting de
  register (#95), users_select sobre-expone correo/teléfono (#116, high, requiere patrón OTA-primero).
- **Propuesta:** mantener separadas (mecanismos distintos) pero como lote "privacidad beta" con #116 primero
  — es la de mayor exposición real y la única high.

### F12 · Workflow/tooling — `#70 + #141 + #45`
- graphify (#70), tdd-guard laxo (#141), pgTAP local con 4 tests rotos (#45). Nada de app; mejoran el flujo.
- **Propuesta:** lote "workflow" para un día de mantenimiento; #45 primero (desbloquea verificación local).

---

## 5. 🕳️ Huecos de trazabilidad detectados (arreglar el registro, no el código)

1. **La tarea B de la exploración 038 (chips en wizard) NUNCA se registró.** El frontmatter de
   `038-detalle-sin-autoplay-y-chips-en-wizard.md` dice "A=148 · B=149", pero la **#149 real es otra cosa**
   ("duración mínima 10s"). La #148 (hero) se hizo; los chips de step4 (quitar `toggles_card`, promover
   `FilterChipGroup`) quedaron aprobados y **sin tarea**. → Crear la tarea con backlink a la exploración.
2. **#106 sigue `pending` aunque la exploración 038 (aprobada) la declaró cancelada** como superseded por
   #148. Además su parte (b) — la preview de step5 en loop — se dobló a #148 en el plan pero **no se
   implementó** (`step5.tsx:109` sigue con `loop = true`). → Cancelar #106 + tarea XS para (b), o re-scope.
3. **#36 y #38 llevan semanas en `review`** — ambas requieren verificación manual de Abraham (restricción de
   API keys en Google Cloud Console; pase manual del checklist). → Decidir: verificar y cerrar, o devolver a
   pending con dueño explícito.
4. **#47 está `deferred` con 8 subtareas `pending`** — ruido en los conteos. Vale la pena marcar las
   subtareas como deferred también (o vaciarlas) para que `next` y los conteos no las arrastren.

---

## 6. ⬜ Intactas (correctamente pendientes, sin solape)

- **Épicas de olas:** #76 (pagos sin gateway), #77 (notificaciones), #79 (moderación/antifraude — nota:
  relacionada con el grupo de §2), #80 (métricas), #81 (admin web), #84 (Stripe capstone). Sin cambios.
- **Fixes/hardening vigentes y verificados:** #94, #95, #104, #105, #107, #108, #109 (LocationWall sigue
  envolviendo todo `(protected)/_layout.tsx`), #116, #119, #120–#124 (los no absorbidos por familias),
  #140, #156 (verificado: `useSaveProperty.ts:47` sigue `initialSaved=false` sin consultar saves),
  #158, #160, #161, #164, #165.
- **Deferred legítimos:** #47, #60.

---

## 7. 📋 Resumen de acciones propuestas (para aprobar en bloque o por punto)

| # | Acción | Tareas afectadas |
|---|---|---|
| 1 | Cerrar como done (con nota de por qué) | #39, #51 |
| 2 | Marcar subtareas 74.1 y 74.7 como done | #74 |
| 3 | Cancelar #106; crear tarea XS "step5: preview sin loop infinito" (parte b) | #106 |
| 4 | Crear la tarea faltante "chips en wizard (step4)" con backlink a exploración 038 | — |
| 5 | Diferir #152 y #131 atadas a "reactivar moderación"; bajar #136 a low y quitarle el solape con #152 | #131, #133, #136, #152 |
| 6 | Fusionar #46+#92+#96 → "barrido de grants" (1 migración) | F2 |
| 7 | Fusionar #159+#163 → "search_places v2" (1 migración) | F3 |
| 8 | Fusionar #162+#115 → "FilterSheet: limpiar + flex" | F4 |
| 9 | Agrupar #101+#121+#132+#97 → épica "RLS de escritura solo vía EF" | F5 |
| 10 | Agrupar #120+#133+#135 → "hardening publish-property"; #122+#134+#137 → "hardening edit-property" | F6, F7 |
| 11 | #139 absorbe #138; #125 queda aparte (decisión de producto) | F8 |
| 12 | Dependencia explícita #104→#105 (misma sesión de Cloudflare) | F9 |
| 13 | Resolver el limbo de #36/#38 (review) y las subtareas de #47 | §5.3, §5.4 |
| 14 | Re-scope #44 a barrido XS de cobertura BackButton (o cerrar tras smoke) | #44 |

**Efecto neto si se aprueba todo:** 72 no-done → ~55 (−9 por cierre/cancelación/fusión, −4 diferidas con
causa, +2 nuevas que faltaban por trazabilidad) y cada pendiente queda con un solo dueño temático.

---

---

## 8. ✅ Registro de aplicación (2026-08-14)

Abraham aprobó las 14 acciones en bloque. Aplicadas escribiendo `tasks.json` directo (add-task/update-task
rotos, ver [[taskmaster_addtask_provider_broken]]), con respaldo previo y validación posterior:
`task-master validate-dependencies` → *No invalid dependencies*; `task-master next` → **75.7** (correcto:
#75 es la única `in-progress` y le faltan 2 subtareas para cerrar). Integridad verificada: ids `string`,
`dependencies` `string`, subtask ids `int`, cero dependencias huérfanas.

| Acción | Resultado |
|---|---|
| 1 | #39 y #51 → `done` con nota de por qué (FAB retirado 2026-07-06 / superseded por #145.3) |
| 2 | 74.1 y 74.7 → `done`; **74.2 → `cancelled`** (duplicada de #88); #74 queda como épica de ranking+búsqueda con 5 subtareas vivas |
| 3 | #106 → `cancelled` (superseded por #148); **nueva #166** para su parte (b) viva: `step5.tsx:109` sigue con `player.loop = true` |
| 4 | **Nueva #167** — chips en wizard (step4), tarea B de la exploración 038 que nunca se registró |
| 5 | #152 y #131 → `deferred` (grupo "reactivar moderación"); #136 → `low` + se le quitó el solape con #152 |
| 6 | **#46 absorbe #92 y #96** → `high`, con la evidencia del remoto en sus details; #92 y #96 → `cancelled` |
| 7 | **#159 absorbe #163** → `high`, "search_places v2" (3 arreglos en un `create or replace`); #163 → `cancelled` |
| 8 | **#115 absorbe #162** → `medium`, "FilterSheet: limpiar colonia + flex"; #162 → `cancelled` |
| 9 | **#101 = épica RLS de escritura** → `high` con **4 subtareas**; #97, #121, #132 → `cancelled` (copiados a 101.2/101.3/101.4) |
| 10 | **#120 = épica publish-property** (3 subtareas, #133/#135 `cancelled`) · **#122 = épica edit-property** (3 subtareas, #134/#137 `cancelled`); ambas → `high` |
| 11 | **#139 absorbe #138** (con SUSPEND_BLOCKED_STATES escrito en su alcance); #125 se mantiene aparte por su decisión de producto |
| 12 | **#104 ahora depende de #105** — rotar el token primero, configurar después (al revés se trabajaría sobre un token comprometido) |
| 13 | #36 (→ `high`) y #38 salen de `review` a `pending` con nota de "acción manual de Abraham"; las 8 subtareas de #47 → `deferred` |
| 14 | #44 re-scoped a barrido XS de cobertura del `BackButton`, prioridad `low` |

**Conteo final:** 93 done · 55 no-done (54 pending + 1 in-progress) · 15 cancelled · 4 deferred.
Cero tareas en `review` (el limbo quedó eliminado).

**Lo que NO se hizo y sigue siendo decisión de Abraham:**
- **¿Vuelve la moderación?** De la respuesta depende si el grupo #131/#133.2/#136/#152 se reactiva junto
  con la reversión de #153, o si se cierra definitivamente. Hoy quedaron diferidas, no cerradas.
- **#36** exige entrar a Google Cloud Console (restringir API keys de Maps) y **#38** un pase manual del
  checklist en el emulador: ninguna es de código.
- **#125** (dos representaciones de rentada/vendida) sigue esperando la decisión de migrar las filas viejas
  `closed + closed_reason` o aceptar ambas.

---

*Verificación: greps sobre main (2026-08-14) + `execute_sql` contra el remoto. Los file:line citados son
navegables. §1–§7 documentan el estado ANTES de aplicar; §8 el resultado.*
