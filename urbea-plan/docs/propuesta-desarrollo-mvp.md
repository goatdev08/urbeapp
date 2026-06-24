# Propuesta de Desarrollo

## Plataforma Inmobiliaria con Video

---

**Fecha:** 10 de Marzo de 2026
**Ubicación:** Guadalajara, Jalisco
**Versión:** 1.2

---

## 1. Resumen

Esta propuesta presenta el plan de desarrollo para una plataforma móvil de búsqueda de propiedades en alquiler, diferenciada por el uso de video como formato principal de presentación y un sistema de filtros inteligentes basado en ubicación y preferencias del usuario.

El proyecto contempla el desarrollo de una aplicación móvil para Android e iOS, con un backend en la nube, sistema de gestión de videos y paneles administrativos tanto para inmobiliarias como para administradores de la plataforma.

---

## 2. Alcance del MVP

### Funcionalidades Incluidas

| Módulo | Funcionalidades |
|--------|-----------------|
| **Aplicación Móvil** | iOS y Android |
| **Catálogo de Propiedades** | Lista con filtros, búsqueda, ordenamiento por cercanía |
| **Sistema de Video** | Reproducción de videos asociados a cada propiedad |
| **Mapa Interactivo** | Visualización de propiedades por ubicación |
| **Registro de Usuarios** | Correo electrónico y redes sociales |
| **Interacciones** | Likes, favoritos, historial de vistos |
| **Contacto Directo** | Integración con WhatsApp |
| **Panel Inmobiliaria** | Publicación y gestión de propiedades |
| **Panel Administración** | Métricas, moderación, gestión de usuarios |

### Funcionalidades NO Incluidas en MVP

- Publicidad integrada
- Algoritmos avanzados de inteligencia artificial
- Chat interno entre usuarios y agentes
- Sistema de pagos/transacciones
- Versión web completa (solo app móvil)
---

## 3. Arquitectura Técnica

### Stack Tecnológico

| Componente | Tecnología | Justificación |
|------------|------------|---------------|
| **App Móvil** | React Native + Expo | Código único para iOS y Android |
| **Backend** | Supabase | Base de datos, autenticación, APIs |
| **Almacenamiento** | Cloudflare R2 | Fotos y archivos estáticos |
| **Video Streaming** | Cloudflare Stream | Procesamiento y entrega de video |
| **Mapas** | Google Maps API | Geolocalización y visualización |
| **Analytics** | Firebase Analytics | Métricas de uso |

### Diagrama de Arquitectura

```
+-------------------------------------------------------------+
|                      USUARIOS                               |
|            (iOS / Android / Inmobiliarias)                  |
+-------------------------+-----------------------------------+
                          |
                          v
+-------------------------------------------------------------+
|                   APLICACIÓN MÓVIL                          |
|                  (React Native + Expo)                      |
+-------------------------+-----------------------------------+
                          |
          +---------------+---------------+
          v               v               v
+-------------+   +-------------+   +-------------+
|  Supabase   |   | Cloudflare  |   |   Google    |
|  (Backend)  |   |  (Videos)   |   |   Maps      |
|             |   |             |   |             |
| * Auth      |   | * Stream    |   | * Mapas     |
| * Database  |   | * R2 Storage|   | * Geocoding |
| * APIs      |   | * CDN       |   |             |
+-------------+   +-------------+   +-------------+
```

---

## 4. Plan de Desarrollo

### Metodología

- **Enfoque:** Desarrollo paralelo (Frontend + Backend) iterativo por fases
- **Duración total:** 17 semanas
- **Entregables:** Avances funcionales al final de cada fase

---

### FASE 1: Setup e Infraestructura Base
**Duración: 2 semanas (Semanas 1-2)**

| Track | Tarea | Tiempo Estimado |
|-------|-------|-----------------|
| **Backend** | Configuración de Supabase (DB, Auth, Storage), Cloudflare (R2, Stream) y diseño de esquema DB inicial. | 2 semanas |
| **Frontend** | Configuración de React Native + Expo, estructura de navegación, diseño base (UI Kit). | 2 semanas |

**Entregable:** Infraestructura lista y aplicación base corriendo ("Hello World" con navegación).

---

### FASE 2: Autenticación y Gestión de Usuarios
**Duración: 2 semanas (Semanas 3-4)**

| Track | Tarea | Tiempo Estimado |
|-------|-------|-----------------|
| **Backend** | Políticas de seguridad (RLS), Triggers de creación de usuarios, Endpoints de perfil. | 2 semanas |
| **Frontend** | Pantallas de Login/Registro, Integración Social Auth, Perfil de usuario, Edición de datos. | 2 semanas |

**Entregable:** Usuarios pueden registrarse, loguearse y editar su perfil.

---

### FASE 3: Gestión de Propiedades (Inmobiliaria)
**Duración: 3 semanas (Semanas 5-7)**

| Track | Tarea | Tiempo Estimado |
|-------|-------|-----------------|
| **Backend** | CRUD de propiedades, Lógica de subida de archivos (sólo backend), Webhooks de procesamiento de video. | 3 semanas |
| **Frontend** | Flujo de publicación de propiedad ("Wizard"), Selección de fotos/videos, Gestión de "Mis Propiedades". | 3 semanas |

**Entregable:** Inmobiliarias pueden crear, editar y subir contenido multimedia de propiedades.

---

### FASE 4: Catálogo y Búsqueda Avanzada
**Duración: 3 semanas (Semanas 8-10)**

| Track | Tarea | Tiempo Estimado |
|-------|-------|-----------------|
| **Backend** | Optimización de queries de búsqueda (filtros compuestos), Índices geoespaciales (PostGIS). | 3 semanas |
| **Frontend** | Feed principal, UI de filtros avanzados, Integración de Mapa (Google Maps) con marcadores. | 3 semanas |

**Entregable:** Usuarios pueden buscar propiedades por filtros y mapa.

---

### FASE 5: Detalle de Propiedad e Interacciones
**Duración: 2 semanas (Semanas 11-12)**

| Track | Tarea | Tiempo Estimado |
|-------|-------|-----------------|
| **Backend** | Endpoints de detalles, Lógica de favoritos/likes, Historial de visitas. | 2 semanas |
| **Frontend** | Pantalla de detalle inmersiva, Reproductor de video optimizado, Botón WhatsApp, Lista de Favoritos. | 2 semanas |

**Entregable:** Experiencia de visualización completa e interacciones sociales.

---

### FASE 6: Panel Administrativo y Moderación
**Duración: 2 semanas (Semanas 13-14)**

| Track | Tarea | Tiempo Estimado |
|-------|-------|-----------------|
| **Backend** | Endpoints de métricas, Dashboard de administración, Herramientas de moderación de contenido. | 2 semanas |
| **Frontend** | Panel de administración (Vistas de aprobación/rechazo, Lista de usuarios/inmobiliarias). | 2 semanas |

**Entregable:** Sistema de administración funcional para controlar la plataforma.

---

### FASE 7: Testing Integral y QA
**Duración: 2 semanas (Semanas 15-16)**

| Track | Tarea | Tiempo Estimado |
|-------|-------|-----------------|
| **Backend** | Tests de carga, Auditoría de seguridad (RLS), Optimización de queries. | 2 semanas |
| **Frontend** | Testing en dispositivos reales (iOS/Android), Corrección de estilos, Casos borde. | 2 semanas |

**Entregable:** Aplicación pulida y libre de errores críticos.

---

### FASE 8: Lanzamiento y Despliegue
**Duración: 1 semana (Semana 17)**

| Track | Tarea | Tiempo Estimado |
|-------|-------|-----------------|
| **Backend** | Migración a producción, Configuración final de entorno productivo. | 1 semana |
| **Frontend** | Generación de builds, Configuración de tiendas (Play Store/App Store), Assets de marketing. | 1 semana |

**Entregable:** Apps en revisión en las tiendas.

---

### Resumen del Cronograma

| Fase | Duración | Semanas |
|------|----------|---------|
| 1. Setup e Infraestructura | 2 semanas | Semanas 1-2 |
| 2. Autenticación | 2 semanas | Semanas 3-4 |
| 3. Gestión Propiedades | 3 semanas | Semanas 5-7 |
| 4. Catálogo y Búsqueda | 3 semanas | Semanas 8-10 |
| 5. Detalle e Interacciones | 2 semanas | Semanas 11-12 |
| 6. Panel Admin | 2 semanas | Semanas 13-14 |
| 7. Testing y QA | 2 semanas | Semanas 15-16 |
| 8. Lanzamiento | 1 semana | Semana 17 |
| **TOTAL** | **17 semanas** | |

---

## 5. Costos del Proyecto

### A. Costo de Desarrollo

| Concepto | Monto |
|----------|-------|
| **Desarrollo del MVP completo** | **$120,000 MXN** |

**Desglose por área:**

| Área | Costo Asignado |
|------|----------------|
| **Desarrollo Backend** | $70,000 MXN |
| **Desarrollo Frontend** | $50,000 MXN |

**Esquema de pagos sugerido:**

| Pago | Momento | Monto Total | Apartados |
|------|---------|-------------|-----------|
| **Pago 1** | Inicio del proyecto | $60,000 MXN (50%) | $35,000 MXN (Backend), $25,000 MXN (Frontend) |
| **Pago 2** | Entrega final y publicación | $60,000 MXN (50%) | $35,000 MXN (Backend), $25,000 MXN (Frontend) |

---

### B. Costos de Licencias (Pago Único/Anual)

| Concepto | Costo | Frecuencia |
|----------|-------|------------|
| Apple Developer Program | $99 USD | Anual |
| Google Play Console | $25 USD | Único (pago de por vida) |
| Dominio .com | Estimado $15 USD (depende del dominio) | Anual |
| **Total licencias Año 1** | **~$139 USD** | |

---

### C. Costos Operativos Mensuales

> Todos los costos operativos están expresados en **dólares estadounidenses (USD)**.

#### Detalles de precios por servicio

**Supabase Pro:** $25 USD/mes fijo. Incluye base de datos, autenticación y APIs.

**Cloudflare Stream Bundle (Starter):** $5 USD/mes. Incluye:
- Almacenamiento de imágenes: hasta 100,000 imágenes almacenadas
- Entrega de imágenes: hasta 500,000 imágenes entregadas por mes
- Transformaciones únicas: hasta 5,000 por mes
- Video almacenado: hasta 1,000 minutos
- Video entregado: hasta 5,000 minutos por mes

Costos adicionales al superar los límites incluidos:
- $5 USD por cada 1,000 minutos adicionales de video almacenado
- $1 USD por cada 1,000 minutos adicionales de video entregado
- $5 USD por cada 100,000 imágenes adicionales almacenadas
- $1 USD por cada 100,000 imágenes adicionales entregadas
- $0.50 USD por cada 1,000 transformaciones únicas adicionales (para imágenes almacenadas fuera de Cloudflare Images)

---

#### Escenario: Lanzamiento (0-500 usuarios)

| Servicio | Plan | Costo Mensual |
|----------|------|---------------|
| Supabase | Pro | $25.00 USD |
| Cloudflare Stream Bundle | Starter (incluye Images + Stream) | $5.00 USD |
| Google Maps API | Free Tier | $0.00 USD |
| Firebase Analytics | Free | $0.00 USD |
| **Total mensual estimado** | | **~$30 USD** |

> En este escenario los límites incluidos en el plan Starter de Cloudflare son suficientes. Solo habrá costo adicional si se superan las 1,000 minutos de video almacenado, 5,000 minutos de video entregado o los umbrales de imágenes.

---

#### Escenario: Crecimiento (500-2,000 usuarios)

| Servicio | Plan | Costo Mensual |
|----------|------|---------------|
| Supabase | Pro | $25.00 USD |
| Cloudflare Stream Bundle | Starter + excedentes estimados | $15 - $40 USD |
| Google Maps API | Free Tier | $0.00 USD |
| Monitoreo (Sentry) | Team | ~$26 USD |
| **Total mensual estimado** | | **~$66 - $91 USD** |

> Los excedentes de Cloudflare dependen del volumen real de videos publicados y reproducidos. Ejemplo: 5,000 minutos adicionales de video entregado = $5 USD extra.

---

#### Escenario: Escalado (2,000-10,000 usuarios)

| Servicio | Plan | Costo Mensual |
|----------|------|---------------|
| Supabase | Pro + Compute adicional | $50 - $75 USD |
| Cloudflare Stream Bundle | Starter + excedentes significativos | $50 - $150 USD |
| Google Maps API | Paid Tier | $50 - $100 USD |
| Monitoreo (Sentry) | Team | ~$26 USD |
| **Total mensual estimado** | | **~$176 - $351 USD** |

> En este escenario se recomienda revisar el uso mensual de Cloudflare Stream para optimizar costos (por ejemplo, eliminar videos inactivos o comprimir antes de subir).

---

### D. Planes de Soporte y Mantenimiento

Una vez finalizado el desarrollo del MVP y transcurridos los 30 días de garantía incluidos, se ofrecen los siguientes planes de soporte continuo:

#### Plan Básico - "Mantenimiento Esencial"
**$3,500 MXN/mes**

| Incluye |
|---------|
| Corrección de bugs críticos (errores que impiden usar la app) |
| Monitoreo básico semanal de errores reportados |
| Tiempo de respuesta: 24-48 horas hábiles |
| Actualizaciones de seguridad (parches críticos) |

**Ideal para:** Fase de lanzamiento con pocos usuarios.

---

#### Plan Estándar - "Soporte Activo" (*) Recomendado
**$6,000 MXN/mes**

| Incluye |
|---------|
| Todo lo del Plan Básico |
| Corrección de bugs menores (errores de UX, visuales) |
| Actualizaciones de dependencias (React Native, Expo, librerías) |
| Optimizaciones menores de rendimiento |
| Tiempo de respuesta: 24-48 horas hábiles |
| Reporte mensual de estado de la app y métricas |
| Compatibilidad con nuevas versiones de iOS/Android |

**Ideal para:** Fase de crecimiento con usuarios activos.

---

#### Plan Premium - "Desarrollo Continuo"
**$12,000 MXN/mes**

| Incluye |
|---------|
| Todo lo del Plan Estándar |
| Desarrollo de features menores (ajustes y mejoras pequeñas) |
| Optimizaciones avanzadas (rendimiento, caché, video) |
| Tiempo de respuesta: 12-24 horas (bugs críticos inmediato) |
| Soporte prioritario con canal directo de comunicación |
| Análisis de métricas con sugerencias basadas en uso real |
| Verificación mensual de backups |

**Ideal para:** App con tracción, usuarios activos, necesidad de evolución constante.

---

#### Comparativa de Planes

| Aspecto | Básico | Estándar | Premium |
|---------|--------|----------|---------|
| **Precio mensual** | $3,500 | $6,000 | $12,000 |
| **Bugs críticos** | SI | SI | SI |
| **Bugs menores** | NO | SI | SI |
| **Actualizaciones deps** | NO | SI | SI |
| **Optimizaciones** | NO | Básicas | Avanzadas |
| **Features nuevos** | NO | NO | Menores |
| **Tiempo respuesta** | 48-72 hrs | 24-48 hrs | 12-24 hrs |
| **Reporte mensual** | NO | SI | SI + análisis |

---

### E. Resumen de Inversión Total

#### Costos Iniciales (Únicos)

| Concepto | Costo |
|----------|-------|
| Desarrollo MVP | $120,000 MXN |
| Licencias Año 1 (Apple + Google + Dominio) | ~$139 USD |
| **Total inicial** | **$120,000 MXN + ~$139 USD** |

#### Primer Año Completo (Escenario con Soporte Estándar)

| Concepto | Costo |
|----------|-------|
| Desarrollo MVP | $120,000 MXN |
| Licencias Año 1 | ~$139 USD |
| Operación (12 meses × ~$30 USD/mes en escenario lanzamiento) | ~$360 USD |
| Soporte Estándar (12 meses × $6,000 MXN) | $72,000 MXN |
| **Total Año 1** | **$192,000 MXN + ~$499 USD** |

#### Primer Año Completo (Escenario con Soporte Básico)

| Concepto | Costo |
|----------|-------|
| Desarrollo MVP | $120,000 MXN |
| Licencias Año 1 | ~$139 USD |
| Operación (12 meses × ~$30 USD/mes en escenario lanzamiento) | ~$360 USD |
| Soporte Básico (12 meses × $3,500 MXN) | $42,000 MXN |
| **Total Año 1** | **$162,000 MXN + ~$499 USD** |

> Nota: Los costos en USD (licencias y operativos) se cobran directamente en dólares y pueden variar según el tipo de cambio vigente. El costo de desarrollo y soporte se mantiene fijo en MXN.

---

### Plan de Optimizaciones Post-Lanzamiento

#### Corto Plazo (1-3 meses después del lanzamiento)

| Optimización | Beneficio |
|--------------|-----------|
| **Cache de imágenes** | Reducir consumo de datos y acelerar carga |
| **Lazy loading de videos** | Solo cargar video cuando el usuario lo solicita |
| **Compresión de imágenes** | Reducir tamaño sin perder calidad visible |
| **Paginación optimizada** | Cargar propiedades en lotes pequeños |

#### Mediano Plazo (3-6 meses)

| Optimización | Beneficio |
|--------------|-----------|
| **Pre-carga inteligente** | Anticipar qué contenido verá el usuario |
| **Múltiples resoluciones de video** | Adaptar calidad según conexión |
| **Índices de base de datos** | Acelerar búsquedas y filtros complejos |
| **CDN regional** | Servir contenido desde servidores más cercanos |

#### Largo Plazo (6-12 meses)

| Optimización | Beneficio |
|--------------|-----------|
| **Sistema de recomendaciones mejorado** | Sugerencias basadas en comportamiento |
| **Notificaciones inteligentes** | Alertas de nuevas propiedades relevantes |
| **Modo offline parcial** | Acceso a favoritos sin conexión |
| **Analytics avanzados** | Métricas detalladas de conversión |

### Evolución Técnica Planificada

```
+-------------------------------------------------------------+
|                    ROADMAP TÉCNICO                          |
+-------------------------------------------------------------+
|                                                             |
|  MVP (Mes 0-3)                                              |
|  |-- Funcionalidad completa                                 |
|  |-- Rendimiento aceptable                                  |
|  `-- Estabilidad básica                                     |
|                                                             |
|  Optimización V1 (Mes 3-6)                                  |
|  |-- Cache y lazy loading                                   |
|  |-- Mejoras de rendimiento                                 |
|  `-- Corrección de bugs reportados                          |
|                                                             |
|  Optimización V2 (Mes 6-12)                                 |
|  |-- Pre-carga inteligente                                  |
|  |-- Video adaptativo                                       |
|  `-- Recomendaciones mejoradas                              |
|                                                             |
|  Escalamiento (Mes 12+)                                     |
|  |-- Infraestructura robusta                                |
|  |-- Features avanzados                                     |
|  `-- Expansión de mercado                                   |
|                                                             |
+-------------------------------------------------------------+
```

---

## 6. Entregables

### Al finalizar el proyecto se entregarán:

| Entregable | Descripción |
|------------|-------------|
| **Aplicación Android** | Publicada en Google Play Store |
| **Aplicación iOS** | Publicada en Apple App Store |
| **Base de datos** | Esquema y datos iniciales configurados |
| **Panel de administración** | Acceso y credenciales |

---

## 7. Condiciones

### Incluido en el desarrollo:

- Desarrollo completo del MVP según especificaciones
- Configuración de servicios en la nube
- Publicación en tiendas de aplicaciones
- 30 días de soporte post-lanzamiento para bugs críticos
- Documentación básica del proyecto

### No incluido:

- Costos de licencias y servicios (pagados por el cliente)
- Marketing y promoción de la aplicación
- Creación de contenido (videos, fotos de propiedades)
- Mantenimiento posterior a los 30 días de garantía
- Nuevas funcionalidades no especificadas en este documento

### Requisitos del cliente:

- Proporcionar contenido de prueba (al menos 10-20 propiedades con fotos/videos)
- Disponibilidad para revisiones y feedback durante el desarrollo
- Cuenta de Apple Developer (el cliente debe ser titular)
- Cuenta de Google Play Developer (el cliente debe ser titular)
- Decisiones oportunas sobre dudas de diseño o funcionalidad

---

## 8. Siguiente Paso

Para iniciar el proyecto se requiere:

1. **Aprobación** de esta propuesta
2. **Primer pago** según el esquema seleccionado
3. **Creación de cuentas** de desarrollador (Apple/Google) por parte del cliente

Una vez completados estos pasos, el desarrollo comenzará en un plazo máximo de 5 días hábiles.

---

## 9. Contacto

Para dudas o aclaraciones sobre esta propuesta:

**Desarrollador:** Abraham Cabrera
**Email:** swacg08@gmail.com
**Teléfono:** 3329483044
**Ubicación:** Guadalajara, Jalisco