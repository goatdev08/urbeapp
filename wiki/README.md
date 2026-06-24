# Vault Urbea — memoria del proyecto

Este vault es la **memoria viva** del proyecto Urbea, siguiendo el patrón *LLM Wiki* de Karpathy.
El LLM lo mantiene; tú lo lees (idealmente en Obsidian, viendo el grafo).

## Las 3 capas

1. **Raw (fuentes inmutables):** `../docs/` y `../supabase/`. El LLM lee de aquí; nunca las modifica.
2. **Wiki (este vault):** conocimiento compilado e interconectado. El LLM lo escribe y lo mantiene.
3. **Schema (`../CLAUDE.md`):** las reglas que el LLM sigue para mantener el vault y ejecutar el trabajo.

## Las 3 operaciones

- **Ingest:** al entrar algo nuevo (doc, decisión, PR, tarea cerrada que tocó código) → actualizar la(s) página(s) de concepto, el `mapa-codebase` si tocó código, `index.md` y `log.md`.
- **Query:** preguntar al vault → leer `index.md`, bajar a las páginas, responder con citas. Las respuestas valiosas se archivan como páginas nuevas.
- **Lint:** chequeo de salud → contradicciones, páginas huérfanas, `[[enlaces]]` rotos, conceptos sin página, y `mapa-codebase` desincronizado del código real.

## Estructura

- `_index/` — MOCs (Maps of Content): hubs de navegación del grafo. Empieza por [[00-MOC-home]].
- `conceptos/` — notas atómicas backlinkeadas (una idea por archivo).
- `codebase/` — el puente conocimiento↔código: [[mapa-codebase]] y [[db-schema-map]].
- `decisiones/` — ADRs (bitácora de decisiones).
- `estado/` — [[estado-actual]] (narrativa de "dónde estamos").
- `index.md` — catálogo de todas las páginas.
- `log.md` — bitácora cronológica (prefijo `## [YYYY-MM-DD] tipo | título`).

## Reglas

- Backlinks `[[nombre]]` liberales entre conceptos, decisiones, MOCs y mapas.
- **Anti-duplicación:** el *estado vivo de las tareas* vive en **Taskmaster** (CLI `task-master`), NO aquí. El vault guarda *conocimiento durable*; `log.md` guarda *narrativa cronológica*.
- Frontmatter YAML en `conceptos/` (`tipo`, `dominio`, `estado`, `fuentes`, `codigo`, `actualizado`) para Dataview.
- `estado`: `vivo` (se construye en la demo) · `latente` (infra existe/planeada, apagada) · `diferido` (fase posterior).
