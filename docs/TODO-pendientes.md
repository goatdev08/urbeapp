# TODO — pendientes de Urbea (corte 2026-07-31, actualizado post-ronda 72.3–72.5)

Checklist vivo de lo que falta, separado por **quién** lo destraba. Producción está **pausada por los pagos** — nada de esto corre prisa en remoto, pero el desarrollo local no está bloqueado.

> **Actualización (misma fecha, tarde):** la ronda 72.3 → 72.5 → 72.4 **ya se ejecutó completa** (TDD + guardian + E2E local vía Mailpit). La sección 2 quedó convertida de "por desarrollar" a "hecho + qué falta de config". La tarea #72 está **done** en Taskmaster.

---

## 1. Configuración externa (la hace Abraham, nada de código depende de empezar por aquí)

| Qué | Detalle | Desbloquea |
|---|---|---|
| **Resend — API key** | Cuenta ya existe (swacg08@gmail.com). Crear API key con "Sending access". Sin dominio, el modo prueba solo envía a ese mismo correo — suficiente para el smoke. | Smoke E2E remoto de 72.3 y 72.5 |
| **Dominio** (~$10–15 USD/año) | Cuando exista: verificarlo en Resend (DNS en Cloudflare). Es lo único que permite enviar a usuarios reales. | 72.3/72.5 en producción real |
| **Google Cloud — OAuth client** | Proyecto "Urbea" → pantalla de consentimiento External + publicar → client **Web** con redirect `https://<project-ref>.supabase.co/auth/v1/callback` → registrar client id/secret en Supabase Auth. Los clients Android/iOS se difieren hasta que yo entregue SHA-1 y package name. | Smoke E2E de 72.4 |

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
