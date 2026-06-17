# Preguntas de Definición del Proyecto

**Proyecto:** Plataforma Inmobiliaria con Video  
**Fecha:** 6 de Mayo de 2026  
**Elaborado por:** Abraham Cabrera

---

> Este documento reúne las preguntas necesarias para definir con exactitud el alcance, los flujos y el comportamiento de la plataforma antes de iniciar el desarrollo. Las respuestas servirán como base para el documento técnico (PRD) que guiará todo el proyecto.

---

## 1. Identidad y Mercado

**1.1 Nombre de la aplicación**
¿Ya tiene nombre definido? ¿Existe alguna identidad visual (colores, logo, estilo) o se parte de cero?

**1.2 Mercado inicial**
¿La app lanza únicamente en Guadalajara, o en todo México desde el inicio? ¿Hay planes de expansión a otras ciudades o países?

**1.3 Tipo de propiedades**
¿Solo renta residencial (casas y departamentos), o también comercial (locales, oficinas)? ¿Aplica renta de corto plazo (tipo Airbnb) o únicamente largo plazo?

---

## 2. Roles y Niveles de Acceso

**2.1 Usuario sin cuenta**
¿Puede una persona que no se ha registrado ver el feed de videos y propiedades? ¿Puede contactar a un agente sin tener cuenta? ¿Puede dar like o guardar favoritos sin registrarse?

**2.2 Estructura de cuentas para inmobiliarias**
¿Se registra la empresa como un solo perfil, o pueden existir múltiples agentes bajo una misma inmobiliaria?

*Ejemplo:* "Inmobiliaria XYZ" tiene 5 agentes — ¿cada agente tiene su propia cuenta o todos comparten una sola?

**2.3 Registro de inmobiliarias**
¿Cualquier persona puede registrarse como inmobiliaria y publicar de inmediato, o requiere aprobación previa del administrador antes de poder publicar?

**2.4 Roles dentro de una inmobiliaria**
- ¿Existe diferencia entre un "agente" y el "administrador de la inmobiliaria"?
- ¿El administrador de una inmobiliaria puede ver y gestionar las propiedades de todos sus agentes?
- ¿Quién puede eliminar una inmobiliaria o dar de baja a un agente: solo el super admin, o también el admin de la inmobiliaria?
- ¿Un agente puede pertenecer a más de una inmobiliaria al mismo tiempo?

---

## 3. Registro y Onboarding

**3.1 Métodos de inicio de sesión**
¿Qué opciones de login se ofrecen además del correo electrónico? ¿Google, Facebook, Apple? ¿Es necesario ofrecer los tres o solo algunos?

**3.2 Verificación de correo**
¿Se requiere verificar el correo electrónico antes de poder usar la app, o el usuario puede entrar de inmediato tras registrarse?

**3.3 Personalización inicial (Onboarding)**
Al crear una cuenta, ¿se le pregunta al usuario algo para personalizar su experiencia desde el inicio? Por ejemplo: tipo de propiedad que busca, número de habitaciones, rango de precio, zona de interés.

**3.4 Permiso de ubicación**
¿La app puede funcionar si el usuario rechaza el permiso de ubicación? ¿Qué sucede en ese caso?
- ¿Ve un feed genérico?
- ¿Debe ingresar su ciudad manualmente?
- ¿No puede usar la app?

---

## 4. Feed y Descubrimiento de Propiedades

**4.1 Formato del feed**
El concepto menciona un feed estilo TikTok (video vertical a pantalla completa, se desliza hacia arriba). ¿Es exactamente así, o es más un listado tipo catálogo con videos incrustados?

**4.2 Radio de cercanía**
¿Qué distancia define "propiedades cercanas"? ¿5 km, 10 km, toda la ciudad? ¿El usuario puede ajustar ese radio desde la app?

**4.3 Orden del feed para usuarios nuevos**
Un usuario recién registrado sin historial de uso — ¿qué ve primero?
- ¿Las propiedades más cercanas a su ubicación?
- ¿Las más recientes?
- ¿Las más vistas?

**4.4 Filtros disponibles**
De los siguientes filtros, ¿cuáles deben estar disponibles en el MVP?

| Filtro | ¿Incluir en MVP? |
|--------|-----------------|
| Precio (rango mínimo – máximo) | |
| Número de habitaciones | |
| Número de baños | |
| Tipo de propiedad (casa, depto, local) | |
| Colonia o zona específica | |
| Amueblado / sin amueblar | |
| Pet-friendly | |
| Otro (especificar): | |

**4.5 Mapa vs. feed**
¿El mapa es una vista alternativa al feed (el usuario elige entre "ver feed" o "ver mapa"), o ambas vistas están disponibles al mismo tiempo?

---

## 5. Publicación de Propiedades

**5.1 Información requerida por propiedad**
¿Qué datos mínimos debe ingresar una inmobiliaria para publicar una propiedad?

| Campo | ¿Obligatorio u Opcional? |
|-------|--------------------------|
| Título / nombre de la propiedad | |
| Descripción | |
| Precio de renta mensual | |
| Dirección (¿exacta o solo colonia/zona?) | |
| Número de habitaciones | |
| Número de baños | |
| Superficie en m² | |
| Otro (especificar): | |

> Nota sobre la dirección: ¿se muestra la dirección completa al usuario o solo una referencia aproximada por seguridad?

**5.2 Video**
- ¿Cada propiedad puede tener uno o varios videos?
- ¿Cuál es la duración máxima permitida por video?
- ¿Existe un tamaño máximo de archivo?

**5.3 Fotos**
- ¿Cuántas fotos puede incluir una propiedad?
- ¿Hay un número mínimo requerido?

**5.4 Proceso de aprobación**
Cuando una inmobiliaria publica una propiedad, ¿esta aparece de inmediato en el feed o primero debe ser revisada por un administrador?
¿Cuánto tiempo máximo debería tomar esa revisión?

**5.5 Estados de una propiedad**
¿Cuáles de los siguientes estados aplican al ciclo de vida de una propiedad?

| Estado | ¿Aplica? |
|--------|---------|
| Borrador (guardada, no publicada aún) | |
| En revisión (pendiente de aprobación) | |
| Publicada (visible en el feed) | |
| Pausada (oculta temporalmente por la inmobiliaria) | |
| Rentada / No disponible | |
| Rechazada (por el administrador) | |
| Otro (especificar): | |

**5.6 Edición después de publicar**
Si una inmobiliaria edita una propiedad ya publicada (cambia precio, fotos o video), ¿el cambio es inmediato o vuelve a pasar por revisión?

**5.7 Límite de propiedades**
¿Existe un límite de propiedades activas que puede tener una inmobiliaria en el MVP?

---

## 6. Interacciones del Usuario

**6.1 Diferencia entre "like" y "favorito"**
¿Son la misma acción o tienen funciones distintas?

*Ejemplo:* ¿El like es público (la inmobiliaria puede ver cuántos tiene) y el favorito es privado (solo el usuario lo ve)?

**6.2 Visibilidad de likes para la inmobiliaria**
¿La inmobiliaria puede ver quiénes le dieron like a sus propiedades, o solo el conteo total?

**6.3 Historial de propiedades vistas**
- ¿Cuánto tiempo se conserva el historial de propiedades que el usuario vio?
- ¿El usuario puede borrar su historial?

**6.4 Notificaciones push**
¿La app envía notificaciones? ¿Para cuáles de los siguientes eventos?

| Evento | ¿Notificar? |
|--------|------------|
| Nueva propiedad disponible en la zona del usuario | |
| Reducción de precio en una propiedad guardada como favorito | |
| Confirmación de que el agente recibió la solicitud de contacto | |
| Otro (especificar): | |

---

## 7. Contacto con el Agente

**7.1 Flujo al tocar "Contactar"**
Cuando el usuario presiona el botón de contacto, ¿abre WhatsApp directamente, o primero aparece una pantalla intermedia con la información del agente?

**7.2 Número de WhatsApp**
¿El número de contacto es por agente, por inmobiliaria (uno solo para toda la empresa), o puede ser diferente para cada propiedad?

**7.3 Registro interno de contactos**
¿La app guarda un registro de cuántas veces se hizo clic en "Contactar" por propiedad? ¿La inmobiliaria puede ver esa estadística?

**7.4 Otros canales de contacto**
¿Además de WhatsApp se contempla otro canal? Por ejemplo: llamada telefónica directa o formulario interno.

---

## 8. Panel de Administración (Super Admin)

**8.1 Tipo de acceso**
¿El panel de administración es una sección dentro de la app móvil, o es una aplicación web separada (acceso desde navegador en computadora)?

**8.2 Acciones del administrador**
¿Cuáles de las siguientes acciones debe poder realizar el administrador de la plataforma?

| Acción | ¿Incluir? |
|--------|----------|
| Aprobar o rechazar propiedades | |
| Suspender o eliminar cuentas de usuarios | |
| Suspender o eliminar inmobiliarias | |
| Ver métricas generales de la plataforma | |
| Editar o eliminar cualquier propiedad | |
| Agregar inmobiliarias manualmente | |
| Otro (especificar): | |

**8.3 Métricas del dashboard**
¿Cuáles de los siguientes indicadores son relevantes para el administrador?

| Métrica | ¿Incluir? |
|---------|----------|
| Total de propiedades activas | |
| Total de inmobiliarias registradas | |
| Total de usuarios registrados | |
| Propiedades más vistas / con más likes | |
| Número de contactos generados por período | |
| Otra (especificar): | |

**8.4 Razón de rechazo**
Cuando el administrador rechaza una propiedad, ¿debe indicar el motivo? ¿La inmobiliaria recibe una notificación con esa razón?

---

## 9. Panel de la Inmobiliaria

**9.1 Tipo de acceso**
¿El panel de la inmobiliaria está dentro de la misma app móvil como una sección especial, o es una aplicación web separada?

**9.2 Estadísticas disponibles para la inmobiliaria**
¿Cuáles de las siguientes métricas puede ver la inmobiliaria sobre cada una de sus propiedades?

| Métrica | ¿Incluir? |
|---------|----------|
| Número de veces que se reprodujo el video | |
| Número de likes y favoritos | |
| Número de clics en "Contactar" | |
| Otra (especificar): | |

**9.3 Gestión de agentes**
Si una inmobiliaria puede tener varios agentes, ¿el administrador de la inmobiliaria puede agregar o eliminar agentes desde la app?

---

## 10. Aspectos Legales y de Marca

**10.1 Términos y condiciones / Aviso de privacidad**
¿Ya existen redactados? ¿La app debe mostrarlos al registrarse y requerir que el usuario los acepte explícitamente?

**10.2 Protección de datos personales**
¿La app opera únicamente en México? ¿Debe cumplir con la Ley Federal de Protección de Datos Personales (LFPDPPP)?

**10.3 Idioma**
¿La app es solo en español, o también en inglés desde el MVP?

---

## 11. Diseño y Experiencia

**11.1 Referencias visuales**
¿Hay apps o plataformas cuyo diseño o experiencia de usuario sirvan como referencia o inspiración? (No para copiar, sino como punto de partida de conversación sobre estilo.)

**11.2 Identidad de marca**
¿Ya existen colores, tipografía o logo definidos? ¿O el diseño visual de la app es parte del alcance del proyecto?

**11.3 Pantalla de carga**
¿Se requiere una pantalla de inicio animada (splash screen) con el logo de la app al abrirla?

---

## 12. Funciones Adicionales a Definir

**12.1 Opción de reportar una publicación**
¿Los usuarios pueden reportar una propiedad como inapropiada o sospechosa? En caso afirmativo:
- ¿Qué motivos de reporte estarían disponibles?
- ¿Qué sucede con la publicación al ser reportada: se oculta automáticamente o solo se notifica al administrador?
- ¿Cuántos reportes se necesitan para activar una revisión automática?

**12.2 Perfil de propiedad**
¿Existe una pantalla de detalle dedicada para cada propiedad (más allá del video en el feed)? En caso afirmativo:
- ¿Qué información se muestra en esa pantalla?
- ¿Incluye galería de fotos, descripción completa, mapa con la ubicación, información del agente?
- ¿Desde esa pantalla se puede contactar al agente?

---

*Documento de trabajo — Versión 1.0 — Pendiente de revisión con el cliente*
