---
tipo: decision
estado: aceptada
fecha: 2026-06-17
---

# 0004 — Taskmaster como motor de ejecución

## Contexto
Todo el desarrollo será gestionado con IA y necesita un único lugar para el estado de las tareas. Taskmaster (`task-master`) ya está instalado (v0.43.1) pero no inicializado.

## Decisión
El **estado y la ejecución** del desarrollo viven en **Taskmaster**. La **CLI `task-master` es el canal principal** de comunicación con las tareas. El motor de IA de Taskmaster será el provider **`claude-code`** (sin API key — usa la sesión de Claude Code).

## Regla anti-duplicación
- **Estado vivo de tareas** → Taskmaster (`task-master list/next/show`).
- **Conocimiento durable** → este vault (`wiki/`).
- **Narrativa cronológica** → [[log]] (`wiki/log.md`).
- Por eso NO existe `roadmap.md` ni `bitacora-sesiones.md` en el vault.

## Flujo
Inicio de sesión: leer [[00-MOC-home]] + [[estado-actual]], luego `task-master next`.
Cierre: `set-status`, actualizar [[mapa-codebase]] + concepto + [[log]].

## Consecuencias
- El PRD (`docs/PRD-MVP-demo.md`) se convierte en backlog vía `task-master parse-prd`.

## Enlaces
- Schema: `../CLAUDE.md`
