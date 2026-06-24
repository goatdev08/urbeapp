---
description: PLAN — planea una tarea de Taskmaster: análisis de subtareas (footprint, agente, skills, criticidad) + preguntas de diseño al usuario + registro del plan en las subtareas. No ejecuta código.
argument-hint: "[task-id]"
allowed-tools: Bash, Read, Grep, Glob, Agent, AskUserQuestion
---

Fase de **planeación** de UNA tarea (antes de `/tm-tarea`). Lee la tarea vía CLI, invoca al analista, te hace las preguntas de diseño y registra el plan en las subtareas. No toca código.

Ubicación en el workflow: **`/tm-explore` (idea → tarea) → `/tm-plan <id>` (esta · plan de subtareas) → `/tm-tarea <id>` (ejecución)**. Si la tarea nació de una exploración, su doc vive en `.taskmaster/docs/exploraciones/` — léelo como contexto antes del análisis. Para una idea aún abstracta o sin tarea, empieza por `/tm-explore`.

## Pasos
1. **Lee la tarea**: `task-master show <id> </dev/null` (CLI, no MCP).
2. **Contexto**: carga el skill `urbea-context` y ubica los conceptos del dominio en el vault.
3. **Análisis**: invoca el subagente `analista-subtareas` con el `task_id`. Imprime su reporte (footprint · agente · skills · criticidad · orden · bloqueantes).
4. **Preguntas de diseño**: si el análisis o los conceptos marcan decisiones (UX, approach, alcance), usa `AskUserQuestion` (una sola llamada, máx 4). Aplica las respuestas.
5. **Registra el plan** en cada subtarea:
   ```bash
   task-master update-subtask --id=<id>.<n> --prompt="PLAN: approach · decisiones del usuario · agente=<dominio> · skills=<…> · criticidad=<crítica|no> · footprint=<paths>"
   ```
6. **Cierre**: "✅ Plan listo. Ejecuta `/tm-tarea <id>` (o `/tm-tarea <id> auto`)."

## Reglas
- No edites código — solo análisis + registro en Taskmaster.
- CLI siempre. Decisiones genuinas → al usuario; triviales → default sensato anotado en la subtarea.
