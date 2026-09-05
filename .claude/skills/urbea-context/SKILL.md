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
- Antes de escribir código nuevo: ¿ya existe algo reutilizable? (reusar > reescribir — *con reserva*: si lo que existe es deuda, márcalo; CLAUDE.md §0).
- Para entender una decisión: `wiki/decisiones/` (ADRs).

## Regla
**No uses `grep` a ciegas.** El `mapa-codebase` resuelve "dónde está X". Si el mapa está desactualizado respecto al código real, esa es una señal: actualízalo al cerrar la tarea.

## Mantener el vault al cerrar una tarea (ingest)
1. `wiki/codebase/mapa-codebase.md` → concepto → archivos nuevos.
2. La página de `wiki/conceptos/` → `estado: vivo`, `codigo:` con rutas reales.
3. Una línea en `wiki/log.md` (`## [YYYY-MM-DD] tipo | título`).

## graphify — grafo AST del código (2ª fuente, acotada; tarea #70)
`graphify` (instalado en `~/.local/bin`) construye un grafo de símbolos de `mobile/` y `supabase/` (TS/TSX + SQL con `tree-sitter-sql`). Es **local y regenerable** (`graphify-out/` está en `.gitignore`; el filtro vive en `.graphifyignore`). Medido 2026-09-03: cada consulta tarda <1 s.

**Cuándo SÍ (donde gana a `grep`):** preguntas de **símbolo**, no de texto.
- Footprint de un cambio: `graphify affected "<símbolo>"` → quién importa/llama a esa función (archivo:línea), sin falsos positivos por coincidencia de texto. Úsalo al estimar el footprint de una subtarea que toca una función/hook/EF existente.
- Vecinos de un símbolo: `graphify explain "<símbolo>"` (qué llama y quién lo llama).
- Camino dentro de una capa: `graphify path "<A>" "<B>"`.

**Cuándo NO (sigue siendo `grep`/vault):** todo lo que es **string**, no símbolo — nombres de RPC y de Edge Function entre comillas (`.rpc('ads_for_zone')`, `functions.invoke('mint-video-url')`), columnas, claves de `app_config`, mensajes, flujos de Maestro, texto de policies. El grafo **no cruza** móvil → EF → SQL (esas aristas son strings); esa cadena vive en `wiki/conceptos/` y en el `mapa-codebase`. `graphify query "<pregunta>"` en lenguaje natural NO sirve sin extracción semántica (de pago): no lo uses.

**Mantener:** si `graphify-out/` no existe o el símbolo no aparece, regenera con `graphify update . --no-cluster` (AST puro, sin LLM, ~1 min; `--force` si borraste código). No hay hook ni paso de cierre obligatorio: se regenera bajo demanda. Decisión y medición: `wiki/decisiones/0007-workflow-multiagente.md` §graphify.
