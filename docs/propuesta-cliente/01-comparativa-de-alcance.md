# Cómo evolucionó el alcance de Urbea

### De la idea inicial al PRD oficial


| Campo     | Valor                                                                                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Documento | Comparativa de alcance para el cliente                                                                                                                                                 |
| Versión   | 1.0                                                                                                                                                                                    |
| Fecha     | Mayo de 2026                                                                                                                                                                           |
| Audiencia | Equipo Urbea                                                                                                                                                                           |
| Propósito | Mostrar de forma clara cómo creció el alcance del proyecto entre los documentos que han marcado su definición, para que tomemos juntos decisiones informadas sobre los próximos pasos. |


---

## Índice

1. [Antes de empezar](#antes-de-empezar)
2. [Los tres documentos del proyecto](#los-tres-documentos-del-proyecto)
3. [Línea de tiempo](#línea-de-tiempo)
4. [Resumen visual del crecimiento](#resumen-visual-del-crecimiento)
5. [Comparativa de funcionalidades clave](#comparativa-de-funcionalidades-clave)
6. [Cómo se traduce esto en tiempo y esfuerzo](#cómo-se-traduce-esto-en-tiempo-y-esfuerzo)
7. [Por qué pasó esto y por qué es buena noticia](#por-qué-pasó-esto-y-por-qué-es-buena-noticia)
8. [Qué necesitamos decidir juntos](#qué-necesitamos-decidir-juntos)

---

## Antes de empezar

Este documento es una **fotografía de sus requerimientos**, hecha para que tomemos decisiones con los ojos abiertos antes de empezar el desarrollo.  
  
Incluye algunas adiciones que hice personalmente y que considero un estandar para que la app funcione correctamente, como notificaciones de push y reportes.

Lo que vas a ver aquí es objetivo y se puede verificar con los archivos que Santiago y yo hemos intercambiado linea por línea contra los tres documentos que hemos generado:

- `Alineacion Inicial.` (tu brief original, fue el que me envio Santiago en un inicio)
- `propuesta-desarrollo-mvp.pdf` (mi propuesta cotizada)
- `PRD.md` el (Product Requiremen Document) Que resulto a raiz de sus requerimientos esta ultima semana.

El proyecto pasó de ser "una app de videos para descubrir propiedades" a ser **una plataforma inmobiliaria completa con CRM, sistema de pagos, panel administrativo web, landing page y modelo de roles**. Eso no es ni bueno ni malo: es una realidad que necesitamos reconocer para alinear expectativas, plazos y presupuesto.

---

## Los tres documentos del proyecto

### Documento 1: `Alineacion.` — Tu visión inicial


| Campo      | Valor                                                           |
| ---------- | --------------------------------------------------------------- |
| Autor      | Tú (Urbea)                                                      |
| Fecha      | Enero de 2026                                                   |
| Naturaleza | Brief inicial, alto nivel                                       |
| Propósito  | Alinear la idea, decidir si es viable, dejar claras prioridades |


Este documento describe Urbea como una **plataforma móvil de videos para descubrir propiedades en alquiler**, con feed tipo TikTok, recomendaciones por ubicación, interacciones simples (like, guardar) y contacto a agente vía WhatsApp. Su objetivo declarado fue **validar la idea**, no construir el producto final.

Lo que el documento dice explícitamente:

- App móvil iOS y Android.
- Feed infinito de videos.
- Videos asociados a ubicación.
- Registro básico de usuarios.
- Interacciones simples (likes, guardar).
- Recomendaciones por cercanía.
- Panel de administración para monitorear el sistema.

### Documento 2: `propuesta-desarrollo-mvp.md` — La propuesta cotizada


| Campo          | Valor                                        |
| -------------- | -------------------------------------------- |
| Autor          | Yo (desarrollador)                           |
| Fecha          | 10 de marzo de 2026                          |
| Naturaleza     | Propuesta formal con alcance, plazo y precio |
| Precio cerrado | $120,000 MXN                                 |
| Plazo cerrado  | 17 semanas                                   |


Este documento toma tu brief inicial y lo aterriza en una propuesta concreta de desarrollo. Define stack técnico, fases, entregables, costos operativos y los planes de soporte post-MVP.

Sobre el alcance, mi propuesta dice expresamente qué está incluido y qué no:

- **Incluido:** app móvil android y ios, catálogo, sistema de video, mapa, registro, likes/favoritos, integración WhatsApp, panel inmobiliaria, panel administración.
- **NO incluido en MVP (textual de la propuesta):**
  - Publicidad integrada.
  - Algoritmos avanzados de inteligencia artificial.
  - Chat interno entre usuarios y agentes.
  - **Sistema de pagos/transacciones.**
  - Versión web completa.

Este documento es el **contrato vigente entre nosotros** y la base sobre la cual recibí el primer pago.

### Documento 3: `PRD.md` — El producto que cerramos juntos


| Campo      | Valor                                            |
| ---------- | ------------------------------------------------ |
| Autor      | Tú y yo, en sesiones conjuntas                   |
| Fecha      | Mayo de 2026                                     |
| Naturaleza | Documento oficial de requerimientos del producto |
| Páginas    | 35 secciones, ~1,500 líneas                      |


Este documento es el resultado de una semana de definición a profundidad, en el cual revise parte por parte, seccion por seccion. Aquí decidimos juntos cosas como:

- 5 niveles de roles de usuario.
- Sistema de pagos con Stripe y 3 planes comerciales.
- CRM completo con embudo automático de scoring de leads.
- Catálogo de 19 tipos de notificaciones push. (Es un estandar que una app tenga notificaciones de push)
- Panel administrativo web completo con 10 pantallas principales. (Necesarias para administrar comodamente todas las acciones requeridas por el admin)
- Landing page web para la app. (mencionad en la junta)
- Sistema de moderación con reportes y suspensión automática. (tambien mencionado en la junta aun que no confirmado por ustedes)
- Eliminación de cuenta con cumplimiento LFPDPPP.
- Auditoría inmutable de acciones administrativas. (para poder rastrear acciones de usuarios)
- Versionado de publicaciones durante re-revisión. (En caso de que se cambien datos criticos, como la direccion de una propiedad)
- Sistema de invitación con tokens para inmobiliarias.
- Y muchas, muchas cosas más.

El PRD es un documento detallado y especifico de producto. **El problema no es el PRD; es la distancia entre el PRD y lo que cotizamos en marzo.**

---

## Línea de tiempo

```
Enero 2026                   Marzo 2026                   Mayo 2026
     |                            |                            |
     v                            v                            v
[Alineacion.md]            [propuesta-mvp.md]              [PRD.md]
Idea inicial               Propuesta cotizada          Producto detallado
"Validar la idea"          $120,000 MXN / 17 semanas    35 secciones
~8 funcionalidades         ~12 funcionalidades         ~50+ funcionalidades
```

---

## Resumen visual del crecimiento


| Indicador                              | Alineación inicial | Propuesta cotizada    | PRD actual                      |
| -------------------------------------- | ------------------ | --------------------- | ------------------------------- |
| Módulos funcionales principales        | 6                  | 8                     | 22                              |
| Roles de usuario                       | 2                  | 2-3                   | 5 + entidad inmobiliaria        |
| Estados definidos para una publicación | No definidos       | No definidos          | 16 estados                      |
| Sistema de monetización                | No mencionado      | Excluido del MVP      | Incluido con 3 planes y Stripe  |
| CRM para agentes                       | No mencionado      | No mencionado         | Sistema completo con scoring    |
| Notificaciones push                    | No mencionadas     | No mencionadas        | 19 tipos catalogados            |
| Landing page web                       | No mencionada      | No mencionada         | Sitio en Astro con formularios  |
| Cumplimiento legal explícito (LFPDPPP) | No mencionado      | No mencionado         | Incluido                        |
| Sub-productos a construir              | 1 (app móvil)      | 2 (app + panel admin) | 3 (app + panel admin + landing) |


---

## Comparativa de funcionalidades clave

A continuación, las funcionalidades que más impactan en tiempo, costo y complejidad técnica. La convención es: **Sí** (presente), **—** (no presente), **Parcial** (mencionado pero sin detalle).

### Monetización y pagos


| Funcionalidad                               | Alineación | Propuesta | PRD |
| ------------------------------------------- | ---------- | --------- | --- |
| Sistema de pagos integrado                  | —          | Excluido  | Sí  |
| 3 planes comerciales definidos              | —          | —         | Sí  |
| Pasarela Stripe con tarjeta, OXXO, SPEI     | —          | —         | Sí  |
| Modelo de créditos con caducidad de 90 días | —          | —         | Sí  |
| Webhooks de Stripe con manejo idempotente   | —          | —         | Sí  |
| Notificaciones de expiración de créditos    | —          | —         | Sí  |


> Sobre esto en particular: tu propuesta cotizada **excluye explícitamente** el sistema de pagos del MVP. En el PRD pasa a ser un módulo completo.

### CRM y leads


| Funcionalidad                                                | Alineación | Propuesta | PRD |
| ------------------------------------------------------------ | ---------- | --------- | --- |
| Contacto vía WhatsApp                                        | Sí         | Sí        | Sí  |
| CRM con vista de leads                                       | —          | —         | Sí  |
| Embudo automático con scoring de leads                       | —          | —         | Sí  |
| 9 estados de lead                                            | —          | —         | Sí  |
| Historial de cambios de lead                                 | —          | —         | Sí  |
| Notas internas del agente sobre lead                         | —          | —         | Sí  |
| Exportación CSV de leads                                     | —          | —         | Sí  |
| Acceso retroactivo a interacciones del usuario tras contacto | —          | —         | Sí  |


### Roles y autenticación


| Funcionalidad                                      | Alineación | Propuesta | PRD |
| -------------------------------------------------- | ---------- | --------- | --- |
| Niveles de usuarios                                | 2          | 2-3       | 5   |
| Sign in with Google                                | —          | Parcial   | Sí  |
| Sign in with Apple                                 | —          | Parcial   | Sí  |
| Verificación de teléfono por OTP (SMS)             | —          | —         | Sí  |
| Beta cerrada con códigos únicos                    | —          | —         | Sí  |
| Versionado de términos y aviso de privacidad       | —          | —         | Sí  |
| Wizard de upgrade a agente con dos caminos         | —          | —         | Sí  |
| Sistema de tokens de invitación para inmobiliarias | —          | —         | Sí  |


### Notificaciones


| Funcionalidad                        | Alineación | Propuesta | PRD |
| ------------------------------------ | ---------- | --------- | --- |
| Notificaciones push (FCM + APNs)     | —          | —         | Sí  |
| Centro de notificaciones in-app      | —          | —         | Sí  |
| 19 tipos de notificación catalogados | —          | —         | Sí  |
| Configuración de toggles por tipo    | —          | —         | Sí  |


### Panel administrativo y moderación


| Funcionalidad                                         | Alineación | Propuesta                | PRD                         |
| ----------------------------------------------------- | ---------- | ------------------------ | --------------------------- |
| Panel admin web                                       | Parcial    | Sí (2 semanas estimadas) | Sí (10 pantallas, dedicado) |
| Moderación manual de publicaciones                    | —          | Sí                       | Sí                          |
| Cola de moderación de comentarios                     | —          | —                        | Sí                          |
| Reportes de propiedades con motivos predefinidos      | —          | —                        | Sí                          |
| Suspensión automática a 3 reportes en 24 h            | —          | —                        | Sí                          |
| Gestión completa de usuarios con cambio de rol manual | —          | Parcial                  | Sí                          |
| Aprobación de inmobiliarias                           | —          | —                        | Sí                          |
| Aprobación de agentes independientes                  | —          | —                        | Sí                          |
| Generación de códigos de invitación de beta           | —          | —                        | Sí                          |
| Log de auditoría inmutable                            | —          | —                        | Sí                          |


### Landing y web pública


| Funcionalidad                                        | Alineación | Propuesta | PRD                 |
| ---------------------------------------------------- | ---------- | --------- | ------------------- |
| Landing page web                                     | —          | —         | Sí (Astro estático) |
| Página destino para deep links de videos compartidos | —          | —         | Sí                  |
| Formulario de captación de interesados a agente      | —          | —         | Sí                  |
| Sección de beta cerrada con lista de espera          | —          | —         | Sí                  |


### Manejo legal de datos


| Funcionalidad                                       | Alineación | Propuesta | PRD |
| --------------------------------------------------- | ---------- | --------- | --- |
| Eliminación de cuenta con ventana de gracia 15 días | —          | —         | Sí  |
| Soft delete sistemático con retención por tipo      | —          | —         | Sí  |
| Cumplimiento LFPDPPP explícito                      | —          | —         | Sí  |
| Anonimización de comentarios de cuentas eliminadas  | —          | —         | Sí  |
| Auditoría completa de acceso a datos sensibles      | —          | —         | Sí  |


### Procesamiento de video


| Funcionalidad                                            | Alineación | Propuesta | PRD |
| -------------------------------------------------------- | ---------- | --------- | --- |
| Subida de video al servicio                              | Sí         | Sí        | Sí  |
| Subida resumible si se pierde la conexión                | —          | —         | Sí  |
| Procesamiento en background con notificación al terminar | —          | Parcial   | Sí  |
| Selección de thumbnail (3 sugeridos + slider)            | —          | —         | Sí  |
| Múltiples videos por propiedad con anti-clustering       | —          | —         | Sí  |
| 16 estados definidos para una publicación                | —          | —         | Sí  |
| Versionado de publicaciones durante re-revisión          | —          | —         | Sí  |


---

## Cómo se traduce esto en tiempo y esfuerzo

### Lo cotizado en marzo


| Concepto     | Valor                                              |
| ------------ | -------------------------------------------------- |
| Equipo       | 1 desarrollador backend + 1 desarrollador frontend |
| Plazo        | 17 semanas                                         |
| Precio total | $120,000 MXN                                       |


### Lo que implicaría el PRD actual

Considerando que tomaste la decisión de que yo continúe como desarrollador único (lo cual es viable porque el stack elegido reduce mucho la complejidad de backend), te comparto una estimación honesta:


| Bloque adicional al alcance original                         | Semanas-persona estimadas |
| ------------------------------------------------------------ | ------------------------- |
| Sistema completo de roles + flujos de upgrade                | 2-3                       |
| Beta cerrada con auditoría de invitaciones                   | 1                         |
| CRM con embudo de scoring automático                         | 3-4                       |
| Modelo comercial con Stripe + planes + créditos              | 2-3                       |
| Sistema de notificaciones push + in-app + catálogo           | 2-3                       |
| Panel admin web completo (diferencia con el simple cotizado) | 3-4                       |
| Landing en Astro con formularios y captación                 | 1-2                       |
| Sistema de reportes y suspensión automática                  | 1-2                       |
| Eliminación de cuenta + retención + LFPDPPP                  | 1-2                       |
| Wizard publicación + borradores + subida resumible           | 1-2                       |
| Búsqueda dedicada + clustering en mapa                       | 1-2                       |
| Métricas detalladas + events_raw + dashboards                | 2-3                       |
| QA, testing automatizado y observabilidad                    | 2-3                       |
| **Adicional al alcance cotizado**                            | **22-34 semanas-persona** |


### Comparativa final


| Escenario                 | Tiempo total estimado | Equivalente con 1 dev full-time                                              |
| ------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| Alcance cotizado original | 17 semanas con 2 devs | Se mantiene la ventana de timpo                                              |
| Alcance del PRD actual    | 39-51 semanas         | ~10-13 meses con 1 dev para llegar a la verson Final con el alcance del PRD. |


---

## Por qué pasó esto y por qué es buena noticia

Que el alcance haya crecido entre el brief y el PRD es **lo más común del mundo en proyectos de software**, y de hecho es **señal de un buen proceso de definición**. Te explico por qué.

Cuando un cliente piensa una idea, naturalmente la describe en términos de **qué quiere lograr**. Por ejemplo: "una app de videos para descubrir propiedades". Eso es perfecto como punto de partida.

Cuando un desarrollador y un cliente sentados frente a la realidad técnica empiezan a hacerse las preguntas necesarias para construir el producto — *¿cómo se inscribe el agente? ¿cómo se valida? ¿qué pasa si la propiedad se vende? ¿cómo se contacta? ¿cómo se reportan abusos? ¿cómo se elimina una cuenta sin violar la ley de datos?* — aparecen decenas de decisiones que el brief original simplemente no podía anticipar. Eso es **bueno**: significa que el producto que finalmente se construya será mucho mejor pensado que si hubiéramos arrancado a programar el día siguiente de tu brief.

El problema **no es** que el alcance creció. El problema es que **el contrato vigente entre nosotros sigue siendo el de marzo**, y ese contrato no contempla lo que terminamos diseñando juntos.

Por eso este documento existe: para que **antes de empezar a construir**, alineemos contrato y realidad.

---

## Qué necesitamos decidir juntos

Esta no es una situación nueva en proyectos de software. Las opciones razonables son tres, y todas las he visto funcionar en otros proyectos:

### Opción A: Construir lo que cotizamos en marzo, dejar el resto como roadmap

Te entrego una app fiel a la propuesta de marzo: feed de videos, búsqueda básica, mapa, registro, contacto WhatsApp, panel admin simple para moderación. Sin sistema de pagos, sin CRM avanzado, sin notificaciones push, sin landing. Honro el precio cotizado de $120,000 MXN y el plazo de 17 semanas (ajustable a 14-16 ya que iremos en stack Supabase y soy uno solo).

El resto del PRD queda como **roadmap para fases siguientes** que cotizamos una a una cuando estés listo para invertir en ellas.

### Opción B: Construir un MVP intermedio con precio ajustado

Mantenemos del PRD lo crítico para arrancar a operar comercialmente (pagos básicos, CRM básico, panel admin completo, notificaciones básicas) y diferimos lo no esencial. El precio total se ajusta proporcionalmente.

### Opción C: Construir el PRD completo con renegociación honesta

Ejecutamos el PRD tal como está documentado. Esto requiere ajustar precio y plazo a la realidad del alcance.

### Opción D: Desarrollo por fases con pagos escalonados (mi recomendación)

- **Fase 1:** lo cotizado en marzo ($120,000 MXN, ~17 semanas). Entregamos app funcional con feed, mapa, registro, contacto, panel admin simple. Cerramos el contrato vigente con todo entregado y validamos la idea con usuarios reales.
- **Fase 2:** cotizamos juntos el bloque comercial (pagos + roles + premium + agentes).
- **Fase 3:** cotizamos juntos el CRM completo.
- **Fase 4:** cotizamos juntos notificaciones push + reportes + eliminación de cuenta + audit log.
- **Fase 5:** cotizamos juntos landing en Astro + panel admin completo.

Cada fase se cotiza al momento de iniciarla, con scope cerrado y precio cerrado. **Esta opción te da máxima flexibilidad y reduce tu riesgo financiero al mínimo**, porque solo inviertes en cada fase cuando la anterior demostró tracción.

---

## Próximo paso

Les sugiero una Videollamada o una Reunion para revisar este documento juntos.

Te repito lo más importante: **el objetivo de este documento no es renegociar ni vender más, es darte visibilidad real del proyecto para que las decisiones que tomes estén bien informadas**. Si optas por la Opción A (lo cotizado original), eso es perfectamente legítimo y mi compromiso técnico se mantiene intacto.

Gracias por la confianza y Hablamos pronto.