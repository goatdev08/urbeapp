---
description: STATUS — estado del workflow: subtarea activa, siguiente pendiente, resumen global, bloqueantes y últimos commits. Vía CLI de Taskmaster.
allowed-tools: Bash, Read
---

Resumen del estado del workflow (CLI, no MCP). Útil para retomar contexto al inicio de una sesión.

## Pasos
1. **Subtarea activa**: si existe `.taskmaster/.current-red`, muéstrala (id + título vía `task-master show <id></dev/null`). Fase: si el último commit es `test(red): <id>` → GREEN pendiente; si no → RED/implementación pendiente.
2. **Siguiente**: `task-master next </dev/null`.
3. **Resumen global**: `task-master list </dev/null` → totales (done / in-progress / pending) y próximas ~10 pendientes.
4. **Bloqueantes**: `task-master list --status=blocked </dev/null` (si aplica).
5. **Últimos commits**: `git log --oneline -5`.

## Formato
```
## Estado del workflow
### Subtarea activa
{id} — {título} · fase: {…}
### Siguiente pendiente
{id} — {título} · depende de {…}
### Resumen
{N} tareas, {M} subtareas | done {x} · in-progress {y} · pending {z} · blocked {b}
### Próximas pendientes
- {id} {título}
### Últimos commits
{git log}
```
