---
name: urbea-context
description: Navegar el vault Obsidian de Urbea (wiki/) para extraer contexto del proyecto SIN grep. Usar al inicio de cualquier tarea o subtarea para entender un dominio, ubicar dónde está el código (mapa-codebase), o consultar decisiones y conceptos. Cubre el flujo index → conceptos → mapa-codebase → fuente. Disparar ante "contexto", "dónde está", "qué hace", "cómo funciona", "buscar en el vault", o al abrir una subtarea.
---

# urbea-context — navegar la memoria del proyecto

El proyecto guarda su memoria en el vault Obsidian `wiki/`. Es tu **primera fuente de contexto**, antes de `grep` o de leer código a ciegas.

## Las 3 capas (patrón Karpathy)
- **Raw** (verdad): `docs/` y `supabase/` — detalle exhaustivo, inmutable.
- **Wiki** (`wiki/`): síntesis densa + conexiones — tu punto de entrada.
- **Schema**: `CLAUDE.md` — cómo se opera.

## Flujo de consulta (query)
1. **Entrada** → `wiki/_index/00-MOC-home.md` (hub) o `wiki/index.md` (catálogo de todas las páginas).
2. **Concepto** → la(s) página(s) de `wiki/conceptos/` relevante(s): traen modelo de datos, invariantes (🔒), flujo y reglas ya destilados.
3. **Código** → `wiki/codebase/mapa-codebase.md` (dominio → archivos exactos) y `wiki/codebase/db-schema-map.md` (tabla → migración → concepto).
4. **Detalle literal** (solo si hace falta) → `wiki/_index/MOC-fuentes.md` te dice a qué doc/migración ir.

## Cuándo usarlo
- Al arrancar una subtarea: identifica el concepto y el *footprint* (archivos) vía `mapa-codebase`.
- Antes de escribir código nuevo: ¿ya existe algo reutilizable? (reusar > reescribir).
- Para entender una decisión: `wiki/decisiones/` (ADRs).

## Regla
**No uses `grep` a ciegas.** El `mapa-codebase` resuelve "dónde está X". Si el mapa está desactualizado respecto al código real, esa es una señal: actualízalo al cerrar la tarea.

## Mantener el vault al cerrar una tarea (ingest)
1. `wiki/codebase/mapa-codebase.md` → concepto → archivos nuevos.
2. La página de `wiki/conceptos/` → `estado: vivo`, `codigo:` con rutas reales.
3. Una línea en `wiki/log.md` (`## [YYYY-MM-DD] tipo | título`).

## Futuro: graphify (no instalado aún)
Cuando Urbea tenga bastante código, se podrá sumar `graphify` (grafo automático del código, AST) como **segunda** fuente: `graphify query/explain/path`. Encaje previsto: consultar el grafo *antes* del mapa manual para ubicar el SUT y sus vecinos; actualizarlo en el cierre (`graphify update .`). Ver `wiki/decisiones/0007-workflow-multiagente.md`.
