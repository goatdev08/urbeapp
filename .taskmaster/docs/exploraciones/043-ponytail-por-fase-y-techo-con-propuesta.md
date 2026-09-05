---
tipo: chore          # tooling de workflow (precedente: 037-integracion-graphify-workflow) — NO toca producto
nivel: M             # 4 sub-cambios + limpieza + ingest · ~14 archivos de gobierno · 6 subtareas
fecha: 2026-09-05    # absoluta
estado: aprobado      # borrador → en-revision → aprobado | descartado
tarea_id: 260         # promovida 2026-09-05 (escrita a mano en tasks.json, add-task roto §4)
motivo_descarte:      #
---

# Ponytail por fase, trade-offs explicados, excepción al reuso y techo de UI con propuesta

> Documento de exploración/planeación de `/tm-explore`. Un archivo por idea.
> Puede **APROBARSE** (→ tarea[s] en Taskmaster) o **DESCARTARSE** (registro de decisión).
> **Es configuración del sistema de trabajo, no producto:** no toca `mobile/**`, `supabase/**`
> ni los PRD maestros. El footprint es `CLAUDE.md`, `.claude/**`, `_template.md` y el vault.
> Las 14 preguntas del intake quedaron resueltas por Abraham el 2026-09-05 (ver
> "Decisiones del intake"); este doc ya refleja las decisiones, no las opciones.

## Idea original

Cuatro ajustes al sistema de trabajo, tras una conversación sobre cómo el skill `ponytail`
afecta la "creatividad" del agente (Abraham, 2026-09-05):

1. **Ponytail por fase.** `/tm-explore` y las tareas de diseño (agente `design`, previews HTML)
   corren con ponytail apagado o en `lite` — ahí se quiere divergencia (2–4 direcciones,
   componentes de firma, alternativas de layout). `/tm-tarea` y el código de producción se
   quedan en `full` (ahí la creatividad se vuelve deuda). Que quede escrito como regla para
   que aplique sin recordarlo.
2. **Explicar trade-offs** de una simplificación cuando importen (hoy ponytail capa la salida
   a "máximo tres líneas: qué se saltó y cuándo añadirlo").
3. **Excepción al rung 2 de la escalera** ("¿ya existe? reúsalo"): si lo que hay en el repo es
   mediocre, hoy frena refactors buenos. Que el agente señale cuando el patrón existente es
   deuda y proponga el refactor en vez de reusarlo a ciegas.
4. **Techo de alcance de UI con propuesta** (CLAUDE.md §8): si durante una tarea/exploración se
   detecta que hará falta una interacción o UI que no está en el mockup, que el agente lo
   **proponga** (incluirlo en la misma tarea, o dar la opción con una propuesta concreta), en
   vez de recortarlo en silencio o mandarlo a `add-task` sin decir nada. De "techo mudo" a
   "techo con propuesta".

## Lluvia de ideas

La idea llegó **concreta en el qué** y **abierta en el cómo**. La lluvia fue por mecanismo, no
por dirección global. **Todas las opciones recomendadas fueron las elegidas** (detalle y
razones en "Decisiones del intake"); abajo queda el registro de por qué se descartaron las otras.

### Hallazgo mecánico que condicionó la parte 1

`ponytail/SKILL.md` §Persistence dice: *"ACTIVE EVERY RESPONSE… Off only: 'stop ponytail' /
'normal mode'. Default: full. Switch: `/ponytail lite|full|ultra`."* y §Boundaries: *"Level
persists until changed or session end."*

**Un `/ponytail lite` tecleado en el chat NO viaja a un subagente.** Cada subagente
(`tm-explore`, `design`, `mobile`, `supabase`) arranca en contexto limpio: solo ve su propio
prompt (`.claude/agents/<x>.md`) + `CLAUDE.md`. Por eso el nivel por fase **no se puede
"switchear" en runtime**: tiene que estar **declarado en el archivo de la fase**. Cualquier
mecanismo que dependa del slash-command está muerto al nacer.

Segundo matiz: **`lite` no es "sin ponytail"**. `lite` = *"build what's asked, name the lazier
alternative in one line"* (§Intensity) — sigue construyendo una sola cosa. Lo que la fase
explore/design necesita es **divergencia (N direcciones)**, que es otra dimensión. Y el propio
skill ya la permite en §Output: *"Explanation the user explicitly asked for (a report, a
walkthrough, per-phase notes) is not debt, give it in full"* y §Boundaries: *"Ponytail governs
what you build, not how you talk."*

→ **Por eso la decisión 1.1 no inventa un nivel nuevo**: declara que ponytail **no aplica a la
fase de propuesta** y sí al plan de implementación y a todo código. Se apoya en §Boundaries del
skill en vez de pelearse con §Persistence.

### Opciones descartadas (registro)

| Parte | Descartada | Por qué |
|---|---|---|
| 1 | Solo la tabla en §0, sin línea por archivo | Obliga al subagente a **inferir** su fase; el proyecto ya aprendió con la criticidad TDD (§5) que lo que se infiere deriva |
| 1 | Hook que inyecte el nivel | No hay API para setear el nivel de un skill desde un hook; sería inventar canal y contradice §0 |
| 1 | `lite` literal / `stop ponytail` | `lite` sigue construyendo una sola cosa (no produce divergencia); "off" pierde la disciplina en el plan de implementación que sí sale de la fase |
| 2 | Editar `ponytail/SKILL.md` §Output | Bifurcación permanente del upstream MIT por una regla que pertenece a §0 |
| 2 | Companion `/ponytail-why` | Un archivo más para lo que la bitácora ya cubre; huele a lo que §0 prohíbe |
| 3 | Parar y preguntar en el momento | Rompe la serie y choca con `auto` (`/tm-tarea` §Argumentos) |
| 3 | Editar el rung 2 del skill | Misma razón que 2; además "reusar > reescribir" está replicado en 5 lugares del repo, editar el skill no los alcanza |
| 4 | Solo el analista (`UI_EXTRA: sí`) | Es read-only y **no abre el mockup HTML** → confianza baja. Sobrevive como **disparador** dentro del mecanismo A, no como mecanismo |
| 4 | Solo en ejecución (`/tm-tarea` pausa) | Peor momento: rama abierta, `auto` no quiere interrumpir y §0.5.3 dice que lo mergeado es candidato a release |
| 4 | El vault manda sobre §8 | El vault es síntesis (§7), no fuente; §8 es el schema que toda sesión lee |

## Problema / Motivación

El sistema de trabajo está afinado para **converger** (ponytail `full`, techo del mockup,
auto-check anti-scope-creep, criticidad determinista). Esa afinación es correcta en la fase de
**ejecución** y está mal calibrada en las fases de **exploración y diseño**, donde el producto
del agente son *opciones*, no *diff*. Hoy el mismo reflejo corre en las cuatro fases porque
nadie escribió dónde empieza y dónde termina.

Los tres síntomas que Abraham nombró:
- La divergencia (2–4 direcciones, componentes de firma, alternativas de layout) compite con un
  skill que dice "ACTIVE EVERY RESPONSE" y "the shortest path to done is the right path".
- El cap de 3 líneas de salida esconde el razonamiento justo cuando la simplificación tiene un
  techo que importa (contrato publicado, datos reales, ruta crítica).
- El rung 2 ("¿ya existe? reúsalo") y el techo del mockup convierten al agente en **mudo**: no
  reusa mal ni construye de más, pero tampoco dice *"esto que estoy reusando es deuda"* ni
  *"esta pantalla necesita algo que el mockup no dibuja"*. Se pierde la señal.

**Lo que NO es el problema:** que el agente construya de menos. Construir el mínimo sigue siendo
correcto (§0: "métrica de éxito = tareas cerradas con mínimo código nuevo"). El cambio es de
*silencio* a *propuesta*, no de *mínimo* a *más*.

## Resultado esperado

- **Explorar y diseñar divergen por defecto** sin que Abraham tenga que teclear `/ponytail lite`
  ni recordarlo en el prompt; **ejecutar converge por defecto** exactamente como hoy.
- Cuando una simplificación cae en uno de los 4 disparadores, el trade-off queda **completo en la
  bitácora** de la subtarea y **resumido en 2–3 líneas** en la respuesta.
- Cuando el patrón existente es peor que el que se escribiría hoy, sale una **señal explícita**:
  se propone el refactor si cabe en el footprint, o se reusa con `// ponytail: deuda` + derivada
  `hardening(<origen>)`.
- Cuando una pantalla necesita UI/interacción ausente del mockup, sale una **propuesta concreta**
  con **las dos opciones siempre ofrecidas** (en conjunto en la tarea actual vs. derivada
  `producto(<origen>)`), y la decide Abraham.
- Ninguna de las cuatro reglas cambia qué es **crítico** para TDD: `tdd-guard.sh` no se toca.

## Alcance

- **SÍ entra:**
  - **`CLAUDE.md` §0** — tabla `fase → régimen de ponytail`; regla de trade-offs con sus 4
    disparadores y su destino; "reuso con reserva" (excepción al rung 2) con su umbral por
    footprint y su cupo.
  - **`CLAUDE.md` §8** — "techo con propuesta": se conserva la prohibición de implementar UI no
    dibujada y se agrega la obligación de **proponerla**; se corrige el canal (hoy dice
    `add-task`, **roto** por §4 → escribir `tasks.json` directo).
  - **Línea declarativa de régimen** en cada archivo de fase:
    `.claude/agents/tm-explore.md`, `.claude/agents/design.md`, `.claude/commands/tm-explore.md`,
    `.claude/skills/urbea-design/SKILL.md` (propuesta) y
    `.claude/commands/tm-plan.md`, `.claude/commands/tm-tarea.md`, `.claude/agents/mobile.md`,
    `.claude/agents/supabase.md` (full).
  - **`.claude/settings.json`** — agregar `Skill(ponytail*)` al allow-list (proyecto; **no** se
    toca `~/.claude/settings.json`).
  - **Canal de propuesta:** `.claude/agents/analista-subtareas.md` (disparador
    `UI_FUERA_DEL_MOCKUP:`), `.claude/agents/mobile.md` (emisión en el output + `REUSO_CON_RESERVA:`),
    `.claude/commands/tm-plan.md` (pregunta obligatoria), `.claude/commands/tm-tarea.md` (camino
    de bloqueantes), `.claude/agents/tm-explore.md` (sección y contrato de salida).
  - **`.taskmaster/docs/exploraciones/_template.md`** — sección "UI/interacción fuera del mockup".
  - **Reconciliación de las 5 copias de "reusar > reescribir"** para que apunten a §0 en vez de
    re-enunciar la regla (`CLAUDE.md:9`, `agents/tm-explore.md:16`,
    `skills/urbea-context/SKILL.md:23`, `agents/analista-subtareas.md`, y la mención de §0).
  - **Limpieza de reglas muertas:** las 5 afirmaciones "branding en pausa"
    (`agents/design.md:10`, `skills/urbea-design/SKILL.md:8`, `agents/tm-explore.md:27`,
    `commands/tm-explore.md:83`, `_template.md:50`) + los `add-task` como canal de trabajo nuevo.
  - **Vault:** `wiki/conceptos/design-system.md` L17 pasa a **referenciar** §8 (deja de duplicar);
    ADR nuevo `wiki/decisiones/0011-ponytail-y-fases-del-workflow.md`;
    `wiki/codebase/mapa-codebase.md` + `wiki/log.md`; corrección colateral de la referencia a
    `update-subtask` en `0006` y `0007` → `tm-log.mjs`.
- **NO entra (out of scope):**
  - **`.claude/skills/ponytail/SKILL.md` y sus 5 companions: NO se editan** (decisiones 2.1 y 3.1
    — upstream limpio). Todo lo nuevo vive en `CLAUDE.md` §0/§8.
  - `.claude/hooks/tdd-guard.sh` — la criticidad por path no cambia con ninguna de las 4 partes.
  - `~/.claude/settings.json` (global de Abraham) — no se toca ni se revierte.
  - Cualquier cambio en `mobile/**`, `supabase/**` o los PRD.
  - Reescribir el mockup canónico (`urbea-identidad-visual.html`) o el prototipo de layout.
  - **Ejecutar** los refactors o la UI extra que este mecanismo empiece a proponer (eso son las
    derivadas que nazcan después).
  - El backlog ya existente de UI faltante que `design-system.md` L51-61 documenta (pendientes de
    firma, divergencias del perfil #16): esta tarea crea el canal, no lo drena.

### ⚠️ Restricción de ejecución (build sobre lo vigente, nunca revertir)

Abraham hizo cambios recientes en skills y config que **conviven** con esta tarea y que el
footprint de abajo toca. **Se construye ENCIMA de las versiones actuales; jamás se revierten:**
- `.claude/agents/analista-subtareas.md` — Paso 3b de **graphify** (`affected`/`explain`, tarea #70,
  2026-09-03). La línea de régimen y el disparador `UI_FUERA_DEL_MOCKUP:` se **añaden**; el paso
  3b queda intacto.
- `.claude/skills/urbea-context/SKILL.md` — sección **graphify** (§"grafo AST", #70). Solo se
  ajusta la línea 23 ("¿ya existe algo reutilizable?") para que apunte a §0; nada más.
- `~/.claude/settings.json` (global del usuario) — **fuera del footprint**. El allow-list que se
  edita es el del **proyecto** (`.claude/settings.json`).
- Antes de editar cualquiera de estos tres, `git log -1 --stat <archivo>` para confirmar que se
  parte de la versión vigente en `origin/main` fresco.

## Roles afectados

Ninguno de los roles de producto (comprador / inmobiliaria+agente / admin). El "rol" afectado es
el **operativo**: Abraham (recibe más propuestas y decide), el orquestador (`/tm-explore`,
`/tm-plan`, `/tm-tarea`) y los subagentes (`tm-explore`, `analista-subtareas`, `design`,
`mobile`, `supabase`). Sin impacto en usuarios de la app.

## Impacto en datos

**n/a** — no toca schema, migraciones, RLS, triggers ni Storage. El único "dato" que cambia es
`.taskmaster/tasks/tasks.json` cuando el mecanismo genere tareas derivadas, por el camino ya
establecido (escritura directa + `.bak` + `validate-dependencies`, §4).

## Impacto en UI

**n/a en la app.** La parte 4 cambia **cómo se decide** la UI, no la UI. El gate de branding
está **LEVANTADO desde 2026-06-26** (CLAUDE.md §8) → `GATE_BRANDING: no`.

⚠️ **Reglas muertas que esta tarea limpia (decisión 4.3 = sí, en esta tarea).** Cinco archivos
siguen afirmando que el branding está **en pausa**, contradiciendo a §8:
- `.claude/agents/design.md:10` — *"El branding está en pausa hasta indicación expresa del cliente
  (tarea #19)… Si no hay luz verde, **no arranques**"* → el agente `design` está instruido para
  **abortar**. Es la más grave: el gate levantado nunca llegó al sistema de agentes.
- `.claude/skills/urbea-design/SKILL.md:8` — *"⚠️ Branding en pausa hasta luz verde del cliente"*.
- `.claude/agents/tm-explore.md:27` — *"Branding en pausa (CLAUDE.md §8, tarea #19)"*.
- `.claude/commands/tm-explore.md:83` — *"Branding en pausa (#19)…"* (+ paso 3 y el campo de
  salida `GATE_BRANDING`).
- `.taskmaster/docs/exploraciones/_template.md:50` — *"gate de la tarea #19"*.

La regla viva que las reemplaza es la de §8: **componente de firma → preview HTML aprobable por
el cliente antes de portar a RN** (aprobación por pantalla, no gate global).

## Reglas no obvias aplicables

- **§0 · "Perfeccionamos el flujo; NO acumulamos código"** — `CLAUDE.md:8-11`. Esta exploración
  ES el flujo, así que aplica en su forma más estricta: cada regla nueva debe ganarse su línea.
  Contrapeso real: `CLAUDE.md` ya son ~120 líneas densas y es lo que **toda** sesión lee.
- **§0.5 · Producción viva** — `CLAUDE.md:14-24`. Gobierna la parte 3: un refactor "porque el
  patrón es mediocre" sobre código que ya sirve a builds instalados es exactamente el cambio que
  §0.5.2 y §0.5.3 frenan. Por eso el umbral excluye contrato publicado y migraciones.
- **§5 · Tareas DERIVADAS (2026-08-05)** — `CLAUDE.md:100-107`. Es el **vehículo ya existente**
  para las partes 3 y 4: título `hardening(<origen>)` / `producto(<origen>)`, descripción que
  abre con `Origen: subtarea <id.n> · Detectado por: …`, `dependencies` con la tarea origen y
  **backlink** `DERIVADAS: #x` en los `details` del origen. **No se inventa canal.**
- **§4 · `add-task` / `expand` / `analyze-complexity` están ROTOS** (`generateObject` →
  API 400 por `tool_use` ids duplicados) — `CLAUDE.md:52-56`. Impacto directo:
  - `CLAUDE.md` §8 y `wiki/conceptos/design-system.md:17` mandan la UI faltante a `add-task`:
    **es una instrucción que hoy falla** → se corrige a "escribir `tasks.json` directo".
  - `/tm-explore` §Paso 5 (L41-56) usa `add-task` **y** `analyze-complexity` → la promoción de
    **esta misma exploración** se hace a mano (ver "Promoción / descarte").
- **§5 · Criticidad TDD = regla determinista por path** — `CLAUDE.md:70-77`. Precedente de diseño
  imitado en las 4 partes: las reglas **no se juzgan, se derivan** (fase declarada / 4
  disparadores enumerados / umbral por footprint / ausencia en el mockup).
- **Auto-check de conformidad del agente `mobile`** — `.claude/agents/mobile.md:24`:
  *"confirma que el diff… no agrega comportamiento no pedido (scope creep)"*. **SE MANTIENE tal
  cual** (decisión 4.1): sigue prohibido *implementar* de más; solo se agrega *proponer*.
- **Ponytail no estaba en el allow-list** — `.claude/settings.json` lista `Skill(urbea-*)`,
  `Skill(tm-*)`, pero ningún `Skill(ponytail*)`, pese a que §0 lo declara activo por defecto
  (decisión 1.4: se agrega).
- **Vault desactualizado (colateral aprobado):** `wiki/decisiones/0006` §Decisión.1 y `0007`
  §Persistencia siguen prescribiendo `task-master update-subtask` para la bitácora — **prohibido**
  desde el gotcha 2026-08-18 (§4, `tm-log.mjs`). Se corrige el texto de paso.
- **No hay ADR de ponytail.** El skill entró el 2026-06-30 (commit `513d4fe`) y solo vive en
  `CLAUDE.md` §0 + su `SKILL.md`; **cero menciones en `wiki/decisiones/`**. Los ~130 marcadores
  `ponytail:` del código sí están narrados en `wiki/log.md`. → ADR `0011` (decisión 5.3).
- **Techo del mockup duplicado** — `CLAUDE.md` §8 y `wiki/conceptos/design-system.md:17` con texto
  casi idéntico. Decisión 4.4: **§8 manda**, el vault referencia (coherente con §7: el vault es
  síntesis, no espejo).

## Arquitectura / enfoque técnico

El "diseño" aquí es **dónde vive cada regla** y **cómo se dispara**. Mapa **decidido**:

| # | Regla | Vive hoy en | Casa decidida | Mecanismo decidido |
|---|---|---|---|---|
| 1 | Régimen de ponytail | `ponytail/SKILL.md` §Persistence/§Intensity; `CLAUDE.md:11` ("full por defecto **al escribir código**") | **`CLAUDE.md` §0** (tabla `fase → régimen`, fuente de verdad) | + 1 línea declarativa en cada archivo de fase (4 de propuesta + 4 de ejecución). **No** por slash-command (no cruza al subagente). El skill **no se edita** |
| 2 | Explicar trade-offs | `ponytail/SKILL.md` §Output (cap de 3 líneas) | **`CLAUDE.md` §0** | 4 disparadores enumerados; **completo en la bitácora** (`tm-log.mjs`) + **resumen de 2–3 líneas** en la respuesta. El skill **no se edita** |
| 3 | Reuso con reserva (rung 2) | `ponytail/SKILL.md` rung 2; eco en `CLAUDE.md:9`, `agents/tm-explore.md:16`, `skills/urbea-context/SKILL.md:23`, `agents/analista-subtareas.md` | **`CLAUDE.md` §0** (las 5 copias pasan a **referenciar** §0) | Umbral por footprint → propone o `// ponytail: deuda` + derivada `hardening(<origen>)`. Cupo: **máx 2 por tarea** |
| 4 | Techo de UI con propuesta | `CLAUDE.md` §8 + `wiki/conceptos/design-system.md:17` (duplicado) | **`CLAUDE.md` §8 manda**; el vault referencia | Sección obligatoria en `_template.md` → `AskUserQuestion` en `/tm-explore` y `/tm-plan` (analista dispara); red en ejecución vía `mobile.md` → bloqueantes de `/tm-tarea` §5. **Siempre las 2 opciones**; default derivada |

### Régimen por fase (texto base para la tabla de §0)

| Fase | Archivos que la corren | Régimen | Qué significa |
|---|---|---|---|
| **Propuesta** — explorar, diseñar, lluvia de ideas, previews | `commands/tm-explore.md`, `agents/tm-explore.md`, `agents/design.md`, `skills/urbea-design/SKILL.md` | **Ponytail NO aplica a la propuesta** | Se **exige divergencia**: 2–4 direcciones / alternativas de layout / componentes de firma, cada una con su trade-off. Ponytail **sí** aplica al **plan de implementación** que sale de la fase |
| **Ejecución** — planear subtareas, codear, verificar | `commands/tm-plan.md`, `commands/tm-tarea.md`, `agents/mobile.md`, `agents/supabase.md` | **`full`** (sin cambio) | La escalera enforced, exactamente como hoy |
| **Override** | cualquiera | **el prompt explícito de Abraham gana siempre** | Ya es regla del skill ("anything explicitly requested" / "User insists → build it") |

### Formatos de salida (para que sean parseables, acotados y verificables por grep)

```
UI_FUERA_DEL_MOCKUP: {qué falta} · {por qué la pantalla lo necesita} · {costo XS|S|M}
  → opción 1 (en conjunto): incluirlo en esta tarea — {qué implicaría}
  → opción 2 (default): derivada producto(<id.n>) — {título y descripción ya redactados}

REUSO_CON_RESERVA: {patrón reusado} · {por qué es peor que lo que se escribiría hoy}
  → cabe en el footprint y NO toca contrato publicado ni migraciones → PROPONGO refactor aquí
  → no cabe → reuso + `// ponytail: deuda — <por qué>, refactor en #<id>` + derivada hardening(<id.n>)
```

**Invariantes del canal (los tres, escritos en §0/§8):**
1. **El agente propone, nunca decide.** Ninguna propuesta se auto-ejecuta.
2. **Default conservador**: derivada. La opción "en conjunto" se ofrece siempre, pero no es el default.
3. **Cupo: máx 2 propuestas por tarea**; de la 3ª en adelante solo se **nombran** en la bitácora,
   sin redactar propuesta ni abrir derivada.

**Restricción de diseño transversal:** la única regla del proyecto que ha demostrado sobrevivir
(criticidad TDD, §5) es **determinista y derivada de una entrada objetiva**. Las 4 partes se
ajustan a esa forma: fase **declarada** (parte 1), **4 disparadores enumerados** (parte 2),
**umbral por footprint** (parte 3), **ausencia en el mockup** (parte 4).

## Fases / épicas

**Una sola tarea, 6 subtareas** (decisión 5.1). Orden por riesgo creciente: la limpieza primero
para no escribir reglas nuevas encima de reglas muertas.

| # | Subtarea | Footprint | Criticidad |
|---|---|---|---|
| .1 | **Limpieza de reglas muertas + allow-list** — 5× "branding en pausa"; `add-task` como canal (§8 y `design-system.md:17`); `Skill(ponytail*)` en `.claude/settings.json` | `agents/design.md`, `skills/urbea-design/SKILL.md`, `agents/tm-explore.md`, `commands/tm-explore.md`, `_template.md`, `CLAUDE.md` §8, `.claude/settings.json` | no crítica |
| .2 | **Parte 1 — régimen por fase** — tabla en §0 + línea declarativa en los 8 archivos de fase | `CLAUDE.md` §0 + 8 archivos de `.claude/**` | no crítica |
| .3 | **Parte 2 — trade-offs** — regla en §0 con los 4 disparadores + destino (bitácora completa + 2–3 líneas en la respuesta) | `CLAUDE.md` §0 | no crítica |
| .4 | **Parte 3 — reuso con reserva** — regla en §0 (umbral + cupo + formato) y reconciliación de las 5 copias de "reusar > reescribir" para que referencien §0 | `CLAUDE.md` §0, `agents/tm-explore.md`, `skills/urbea-context/SKILL.md`, `agents/analista-subtareas.md`, `agents/mobile.md` | no crítica |
| .5 | **Parte 4 — techo con propuesta** — §8 reescrito; sección en `_template.md`; disparador en el analista; emisión en `mobile.md`; pregunta en `/tm-plan`; bloqueantes en `/tm-tarea`; contrato de salida de `agents/tm-explore.md`; `design-system.md:17` → referencia a §8 | `CLAUDE.md` §8, `_template.md`, 5 archivos de `.claude/**`, `wiki/conceptos/design-system.md` | no crítica |
| .6 | **Ingest + sonda A** — ADR `0011`; `mapa-codebase.md`; `wiki/log.md`; corrección `update-subtask`→`tm-log.mjs` en `0006`/`0007`; correr la **sonda A** y pegar su salida real en la bitácora | `wiki/decisiones/0011-*.md`, `wiki/decisiones/0006`, `0007`, `wiki/codebase/mapa-codebase.md`, `wiki/log.md` | no crítica |

## Criterios de aceptación

**Parte 1 — régimen por fase**
- [ ] `CLAUDE.md` §0 contiene una tabla `fase → régimen` con las 3 filas: **propuesta** (ponytail
      no aplica; se exige divergencia de 2–4 direcciones), **ejecución** (`full`, sin cambio),
      **override** (el prompt explícito de Abraham gana siempre).
- [ ] La tabla dice explícitamente que ponytail **sí** aplica al **plan de implementación** que
      sale de la fase de propuesta y a **todo código**.
- [ ] Los 4 archivos de fase de propuesta (`agents/tm-explore.md`, `agents/design.md`,
      `commands/tm-explore.md`, `skills/urbea-design/SKILL.md`) declaran su régimen en su propio
      texto, apuntando a §0 como fuente.
- [ ] Los 4 archivos de ejecución (`commands/tm-plan.md`, `commands/tm-tarea.md`,
      `agents/mobile.md`, `agents/supabase.md`) declaran `full`.
- [ ] Verificable por grep: `grep -rn "ponytail" .claude/agents .claude/commands .claude/skills/urbea-design`
      devuelve **8 líneas de régimen**, una por archivo de fase.
- [ ] `.claude/settings.json` incluye `Skill(ponytail*)` en `permissions.allow` y el archivo sigue
      siendo JSON válido (`jq . .claude/settings.json` exit 0).
- [ ] `~/.claude/settings.json` **no aparece** en el diff.

**Parte 2 — trade-offs**
- [ ] `CLAUDE.md` §0 enumera los **4 disparadores** literales: (a) contrato publicado (§0.5.2),
      (b) ruta crítica por la regla de path (§5), (c) techo alcanzable con datos reales de
      producción, (d) descarta una alternativa que Abraham nombró.
- [ ] La regla dice que fuera de esos 4 casos siguen vigentes las 3 líneas de `§Output` del skill.
- [ ] La regla fija el destino: **explicación completa en la bitácora de la subtarea vía
      `tm-log.mjs`** + **resumen de 2–3 líneas en la respuesta del chat**.
- [ ] `.claude/skills/ponytail/SKILL.md` y sus 5 companions tienen **diff vacío**
      (`git diff --stat .claude/skills/ponytail*` sin salida).

**Parte 3 — reuso con reserva**
- [ ] `CLAUDE.md` §0 define el **umbral por footprint**: cabe en el footprint de la subtarea **y**
      no toca contrato publicado **ni** migraciones → se **propone** en el reporte de la subtarea
      y decide Abraham; en cualquier otro caso → se reusa + `// ponytail: deuda — <por qué>,
      refactor en #<id>` + derivada `hardening(<origen>)`.
- [ ] El formato del marcador **nombra la tarea derivada como trigger** (para que
      `/ponytail-debt` no lo clasifique `no-trigger`).
- [ ] La regla remite explícitamente a las **4 marcas** de tarea derivada del §5 (título,
      `Origen: … · Detectado por: …`, `dependencies`, backlink `DERIVADAS:`).
- [ ] La regla dice explícitamente que **no** autoriza refactorizar contra código que sirve a
      builds instalados sin aprobación (§0.5).
- [ ] Las 5 copias de "reusar > reescribir" (`CLAUDE.md:9`, `agents/tm-explore.md:16`,
      `skills/urbea-context/SKILL.md:23`, `agents/analista-subtareas.md`, `agents/mobile.md`)
      **referencian §0** en vez de re-enunciar la regla, sin borrar el contenido vigente de cada
      archivo (en particular el Paso 3b de graphify del analista y la §graphify de `urbea-context`).

**Parte 4 — techo con propuesta**
- [ ] `CLAUDE.md` §8 conserva la prohibición de **implementar** UI ausente del mockup **y** agrega
      la obligación de **proponerla** con el formato `UI_FUERA_DEL_MOCKUP:`.
- [ ] §8 ofrece **siempre las 2 opciones** (en conjunto en la tarea actual · derivada
      `producto(<origen>)`) con **default = derivada**.
- [ ] §8 ya **no** manda a `add-task`: el canal escrito es "escribir `tasks.json` directo
      (respaldo `.bak` + `validate-dependencies`)" — verificable por
      `grep -n "add-task" CLAUDE.md` (solo debe quedar la mención del §4 gotcha y del §5).
- [ ] `_template.md` tiene la sección **"UI/interacción fuera del mockup"** con el formato de
      propuesta, y el contrato de salida de `agents/tm-explore.md` (§Paso 5) la refleja con un
      campo nuevo.
- [ ] `agents/analista-subtareas.md` emite `UI_FUERA_DEL_MOCKUP:` por subtarea en su bloque de
      Output (formato EXACTO que el orquestador parsea), sin alterar el Paso 3b de graphify.
- [ ] `commands/tm-plan.md` §Reglas marca la pregunta como **obligatoria** cuando el analista lo
      emite (mismo patrón que ya usa con `⚠️ destructiva` / `⚠️ contrato`).
- [ ] `agents/mobile.md` emite `UI_FUERA_DEL_MOCKUP:` y `REUSO_CON_RESERVA:` en su §Output, y su
      **auto-check anti-scope-creep de L24 queda intacto** (verificable: la frase "no agrega
      comportamiento no pedido (scope creep)" sigue en el archivo).
- [ ] `commands/tm-tarea.md` §5 trata ambos marcadores por el camino de bloqueantes ya existente.
- [ ] `wiki/conceptos/design-system.md` L17 **referencia** §8 en vez de duplicar el texto del techo.

**Transversales**
- [ ] Los **3 invariantes del canal** están escritos: el agente propone/nunca decide · default
      derivada · **cupo máx 2 propuestas por tarea** (de la 3ª en adelante, solo se nombran en la
      bitácora).
- [ ] `.claude/hooks/tdd-guard.sh` tiene **diff vacío** y la criticidad por path es idéntica.
- [ ] Ninguna afirmación "branding en pausa" sobrevive: `grep -rn "en pausa" .claude/ .taskmaster/docs/exploraciones/_template.md`
      sin resultados (o solo citas históricas dentro de este doc 043).
- [ ] `agents/design.md` ya **no** instruye a abortar; su precondición pasa a la regla viva de §8
      (preview HTML aprobable por el cliente antes de portar a RN).
- [ ] **Sonda A ejecutada**: se corrió `/tm-explore` con una idea que necesita UI no dibujada y la
      **salida real** (no narrada) está pegada en la bitácora de la subtarea `.6`, mostrando la
      sección "UI/interacción fuera del mockup" llena y la pregunta con las 2 opciones.
- [ ] Ingest: `wiki/decisiones/0011-ponytail-y-fases-del-workflow.md` creado; `mapa-codebase.md`
      y `wiki/log.md` actualizados; `0006` y `0007` ya no prescriben `update-subtask` (dicen
      `tm-log.mjs`).
- [ ] `pnpm tsc --noEmit` y `pnpm lint` en exit 0 (gate del repo; vacuos aquí porque no se toca TS,
      se corren igual antes del PR).

## Dependencias

- **Ninguna tarea previa bloquea.** `dependencies: []`. No depende de código.
- Roza el backlog `pending`/`in-progress` (#255–#259): si se ejecuta en paralelo, ojo con el
  conflicto conocido de `tasks.json` entre ramas ([[lote_paralelo_tasks_json_conflictos]]) —
  aunque el footprint (`CLAUDE.md`, `.claude/**`, `_template.md`, `wiki/**`) no lo toca ninguna
  otra tarea abierta.
- **Depende de partir de `origin/main` fresco** por la restricción de ejecución (graphify #70 en
  `analista-subtareas.md` y `urbea-context/SKILL.md`).

## Edge cases / riesgos

- **🔴 Riesgo 1 — Máquina de backlog (scope creep sistematizado).** Las partes 3 y 4 abren dos
  canales nuevos para proponer trabajo, sobre un backlog que ya va en **259 tareas**. Si cada
  tarea pare 2–3 derivadas, el mecanismo erosiona el propio §0 ("mínimo código nuevo").
  **Mitigación adoptada (decisiones 3.3, 4.2 y los invariantes del canal):**
  (1) **cupo duro de 2 propuestas por tarea** — de la 3ª en adelante solo se **nombran** en la
  bitácora, sin redactar propuesta ni abrir derivada; (2) **default = derivada**, nunca "incluir
  en la tarea actual", de modo que el alcance de la rama abierta no crece por decisión del
  agente; (3) **el agente propone, nunca decide** — ninguna propuesta se auto-ejecuta, todas
  pasan por el checkpoint de Abraham. Los tres van escritos en §0/§8, no solo aquí.
- **🔴 Riesgo 2 — Regla no determinista = regla que se aplica a veces.** "Cuando el trade-off
  importe" y "cuando el patrón sea mediocre" nacieron como juicios.
  **Mitigación:** los 4 disparadores enumerados (parte 2) y el umbral por footprint (parte 3)
  convierten ambos en reglas derivables, al estilo de la criticidad por path del §5. Criterio de
  aceptación explícito para cada uno.
- **🔴 Riesgo 3 — Divergencia mal contenida.** Quitar ponytail de la fase de propuesta puede
  reintroducir el hábito que vino a matar: previews de más, direcciones que nadie pidió, plan que
  crece antes de existir.
  **Mitigación:** el techo va escrito en la propia tabla — **2 a 4 direcciones**, cada una con su
  trade-off, que es justo lo que `agents/tm-explore.md` §Paso 3 ya hace; y ponytail **sí** aplica
  al plan de implementación que sale de la fase, así que la convergencia vuelve en cuanto se pasa
  a `/tm-plan`.
- **`CLAUDE.md` como recurso escaso.** Es el schema que toda sesión lee; 4 reglas más compiten con
  su legibilidad, que es su única función. *Mitigación:* las 5 copias de "reusar > reescribir" se
  **colapsan** en una referencia a §0 (parte 3) → la tarea agrega reglas pero **quita**
  duplicación neta.
- **Duplicación §8 ↔ vault.** Resuelta por 4.4: §8 manda, el vault referencia. Si alguien vuelve a
  duplicar, quedan dos techos distintos.
- **`lite` ≠ off.** Ya resuelto por 1.1 (no se usa ningún nivel; se declara que la fase de
  propuesta está fuera del alcance del skill, apoyándose en su §Boundaries).
- **Revertir trabajo reciente de Abraham.** Riesgo real porque el footprint toca
  `analista-subtareas.md` y `urbea-context/SKILL.md`, ambos modificados el 2026-09-03 (#70
  graphify). *Mitigación:* la sección "Restricción de ejecución" + `git log -1 --stat` antes de
  editar + criterio de aceptación que exige que el contenido de graphify siga presente.
- **La promoción de esta misma tarea usa comandos rotos** (§4) → se escribe `tasks.json` a mano
  (contenido listo abajo).

## Plan de pruebas (alto nivel)

No hay código → **no hay suite**. Toda la tarea es **no crítica** por la regla de path del §5
(`CLAUDE.md`, `.claude/**`, `wiki/**`, `.taskmaster/docs/**`: nada cae en `supabase/functions/**`,
`supabase/migrations/**` ni en lógica móvil pura) → **verificación ligera, sin TDD, sin
`tdd-guard`, sin `test-author` ni `guardian`**.

**Evidencia de cierre (decisión 5.2), en dos capas:**

1. **Sonda A — conductual (la que cuenta).** Correr `/tm-explore` con una idea que **necesite UI
   no dibujada en el mockup** y pegar la **salida real** en la bitácora de `.6`. Pasa si:
   - el doc generado trae la sección **"UI/interacción fuera del mockup"** llena (no "n/a"),
   - la pregunta al usuario ofrece **las 2 opciones** (en conjunto vs derivada) con **default
     derivada** y una propuesta concreta redactada,
   - el subagente devuelve el campo nuevo en su contrato de salida.
   🔴 La salida se **pega literal** del comando, no se narra (regla del registro, §4).
2. **Verificación estática por grep** (barata, repetible):
   - `grep -rn "ponytail" .claude/agents .claude/commands .claude/skills/urbea-design` → 8 líneas
     de régimen, una por archivo de fase.
   - `grep -rn "en pausa" .claude/ .taskmaster/docs/exploraciones/_template.md` → vacío.
   - `grep -n "add-task" CLAUDE.md` → solo el gotcha del §4 y el §5, nunca como canal de §8.
   - `git diff --stat .claude/skills/ponytail* .claude/hooks/tdd-guard.sh` → vacío.
   - `jq . .claude/settings.json` → exit 0 con `Skill(ponytail*)` presente.
3. **Gate del repo antes del PR:** `pnpm tsc --noEmit` + `pnpm lint` en exit 0 (vacuos, se corren
   igual). Gate de producción viva §0.5: **n/a** (no hay migraciones, EFs ni contratos tocados;
   nada de esta tarea viaja por OTA).

## Impacto en PRD (solo referencia — NO se edita)

**n/a.** Es tooling de workflow; no toca `docs/PRD-MVP-demo.md` ni `docs/PRD.md`. El precedente es
la exploración `037-integracion-graphify-workflow.md` (también `tipo: chore`, footprint de
`.claude/**` + vault, sin impacto en PRD).

## Decisiones del intake

Las 14 preguntas del borrador, resueltas por **Abraham el 2026-09-05**. Todas quedaron en la
opción recomendada.

**Grupo 1 — régimen de ponytail por fase**
- **1.1 · Nivel por fase → "ponytail no aplica a la fase de PROPUESTA".** Se declara que explore,
  diseño/previews y lluvia de ideas están **fuera del alcance del skill**; ponytail **sí** aplica
  al **plan de implementación resultante** y a **todo código**. No se inventa un nivel nuevo: se
  apoya en `§Boundaries` del skill (*"Ponytail governs what you build, not how you talk"*). En la
  fase de propuesta se **EXIGE divergencia: 2–4 direcciones / alternativas de layout / componentes
  de firma.**
- **1.2 · Ubicación → tabla `fase → régimen` en `CLAUDE.md` §0 + una línea declarativa en cada
  archivo de fase.** Los de propuesta (`agents/tm-explore.md`, `agents/design.md`, comando y skill
  de explore/diseño) declaran el régimen divergente; en `tm-plan`, `tm-tarea`, `mobile` y
  `supabase` la línea dice **`full`**.
- **1.3 · Override → el prompt explícito de Abraham siempre gana** (ya es regla del skill:
  "anything explicitly requested" / "User insists → build it, no re-arguing").
- **1.4 · Allow-list → sí:** agregar `Skill(ponytail*)` a `.claude/settings.json` (proyecto).

**Grupo 2 — explicar trade-offs**
- **2.1 · Casa → `CLAUDE.md` §0.** El skill `ponytail` **NO se edita** (upstream limpio).
- **2.2 · Criterio derivable → los 4 disparadores:** (a) toca **contrato publicado** (§0.5.2),
  (b) cae en **ruta crítica TDD** por la regla de path (§5), (c) su **techo es alcanzable con
  datos reales de producción**, (d) **descarta una alternativa que Abraham nombró**.
- **2.3 · Destino → ambos:** explicación **completa en la bitácora** de la subtarea (`tm-log.mjs`)
  + **resumen de 2–3 líneas en la respuesta del chat**.

**Grupo 3 — excepción al rung 2**
- **3.1 · Casa → solo `CLAUDE.md` §0** ("reuso con reserva"); el skill no se toca. Además,
  **reconciliar las 5 copias** de "reusar > reescribir" para que **apunten a §0** en vez de
  re-enunciar la regla.
- **3.2 · Umbral por footprint:** si el refactor **cabe en el footprint de la subtarea** y **NO**
  toca contrato publicado ni migraciones → se **PROPONE** en el reporte de la subtarea y **Abraham
  decide**. Si no → se **reusa** + `// ponytail: deuda — <por qué>, refactor en #<id>` + derivada
  `hardening(<origen>)`.
- **3.3 · Cupo → máx 2 propuestas por tarea**; el resto solo se **nombra** en la bitácora.

**Grupo 4 — techo de UI con propuesta**
- **4.1 · Mecanismo A (dos puntos, un formato):** (1) sección obligatoria *"UI/interacción fuera
  del mockup"* en `_template.md` → pregunta `AskUserQuestion` en `/tm-explore` y `/tm-plan`, con el
  **analista** marcando `UI_FUERA_DEL_MOCKUP:` como disparador; (2) red en ejecución:
  `agents/mobile.md` emite `UI_FUERA_DEL_MOCKUP:` con **propuesta concreta** y `/tm-tarea` lo trata
  por el camino de bloqueantes. **El auto-check anti-scope-creep de `mobile.md` SE MANTIENE:** se
  agrega *proponer*, no *implementar de más*.
- **4.2 · Default → derivada `producto(<origen>)`** con la propuesta concreta **ya redactada**;
  Abraham la sube a la tarea actual si quiere. **Siempre se ofrecen las dos opciones** (en
  conjunto vs derivada).
- **4.3 · Limpieza → sí, en esta tarea:** las 5 afirmaciones muertas de "branding en pausa"
  (`agents/design.md`, `skills/urbea-design`, `agents/tm-explore.md`, `commands/tm-explore.md`,
  `_template.md`) + el allow-list de settings.
- **4.4 · Fuente → §8 manda**; `wiki/conceptos/design-system.md` **referencia** a §8 en vez de
  duplicar.

**Grupo 5 — alcance y cierre**
- **5.1 · Una sola tarea:** 4 subtareas (una por parte) + 1 de limpieza + 1 de ingest/sonda = **6**.
- **5.2 · Evidencia → sonda A** (correr `/tm-explore` con una idea que necesite UI no dibujada y
  **pegar la salida real**: aparece la sección y la pregunta con propuesta) **+ verificación
  estática por grep** de que cada archivo de fase tiene su línea de régimen.
- **5.3 · Ingest → ADR nuevo `wiki/decisiones/0011-ponytail-y-fases-del-workflow.md`** +
  `mapa-codebase.md` + `log.md`. Y **corregir de paso** en `0006`/`0007` la referencia a
  `update-subtask` (prohibido) → `tm-log.mjs` (colateral chico, solo texto).

**Restricciones anotadas por Abraham**
- La tarea se construye **ENCIMA** de las versiones actuales de skills/config y **nunca las
  revierte**: el #70 de graphify en `analista-subtareas.md` y `urbea-context/SKILL.md`, y el
  `~/.claude/settings.json` **global** (fuera del footprint; el que se edita es el del proyecto).
- **Riesgo 1 (máquina de backlog)** queda mitigado por **cupo (máx 2) + default derivada + el
  agente propone, nunca decide**, y esa mitigación va **escrita en §0/§8**, no solo en este doc.

## Promoción / descarte

**Al aprobar:** ⚠️ `task-master add-task` y `analyze-complexity` están **ROTOS** en este entorno
(§4, `generateObject` → API 400 por `tool_use` ids duplicados). La promoción se hace
**escribiendo `.taskmaster/tasks/tasks.json` directo**:

```bash
cp .taskmaster/tasks/tasks.json .taskmaster/tasks/tasks.json.bak
# insertar el task object de abajo en .master.tasks[]
task-master list >/dev/null && task-master validate-dependencies
# si algo re-tipó los ids: node .taskmaster/scripts/repair-ids.mjs
```

Esquema (§4): tag `master` → `tasks[]`; task `id` = **string**, `dependencies` = lista de
**strings**, subtask `id` = **int**. Siguiente id libre al redactar: **260** (máximo actual 259).
La complejidad se estima a mano (no hay reporte automático): **M / ~5 de 10** — muchos archivos,
riesgo bajo, cero código de app.

### Contenido listo para `tasks.json`

- **`id`**: `"260"` (confirmar con `jq -r '[.master.tasks[].id|tonumber]|max'` antes de escribir)
- **`title`**: `chore(workflow): ponytail por fase, trade-offs, rung 2 con reserva y techo de UI con propuesta`
- **`priority`**: `medium`
- **`dependencies`**: `[]`
- **`status`**: `pending`

**`description`:**

> Origen: exploración `.taskmaster/docs/exploraciones/043-ponytail-por-fase-y-techo-con-propuesta.md`
> (intake resuelto por Abraham, 2026-09-05) · Detectado por: usuario.
> Calibra el sistema de trabajo por fase. Hoy el reflejo de convergencia (ponytail `full`, techo
> del mockup, auto-check anti-scope-creep) corre igual en las 4 fases porque nadie escribió dónde
> empieza y dónde termina, y el agente queda **mudo**: ni señala que el patrón que reusa es deuda,
> ni que la pantalla necesita UI que el mockup no dibuja. Cuatro cambios de gobierno:
> (1) **ponytail no aplica a la fase de propuesta** (explore, diseño, previews) — ahí se EXIGE
> divergencia de 2–4 direcciones; sí aplica al plan de implementación y a todo código;
> (2) **trade-offs explicados** cuando caen en 4 disparadores derivables;
> (3) **reuso con reserva**: el rung 2 deja de favorecer el patrón mediocre a ciegas;
> (4) **techo de UI con propuesta**: de "techo mudo" a "techo con propuesta".
> Solo `CLAUDE.md`, `.claude/**`, `_template.md` y el vault. Cero código de app.

**`details`:**

> **Fuente de verdad del plan: el doc 043** (alcance, formatos, criterios de aceptación y las 14
> decisiones del intake). Resumen operativo:
>
> **6 subtareas, TODAS no críticas** (regla de path §5: `CLAUDE.md`, `.claude/**`, `wiki/**`,
> `.taskmaster/docs/**` no caen en rutas críticas → sin TDD, sin `tdd-guard`, sin `test-author`
> ni `guardian`; verificación ligera + sonda conductual).
> 1. **Limpieza + allow-list** — 5× "branding en pausa" muertas (`agents/design.md:10` instruye a
>    ABORTAR pese a que §8 levantó el gate el 2026-06-26; `skills/urbea-design/SKILL.md:8`;
>    `agents/tm-explore.md:27`; `commands/tm-explore.md:83`; `_template.md:50`); `add-task` como
>    canal de trabajo nuevo en §8 y `design-system.md:17` (ROTO por §4) → escribir `tasks.json`
>    directo; agregar `Skill(ponytail*)` a `.claude/settings.json`.
> 2. **Parte 1 — régimen por fase** — tabla `fase → régimen` en §0 (propuesta: ponytail NO aplica,
>    2–4 direcciones obligatorias · ejecución: `full` · override: el prompt de Abraham gana) + una
>    línea declarativa en los 8 archivos de fase. ⚠️ El nivel NO puede switchearse por
>    slash-command: un `/ponytail lite` del chat no cruza al subagente (contexto limpio), por eso
>    va declarado en cada archivo.
> 3. **Parte 2 — trade-offs** — regla en §0 con los 4 disparadores (contrato publicado §0.5.2 ·
>    ruta crítica por path §5 · techo alcanzable con datos reales de prod · descarta alternativa
>    que Abraham nombró). Destino: completo en bitácora (`tm-log.mjs`) + 2–3 líneas en la respuesta.
> 4. **Parte 3 — reuso con reserva** — §0: umbral por footprint (cabe y no toca contrato publicado
>    ni migraciones → PROPONE y decide Abraham; si no → reusa + `// ponytail: deuda — <por qué>,
>    refactor en #<id>` + derivada `hardening(<origen>)` con las 4 marcas del §5) + cupo máx 2 por
>    tarea. Reconciliar las 5 copias de "reusar > reescribir" para que referencien §0.
> 5. **Parte 4 — techo con propuesta** — §8 conserva la prohibición de IMPLEMENTAR y agrega la
>    obligación de PROPONER (`UI_FUERA_DEL_MOCKUP:` con las 2 opciones, default derivada
>    `producto(<origen>)`); sección nueva en `_template.md`; disparador en `analista-subtareas.md`;
>    emisión en `agents/mobile.md` (su auto-check anti-scope-creep de L24 SE MANTIENE);
>    pregunta obligatoria en `/tm-plan`; bloqueantes en `/tm-tarea`; contrato de salida de
>    `agents/tm-explore.md`; `wiki/conceptos/design-system.md:17` pasa a referenciar §8 (§8 manda).
> 6. **Ingest + sonda A** — ADR `wiki/decisiones/0011-ponytail-y-fases-del-workflow.md` (hoy
>    ponytail NO tiene ADR: entró el 2026-06-30, commit `513d4fe`, y solo vive en §0 + su
>    SKILL.md); `mapa-codebase.md`; `wiki/log.md`; corregir `update-subtask` → `tm-log.mjs` en
>    `0006` y `0007`; correr la sonda A y pegar su salida REAL.
>
> **NO SE TOCA:** `.claude/skills/ponytail/SKILL.md` ni sus 5 companions (upstream limpio,
> decisiones 2.1/3.1) · `.claude/hooks/tdd-guard.sh` (la criticidad por path no cambia) ·
> `~/.claude/settings.json` (global de Abraham) · `mobile/**`, `supabase/**`, PRD.
>
> **⚠️ RESTRICCIÓN — construir ENCIMA, nunca revertir:** `analista-subtareas.md` (Paso 3b de
> graphify, #70, 2026-09-03) y `skills/urbea-context/SKILL.md` (§graphify) tienen cambios recientes
> de Abraham. Ramificar desde `origin/main` fresco y `git log -1 --stat <archivo>` antes de editar.
>
> **Mitigación del riesgo "máquina de backlog"** (el backlog ya va en 259 tareas), escrita en
> §0/§8 y no solo en el doc: **cupo de 2 propuestas por tarea** (de la 3ª en adelante solo se
> nombran en la bitácora) · **default = derivada** (nunca "incluir en la tarea actual") · **el
> agente propone, nunca decide** (todo pasa por el checkpoint de Abraham).
>
> Impacto producción (§0.5): **sin riesgo** — no hay migraciones, EFs ni contratos publicados;
> nada de esta tarea viaja por OTA.

**`testStrategy`:**

> Sin suite: no hay código (todo es `CLAUDE.md`/`.claude/**`/`wiki/**`). Todas las subtareas son
> **no críticas** por la regla de path del §5 → verificación ligera, sin TDD ni guardian.
> **1) Sonda A (evidencia de cierre, decisión 5.2):** correr `/tm-explore` con una idea que
> necesite UI **no dibujada en el mockup** y pegar la **salida real** (no narrada, regla del
> registro §4) en la bitácora de la subtarea 6. Pasa si el doc generado trae la sección
> "UI/interacción fuera del mockup" llena (no "n/a"), la pregunta ofrece **las 2 opciones** (en
> conjunto vs derivada) con default derivada y una propuesta concreta redactada, y el subagente
> devuelve el campo nuevo en su contrato de salida.
> **2) Verificación estática (grep, repetible):**
> `grep -rn "ponytail" .claude/agents .claude/commands .claude/skills/urbea-design` → 8 líneas de
> régimen, una por archivo de fase ·
> `grep -rn "en pausa" .claude/ .taskmaster/docs/exploraciones/_template.md` → vacío ·
> `grep -n "add-task" CLAUDE.md` → solo el gotcha §4 y el §5, nunca como canal de §8 ·
> `git diff --stat .claude/skills/ponytail* .claude/hooks/tdd-guard.sh` → **vacío** ·
> `jq . .claude/settings.json` → exit 0 con `Skill(ponytail*)` presente ·
> la frase "no agrega comportamiento no pedido (scope creep)" sigue en `agents/mobile.md` ·
> el Paso 3b de graphify sigue en `analista-subtareas.md` y la §graphify en `urbea-context`.
> **3) Gate del repo antes del PR:** `pnpm tsc --noEmit` + `pnpm lint` exit 0 (vacuos, se corren
> igual). Gate §0.5: n/a.

**Subtareas sugeridas** (`id` int, en este orden): 1 limpieza+allow-list · 2 régimen por fase ·
3 trade-offs · 4 reuso con reserva · 5 techo con propuesta · 6 ingest+sonda A. Todas
`status: pending`, `dependencies: []` salvo la 6, que depende de `[1,2,3,4,5]`.

**Al descartar:** n/a — aprobado en el intake del 2026-09-05.
