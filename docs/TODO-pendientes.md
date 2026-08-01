# TODO — pendientes de Urbea (corte 2026-07-31)

Checklist vivo de lo que falta, separado por **quién** lo destraba: lo que debe configurar Abraham (externo), lo que se puede desarrollar YA sin configurar nada, y lo que queda diferido con su razón. Producción está **pausada por los pagos** — nada de esto corre prisa en remoto, pero el desarrollo local no está bloqueado.

---

## 1. Configuración externa (la hace Abraham, nada de código depende de empezar por aquí)

| Qué | Detalle | Desbloquea |
|---|---|---|
| **Resend — API key** | Cuenta ya existe (swacg08@gmail.com). Crear API key con "Sending access". Sin dominio, el modo prueba solo envía a ese mismo correo — suficiente para el smoke. | Smoke E2E remoto de 72.3 y 72.5 |
| **Dominio** (~$10–15 USD/año) | Cuando exista: verificarlo en Resend (DNS en Cloudflare). Es lo único que permite enviar a usuarios reales. | 72.3/72.5 en producción real |
| **Google Cloud — OAuth client** | Proyecto "Urbea" → pantalla de consentimiento External + publicar → client **Web** con redirect `https://<project-ref>.supabase.co/auth/v1/callback` → registrar client id/secret en Supabase Auth. Los clients Android/iOS se difieren hasta que yo entregue SHA-1 y package name. | Smoke E2E de 72.4 |

## 2. Desarrollable YA, sin configurar nada (testeable en local)

**Hallazgo clave:** el stack local de Supabase trae **Mailpit** (bandeja falsa en `http://localhost:54324`). El GoTrue local manda ahí todos los correos **sin SMTP ni Resend**. O sea: el flujo completo de verificación de email y de recuperación de contraseña **se desarrolla y se prueba end-to-end en local con cero credenciales**. Lo único que Mailpit no prueba es la entrega real por Resend en remoto.

### 72.3 — Verificación real de email
UI ya construida (`mobile/app/verify-email.tsx` + reenvío con cooldown). Falta el cableado, todo local-testeable:
- [ ] Apagar autoconfirm **en local** (`supabase/config.toml` → `[auth.email] enable_confirmations = true`) para reproducir el comportamiento de producción.
- [ ] EF `register`: crear el usuario **sin** `email_confirm: true` y disparar el correo de confirmación (hoy el admin API confirma directo; `admin.createUser` no envía correo solo — resolver con `resend`/`generateLink`).
- [ ] Rediseñar el post-registro: con confirmations activas GoTrue **rechaza el login** de un usuario sin confirmar (`email_not_confirmed`) → el auto-login actual deja de aplicar; ruta a `verify-email` sin sesión.
- [ ] Guard de navegación en `features/auth/protected-layout.tsx` (`session.user.email_confirmed_at === null` → verify-email), análogo a LegalGateBoundary.
- [ ] Prueba local: registro → correo en Mailpit → click en el link → acceso. Deep link de confirmación en el emulador (`10.0.2.2`).
- ⏸ **Pospuesto (necesita §1):** configurar SMTP Resend en el remoto, apagar autoconfirm en remoto, smoke con correo real, actualizar la memoria `remote_auth_autoconfirm_enabled`.

### 72.5 — Recuperación de contraseña
UI + validación ya construidas (`forgot-password.tsx`, `reset-password.tsx`, wrappers en context). Falta:
- [ ] Deep link listener `urbea://reset-password` + `setSession` (el comentario de encabezado en `reset-password.tsx` marca dónde).
- [ ] Prueba local: solicitar reset → correo en Mailpit → deep link → nueva contraseña → login.
- ⏸ **Pospuesto (necesita §1):** envío real por Resend, expiración 15 min contra remoto, caso "cuenta Google sin opción de reset" (necesita 72.4 vivo).

### 72.4 — Google OAuth
UI ya construida tras feature-flag apagado (`feature-flags.ts`, botones en login). **Programable pero NO testeable E2E sin el client de Google** (ni en local — el OAuth necesita un client id real):
- [ ] `pnpm add expo-auth-session`; reemplazar el stub por `signInWithOAuth` + `exchangeCodeForSession` con deep link `urbea://`; revisar `detectSessionInUrl:false` en `lib/supabase/client.ts`.
- [ ] Unit tests del intercambio con mocks (lógica en lib/hooks → crítica, TDD).
- [ ] El flag `GOOGLE_OAUTH_ENABLED` queda **apagado** hasta el smoke real.
- ⏸ **Pospuesto (necesita §1):** registrar client en Supabase Auth, flip del flag, smoke login real, clients Android/iOS (+Apple = gate de release iOS, App Store 4.8).

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
