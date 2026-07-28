---
tipo: concepto
dominio: legal
estado: vivo
fuentes: [docs/PRD.md, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/20260604000004_user_profile_legal.sql, supabase/migrations/20260604000009_seed_terms.sql, supabase/migrations/20260727000003_legal_gate.sql, supabase/tests/18_legal_gate_test.sql, mobile/src/features/auth/hooks/useLegalGate.ts, mobile/src/features/auth/components/legal-gate-boundary.tsx, mobile/src/features/auth/components/legal-wall.tsx, mobile/src/features/auth/record-consents.ts]
actualizado: 2026-07-28
---

# Legal y consentimientos

> Términos, aviso de privacidad y consentimientos (LFPDPPP, México). En la demo, lo mínimo.

## Modelo de datos (migraciones 0004 + 0009)
- **`terms_versions`** — versionado legal inmutable. `doc_type` (terms | privacy); **1 versión vigente por tipo**. Seed v1 (placeholder) en migración `0009`.
- **`user_consents`** — auditoría **inmutable** de consentimientos. `consent_type` (**terms, privacy, age, whatsapp**).
- **`account_deletion_requests`** — baja con gracia. `status` (pending, confirmed, completed, cancelled); 15 días de gracia (soft→hard delete).

## Flujo (demo)
En el registro/canje de código se aceptan **terms + privacy + whatsapp** (consentimiento de contacto) → filas en `user_consents`. La **baja de cuenta** (15 días) → **diferido**.

## Reglas / gotchas
- `user_consents` es append-only (auditoría); si cambia una versión de términos, se requiere re-aceptación.
- Consentimiento WhatsApp es obligatorio porque el contacto sale por ahí → [[crm-leads]].

## Detalle exhaustivo
- `docs/PRD.md` (cumplimiento LFPDPPP, retención, anonimización) · migraciones `0004` / `0009` · [[db-schema-map]]

## Relacionados
[[onboarding-y-preferencias]] · [[roles-y-permisos]] · [[crm-leads]]


## Gate de re-aceptación (#72.6, PRD §5.5 — 2026-07-28)

> El schema de 0004 ya traía lo difícil. Lo que faltaba no eran tablas: era **la lógica del gate** y cerrar los candados.

**La pregunta la responde el servidor.** RPC `pending_legal_consents()` → documentos vigentes que el usuario no ha aceptado en su versión vigente. Vacío = al día. Si el cliente reimplementara la comparación, un bug suyo significaría gente operando bajo términos que nunca aceptó — justo lo que hay que poder demostrar que no pasa.

- **`security invoker`, no definer.** La RLS de `user_consents` ya acota a las filas propias → menos privilegio, mismo resultado. ⚠️ Pero el `where uc.user_id = auth.uid()` **explícito NO es redundante**: la policy es `(user_id = auth.uid() OR private.is_admin())`, así que sin él un **admin** vería las aceptaciones de cualquiera y el `not exists` le daría 0 pendientes para siempre.
- ⚠️ **Trampa de enums:** `doc_type` y `consent_type` son enums **distintos** que comparten las etiquetas `terms` y `privacy`. Postgres no los compara: hay que **castear a text**. Con el cast mal puesto compara siempre falso y el gate pide re-aceptar eternamente.

**Es un MURO, no una ruta.** `LegalWall` se renderiza *en lugar* del contenido (patrón de `LocationWall`). Una ruta se esquiva con `router.replace`, un deep link o el botón de atrás; un componente que reemplaza el contenido, no.

🔑 **El gate no era inevitable, y esa fue la lección.** Vivía solo en `ProtectedLayout`, pero **no todo el contenido autenticado está en `(protected)`**: `app/admin/_layout.tsx` (el rol con más poder, alcanzable por `urbea://admin`) y `app/onboarding.tsx` (donde el agente captura datos personales **antes** de aceptar el Aviso de Privacidad) lo esquivaban. Se extrajo `LegalGateBoundary`: **un gate, tres consumidores**.

**Consentimiento informado, literal.** Sin el texto del documento en pantalla no se puede marcar la palomita. El bug original: el error al traer `terms_versions.content` se descartaba en silencio, la tarjeta quedaba en "Cargando…" y el checkbox seguía marcable — se podía "aceptar" algo que nunca se mostró.

**Ante error de la RPC: falla cerrado con reintento.** Dejar pasar abre la ventana que el gate cierra (basta modo avión); bloquear sin salida deja la app inservible. Se ofrece reintentar **y** cerrar sesión (por si el fallo no es transitorio y reintentar nunca vaya a servir).

**Inmutabilidad con tres candados** (antes había uno y medio): ausencia de política RLS de UPDATE/DELETE + `revoke update, delete` + `revoke truncate`. 🔒 El tercero importa: **TRUNCATE no pasa por RLS** y Supabase lo concede de fábrica (`pg_default_acl` da el bit `D` a `anon` en toda tabla nueva de `public`) → la anon key podía vaciar el historial completo de consentimientos de todos. Barrido del resto de `public` → tarea **#92**.

### Hueco conocido: el consentimiento de WhatsApp (#72.7 → tarea #94)
`consent_type='whatsapp'` se graba en el registro, pero:
1. **Nadie lo verifica antes de compartir.** `PropertyDetailScreen`/`AgentCard` abren WhatsApp sin consultar `user_consents` → el registro de §5.4 es puramente **probatorio**: si falta, el share ocurre igual.
2. **Si el insert falla, se pierde en silencio.** El gate recupera `terms` y `privacy`, pero **no** `whatsapp` — esa RPC solo mira `terms_versions`.

Cerrarlo bien = verificarlo **en el punto de contacto**. Ver [[crm-leads]].
