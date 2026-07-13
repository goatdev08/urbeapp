---
tipo: chore          # feature | fix | refactor | chore | proyecto — tooling de workflow, no toca producto
nivel: M             # M para la integración base; una fase 2 (olas paralelas) sería L aparte
fecha: 2026-07-12    # absoluta
estado: borrador      # borrador → en-revision → aprobado | descartado
tarea_id:             # se llena SOLO al promover
motivo_descarte:      #
---

# Integración de graphify al workflow

> Documento de exploración/planeación de `/tm-explore`. Un archivo por idea.
> Puede **APROBARSE** (→ tarea[s] en Taskmaster) o **DESCARTARSE** (registro de decisión).
> NO edita PRD maestros. Es tooling de workflow, no producto: no toca `mobile/**` ni `supabase/**`.

## Idea original
"Retomar/integrar graphify al workflow de Urbea." El encaje ya estaba **diseñado** en
`0007-workflow-multiagente.md` §"Futuro: graphify" y en `urbea-context/SKILL.md` §"Futuro: graphify"
como trabajo diferido ("cuando Urbea tenga bastante código"). Hallazgo clave que desmitifica la idea:
**graphify NO hay que construirlo — ya está instalado** y ya se usó con éxito en el repo hermano AJN.

## Lluvia de ideas (solo si la idea era abstracta)
La idea llega semi-concreta (el encaje ya está en el ADR 0007), pero el *cuánto/cuándo* sí admite
direcciones. Tres enfoques de alcance para esta integración:

- **[REC] A — Integración base "read + ingest" (MVP, nivel M).** Instalar el skill, construir el
  primer grafo, cablear `urbea-context` para consultar `graphify explain/path/query` **antes** del
  `mapa-codebase.md`, y añadir `graphify update .` al cierre de `/tm-tarea`. Sin tocar la ejecución
  en serie. Beneficio inmediato (contexto más barato/preciso), riesgo bajo, reversible. **Recomendado**:
  entrega valor ya y es prerequisito de cualquier fase 2.
  *Trade-off:* no desbloquea paralelismo todavía; añade un artefacto (`graphify-out/`) a mantener.

- **B — Todo-en-uno: base + olas paralelas con worktrees (nivel L/XL).** Además de A, diseñar el
  *scheduler de olas* que lee el grafo, detecta subtareas de footprint disjunto y las corre en
  `git worktree` paralelos. *Trade-off:* mucho mayor superficie (orquestador nuevo, merge de estado
  Taskmaster entre worktrees, `tdd-guard` concurrente, resolución de conflictos). Alto valor pero
  alto riesgo; mejor como fase 2 separada una vez que la base esté rodada.

- **C — No integrar aún (esperar más código).** Mantener el diferido del ADR. *Trade-off:* el
  codebase ya NO es chico (ver "Costo/beneficio"): 321 archivos de código, ~38.7k LOC TS/TSX + ~6k
  LOC SQL, 58 archivos de Edge Functions, 27 migraciones. El argumento de "esperar" del ADR ya se
  cumplió; postergar solo retrasa el beneficio. Se descarta salvo que Abraham priorice otra cosa.

**Elegido:** A como tarea M ahora; B queda registrado como fase 2 (tarea L futura), no en el MVP.

## Problema / Motivación
El workflow tiene UNA fuente de contexto de código: el `mapa-codebase.md` **manual** (dominio→archivos),
que hay que mantener a mano en cada ingest y que se desincroniza (el propio `urbea-context/SKILL.md`
admite "si el mapa está desactualizado… actualízalo"). No hay verdad *mecánica* de "qué llama a qué,
ahora". graphify aporta exactamente eso: un grafo AST regenerable sin costo de API. Dos beneficios:
1. **Contexto más barato y preciso** al abrir una subtarea (ubicar el SUT y sus vecinos reales sin `grep`
   a ciegas — refuerza el mandato "sin grep" de CLAUDE.md §2).
2. **Prerequisito del unlock de olas paralelas**: un grafo de dependencias confiable es lo que permitiría
   correr subtareas de footprint disjunto en paralelo (hoy la ejecución es estrictamente en serie).

Encaje con el hito demo: **indirecto pero real** — no es feature de producto; es velocidad/calidad de
ejecución. No compite por tiempo de demo si se dimensiona como M y se hace fuera de la ruta crítica.

## Resultado esperado
- `graphify-out/graph.json` existe y refleja el codebase actual de Urbea.
- Al abrir una subtarea, `urbea-context` consulta el grafo (`graphify explain "<símbolo>"` /
  `graphify path "<A>" "<B>"` / `graphify query "<pregunta>"`) **antes** del `mapa-codebase.md`, y solo
  cae al mapa manual / `grep` si el grafo no resuelve.
- Al cerrar una tarea, `/tm-tarea` corre `graphify update .` (solo AST, sin LLM) para mantener el grafo
  al día, junto al ingest del vault existente.
- Queda documentado el reparto de roles: **vault = síntesis humana** (por qué, decisiones, invariantes 🔒);
  **graphify = verdad mecánica** (qué llama a qué, ahora). No se elimina el mapa manual en este MVP.

## Qué es graphify concretamente (verificado)
Herramienta **ya instalada**, no un TODO abstracto:
- Binario: `~/.local/bin/graphify` (Python vía uv, paquete `graphifyy`, módulo `graphify.__main__`).
- Constructor de **grafo AST del código** → emite `graphify-out/graph.json` (+ `GRAPH_REPORT.md`,
  `graph.html`, `GRAPH_TREE.html`). Community detection + "god nodes".
- Verbos reales relevantes (de `graphify --help`, verificado 2026-07-12):
  - `update <path>` — re-extrae código y actualiza el grafo, **sin LLM / sin costo de API** (el que va al cierre).
  - `explain "X"` — explicación en lenguaje natural de un nodo y sus vecinos.
  - `path "A" "B"` — camino más corto entre dos nodos.
  - `query "<pregunta>"` — traversal BFS (contexto enfocado, con `--budget N` tokens).
  - `affected "X"` — traversal inverso: nodos impactados por X (útil para footprint de un cambio).
  - `watch <path>` — rebuild al cambiar archivos.
  - `install --platform claude|cursor|codex|…` — copia el SKILL a la config de la plataforma.
  - `claude install` — escribe una sección graphify en CLAUDE.md + un **PreToolUse hook** (Claude Code).
  - `merge-graphs` / `merge-driver` / `hook install` — cross-repo y git union-merge del `graph.json`.
  - `diagnose multigraph`, `cluster-only`, `label`, `tree`, `export callflow-html`, `global add/list`.

**Patrón observado en AJN** (`/Users/fru/Dev/AJN`, read-only) — así quedó integrado allá:
- `graphify-out/` **versionado** (NO está en `.gitignore` de AJN), con `graph.json` (~13 MB),
  `GRAPH_REPORT.md`, `manifest.json`, snapshots por fecha. Grafo de **17,603 nodos / 21,146 aristas**
  (corpus grande: incluye `src/`, `ajn-vault/`, scripts, tests).
- Skill `graphify` en `.claude/skills/graphify/` (SKILL.md con verbos y regla "grep es fallback").
- Sección `## graphify` en su `CLAUDE.md` (líneas ~279-289): "grep es fallback, nunca primera opción";
  usar `query`/`path`/`explain`; `graphify update .` después de modificar código.
- **Dos PreToolUse hooks** en `.claude/settings.json` que interceptan `grep`/`rg`/`find` y Read de
  archivos de código, e inyectan `additionalContext` recordando usar el grafo. Es el "enforcement"
  del mandato sin-grep, análogo a nuestro `tdd-guard.sh`.
- (No hay `hook install` de git post-commit activo; el update es manual/por comando.)

## Alcance
- **SÍ entra (tarea M base):**
  1. `graphify install --platform claude` (o el equivalente que copie el SKILL a `.claude/skills/`).
  2. Construir el primer grafo con `graphify update .` y medir nodos/ruido.
  3. Cablear `urbea-context/SKILL.md`: añadir el paso "consultar el grafo antes del mapa manual".
  4. Cablear el comando `/tm-tarea` (paso de cierre/ingest): añadir `graphify update .`.
  5. Decidir e implementar `.gitignore` vs versionado de `graphify-out/`.
  6. Ingest al vault: nota en `0007`, en `mapa-codebase.md` (rol de graphify vs mapa manual), `log.md`.
- **NO entra (out of scope, → fase 2 tarea L):** el scheduler de olas paralelas con worktrees; extracción
  semántica con LLM (`graphify extract --backend …` tiene costo — el MVP usa solo AST `update`); MCP
  server de graphify; grafo global cross-repo (`global add`). Tampoco se **elimina** el `mapa-codebase.md`
  manual en este MVP (coexisten; ver preguntas abiertas).
- ⚠️ **CLAUDE.md**: `graphify claude install` **escribe en CLAUDE.md**. Como este subagente no edita
  CLAUDE.md ni el orquestador debe hacerlo a ciegas, esa edición se hace **a mano y revisada** (o se
  omite el hook y se documenta el uso solo en el skill). Ver pregunta abierta 5.

## Roles afectados
n/a para roles de producto (comprador / inmobiliaria / admin). Afecta a los **agentes de IA** del
workflow (los que abren subtareas vía `urbea-context` y los que cierran vía `/tm-tarea`).

## Impacto en datos
n/a. No toca schema, migraciones, RLS ni Storage. graphify solo **lee** el código; escribe artefactos
en `graphify-out/` (fuera de `mobile/**` y `supabase/**`).

## Impacto en UI
n/a. No toca producto. `graph.html`/`GRAPH_TREE.html` son visualizaciones de dev, no UI de la app.
**Sin gate de branding.**

## Reglas no obvias aplicables
- **"Sin grep" al iniciar sesión** — `CLAUDE.md §2` y `urbea-context/SKILL.md` §Regla. graphify
  *refuerza* esta regla (es la herramienta que hace innecesario el grep); el hook de AJN la enforce.
- **Ingest al cerrar** — `CLAUDE.md §7` y `urbea-context` §"Mantener el vault". `graphify update .` se
  suma a este paso, no lo reemplaza.
- **Reusar > reescribir / ponytail** — `CLAUDE.md §0`. graphify YA está instalado: cero código nuevo de
  herramienta; la integración es config + edición de skill/comando + un `.gitignore`/versionado.
- **PNPM siempre** — no aplica a graphify (es Python/uv), pero el doc lo refleja: graphify no cambia el
  runner de la app.
- **Migraciones idempotentes / RLS 2ª capa / triggers atómicos** — no tocadas (sin BD).

## Arquitectura / enfoque técnico  (L/XL — n/a para fixes)
Reparto de roles (la decisión conceptual central de esta integración):

| Fuente | Naturaleza | Contenido | Se mantiene |
|---|---|---|---|
| `wiki/` (vault) | Síntesis **humana** | Por qué, decisiones (ADRs), invariantes 🔒, flujos, conceptos | A mano, en el ingest |
| `graphify-out/graph.json` | Verdad **mecánica** | Qué símbolo llama a qué, ahora (AST); vecinos, caminos, impacto | `graphify update .` (auto, sin LLM) |
| `mapa-codebase.md` | Índice **manual** dominio→archivo | Puente semántico "este dominio vive en estos paths" | A mano (candidato a adelgazar cuando el grafo lo cubra) |

Flujo de consulta previsto en `urbea-context` (query): `index` → `conceptos` → **[nuevo] `graphify
explain/path/query` para ubicar el SUT y sus vecinos reales** → `mapa-codebase` (si el grafo no basta) →
fuente literal. Flujo de cierre en `/tm-tarea` (ingest): pasos actuales del vault **+ `graphify update .`**.

Cablear son ediciones de **texto de skill/comando**, no de código de app:
- `urbea-context/SKILL.md`: promover el bloque "Futuro: graphify" a un paso activo del flujo.
- comando `/tm-tarea` (`.claude/commands/…`): añadir la línea `graphify update .` al cierre.
- opcional: PreToolUse hook estilo AJN en `.claude/settings.json` para recordar el grafo ante grep/Read
  (evaluar; puede ser ruido — pregunta abierta 5).

## Fases / épicas  (L/XL — n/a para cambios chicos)
- **Fase 1 (esta exploración, tarea M):** integración base "read + ingest" (alcance SÍ-entra arriba).
- **Fase 2 (tarea L futura, NO ahora):** **scheduler de olas paralelas con git worktrees.** El grafo
  confiable permitiría al orquestador (`/tm-plan` / un nuevo `/tm-olas`) detectar subtareas de footprint
  **disjunto** (sin nodos/aristas compartidos → sin conflicto de merge esperado) y correrlas en
  `git worktree` paralelos, colapsando el tiempo de una tarea con muchas subtareas independientes.
  **Honestidad sobre lo que falta (no es gratis):**
  - Diseñar el scheduler: leer el grafo, calcular footprints por subtarea (`graphify affected`), probar
    disyunción, agrupar en olas y ordenar por dependencias de Taskmaster.
  - Sincronizar estado Taskmaster entre worktrees (hoy el apilamiento de ramas ya nos costó; ver
    `branch_stacking_main_stale`) — merge de `.taskmaster` no trivial.
  - `tdd-guard.sh` + sentinel `.taskmaster/.current-red` concurrentes (hoy asumen serie).
  - Resolución/merge de conflictos entre worktrees y `merge-driver` de git para `graph.json`.
  - AJN dejó comandos `tm-paralelo-*` **archivados** (`.claude/_archive/commands/`), señal de que el
    paralelismo se intentó y se pausó allá — leerlos antes de diseñar la fase 2 (lecciones aprendidas).
  Por eso la fase 2 **no** entra en el MVP: es una tarea L con su propia exploración.

## Criterios de aceptación
- [ ] Skill graphify disponible en `.claude/skills/` del repo Urbea (instalado, no inventado).
- [ ] `graphify-out/graph.json` construido con `graphify update .`; **conteo de nodos registrado** en la
      tarea y comentado (¿tiene sentido ya o hay ruido?).
- [ ] `urbea-context/SKILL.md` actualizado: el grafo se consulta **antes** del `mapa-codebase.md`, con los
      verbos concretos (`explain`/`path`/`query`) y la regla de fallback al mapa/grep.
- [ ] `/tm-tarea` corre `graphify update .` en el cierre/ingest (verificado en el texto del comando).
- [ ] Decisión `.gitignore` vs versionado de `graphify-out/` tomada y aplicada (con `merge-driver` si se versiona).
- [ ] Ingest al vault: `0007` §graphify pasa de "Futuro" a "vivo"; `mapa-codebase.md` documenta el reparto
      de roles vault/graphify; línea en `log.md`.
- [ ] {? PENDIENTE por resolver: si CLAUDE.md se edita con la sección graphify — depende de pregunta abierta 5}

## Dependencias
- graphify ya instalado (`~/.local/bin/graphify`, paquete `graphifyy`). Sin dependencia de Taskmaster previa.
- Referencia de patrón: `/Users/fru/Dev/AJN` (`.claude/skills/graphify/`, `CLAUDE.md §graphify`,
  `settings.json` hooks, `graphify-out/` versionado).
- Fase 2 depende de esta tarea (grafo confiable) + del estudio de los `tm-paralelo-*` archivados de AJN.

## Edge cases / riesgos
- **Ruido si el codebase fuera chico** — mitigado: ya NO es chico (321 archivos, ~44.7k LOC). Aun así,
  medir el conteo de nodos al construir y decidir si el grafo aporta o abruma.
- **Doble fuente de verdad** vault-mapa-manual vs grafo — riesgo de divergencia. Mitigación: roles
  explícitos (tabla arriba); el grafo es mecánico/regenerable, el mapa manual se adelgaza si el grafo lo cubre.
- **Mantenimiento del grafo** — si `graphify update .` no se corre al cierre, el grafo envejece (mismo
  problema que el mapa manual, pero barato de regenerar). Mitigación: cablearlo en `/tm-tarea` (auto).
- **`graph.json` grande y versionado** — en AJN pesa ~13 MB; versionarlo infla el repo y genera diffs
  ruidosos/merge-conflicts (por eso existe `merge-driver` union). Alternativa: `.gitignore` + generación
  on-demand. Ver pregunta abierta 1.
- **`graphify claude install` toca CLAUDE.md y añade un hook** — no debe correrse a ciegas; edición
  revisada a mano o se omite. Ver pregunta abierta 5.
- **AST-only vs semántico** — `update` es AST puro (gratis) pero menos rico que la extracción semántica
  LLM (`extract`, con costo). El MVP asume que el AST basta para "ubicar SUT y vecinos"; validar.
- **Fase 2 (paralelo) es donde vive el riesgo real** — no confundir el bajo riesgo de la fase 1 con la
  complejidad de la fase 2 (worktrees + estado Taskmaster concurrente).

## Plan de pruebas (alto nivel)
No es código de producción → **sin TDD estricto** (no toca `functions/**`, `migrations/**`, `lib/**`,
`hooks/**`, `utils/**`). Verificación ligera:
- Construir el grafo y validar que `graphify explain "<un símbolo real de mobile/src>"` y
  `graphify path "<A>" "<B>"` devuelven algo coherente (smoke manual).
- Verificar que el texto de `urbea-context` y `/tm-tarea` quedó correcto (lectura).
- Si se versiona `graphify-out/`: probar el `merge-driver` en un merge de juguete.
- Sin pgTAP / Vitest / Deno (no hay Edge Functions ni migraciones involucradas).

## Impacto en PRD (solo referencia — NO se edita)
n/a. Es tooling de workflow; no toca `docs/PRD-MVP-demo.md` ni `docs/PRD.md`. A lo sumo, una nota en
`CLAUDE.md §4.5` (capa de planeación) mencionando el grafo como fuente de contexto — decisión del dueño.

## Decisiones del intake
Pendiente de la ronda con el orquestador (ver "Preguntas para el orquestador"). Este borrador deja
propuestas [REC] pero **no** las da por decididas.

## Preguntas para el orquestador
1. **¿Versionar `graphify-out/graph.json` o generarlo on-demand (`.gitignore`)?**
   Opciones: [**[REC]** versionar `graph.json` + `manifest.json` con `merge-driver` union (como AJN;
   el grafo viaja entre ramas/worktrees, clave para fase 2) · gitignorar todo y regenerar on-demand
   (repo limpio, sin diffs ruidosos, pero cada worktree/checkout reconstruye) · híbrido: versionar solo
   `manifest.json` y regenerar `graph.json`].
2. **¿graphify reemplaza o complementa `mapa-codebase.md`?**
   Opciones: [**[REC]** complementan en el MVP (grafo = mecánico; mapa = puente dominio→archivo), y se
   adelgaza el mapa manual gradualmente si el grafo lo cubre · reemplaza ya (borrar el mapa manual, todo
   al grafo) · coexisten indefinidamente sin adelgazar].
3. **¿Integrar ya o esperar a más código?**
   Opciones: [**[REC]** ya — el umbral "cuando tenga bastante código" del ADR 0007 se cumplió (321
   archivos, ~44.7k LOC, 58 EF, 27 migraciones) · esperar a post-demo para no distraer de la ruta crítica].
4. **¿La fase 2 (olas paralelas con worktrees) ahora o después?**
   Opciones: [**[REC]** después — tarea L con exploración propia, tras estudiar los `tm-paralelo-*`
   archivados de AJN; el MVP entrega valor sin ella · ahora, como parte de esta tarea (nivel sube a L/XL);
   no hacerla nunca (solo usar el grafo para contexto)].
5. **¿Correr `graphify claude install` (edita CLAUDE.md + añade PreToolUse hook) o solo instalar el skill?**
   Opciones: [**[REC]** solo skill + edición manual revisada de una nota corta en CLAUDE.md (sin hook
   automático al inicio) · correr `claude install` completo y revisar el diff antes de commitear (replica
   AJN, incluye el hook anti-grep) · skill sin tocar CLAUDE.md en absoluto].
6. **¿Extracción AST-only o también semántica (LLM)?**
   Opciones: [**[REC]** AST-only (`update`, gratis) para el MVP; evaluar `extract --mode deep` después si
   el grafo AST se queda corto · semántica desde el inicio (más rica, pero con costo de API y más lenta)].

## Promoción / descarte
**Al aprobar (propuesta):** 1 tarea **M** "Integrar graphify al workflow" con subtareas candidatas:
(a) instalar skill + construir primer grafo y medir nodos; (b) cablear `urbea-context` (grafo antes del
mapa); (c) cablear `/tm-tarea` cierre (`graphify update .`); (d) decisión `.gitignore` vs versionado
(+`merge-driver` si aplica); (e) ingest al vault (`0007` a "vivo", `mapa-codebase`, `log`). Ninguna
subtarea es crítica-TDD (no toca `functions/**`/`migrations/**`/lógica pura). Además: **1 tarea L futura**
"Scheduler de olas paralelas con worktrees" (fase 2, con su propia exploración; depende de esta).
Comando siguiente sugerido tras aprobar: `/tm-plan <id>`.
**Al descartar:** registrar si fue por timing (esperar post-demo) o por preferir mantener solo el vault manual.

## ✅ Resolución — Abraham (2026-07-12) — APROBADA
- **1. Grafo `graph.json`: VERSIONADO en git con `merge-driver` union** (viaja entre worktrees, habilita fase 2).
- **2. Integrar YA** (umbral de tamaño cumplido: 321 archivos, ~38.7k LOC TS/TSX + ~6k SQL).
- **3. graphify COMPLEMENTA `mapa-codebase.md`** (se adelgaza el mapa gradualmente, no se borra en el MVP).
- **4. Install COMPLETO: `graphify claude install`** (edita CLAUDE.md + 2 hooks PreToolUse anti-grep, replica AJN) — revisar el diff antes de commitear.
- **5. Fase 2 (worktrees paralelos): DESPUÉS** — tarea L propia con exploración, tras estudiar los `tm-paralelo-*` archivados de AJN.
- **6. Extracción AST-only** (`update`, gratis) para el MVP.

**Promoción:** se crea 1 tarea **M** "Integrar graphify al workflow" (subtareas a–e del plan). La tarea L de fase 2 NO se crea aún. ID de tarea: ver `wiki/log.md` [2026-07-12].
