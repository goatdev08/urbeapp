---
estado: vigente
fecha: 2026-08-24
decide: Abraham
contexto: sesión /grilling del módulo panel-admin (exploración 041)
---

# 0010 — PRD canónico y "beta = producción menos pagos"

## Decisión

1. **`docs/PRD.md` es LA fuente de verdad de producto.** Es el documento hecho
   sobre los requerimientos del cliente; sus decisiones se mantienen tal cual
   salvo enmienda explícita registrada (en el propio PRD o en una exploración
   aprobada).
2. **`docs/PRD-beta.md` y `docs/PRD-MVP-demo.md` quedan RETIRADOS como
   referencia.** El escalonamiento por "olas" deja de gobernar el alcance.
   Ninguna sesión debe planear con ellos; reciben banner de retiro (tarea #217).
3. **Criterio de alcance de la beta: "beta = producción menos pagos".** Todo lo
   del PRD debe funcionar y estar probado; solo se difiere lo que dependa de
   cobrar (pasarela, self-serve pagado, revisión previa de publicaciones — ver
   excepción abajo).

## Excepciones vigentes al PRD (enmiendas de calendario, no de fondo)

- **§15.1 (revisión previa de toda publicación): SUSPENDIDA durante la beta**
  (continúa #153). Publicar nace `active`. Regresa después de beta, junto con
  los pagos. La re-revisión de EDICIONES (§15.5/§15.6) **sí queda vigente** y
  su UI la construye #218.
- **Notificaciones al administrador**: el PRD no las contempla (catálogo §22.3
  sin audiencia Admin). El catálogo v1 vive en la exploración 041 y entra al
  PRD como addendum §22.x (tarea #217).

## Consecuencias

- El panel admin in-app (`mobile/app/admin/`) es el **centro operativo** de la
  beta — módulo 041, tareas #217–#222. El panel web (#81) sigue diferido.
- Páginas del vault que citaban las olas o el estado pre-#153 deben corregirse
  (arranca #217 con [[moderacion]] y [[propiedades-y-video]]).
- Relacionadas: [[0008-arquitectura-real-prd]] (queda enmendada por esta en lo
  relativo a olas), [[0009-produccion-viva]] (sigue íntegra).
