# Comparativa de Alcance — Proyecto Urbea

| Campo | Valor |
|-------|-------|
| Documento | Comparativa de requerimientos entre alineación inicial, propuesta de desarrollo y PRD oficial |
| Fecha | 2026-05-15 |
| Audiencia | Cliente, dirección de proyecto y equipo de desarrollo |
| Objetivo | Mostrar de forma clara cómo evolucionó el alcance del producto y qué requerimientos aparecen formalmente en el PRD actual |

---

## 1. Propósito

Este documento busca poner en perspectiva la evolución natural del proyecto.

La idea inicial de Urbea partió como una aplicación móvil para descubrir propiedades mediante videos cortos. Después, la propuesta de desarrollo convirtió esa idea en un MVP con módulos principales: app móvil, videos, mapa, registro, favoritos, WhatsApp, panel inmobiliario y panel administrativo.

El PRD actual ya no describe solamente una primera versión funcional. Describe un producto mucho más completo, con reglas de operación, roles, pagos, CRM, moderación, notificaciones, métricas, cumplimiento de privacidad, panel administrativo avanzado y preparación para crecimiento.

La intención de esta comparativa no es señalar errores ni asignar culpas. El objetivo es que todos puedan ver, con claridad, qué se pidió al inicio, qué se cotizó después y qué requiere hoy el documento oficial de desarrollo.

---

## 2. Documentos Comparados

| Documento | Qué representa | Nivel de detalle |
|-----------|----------------|------------------|
| `Alineacion.md` | La visión inicial del producto. Sirve para validar la idea y entender el concepto general. | Conceptual |
| `docs/propuesta-desarrollo-mvp.md` | La propuesta formal de desarrollo, con alcance, tiempo, costo y módulos incluidos. | Funcional general |
| `PRD.md` | El documento oficial actual para construir el producto. Define reglas, flujos, roles, estados, pantallas, lógica de negocio y decisiones operativas. | Detallado y operativo |

---

## 3. Resumen Ejecutivo

El PRD actual conserva la esencia de la idea original: una app móvil inmobiliaria basada en video, ubicación y contacto directo.

Sin embargo, el alcance creció de forma importante. La alineación inicial hablaba de validar una idea. La propuesta hablaba de construir un MVP funcional. El PRD actual describe una plataforma completa para operar una beta cerrada, monetizar publicaciones, administrar agentes, clasificar leads, moderar contenido, enviar notificaciones, medir comportamiento y gestionar la operación desde un panel web.

| Tema | En la alineación inicial | En la propuesta | En el PRD actual |
|------|--------------------------|-----------------|------------------|
| Enfoque principal | Validar una idea de app con videos de propiedades | Construir un MVP móvil con backend y paneles básicos | Construir una plataforma operativa con reglas completas de producto |
| Usuarios contemplados | Usuarios finales e inmobiliarias | Usuarios, inmobiliarias y administradores | Visitantes, registrados, premium, agentes, inmobiliarias y administradores |
| Publicación de propiedades | Mencionada de forma general | Incluida como gestión de propiedades | Definida con wizard, video, borradores, revisión, estados y vigencia |
| Monetización | No definida | Pagos/transacciones excluidos del MVP | Modelo comercial con planes, créditos, vigencias y Stripe post-beta |
| Relación con agentes | Contacto por WhatsApp | Contacto directo por WhatsApp | CRM completo con leads, puntaje, estados, notas y exportación |
| Operación interna | Panel de administración mencionado a alto nivel | Panel administrativo incluido | Panel web avanzado con moderación, reportes, usuarios, inmobiliarias, invitaciones y auditoría |

**Lectura principal:** el PRD no es una simple aclaración del alcance original; es una ampliación sustancial del producto.

---

## 4. Cómo Leer la Tabla

| Estado | Significado |
|--------|-------------|
| No aparece | El documento no menciona ese requerimiento. |
| A alto nivel | El documento lo menciona como idea general, pero sin reglas suficientes para construirlo. |
| Incluido | El documento lo considera parte del alcance. |
| Definido a detalle | El documento especifica comportamiento, reglas, flujos y condiciones. |
| Excluido | El documento indica expresamente que no forma parte del MVP. |

---

## 5. Tabla Comparativa de Requerimientos

### 5.1 Producto y Plataformas

| Requerimiento / feature | Alineación inicial | Propuesta de desarrollo | PRD oficial | Lectura para cliente |
|-------------------------|--------------------|--------------------------|-------------|----------------------|
| Aplicación móvil iOS y Android | Incluido | Incluido | Definido a detalle | Se mantiene desde el inicio. |
| Feed vertical de videos tipo TikTok | Incluido | Incluido | Definido a detalle | Es el corazón del producto en los tres documentos. |
| Experiencia sin cuenta dentro de la app | No aparece | No aparece | No incluida; la app requiere cuenta | El PRD define una decisión nueva: la app móvil no opera como visitante. |
| Visitantes desde links compartidos | No aparece | No aparece | Definido a detalle | Se agrega una experiencia web limitada para personas sin cuenta. |
| Landing page pública | No aparece | No aparece | Definido a detalle | Nuevo alcance del PRD. |
| Web app de escritorio completa | No aparece | Excluida | Post-MVP | Se mantiene fuera del MVP. |

### 5.2 Registro, Acceso y Beta

| Requerimiento / feature | Alineación inicial | Propuesta de desarrollo | PRD oficial | Lectura para cliente |
|-------------------------|--------------------|--------------------------|-------------|----------------------|
| Registro de usuarios | A alto nivel | Incluido | Definido a detalle | Pasa de registro básico a validaciones completas. |
| Login con correo | A alto nivel | Incluido | Definido a detalle | Se mantiene, con reglas más claras. |
| Login con Google y Apple | No aparece | A alto nivel como redes sociales | Definido a detalle | El PRD precisa métodos concretos. |
| Verificación de teléfono por OTP | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Verificación de correo | No aparece | No aparece | Definido a detalle | Nuevo requerimiento formal. |
| Recuperación de contraseña | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Beta cerrada con códigos de invitación | No aparece | No aparece | Definido a detalle | Nuevo alcance importante para controlar acceso. |
| Términos, privacidad y versionado de consentimientos | No aparece | No aparece | Definido a detalle | Nuevo requerimiento legal y operativo. |

### 5.3 Roles y Permisos

| Requerimiento / feature | Alineación inicial | Propuesta de desarrollo | PRD oficial | Lectura para cliente |
|-------------------------|--------------------|--------------------------|-------------|----------------------|
| Usuario final | Incluido | Incluido | Definido a detalle | Se mantiene. |
| Inmobiliaria | Incluido | Incluido | Definido a detalle | Pasa de actor general a entidad con reglas propias. |
| Usuario registrado | A alto nivel | A alto nivel | Definido a detalle | El PRD lo convierte en rol formal. |
| Usuario premium | No aparece | No aparece | Definido a detalle | Nuevo rol ligado a publicación pagada. |
| Agente inmobiliario verificado | No aparece | A alto nivel | Definido a detalle | Se amplía con badge, CRM, métricas y flujos de aprobación. |
| Administrador | A alto nivel | Incluido | Definido a detalle | El PRD define permisos, pantallas y auditoría. |
| Cambio de rol registrado a premium | No aparece | No aparece | Definido a detalle | Nuevo flujo de producto. |
| Solicitud para convertirse en agente | No aparece | No aparece | Definido a detalle | Nuevo flujo de producto y operación. |
| Agente bajo inmobiliaria mediante token | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Agente independiente aprobado por admin | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Registro y aprobación de inmobiliaria | A alto nivel | A alto nivel | Definido a detalle | El PRD agrega reglas y proceso de aprobación. |

### 5.4 Descubrimiento de Propiedades

| Requerimiento / feature | Alineación inicial | Propuesta de desarrollo | PRD oficial | Lectura para cliente |
|-------------------------|--------------------|--------------------------|-------------|----------------------|
| Recomendaciones por ubicación | Incluido | Incluido | Definido a detalle | Se mantiene, con radios y reglas específicas. |
| Interacciones previas para mejorar recomendaciones | Incluido | A alto nivel | Definido a detalle | El PRD lo aterriza mediante eventos y métricas. |
| Filtros de búsqueda | No aparece | Incluido | Definido a detalle | La propuesta lo incluye; el PRD lo amplía. |
| Búsqueda por texto libre | No aparece | A alto nivel | Definido a detalle | Nuevo nivel de detalle: zona, agente, inmobiliaria y código. |
| Búsquedas recientes | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Toggle lista / mapa en búsqueda | No aparece | A alto nivel | Definido a detalle | Se amplía la experiencia de búsqueda. |
| Feed con filtros rápidos | No aparece | A alto nivel | Definido a detalle | Nuevo comportamiento dentro del feed. |
| Radio progresivo del feed | No aparece | No aparece | Definido a detalle | Nuevo requerimiento de lógica de producto. |
| Regla para no saturar con videos de la misma propiedad | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |

### 5.5 Mapa

| Requerimiento / feature | Alineación inicial | Propuesta de desarrollo | PRD oficial | Lectura para cliente |
|-------------------------|--------------------|--------------------------|-------------|----------------------|
| Mapa de propiedades | No aparece | Incluido | Definido a detalle | Aparece en la propuesta y se desarrolla mucho más en el PRD. |
| Pins con ubicación exacta | No aparece | A alto nivel | Definido a detalle | El PRD toma una decisión clara: dirección exacta visible. |
| Clusters de propiedades cercanas | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Buscar zona o dirección dentro del mapa | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Botón "Buscar en esta zona" | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Tarjeta inferior al tocar un pin | No aparece | No aparece | Definido a detalle | Nuevo requerimiento de experiencia. |

### 5.6 Publicación de Propiedades

| Requerimiento / feature | Alineación inicial | Propuesta de desarrollo | PRD oficial | Lectura para cliente |
|-------------------------|--------------------|--------------------------|-------------|----------------------|
| Subir propiedades | Incluido | Incluido | Definido a detalle | Se mantiene, pero el PRD lo vuelve un flujo completo. |
| Wizard de publicación | No aparece | Incluido a alto nivel | Definido a detalle | El PRD define 5 pasos obligatorios. |
| Autoguardado de borradores | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Publicaciones en estado borrador | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Alta, baja y edición de publicaciones | No aparece | Incluido | Definido a detalle | La propuesta lo contempla; el PRD agrega reglas. |
| Cierre de propiedad como rentada o vendida | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Reapertura de propiedades cerradas | No aparece | No aparece | Post-MVP | Queda fuera del MVP. |
| Transferencia de propiedades entre agentes | No aparece | No aparece | Post-MVP | Queda fuera del MVP. |

### 5.7 Video

| Requerimiento / feature | Alineación inicial | Propuesta de desarrollo | PRD oficial | Lectura para cliente |
|-------------------------|--------------------|--------------------------|-------------|----------------------|
| Video como formato principal | Incluido | Incluido | Definido a detalle | Se mantiene desde el inicio. |
| Duración mínima y máxima de video | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Formato vertical obligatorio | A alto nivel | A alto nivel | Definido a detalle | El PRD lo vuelve regla explícita. |
| Múltiples videos por propiedad | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Subida resumible de video | No aparece | No aparece | Definido a detalle | Nuevo requerimiento técnico-operativo. |
| Procesamiento de video y aviso al usuario | No aparece | A alto nivel | Definido a detalle | El PRD agrega comportamiento esperado. |
| Selección de thumbnail | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Reemplazo y archivo de videos anteriores | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |

### 5.8 Moderación y Estados de Publicación

| Requerimiento / feature | Alineación inicial | Propuesta de desarrollo | PRD oficial | Lectura para cliente |
|-------------------------|--------------------|--------------------------|-------------|----------------------|
| Moderación de contenido | A alto nivel | Incluido | Definido a detalle | La propuesta lo contempla; el PRD lo vuelve proceso completo. |
| Revisión manual antes de publicar | No aparece | A alto nivel | Definido a detalle | Se formaliza como regla obligatoria. |
| Estados de publicación | No aparece | No aparece | Definido a detalle | Nuevo requerimiento grande: el PRD define 16 estados. |
| Pedir cambios con motivo | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Rechazo con motivo | No aparece | A alto nivel | Definido a detalle | Se vuelve regla operativa. |
| Re-revisión después de ciertos cambios | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Mantener versión publicada mientras se revisa una edición | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |

### 5.9 Pagos y Modelo Comercial

| Requerimiento / feature | Alineación inicial | Propuesta de desarrollo | PRD oficial | Lectura para cliente |
|-------------------------|--------------------|--------------------------|-------------|----------------------|
| Sistema de pagos | No aparece | Excluido expresamente | Definido para post-beta | Cambio relevante: la propuesta lo dejaba fuera del MVP. |
| Pago por video | No aparece | Excluido | Definido a detalle | Nuevo modelo comercial. |
| Plan premium de 1 mes | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Planes de agente de 3 y 6 meses | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Créditos o slots de publicación | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Caducidad de créditos no usados | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Stripe como pasarela | No aparece | Excluido | Definido para post-beta | Nuevo alcance preparado para activación futura. |
| Facturación CFDI | No aparece | No aparece | Post-MVP | Queda fuera del MVP. |

### 5.10 Contacto, Leads y CRM

| Requerimiento / feature | Alineación inicial | Propuesta de desarrollo | PRD oficial | Lectura para cliente |
|-------------------------|--------------------|--------------------------|-------------|----------------------|
| Contacto por WhatsApp | Incluido | Incluido | Definido a detalle | Se mantiene, con reglas más claras. |
| Mensaje prellenado de WhatsApp | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Registro de lead al tocar contacto | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| CRM para agentes | No aparece | No aparece | Definido a detalle | Nuevo módulo completo. |
| Puntaje automático de leads | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Estados del lead | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Notas internas del agente | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Exportación CSV de leads | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| WhatsApp Business API | No aparece | No aparece | Post-MVP | Queda fuera del MVP. |

### 5.11 Interacciones Sociales

| Requerimiento / feature | Alineación inicial | Propuesta de desarrollo | PRD oficial | Lectura para cliente |
|-------------------------|--------------------|--------------------------|-------------|----------------------|
| Likes | Incluido | Incluido | Definido a detalle | Se mantiene. |
| Guardados o favoritos | Incluido | Incluido | Definido a detalle | Se mantiene. |
| Historial de vistos visible al usuario | A alto nivel | Incluido | No incluido como pantalla visible | El PRD decide guardar eventos, pero no mostrar historial al usuario. |
| Comentarios | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Moderación de comentarios | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Follow a agentes | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Compartir videos con deep link | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Compartir perfil de agente | No aparece | No aparece | Post-MVP | Queda fuera del MVP. |

### 5.12 Notificaciones

| Requerimiento / feature | Alineación inicial | Propuesta de desarrollo | PRD oficial | Lectura para cliente |
|-------------------------|--------------------|--------------------------|-------------|----------------------|
| Notificaciones push | No aparece | No aparece | Definido a detalle | Nuevo módulo. |
| Centro de notificaciones dentro de la app | No aparece | No aparece | Definido a detalle | Nuevo módulo. |
| Notificaciones por aprobación, rechazo o cambios | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Notificaciones por leads nuevos | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Notificaciones por expiración de videos o créditos | No aparece | No aparece | Definido a detalle | Nuevo requerimiento ligado al modelo comercial. |
| Configuración de notificaciones por tipo | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |

### 5.13 Perfiles y Configuración

| Requerimiento / feature | Alineación inicial | Propuesta de desarrollo | PRD oficial | Lectura para cliente |
|-------------------------|--------------------|--------------------------|-------------|----------------------|
| Perfil de usuario | A alto nivel | Incluido | Definido a detalle | Se amplía por rol. |
| Perfil de agente | No aparece | A alto nivel | Definido a detalle | Nuevo nivel de detalle. |
| Badge de agente verificado | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Seguidores de agente | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Configuración de cuenta | No aparece | Incluido a alto nivel | Definido a detalle | El PRD agrega privacidad, preferencias, soporte y notificaciones. |
| Re-ejecutar onboarding desde configuración | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Eliminación de cuenta desde configuración | No aparece | No aparece | Definido a detalle | Nuevo requerimiento operativo y legal. |

### 5.14 Reportes, Seguridad y Privacidad

| Requerimiento / feature | Alineación inicial | Propuesta de desarrollo | PRD oficial | Lectura para cliente |
|-------------------------|--------------------|--------------------------|-------------|----------------------|
| Reportar propiedades | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Motivos predefinidos de reporte | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Suspensión automática por múltiples reportes | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Reportar perfiles | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Bloqueo entre usuarios | No aparece | No aparece | Post-MVP | Queda fuera del MVP. |
| Cumplimiento LFPDPPP | No aparece | No aparece | Definido a detalle | Nuevo requerimiento legal. |
| Ventana de gracia para eliminar cuenta | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Anonimización de datos | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |

### 5.15 Panel Administrativo

| Requerimiento / feature | Alineación inicial | Propuesta de desarrollo | PRD oficial | Lectura para cliente |
|-------------------------|--------------------|--------------------------|-------------|----------------------|
| Panel administrativo | A alto nivel | Incluido | Definido a detalle | Se amplía de forma importante. |
| Dashboard de métricas | A alto nivel | Incluido | Definido a detalle | Se mantiene y se precisa. |
| Moderación de publicaciones | A alto nivel | Incluido | Definido a detalle | Se mantiene y se amplía. |
| Moderación de comentarios | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Gestión de usuarios | A alto nivel | Incluido | Definido a detalle | Se amplía con roles, suspensiones y cambios manuales. |
| Gestión de inmobiliarias | A alto nivel | Incluido | Definido a detalle | Se amplía con aprobación y suspensión. |
| Gestión de invitaciones de beta | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Gestión de interesados a agente desde landing | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Configuración de catálogos y precios | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Auditoría de acciones de admin | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |

### 5.16 Métricas y Analítica

| Requerimiento / feature | Alineación inicial | Propuesta de desarrollo | PRD oficial | Lectura para cliente |
|-------------------------|--------------------|--------------------------|-------------|----------------------|
| Métricas básicas | A alto nivel | Incluido | Definido a detalle | Se mantiene y se amplía. |
| Vistas por publicación | A alto nivel | Incluido | Definido a detalle | Se define cómo se cuentan. |
| Likes, guardados y contactos | Incluido parcialmente | Incluido | Definido a detalle | Se mantiene. |
| Definición de video visto | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Video completado | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Gráficas por publicación | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |
| Métricas agregadas para agentes | No aparece | A alto nivel | Definido a detalle | Se amplía. |
| Eventos crudos para análisis futuro | No aparece | No aparece | Definido a detalle | Nuevo requerimiento. |

### 5.17 Elementos Preparados Para Futuro

| Requerimiento / feature | Alineación inicial | Propuesta de desarrollo | PRD oficial | Lectura para cliente |
|-------------------------|--------------------|--------------------------|-------------|----------------------|
| Virtual Open House | No aparece | No aparece | Post-MVP con arquitectura preparada | No se construye ahora, pero el PRD pide dejar base preparada. |
| Internacionalización | No aparece | No aparece | Preparado para futuro | MVP solo en español, pero con estructura lista para otros idiomas. |
| Ratings y reseñas | No aparece | No aparece | Post-MVP | Queda fuera del MVP. |
| Vista kanban del CRM | No aparece | No aparece | Post-MVP | Queda fuera del MVP. |
| Recordatorios programados en CRM | No aparece | No aparece | Post-MVP | Queda fuera del MVP. |

---

## 6. Requerimientos Nuevos Más Relevantes del PRD

Estos son los elementos que aparecen por primera vez o que crecen de forma significativa en el PRD:

| Área | Requerimientos nuevos o ampliados |
|------|-----------------------------------|
| Acceso y beta | Códigos de invitación, beta cerrada, verificación de correo, verificación de teléfono, aceptación versionada de términos y privacidad. |
| Roles | Usuario premium, agente independiente, agente bajo inmobiliaria, inmobiliaria como entidad organizacional, flujos de cambio de rol. |
| Publicación | Wizard de 5 pasos, borradores, subida resumible, selección de thumbnail, múltiples videos, estados de publicación y re-revisión. |
| Operación comercial | Pago por video, planes, créditos, vigencias, expiraciones, renovaciones y Stripe post-beta. |
| CRM | Leads, puntaje automático, estados, notas, historial de interacciones y exportación CSV. |
| Moderación | Estados de publicación, comentarios moderados, reportes, suspensión automática y motivos obligatorios. |
| Notificaciones | Centro in-app, push, preferencias por tipo y catálogo completo de eventos. |
| Web | Landing pública, deep links, página web para visitantes sin cuenta y formulario para interesados a agente. |
| Administración | Panel web avanzado, gestión de usuarios, inmobiliarias, beta, reportes, catálogos, precios y auditoría. |
| Privacidad y datos | Eliminación de cuenta, retención, anonimización, soft delete y cumplimiento LFPDPPP. |

---

## 7. Diferencias Clave Frente a la Propuesta

La propuesta de desarrollo sí contemplaba un MVP funcional con app móvil, backend, videos, mapa, registro, interacciones, contacto por WhatsApp, panel inmobiliario y panel administrativo.

El PRD actual agrega o amplía módulos que cambian el tamaño del proyecto:

| Tema | En la propuesta | En el PRD |
|------|-----------------|-----------|
| Pagos | Excluidos del MVP | Se define modelo de pagos por video, planes, créditos y Stripe post-beta. |
| CRM | No incluido | Se define CRM completo para agentes. |
| Notificaciones | No incluidas | Se define centro in-app, push y catálogo completo. |
| Roles | Usuario / inmobiliaria / admin a alto nivel | Se definen roles, permisos y transiciones detalladas. |
| Moderación | Panel y moderación general | Se define pipeline, estados, motivos, re-revisión y auditoría. |
| Landing | No incluida | Se define landing pública y captación de interesados. |
| Deep links | No incluidos | Se define experiencia web para videos compartidos. |
| Cumplimiento y privacidad | No detallado | Se define consentimiento, eliminación, retención y anonimización. |
| Métricas | Métricas básicas | Se define medición detallada de video, publicaciones, agentes y eventos. |

---

## 8. Lectura General del Cambio de Alcance

| Nivel | Documento | Qué tan listo estaba para construir |
|-------|-----------|-------------------------------------|
| Idea | `Alineacion.md` | Servía para entender la oportunidad, pero no para desarrollar directamente. |
| MVP cotizado | `docs/propuesta-desarrollo-mvp.md` | Servía para construir una primera versión funcional con alcance controlado. |
| Producto operativo | `PRD.md` | Sirve para construir una plataforma más completa, con reglas de operación, monetización, soporte administrativo y preparación para crecimiento. |

En términos prácticos, el PRD actual describe un producto más maduro que el MVP originalmente planteado. Eso es positivo para la claridad del producto, pero requiere una conversación de alineación para decidir qué se construye primero, qué se deja para fases posteriores y qué impacto tiene eso en tiempo y presupuesto.

---

## 9. Recomendación Para la Conversación

La conversación con el cliente puede plantearse de forma sencilla:

> La idea inicial y la propuesta nos dieron una base clara para un MVP. Durante la definición del PRD, el producto creció y hoy tenemos una visión mucho más completa. Para avanzar bien, necesitamos decidir si construiremos el alcance original, el PRD completo o una versión por fases que permita lanzar primero y evolucionar después.

Opciones razonables:

| Opción | Qué significa | Ventaja |
|--------|---------------|---------|
| MVP original | Construir lo incluido en la propuesta y dejar el resto como roadmap. | Permite avanzar con menor riesgo y validar antes de ampliar. |
| MVP intermedio | Incluir algunos elementos nuevos del PRD que sean críticos para negocio. | Balancea validación con una base comercial más fuerte. |
| PRD completo | Construir todo lo definido actualmente. | Entrega una plataforma más robusta, pero requiere ajustar alcance, tiempo y presupuesto. |
| Desarrollo por fases | Dividir el PRD en entregas sucesivas. | Mantiene claridad, control de inversión y aprendizaje por etapas. |

---

## 10. Conclusión

Urbea evolucionó de una idea de descubrimiento inmobiliario con video a una plataforma con operación, administración, monetización, CRM, moderación, notificaciones y métricas.

El PRD actual es valioso porque elimina ambigüedades y define mejor el producto. Al mismo tiempo, deja claro que el alcance actual supera lo descrito en la alineación inicial y también supera varios puntos de la propuesta de desarrollo.

Antes de iniciar o continuar el desarrollo, conviene acordar por escrito qué partes del PRD entran en la primera entrega y cuáles pasan a fases posteriores. Esto permite proteger el presupuesto del cliente, la calidad del producto y la viabilidad del desarrollo.
