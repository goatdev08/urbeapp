# Product Requirements Document — Urbea


| Campo             | Valor                                                     |
| ----------------- | --------------------------------------------------------- |
| Producto          | Urbea                                                     |
| Tipo de documento | PRD oficial del MVP                                       |
| Versión           | 1.0                                                       |
| Fecha de cierre   | 2026-05-14                                                |
| Estado            | Aprobado para desarrollo                                  |
| Audiencia         | Equipo de desarrollo, producto y stakeholders del cliente |


---

## Índice

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Glosario](#2-glosario)
3. [Visión de producto y mercado](#3-visión-de-producto-y-mercado)
4. [Roles y permisos](#4-roles-y-permisos)
5. [Autenticación y registro](#5-autenticación-y-registro)
6. [Beta cerrada e invitaciones](#6-beta-cerrada-e-invitaciones)
7. [Onboarding](#7-onboarding)
8. [Navegación y estructura de pantallas](#8-navegación-y-estructura-de-pantallas)
9. [Feed](#9-feed)
10. [Mapa](#10-mapa)
11. [Búsqueda](#11-búsqueda)
12. [Propiedades](#12-propiedades)
13. [Video](#13-video)
14. [Wizard de publicación](#14-wizard-de-publicación)
15. [Publicación, moderación y estados](#15-publicación-moderación-y-estados)
16. [Cierre y baja de propiedades](#16-cierre-y-baja-de-propiedades)
17. [Pago, planes y modelo comercial](#17-pago-planes-y-modelo-comercial)
18. [Comentarios](#18-comentarios)
19. [Contacto, leads y CRM](#19-contacto-leads-y-crm)
20. [Follow](#20-follow)
21. [Compartir contenido](#21-compartir-contenido)
22. [Notificaciones](#22-notificaciones)
23. [Perfiles, visibilidad y configuración](#23-perfiles-visibilidad-y-configuración)
24. [Reportes y bloqueos](#24-reportes-y-bloqueos)
25. [Eliminación de cuenta y baja de contenido](#25-eliminación-de-cuenta-y-baja-de-contenido)
26. [Métricas y eventos](#26-métricas-y-eventos)
27. [Landing page](#27-landing-page)
28. [Panel de administración](#28-panel-de-administración)
29. [Virtual Open House (arquitectura preparatoria)](#29-virtual-open-house-arquitectura-preparatoria)
30. [Validación y antifraude](#30-validación-y-antifraude)
31. [Idioma e internacionalización](#31-idioma-e-internacionalización)
32. [Diseño de base de datos](#32-diseño-de-base-de-datos)
33. [Stack tecnológico](#33-stack-tecnológico)
34. [Métricas de éxito del MVP](#34-métricas-de-éxito-del-mvp)
35. [Anexos](#35-anexos)

---

## 1. Resumen

Urbea es una plataforma móvil (iOS y Android) para descubrir propiedades en renta y venta mediante un feed vertical de videos cortos, con vista alternativa de mapa, búsqueda con filtros, CRM para agentes y un panel administrativo web para moderación.

**Objetivos principales del MVP:**

- Lanzar apps nativas iOS y Android con feed vertical fluido tipo TikTok.
- Validar el modelo en beta cerrada en Guadalajara, con expansión a todo México preparada desde la arquitectura.
- Permitir publicación de propiedades por usuarios premium y agentes con flujo de moderación manual.
- Dotar a los agentes de un CRM con clasificación automática de leads por puntaje.
- Operar pagos por video (post-beta) mediante Stripe.

**Éxito técnico principal:** scroll de video sin latencia perceptible y experiencia fluida y estable.

---

## 2. Glosario


| Término             | Definición                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Visitante           | Persona sin cuenta que accede a la plataforma exclusivamente desde la web vía deep link.                                           |
| Usuario registrado  | Cuenta con todos los datos básicos validados; puede navegar pero no publicar.                                                      |
| Usuario premium     | Usuario que ha pagado para publicar al menos un video; sin badge ni CRM.                                                           |
| Agente              | Usuario verificado con badge, CRM y módulo de publicaciones; puede ser independiente o estar asociado a una inmobiliaria.          |
| Inmobiliaria        | Entidad organizacional que agrupa agentes, gestiona tokens de invitación y métricas agregadas. No es un usuario que navega la app. |
| Admin (Super admin) | Cuenta con privilegios totales sobre la plataforma; solo se crea por seed o invitación oficial.                                    |
| Lead                | Usuario que tocó "Contactar agente" en alguna publicación del agente y que entra al CRM.                                           |
| Video               | Pieza atómica de contenido en el feed. Vertical, duración 60–120 s.                                                                |
| Slot                | Derecho de publicación de un video durante un periodo de vigencia.                                                                 |
| VOH                 | Virtual Open House. Función de live streaming de propiedades, post-MVP.                                                            |
| LFPDPPP             | Ley Federal de Protección de Datos Personales en Posesión de los Particulares (México).                                            |


---

## 3. Visión de producto y mercado

### 3.1 Producto

- Nombre del producto: **Urbea**.
- MVP obligatorio: app **iOS** y app **Android**.
- Web app de escritorio: post-MVP.
- El stack debe contemplar una web app futura.
- Landing web: MVP, enfocada en explicar beneficios y dirigir a descarga de la app.
- **Feed infinito vertical tipo TikTok**: requisito real del MVP.
- El usuario no puede usar la app completa sin cuenta.
- Visitantes sin cuenta solo pueden ver videos compartidos.
- El éxito técnico principal del MVP es que no haya latencia perceptible al hacer scroll de videos.
- La estabilidad y fluidez de la experiencia son factores clave de éxito.

### 3.2 Mercado

- Mercado inicial: **Guadalajara**.
- Arquitectura y modelo de datos deben contemplar **expansión a todo México** desde el inicio.
- La beta será cerrada.
- El público general no podrá acceder inicialmente.
- El registro será solo por invitación durante beta.
- La cuenta oficial de Urbea que puede invitar es `urbeacontigo@gmail.com`.
- No habrá cargos durante beta; se usará para testing.
- Landing/lista de espera para versión final: post-MVP o fase pública.

---

## 4. Roles y permisos

### 4.1 Modelo de roles

- Jerarquía lineal: **visitante → registrado → premium → agente → admin**.
- El rol de cada usuario es **único y mutuamente excluyente**; un usuario solo puede tener un rol activo a la vez.
- Cada nivel hereda los permisos del nivel anterior y agrega los propios.
- La inmobiliaria no es un rol de usuario individual; es una entidad organizacional que agrupa agentes.
- Una cuenta de inmobiliaria no navega el feed ni interactúa como usuario; gestiona agentes, propiedades y métricas agregadas.

### 4.2 Flujos de cambio de rol

**Registrado → Premium:**
La transición es implícita y se completa al confirmar el pago del primer video (o al publicar exitosamente sin pago durante la beta). Un usuario registrado puede iniciar y completar el wizard de publicación; el sistema le permite llenar todos los pasos. Solo al tocar el botón final "Publicar" del wizard se le solicita el pago. Al confirmar el pago, su rol se actualiza a premium y la publicación pasa a `pending_review`. Durante la beta el pago se omite y el cambio de rol ocurre al enviar la publicación.

**Registrado/Premium → Agente:**
Se inicia desde Configuración → "Solicitar actualización a cuenta de agente inmobiliario". Se abre un wizard con dos caminos:

- **Camino A: Bajo inmobiliaria.** El usuario ingresa el token de invitación generado por la inmobiliaria. El sistema valida el token, asocia al usuario con esa inmobiliaria y le otorga el badge de agente con el nombre de la inmobiliaria visible en su perfil. El cambio es inmediato tras validar el token.
- **Camino B: Independiente.** El usuario completa una solicitud que se envía al admin de Urbea para revisión. Mientras la solicitud está en revisión, la cuenta sigue como registrada/premium. Al aprobar, el admin convierte la cuenta a agente independiente con badge. Si rechaza, el usuario recibe notificación con el motivo.

En ambos casos, al completar la actualización a agente, se habilitan los módulos de CRM y Publicaciones en la app. No se requiere documentación obligatoria durante la beta; los campos de documentación quedan en el sistema para activarlos post-beta.

**Registro de inmobiliaria:**
Flujo separado del registro de usuario. Se capturan datos de empresa (razón social, contacto, logotipo). La documentación formal (acta constitutiva, constancia de situación fiscal, INE del representante legal) no es obligatoria durante beta, pero los campos existen y están preparados para cuando se active el requisito. El admin de Urbea revisa y aprueba la solicitud antes de que la inmobiliaria pueda operar.

### 4.3 Visitante sin cuenta

- El visitante solo existe en la web; la app móvil nunca opera en modo visitante.
- Si un usuario abre la app por primera vez, la primera pantalla es siempre login/registro.
- Si un usuario tiene la app instalada pero NO ha completado su registro, los deep links se manejan como si no tuviera la app instalada (lo redirigen a la versión web).
- El visitante puede llegar a la plataforma únicamente mediante un deep link compartido por un usuario registrado.
- En la página web del video compartido, el visitante puede reproducir el video y ver datos públicos básicos de la propiedad.
- No puede usar búsqueda, feed completo, mapa ni acciones de interacción.
- Cada acción que requiere cuenta (like, guardar, comentar, contactar, follow) está bloqueada y muestra un CTA de descarga y registro.

### 4.4 Usuario registrado

- Puede usar la app y buscar propiedades.
- No puede publicar.

### 4.5 Usuario premium

- Puede publicar propiedades mediante pago por video.
- Puede publicar cualquier tipo de propiedad.
- Puede administrar sus publicaciones: alta, baja, edición y métricas.
- Puede ver likes, guardados y vistas de sus publicaciones.
- No está verificado como agente.
- No tiene badge de agente.
- No tiene clasificación de leads.
- No puede hacer VOH.
- No tiene límite de publicaciones activas en MVP.
- Restricción de publicaciones activas se considera post-MVP.

### 4.6 Agente inmobiliario

- Tiene badge de verificación.
- Tiene panel completo de leads (CRM).
- Tiene módulo de publicaciones con métricas.
- Tiene preferencia en visibilidad.
- Puede hacer VOH post-MVP.
- Hereda todos los permisos de usuario premium.
- Puede ser **independiente** o estar **asociado a una inmobiliaria**.
- Si está asociado a una inmobiliaria, no puede pertenecer a más de una al mismo tiempo.
- Si cambia de inmobiliaria, conserva sus seguidores.
- Si está bajo inmobiliaria, su perfil muestra la inmobiliaria actual.
- Si es independiente, su perfil no muestra inmobiliaria.
- Para convertirse en agente, debe iniciar el flujo de solicitud desde Configuración.

### 4.7 Inmobiliaria (entidad organizacional)

- No es un usuario que navega la app; es una cuenta de gestión.
- Administra agentes bajo su nombre.
- Aprueba agentes asociados a la inmobiliaria.
- Tiene capacidades de gestión superiores al agente individual.
- Puede tener badge de verificación.
- Registro con flujo separado; requiere aprobación del admin de Urbea.
- Documentación formal no obligatoria durante beta; campos preparados para post-beta.

**Funcionalidades MVP de la cuenta inmobiliaria:**

- Alta, baja y suspensión de agentes asociados.
- Generación de tokens de invitación para que usuarios se asocien como agentes a la inmobiliaria.
- Cada token es único; la inmobiliaria puede generar varios y configurar expiración o uso único.
- El token es el método principal de asociación de agentes en MVP.
- La inmobiliaria mantiene auditoría de tokens generados, fecha de uso y agente asociado.
- Métricas agregadas por agente y por propiedad.
- Configuración de redes y contacto por defecto.
- Gestión de documentos internos de verificación.
- Auditoría de cambios relevantes.
- Roles internos: owner, admin, agente, solo lectura.

**Funcionalidades post-MVP de la cuenta inmobiliaria:**

- Transferencia de propiedad entre agentes de la misma inmobiliaria.
- Invitación de agentes por correo electrónico (alternativa al token).

### 4.8 Administrador (Super admin)

- Aprueba nuevas publicaciones.
- Aprueba nuevas cuentas de inmobiliarias.
- Aprueba solicitudes de agente independiente.
- Gestiona control interno de la plataforma.
- Las cuentas de administrador solo pueden existir por seed directo a base de datos o invitación oficial de Urbea.
- El público no puede postularse como administrador.
- En MVP existen **2 super admins**; no hay rol de moderador.

---

## 5. Autenticación y registro

### 5.1 Datos requeridos

- Todas las cuentas requieren teléfono, correo, nombre completo, estado, ciudad y fecha de nacimiento.
- Edad se calcula con fecha de nacimiento usando la fecha del servidor.
- Solo puede existir una cuenta por correo.
- Solo puede existir una cuenta por número de teléfono.

### 5.2 Métodos de autenticación MVP

- Email + contraseña.
- Google OAuth (Sign in with Google).
- Sign in with Apple (obligatorio en iOS si se ofrece login social, requerido por App Store).
- Login con Facebook: post-MVP.

### 5.3 Recuperación de contraseña

- Aplica solo a cuentas con método email + contraseña.
- Recuperación por correo mediante magic link o código OTP de un solo uso.
- El enlace u OTP tiene expiración corta (ej. 15 minutos).
- Cuentas creadas con Google o Apple no requieren recuperación; se autentican vía proveedor.

### 5.4 Validaciones obligatorias en registro

- Aceptación explícita de términos y condiciones y aviso de privacidad. Sin aceptación no se completa el registro.
- Confirmación de mayoría de edad (calculada del campo fecha de nacimiento).
- Verificación de correo electrónico.
- Verificación de teléfono por OTP.
- Consentimiento explícito de que al contactar a un agente por WhatsApp, el agente podrá ver datos de contacto y contexto de interacción con sus publicaciones.

### 5.5 Términos y aviso de privacidad

- Documentos legales obligatorios desde la beta.
- Requeridos por App Store y Play Store antes del lanzamiento público.
- Versión inicial puede ser plantilla legal estándar para apps con tratamiento de datos personales en México (cumple LFPDPPP).
- Refinar redacción final antes del lanzamiento público fuera de beta.
- Mantener historial de versiones aceptadas por cada usuario.
- Si cambia la versión vigente, solicitar re-aceptación en próximo login.

---

## 6. Beta cerrada e invitaciones

- Acceso a la beta solo mediante código de invitación.
- Los códigos son generados desde el panel de administración por la cuenta oficial `urbeacontigo@gmail.com` u otro admin autorizado.
- Cada código es único y de un solo uso.
- El código se ingresa durante el registro; sin código válido el registro no procede.
- Durante la beta los usuarios invitados NO pueden invitar a otros usuarios.
- Si se requieren más participantes en beta, el admin genera más códigos.
- Cada código puede asociarse opcionalmente a un correo objetivo y a un tipo de cuenta (usuario, agente, inmobiliaria).
- Los códigos tienen fecha de expiración configurable.
- El sistema mantiene auditoría de qué código se usó para qué cuenta y cuándo.

---

## 7. Onboarding

- Orden del onboarding: ubicación, tipo de operación, tipo de propiedad, presupuesto y características.
- Ubicación es **obligatoria**.
- El usuario debe otorgar permiso de ubicación mientras usa la app.
- Si no otorga ubicación, no puede usar la app. La app no se cierra técnicamente: muestra una pantalla bloqueante con explicación y acceso a configuración del sistema.
- El usuario puede omitir el resto del onboarding (no la ubicación).
- Si omite campos no obligatorios, aparece popup indicando que la experiencia será menos personalizada.
- El usuario puede cambiar preferencias después desde Configuración.
- "Compra" solo aparece como **intención del usuario** en onboarding, nunca como tipo de publicación.
- La intención de compra prioriza propiedades en venta.

---

## 8. Navegación y estructura de pantallas

### 8.1 Principio general

- La interfaz base es la misma para todos los roles de usuario.
- Las diferencias entre roles se manifiestan como secciones adicionales o accesos extra encima de la interfaz base, no como interfaces completamente distintas.
- Esto permite que un usuario que cambia de rol (ej. registrado → premium → agente) tenga continuidad visual.

### 8.2 Flujo del visitante sin cuenta (solo web)

1. Un usuario registrado comparte un video desde el feed con el botón "Compartir".
2. Se genera un deep link único asociado al video.
3. El deep link siempre apunta a una página web (no a la app, aunque esté instalada).
4. La página web detecta el dispositivo (iOS / Android / escritorio).
5. La página muestra el video reproducible y datos públicos básicos de la propiedad.
6. Botones de descarga visibles: "Descargar para iOS" y "Descargar para Android" según corresponda.
7. Cada intento de interacción (like, guardar, comentar, contactar, follow) abre un modal con CTA de descarga.
8. Si el usuario tiene la app instalada y ya tiene cuenta activa, puede tocar un botón "Abrir en la app" para ver el video dentro de la app con todas las interacciones disponibles.
9. Si el usuario tiene la app instalada pero no ha completado su registro, el comportamiento es el mismo que si no la tuviera (se mantiene en la web).

### 8.3 Tab bar móvil (estructura base)

Todos los roles de usuario que navegan la app comparten una tab bar de 5 posiciones:


| Tab | Ícono / Etiqueta | Función                                         |
| --- | ---------------- | ----------------------------------------------- |
| 1   | Inicio           | Pantalla principal con toggle entre Feed y Mapa |
| 2   | Buscar           | Búsqueda y filtros de propiedades               |
| 3   | Publicar (+)     | Inicia el wizard de publicación                 |
| 4   | Notificaciones   | Centro de notificaciones in-app                 |
| 5   | Perfil           | Perfil del usuario y acceso a configuración     |


### 8.4 Comportamiento del tab "Publicar" por rol

- **Usuario registrado:** el tab Publicar es visible. Al tocarlo, el usuario puede iniciar el wizard de publicación completo. Al llegar al último paso ("Publicar"), el sistema le solicita el pago (durante post-beta) o ejecuta el upgrade implícito (durante beta).
- **Usuario premium:** el tab Publicar inicia directamente el wizard de publicación.
- **Agente:** el tab Publicar inicia directamente el wizard de publicación.

### 8.5 Accesos adicionales por rol

- **Agente:** además del tab bar estándar, tiene acceso a un menú lateral (drawer) que se abre desde el header. El drawer contiene:
  - CRM / Leads: panel de leads con clasificación y estados.
  - Analítica: métricas detalladas que extienden la sección de publicaciones del perfil.
- **Inmobiliaria:** la cuenta de inmobiliaria no navega la app como usuario; tiene una interfaz dedicada de gestión (cubierta en el panel de inmobiliaria, ver sección 28).

### 8.6 Pantalla de Perfil (estructura por capas)

El perfil del usuario es una sola pantalla con secciones que se activan según el rol. No existen pantallas separadas por rol; se agregan elementos sobre la misma base.


| Sección                             | Registrado     | Premium    | Agente         |
| ----------------------------------- | -------------- | ---------- | -------------- |
| Foto de perfil                      | Sí             | Sí         | Sí             |
| Nombre                              | Sí             | Sí         | Sí             |
| Bio                                 | Sí (corta)     | Sí (corta) | Sí (amplia)    |
| Badge de verificación               | No             | No         | Sí             |
| Inmobiliaria asociada               | No             | No         | Sí (si aplica) |
| Redes sociales                      | No             | Opcional   | Sí             |
| CTA "Publicar tu primera propiedad" | Sí (destacado) | No         | No             |
| Mis publicaciones                   | No             | Sí         | Sí             |
| Publicaciones cerradas              | No             | Sí         | Sí             |
| Guardados                           | Sí             | Sí         | Sí             |
| Seguidos                            | Sí             | Sí         | Sí             |
| Seguidores                          | No             | No         | Sí             |
| Acceso a configuración              | Sí             | Sí         | Sí             |
| Cerrar sesión                       | Sí             | Sí         | Sí             |


- El usuario registrado tiene un CTA destacado en su perfil que invita a publicar su primera propiedad. Al tocarlo se inicia el wizard de publicación.
- El acceso a CRM y Analítica del agente NO vive en el perfil; vive en el menú lateral (drawer).

### 8.7 Pantalla de Configuración

Acceso desde el Perfil. Estructura común para todos los roles, con opciones que se habilitan según el método de autenticación o el rol.

- **Cuenta**
  - Editar datos personales (nombre, teléfono, fecha de nacimiento). Cambios en teléfono o correo requieren re-verificación por OTP o por correo.
  - Cambiar contraseña (solo cuentas con email + contraseña).
  - Solicitar actualización a cuenta de agente inmobiliario (visible solo para usuarios registrados y premium; oculto para agentes y admins). Inicia el wizard de upgrade a agente con los caminos "bajo inmobiliaria" e "independiente".
  - Eliminar cuenta (con confirmación y aviso del plazo de retención de datos según LFPDPPP).
- **Preferencias**
  - Re-ejecutar onboarding (cambiar intención, tipo, presupuesto, ubicación base).
  - Idioma: en MVP solo español. Campo preparado para internacionalización futura.
- **Notificaciones**
  - Toggles por tipo: agentes seguidos, comentarios en mis publicaciones, leads nuevos (agentes), aprobación/rechazo de publicaciones, expiración próxima de videos, VOH cercanos (post-MVP).
  - Toggle maestro de notificaciones push.
- **Privacidad**
  - Ver términos y condiciones vigentes.
  - Ver aviso de privacidad vigente.
  - Ver versión de términos aceptada actualmente.
  - Revocar consentimiento (con advertencia de pérdida de acceso).
- **Soporte**
  - Contacto a soporte (correo / WhatsApp oficial).
  - Reportar un problema.
  - Acerca de Urbea (versión de app, créditos).

---

## 9. Feed

### 9.1 Reglas generales

- El feed muestra videos de propiedades cercanas a la ubicación del usuario.
- Primero se priorizan cercanía y coincidencia con onboarding.
- Si se agotan resultados cercanos, el sistema expande progresivamente el radio.
- Si no quedan videos nuevos, el feed reinicia el bucle.
- Los videos se repiten automáticamente si no existen más videos para mostrar.
- Los videos se repiten en el mismo orden.
- No existe acción "no me interesa" en MVP.
- Descartar propiedades queda post-MVP.

### 9.2 Unidad de contenido del feed

- Cada video es la unidad atómica de contenido en el feed.
- Una propiedad puede tener varios videos; cada video aparece como entrada independiente en el feed.
- Para evitar saturación, el ranking aplica una regla anti-clustering: entre dos videos de la misma propiedad debe haber al menos **5 videos de otras propiedades**.
- Si la cantidad disponible de videos no permite respetar la separación mínima, el algoritmo intenta maximizar la separación dentro de lo posible.
- En el popup de detalles de un video se muestra un indicador con la cantidad total de videos disponibles de esa propiedad (ej. "3 videos disponibles").
- Desde ese indicador, el usuario puede abrir una galería vertical con todos los videos de la propiedad, separada del feed principal.

### 9.3 Radio del feed

- Radio inicial: 2 km.
- Expansiones: 5 km, 10 km, 20 km.
- Más de 20 km es el límite máximo antes de pasar a preferencias no cercanas.
- Si no hay ubicación, la app bloquea acceso.

### 9.4 Filtros rápidos sobre el feed

- El feed cuenta con un ícono de filtro en su header.
- Al tocarlo se despliega un bottom sheet con los siguientes filtros:
  - Tipo de operación: renta, venta o ambas.
  - Tipo de propiedad.
  - Rango de precio.
  - Recámaras.
  - Baños.
  - Radio de búsqueda: 2, 5, 10, 20 km o sin límite.
- Los filtros aplicados sobreescriben temporalmente las preferencias del onboarding solo para esa sesión; no alteran las preferencias guardadas.
- Botón "Restaurar mis preferencias" que regresa al estado del onboarding.
- Para persistir cambios de preferencias se debe acceder a Configuración → Re-ejecutar onboarding.

### 9.5 Acciones en feed

Botones verticales a la derecha:

- Contacto.
- Like.
- Guardar.
- Compartir.
- Comentarios.

Botón horizontal:

- Follow junto al nombre del agente.

Elementos clicables:

- Nombre del agente: abre perfil del agente.
- Botón detalles: abre popup sin salir del video.

### 9.6 Granularidad de las interacciones

- **Like:** se aplica al video específico. Es una señal de "este video me gustó". Alimenta el algoritmo de recomendación. Cuenta para las métricas del publicador, pero no se expone públicamente quién dio like.
- **Guardar:** se aplica a la propiedad completa (no al video). Es una señal de "esta propiedad me interesa, quiero volver". Va a la lista de Guardados del usuario. Es privado.
- **Comentar:** se aplica al video específico.
- **Compartir:** se comparte el video específico (con deep link al video, no a la propiedad).
- **Contacto:** se asocia a la propiedad y al video desde donde se originó el contacto (para que el agente pueda ver el contexto).
- **Follow:** se aplica al perfil del agente, no a la propiedad ni al video.

### 9.7 Popup de detalles

- Ubicación arriba.
- Card con datos rápidos: m2, baños, habitaciones y datos principales.
- Indicador de cantidad de videos disponibles de la propiedad.
- Acceso a galería vertical de todos los videos de la propiedad.
- No muestra descripción completa ni amenidades extensas.
- Para más información, el usuario debe contactar al agente.
- En MVP no hay fotos; el detalle depende de video y campos estructurados.

### 9.8 Ranking del feed (MVP)

1. Propiedades activas, aprobadas y visibles.
2. Coincidencia con intención del onboarding o filtros activos de la sesión.
3. Cercanía al usuario.
4. Preferencias de usuario.
5. Frescura de publicación.
6. Regla anti-clustering: separación mínima de 5 posiciones entre videos de la misma propiedad.
7. Expansión progresiva de radio si no hay suficientes resultados.
8. Repetición del bucle cuando no haya más videos.

---

## 10. Mapa

### 10.1 Reglas generales

- En la pantalla principal se puede alternar entre feed y mapa desde la parte inferior.
- Una propiedad solo aparece en mapa si fue aprobada.
- Todas las propiedades se muestran con pin de dirección exacta de alta precisión.
- No existen zonas de ubicación aproximada (decisión definitiva del cliente).

### 10.2 Filtros del mapa

- El mapa respeta los filtros activos durante la sesión de navegación.
- Si el usuario entra al mapa desde el toggle del Inicio, respeta los filtros rápidos del feed y las preferencias del onboarding.
- Si el usuario entra al mapa desde la pantalla de Búsqueda, respeta los filtros de la búsqueda en curso.
- El mapa cuenta con su propio botón de filtro (mismo bottom sheet que el feed) para ajustar filtros sin salir del mapa.
- Los filtros del feed y del mapa comparten estado dentro de la misma sesión: cualquier cambio se refleja en ambas vistas.

### 10.3 Búsqueda dentro del mapa

- Input de búsqueda en la parte superior con placeholder "Buscar zona, colonia o dirección".
- Autocompletado a medida que el usuario teclea (Google Maps Places API o equivalente).
- Al seleccionar una sugerencia, el mapa se centra y hace zoom en la ubicación elegida.
- La búsqueda solo navega el mapa; no reemplaza los filtros activos. Los pins mostrados siguen respetando los filtros.

### 10.4 Clustering de pins

- Cuando hay múltiples propiedades cercanas y el zoom no permite verlas separadas, se muestran agrupadas como cluster.
- El cluster se representa visualmente como un círculo sólido con el número de propiedades en el centro (estilo Google Maps clustering, en colores corporativos de Urbea).
- Al tocar un cluster, el mapa hace zoom automático sobre el área del cluster y expande los pins individuales hasta que sean separables.
- A nivel de zoom muy alejado (vista de ciudad o estado), los clusters agrupan grandes cantidades de propiedades por zona amplia.
- A nivel de zoom alto (vista de calle), todos los pins se muestran individualmente sin clustering.

### 10.5 Interacciones con pins

- **Toque simple en pin individual:** se despliega una tarjeta flotante en la parte inferior del mapa (bottom sheet pequeño) con:
  - Thumbnail del primer video de la propiedad.
  - Datos rápidos: precio (o "Precio a consultar"), recámaras, baños, m2, dirección o zona/colonia.
  - Botones de acción: "Ver video" (lleva a la galería vertical de videos de la propiedad), "Contactar" (abre WhatsApp con referencia a la propiedad), "Guardar".
- **Toque en cluster:** zoom automático para expandir los pins.
- No se reproduce el video directamente en el mapa para preservar fluidez y evitar consumo de datos involuntario.

### 10.6 Botón "Buscar en esta zona"

- Cuando el usuario desplaza el mapa más allá de un umbral del centro original, aparece un botón flotante en la parte superior con texto "Buscar en esta zona".
- Al tocarlo, el mapa hace una nueva consulta tomando como centro la posición visible actual y carga los pins de propiedades en esa zona, respetando los filtros activos.

---

## 11. Búsqueda

### 11.1 Disponibilidad

- Disponible solo para usuarios registrados, premium y agentes.
- El visitante sin cuenta no tiene acceso a búsqueda.

### 11.2 Estructura de la pantalla de búsqueda

- **Input de texto libre** en la parte superior. Busca por:
  - Nombre de zona o colonia.
  - Nombre de agente.
  - Nombre de inmobiliaria.
  - Código de propiedad.
- **Filtros estructurados** como chips horizontales scrollables debajo del input:
  - Tipo de operación.
  - Tipo de propiedad.
  - Rango de precio.
  - Recámaras.
  - Baños.
  - Zona / colonia con autocompletado.
  - Amueblado, mascotas y otros atributos opcionales.
- **Toggle Lista / Mapa** para alternar la visualización de resultados.
- **Resultados en lista:** cards verticales con thumbnail del primer video, datos rápidos (precio, recámaras, baños, m2, zona).
- **Resultados en mapa:** pins respetando los filtros activos, todos con dirección exacta, siguiendo las mismas reglas del mapa general.
- Al tocar una card o un pin, el usuario entra a la galería vertical de videos de esa propiedad, manteniendo el contexto de la búsqueda.
- **Búsquedas recientes** persisten por usuario. Se muestran cuando el input está vacío al entrar a la pantalla.

---

## 12. Propiedades

### 12.1 Tipo de operación

- Las publicaciones pueden ser renta, venta o ambas.
- Compra no es tipo de publicación; solo es intención del usuario.

### 12.2 Tipos de propiedad

- El modelo soporta residencial, comercial y otros tipos: local, oficina, departamento, terreno, casa, etc.
- El catálogo de tipos es configurable desde el panel de admin.

### 12.3 Campos obligatorios

- Baños.
- Recámaras.
- m2.
- Dirección.
- Tipo.
- Precio interno.

### 12.4 Precio

- El precio es obligatorio internamente para filtros, presupuesto y personalización.
- El publicador decide si muestra el precio al público.
- Si el precio se oculta, el usuario ve "Precio a consultar".
- Las propiedades con precio oculto sí aparecen en filtros de presupuesto usando el precio interno.
- Se permiten propiedades en venta sin precio visible.

### 12.5 Ubicación

- La dirección exacta es obligatoria y siempre visible públicamente.
- No existe opción de ocultar la dirección ni de mostrarla aproximada.
- La dirección exacta se guarda internamente y se expone al cliente con coordenadas precisas.
- Aplica a todos los tipos de propiedad.
- En el mapa, todas las propiedades aparecen con pin puntual de alta precisión.
- Esta decisión es definitiva, tomada por el cliente.

---

## 13. Video

### 13.1 Reglas básicas

- MVP no incluye fotos para propiedades.
- El contenido visual de la propiedad en MVP es video.
- Duración mínima por video: 60 segundos.
- Duración máxima por video: 120 segundos.
- Formato vertical obligatorio.
- La pantalla de publicación debe advertir que el formato debe ser vertical.
- Se permiten múltiples videos por propiedad, hasta un máximo de 5.
- Cada video aparece dentro del feed.
- Si falla el procesamiento, se pide volver a publicar el video.

### 13.2 Tamaño y límites técnicos

- Tamaño máximo por video: 500 MB.
- El sistema rechaza el archivo antes de iniciar la subida si excede el límite.
- Límite de concurrencia: 1 video en procesamiento por usuario a la vez.
- En cuentas de inmobiliaria con múltiples agentes, el límite de concurrencia es por agente, no por inmobiliaria.

### 13.3 Subida del video

- Subida en modo resumible (chunked upload con resumibilidad).
- La subida ocurre solo mientras la app está activa o en foreground; no se sube en background si la app está cerrada.
- Si la conexión se pierde durante la subida, al regresar el usuario al wizard, el sistema reanuda desde el último chunk confirmado.
- Si el usuario cierra la app antes de terminar la subida, el video queda en estado `uploading_media` con la fracción subida marcada. Al reabrir el wizard del borrador, el sistema ofrece "Continuar subida" o "Cancelar y elegir otro video".

### 13.4 Procesamiento del video

- Tras los primeros 30 segundos de procesamiento post-upload, el sistema muestra el mensaje "Esto puede tardar unos minutos, te avisamos cuando esté listo" y permite al usuario salir del wizard.
- El procesamiento continúa en backend del lado del proveedor de video; no requiere que la app esté abierta.
- El usuario recibe notificación push cuando el video está listo o si falla el procesamiento.

### 13.5 Selección de thumbnail

- Al terminar el procesamiento, el sistema muestra 3 thumbnails sugeridos automáticamente extraídos a 25%, 50% y 75% de la duración del video.
- Si ninguno gusta, el usuario puede abrir un slider que recorre el video frame por frame y elegir el momento exacto.
- No se permite subir imagen externa como thumbnail en MVP.

### 13.6 Edición y reemplazo de video

- Si la propiedad tiene un solo video, "reemplazar" significa agregar uno nuevo y marcar el anterior como `archived`.
- Si la propiedad tiene múltiples videos, el usuario debe elegir entre "agregar otro" o "reemplazar uno existente".
- Los videos archivados se mantienen en storage durante 30 días por si requieren restauración o auditoría, luego se eliminan definitivamente.
- Las métricas históricas del video archivado se conservan permanentemente, asociadas a la propiedad.
- Reemplazar el video activo de una publicación dispara re-revisión por admin.

---

## 14. Wizard de publicación

- Acceso desde el tab Publicar o desde el CTA del perfil de usuario registrado.
- **5 pasos secuenciales:**
  1. **Tipo de operación:** renta, venta o ambas. Obligatorio.
  2. **Tipo de propiedad:** selección obligatoria entre casa, departamento, terreno, local, oficina y otros tipos definidos. No se permite continuar sin selección.
  3. **Detalles obligatorios:** dirección con selector en mapa, m2, recámaras, baños, precio interno, visibilidad de precio (mostrar/ocultar). La ubicación se muestra siempre con dirección exacta.
  4. **Detalles opcionales:** descripción corta, amenidades básicas (estacionamientos, mascotas, amueblado, etc.), redes/contacto adicionales si aplica.
  5. **Video:** carga del video (60–120 s, formato vertical obligatorio), advertencia de formato, procesamiento, selección de thumbnail.

### 14.1 Autoguardado de borrador

- Si el usuario sale del wizard en cualquier punto antes de completar el paso 5, el sistema guarda automáticamente la publicación en estado `draft` sin pedir confirmación.
- El borrador queda visible en "Mis publicaciones" y se puede continuar editando en cualquier momento.
- Si el video falla en el procesamiento, la publicación queda en `media_failed` y se puede reintentar sin perder los demás campos.

### 14.2 Envío de la publicación

Al completar el paso 5 y tocar "Publicar":

- Si el usuario es **registrado**, el sistema solicita el pago (post-beta) o ejecuta el upgrade implícito (beta) y envía la publicación a `pending_review`.
- Si el usuario es **premium o agente**, el sistema cobra (post-beta) o publica directamente (beta) y envía a `pending_review`.

---

## 15. Publicación, moderación y estados

### 15.1 Reglas generales de moderación

- Toda publicación debe pasar por revisión antes de aparecer públicamente.
- La revisión puede apoyarse en automatización, pero la fuente de verdad en MVP es revisión manual.
- Las inmobiliarias requieren aprobación por correo electrónico de confirmación antes de publicar.
- Inmobiliarias y agentes pueden tener badge de verificado.
- El objetivo de verificación es reducir fraudes.

### 15.2 Pipeline de moderación

- Validar que el video exista, dure dentro del límite permitido y se pueda reproducir.
- Bloquear publicación si faltan campos obligatorios.
- Marcar publicaciones de riesgo para revisión prioritaria.
- Evitar duplicados obvios por misma dirección, mismo agente y video igual.
- No depender de reconocimiento de imagen/video para aprobar automáticamente propiedades.
- No clasificar fraude con IA como decisión final en MVP.

### 15.3 Publicación rápida

- Usuario premium o agente puede crear publicación rápido.
- La publicación queda en estado `pending_review`.
- Solo aparece públicamente después de aprobación.
- Badges de verificación no se otorgan por subir contenido, sino por validación de cuenta.
- El usuario puede terminar carga y edición sin esperar al admin.

### 15.4 Estados de publicación


| Estado            | Significado                                         |
| ----------------- | --------------------------------------------------- |
| `draft`           | Publicación incompleta, visible solo para su dueño. |
| `uploading_media` | Video subiendo o procesándose.                      |
| `media_failed`    | Falló procesamiento; requiere volver a subir.       |
| `pending_payment` | Falta pago del video (aplica fuera de beta).        |
| `pending_review`  | Lista para revisión admin.                          |
| `needs_changes`   | Admin pide correcciones.                            |
| `approved`        | Aprobada pero todavía no activa (por fecha o pago). |
| `active`          | Visible en feed/mapa.                               |
| `paused`          | Pausada por publicador, conserva métricas.          |
| `expired`         | Terminó periodo pagado del video.                   |
| `rented`          | Cerrada por renta, no visible en feed.              |
| `sold`            | Cerrada por venta, no visible en feed.              |
| `rejected`        | Rechazada por admin.                                |
| `suspended`       | Oculta por acción de admin por riesgo/reporte.      |
| `deleted_soft`    | Eliminada lógicamente, conserva métricas/auditoría. |
| `deleted_hard`    | Eliminación definitiva según política.              |


### 15.5 Re-revisión por edición

**Cambios que disparan re-revisión:**

- Dirección o coordenadas.
- Tipo de operación.
- Tipo de propiedad.
- Video.
- Descripción.
- Precio interno.
- Cambio de agente responsable.

**Cambios que NO disparan re-revisión:**

- Pausar/reactivar si ya estaba aprobada y no expiró.
- Ocultar/mostrar precio sin cambiar precio interno.
- Editar redes/contacto del agente, sujeto a verificación de cuenta.

### 15.6 Visibilidad durante re-revisión

- Cuando un cambio dispara re-revisión, la versión publicada anteriormente se mantiene visible en el feed y en el mapa.
- Internamente el sistema mantiene dos versiones de la publicación:
  - `current_published`: lo que ven los usuarios.
  - `pending_revision`: la edición que el admin está revisando.
- Cuando el admin aprueba: `pending_revision` reemplaza a `current_published`.
- Cuando el admin pide cambios o rechaza: `current_published` permanece intacta; `pending_revision` queda en `needs_changes` o `rejected`.
- Excepción: si la suspensión ocurre por reporte de fraude o riesgo, la propiedad pasa a `suspended` inmediatamente y se oculta sin esperar revisión de la edición.

---

## 16. Cierre y baja de propiedades

### 16.1 Cierre de propiedad

- El estado `sold` o `rented` lo marca manualmente el publicador (premium o agente) desde "Mis publicaciones".
- En MVP no hay detección automática de cierres por parte del sistema.
- Una vez marcada como `sold` o `rented`:
  - La propiedad y sus videos dejan de aparecer en el feed y en el mapa.
  - Se conservan visibles en el perfil del publicador bajo "Publicaciones cerradas".
  - La vigencia restante del slot se considera consumida; no hay reembolso ni crédito devuelto.
  - Las métricas históricas se conservan permanentemente.
- En MVP no se contempla reabrir una propiedad cerrada. Reapertura queda como mejora post-MVP.

---

## 17. Pago, planes y modelo comercial

### 17.1 Reglas generales

- No hay suscripciones; el modelo es pago por video unitario.
- El pago cubre cada video.
- El usuario puede pagar y después subir video.
- La vigencia del video corre a partir de que el usuario sube el video, no desde que paga.
- Si se rechaza una publicación/video, el usuario puede subir otro video por ese mismo periodo/crédito.
- Si se edita la publicación, la vigencia sigue corriendo.
- Si la propiedad se vende/renta, se marca como tal y la vigencia restante se considera consumida (no hay reembolso ni crédito devuelto).
- Para otra propiedad se debe pagar de nuevo.
- La pasarela de pagos no se construye para beta. Se deja infraestructura preparada para activarla post-beta.

### 17.2 Planes y precios


| Audiencia       | Vigencia del video | Costo total | Equivalente mensual |
| --------------- | ------------------ | ----------- | ------------------- |
| Usuario premium | 1 mes              | $399 MXN    | $399 MXN/mes        |
| Agente          | 3 meses            | $1,197 MXN  | $399 MXN/mes        |
| Agente          | 6 meses            | $1,194 MXN  | $199 MXN/mes        |


- El usuario premium solo puede comprar el plan de 1 mes; los planes de 3 y 6 meses están reservados para agentes.
- Las inmobiliarias pueden comprar slots a granel para sus agentes desde su panel (post-beta), asignando cada slot a un agente específico.
- Los precios se almacenan en tabla configurable, no en código, para permitir cambios sin migración.
- Cada `purchase` registra el precio histórico vigente al momento de la compra; cambios futuros de precio no afectan compras pasadas.

### 17.3 Caducidad de créditos no usados

- Un crédito comprado y no usado caduca a los **90 días** desde la fecha de compra.
- Notificación al usuario 7 días antes de la expiración del crédito.
- No hay reembolso una vez vencido el crédito.

### 17.4 Métodos de pago (post-beta)

- Pasarela principal: **Stripe**.
- Métodos aceptados:
  - Tarjeta de crédito y débito.
  - Apple Pay y Google Pay (vía Stripe).
  - OXXO Pay.
  - SPEI (transferencia bancaria).
- Alternativas a evaluar como respaldo: MercadoPago, Conekta, OpenPay.

### 17.5 Facturación

- En MVP no se ofrece facturación. El usuario no podrá solicitar factura CFDI por sus pagos.
- Cada pago genera únicamente un recibo de confirmación por correo electrónico.
- La facturación CFDI 4.0 queda pendiente para post-MVP.

### 17.6 Expiración del video activo

- **7 días antes** de la expiración: notificación push y notificación in-app al publicador.
- **1 día antes**: recordatorio.
- Al expirar, el video pasa automáticamente a estado `expired` y deja de aparecer en feed y mapa.
- El video y sus métricas se conservan visibles al publicador en su perfil bajo "Publicaciones cerradas".
- **Renovación:** desde "Mis publicaciones", el publicador puede tocar "Renovar" en una publicación expirada. El sistema cobra un nuevo slot (o consume uno disponible) y reactiva la publicación, que vuelve a `pending_review`.
- Si el usuario no renueva, la publicación queda en `expired` indefinidamente para consulta histórica del publicador.

### 17.7 Modelo de datos del flujo de pago

- Separar `purchase` de `video_slot`.
- `purchase`: pago/crédito adquirido. Guarda monto, método, plan, precio histórico, fecha y estado.
- `video_slot`: derecho de publicar un video durante un periodo. Se genera al confirmar la `purchase`. Tiene fecha de expiración del crédito (90 días) y, una vez consumido, fecha de inicio y fin de la vigencia activa del video.
- `property_video`: archivo real subido y aprobado/rechazado. Asociado a un `video_slot` consumido.
- Si un video se rechaza, el `video_slot` sigue disponible hasta que haya un video aprobado o hasta que el crédito caduque.

---

## 18. Comentarios

### 18.1 Reglas generales

- Los comentarios son visibles para todos los usuarios autenticados.
- El agente puede ocultar comentarios en sus publicaciones, pero no eliminarlos definitivamente.
- Los comentarios requieren moderación.
- El agente recibe notificación por comentarios nuevos.
- Las preguntas directas se hacen al agente por WhatsApp, no como comentario público tipo Q&A.

### 18.2 Moderación de comentarios

- Comentario se publica inmediatamente solo si pasa filtros básicos.
- **Filtros básicos:** insultos, spam, links sospechosos, teléfonos/correos, lenguaje discriminatorio, contenido sexual, amenazas.
- Comentarios marcados por filtro quedan `held_for_review`.
- Usuarios pueden reportar comentarios.
- Agente puede ocultar comentarios de sus propiedades, pero no eliminarlos definitivamente.
- Inmobiliaria puede ocultar comentarios en publicaciones de sus agentes.
- Admin puede eliminar, restaurar o sancionar.
- Mantener auditoría de comentario original, autor, propiedad, acción tomada y actor que moderó.

### 18.3 Enfoque para MVP

- MVP básico de moderación: listas/reglas, estados y reportes.
- Iniciar con moderación por reglas, reportes y cola manual.
- Dejar IA/NLP como mejora si el volumen lo justifica.

---

## 19. Contacto, leads y CRM

### 19.1 Reglas generales

- Contacto principal MVP: **WhatsApp**.
- Se contemplan Instagram, TikTok y Facebook como enlaces opcionales si el agente/inmobiliaria los tiene.
- El botón de contacto incluye referencia a la propiedad y al video desde donde se originó.
- El teléfono no se muestra públicamente en perfil.
- El teléfono del usuario solo es visible al agente cuando el usuario tocó "Contactar agente" en una de sus publicaciones.
- El CRM solo clasifica como lead al usuario que contactó al agente por WhatsApp.
- Vistas, likes, guardados, comentarios, compartidos y follows son interacciones, no leads en sí mismas.
- Las interacciones de un usuario que nunca contactó al agente no generan registro accesible al agente.

### 19.2 Privacidad antes y después del contacto

- Mientras el usuario no haya tocado "Contactar agente" en alguna publicación del agente, el agente **no puede ver** ningún dato personal del usuario.
- Solo después de que el usuario toca "Contactar agente":
  - Se crea el lead en estado `whatsapp_opened`.
  - El agente obtiene acceso a los datos del usuario: nombre completo, foto de perfil, edad calculada, estado y ciudad, correo, teléfono.
  - El agente obtiene acceso retroactivo al historial completo de interacciones de ese usuario con TODAS las publicaciones del agente.
- Esta lógica de privacidad debe quedar explícita en el aviso de privacidad y en el consentimiento del registro.

### 19.3 Apertura de WhatsApp

- Al tocar "Contactar agente" se abre WhatsApp con mensaje prellenado siguiendo template fijo del sistema:
  - `Hola, vi tu propiedad en Urbea: [tipo + zona] (#[código]). Me interesa conocer más detalles. [deep link al video]`
- El template no es editable por el agente.
- El usuario puede modificar el mensaje antes de enviarlo en WhatsApp.
- En MVP el lead se crea al tocar el botón dentro de Urbea, porque la app no puede confirmar que el mensaje fue enviado sin integrar WhatsApp Business API.
- Post-MVP: integrar WhatsApp Business API o tracking más robusto si el modelo comercial lo justifica.

### 19.4 Datos visibles del lead

Una vez creado el lead, el agente ve en la vista de detalle:

- Nombre completo del usuario.
- Foto de perfil (si existe).
- Edad calculada (no fecha de nacimiento exacta).
- Estado y ciudad.
- Correo electrónico.
- Teléfono.
- Fecha del primer contacto.
- Lista de propiedades del agente con las que el usuario interactuó.
- Para cada interacción: tipo, fecha, propiedad relacionada.
- Puntaje del embudo.

### 19.5 Unificación de leads

- Un lead único por relación agente-usuario.
- Si el mismo usuario contacta al agente desde varias propiedades distintas, se mantiene como un solo lead; la lista de propiedades de origen del contacto crece.
- El estado del lead es uno solo a nivel agente-usuario, no por propiedad.

### 19.6 Embudo de clasificación por puntaje

El CRM clasifica automáticamente cada lead con un puntaje basado en sus interacciones con las publicaciones del agente.

**Acciones que suman puntaje:**

- Like en un video del agente.
- Guardado de una propiedad del agente.
- Compartido de un video del agente.
- Comentario en una publicación del agente.
- Ver el 100% del video (video completado).
- Tocar el botón "Contactar agente".

**Reglas del puntaje (valores de referencia, calibrables):**


| Acción           | Puntos |
| ---------------- | ------ |
| Contacto         | 10     |
| Compartido       | 5      |
| Guardado         | 4      |
| Comentario       | 3      |
| Video completado | 2      |
| Like             | 1      |


- El puntaje del lead se acumula por todas las interacciones del usuario con todas las publicaciones del agente.
- Acciones repetidas (ej. ver el mismo video al 100% varias veces) cuentan solo una vez por video.
- El embudo presenta visualmente al lead con un nivel derivado del puntaje (frío, tibio, caliente), con umbrales configurables.

### 19.7 Acciones del agente sobre el lead

- **Cambiar estado** entre los estados predefinidos del embudo.
- **Destacar como "en seguimiento":** estado especial para resaltar leads que está trabajando activamente. Los leads en seguimiento aparecen agrupados en la parte superior del CRM.
- **Marcar como cerrado:** elige uno de los tipos de cierre.
- **Agregar notas internas:** campo libre editable por el agente, no visible al usuario.
- **Eliminar lead:** acción manual; ejecuta soft delete con retención de 30 días, luego se elimina definitivamente.
- **Abrir WhatsApp:** botón directo para retomar el contacto desde la vista de detalle del lead.

### 19.8 Estados del lead

1. `whatsapp_opened`: estado inicial automático al tocar contactar.
2. `contacted`: el agente confirmó que hubo conversación.
3. `interested`: el usuario mostró interés serio.
4. `in_follow_up`: destacado por el agente como "en seguimiento activo".
5. `visit_scheduled`: visita agendada.
6. `closed_won_rent`: cerrado con éxito, propiedad rentada.
7. `closed_won_sale`: cerrado con éxito, propiedad vendida.
8. `closed_lost`: cerrado sin éxito.
9. `discarded`: descartado por el agente.

**Reglas:**

- No se permiten estados personalizados en MVP.
- Cada cambio de estado queda en un historial visible al agente como timeline.
- `in_follow_up` puede convivir como bandera con cualquier estado intermedio (`contacted`, `interested`, `visit_scheduled`) para destacarlo en el CRM.

### 19.9 Estructura visual del CRM

- Vista principal: lista vertical de leads ordenados por puntaje descendente. Botón secundario para ordenar por fecha de último contacto.
- Sección superior fija con los leads en `in_follow_up`.
- Filtros rápidos en el header: por estado, por propiedad, por rango de fechas, por nivel del embudo.
- Buscador de texto libre por nombre o teléfono.
- Tarjeta de lead muestra: nombre, foto, puntaje numérico, nivel del embudo, estado actual, fecha de último contacto.
- Al tocar un lead se abre la vista de detalle con todos los datos, historial de interacciones, notas y acciones disponibles.
- Botón "Exportar CSV" en el header de la vista principal.
- En MVP no hay vista kanban ni recordatorios programados; quedan como post-MVP.

### 19.10 Retención de leads

- Los leads se retienen mientras la cuenta del agente esté activa.
- Eliminación manual por el agente: soft delete con retención de 30 días, luego eliminación definitiva.
- Si el agente elimina su cuenta o se da de baja, sus leads pasan a soft delete y se conservan 1 mes en backend, durante el cual la inmobiliaria puede solicitar exportación al admin. Después de 30 días se eliminan definitivamente.

---

## 20. Follow

- Follow aplica solo a perfiles de agentes (con o sin inmobiliaria).
- Los usuarios premium no pueden tener seguidores; sus publicaciones se ven en el feed pero su perfil no expone botón de seguir.
- El usuario recibe notificaciones de agentes seguidos.
- El agente conserva sus followers si cambia de inmobiliaria o pasa de bajo inmobiliaria a independiente.

---

## 21. Compartir contenido

- Se usa la API nativa de share del sistema operativo (sheet de iOS y Android).
- El usuario elige el destino: WhatsApp, Instagram, Telegram, copiar link, etc.
- Lo que se comparte es el deep link del video, no el archivo de video.
- El deep link es permanente mientras la propiedad esté activa.
- Si la propiedad pasa a `sold`, `rented`, `expired`, `deleted_soft` o `deleted_hard`, el link sigue funcionando pero la página web muestra "Esta propiedad ya no está disponible" con CTA para volver al feed o buscar otras.
- Se registra el evento `share_clicked` con `video_id`, `user_id`, timestamp.
- No se trackea el canal específico al que se compartió por limitaciones de privacidad de iOS y por consistencia entre plataformas.
- Compartir perfil de agente: **no disponible en MVP**. Solo se comparten videos individuales.

---

## 22. Notificaciones

### 22.1 Centro de notificaciones in-app

- Pantalla dedicada accesible desde la tab Notificaciones del bottom bar.
- Lista vertical de notificaciones ordenadas por fecha (más reciente primero).
- Marca de no leída (punto lateral) hasta que el usuario toque la notificación.
- En MVP no hay agrupación por tipo; las notificaciones aparecen en lista cronológica simple. Agrupación queda como mejora post-MVP.
- Al tocar una notificación, navega al contenido relevante.
- **Retención:** las notificaciones se conservan 30 días en el centro; después se eliminan automáticamente. Retención de 90 días queda como mejora post-MVP.
- Acción "Marcar todo como leído" disponible globalmente.

### 22.2 Notificaciones push (móvil)

- El sistema utiliza los servicios nativos del fabricante: APNs para iOS y FCM (Firebase Cloud Messaging) para Android.
- En MVP se usa FCM como hub unificado por su soporte multiplataforma y su integración estándar con React Native.
- Si el usuario rechaza permisos de notificación, las notificaciones se siguen generando como notificaciones in-app dentro del centro de notificaciones. El usuario puede activar push después desde Configuración.
- Las notificaciones se siguen entregando aunque la app esté cerrada.
- Si el usuario cierra sesión, el token de push se invalida.

### 22.3 Catálogo de notificaciones MVP


| Evento                                       | Push | In-app | Audiencia                      |
| -------------------------------------------- | ---- | ------ | ------------------------------ |
| Publicación aprobada                         | Sí   | Sí     | Publicador                     |
| Publicación rechazada (con motivo)           | Sí   | Sí     | Publicador                     |
| Publicación requiere cambios                 | Sí   | Sí     | Publicador                     |
| Publicación suspendida por admin             | Sí   | Sí     | Publicador                     |
| Procesamiento de video listo                 | Sí   | Sí     | Publicador                     |
| Procesamiento de video falló                 | Sí   | Sí     | Publicador                     |
| Video por expirar (7 y 1 día antes)          | Sí   | Sí     | Publicador                     |
| Video expirado                               | Sí   | Sí     | Publicador                     |
| Crédito por caducar (7 días antes)           | Sí   | Sí     | Comprador del crédito          |
| Solicitud de agente independiente aprobada   | Sí   | Sí     | Solicitante                    |
| Solicitud de agente independiente rechazada  | Sí   | Sí     | Solicitante                    |
| Token de inmobiliaria validado correctamente | No   | Sí     | Solicitante                    |
| Inmobiliaria dada de baja                    | Sí   | Sí     | Sus agentes asociados          |
| Nuevo comentario en mi publicación           | Sí   | Sí     | Publicador                     |
| Nuevo lead (contacto)                        | Sí   | Sí     | Agente                         |
| Nuevo seguidor                               | No   | Sí     | Agente                         |
| Nuevo video de un agente que sigues          | Sí   | Sí     | Seguidores                     |
| Resumen semanal de métricas                  | No   | Sí     | Publicador                     |
| VOH cercano (post-MVP)                       | Sí   | Sí     | Usuarios cercanos / seguidores |


- Cada categoría de notificación se controla con un toggle en Configuración → Notificaciones.
- El resumen semanal consolida actividad reciente para evitar ruido por cada like/guardado individual.

---

## 23. Perfiles, visibilidad y configuración

### 23.1 Perfil de agente


| Sección                               | Visible al público | Visible al dueño  |
| ------------------------------------- | ------------------ | ----------------- |
| Foto, nombre, badge                   | Sí                 | Sí                |
| Inmobiliaria (si aplica)              | Sí                 | Sí                |
| Bio                                   | Sí                 | Sí                |
| Redes sociales                        | Sí                 | Sí                |
| Propiedades activas                   | Sí                 | Sí                |
| Propiedades cerradas                  | Sí (sin métricas)  | Sí (con métricas) |
| Seguidores (conteo)                   | Sí                 | Sí                |
| Lista de seguidores                   | No                 | Sí                |
| Métricas individuales por publicación | No                 | Sí                |
| Botón "Editar perfil"                 | No                 | Sí                |
| Acceso al CRM                         | No                 | Sí (vía drawer)   |


Reglas adicionales:

- Bio con límite amplio de caracteres.
- Teléfono no se muestra públicamente en perfil.
- Teléfono solo se muestra al abrir WhatsApp/contacto.
- No se muestra fecha de verificación.
- Rating y reseñas son post-MVP.

### 23.2 Perfil de publicador premium

- Mismo esquema visual que el perfil del agente, con las siguientes diferencias:
  - Sin badge.
  - Sin inmobiliaria.
  - Sin CRM ni drawer.
  - Sin seguidores ni botón de seguir; los usuarios premium no son seguibles.
- Mantiene propiedades activas, propiedades cerradas y botón de editar perfil para el dueño.

### 23.3 Historial de propiedades vistas

- En MVP no se guarda historial visible al usuario de las propiedades vistas.
- Solo se conservan los **guardados** como única lista accesible desde el perfil del usuario.
- Los eventos crudos de vistas sí se almacenan en backend para alimentar métricas y futuras recomendaciones, pero no se exponen como historial al usuario.

---

## 24. Reportes y bloqueos

### 24.1 Reportes de propiedades

- Cualquier usuario registrado o superior puede reportar una propiedad desde el popup de detalles.
- **Motivos predefinidos:**
  - Propiedad no existe / fraude.
  - Información engañosa.
  - Precio falso o engañoso.
  - Dirección incorrecta.
  - Video inapropiado.
  - Duplicado.
  - Otro (con campo de texto libre obligatorio).
- **Comportamiento al reportar:**
  - 1-2 reportes independientes: la publicación entra a cola de revisión prioritaria del admin sin ocultarse.
  - 3 o más reportes independientes en menos de 24 horas: la publicación se suspende automáticamente (`suspended`) hasta revisión.
- El admin puede restaurar, requerir cambios, mantener suspendida o eliminar definitivamente.
- El publicador recibe notificación cuando su publicación es reportada y suspendida automáticamente.
- Un usuario no puede reportar la misma propiedad dos veces.

### 24.2 Reportes y bloqueo entre usuarios

- Reportes de perfiles de publicadores (premium/agente): disponibles desde la pantalla de perfil.
- Reportes de comentarios: definidos en la sección Comentarios.
- **Bloqueo entre usuarios:** no incluido en MVP. El contacto real entre usuario y agente ocurre en WhatsApp, donde WhatsApp tiene su propio bloqueo.

---

## 25. Eliminación de cuenta y baja de contenido

### 25.1 Flujo de eliminación de cuenta

- Acceso desde Configuración → Cuenta → Eliminar cuenta.
- Pantalla intermedia obligatoria con **selección del motivo de baja**, alimentando feedback de producto:
  - Ya no busco propiedades.
  - Encontré lo que buscaba.
  - La experiencia no me convenció.
  - No encuentro propiedades relevantes para mí.
  - Problemas técnicos.
  - Otro (campo de texto libre obligatorio).
- Confirmación con OTP enviado al correo o teléfono registrado.
- Al confirmar:
  - La cuenta pasa a `pending_deletion` con marca de fecha.
  - Las publicaciones del usuario pasan a `deleted_soft`.
  - Los leads asociados (si es agente) pasan a `deleted_soft` con retención de 30 días.
  - El usuario es deslogueado inmediatamente y no puede volver a iniciar sesión.
- Ventana de gracia de 15 días durante los cuales el usuario puede contactar a soporte para revertir la eliminación.
- Después de 15 días: eliminación definitiva (`deleted_hard`) de datos personales identificables.
- Comentarios públicos del usuario eliminado se anonimizan a "Usuario eliminado".
- Métricas agregadas anonimizadas se conservan (válido bajo LFPDPPP siempre que no se puedan rastrear a la persona).
- Auditoría: registro de fecha de solicitud, motivo seleccionado, fecha de eliminación efectiva, IP.

### 25.2 Baja de cuenta de agente

- Cuando un agente se da de baja (eliminación de cuenta o suspensión definitiva por la inmobiliaria o el admin):
  - Todas sus publicaciones activas se marcan como `deleted_soft` y dejan de aparecer en feed y mapa.
  - Todos sus leads asociados se marcan como `deleted_soft` y dejan de ser visibles para nadie.
  - El contenido y los datos se conservan en backend durante 1 mes adicional como retención.
  - Durante ese mes, la inmobiliaria del agente puede solicitar al admin la exportación de los leads asociados (no la transferencia automática a otro agente; eso es post-MVP).
  - Después de los 30 días, las publicaciones, sus videos y los leads se eliminan definitivamente (`deleted_hard`).
- En MVP no se realiza transferencia automática de propiedades ni leads entre agentes.

### 25.3 Baja de cuenta de usuario premium

- Mismo comportamiento que el agente respecto a sus publicaciones: `deleted_soft` con retención de 30 días, luego `deleted_hard`.
- El usuario premium no tiene leads asociados.

### 25.4 Baja de cuenta de usuario registrado

- Sus interacciones (likes, guardados, comentarios, follows) se anonimizan o eliminan según política de protección de datos.
- Sus comentarios públicos se conservan anonimizados ("Usuario eliminado") para no romper el hilo.

### 25.5 Baja de cuenta de inmobiliaria

- Si la inmobiliaria como entidad se da de baja:
  - Cada agente asociado pasa automáticamente a **agente independiente**.
  - Conservan badge de agente, CRM, publicaciones activas, leads, métricas y seguidores.
  - Su perfil deja de mostrar la inmobiliaria.
  - Reciben notificación informativa de que su inmobiliaria ya no opera y de que ahora son agentes independientes.
  - Los datos administrativos de la inmobiliaria se conservan durante 1 mes en backend y luego se eliminan.

---

## 26. Métricas y eventos

### 26.1 Definición operativa de "video visto"

- Un video se considera visto cuando estuvo visible en pantalla al menos **3 segundos** continuos.

### 26.2 Porcentaje visto

- Se calcula como `segundos vistos / duración del video × 100`.
- Se guarda el porcentaje máximo alcanzado por exposición.

### 26.3 Video completado

- Se considera completado cuando el usuario alcanza al menos el **95%** de la duración del video.

### 26.4 Vistas únicas vs múltiples

- Cada exposición genera un evento independiente en la tabla de eventos.
- Las métricas públicas mostradas al publicador se calculan como vistas únicas por usuario por video.
- Los eventos completos permiten recalcular métricas o construir recomendaciones más adelante.

### 26.5 Estructura del evento `view`

- `id`, `user_id`, `video_id`, `property_id`, `started_at`, `seconds_watched`, `percent_watched`, `completed` (boolean), `device`, `session_id`.

### 26.6 Métricas por publicación (para publicador)

Acceso desde "Mis publicaciones" → tocar publicación:

- Vistas totales únicas.
- Vistas con video completado.
- Promedio de porcentaje visto.
- Likes, guardados, comentarios, compartidos, contactos.
- Gráfica de evolución diaria de los últimos 30 días.
- Comparativa rápida vs. promedio del agente.

### 26.7 Métricas agregadas (para agentes)

Acceso desde drawer → Analítica:

- Totales por métrica.
- Top 3 publicaciones por engagement.
- Distribución de leads por estado del embudo.
- Evolución semanal.

### 26.8 Eventos crudos para análisis

Guardar eventos crudos para poder recalcular métricas:

- Video visto.
- Porcentaje visto.
- Like.
- Guardado.
- Comentario.
- Compartido.
- Follow.
- Click en contacto.
- WhatsApp abierto.

---

## 27. Landing page

- Página web pública estática en el dominio principal de Urbea.
- Sirve también como destino de deep links de videos compartidos en una ruta específica del estilo `urbea.com/v/[id]`.
- Mobile-first responsive.
- Tecnología definida: **Astro como sitio estático**.

### 27.1 Secciones de la landing

1. **Hero:** propuesta de valor breve, logos de tienda (App Store y Play Store), CTA principal de descarga.
2. **Cómo funciona:** 3-4 pasos visuales (ver videos → guardar → contactar → encontrar tu hogar).
3. **Para agentes inmobiliarios:** no es una opción pública abierta. El bloque promociona la modalidad pero no expone botón directo de registro. Cuando un usuario toca CTA secundario "Soy agente, quiero saber más", se le muestra un formulario para captar interesados con los campos: nombre, apellido, teléfono y correo electrónico.
4. **Beta cerrada:** mensaje "Estamos en beta cerrada, solicita acceso" con campo de email para lista de espera.
5. **Footer:** términos, aviso de privacidad, contacto, redes sociales.

### 27.2 Captación de interesados a agente

- Los datos del formulario "Soy agente, quiero saber más" se almacenan en una tabla específica del backend de Urbea: `agent_interest_submissions`.
- Campos guardados: nombre, apellido, teléfono, correo electrónico, fecha de envío, IP, fuente (landing/app), estado (`new`, `contacted`, `archived`).
- El admin tiene acceso a esta tabla desde el panel de administración para gestionar el seguimiento manual.

---

## 28. Panel de administración

### 28.1 Plataforma

- **Web app separada** del cliente móvil.
- Mobile-first responsive para revisión puntual desde celular si urge, aunque el flujo principal sea desde escritorio.

### 28.2 Subroles de administrador en MVP

- Solo existe el rol **super admin** en MVP.
- Hay **2 super admins** en MVP.
- Las cuentas de super admin solo se crean por seed directo a base de datos o por invitación explícita de otro super admin.
- El rol de moderador con permisos limitados se evaluará post-MVP si el volumen lo requiere.

### 28.3 Pantallas principales del panel

1. **Dashboard inicial:** métricas globales (usuarios activos, publicaciones por estado, leads totales, reportes pendientes).
2. **Cola de moderación de publicaciones:**
  - Filtros por estado y prioridad.
  - Lista con reproducción de video y datos clave.
  - Acciones: Aprobar / Rechazar (con motivo) / Pedir cambios (con motivo) / Suspender.
3. **Cola de moderación de comentarios:**
  - Comentarios en `held_for_review` y comentarios reportados.
  - Acciones: Publicar / Eliminar / Restaurar / Sancionar al autor.
4. **Gestión de usuarios:**
  - Búsqueda por nombre, correo, teléfono.
  - Vista de detalle con historial completo.
  - Acciones: Suspender / Reactivar / Eliminar / Cambiar rol manualmente / Aprobar solicitud de agente independiente.
5. **Gestión de inmobiliarias:**
  - Cola de aprobación de nuevas inmobiliarias.
  - Detalle con documentación.
  - Acciones: Aprobar / Rechazar / Suspender / Reactivar.
6. **Cola de reportes:**
  - Reportes de propiedades y de usuarios.
7. **Gestión de invitaciones de beta:**
  - Generación y gestión de códigos de invitación.
8. **Captación de interesados a agente:**
  - Listado de envíos de `agent_interest_submissions`.
  - Acciones: marcar como contactado, archivar, exportar.
9. **Configuración y catálogos:**
  - Tipos de propiedad disponibles.
  - Precios y planes.
  - Lista de palabras del filtro automático de comentarios.
10. **Auditoría:**
  - Log de acciones de admins con búsqueda y filtros.

### 28.4 Comunicación admin-publicador

- Al rechazar o pedir cambios, el admin redacta un **motivo obligatorio** en texto libre.
- El motivo se envía al publicador como notificación push, in-app y correo.
- El motivo queda visible dentro de "Mis publicaciones" para referencia durante las correcciones.
- En MVP no hay chat bidireccional admin-publicador.

### 28.5 Auditoría de acciones del admin

- Toda acción del admin queda registrada en la tabla `admin_actions` con: `admin_id`, timestamp, tipo de acción, entidad afectada (tipo + id), valores anteriores y nuevos, motivo si aplica, IP.
- La tabla es inmutable; no se permite editar ni eliminar registros.
- Accesible desde el panel en la sección de Auditoría.
- Retención permanente durante la vida del producto.

---

## 29. Virtual Open House (arquitectura preparatoria)

- VOH es **post-MVP**.
- Aunque no se desarrolla en MVP, el esquema reserva las tablas necesarias para no requerir migración futura.
- **Tablas preparadas:**
  - `live_events`: id, agent_id, property_id, scheduled_at, started_at, ended_at, status, stream_url.
  - `live_event_viewers`: id, live_event_id, user_id, joined_at, left_at.
- En MVP no se desarrolla UI ni infraestructura de streaming.

### 29.1 Comportamiento previsto post-MVP

- Funciona como live tradicional.
- Debe estar ligado a una propiedad aprobada.
- Solo puede hacerlo un agente verificado.
- Si el usuario está cerca y activo en la app, VOH se muestra como evento.
- Si el usuario está cerca pero no activo, recibe notificación.
- Seguidores del agente reciben notificación aunque no estén cerca de la propiedad del VOH.

---

## 30. Validación y antifraude

- Permitir publicación con teléfono/correo verificados.
- Requerir declaración explícita de autorización para publicar.
- Mantener revisión manual obligatoria antes de activar.
- En caso de reporte por fraude/no autorización, suspender temporalmente la publicación hasta revisión.
- Guardar evidencia mínima: identidad del publicador, teléfono verificado, IP/dispositivo, dirección de propiedad, timestamp y aceptación de responsabilidad.
- Para agentes/inmobiliarias verificadas, pedir documentación más formal post-beta.

---

## 31. Idioma e internacionalización

- MVP únicamente en **español**.
- La estructura interna debe estar preparada para internacionalización futura (textos en archivos de traducción, no hard-coded), sin habilitar un segundo idioma.

---

## 32. Diseño de base de datos

### 32.1 Enfoque general

- **PostgreSQL** como base de datos relacional principal (gestionada vía Supabase).
- Extensión **PostGIS** para datos geoespaciales (búsqueda por radio, mapa).

### 32.2 Entidades agrupadas por dominio

**Identidad y autenticación:**

- `users`, `user_auth_providers`, `user_consents`, `terms_versions`, `invitation_codes`, `phone_otps`, `email_otps`.

**Inmobiliarias y agentes:**

- `agencies`, `agency_members`, `agency_invitation_tokens`, `agent_applications`, `agent_interest_submissions`.

**Propiedades y video:**

- `properties`, `property_videos`, `property_versions`.

**Pago y créditos:**

- `purchases`, `video_slots`.

**Interacciones y eventos:**

- `interactions`, `views`, `saves`, `likes`, `follows`, `shares`, `events_raw`.

**CRM:**

- `leads`, `lead_status_history`, `lead_notes`, `lead_origin_properties`.

**Comentarios:**

- `comments`, `comment_reports`.

**Moderación y auditoría:**

- `property_reports`, `admin_actions`, `notifications`.

**VOH (preparatoria):**

- `live_events`, `live_event_viewers`.

### 32.3 Índices recomendados

- Índice geoespacial `GIST` sobre `properties.location_point` para búsquedas por radio.
- Índice compuesto `(status, created_at DESC)` sobre `properties` para feed.
- Índice `(user_id, created_at DESC)` sobre `interactions` y `views`.
- Índice `(agent_id, score DESC)` sobre `leads`.
- Índices únicos `(email)` y `(phone)` sobre `users`.
- Índices `GIN` con `pg_trgm` sobre campos de búsqueda de texto (`properties.address`, `agencies.name`, etc.).

### 32.4 Manejo de soft delete y retención

- Campo `deleted_at` en `properties`, `property_videos`, `leads`, `comments`, `notifications`.
- Job programado diario para purga definitiva de registros con `deleted_at + retention_days < now()`.
- Retención por tipo:
  - Leads y publicaciones de agente dado de baja: 30 días.
  - Comentarios eliminados: 30 días.
  - Notificaciones: 30 días.
  - Auditoría: permanente.

### 32.5 Eventos crudos para métricas

- Tabla `events_raw` append-only con `event_type`, `payload jsonb`, `user_id`, `created_at`.
- Permite recalcular métricas y entrenar futuras recomendaciones.
- Si crece demasiado, considerar exportación a data warehouse en fase de escalado.

---

## 33. Stack tecnológico

### 33.1 Decisión de stack

Stack basado en **Supabase como BaaS** con video especializado en Cloudflare Stream. Esta decisión prioriza velocidad de desarrollo y costo inicial sobre el máximo control de backend. Las consideraciones técnicas detalladas de uso correcto del stack se documentan en `lineamientos-desarrollo.md`.

### 33.2 Stack completo


| Capa                                              | Tecnología                                                             | Justificación                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| App móvil iOS y Android                           | React Native + Expo                                                    | Una sola base de código, ecosistema maduro, despliegue ágil.  |
| Lenguaje cliente                                  | TypeScript                                                             | Type safety end-to-end.                                       |
| Backend / BaaS                                    | Supabase (Auth + Postgres + RLS + Storage + Edge Functions + Realtime) | Auth, base de datos y autorización gestionados.               |
| Base de datos                                     | PostgreSQL + PostGIS (gestionado por Supabase)                         | Estándar relacional, soporte geoespacial nativo.              |
| Video streaming                                   | Cloudflare Stream                                                      | Pipeline de transcodificación, adaptive bitrate y CDN global. |
| Almacenamiento de imágenes (thumbnails, avatares) | Supabase Storage o Cloudflare R2                                       | Compatibilidad y costo.                                       |
| Mapas                                             | Google Maps SDK (iOS, Android) + Places API                            | Calidad de datos en México, autocompletado nativo.            |
| Push notifications                                | FCM (Firebase Cloud Messaging) vía Expo Notifications                  | Hub unificado iOS + Android, integración nativa con Expo.     |
| Pasarela de pagos                                 | Stripe (post-beta)                                                     | Cobertura completa de métodos en MX (tarjeta, OXXO, SPEI).    |
| Email transaccional                               | Resend o Postmark                                                      | Deliverability confiable.                                     |
| OTP SMS                                           | Twilio (vía Supabase Auth integration)                                 | Estándar para OTP en MX.                                      |
| Panel administrativo                              | Next.js + Tailwind + Supabase Client                                   | Productividad y consistencia.                                 |
| Landing page                                      | Astro estático                                                         | Sitio rápido, SEO-friendly, bajo costo.                       |
| Observabilidad                                    | Sentry (errores) + Supabase logs + Logflare                            | Detección temprana de bugs y monitoreo.                       |
| Hosting web (admin + landing)                     | Vercel                                                                 | Despliegue rápido, integración GitHub.                        |
| CI/CD                                             | EAS Build (Expo) + Vercel + GitHub Actions                             | Pipelines automáticos.                                        |


### 33.3 Lineamientos de uso del stack

El uso correcto del stack Supabase requiere disciplina específica para evitar antipatrones comunes que generan deuda técnica oculta. El documento `lineamientos-desarrollo.md` documenta:

- Antipatrones a evitar con triggers de PostgreSQL.
- Reglas de uso de RLS como segunda capa de seguridad.
- Patrones para Edge Functions, jobs programados, webhooks de Stripe y procesamiento de video.
- Convenciones de migraciones, observabilidad y testing.

**Este documento es de lectura obligatoria antes de desarrollar.**

### 33.4 Costo operativo estimado


| Escala                                           | Costo mensual estimado (USD) |
| ------------------------------------------------ | ---------------------------- |
| 0-500 usuarios (MVP en beta)                     | ~$80 - $120                  |
| 500-2,000 usuarios (lanzamiento público inicial) | ~$90 - $150                  |
| 2,000-10,000 usuarios (escalado)                 | ~$200 - $400                 |


---

## 34. Métricas de éxito del MVP

### 34.1 KPIs técnicos

- Scroll de video sin latencia perceptible.
- Experiencia fluida y estable.
- Tiempo de carga del primer video < 2 segundos en condiciones normales de red.
- Tasa de fallos de procesamiento de video < 5%.

### 34.2 KPIs de adopción en beta

- Al menos **50 agentes registrados**.
- Al menos **150 usuarios pasivos** buscando comprar/rentar.

### 34.3 KPIs por publicación

- Likes.
- Vistas.
- Guardados.
- Contactos.

---

## 35. Anexos

### 35.1 Decisiones definitivas (no negociables sin revisión del cliente)

- Dirección exacta obligatoria y siempre visible públicamente.
- 2 super admins en MVP, sin rol de moderador.
- VOH post-MVP.
- Facturación CFDI post-MVP.
- Bloqueo entre usuarios post-MVP.
- Transferencia de propiedades entre agentes post-MVP.
- Idioma único: español.
- Beta cerrada con códigos de invitación de un solo uso, sin invitación entre usuarios.

### 35.2 Funcionalidades explícitamente fuera del MVP (post-MVP)

- Web app de escritorio.
- VOH.
- Facturación CFDI.
- Login con Facebook.
- Documentación obligatoria para agentes e inmobiliarias.
- Transferencia de propiedades entre agentes de la misma inmobiliaria.
- Invitación de agentes por correo (alternativa al token).
- Estados personalizados de leads.
- Vista kanban del CRM.
- Recordatorios programados en CRM.
- Integración con WhatsApp Business API.
- Compartir perfiles de agente.
- Bloqueo entre usuarios.
- Agrupación de notificaciones por tipo.
- Retención de notificaciones a 90 días.
- Reapertura de propiedades cerradas.
- Detección automática de cierres de propiedad.
- Rating y reseñas de agentes.

