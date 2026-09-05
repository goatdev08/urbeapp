---
tipo: decision
estado: aceptada
fecha: 2026-09-05
---

# 0011 — Ponytail por fase, y las reglas que dejan de ser mudas

## Contexto
El skill `ponytail` entró el 2026-06-30 (commit `513d4fe`) y hasta hoy vivía **sin ADR**: solo en `CLAUDE.md` §0 y en su propio `SKILL.md`. Ha funcionado — hay ~130 marcadores `ponytail:` en el código y el repo cierra tareas con poco código nuevo, que es su métrica.

El problema que motiva esta decisión lo planteó Abraham el 2026-09-05: *"¿qué tanto modifica el comportamiento al desarrollar con IA? ¿si se remueven puedes ser más creativo?"*. La respuesta honesta fue que ponytail no reduce las ideas, reduce el **tamaño** de lo construido, y que el freno real a proponer estaba en otra parte. Al mirarlo de cerca aparecieron tres huecos, todos de la misma forma: **el sistema estaba afinado para converger y corría igual en las cuatro fases, porque nadie escribió dónde empieza y dónde termina.** Y en dos puntos el agente quedaba **mudo**:
- **Rung 2 de la escalera** (*"¿ya existe? reúsalo"*) hace reusar el patrón existente **aunque sea peor** que lo que se escribiría hoy. La deuda se congela y nadie se entera.
- **§8, el techo del mockup** (*"cada pantalla del mockup = techo de alcance; lo que falte = trabajo nuevo"*) impedía **proponer** UI o interacciones no dibujadas. Era el freno real a la creatividad, no ponytail.
- **El tope de salida de ponytail** (3 líneas) borraba trade-offs que a veces sí importan.

Además, la investigación destapó un **hallazgo mecánico** que descarta la solución obvia: un `/ponytail lite` tecleado en el chat **no llega a un subagente** — cada uno arranca en contexto limpio con solo su `.claude/agents/<x>.md` + `CLAUDE.md`. Cualquier mecanismo por slash-command estaba muerto al nacer.

## Decisión
**El régimen de ponytail se declara por FASE, en el archivo de cada fase; y las dos reglas mudas pasan a proponer.** Normativa en `CLAUDE.md` §0 y §8 (lo único que toda sesión y todo subagente lee).

1. **Régimen por fase** — tabla en §0 + una línea declarativa en los 8 archivos de fase:
   - **Propuesta** (`/tm-explore`, agentes `tm-explore` y `design`, skill `urbea-design`) → **ponytail NO aplica**; se **exige divergencia**: 2–4 direcciones con su trade-off. Vuelve a aplicar al plan de implementación que sale de la fase.
   - **Ejecución** (`/tm-plan`, `/tm-tarea`, agentes `mobile` y `supabase`) → **`full`**, sin cambio.
   - **Override** → el prompt explícito de Abraham gana siempre.
2. **Explicar el trade-off** — el tope de 3 líneas se levanta con **4 disparadores enumerados**: contrato publicado (§0.5.2) · ruta crítica por path (§5) · techo alcanzable con datos reales (§0.5.1) · descarta una alternativa que Abraham nombró. Destino: completo en la bitácora (`tm-log.mjs`), resumen de 2–3 líneas en la respuesta.
3. **Reuso con reserva** — excepción al rung 2. Si el refactor **cabe en el footprint y no toca contrato publicado ni migraciones** → se **propone**; si no → se reusa con `// ponytail: deuda` + derivada `hardening(<origen>)`.
4. **Techo CON propuesta** — §8 conserva la prohibición de **implementar** UI ausente del mockup y agrega la obligación de **proponerla** (`UI_FUERA_DEL_MOCKUP:`), con dos puntos de detección: planeación (plantilla + analista + `/tm-plan` + contrato de `tm-explore`) y una red en ejecución (`mobile` emite → `/tm-tarea` lo trata como propuesta no bloqueante).

**Tres invariantes**, comunes a 3 y 4, que son la mitigación explícita del riesgo de convertir esto en una máquina de backlog (el backlog ya va en 260 tareas): **el agente propone, NUNCA decide** · **default conservador = derivada** · **cupo máx 2 propuestas por tarea**, compartido entre ambos canales.

**Forma de las reglas:** las cuatro se ajustan al único precedente del repo que ha sobrevivido — la criticidad TDD del §5, que es **determinista y derivada de una entrada objetiva**. Fase declarada · 4 disparadores enumerados · umbral por footprint · ausencia en el mockup. Lo que se juzga, deriva.

## Alternativas consideradas
- **Quitar ponytail para "ser más creativo"** — descartada: no aumenta las ideas, solo el tamaño del diff y la prosa. El sesgo por defecto es sobre-construir, y §0 existe para eso.
- **Cambiar el nivel por slash-command (`/ponytail lite`)** — imposible: no cruza al subagente (hallazgo mecánico arriba). Por eso se declara en archivo.
- **Usar el nivel `lite` para la fase de propuesta** — `lite` construye UNA cosa y nombra la alternativa en una línea; lo que la propuesta necesita es **divergencia (N direcciones)**, que es otra dimensión. Se prefirió declarar que ponytail **no aplica** a esa fase, apoyándose en lo que el propio skill ya dice (§Boundaries: *"governs what you build, not how you talk"*; §Output: la explicación pedida explícitamente *"is not debt, give it in full"*).
- **Editar `.claude/skills/ponytail/SKILL.md`** — descartada: es upstream MIT vendored. Bifurcarlo obliga a mantener el diff para siempre. Todo lo nuevo vive en `CLAUDE.md`, que gana por especificidad del proyecto.
- **Poner el detalle en el vault y dejar §0 mínimo** — descartada por una razón dura: **los subagentes no leen el vault por default**. Una regla que viva solo aquí no dispara. §0 carga lo operativo (qué dispara y qué hacer); este ADR carga el porqué.
- **Parar y preguntar en el momento** ante deuda o UI faltante — máxima fidelidad, pero rompe la ejecución en serie y choca con el modo `auto`. Se prefirió proponer con default conservador.

## Consecuencias
- Diseñar y explorar deja de estar sujeto al reflejo de convergencia: la fase de propuesta **debe** dar 2–4 direcciones. Es el cambio que Abraham pedía.
- Aparecen dos canales nuevos de propuesta. El cupo de 2 y el default de derivada son lo único que impide que se vuelvan una fábrica de backlog; **si el ledger de `ponytail: deuda` no se cosecha con `/ponytail-debt`, "later means never"**.
- `CLAUDE.md` crece ~15 líneas en su archivo más caro. Es deuda de atención asumida a conciencia: se pagó comprimiendo a tablas y mandando toda la justificación aquí.
- Efecto colateral que valió la tarea sola: se descubrió que **el agente `design` llevaba ~2 meses instruido para NO ARRANCAR** (`.claude/agents/design.md` decía "branding en pausa… no arranques") pese a que el gate se levantó el 2026-06-26. El gate levantado nunca había llegado al sistema de agentes. Se limpiaron 10 afirmaciones muertas en 6 archivos y `GATE_BRANDING` se redefinió a `APROBACION_DISENO` (aprobación **por pantalla**: componente de firma → preview HTML aprobable antes de portar a RN).

## Enlaces
- Exploración: `.taskmaster/docs/exploraciones/043-ponytail-por-fase-y-techo-con-propuesta.md` · tarea **#260**
- `CLAUDE.md` §0 (régimen, trade-offs, reuso con reserva) y §8 (techo con propuesta)
- [[0006-workflow-ejecucion-tareas]] · [[0007-workflow-multiagente]] · [[0009-produccion-viva]] · [[design-system]]
