# TODO — pendientes de Urbea (corte 2026-07-31, actualizado post-ronda 72.3–72.5)

Checklist vivo de lo que falta, separado por **quién** lo destraba. Producción está **pausada por los pagos** — nada de esto corre prisa en remoto, pero el desarrollo local no está bloqueado.

> **Actualización (misma fecha, tarde):** la ronda 72.3 → 72.5 → 72.4 **ya se ejecutó completa** (TDD + guardian + E2E local vía Mailpit). La sección 2 quedó convertida de "por desarrollar" a "hecho + qué falta de config". La tarea #72 está **done** en Taskmaster.

---

## 1. Configuración externa (la hace Abraham, nada de código depende de empezar por aquí)

| Qué | Detalle | Desbloquea |
|---|---|---|
| **Resend — API key** | Cuenta ya existe (swacg08@gmail.com). Crear API key con "Sending access". Sin dominio, el modo prueba solo envía a ese mismo correo — suficiente para el smoke. | Smoke E2E remoto de 72.3/72.5 **y** el alta de organizaciones (#168) |
| **Dominio** (~$10–15 USD/año) | Cuando exista: verificarlo en Resend (DNS en Cloudflare). Es lo único que permite enviar a usuarios reales. | 72.3/72.5 **y #168** en producción real |
| **SMTP del proyecto remoto (`urbea-app`)** | Configurar el SMTP custom de Supabase Auth apuntando a Resend (API key + dominio de arriba). Sin esto, GoTrue sigue con el mailer de fábrica (2/hora, solo miembros del equipo). | 72.3/72.5 **y #168** en producción real |
| **Google Cloud — OAuth client** | Proyecto "Urbea" → pantalla de consentimiento External + publicar → client **Web** con redirect `https://<project-ref>.supabase.co/auth/v1/callback` → registrar client id/secret en Supabase Auth. Los clients Android/iOS se difieren hasta que yo entregue SHA-1 y package name. | Smoke E2E de 72.4 |

### 1.1 🔴 BLOQUEANTE antes de encender Resend para el alta de organizaciones (#168)

**Estado (168.4, 2026-08-16): el envío YA está implementado.** La invitación del owner de una organización nueva se manda por `auth.admin.inviteUserByEmail` (`supabase/functions/_shared/clients.ts`), no solo un link generado — verificado **E2E contra Mailpit local**: correo real recibido, plantilla "Invite user" de GoTrue, link `type=invite`. Lo que falta es **puramente config remota**: las 3 filas de la tabla de arriba (API key + dominio + SMTP del proyecto).

**Fail-closed, decisión explícita de Abraham (168.4/168.5) — no es un bug:** `inviteUserByEmail` crea el usuario Y envía el correo en **una sola transacción** de GoTrue. Si el SMTP falla, GoTrue hace **rollback del usuario invitado** y el alta entera responde 500 `AUTH_INVITE_FAILED` — sin organización huérfana ni usuario huérfano, pero **sin alta posible**. Se evaluó y se descartó a propósito un modo degradado ("organización creada, correo pendiente de reintento") porque exigiría una segunda vía de envío (EF propia contra la API HTTP de Resend, opción (b) del doc 039) que no se justifica con un solo correo transaccional. Con el SMTP remoto caído, **ningún admin puede dar de alta una organización nueva** hasta que se repare — comportamiento esperado, no regresión.

**🔴 Antes de encender Resend en remoto, arreglar el redirect roto (hallazgo del guardian de 168.4/168.5):** `OWNER_INVITE_REDIRECT_TO` en `supabase/functions/_shared/clients.ts:173` vale `'urbea://'` (la raíz de la app). Ahí **nadie monta** `useSessionFromDeepLink` — los tokens de sesión que GoTrue anexa al fragmento de la URL del correo se pierden y el owner invitado abre la app **sin sesión iniciada** (no puede fijar su contraseña). El destino correcto **ya existe**: `mobile/app/reset-password.tsx:62` monta el hook y `mobile/src/features/auth/context.tsx:162` fija la contraseña vía `supabase.auth.updateUser({password})`. Mandar correos reales de invitación con el redirect apuntando a la raíz = correos que no llevan a ninguna parte.

**Checklist de flip (en orden):**
- [ ] (1) API key de Resend con "Sending access" (cuenta ya existe).
- [ ] (2) Dominio propio ~$10–15 USD/año, verificado en Resend (DNS en Cloudflare).
- [ ] (3) SMTP del proyecto remoto `urbea-app` apuntando a Resend.
- [ ] (4) 🔴 Fix del `redirect_to` de invitación (arriba) — desplegado ANTES o EN el mismo paso que (3), no después.
- [ ] (5) Prueba de entrega a un buzón real que **no** sea swacg08@gmail.com (en modo prueba Resend solo entrega a esa dirección).

## 2. ✅ HECHO (ronda 2026-07-31): 72.3 + 72.5 + 72.4 en código, E2E local verde

**El hallazgo Mailpit funcionó:** el flujo completo de correos se probó E2E contra el stack local sin Resend (bandeja en `http://localhost:54324`).

**Lo que quedó implementado y verificado:**
- **72.3** — EF `register` crea usuarios sin confirmar; el cliente dispara el correo (`send_verification_email`); **ya no hay auto-login post-registro** → pantalla verify-email; guard `email_confirmed_at` en protected-layout; deep link del correo → sesión directa (`parse_session_from_url` + `useSessionFromDeepLink`). E2E API: registro → Mailpit → link → `302 urbea://verify-email#access_token…` → confirmado.
- **72.5** — deep link `urbea://reset-password` cableado (reusa el hook); CTA "Pedir un nuevo enlace" si expiró; entrada directa post-cambio. E2E API: recover → Mailpit → `type=recovery` → password nueva 200, vieja 400.
- **72.4** — `useGoogleOAuth` con flow implícito + `expo-web-browser` (ponytail: sin expo-auth-session); flag **apagado**; candado EC-B5 (flags off → sin botones sociales).
- Suites: Jest 842 (75 suites) · Deno 681 · pgTAP 336 · tsc/lint 0. Guardian PASS en los 3 ciclos.

**⚠️ Para probar en el emulador: REBUILD obligatorio del dev client** — `expo-web-browser` es módulo nativo nuevo (fingerprint cambia): `cd mobile && pnpm expo run:android`. El dev client viejo puede tronar al abrir login. Mismo motivo: el próximo build de testers es **rebuild EAS, no OTA**.

**Checklist manual en el emulador (cuando quieras verlo tú):** registrarte → caer en "Verifica tu correo" → abrir `localhost:54324` → click al link → la app se abre ya logueada. "¿Olvidaste tu contraseña?" → correo → link → nueva contraseña → dentro. Login normal y flujo de agente intactos.

**⏸ Lo ÚNICO pendiente de la #72 (todo config, necesita §1):**
- [ ] SMTP Resend en `urbea-app` + `enable_confirmations` remoto + actualizar memoria `remote_auth_autoconfirm_enabled` + smoke con correo real (expiración 15 min).
- [ ] Client OAuth de Google registrado en Supabase Auth → flip `GOOGLE_OAUTH_ENABLED` → smoke login real → caso "cuenta Google sin opción de reset". Clients Android/iOS + Apple = gate pre-iOS (App Store 4.8).

## 3. Runbook remoto de #93 (cuando se reactive producción)

#93 ya está mergeado en `main` pero **NO desplegado** — el remoto sigue con el flujo viejo a propósito. Al reactivar, en este orden:
1. Deploy EF `register`: `--no-verify-jwt --import-map --use-api`.
2. OTA a testers (`pnpm ota`).
3. Cerrar signup remoto: `supabase config push` (sincroniza `enable_signup=false`) o Dashboard.
4. Probar: registro desde la app OK + curl a `/auth/v1/signup` → 422.
5. Regenerar `database.types.ts` contra `--project-id`.

## 4. Backlog de tareas pendientes

- **#95** — Rate limiting de endpoints públicos de auth (PHONE_TAKEN/EMAIL_ALREADY_EXISTS son oráculo de enumeración). Depende de 93 ✅.
- **#92** — Revocar TRUNCATE a anon en todo `public` (viene de fábrica).
- **#94** — Verificar el consentimiento de WhatsApp en el punto de contacto (hoy solo probatorio).
- **#90** — Bloqueantes de deploy-day.
- **#91** — Portadas de video en blanco en el feed local.
- Limpieza: borrar ramas remotas `tarea/*` ya mergeadas (pendiente de OK).
