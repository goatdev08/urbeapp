---
tipo: proyecto      # feature | fix | refactor | chore | proyecto
nivel: XL           # 6 bloques M0–M5; sucede a 040 (que cierra con #212→#213)
fecha: 2026-08-24
estado: aprobado    # por Abraham, 2026-08-24 («Apruebo el doc»)
tarea_id: 217, 218, 219, 220, 221, 222   # M0–M5; absorben #136, #124, 79.1, 79.2, 77.4; cierran #152
motivo_descarte:
---

# Panel admin como centro operativo (beta = producción menos pagos)

> Documento de exploración/planeación. Origen: sesión `/grilling` 2026-08-24,
> 6 decisiones de Abraham registradas abajo como restricciones fijas, más el
> cambio de marco documental. Continúa las exploraciones 039/040 (cuenta
> comercial) y las complementa con la mitad del PRD §28 que faltaba.

## Idea original

Abraham (2026-08-24, verbatim condensado): «ya estamos en una etapa de beta, la
única diferencia que debe haber a producción son los pagos»; «estamos dejando
bien el panel del admin para que funcione como centro operativo, que esté todo
bien validado como está escrito en el PRD»; «ya no se está usando prd-beta ni
demo»; «quiero que sea accesible el panel del admin desde los tres puntitos…
que ahí mismo lleguen las notificaciones y ahí mismo poder aprobar/rechazar
solicitudes… cambios por ejemplo esto de la cuenta comercial o incluso la
modificación de datos como precio»; «debemos definir ya las notificaciones para
admin» (no existen en ningún doc — hueco confirmado); «asegurarnos que todas
las partes estén bien optimizadas en cuanto a código, lógica eficiente»; «aún
falta testear a profundidad lo de las cuentas»; «incluiremos y adoptaremos
todas las tareas ya existentes que están pendientes y que se complementan bien
con el módulo»; «busquemos maneras de lanzarlo rápido pero a la vez optimizado».

## 🔴 Cambio de marco documental (gobernanza, decisión de Abraham 2026-08-24)

1. **`docs/PRD.md` vuelve a ser LA fuente de verdad de producto** — es el
   documento hecho sobre los requerimientos del cliente. Sus decisiones se
   mantienen tal cual salvo enmienda explícita registrada.
2. **`docs/PRD-beta.md` y `docs/PRD-MVP-demo.md` se RETIRAN como referencia.**
   El escalonamiento por "olas" deja de gobernar el alcance; el criterio pasa a
   ser **"beta = producción menos pagos"**: todo lo del PRD debe funcionar y
   estar probado, excepto lo que dependa de cobrar.
3. **Enmiendas al PRD que nacen de este módulo** (sección nueva de desarrollo,
   como se hizo con la cuenta comercial):
   - **§22.x Notificaciones al administrador** — NO existe hoy (el catálogo
     §22.3 tiene 19 filas y ninguna con audiencia Admin). Se redacta aquí
     (catálogo v1 abajo) y se propone como addendum al PRD.
   - **§15.1 calendario** — la revisión previa de publicaciones queda
     suspendida DURANTE la beta (decisión 1 abajo); el texto del PRD no cambia,
     se anota la vigencia.
   - El PRD tampoco cubre publicidad/cuenta comercial (vive en 039/040): ese
     addendum queda pendiente de redacción, fuera de este módulo.

## Hallazgos de la investigación (3 barridos: PRD, vault, Taskmaster+código)

**La brecha no es de especificación, es de construcción — y el vault miente.**

| Hallazgo | Evidencia |
|---|---|
| 🔴 **Bug vivo**: editar precio/dirección/descripción de una propiedad activa crea una revisión en `property_revisions` que NADIE puede aprobar (no existe UI; `moderate-property` está desplegada sin llamador). El cambio queda invisible para siempre salvo SQL. | `edit-property/handler.ts:200-215` escribe; grep de lectores en mobile = 0 |
| 🔴 **El vault afirma lo contrario de la realidad**: `conceptos/moderacion.md:12` y `propiedades-y-video.md:86` dicen que toda publicación pasa por revisión — falso desde #153 (2026-08-11, publicar → `active` directo). Solo `log.md:759` registra la verdad. | trampa activa para cualquier sesión futura |
| **`/admin` solo por deep link** — cero entradas en la UI (verificado: grep de `'/admin'` fuera del propio panel = 0; el menú ⋮ tiene 2 ítems). | `ProfileScreen.tsx:202-223` |
| **`property_reports` muerta**: tabla completa desde junio (7 motivos, unique 1×(prop,user), índice de cola) con CERO escritores y lectores. La regla 3/24h→suspended del §24.1 nunca se implementó. | migración `20260604000007:28-53` |
| **`notifications` sin lector**: 1 escritor (cron anuncios por expirar → owners de org) y ninguna pantalla que la lea. `expo-notifications` no está instalado. | `20260822000001`; `package.json` |
| **`agent_applications` sin cola**: la EF `request-agent-upgrade` escribe solicitudes que nadie lee desde UI (aprobación por Studio). | grep = solo la EF |
| **No existe canal para SOLICITAR cuenta comercial** — 039:133 lo promete («el owner la solicita; en beta la enciende el admin»), sin tarea ni código. Solo existe el lado del admin (#209). | hueco de backlog confirmado |
| Propiedades y anuncios usan **modelos de re-revisión opuestos** (doble versión §15.6 vs democión in-place #192): asimetría deliberada, se mantiene — pero la democión de anuncios no está documentada en el vault. | `20260818000001` |

## Decisiones de la entrevista (restricciones fijas, 2026-08-24)

1. **Publicar queda LIBRE durante la beta** (se mantiene #153: nace `active`).
   Es la excepción explícita al PRD §15.1, ligada a que en beta no se cobra; la
   revisión previa regresa **después de beta, junto con los pagos**. El revert
   sigue siendo el re-flip documentado en #153.
2. **La re-revisión de EDICIONES se mantiene encendida y este módulo construye
   la UI que falta** (cola de revisiones sobre `property_revisions`, acciones
   approve/needs_changes/reject de `moderate-property`). Es antifraude (evita
   el switch de precio post-publicación), no depende de pagos, y el backend ya
   está completo y probado.
3. **Transporte de notificaciones admin: badges + centro in-app. Push = fase 2.**
   - Badges del home del panel = **contadores vivos leídos de las colas**
     (pending ads, revisiones, reportes, solicitudes) — cero infra nueva,
     imposible que mientan.
   - Centro de notificaciones in-app = primer LECTOR de `public.notifications`
     (genérico: sirve al admin y estrena las filas que ya se escriben a
     owners de org). Push (expo-notifications + device_tokens + EF despacho,
     la vieja #77) queda como fase 2 del centro — el módulo deja la tabla y el
     centro listos para conectarle push sin rehacer nada.
4. **Alcance**: entran **reportes §24 completo** (botón Reportar en la app,
   cola en el panel, auto-suspensión 3 reportes/24h) y **solicitudes
   pendientes** (agente, registro de inmobiliaria, y el canal NUEVO de
   solicitud de cuenta comercial). Quedan FUERA y registrados como
   continuación: gestión de usuarios (§28.3-4, absorbería #204), dashboard de
   métricas y vista de auditoría. **Comentarios (§18) = módulo propio
   posterior** (la feature entera no existe; el panel nace listo para recibir
   su cola).
5. **Secuencia: cerrar #212 → este módulo → #213.** El dashboard del
   anunciante se termina primero (diseño ya aprobado, RPCs probadas locales);
   la promo de propiedad (#213) cae después del módulo y usa su moderación.
6. **Testing profundo de cuenta comercial: sesión manual guiada + E2E después.**
   Checklist de recorrido completo sobre la rama preview (flujos + caminos de
   error, datos preparados), recorrido juntos en el emulador con verificación
   de backend en vivo; lo que truene = tarea fix inmediata. Además una subtarea
   de flujos Maestro E2E como regresión automatizada.

Decisiones menores anotadas (tomadas por Virgilio, revisables):
- La entrada al panel va en el **menú ⋮ del perfil** («Panel de administrador»),
  visible solo si `role='admin'` — muere el deep link como única vía.
- El catálogo v1 de notificaciones (abajo) se aprueba con este doc.
- `#152` (alert de publicación prometía feed inmediato) queda COHERENTE con la
  decisión 1 → se cierra sin trabajo. `#131` (draft→active se salta moderación)
  pierde urgencia por la misma razón, se mantiene deferred.

## Catálogo v1 — notificaciones al administrador (propuesta aprobable)

Escritor: trigger/EF según el evento inserta UNA fila en `notifications` por
cada usuario con `users.role='admin'` (hoy 2). Idempotencia por índice único
parcial como `notify_ads_expiring_soon` (patrón ya probado). `deep_link` apunta
a la pantalla del panel correspondiente.

| Evento | type | Deep link |
|---|---|---|
| Anuncio entra a `pending_review` | `admin_ad_pending` | `/admin/ads` |
| Revisión de edición creada (`property_revisions` pending) | `admin_revision_pending` | `/admin/revisions` |
| Reporte nuevo (1º y 2º de una propiedad) | `admin_report_new` | `/admin/reports` |
| Auto-suspensión por 3 reportes/24h | `admin_report_autosuspend` | `/admin/reports` |
| Solicitud de agente nueva | `admin_agent_application` | `/admin/requests` |
| Registro de inmobiliaria pendiente | `admin_agency_pending` | `/admin/requests` |
| Solicitud de cuenta comercial nueva | `admin_advertising_request` | `/admin/requests` |

Lado usuario (§28.4, mismas escrituras en la misma transacción): resultado de
su revisión de edición (aprobada / cambios pedidos / rechazada, con motivo),
resultado de su solicitud (agente / inmobiliaria / cuenta comercial), y
publicación suspendida por reportes (con motivo). En beta: solo in-app (correo
y push = fase 2).

## Bloques → tareas (una tarea = una rama = un PR)

| Bloque | Contenido | Adopta |
|---|---|---|
| **M0 — Acceso + badges + verdad documental** | Entrada «Panel de administrador» en ⋮ (solo admin); home del panel con contadores vivos por cola; corregir `conceptos/moderacion.md` + `propiedades-y-video.md` (#153), banner de retiro en PRD-beta/demo, addendum §22.x al PRD (catálogo v1), nota de concepto `wiki/conceptos/panel-admin.md` | cierra #152 |
| **M1 — Cola de revisiones de ediciones** | Pantalla `/admin/revisions`: diff campo por campo (viejo→nuevo), approve / needs_changes / reject con motivo vía `moderate-property`; pestañas de estado en «Mis publicaciones» para que el publicador vea su revisión | #136, #124 (⚠️ el «#141 UI de moderación» que cita `estado-actual.md` no existe en Taskmaster — referencia podrida; la UI nace aquí) |
| **M2 — Centro de notificaciones in-app** | Pantalla campana (todos los roles) que lee `notifications`: lista, no-leídas, marcar leída/todas, deep links; escritores admin del catálogo v1; badge de campana | adelanta el centro in-app de la vieja #77 (push queda fase 2) |
| **M3 — Reportes §24** | Botón «Reportar» (popup de detalle + perfil de publicador, 7 motivos, 1×usuario); cola `/admin/reports` (restaurar / pedir cambios / mantener suspendida / eliminar); trigger de auto-suspensión 3 reportes/24h; notificaciones de ambos lados | absorbe #79.1–79.2 (79.3 antifraude-evidencia queda fuera) |
| **M4 — Solicitudes** | Cola `/admin/requests` unificada: `agent_applications` (aprobar/rechazar con motivo), registros de inmobiliaria `pending_approval`, y canal nuevo de cuenta comercial (botón «Quiero anunciar» del owner → solicitud con categoría propuesta → admin aprueba = `set-org-advertising`) | conecta con 71.3/71.5 (hoy vía Studio) |
| **M5 — Testing profundo + optimización + release** | Checklist guiado del ciclo comercial completo en preview (con Abraham); flujos Maestro E2E; `/ponytail-review` por bloque ya hecho + `/ponytail-audit` sobre `features/admin`; OTA a testers; ingest final al vault | — |

Orden: M0 → M1 → M2 → M3 → M4 → M5. M0 es deliberadamente pequeño (operas el
panel desde el teléfono el día 1). M2 antes que M3/M4 para que reportes y
solicitudes nazcan notificando. Cada bloque cierra con `pnpm tsc` + suites +
smoke; TDD estricto donde el footprint lo marque (EFs, triggers, RPCs, hooks).

## Fuera de alcance (registrado, no perdido)

- **Comentarios §18** — módulo propio siguiente (tabla+filtros+UI usuario+cola).
- **Gestión de usuarios §28.3-4** + #204 (suspensión de plataforma) — tarea futura.
- **Dashboard de métricas + vista de auditoría** — pantallas de lectura, después.
- **Push real / correo** (fase 2 del centro), **evidencia antifraude** (79.3),
  **pagos** (post-beta), **panel web #81** (sigue diferido).

## Riesgos / producción viva (§0.5)

- Todo se ensaya en la **rama preview-ads** antes de producción; sondas pasivas
  en prod (patrón de 209–212).
- Los escritores de notificaciones son **aditivos** (tabla existente, índices
  únicos nuevos, cero cambios a contratos publicados).
- El trigger de auto-suspensión toca `properties.status` — se diseña
  idempotente, con rollback probado y sin afectar filas existentes.
- La entrada ⋮ y las pantallas nuevas viajan por OTA; ningún módulo nativo
  nuevo en M0–M5 (el push de fase 2 SÍ será nativo → rebuild, por eso quedó
  fuera).
- `admin_actions` sigue siendo la auditoría única e inmutable de toda acción.
