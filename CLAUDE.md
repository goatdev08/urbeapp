# CLAUDE.md — Urbea

Guía operativa para **toda sesión de IA** en este repo. Es el **schema** del sistema de trabajo.
Decisiones de fondo: `wiki/decisiones/0003` (vault), `0004` (Taskmaster), `0006` (workflow).

## 0. Principios y Fundamentos
**Perfeccionamos el flujo de trabajo; NO acumulamos código.**
- Antes de escribir código nuevo, consulta `wiki/codebase/mapa-codebase.md` — ¿ya existe algo reutilizable? **Reusar > reescribir.**
- Cada tarea cierra con una mini-retro: ¿se puede hacer el flujo más eficiente? Si sí, mejora *este archivo*, el vault o un skill — **no** agregues código de app.
- Métrica de éxito: tareas cerradas con **mínimo código nuevo** y máxima claridad. No LOC.
- 🪶 **Skill `ponytail` (modo `full` por defecto) está activo al escribir código.** Es el reflejo que hace cumplir este principio: la escalera YAGNI → ¿ya existe? → stdlib/Expo/Supabase nativo → dependencia ya instalada → una línea → mínimo que funciona. Marca simplificaciones deliberadas con un comentario `// ponytail:` (intención + techo conocido). Companions: `/ponytail-review` (revisar un diff por sobre-ingeniería), `/ponytail-audit` (escanear el repo), `/ponytail-debt` (cosechar los `ponytail:` pendientes). No aplica a validación en fronteras de confianza, manejo de errores, RLS/seguridad ni a lo que el usuario pida explícito.

## 1. Qué es Urbea / dónde está todo
- Plataforma inmobiliaria móvil (Expo + Supabase), feed vertical de video. Primer hito: **demo cerrada de 3 semanas** → `docs/PRD-MVP-demo.md`.
- **Memoria del proyecto = vault `wiki/`** (ábrelo en Obsidian). Entra por `wiki/_index/00-MOC-home.md`.
- Fuentes de verdad: `docs/` (producto) y `supabase/` (DB migrada `0001`–`0010`). Catálogo: `wiki/_index/MOC-fuentes.md`.

## 2. Inicio de sesión (haz esto SIEMPRE primero)
1. Lee `wiki/_index/00-MOC-home.md` y `wiki/estado/estado-actual.md`.
2. `task-master next` → `task-master show <id>`.
3. Lee las páginas del vault que la tarea toca **antes** de codear (usa `wiki/codebase/mapa-codebase.md` para ir a los archivos exactos, **sin `grep`**).

## 3. Stack y comandos
- 🔴 **Gestor de paquetes y runner: PNPM SIEMPRE.** Nunca `npm` ni `yarn`.
  - `pnpm install`, `pnpm add <pkg>`, `pnpm dev`, `pnpm expo start`, `pnpm tsc --noEmit`, `pnpm lint`.
  - **El servidor de desarrollo se levanta con `pnpm`** (Expo).
  - Gotcha Expo+pnpm: configurar `.npmrc` con `node-linker=hoisted` para que Metro resuelva bien (se hace en la tarea #1).
- App: React Native + **Expo development build** (`expo-dev-client`), **Expo Router**, **TypeScript strict**.
- Backend: **Supabase remoto** (`urbea-app`). Migraciones idempotentes + rollback + tests pgTAP. Video → **Supabase Storage** (demo).
- Arquitectura: lógica de negocio en **Edge Functions**; **RLS** = 2ª capa; triggers solo atómicos. Ver `wiki/conceptos/rls-seguridad.md` y `docs/lineamientos-desarrollo.md`.

## 4. Taskmaster — SIEMPRE por CLI (NUNCA MCP)
- Provider: `claude-code/sonnet` (sin API key, $0). Tag activo: `master`.
- Consultar: `task-master list` · `task-master next` · `task-master show <id>`.
- Estado: `task-master set-status --id=<id> --status=<pending|in-progress|review|done|deferred|cancelled>`.
- Documentar (bitácora): `task-master update-subtask --id=<id>.<n> --prompt="…"` · `task-master update-task <id> "<cambio>"`.
- Descomponer: `task-master expand --id=<id>` / `--all`.
- Nuevo trabajo: `task-master add-task --prompt="…"` · `task-master add-subtask --parent=<id> --title="…"`.

## 4.5 Capa de planeación previa — `/tm-explore`
**Antes del ciclo TDD, las ideas pasan por EXPLORE.** Para una idea o cambio nuevo (incluso abstracto, de un fix XS a una épica XL), corre `/tm-explore "<idea>"`: investiga el vault, hace lluvia de ideas si hace falta, **desambigua con preguntas** escaladas por complejidad y deja un doc en `.taskmaster/docs/exploraciones/` que puedes **aprobar** (→ se promueve a tarea[s] de Taskmaster) o **descartar** (queda como registro de decisión). El subagente `tm-explore` investiga y redacta; **no codifica ni encadena** el TDD.

**Flujo completo:** `/tm-explore` (idea → tarea) → `/tm-plan <id>` (footprint + plan de subtareas) → `/tm-tarea <id>` (ejecución subtarea por subtarea). Una tarea que ya existe en Taskmaster entra directo por `/tm-plan`.

## 5. ⭐ Workflow de ejecución de una tarea
**Taskmaster es el registro vivo de la ejecución:** cada subtarea guarda el log de lo que se hizo (notas con timestamp), y de ahí se lee el contexto en sesiones futuras.

1. **Seleccionar** — `task-master next` → `task-master show <id>` (lee tarea, subtareas, dependencias).
2. **Contexto** — lee las páginas del vault que la tarea toca (vía `mapa-codebase.md`).
3. **Arrancar** — `task-master set-status --id=<id> --status=in-progress`.
4. **Por cada subtarea `<id>.<n>`:**
   1. *(plan)* `task-master update-subtask --id=<id>.<n> --prompt="plan: enfoque elegido"`.
   2. Implementa el cambio (**PNPM** para todo).
   3. *(bitácora)* **Documenta lo hecho EN la subtarea** — el log que se releerá:
      `task-master update-subtask --id=<id>.<n> --prompt="hecho: archivos (rutas), decisiones, comandos, resultado de verificación"`.
      Se relee con `task-master show <id>.<n>`.
   4. **Verifica** antes de cerrar: `pnpm tsc --noEmit`, `pnpm lint`, tests/app según aplique.
   5. Cierra: `task-master set-status --id=<id>.<n> --status=done`.
5. **Cerrar la tarea** — todas las subtareas done → `task-master set-status --id=<id> --status=done`.
6. **Ingest al vault** (promover lo durable) — actualiza `wiki/codebase/mapa-codebase.md` (concepto → archivos nuevos), la página de concepto (`estado: vivo`, `codigo:` con rutas reales) y una línea en `wiki/log.md`.

**Reglas del registro:**
- Log paso-a-paso → en la **subtarea** (Taskmaster). Conocimiento durable (decisión, patrón, mapeo) → **vault**.
- Cambió el alcance/diseño de una tarea → `task-master update-task <id> "qué cambió y por qué"`.
- Apareció trabajo nuevo no previsto → `add-task` / `add-subtask` (no lo dejes solo en el chat).

## 6. Cierre de sesión
- Asegura el estado en Taskmaster (`set-status`).
- Actualiza `wiki/estado/estado-actual.md` (narrativa) y añade entrada a `wiki/log.md` (`## [YYYY-MM-DD] tipo | título`).
- *(Mejora continua)* ¿Hubo fricción repetida? Mejora este archivo / un skill — no acumules código.

## 7. Mantenimiento del vault (patrón Karpathy)
- **Ingest:** al entrar conocimiento nuevo → actualizar concepto(s) + `mapa-codebase` + `index.md` + `log.md`.
- **Query:** `index.md` → concepto(s) → (si hace falta el detalle literal) la fuente vía `MOC-fuentes`.
- **Lint** (periódico): enlaces rotos, conceptos huérfanos, `mapa-codebase` desincronizado del código real.
- El vault es **síntesis densa**, no espejo de los docs ni índice escueto.

## 8. Branding
**Gate LEVANTADO** (cliente, 2026-06-26). ⭐ **Referencia visual canónica: `urbea-identidad-visual.html` (raíz del repo)** — tokens + componentes de firma + mockups de las ~13 pantallas de la demo; **cada pantalla del mockup = techo de alcance de su tarea** (no agregues UI ausente del mockup; lo que falte = trabajo nuevo vía `add-task`). Ábrelo antes de diseñar cualquier pantalla. Método: **bajo demanda por pantalla**, diseñar antes de implementar escalado por complejidad — simple → mini-spec escrito; componente de **firma** → preview HTML aprobable → portar a RN (ReactBits/galerías web = referencia, NO import; recrear con primitivas RN). El design system (`mobile/src/theme/theme.ts`) **crece orgánicamente**: lo sembró la tarea #16. Identidad: Salvia `#5A8A5E` / Arcilla `#9A7150` / gestión claro `#F6F2EB` / feed oscuro `#17140F`; **Space Grotesk** (display) + **Hanken Grotesk** (UI) — la del kit `003-kit`, NO Fraunces. Ver [[design-system]].

⭐ **Dos referencias canónicas, roles distintos (tarea #26):**
- `urbea-identidad-visual.html` = techo del **lenguaje visual** → color, tipografía, componentes de firma, mockups de pantalla.
- `Urbea Prototipo (standalone).html` (raíz, export de Claude Design) = techo del **layout** → acomodo, jerarquía, grid, escala de espaciado/padding/gap, proporciones y composición por pantalla.
- ⚠️ Del prototipo se toma **SOLO el layout**; **nunca** sus colores ni fuentes (los manda la identidad). Regla: **layout del prototipo + lenguaje visual de la identidad = pantalla final.** Los tokens de layout viven en `theme.ts`.
