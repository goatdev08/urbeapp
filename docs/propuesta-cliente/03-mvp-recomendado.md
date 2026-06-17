# MVP recomendado

### Una versión simplificada de Urbea para arrancar bien, dentro del alcance cotizado y con mejor posición competitiva

| Campo | Valor |
|-------|-------|
| Documento | Propuesta de MVP simplificado |
| Versión | 1.0 |
| Fecha | Mayo de 2026 |
| Audiencia | Dirección de Urbea |
| Propósito | Proponer una versión simplificada del MVP que cumple con el alcance cotizado en marzo, compite mejor en el mercado, reduce el riesgo de lanzamiento, y deja la visión completa del PRD como **roadmap a futuro** para construir por fases. |

---

## Índice

1. [Por qué simplificar el MVP](#1-por-qué-simplificar-el-mvp)
2. [La filosofía detrás del MVP recomendado](#2-la-filosofía-detrás-del-mvp-recomendado)
3. [Qué incluye el MVP recomendado](#3-qué-incluye-el-mvp-recomendado)
4. [Qué se difiere a fases posteriores y por qué](#4-qué-se-difiere-a-fases-posteriores-y-por-qué)
5. [Cómo este MVP compite mejor](#5-cómo-este-mvp-compite-mejor)
6. [Comparativa rápida: PRD completo vs MVP recomendado](#6-comparativa-rápida-prd-completo-vs-mvp-recomendado)
7. [Roadmap por fases](#7-roadmap-por-fases)
8. [Cómo encaja esto con el contrato actual](#8-cómo-encaja-esto-con-el-contrato-actual)
9. [Decisión que propongo](#9-decisión-que-propongo)

---

## 1. Por qué simplificar el MVP

El PRD que cerramos juntos es un excelente documento de producto. Pero como te compartí en los documentos anteriores, **el PRD describe el producto final, no el producto con el que conviene salir al mercado**.

Hay tres razones por las cuales **simplificar el MVP es la decisión correcta**:

### Razón 1: Encaja en el contrato actual

El MVP recomendado **se ajusta al alcance cotizado en marzo** ($120,000 MXN, ~17 semanas con un solo desarrollador en stack Supabase). Esto te permite arrancar el proyecto sin necesidad de inversión adicional inmediata y honrando el acuerdo vigente.

### Razón 2: Reduce el riesgo de lanzamiento

Construir todo el PRD antes de tener un solo usuario activo es **invertir 8-10 meses y varios cientos de miles de pesos en hipótesis sin validar**. Si después resulta que el modelo de negocio necesita ajustes (cosa muy probable, ver el documento `02-analisis-de-mercado-y-modelo-de-negocio.md`), gran parte del esfuerzo de desarrollo queda obsoleto.

Un MVP enfocado **te permite lanzar en 4 meses**, validar con usuarios reales, y luego construir las siguientes fases con base en datos, no en suposiciones.

### Razón 3: Compite mejor en el mercado

La versión simplificada que te propongo **prioriza features que son diferenciadores reales** contra Inmuebles24, Vivanuncios, Instagram y TikTok. La versión del PRD invierte mucho esfuerzo en infraestructura administrativa interna (auditoría inmutable, 16 estados de publicación, sistema de tokens, etc.) que **no genera valor visible para el usuario final** en el lanzamiento.

---

## 2. La filosofía detrás del MVP recomendado

El MVP recomendado se construye sobre tres principios:

### Principio 1: Simple para el usuario, robusto por dentro

El usuario final ve una app limpia y rápida. La arquitectura interna está diseñada para crecer sin necesidad de reescritura, pero **no implementamos en el MVP toda la infraestructura administrativa** que solo aportará valor cuando la plataforma tenga miles de usuarios y cientos de agentes.

### Principio 2: Resolver el cold start antes que la monetización

El lanzamiento se hace **sin sistema de pagos integrado**. Todos los agentes y usuarios usan la app gratis los primeros 6 meses. Esto resuelve el problema del huevo y la gallina explicado en el documento `02-analisis-de-mercado-y-modelo-de-negocio.md`. Cuando haya tracción demostrada, se construye el módulo de pagos.

### Principio 3: Diferenciadores claros vs commodities

Cada feature del MVP responde a la pregunta: *"¿esto me hace diferente de Inmuebles24 e Instagram, o es lo mismo que ellos?"* Si es lo mismo, se simplifica; si es diferenciador, se invierte bien en él.

---

## 3. Qué incluye el MVP recomendado

A continuación, la lista completa de funcionalidades del MVP recomendado, agrupadas por experiencia.

### 3.1 Para los usuarios buscadores

| Funcionalidad | Por qué la incluyo |
|---------------|---------------------|
| Registro con email y password + Google + Apple | Necesario para personalizar y permitir contacto. |
| Onboarding simple (ubicación + tipo de operación + presupuesto) | Mejora la calidad de las recomendaciones. |
| Feed vertical de videos tipo TikTok | Diferenciador central del producto. |
| Mapa de propiedades con dirección exacta | Diferenciador vs. Inmuebles24 que muestra ubicaciones aproximadas. |
| Búsqueda con filtros básicos (operación, tipo, precio, recámaras, baños, zona) | Funcionalidad esperada del usuario. |
| Like y guardar propiedades | Engagement y retención. |
| Contacto vía WhatsApp con mensaje pre-llenado | Funnel de conversión principal. |
| Compartir video con deep link a página web | Crecimiento orgánico. |
| Notificaciones in-app básicas (no push aún) | Retención sin complejidad técnica de FCM. |

### 3.2 Para los agentes (publicadores)

| Funcionalidad | Por qué la incluyo |
|---------------|---------------------|
| Registro como agente con verificación de identidad (INE + selfie) | Anti-fraude desde el día 1. |
| Wizard de publicación simplificado (3 pasos en vez de 5) | Reduce fricción de oferta. |
| Subida de video con tamaño máximo (500 MB) | Necesario. |
| Procesamiento en background con notificación al terminar | Buena UX. |
| Hasta 5 videos por propiedad | Permite mostrar mejor cada propiedad. |
| Mis publicaciones (alta, edición, marcar como vendida/rentada) | Gestión básica. |
| Vista básica de leads (lista cronológica, sin scoring automático) | Permite operar al agente desde el día 1. |
| Datos del lead visibles tras contacto (nombre, teléfono, propiedades vistas) | Valor diferencial central. |

### 3.3 Para los administradores

| Funcionalidad | Por qué la incluyo |
|---------------|---------------------|
| Panel administrativo web mínimo (Next.js) | Permite moderar y operar. |
| Cola de moderación de publicaciones (aprobar, rechazar con motivo) | Calidad de catálogo. |
| Gestión básica de usuarios (suspender, reactivar) | Operación esencial. |
| Cola simple de reportes (todos manuales, sin suspensión automática) | Suficiente para volumen MVP. |
| Aprobación de cuentas de agente | Anti-fraude. |
| Dashboard con métricas globales básicas | Monitoreo del negocio. |

### 3.4 Para la marca y captación

| Funcionalidad | Por qué la incluyo |
|---------------|---------------------|
| Landing web mínima (1 sola página) | Necesaria para campañas de marketing. |
| Página de destino para videos compartidos vía deep link | Crecimiento orgánico viral. |
| Formulario simple de "Quiero ser agente" | Captación de oferta. |

### 3.5 Decisiones de modelo de negocio para el MVP

- **Sin sistema de pagos integrado en el MVP**. La app es gratis para todos durante los primeros 6 meses post-lanzamiento.
- **Sin planes de precios visibles en la app**. Esto se diseñará y construirá en la Fase 2, cuando haya datos.
- **Sin beta cerrada con códigos**. Lanzamiento abierto pero geo-restringido a Guadalajara metropolitana.

---

## 4. Qué se difiere a fases posteriores y por qué

Esto **no significa que se elimine**. Significa que se construye **después**, cuando el producto haya validado las hipótesis básicas con usuarios reales. Cada elemento aquí queda documentado en el PRD largo como visión a futuro.

### Diferido a Fase 2 (post-validación, mes 6-9)

| Funcionalidad | Por qué se difiere |
|---------------|---------------------|
| Sistema de pagos con Stripe y planes comerciales | No se sabe aún cuánto cobrar; se valida con datos primero. |
| Notificaciones push (FCM + APNs) | Las in-app son suficientes para retener a los primeros usuarios. |
| CRM con scoring automático de leads | Requiere volumen de leads para tener sentido. |
| Sistema completo de 5 roles | Mientras no haya monetización ni inmobiliarias formales, 3 roles bastan. |
| Distinción agente bajo inmobiliaria vs independiente con flujos separados | Simplificar a "agente verificado" en MVP. |
| Sistema de tokens de invitación de inmobiliarias | No hay inmobiliarias formales aún. |

### Diferido a Fase 3 (operación madura, mes 9-12)

| Funcionalidad | Por qué se difiere |
|---------------|---------------------|
| Catálogo completo de 19 tipos de notificaciones push | Se construye en bloque cuando se priorice retención avanzada. |
| Suspensión automática a 3 reportes en 24 h | El admin manual es suficiente para volumen inicial. |
| Auditoría inmutable extensiva | El log básico es suficiente para volumen inicial. |
| Versionado de publicaciones durante re-revisión | Re-aprobación manual sin versionado complejo basta al inicio. |
| Caducidad automática y renovación de publicaciones | Como no hay pagos, la publicación dura hasta que el agente la cierre. |
| Exportación de leads por inmobiliaria al darse de baja un agente | Solo aplica cuando haya inmobiliarias formalmente. |

### Diferido a Fase 4+ (diferenciación competitiva real)

Estas son features que **propongo agregar en fases avanzadas** porque son los verdaderos diferenciadores que harán a Urbea destacar. **No están en el PRD actual** y son aportes de la visión que comparto.

| Funcionalidad | Valor diferencial |
|---------------|--------------------|
| Saved searches con alertas push | Retención. Ningún competidor lo hace bien en MX. |
| Match score Tinder-style (propiedad X tiene 87% de compatibilidad contigo) | Engagement. Único en el mercado mexicano. |
| Comparador de propiedades lado a lado | Conversión a contacto. Pocos lo tienen. |
| Verificación de propiedades en sitio (badge "Verificada por Urbea") | Anti-fraude. Diferenciador enorme en MX. |
| Datos enriquecidos de barrio (escuelas, transporte, seguridad, walkability) | Lo que Zillow tiene en EEUU y nadie en MX. |
| Audio voiceover del agente sobre el video | Humaniza el listing, aumenta conversión. |
| Reviews y rating de agentes | Trust real post-cierre. |
| Tour físico agendado dentro de la app | Captura la conversión más valiosa del funnel. |
| Calculadora de hipoteca integrada con bancos | Nuevo revenue stream (comisión por lead a bancos). |
| VOH (Virtual Open House) | Streaming en vivo, ya estaba post-MVP en el PRD original. |

### Diferido como decisión de modelo

| Decisión | Razón de aplazamiento |
|----------|------------------------|
| Facturación CFDI | No es necesaria mientras no haya pagos. |
| Cumplimiento LFPDPPP detallado y soft delete sistemático con retención por tipo | Implementación básica suficiente en MVP; el detalle completo se construye en Fase 3. |
| Bloqueo entre usuarios | Conflicto principal ocurre en WhatsApp, donde WhatsApp ya tiene su propio bloqueo. |
| Transferencia de propiedades entre agentes | No aplica mientras no haya inmobiliarias formales. |
| Reapertura de propiedades cerradas | Se publican nuevamente como nueva entrada. |

---

## 5. Cómo este MVP compite mejor

El PRD completo invierte mucho esfuerzo en infraestructura administrativa (auditoría inmutable, versionado de publicaciones, suspensión automática, tokens, etc.). Esto es valioso **cuando ya tienes volumen**, pero **no diferencia tu producto** frente a competidores al lanzamiento.

El MVP recomendado redistribuye ese esfuerzo hacia features que **el usuario final ve y valora**.

### Comparativa de ventajas competitivas al lanzamiento

| Capacidad | Inmuebles24 | Instagram | PRD completo | MVP recomendado |
|-----------|:-----------:|:---------:|:------------:|:---------------:|
| Feed vertical de video | No | Sí | Sí | Sí |
| Dirección exacta de propiedades | No (aproximada) | Sí (manual) | Sí | Sí |
| Mapa con clustering | Sí | No | Sí | Sí |
| Búsqueda con filtros estructurados | Sí | No | Sí | Sí |
| Filtros nicho (pet-friendly, sin aval, estudiantes) | Limitado | No | No | **Sí (lo agrego)** |
| Vista básica de leads para agente | No | No | Sí (con scoring) | Sí (sin scoring) |
| Verificación de identidad de agente | No | No | No | **Sí (lo agrego)** |
| Compartir vía deep link | Sí | Sí | Sí | Sí |
| Cero costo para empezar (agente y usuario) | No | Sí | No (cobra por video) | **Sí** |
| Lanzamiento abierto sin códigos | Sí | Sí | No (beta cerrada) | **Sí** |

El MVP recomendado **gana en simplicidad de adopción** (gratis y abierto) y **mantiene los diferenciadores reales** (video, mapa con dirección exacta, contacto directo, vista de leads básica). Eso es lo que necesita un producto nuevo en el mercado para tener oportunidad de tracción.

---

## 6. Comparativa rápida: PRD completo vs MVP recomendado

| Dimensión | PRD completo | MVP recomendado |
|-----------|:------------:|:---------------:|
| Tiempo de desarrollo (1 dev) | 10-13 meses | 4 meses |
| Costo de desarrollo estimado | $400,000-$700,000 MXN | $120,000 MXN (alcance cotizado) |
| Roles de usuario | 5 + entidad inmobiliaria | 3 (usuario, agente, admin) |
| Pasos del wizard de publicación | 5 | 3 |
| Estados de publicación | 16 | 6 |
| Sistema de pagos | Sí (Stripe) | No (gratis durante 6 meses) |
| CRM con scoring automático | Sí | No (lista cronológica) |
| Notificaciones push | Sí (19 tipos) | No (solo in-app) |
| Landing en Astro multi-sección | Sí | No (1 página simple) |
| Beta cerrada con códigos | Sí | No (lanzamiento abierto GDL) |
| Auditoría inmutable | Sí | No (log básico) |
| Versionado de publicaciones | Sí | No (re-aprobación simple) |
| Posicionamiento competitivo al lanzamiento | Pesado pero sin diferenciadores visibles | Liviano con diferenciadores claros |
| Riesgo financiero | Alto (gran inversión antes de validar) | Bajo (inversión limitada a lo cotizado) |
| Capacidad de pivotar tras validar | Limitada (mucho ya construido) | Alta (cada fase se cotiza después) |

---

## 7. Roadmap por fases

El MVP es solo la **Fase 1**. El PRD completo se construye en fases siguientes, **siempre y cuando el MVP demuestre tracción** que justifique la inversión.

### Fase 1: MVP (mes 0-4)

- Construcción del MVP recomendado descrito en este documento.
- Costo: $120,000 MXN (alcance del contrato actual).
- Resultado: app funcional en App Store y Play Store, lista para soft launch.

### Fase 2: Bootstrap y validación (mes 4-9)

- Marketing + onboarding manual de los primeros 50 agentes.
- Recolección de métricas de tracción.
- Sin desarrollo adicional grande; solo ajustes menores en función de feedback real.
- Inversión en marketing: $15,000-$25,000 MXN/mes.
- Decisión al final de la fase: **¿hay tracción real?**
  - Sí → continuar con Fase 3.
  - No → ajustar modelo o iterar.

### Fase 3: Monetización inicial (mes 9-12)

- Construcción del módulo de pagos (Stripe).
- Sistema de suscripción Pro para agentes con más de 3 propiedades.
- Estimación: ~6-8 semanas de desarrollo.
- Cotización separada al inicio de esta fase.

### Fase 4: CRM completo y notificaciones push (mes 12-15)

- CRM con scoring automático.
- Notificaciones push (FCM/APNs) con catálogo de tipos.
- Estimación: ~6-10 semanas de desarrollo.
- Cotización separada.

### Fase 5: Diferenciadores competitivos (mes 15-21)

- Match score personalizado.
- Saved searches con alertas.
- Verificación de propiedades en sitio.
- Datos de barrio enriquecidos.
- Reviews de agentes.
- Estimación: ~12-16 semanas de desarrollo (puede paralelizarse).
- Cotización separada.

### Fase 6: Expansión y monetización avanzada (año 2)

- Expansión a otra ciudad (CDMX, Monterrey, etc.).
- VOH (streaming).
- Tours físicos agendados en app.
- Calculadora de hipoteca + integración con bancos.
- Modelo de comisión sobre transacción cerrada.
- Cotización separada.

---

## 8. Cómo encaja esto con el contrato actual

El MVP recomendado **encaja exactamente** en el alcance cotizado en marzo:

- **Precio:** $120,000 MXN (sin cambios).
- **Plazo:** ~14-16 semanas (ligeramente menor a las 17 originales, gracias al stack Supabase y a la simplificación de scope).
- **Entregables:** app iOS + app Android publicadas en tiendas, panel admin web, landing mínima, base de datos configurada.

Tu primer pago ya recibido cubre la mitad del trabajo del MVP. El segundo pago se libera al cierre de la fase, según el esquema original.

**Las fases 2 en adelante se cotizan por separado cuando estés listo para iniciarlas.** Esto te da máximo control financiero y máxima flexibilidad para decidir hasta dónde llegar.

---

## 9. Decisión que propongo

Te propongo formalmente lo siguiente:

### Para la Fase 1 (vigente)

- Construyo el **MVP recomendado descrito en este documento**.
- Respeto el contrato actual: $120,000 MXN, ~14-16 semanas, entregables completos.
- Firmamos una **adenda al contrato actual** donde queda documentado que la Fase 1 corresponde al alcance de este documento y que el resto del PRD queda como roadmap a fases siguientes.

### Para las fases posteriores

- Cada fase se cotiza al iniciarla, con scope cerrado y precio cerrado.
- No hay compromiso de avanzar a la siguiente fase hasta que tú lo decidas.
- Si en cualquier momento decides cambiar de proveedor de desarrollo o asumir el proyecto internamente, **te dejo toda la documentación y el código limpio para que puedas continuar sin mi**.

### Lo que te llevas con esta propuesta

1. Un MVP funcional, técnicamente sólido y con diferenciadores reales **en 4 meses, dentro de presupuesto**.
2. Un PRD completo que sirve como **roadmap a largo plazo** del producto.
3. Un análisis de mercado y modelo de negocio que **te protege de quemarte con un modelo no validado**.
4. Flexibilidad total para decidir cómo y cuándo invertir en cada fase siguiente.

---

## Para cerrar

Lo más importante que quiero que te lleves de este documento es esto: **simplificar el MVP no es un retroceso, es una decisión estratégica que aumenta la probabilidad de éxito del proyecto** y reduce el riesgo financiero.

El PRD que cerramos juntos sigue vivo: es la visión completa del producto. Lo que cambiamos es **el orden y los tiempos** en que construimos las piezas, priorizando lo que el mercado necesita ver primero.

Estoy convencido de que esta es la forma más responsable de arrancar el desarrollo. Pero la decisión final es tuya. Si decides ir por el PRD completo desde el día 1, te apoyo en buscar la forma de hacerlo viable (cotización ajustada, plazos más largos, etc.). Y si decides ir por el MVP recomendado, arrancamos esta semana misma con todo lo que tenemos planeado.

Quedo atento a tus comentarios. Cuando estés listo, agendamos una llamada para revisar este documento junto con los otros dos que entrego en paralelo (`01-comparativa-de-alcance.md` y `02-analisis-de-mercado-y-modelo-de-negocio.md`).

Gracias por la confianza.
