---
description: EXPLORE — planeación de una idea o cambio ANTES del ciclo TDD. Investiga, hace lluvia de ideas si la idea es abstracta, desambigua con preguntas extensivas (escaladas por complejidad) y documenta un plan APROBABLE/DESCARTABLE. Al aprobar lo promueve a tarea(s) de Taskmaster. No codifica, no encadena.
argument-hint: "[idea o descripción libre; puede ser muy abstracta, ej. 'algo para que el agente vea sus leads en tiempo real']"
allowed-tools: Bash, Read, Grep, Glob, Write, Edit, Agent, AskUserQuestion
---

Ceremonia **EXPLORE** del workflow — la **capa de planeación previa** al ciclo TDD. Toma una idea (de un fix simple a una épica entera, incluso abstracta), la **investiga** y hace **lluvia de ideas** si hace falta, la **desambigua con preguntas extensivas** escaladas por complejidad, y la **documenta** en un plan que el dueño puede **aprobar** (→ se promueve a tarea[s] en Taskmaster) o **descartar** (queda como registro de decisión). **No codifica y no encadena** el ciclo TDD.

Es la capa de **diseño/planeación**; una tarea aprobada aquí alimenta a `/tm-plan` (footprint + plan de subtareas) y luego a `/tm-tarea` (ejecución TDD). El flujo completo: **`/tm-explore` (idea → tarea) → `/tm-plan <id>` (plan de subtareas) → `/tm-tarea <id>` (ejecución)**.

**Convenciones duras:** CLI `task-master` (nunca el MCP; provider `claude-code/sonnet`, tag `master`). Identificadores propios en **snake_case**. **PNPM** siempre. No edites `mobile/**`, `supabase/**` ni los PRD maestros.

## Argumento

`$ARGUMENTS`: la idea/descripción libre. Si viene vacía, pregunta "¿Qué idea quieres explorar/planear?" antes de continuar.

## Pasos

1. **Investiga + redacta el borrador con el subagente `tm-explore`.** Lánzalo con la idea (y, en pasadas siguientes, con las respuestas ya recolectadas):
   - Devuelve: **nivel** (XS…XL), **tipo**, ruta del **doc borrador**, **lluvia de ideas** (si la idea era abstracta), **preguntas abiertas** agrupadas con opciones, reglas no obvias tocadas, gate de branding, riesgos y si está `LISTO_PARA_PROMOVER`.
   - El subagente **no pregunta nada** — solo investiga y propone (vault `wiki/` vía skill `urbea-context`, sin `grep` a ciegas). Tú (agente principal) eres quien habla con el usuario en los pasos siguientes.

2. **Converge la lluvia de ideas (solo si la idea era abstracta).** Si el subagente devolvió direcciones/enfoques, preséntalos con `AskUserQuestion` (la opción recomendada primero, con "(Recomendado)") para elegir la dirección antes de afinar el detalle. La elección se anota en el doc (sección "Lluvia de ideas" + "Decisiones del intake").

3. **Desambigua con preguntas extensivas — profundidad escalada por nivel.** Haz las rondas de `AskUserQuestion` (máx 4 por llamada, varias rondas) sobre las **preguntas abiertas** del subagente. La extensión depende del nivel:
   - **XS/S** — 1 ronda mínima: resultado esperado + criterios de aceptación + qué NO entra.
   - **M** — 2–3 rondas: checklist completo (motivación, alcance, roles, impacto en datos, impacto en UI, reglas no obvias, criterios, dependencias, edge cases).
   - **L/XL** — varias rondas: además del checklist, **arquitectura/enfoque técnico** (Edge Functions vs. RLS vs. trigger), **fases/épicas con dependencias**, plan de pruebas (pgTAP / Vitest-Deno), datos/migraciones y estrategia de rollout. No avances mientras quede un hueco.

   **Reglas de la desambiguación (extensiva hasta cubrir todo):**
   - Pregunta **solo lo que la investigación no resolvió**. Para cada pregunta ofrece la opción recomendada primero ("(Recomendado)").
   - Si una respuesta abre nuevas ambigüedades o áreas técnicas, **re-invoca al subagente `tm-explore`** con las respuestas para que re-investigue y actualice el borrador + la lista de preguntas. Itera hasta `LISTO_PARA_PROMOVER: sí`.
   - **Gate de branding (#19):** si el subagente marcó `GATE_BRANDING: sí`, NO promuevas el alcance de diseño visual sin confirmar el visto bueno del cliente (CLAUDE.md §8). Pregúntalo explícitamente.
   - **No avances al PASO 4 sin criterios de aceptación completos y verificables.** Si dudas, hay otra ronda.

4. **Finaliza el doc y decide su destino.** Actualiza el doc a `estado: en-revision`, llena toda sección con respuesta (o "n/a" explícito) y registra cada decisión en "Decisiones del intake". Muéstralo y pregunta con `AskUserQuestion`:
   - **Aprobar** → `estado: aprobado`; sigue al PASO 5.
   - **Ajustar** → vuelve a editar el doc (o regresa al PASO 3 si falta desambiguar).
   - **Descartar** → `estado: descartado`, llena `motivo_descarte:` en el frontmatter y la sección "Promoción / descarte"; registra el log (PASO 6) y **TERMINA sin crear tarea**. El doc queda en el repo como registro de la decisión.

5. **Promueve a Taskmaster (solo si aprobado).** Construye un prompt rico desde el doc (resumen + criterios + reglas no obvias + archivos previstos) y captura el/los id nuevos:
   ```bash
   BEFORE=$(jq -r '[.master.tasks[].id | tonumber] | max' .taskmaster/tasks/tasks.json)
   task-master add-task \
     --prompt="{resumen + criterios de aceptación + reglas no obvias aplicables + archivos previstos a tocar}" \
     --priority={high|medium|low} \
     [--dependencies={ids}]
   AFTER=$(jq -r '[.master.tasks[].id | tonumber] | max' .taskmaster/tasks/tasks.json)
   # el/los id nuevos = (BEFORE, AFTER]
   ```
   Para **L/XL**, si el plan tiene fases/épicas claramente separables, crea **varias tareas** con dependencias entre sí (`add-dependency`) en vez de una sola. Escribe el/los `tarea_id` en el frontmatter y la sección "Promoción / descarte". Luego analiza complejidad, **sin pisar el reporte maestro** (`.taskmaster/reports/task-complexity-report.json`):
   ```bash
   task-master analyze-complexity --id {id[,id]} \
     -o .taskmaster/reports/exploracion-${NNN}-complexity.json
   ```
   Muestra `complexityScore`, `recommendedSubtasks` y `reasoning`. **El desglose fino en subtareas se hace después** (`/tm-plan` / `task-master expand`) — no lo encadenes aquí.

6. **Cierra (NO encadenes).** Registra 1 línea al final de `wiki/log.md` (append-only, mismo patrón del proyecto):
   ```bash
   TODAY=$(date +%F)
   printf '\n## [%s] explore | %s — %s\n' "$TODAY" "{aprobado tarea ${id}|descartado}" "{título}" >> wiki/log.md
   ```
   Imprime el resumen y el **siguiente paso sugerido sin ejecutarlo**:
   ```
   ✅ Exploración {aprobada|descartada} — {título}  (nivel {XS..XL})
      - Doc: .taskmaster/docs/exploraciones/{NNN}-{slug}.md
      (si aprobada:)
      - Tarea(s): {id[,id]}  ·  Complejidad: {score}/10
      - Reporte: .taskmaster/reports/exploracion-{NNN}-complexity.json

   Siguiente paso (no lo ejecuté):
      → /tm-plan {id}        {planea las subtareas: footprint, agente, criticidad TDD}
      → /tm-tarea {id}       {cuando el plan esté listo, ejecútala subtarea por subtarea}
   ```

## Reglas

- **No edites `mobile/**`, `supabase/**` ni los PRD.** Esta ceremonia solo crea/edita el doc de exploración, llama al CLI `task-master` (solo al aprobar) y lee contexto del vault.
- **CLI `task-master`, nunca MCP.**
- **Las preguntas las hace el agente principal** con `AskUserQuestion`; el subagente `tm-explore` solo investiga, hace lluvia de ideas y redacta (no puede preguntar).
- **No llegues al PASO 4 sin criterios de aceptación completos.** Si dudas, otra ronda.
- **No crees tarea si se descarta.** El doc descartado se conserva como registro de decisión.
- **Branding en pausa (#19):** no promuevas alcance de diseño visual sin visto bueno del cliente.
- El doc de exploración es el entregable de planeación; el log paso-a-paso por subtarea lo escriben después `/tm-plan` y `/tm-tarea` en Taskmaster.
