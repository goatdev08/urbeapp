---
tipo: decision
estado: aceptada
fecha: 2026-08-10
---

# 0009 — Producción viva: todo cambio se piensa para producción

## Contexto
Desde 2026-08-10 hay personas reales conectadas probando la app (APKs de inversores, TestFlight 1.0.4) y la base de datos remota `urbea-app` se puebla poco a poco con cuentas, propiedades, leads y eventos reales. El repo venía operando con mentalidad de "demo cerrada": seeds locales, resets tolerables, contratos que se podían romper porque "nadie los usaba". Esa premisa dejó de ser cierta — y ya mordió antes (OTA NO-OP silencioso del 06-ago, fuga de `events_raw` medida con JWT real en 75.3, #116).

## Decisión
**Todo cambio — DB, Edge Functions, cliente móvil, config — se diseña, verifica y despliega como cambio EN producción.** La normativa vive como regla operativa en `CLAUDE.md §0.5` (cargada en toda sesión y todo subagente) y se aplica en tres puntos del flujo para minimizar el error humano:
1. **Planeación** — el `analista-subtareas` emite una línea "Impacto producción" por subtarea (migración destructiva, contrato publicado tocado, orden OTA/contract) y `/tm-plan` la registra en el PLAN de la subtarea.
2. **Ejecución/cierre** — `/tm-tarea` corre el gate de producción viva antes de cerrar la tarea y antes del PR (CLAUDE.md §5.7).
3. **Siempre** — las 6 reglas de §0.5: DB con datos reales (aditivo + rollback, nunca seeds/resets al remoto, destructivo = expand→migrate→contract + aprobación), compat hacia atrás con builds instalados (cliente OTA primero, contract después), merge a `main` = candidato a release, privacidad/RLS primero, cuotas reales (reproducir y parar), y ante duda gana producción (escalar, no degradar).

## Alternativas consideradas
- Confiar en la memoria de sesión / recordatorio del usuario — es exactamente el error humano que se quiere eliminar; una sesión que no lo lea lo rompe.
- Un hook bloqueante nuevo — más maquinaria que mantener; las reglas no son deterministas por path como el TDD-guard. Se prefiere la capa normativa (CLAUDE.md + puntos del flujo). Si en la práctica se detectan violaciones repetidas, se reevalúa un hook.

## Consecuencias
- Positivas: los tres puntos de aplicación hacen difícil que una sesión "olvide" la regla; el costo de un cambio destructivo se paga en diseño (expand→contract), no en datos perdidos de usuarios reales.
- Negativas / costos: cambios de contrato ahora toman dos pasos (OTA → contract) y más verificación por tarea; algunos atajos de la era demo (reseed, reset) dejan de estar disponibles contra el remoto.

## Estado
aceptada (pedida por Abraham, 2026-08-10)

## Enlaces
- Conceptos: [[estrategia-releases]], [[privacidad-datos]], [[rls-seguridad]], [[entornos-desarrollo]]
- Fuente: CLAUDE.md §0.5 y §5.7 · `.claude/agents/analista-subtareas.md` · `.claude/commands/tm-plan.md` · `.claude/commands/tm-tarea.md`
