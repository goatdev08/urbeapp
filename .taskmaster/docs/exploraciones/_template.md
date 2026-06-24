---
tipo: feature        # feature | fix | refactor | chore | proyecto
nivel: M             # XS | S | M | L | XL — tamaño estimado; define la profundidad del doc
fecha: YYYY-MM-DD     # absoluta
estado: borrador      # borrador → en-revision → aprobado | descartado
tarea_id:             # id(s) de Taskmaster; se llena SOLO al promover (estado: aprobado)
motivo_descarte:      # se llena SOLO si estado: descartado
---

# {Título corto de la idea / cambio}

> Documento de exploración/planeación de `/tm-explore`. Un archivo por idea.
> Puede **APROBARSE** (→ se promueve a tarea[s] en Taskmaster) o **DESCARTARSE**
> (queda en el repo como registro de decisión, sin crear tarea).
> NO edita los PRD maestros (`docs/PRD-MVP-demo.md`, `docs/PRD.md`); "Impacto en PRD" es solo referencia.
> Llena cada sección; si no aplica, escribe "n/a" explícito, no la borres.
> Las secciones marcadas **(L/XL)** solo se llenan para planes grandes; para un fix XS/S
> quedan en "n/a".

## Idea original
{La descripción cruda tal como llegó, antes de refinar. Útil para auditar cómo evolucionó.}

## Lluvia de ideas (solo si la idea era abstracta)
{Enfoques/direcciones consideradas, con su trade-off. Cuál se eligió y por qué se
descartaron las otras. n/a si la idea ya llegó concreta.}

## Problema / Motivación
{Por qué se necesita. Qué problema o necesidad real resuelve. Encaje con el hito demo
cerrada de 3 semanas (ver [[0005-demo-cerrada-3-semanas]]).}

## Resultado esperado
{Comportamiento esperado / happy path. Qué debe pasar cuando esté listo.}

## Alcance
- **SÍ entra:** {lo que esta idea incluye}
- **NO entra (out of scope):** {lo que explícitamente queda fuera}

## Roles afectados
{Comprador (feed/búsqueda/contacto) / Inmobiliaria + agente (publica, CRM de leads) /
Admin de plataforma — y cómo afecta a cada uno.}

## Impacto en datos
{¿Schema nuevo, migración, enum, índice, constraint, política RLS, trigger, bucket de Storage?
Migraciones **idempotentes + rollback + tests pgTAP**. RLS = 2ª capa (patrón `private`).
Identificadores propios en **snake_case**. n/a si no toca BD.}

## Impacto en UI
{Pantallas (Expo Router), feed vertical de video (`expo-video`), wizard de publicación,
mapa con clustering, filtros, CRM de leads, copy. n/a si no toca UI.
⚠️ Si toca **branding/diseño visual** → gate de la tarea #19 (cliente debe dar el visto bueno; CLAUDE.md §8).}

## Reglas no obvias aplicables
- {Regla del dominio que se toca} — `wiki/conceptos/{página}` · fuente §/línea vía `wiki/_index/MOC-fuentes.md`

## Arquitectura / enfoque técnico  (L/XL — n/a para fixes)
{Componentes, servicios, contratos entre capas. Recuerda el lineamiento: lógica de negocio en
**Edge Functions**, **RLS** como 2ª capa, triggers solo atómicos (`docs/lineamientos-desarrollo.md`,
`wiki/conceptos/rls-seguridad.md`). Qué se reusa de lo existente (con rutas reales del
`wiki/codebase/mapa-codebase.md`) vs. qué es nuevo.}

## Fases / épicas  (L/XL — n/a para cambios chicos)
{Desglose en fases o épicas con dependencias y orden sugerido (olas). El desglose fino
en subtareas lo hace `task-master expand` / `/tm-plan` al promover, no aquí.}

## Criterios de aceptación
- [ ] {Criterio verificable 1}
- [ ] {Criterio verificable 2}

## Dependencias
{Tareas previas (ids de Taskmaster), código existente a reusar (con ruta), migraciones
0001–0010 de las que depende, o servicios externos. n/a si ninguna.}

## Edge cases / riesgos
- {Caso límite o riesgo conocido}

## Plan de pruebas (alto nivel)
{Qué se prueba y cómo: **pgTAP** (RLS / constraints / migraciones), **Vitest/Deno** (Edge Functions /
lógica de negocio), smoke en la app (Expo). Marca qué es **crítico** (TDD estricto → fase RED del ciclo).
Datos de prueba o seed necesarios.}

## Impacto en PRD (solo referencia — NO se edita)
{Si fuera feature nueva: qué §/líneas de `docs/PRD-MVP-demo.md` (o `docs/PRD.md`) tocaría una
eventual actualización. Decisión de promoción del dueño, fuera de esta exploración. n/a para fixes.}

## Decisiones del intake
{Log de las respuestas clave de la desambiguación y de la lluvia de ideas:
pregunta → opción elegida. Trazabilidad de por qué el plan quedó así.}

## Promoción / descarte
{**Al aprobar:** tarea(s) creada(s) (ids), reporte de complejidad y comando siguiente sugerido (`/tm-plan {id}`).
**Al descartar:** motivo del descarte y la alternativa que se consideró mejor (si la hubo).}
