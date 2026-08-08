---
tipo: concepto
dominio: seguridad
estado: vivo
fuentes: [docs/PRD.md §19.1-19.4, docs/aviso-privacidad.md, docs/lineamientos-desarrollo.md]
codigo: [supabase/migrations/20260702000001_rls_lead_searcher_identity.sql, supabase/migrations/20260808000001_events_raw_rls.sql, supabase/migrations/20260809000001_events_raw_lead_gate.sql, supabase/tests/08_rls_lead_searcher_test.sql, supabase/tests/33_events_raw_rls_test.sql, supabase/tests/35_lead_privacy_test.sql, supabase/migrations/20260604000009_seed_terms.sql]
actualizado: 2026-08-08
---

# Privacidad de los datos del usuario

> Inventario **medido, no supuesto**: qué guarda Urbea de cada persona, dónde vive, quién puede leerlo y qué lo desbloquea. Levantado el 2026-08-08 consultando `pg_policy` e `information_schema` del proyecto remoto `urbea-app`, y verificado por impersonación con JWT reales.

## La regla que ordena todo (PRD §19.1/§19.2)

**Registrar ≠ exponer.** La interacción de un usuario con una publicación se guarda SIEMPRE; se le muestra al agente SOLO si esa persona lo contactó. El lead es la llave.

- Antes del contacto: el agente no ve **ningún** dato personal ni **ninguna** interacción.
- Al tocar "Contactar agente" → se crea el lead → el agente obtiene datos de contacto **y acceso retroactivo** al historial de esa persona con **todas** las publicaciones de ese agente.
- Borrar el lead (`deleted_at`) **revoca** el acceso retroactivo. El permiso se deriva del lead, no se copia.

## Inventario: dato → dónde vive → quién lo lee

| Dato | Tabla | Quién lo lee además del dueño |
| --- | --- | --- |
| Nombre, apellido, foto, email, teléfono, ciudad/estado, fecha de nacimiento, bio | `users` | admin de plataforma · owner de la agencia del agente · **el agente con lead activo** (`can_view_user_as_lead_searcher`) · ⚠️ **cualquier autenticado** si la fila es de un agente verificado |
| Preferencias de búsqueda (onboarding) | `user_preferences` | solo admin. **El agente NO las ve** — por eso el CRM lee la identidad de `users`, nunca de aquí |
| Consentimientos legales aceptados | `user_consents` | solo admin. Append-only por trigger |
| Likes | `likes` | solo admin (el agente los ve **agregados**, vía `get_lead_stats`) |
| Guardados | `saves` | solo admin (idem) |
| Notificaciones | `notifications` | solo admin |
| Solicitud de alta como agente | `agent_applications` | solo admin |
| **Comportamiento de video** (`video_view`, `video_completed`, `app_open`) | `events_raw` | admin · **el agente/owner/admin de agencia SOLO si esa persona es su lead activo Y la propiedad es de ese agente** (`can_view_user_events`) |
| Lead (estado, notas internas del agente, puntaje) | `leads` | el agente dueño · owner/admin de su agencia · admin |
| Historial de cambios de estado del lead | `lead_status_history` | quien pueda ver el lead. Append-only por trigger |

## Lo que el agente ve, y lo que no

**Ve, tras el contacto:** nombre completo, foto, ciudad/estado, correo, teléfono, fecha del primer contacto, propiedades suyas con las que la persona interactuó, y las estadísticas tangibles ([[crm-leads]]: dio like · vio el video completo · guardó · volvió a ver).

**No ve, nunca:** sus preferencias de búsqueda, sus likes/guardados en publicaciones de OTROS agentes, sus consentimientos, sus notificaciones, ni su actividad si nunca lo contactó.

## Cómo se hace cumplir

Dos helpers `security definer` en el schema `private` (no expuesto por PostgREST):

- `can_view_user_as_lead_searcher(user_id)` → identidad (`users_select`). Migración `20260702000001`, ampliada a admin de agencia en `20260807000005`.
- `can_view_user_events(user_id, property_id)` → comportamiento (`events_raw_select`). Migración `20260809000001` (75.3).

Ambos derivan el permiso de un lead **activo**. Los cubre pgTAP por impersonación: `08_` (identidad, plan 12), `33_` (lectura del agente, plan 18), `35_` (privacidad §19.2, plan 15 — incluye que borrar el lead revoca el acceso).

## Fuga cerrada el 2026-08-08 (75.3)

`events_raw_select` nació en #112 como `user_id = auth.uid() OR can_manage_property(property_id)` — **sin mencionar el lead**. Bastaba con ser dueño de la propiedad para leer el comportamiento de cualquier persona sobre ella. Medido en producción con un JWT real: un agente leyó filas `video_view` de otra persona que nunca lo había contactado. Contradecía §19.1 de frente.

Lección: **abrir una tabla de comportamiento a la lectura es un acto de privacidad, no de permisos.** La condición correcta casi nunca es "soy dueño del objeto" sino "tengo una relación vigente con la persona". Al cerrarla apareció, gratis, un hueco de 75.5: el admin de inmobiliaria no veía **ningún** evento del equipo, porque `can_manage_property` compone dueño + owner + admin de plataforma, pero no al admin de inmobiliaria.

## Deuda viva (⚠️ pendiente, no resuelto)

- 🔴 **#116 — `users_select` expone email, teléfono y fecha de nacimiento de todo agente verificado a CUALQUIER autenticado.** Comprobado: un agente leyó el teléfono real de otro. Contradice §19.1 ("el teléfono no se muestra públicamente en perfil"). No se arregló aquí porque el grant es a nivel de COLUMNA, global: quitarlo rompe el `select('*')` del login en las apps ya instaladas → exige expand·migrate·contract.
- 🔴 **#116 — el agente con lead ve `date_of_birth` exacta**, cuando §19.4 pide *edad calculada*. Hoy todas las filas la tienen en `null`, pero el registro sí la escribe: la fuga se activa con el primer alta nueva.
- 🟡 **El aviso de privacidad vigente es un placeholder de 113 caracteres** que personas reales ya aceptaron. El borrador completo vive en `docs/aviso-privacidad.md`; activarlo requiere revisión legal y fuerza re-consentimiento a todos ([[legal-consentimientos]]).

Ver [[rls-seguridad]] · [[crm-leads]] · [[legal-consentimientos]] · [[roles-y-permisos]]
