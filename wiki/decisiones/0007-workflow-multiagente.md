---
tipo: decision
estado: aceptada
fecha: 2026-06-17
---

# 0007 — Workflow multi-agente de desarrollo

## Contexto
El desarrollo IA-first necesita más que el loop de una sola cabeza ([[0006-workflow-ejecucion-tareas]]). Se evoluciona al patrón TDD + Taskmaster del proyecto AJN, **adaptado a Urbea**: CLI (no MCP), vault Obsidian (no graphify), stack Expo + Supabase, agentes por dominio, ejecución en serie con checkpoints, modo automático.

## Decisión
Flujo **por tarea, subtarea por subtarea, en serie**, orquestado por `/tm-tarea` (con modo `auto`):
- **Agentes** (`.claude/agents/`): `mobile`, `supabase`, `design` (implementan por dominio); `analista-subtareas` (planea: footprint + agente + skills + criticidad TDD + orden + bloqueantes); `test-author` + `guardian` (TDD en subtareas críticas).
- **Skills** (`.claude/skills/`): `urbea-context` (navegar el vault), `urbea-expo`, `urbea-supabase`, `urbea-design`, `urbea-testing`.
- **Comandos** (`.claude/commands/`): `/tm-plan` (planeación con preguntas), `/tm-tarea` (ejecución), `/tm-status` (estado).
- **TDD pragmático por criticidad**: estricto (RED → GREEN → guardian + hook `tdd-guard.sh`) en Edge Functions / RLS / migraciones; verificación ligera (tsc/lint/smoke) en UI.
- **Manejo de bloqueantes**: documentar en la subtarea → clasificar (¿lo cubre otra tarea/subtarea o es trabajo nuevo?) → vincular (`add-dependency`) o crear (`add-task`/`add-subtask`) → resolver o agendar.
- **Persistencia**: estado en Taskmaster; bitácora en subtareas (`update-subtask`); conocimiento durable en el vault (ingest al cerrar). Sentinel `.taskmaster/.current-red` para subtareas críticas.
- **Modo auto**: minimiza checkpoints, **no** la calidad (TDD/guardian siguen corriendo).

## Convención de nombres (instrucción del cliente)
- Funciones/handlers/utilidades/tokens: **`snake_case`** en minúsculas, conciso y claro tipo inglés natural (`load_feed_page`, `format_price`, `redeem_invitation_token`). No camelCase.
- **Componentes React: PascalCase** (obligatorio por JSX). Tipos: PascalCase.
- Archivos/skills/agentes/comandos: kebab-case. SQL/Postgres: snake_case. Hooks React: `use_*` salvo que el linter exija `useX`.

## Evolución 2026-07-11 — criterio de calidad injertado (tarea #63, exploración 034)
Los 4 agentes de ejecución (`guardian`, `test-author`, `mobile`, `supabase`) se enriquecieron con vocabulario curado de `mattpocock/skills` (tdd/implement/code-review), **traducido al stack** — el enforcement (`tdd-guard.sh` + sentinel + guardian árbitro) quedó intacto:
- **Seams en términos Urbea** = contrato público de la Edge Function (request→respuesta) o comportamiento observable de la política RLS vía impersonación JWT; `test-author` los acuerda y anota (`SEAMS`) en la subtarea antes de enumerar; los tests solo viven en seams anotados.
- **guardian**: sección de calidad del test (3 anti-patrones: acoplado-a-implementación, tautológico, slicing horizontal) como **observación NO bloqueante** — el veredicto PASS/FAIL sigue siendo solo anti-cheat + cobertura + ejecución.
- **mobile/supabase**: verificar DURANTE el GREEN (no solo al cierre), GREEN un test a la vez en los seams, **auto-check de conformidad Spec/PRD** antes de reportar (campo `Conformidad spec` en el output — cierra el hueco de las subtareas no críticas, donde el guardian no corre) y checklist de 4 smells curados (Speculative Generality, Duplicated Code, Mysterious Name, Primitive Obsession) condicional a diff no trivial.
- **Traducción deliberada, no copia**: el "vertical slicing" de mattpocock choca con nuestro RED-batch (el guardian exige enumeración exhaustiva) → el RED sigue siendo completo; "un test a la vez" vive en el GREEN. De los 12 smells de Fowler solo se injertaron 4 (ponytail). Detalle completo: `.taskmaster/docs/exploraciones/034-enriquecer-agentes-tdd-mattpocock.md`.

## Futuro: graphify
Sumar `graphify` (grafo automático del código, AST) como segunda fuente de contexto junto al vault: `urbea-context` consultaría `graphify query/explain/path` antes del mapa manual; `/tm-tarea` lo actualizaría en el cierre; habilitaría **olas paralelas** con git worktrees (hoy serie). No instalado aún.

## Consecuencias
- Coherente con [[0003-vault-obsidian-como-memoria]], [[0004-taskmaster-motor-de-ejecucion]] y [[0006-workflow-ejecucion-tareas]].
- Schema operativo completo en `CLAUDE.md`.

## Enlaces
- [[0006-workflow-ejecucion-tareas]] · [[00-MOC-home]] · [[MOC-arquitectura]] · `CLAUDE.md`
