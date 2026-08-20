-- Migración 20260820000006 — seed del aviso de privacidad v2.0 (subtarea #170.9).
--
-- 🔴 DECISIÓN DE ABRAHAM (D3, /tm-plan 2026-08-15): esta migración SIEMBRA la
-- versión nueva con is_current = FALSE. Publicarla es un UPDATE aparte que él
-- dispara cuando elija el momento.
--
-- POR QUÉ NO SE PUBLICA AQUÍ: poner una versión como vigente FUERZA
-- re-consentimiento a TODOS los usuarios vivos —la maquinaria de #72.6
-- (pending_legal_consents() + legal-wall INLINE, no ruta) ya está montada y
-- probada en 3 consumidores— y eso no puede caer por sorpresa en medio de una
-- demo con inversores. Así el PR de 170 se mergea sin disparar el muro legal.
--
-- CONTEXTO QUE HACE ESTO URGENTE Y NO BUROCRÁTICO: el aviso VIGENTE hoy es un
-- placeholder de 113 caracteres que personas reales ya aceptaron.
--
-- 🔴 EL FLIP, ESCRITO Y ENSAYADO — NO se improvisa el día que toque.
-- `terms_versions_one_current_per_doctype` (20260604000004:50-51) es UNIQUE
-- sobre (doc_type) WHERE is_current is true, así que apagar el viejo y
-- encender el nuevo TIENEN que ir en la MISMA transacción y EN ESE ORDEN:
--
--   begin;
--     update public.terms_versions set is_current = false
--      where doc_type = 'privacy' and is_current;
--     update public.terms_versions set is_current = true
--      where doc_type = 'privacy' and version = '2.0';
--   commit;
--
-- El orden inverso lo RECHAZA el índice. supabase/tests/61_* ensaya los dos y
-- asserta que el equivocado falla — para que "en este orden" sea un requisito
-- verificado y no una preferencia de estilo.
--
-- QUÉ TEXTO SE SIEMBRA, exactamente: el título de docs/aviso-privacidad.md más
-- las secciones 1 a 9. Se dejan FUERA, a propósito:
--   · el anexo técnico, que dice explícitamente "no forma parte del aviso al
--     usuario";
--   · las notas de cabecera del borrador (⚠️ BORRADOR TÉCNICO, pendientes
--     legales, el 🔴 sobre el orden de publicación). Son mensajes del equipo
--     para el equipo — sembrarlas sería mostrarle a una persona el andamio en
--     vez del documento.
-- Siguen DENTRO los `[Pendiente legal: ...]` de las secciones 1, 6 y 7: esos
-- sí son parte del texto, y su presencia es justamente la señal de que este
-- aviso no debe hacerse vigente sin revisión de un abogado.
--
-- ADITIVA: un INSERT que no colisiona con el índice porque is_current=false.
-- Idempotente: on conflict (doc_type, version) do nothing.
-- Rollback: supabase/migrations/rollbacks/20260820000006_seed_privacy_ads.sql

insert into public.terms_versions (doc_type, version, content, is_current, effective_from)
values (
  'privacy',
  '2.0',
  '# Aviso de Privacidad — Urbea

## 1. Quién trata tus datos

Urbea (el "responsable"). *[Pendiente legal: razón social, RFC, domicilio y correo de contacto del responsable.]*

## 2. Qué datos recabamos

**Los que nos das al registrarte:** nombre y apellido, correo electrónico, teléfono, fecha de nacimiento, estado y municipio. Opcionalmente: foto de perfil y una descripción breve.

**Los que generas al usar la app:** las propiedades a las que das like o guardas, y tu comportamiento con los videos del feed — que lo viste, que lo viste completo y cuántas veces volviste. También registramos cuándo abres la aplicación, y tu interacción con los anuncios que aparecen en el feed (sección 5).

**Los que necesitamos para funciones concretas:** tu ubicación aproximada, solo mientras usas la app y solo si nos das permiso, para mostrarte propiedades cercanas.

**Lo que aceptaste:** guardamos qué versión de los términos y de este aviso aceptaste, y cuándo.

**Diagnóstico de la app:** cuando una parte de la aplicación falla —por ejemplo, si no logramos cargar los anuncios del feed— registramos que ocurrió el fallo, en qué tramo y en qué sesión, ligado a tu cuenta. **No registramos qué estabas viendo, ni dónde estabas, ni ningún contenido**: solo que algo no funcionó, para poder darnos cuenta y arreglarlo. Nadie fuera de Urbea tiene acceso a estos registros.

## 3. Para qué los usamos

- Crear y mantener tu cuenta, y verificar tu identidad al iniciar sesión.
- Mostrarte propiedades relevantes y ordenar el feed por cercanía.
- Ponerte en contacto con el agente inmobiliario cuando **tú** decides contactarlo.
- Darle a ese agente —y solo a él— información sobre tu interés, según la sección 4.
- Mostrarte publicidad identificada como tal, elegida por la zona que estás viendo, y medir cuánto se vio, según la sección 5.
- Operar, medir y mejorar el servicio de forma agregada.

**No vendemos tus datos.** Sí mostramos publicidad, pero los anunciantes no reciben tu información: cómo funciona exactamente está en la sección 5.

## 4. Lo más importante: qué ve el agente inmobiliario, y cuándo

Esta es la regla central del servicio y queremos que sea inequívoca.

**Antes de que contactes a un agente, ese agente no ve absolutamente nada tuyo.** Ni tu nombre, ni tu foto, ni tu correo, ni tu teléfono. Tampoco ve que viste sus videos, ni que les diste like, ni que guardaste sus propiedades. Puedes recorrer todo el feed sin que nadie sepa quién eres.

Sí registramos esa actividad en nuestros sistemas desde el primer momento — pero **registrar no es mostrar**: queda guardada y nadie del lado inmobiliario puede consultarla.

**En el momento en que tocas "Contactar agente"** en alguna de sus publicaciones, y solo con ese agente:

- Le compartimos tus datos de contacto: nombre completo, foto de perfil (si tienes), estado y ciudad, correo electrónico y teléfono.
- Le damos acceso **retroactivo** a tu historial de interacciones con **todas las publicaciones de ese agente** — incluidas las anteriores al contacto. Es decir: al contactarlo, ese agente puede ver que ya habías visto sus otros videos.
- Ese acceso alcanza también a la persona dueña o administradora de la inmobiliaria a la que pertenece ese agente, porque gestionan su cartera.

**Lo que ese agente nunca ve**, ni siquiera después del contacto: tus preferencias de búsqueda, tu actividad con publicaciones de **otros** agentes, tus notificaciones, ni qué documentos legales aceptaste.

**Si el lead se elimina, el acceso se revoca.** No queda una copia del historial del lado del agente.

## 5. Publicidad en el feed

Entre las propiedades del feed pueden aparecer **videos de anunciantes** — negocios como créditos hipotecarios, seguros, mudanzas o notarías. Siempre van marcados como **«Patrocinado»**. Si no lo dice, no es publicidad.

**Elegimos qué anuncio mostrarte por el lugar que estás viendo, no por quién eres.** Si estás explorando una colonia o un municipio, ves los anuncios contratados para esa zona. No construimos un perfil publicitario tuyo: no usamos tu historial de likes, de propiedades guardadas ni de agentes contactados para decidir qué anuncio te toca, y no cruzamos tus datos con los de terceros.

**Qué registramos cuando ves un anuncio:** que se te mostró, cuánto tiempo lo viste, si tocaste su botón, y la zona y la sesión en las que ocurrió. Ese registro queda ligado a tu cuenta dentro de nuestros sistemas. Para efectos del cobro al anunciante, un anuncio cuenta como **visto a partir de los 3 segundos** de reproducción; pasar de largo antes de eso no se le cobra.

**Qué ve el anunciante: nunca tu identidad.** No recibe tu nombre, tu correo, tu teléfono, tu ubicación ni ningún identificador tuyo — tampoco uno seudonimizado. Hoy los anunciantes **no tienen ningún acceso a nuestros sistemas**: no existe panel, consulta ni exportación para ellos. Lo único que reciben es un reporte que les entregamos nosotros, con **totales por zona y por periodo**: cuántas veces se mostró su anuncio, cuánto se vio en promedio y cuántas personas tocaron su botón.

**Cuánto lo conservamos:** el registro detallado se conserva un máximo de **90 días** y después se elimina. Los totales mensuales por zona, que ya no permiten llegar a una persona, se conservan como base de facturación al anunciante.

**Cualquier enlace de un anuncio te saca de Urbea** — su botón, y también los enlaces que aparezcan dentro del texto del anuncio. Se abre WhatsApp, tu marcador telefónico o el sitio del anunciante. Desde ese momento, lo que compartas lo trata ese anunciante bajo **su propio** aviso de privacidad, no bajo éste — y si lo contactas por WhatsApp o por teléfono, verá tu número. En el texto de un anuncio **lo que ves escrito es exactamente la dirección que se abre**: no ocultamos un destino detrás de otras palabras.

**Puedes oponerte.** La publicidad es parte del servicio gratuito y no puede desactivarse por ahora, pero puedes ejercer tu derecho de oposición sobre la medición conforme a la sección 7.

## 6. Cuánto tiempo los conservamos

Mientras tu cuenta esté activa. Al solicitar la baja, tu cuenta entra en un periodo de eliminación y después se borra o se anonimiza. *[Pendiente de definir: plazos concretos de retención por tipo de dato — ver PRD §19.10.]*

## 7. Tus derechos (ARCO)

Puedes solicitar **acceso** a tus datos, su **rectificación** si son incorrectos, su **cancelación**, u **oponerte** a determinados usos. También puedes revocar tu consentimiento.

*[Pendiente legal: correo y procedimiento formal para ejercerlos, plazos de respuesta y autoridad ante la que acudir.]*

## 8. Dónde se guardan

En infraestructura de Supabase (base de datos y almacenamiento) y Cloudflare Stream (los videos). Ambos pueden alojar la información fuera de México. Al usar Urbea aceptas esa transferencia.

## 9. Cambios a este aviso

Publicaremos cualquier cambio en la aplicación con su número de versión y fecha. Si el cambio es sustancial, te pediremos aceptarlo de nuevo antes de continuar usando el servicio.
',
  false,
  now()
)
on conflict (doc_type, version) do nothing;
