# Aviso de Privacidad — Urbea

> ⚠️ **BORRADOR TÉCNICO. NO ESTÁ VIGENTE Y NO DEBE PUBLICARSE SIN REVISIÓN LEGAL.**
>
> Lo vigente hoy en `terms_versions` (`doc_type='privacy'`, v1.0) es un **placeholder de 113 caracteres** que usuarios reales ya aceptaron. Este documento es su reemplazo propuesto: describe con exactitud lo que el sistema hace **hoy**, verificado contra el esquema y las políticas RLS del proyecto `urbea-app` el 2026-08-08.
>
> Falta antes de activarlo: (1) revisión de un abogado en materia de **LFPDPPP** (datos del responsable, domicilio, medios para ejercer derechos ARCO, autoridad ante la que reclamar); (2) decidir el efecto en usuarios existentes — publicarlo como versión vigente **fuerza re-consentimiento a todas las cuentas** ([[legal-consentimientos]]); (3) cerrar la deuda **#116**, porque hoy el sistema comparte más de lo que este texto promete.

---

## 1. Quién trata tus datos

Urbea (el "responsable"). *[Pendiente legal: razón social, RFC, domicilio y correo de contacto del responsable.]*

## 2. Qué datos recabamos

**Los que nos das al registrarte:** nombre y apellido, correo electrónico, teléfono, fecha de nacimiento, estado y municipio. Opcionalmente: foto de perfil y una descripción breve.

**Los que generas al usar la app:** las propiedades a las que das like o guardas, y tu comportamiento con los videos del feed — que lo viste, que lo viste completo y cuántas veces volviste. También registramos cuándo abres la aplicación.

**Los que necesitamos para funciones concretas:** tu ubicación aproximada, solo mientras usas la app y solo si nos das permiso, para mostrarte propiedades cercanas.

**Lo que aceptaste:** guardamos qué versión de los términos y de este aviso aceptaste, y cuándo.

## 3. Para qué los usamos

- Crear y mantener tu cuenta, y verificar tu identidad al iniciar sesión.
- Mostrarte propiedades relevantes y ordenar el feed por cercanía.
- Ponerte en contacto con el agente inmobiliario cuando **tú** decides contactarlo.
- Darle a ese agente —y solo a él— información sobre tu interés, según la sección 4.
- Operar, medir y mejorar el servicio de forma agregada.

**No vendemos tus datos.** No los compartimos con terceros con fines publicitarios.

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

## 5. Cuánto tiempo los conservamos

Mientras tu cuenta esté activa. Al solicitar la baja, tu cuenta entra en un periodo de eliminación y después se borra o se anonimiza. *[Pendiente de definir: plazos concretos de retención por tipo de dato — ver PRD §19.10.]*

## 6. Tus derechos (ARCO)

Puedes solicitar **acceso** a tus datos, su **rectificación** si son incorrectos, su **cancelación**, u **oponerte** a determinados usos. También puedes revocar tu consentimiento.

*[Pendiente legal: correo y procedimiento formal para ejercerlos, plazos de respuesta y autoridad ante la que acudir.]*

## 7. Dónde se guardan

En infraestructura de Supabase (base de datos y almacenamiento) y Cloudflare Stream (los videos). Ambos pueden alojar la información fuera de México. Al usar Urbea aceptas esa transferencia.

## 8. Cambios a este aviso

Publicaremos cualquier cambio en la aplicación con su número de versión y fecha. Si el cambio es sustancial, te pediremos aceptarlo de nuevo antes de continuar usando el servicio.

---

## Anexo técnico (no forma parte del aviso al usuario)

Correspondencia entre las promesas de arriba y lo que las hace cumplir. El inventario completo está en `wiki/conceptos/privacidad-datos.md`.

| Promesa | Mecanismo | Prueba |
| --- | --- | --- |
| §4 "antes del contacto no ve nada tuyo" (identidad) | `users_select` + `private.can_view_user_as_lead_searcher` | `supabase/tests/08_rls_lead_searcher_test.sql` |
| §4 "antes del contacto no ve nada tuyo" (comportamiento) | `events_raw_select` + `private.can_view_user_events` | `supabase/tests/35_lead_privacy_test.sql` (PRIV1, PRIV5, PRIV9) |
| §4 "acceso retroactivo a TODAS sus publicaciones" | misma policy: la propiedad debe ser del agente del lead | `35_` (PRIV3), y PRIV4 acota que no alcanza a otros agentes |
| §4 "si el lead se elimina, el acceso se revoca" | el permiso se deriva de un lead con `deleted_at is null` | `35_` (PRIV11) |
| §4 "nunca ve tus preferencias" | `user_prefs_select` = fila propia o admin | inventario en `privacidad-datos.md` |
| §2 "registramos tu comportamiento de video" | `events_raw` (`video_view`, `video_completed`, `app_open`) | `33_`, `35_` |

⚠️ **Contradicciones vivas entre este texto y el sistema** (deuda #116, cerrarlas antes de publicar):

1. §4 promete que el teléfono se comparte solo con el agente contactado. Hoy `users_select` expone correo y teléfono de **todo agente verificado** a cualquier usuario autenticado. Afecta a los agentes, no a los compradores — pero el aviso también los cubre.
2. §4 enumera los datos compartidos sin incluir la fecha de nacimiento; el PRD §19.4 pide *edad calculada*. Hoy el agente con lead puede leer la **fecha exacta**.
