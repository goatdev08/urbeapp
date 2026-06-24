---
description: TAREA — ejecuta una tarea de Taskmaster subtarea por subtarea, EN SERIE, con un agente de dominio dedicado por subtarea, TDD pragmático en lógica crítica, manejo de bloqueantes e ingest al vault al cerrar. Usa la CLI de Taskmaster (nunca MCP) y pnpm.
argument-hint: "[task-id, ej. 1] [auto] [--dry-run]"
allowed-tools: Bash, Read, Grep, Glob, Agent, AskUserQuestion
---

Orquestador **por tarea, subtarea por subtarea, en serie**. Toma UNA tarea de Taskmaster (CLI), la analiza, confirma el plan (salvo en `auto`) y ejecuta cada subtarea con el **agente de dominio** correcto: TDD en las críticas, verificación ligera en las demás. Mantiene Taskmaster (estado) y el vault (conocimiento) al día y maneja bloqueantes.

## Argumentos (`$ARGUMENTS`)
- vacío → la tarea de la siguiente subtarea pendiente (`task-master next`).
- `1` → tarea 1 completa, con checkpoints entre subtareas.
- `1 auto` → **modo automático**: sin checkpoints intermedios; solo se detiene en bloqueantes que requieran decisión humana o decisiones de diseño genuinas.
- `1 --dry-run` → solo análisis + plan, sin ejecutar.

## Precondiciones
1. **Rama de trabajo**: si estás en `main`, crea/cámbiate a una rama (`git checkout -b tarea/<id>-<slug>`). Los commits del ciclo son **locales**; push/PR es decisión humana.
2. **Sin ciclo a medias**: si existe `.taskmaster/.current-red`, resuélvelo (cerrar la subtarea o `rm` el sentinel) antes de seguir.

## Flujo

### 1 — Resuelve la tarea (CLI)
```bash
ARG="$1"; [ -z "$ARG" ] && ARG=$(task-master next </dev/null 2>&1 | grep -oE '#[0-9]+' | head -1 | tr -d '#')
TID="$ARG"
task-master show "$TID" </dev/null
```
Sin subtareas → aborta ("`task-master expand --id=$TID`" o usa `/tm-plan $TID`). Todas `done` → "Tarea ya completa".
Si la tarea nació de `/tm-explore`, su doc de planeación vive en `.taskmaster/docs/exploraciones/` (busca el `tarea_id` que coincida) — léelo como contexto antes del análisis.

### 2 — Análisis (subagente `analista-subtareas`)
Invócalo con el `task_id`. Imprime su reporte verbatim (footprint · agente · skills · criticidad TDD · orden serie · bloqueantes potenciales). Si `--dry-run`: termina aquí.

### 3 — Confirmación
- **Normal**: `AskUserQuestion` para confirmar el orden y resolver las decisiones de diseño que el analista/concepto marcaron.
- **`auto`**: omite la confirmación del plan; SOLO pregunta si hay una decisión de diseño/UX genuina. Procede con el orden del analista.

### 4 — Ejecuta subtarea por subtarea (SERIE, orden del analista)
Por cada subtarea pendiente:
1. `task-master set-status --id=<id>.<n> --status=in-progress`.
2. **Si CRÍTICA** (TDD):
   - `echo "<id>.<n>" > .taskmaster/.current-red` (activa el hook `tdd-guard`).
   - Invoca **`test-author`** (escribe RED; enumera edge cases en la subtarea). Confirma que los tests fallan.
   - `git add -A && git commit -m "test(red): <id>.<n> — <título>"` (sin trailer).
   - Invoca el **agente de dominio** (`supabase`/`mobile`) para el GREEN.
   - Invoca **`guardian`**. Si FAIL → re-invoca al agente con las violaciones (máx 2 ciclos); si persiste, detente y reporta.
   - `git add -A && git commit -m "feat(green): <id>.<n> — <título>" -m "Co-Authored-By: Claude <noreply@anthropic.com>"`.
   - `rm -f .taskmaster/.current-red`.
3. **Si NO crítica**: invoca el **agente de dominio** asignado (implementa + verificación ligera `pnpm tsc --noEmit`/`pnpm lint`/smoke).
4. **Bloqueante** reportado → §5.
5. `task-master update-subtask --id=<id>.<n> --prompt="<resumen del agente>"` (si no lo hizo ya).
6. `task-master set-status --id=<id>.<n> --status=done`.
7. **Normal**: checkpoint antes de la siguiente. **`auto`**: continúa.

### 5 — Manejo de bloqueantes
1. `task-master update-subtask --id=<id>.<n> --prompt="BLOQUEANTE: <desc>"`.
2. Clasifica (con `task-master list`):
   - **Cubierto por otra tarea/subtarea** → `task-master add-dependency --id=<id>.<n> --depends-on=<esa>`; `task-master set-status --id=<id>.<n> --status=blocked`; sigue con la siguiente subtarea desbloqueada.
   - **Trabajo nuevo** → `task-master add-task --prompt="<desc>"` o `task-master add-subtask --parent=<id> --title="<desc>"`; documenta; `add-dependency`.
3. Decisión: **normal** → `AskUserQuestion` (resolver ahora / agendar). **`auto`** → si es pequeño y desbloquea, resuélvelo; si requiere decisión humana, detente y pregunta.
4. Conocimiento durable → ingest al vault.

### 6 — Cierre de la tarea (todas las subtareas done)
1. `task-master set-status --id=<id> --status=done`.
2. **Ingest al vault** (skill `urbea-context` → mantenimiento):
   - `wiki/codebase/mapa-codebase.md`: concepto → archivos nuevos.
   - página(s) de `wiki/conceptos/`: `estado: vivo`, `codigo:` con rutas reales.
   - `wiki/log.md`: `## [$(date +%F)] tarea | #<id> <título> — qué cambió`.

### 7 — Resumen
`✅ Tarea <id>` · subtareas cerradas · TDD aplicado en {críticas} · bloqueantes {creados/vinculados} · verificación · siguiente (`/tm-status`).

## Reglas
- **CLI de Taskmaster siempre** (nunca MCP). **PNPM** para todo. **Naming snake_case** (CLAUDE.md).
- **Serie**: una subtarea a la vez (el paralelo con worktrees + graphify queda para el futuro, ADR 0007).
- **No avances** con un agente bloqueado o `guardian` en FAIL sin resolver/agendar.
- El **orquestador** es el único que cambia estado en Taskmaster y hace commits; los agentes implementan y reportan.
- `auto` minimiza checkpoints, **no** minimiza calidad: TDD y guardian siguen corriendo en críticas.
- Commits **locales**; nunca `git push` sin que el usuario lo pida.
