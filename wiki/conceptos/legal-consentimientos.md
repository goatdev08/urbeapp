---
tipo: concepto
dominio: legal
estado: vivo
fuentes: [docs/PRD.md, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/20260604000004_user_profile_legal.sql, supabase/migrations/20260604000009_seed_terms.sql, supabase/migrations/20260727000003_legal_gate.sql, supabase/migrations/20260729000001_register_user_atomic_rpc.sql, supabase/tests/18_legal_gate_test.sql, supabase/tests/19_register_user_atomic_test.sql, supabase/functions/register/, mobile/src/features/auth/hooks/useLegalGate.ts, mobile/src/features/auth/components/legal-gate-boundary.tsx, mobile/src/features/auth/components/legal-wall.tsx, mobile/src/features/auth/api.ts]
actualizado: 2026-07-30
---

# Legal y consentimientos

> Términos, aviso de privacidad y consentimientos (LFPDPPP, México). En la demo, lo mínimo.

## Modelo de datos (migraciones 0004 + 0009)
- **`terms_versions`** — versionado legal inmutable. `doc_type` (terms | privacy); **1 versión vigente por tipo**. Seed v1 (placeholder) en migración `0009`.
- **`user_consents`** — auditoría **inmutable** de consentimientos. `consent_type` (**terms, privacy, age, whatsapp**).
- **`account_deletion_requests`** — baja con gracia. `status` (pending, confirmed, completed, cancelled); 15 días de gracia (soft→hard delete).

## Flujo (demo)
En el registro/canje de código se aceptan **terms + privacy + age + whatsapp** (4 consentimientos) → filas en `user_consents`. La **baja de cuenta** (15 días) → **diferido**.

### Registro libre: ahora atómico y del lado servidor (#93, 2026-07-30)
Hasta la tarea #93 el registro libre (modo `user` de `app/register.tsx`) llamaba `supabase.auth.signUp` directo desde el cliente y luego grababa los consentimientos con `record-consents.ts` (ya retirado). Dos huecos con la anon key en el bundle: (1) un `curl` a `/auth/v1/signup` con solo email+password creaba una cuenta con `phone`/`date_of_birth`/`state_id`/`municipality_id` en NULL — la obligatoriedad de §5.1 solo vivía en el cliente, que no es frontera de confianza; (2) los CHECK/índices de #72.2 hacían que Postgres devolviera su error crudo (teléfono en conflicto, o la FILA COMPLETA en el caso de menor de edad) directo a un llamante `anon`.

Ahora el registro libre pasa por la **EF pública `register`** (`supabase/functions/register/`, sin JWT — usa la API admin, no `/signup`): valida §5.1 → `authAdmin.createUser` (con `email_confirm:true`) → RPC `register_user_atomic` (`supabase/migrations/20260729000001_register_user_atomic_rpc.sql`, SECURITY DEFINER, mismo patrón que `redeem_invitation_atomic`) inserta los **4 consentimientos en la misma transacción** que valida que el perfil no quedó incompleto → compensación `deleteUser` si la RPC falla. Todo error visible a `anon` es un código sanitizado (`PHONE_TAKEN`, `EMAIL_ALREADY_EXISTS`, `UNDERAGE`, `FIELDS_INCOMPLETE`, …) — nunca `message`/`detail` crudo de Postgres, verificado empíricamente (ver bitácora 93.5). El cliente (`mobile/src/features/auth/api.ts`, `register_user`) solo llama a la EF y, si `ok`, hace `signIn(email,password)` — la EF no autologuea. `/auth/v1/signup` a `anon` queda cerrado con `[auth] enable_signup=false` en `supabase/config.toml` (#93.4; local verificado, remoto pendiente del runbook de deploy).

El flujo de **agente** (canje de código) ya era atómico del lado servidor desde antes (`redeem_invitation_atomic`) — #93 alinea el registro libre al mismo patrón.

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

## Aviso de privacidad: placeholder aceptado por gente real (75.3)

Lo vigente en `terms_versions` (`doc_type='privacy'`, v1.0) es un **placeholder de 113 caracteres** — el seed de `20260604000009`, que nunca se reemplazó. Las cuentas reales ya lo aceptaron. §19.2 del PRD exige que la lógica de privacidad del lead quede **explícita** ahí y en el consentimiento del registro.

El borrador completo, redactado contra el esquema real, vive en `docs/aviso-privacidad.md`. ⚠️ **No se activó**: publicarlo como versión vigente **fuerza re-consentimiento a todas las cuentas**, necesita revisión legal (LFPDPPP: responsable, domicilio, procedimiento ARCO) y hoy el sistema **comparte más de lo que ese texto promete** (deuda #116). El inventario de qué ve quién está en [[privacidad-datos]].

