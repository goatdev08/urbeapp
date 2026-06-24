---
tipo: decision
estado: aceptada
fecha: 2026-06-17
---

# 0003 — Memoria del proyecto = vault Obsidian (Karpathy)

## Contexto
El desarrollo será asistido por IA y a lo largo de muchas sesiones. Hace falta continuidad de contexto y un mapa del código que evite re-descubrir todo con `grep`.

## Decisión
La memoria del proyecto vive en un **vault Obsidian** (`wiki/`) siguiendo el patrón *LLM Wiki* de Karpathy. Capas: **raw** (`docs/` + `supabase/`) → **wiki** (este vault) → **schema** (`CLAUDE.md`). El LLM mantiene el vault de forma continua; rara vez se edita a mano.

## Alternativas consideradas
- RAG sobre los docs — re-deriva conocimiento en cada query, no acumula.
- Solo `CLAUDE.md` — no escala como grafo de conocimiento.

## Consecuencias
- Pieza clave: [[mapa-codebase]] (concepto → archivo) y [[db-schema-map]].
- Anti-duplicación con Taskmaster: ver [[0004-taskmaster-motor-de-ejecucion]].

## Enlaces
- Fuente: patrón LLM Wiki (Karpathy); README del vault.
