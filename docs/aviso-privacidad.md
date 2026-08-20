# Aviso de Privacidad — Urbea

> ⚠️ **BORRADOR TÉCNICO. NO ESTÁ VIGENTE Y NO DEBE PUBLICARSE SIN REVISIÓN LEGAL.**
>
> Lo vigente hoy en `terms_versions` (`doc_type='privacy'`, v1.0) es un **placeholder de 113 caracteres** que usuarios reales ya aceptaron. Este documento es su reemplazo propuesto: describe con exactitud lo que el sistema hace **hoy**, verificado contra el esquema y las políticas RLS del proyecto `urbea-app` el 2026-08-08.
>
> Falta antes de activarlo: (1) revisión de un abogado en materia de **LFPDPPP** (datos del responsable, domicilio, medios para ejercer derechos ARCO, autoridad ante la que reclamar); (2) decidir el efecto en usuarios existentes — publicarlo como versión vigente **fuerza re-consentimiento a todas las cuentas** ([[legal-consentimientos]]); (3) cerrar la deuda **#116**, porque hoy el sistema comparte más de lo que este texto promete.
>
> 🔴 **La sección 5 (publicidad) describe algo que TODAVÍA NO EXISTE en producción** — se redacta por delante como gate de la tarea #170, para que el texto se apruebe antes de construir y no al revés. Publicar este aviso **antes** de que la tarea 170 esté desplegada prometería un tratamiento que no ocurre; publicarlo **después** de encender los anuncios sería recabar sin avisar. El orden correcto es: aprobar el texto → construir → sembrar la versión con `is_current=false` → desplegar 170 → **flip**. Ver el anexo técnico: las promesas de §5 están marcadas ⏳ mientras su mecanismo no exista. **Se eliminó a propósito la promesa de k-anonimato** del borrador anterior: no hay umbral definido ni implementado, y prometer por escrito una garantía estadística que nadie calcula es peor que no prometerla.

---

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

**Si tocas el botón de un anuncio, sales de Urbea.** Se abre WhatsApp, tu marcador telefónico o el sitio del anunciante. Desde ese momento, lo que compartas lo trata ese anunciante bajo **su propio** aviso de privacidad, no bajo éste — y si lo contactas por WhatsApp o por teléfono, verá tu número.

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
| §2 "diagnóstico de la app" | `events_raw` (`ads_fetch_failed`, #196): fila con `event_type`, `user_id`, `session_id` y `payload:{stage}` — **exactamente cuatro claves**, sin `property_id`, sin coordenadas, sin `ad_id`. `user_id` no es opcional: la policy `events_raw_insert` exige `user_id = auth.uid()`, así que sin usuario no se escribe. Dedupe por (sesión, tramo) para que una caída no genere una fila por scroll | `mobile/src/features/feed/__tests__/adsFailureSignal.test.ts` (EC-2 fija el conjunto EXACTO de claves; un campo de más rompe el test) |
| §5 "el anunciante nunca ve tu identidad" | ✅ **vivo (170.5)**: `ad_impressions` con RLS activa y **cero policies** — `authenticated` conserva el `grant select` a propósito para que el fallo sea "0 filas" y no un `42501` que revele la existencia de la tabla; `ad_impressions_monthly` no tiene ni grant. El anunciante solo llegará al rollup (#171) | `supabase/tests/51_ad_impressions_test.sql` |
| §5 "se conserva un máximo de 90 días" | ✅ **vivo (170.5)**: `purge_ad_impressions()` **programada con `pg_cron`** (`purge_ad_impressions_daily`, `0 9 * * *`, verificado en `cron.job`) — decisión de Abraham 2026-08-17, revisada: su primera respuesta fue dejar la función sin programador, y la cambió al ver que el aviso pasaba a prometer el plazo por escrito. Una retención que nadie ejecuta es una defensa afirmada que no existe, en un documento legal | `supabase/tests/51_ad_impressions_test.sql`: la purga borra >90d, respeta <90d, y el job existe en `cron.job` |
| §5 "elegimos por el lugar, no por quién eres" | ✅ **vivo (170.2)**: `ads_for_zone` recibe zona/coordenadas, **nunca** el historial del usuario — su firma no admite un `user_id` siquiera | `supabase/tests/53_ads_for_zone_test.sql`, `55_resolve_ad_zone_test.sql` |
| §5 "los anunciantes no tienen ningún acceso a nuestros sistemas" | **cierto hoy sin mecanismo nuevo**: no existe rol, panel, RPC ni EF que un anunciante pueda invocar para leer impresiones. Deja de ser cierto en cuanto #172 construya el panel de métricas — ese día hay que reescribir este renglón y §5, y decidir el umbral de agregación | inventario de grants en `privacidad-datos.md` |

📐 **Definición de «vista», y por qué hay dos** (decisión de Abraham 2026-08-20, tarea #197). El número que se le factura a un anunciante cuenta una vista a partir de **3 s** de reproducción, decidido en el servidor por `record-ad-impressions` (el cliente puede declarar lo que quiera; se ignora y se deriva de `watched_ms`). El número de reproducciones que ve un **agente inmobiliario** sobre su propiedad NO tiene umbral: `video_view` se escribe en cuanto el video se vuelve activo. Miden cosas distintas a propósito — una es base de cobro, la otra es señal de interés — y **no deben sumarse ni compararse**. Está escrito en `wiki/conceptos/publicidad-anuncios.md` y en `wiki/conceptos/crm-leads.md` para que la explicación no dependa de que alguien se acuerde.

⚠️ **Contradicciones vivas entre este texto y el sistema** (deuda #116, cerrarlas antes de publicar):

1. §4 promete que el teléfono se comparte solo con el agente contactado. Hoy `users_select` expone correo y teléfono de **todo agente verificado** a cualquier usuario autenticado. Afecta a los agentes, no a los compradores — pero el aviso también los cubre.
2. §4 enumera los datos compartidos sin incluir la fecha de nacimiento; el PRD §19.4 pide *edad calculada*. Hoy el agente con lead puede leer la **fecha exacta**.
