---
tipo: decision
estado: aceptada
fecha: 2026-06-17
---

# 0006 — Workflow de ejecución y bitácora en Taskmaster

## Contexto
El desarrollo (IA-first) necesita un proceso repetible para **ejecutar tareas, verificar lo hecho y dejar trazabilidad legible entre sesiones**, sin duplicar registros.

## Decisión
1. **Taskmaster es el registro vivo de la ejecución.** Mientras se trabaja una tarea, se documenta el progreso **en sus subtareas** con `task-master update-subtask --id=<id>.<n> --prompt="…"` (notas con timestamp). Se releen con `task-master show`.
2. **Loop por tarea** definido en `CLAUDE.md` §5: seleccionar → contexto (vault) → in-progress → *(por subtarea: plan → implementar → documentar → verificar → done)* → cerrar tarea → **ingest al vault**.
3. **Verificación obligatoria** antes de cerrar una subtarea: `pnpm tsc --noEmit`, `pnpm lint`, tests/app según aplique.
4. **PNPM siempre** como gestor de paquetes y runner (nunca npm/yarn); el dev server se levanta con pnpm.
5. **Canal: CLI de Taskmaster** (nunca MCP).

## Anti-duplicación
- Log paso-a-paso de una tarea → **subtarea** en Taskmaster.
- Conocimiento durable (decisión, patrón, mapeo concepto→archivo) → **vault** (ingest al cerrar).
- Narrativa cronológica de hitos → [[log]].
- Coherente con [[0003-vault-obsidian-como-memoria]] y [[0004-taskmaster-motor-de-ejecucion]].

## Consecuencias
- Cualquier sesión nueva reconstruye el contexto de "qué se hizo" leyendo las subtareas + el vault.
- El schema operativo completo vive en `CLAUDE.md` (raíz del repo).

## Enlaces
- Schema: `CLAUDE.md` (raíz)
- [[0004-taskmaster-motor-de-ejecucion]] · [[0003-vault-obsidian-como-memoria]] · [[00-MOC-home]]
