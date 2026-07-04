# Auditoría pre-tarea #20 — Urbea Demo

> **Fecha:** 2026-07-03 · **Sesión:** auditoría completa previa al arranque de la #20 (polish/testing/deploy).
> Documento de trabajo para consultar durante los fixes. Los hallazgos también están resumidos en la bitácora de la subtarea 20.1 (`task-master show 20.1`).

## TL;DR

El proyecto está en muy buen estado para entrar a polish/deploy. Los 4 gates verdes, 1 solo archivo muerto real, cero credenciales expuestas, y la arquitectura de seguridad (RLS + EF con ownership server-side) es **apta para demo cerrada hoy**. Hay una lista corta de fixes antes de usuarios reales — ninguno crítico.

## 1. Gates (2026-07-03)

| Gate | Resultado |
|------|-----------|
| `pnpm tsc --noEmit` | ✅ 0 errores |
| `pnpm lint` | ✅ 0 errores, 9 warnings (`require()` deliberados para DI en tests) |
| Jest mobile | ✅ **467/467** en 40 suites |
| Deno Edge Functions | ✅ **403/403** |
| Backlog | 31/31 tareas done (2 canceladas); solo queda #20 |

## 2. Calidad de código — hallazgos accionables

### Código muerto / stubs
- [ ] **Borrar** `mobile/src/features/feed/components/feed-item-placeholder.tsx` — huérfano confirmado (0 imports).
- [ ] **Remover** `expo-status-bar` de package.json — 0 usos (resto del template).
- [ ] **Cablear** el tap de listing en `app/(protected)/profile/my-listings.tsx:188` — hoy es no-op (`// ponytail:` navegación diferida). El stub más notorio visible al usuario.
- [ ] Limpiar comentarios stale: `src/features/auth/__tests__/login-submit.test.tsx:6` (login.tsx ya llama signIn), `PropertyDetailScreen.tsx:11-14` (TODOs 10.4–10.7 hechos), TODOs 6.4/6.5 en `AvatarPicker.tsx` y `useImagePicker.ts` (imageUtils ya existe).
- [ ] `assets/splash-icon.png` sin referencia en config ni código.
- Pendiente real de onboarding: `OnboardingScreen.tsx:15` "Guard de re-show: TODO".

### console.*
Solo 4 `console.warn` (0 console.log/error), todos con fallback funcional:
- `app/(protected)/profile/edit.tsx:137` y `src/features/auth/context.tsx:48` — errores tragados; merecen estado de error suave si va a producción.
- `AddressAutocomplete.tsx:124,142` — errores de Places, deliberados.

### Hardcodes — "islas pre-theme" (candidato principal para 20.1)
Paleta gris Tailwind ajena a la identidad + salvia duplicada fuera de `theme.ts`:
- `src/features/auth/components/form-field.tsx:42,69,76,78,81,88,98` (`#9CA3AF`, `#374151`, `#D1D5DB`, `#F9FAFB`, `#EF4444`, `#111827`)
- `src/features/onboarding/OnboardingScreen.tsx:43-50` y `AvatarPicker.tsx:50,51,154,185,193,214,229` (incl. `COLOR_SALVIA='#5A8A5E'` duplicado)
- `src/features/publish/components/{NumericStepper:14-18, MapPicker:24-28,199,207, AddressAutocomplete:31-38,298, SelectionCard:16-19,87}` y `src/components/PrimaryButton.tsx:39`
- ~25 `#FFFFFF`/`#fff` sin migrar a tokens `on_primary`/`surface` (#33): `lead_status_meta.ts:29-33`, `PropertyListItem.tsx:42,44`, `FeedScreen.tsx:233,271`, `MapScreen.tsx:263`, markers, etc. `shadowColor '#1E160C'` en `LeadExpandedView.tsx:378` y `FilterSheet.tsx:422`.

### Performance (baja, escala demo OK)
- Items de FlatList sin `React.memo`: `PropertyGridCard`, `LeadCard`, `PropertyListItem`, `SavedGridItem`.
- Thumbnails con `Image` de RN sin downsampling (`expo-image` no instalado).
- Upload de video carga el archivo entero en memoria (`useVideoUpload.ts:123` — migrar a `createSignedUploadUrl` + `FileSystem.uploadAsync` para videos grandes; ya auto-documentado).
- Lo bien resuelto (no tocar): keyExtractor en las 7 listas, FlashList v2 + VideoFeedItem memoizado, `tracksViewChanges=false` en markers, `useVideoPlayer` libera al desmontar.

### Manejo de errores
- [ ] `useLikeProperty.ts:112` / `useSaveProperty.ts` — rollback optimista **silencioso** ante fallo de red (el corazón revierte sin feedback). Añadir toast/mensaje.
- `usePropertyDetail.ts:146` — mint-video-url fail-soft sin mensaje (deliberado, OK).

### Deuda `// ponytail:`
~130 comentarios en ~55 archivos, todos con intención + techo documentados. Sistema sano. Cosechar con `/ponytail-debt`. Grupos: íconos unicode/sin deps nuevas, sin paginación (volumen demo), casts por tipos DB sin regenerar (migración 0015), lazy-require DI (los 9 warnings de lint), dual-mode oscuro diferido, refs+force_update, video/upload.

## 3. Seguridad — veredicto: APTA para demo cerrada

### Antes de usuarios reales (orden de importancia)
1. **M1 — Restringir API keys de Google en Cloud Console** (media): keys de Maps (`app.config.js:17,31`) y Places (`AddressAutocomplete.tsx:86`) viajan en el bundle (inevitable). ⭐ **Receta exacta en §9** (hallazgo 2026-07-03: es UNA sola key compartida Maps+Places → hay que dividirla; restringirla a Android apps tal cual ROMPERÍA Places).
2. **M2 — Rotar password demo** `urbea2026` (`seed.sql:5,76`, compartida por 11 cuentas seed + la cuenta live) y garantizar que `seed.sql`/`[db.seed]` jamás corran contra prod.
3. **B1 — Rate-limiting en `validate-invitation`/`redeem-invitation`** (baja): endpoints públicos sin captcha; `validate-invitation` es oráculo de enumeración (devuelve `agency_name`). Fuerza bruta inviable (62⁸ ≈ 2.2×10¹⁴, `crypto.getRandomValues`), pero añadir límite por IP antes de abrir.
4. **B2 — Column-grants en `properties`** (baja): la migración `0008` protege `users`/`agencies`/`notifications` pero NO `properties` → un agente puede inflar `contact_count`/`like_count`/`view_count`/`published_at` de *sus propias* propiedades con el anon key, saltándose las EF. Replicar patrón de column-grants.
5. **B3 — `publish-property` no valida ownership de `storage_path`** (baja): un agente podría publicar apuntando al video de otro y `mint-video-url` lo firmaría. Fix: validar que empiece con `${user_id}/`.

### Lo bien hecho (NO rehacer)
- RLS en las 20 tablas; helpers en schema `private` (invisible a PostgREST); todo `SECURITY DEFINER` con `search_path` fijo (`0010`).
- Column-grants anti-escalación en `users` (role/agency_id/is_verified_agent/email intocables), `agencies`, `notifications`. `events_raw`/`admin_actions` selladas (solo service_role).
- Tokens de invitación hasheados (SHA-256), plano mostrado 1 vez, nunca persistido.
- RPCs atómicas con grant solo a service_role, revoke a anon/authenticated.
- Todas las EF: JWT antes de parsear body, input validado, ownership server-side del token (nunca del payload) → sin IDOR. `admin-create-agency` verifica `role='admin'` server-side. `contact-agent` anti-self-contact + idempotente con recuperación 23505. `mint-video-url` solo firma videos de propiedades active+ready (fail-closed).
- Cliente: solo anon key; escrituras directas (`likes`/`saves`/`properties`/`user_preferences`) cubiertas por RLS `auth.uid()`. `.env.local` gitignored y NO commiteado (verificado con `git ls-files`).
- Storage: `property-videos` privado, INSERT scoped a `foldername[1]=auth.uid()`, sin UPDATE/DELETE policy → sin sobreescritura cruzada. `profile-photos` público de lectura, escrituras scoped por path.
- Guard admin client-side es solo UX; la barrera real es RLS `is_admin()` + verificación en la EF. Correcto.

## 4. Gaps funcionales vs. PRD

- ~~**Owner sin UI para generar códigos de invitación**~~ ✅ **RESUELTO (tarea #34, 2026-07-03):** EF `create-invitation` (deriva la agencia del JWT, TDD 24 tests) + pantalla `(protected)/agency/invitations.tsx` gateada por `useAgencyRole().isOwner` + botón "Invitar agentes" en el perfil del owner. ⚠️ Falta desplegar la EF al remoto (ver §9-pendientes).
- ~~**Sin cuenta admin sembrada**~~ ✅ **RESUELTO (seed remoto #37):** `admin@urbea.demo / urbea2026`.
- ~~**Happy path contacto→lead en remoto**~~ ✅ **RESUELTO (seed remoto #37):** 4 agentes + 3 owners con 10 propiedades activas en `urbea-app`.

## 5. Checklist de prueba manual (15 features)

**Cuentas (TODAS ya viven en el REMOTO desde el seed #37, 2026-07-03):** password universal `urbea2026`.
`demo.agente@urbea.app` y `demo.agente2@urbea.app` (previas) · owners: `owner.gdl@urbea.demo`, `owner.oeste@urbea.demo` (2 agentes), `owner.providencia@urbea.demo` · agentes: `agente1.gdl@`, `agente2-3.oeste@`, `agente4.providencia@urbea.demo` · buscadores: `buscador1-4@urbea.demo` · **admin:** `admin@urbea.demo` · **código de invitación vigente:** `DEMO2026` (usos ilimitados, agencia GDL Premium). `mobile/.env.local` ya apunta al remoto.

| # | Feature | Qué probar | Ojo con |
|---|---------|-----------|---------|
| 1 | Login | Email+password, errores en ES, sesión persiste al reabrir | — |
| 2 | Registro por invitación | Código válido → preview agencia → alta 2 fases → auto-login | Código vigente: `DEMO2026` |
| 3 | Onboarding | Nombre + foto (cámara/galería), skip foto, no re-aparece | — |
| 4 | Feed vertical | Autoplay al swipe, pausa fuera de foco, doble-tap=like+haptic, pull-to-refresh, scroll infinito | Pausa al cambiar de app |
| 5 | Filtros | Sheet completo, badge de conteo, persisten al cerrar app, aplican a feed Y mapa | `both` aparece en renta y venta |
| 6 | Mapa | Pines salvia(renta)/arcilla(venta), clusters, tap cluster=zoom, mini-card→detalle, búsqueda | Solo dev build |
| 7 | Detalle | Hero video + contenido claro, /mes en renta, specs, amenidades, mini-mapa, card agente | Pin en ubicación correcta |
| 8 | Like/Guardar | Persisten tras reiniciar, contadores reales, animaciones | Sin red: revierte (hoy sin mensaje) |
| 9 | Guardados | Tab 🔖, grid 2-col, long-press→Alert→quitar | — |
| 10 | Contacto WhatsApp | CTA sticky → WhatsApp prellenado → lead en CRM del dueño | Requiere 2º agente; self-contact = error claro |
| 11 | Publicar | Wizard 3 pasos, autocomplete, pin draggable, video, aparece en feed/mapa/perfil | Clip corto vertical (upload en memoria) |
| 12 | Mis publicaciones | Filtros status, pausar, cerrar (pide motivo), eliminar, tap → detalle | ✅ tap cableado (#35) |
| 13 | Perfil | Stats, grid, editar foto/nombre/bio y ver reflejado | — |
| 14 | CRM | Lista leads, filtros embudo, búsqueda, cambiar estado (transiciones válidas), nota sin cambiar estado | Owner: selector agentes + solo-lectura |
| 15 | Panel admin | Alta agencia+owner, token UNA vez (copiar), invite-link | Requiere `role='admin'` |

## 6. Plan E2E — Maestro (subtarea 20.5)

**Por qué Maestro** (no Detox): YAML declarativo, corre contra el emulador Android ya configurado (`pnpm emu`) y el simulador iOS, sin instrumentar la app. Instalar: `brew tap mobile-dev-inc/tap && brew install maestro`. Flujos en `mobile/.maestro/*.yaml`.

Suites en orden de valor:
1. `login.yaml` — feliz + password mala (error ES) + sesión persistente.
2. `registro.yaml` — canje → registro → onboarding → feed. Token fresco generado por seed antes de cada corrida.
3. `publicar.yaml` — wizard completo con mp4 corto pre-cargado (`adb push` a galería) → assert en Mis publicaciones y feed.
4. `feed-interaccion.yaml` — swipe, doble-tap like, guardar, verificar en Guardados, long-press quitar.
5. `contacto-crm.yaml` — detalle → CTA → assert del Alert (NO del deep link, saca de la app) → login agente dueño → lead visible → cambiar estado → nota.
6. `botonera.yaml` — smoke de navegación: cada tab y botón visible responde.

Condiciones: (a) correr contra **Supabase local con seed** (determinista, reseteable), no remoto; (b) agregar `testID` donde no ancle por texto — ya hay buenos `accessibilityLabel` en botones clave.

## 7. Opinión: factibilidad de pruebas cerradas

**Sí es factible.** Base inusualmente sólida para una demo: TDD real en toda la lógica crítica (870 tests totales), seguridad server-side bien pensada, deuda 100% documentada. Es base legítima de producto.

**Bloqueantes antes de repartir a terceros (~1-2 días):**
- ✅ Cablear tap de my-listings (#35) · ✅ sembrar remoto (#37) · ✅ UI owner de invitaciones (#34) · ⏳ restringir keys de Google (#36 → receta en §9, requiere consola GCP) · ⏳ pase manual del checklist en Android (#38 — todo listo, ver §9).

**Deseables en la #20:** consolidar hex al theme, feedback en rollback like/save, rate-limiting invitaciones, suite Maestro.

**Riesgo mayor = iOS** (nunca corrido): video, mapas (`react-native-maps` usa Apple Maps por default en iOS salvo configurar provider Google), permisos, safe areas. Cerrable gratis en simulador (M3 Max):
```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer  # hoy apunta a CommandLineTools
# instalar runtime iOS desde Xcode, luego:
cd mobile && pnpm expo run:ios
```

## 8. Distribución de la demo

**Android (canal principal, semi-validado):**
```bash
eas build --profile preview --platform android
```
→ APK de distribución interna con link de instalación directa hospedado por EAS. Sin Play Store ni revisión. Testers habilitan "orígenes desconocidos".

**iOS:**
1. **Gratis primero:** validar en simulador (arriba) — destapa ~80% de bugs de plataforma.
2. **Devices físicos: TestFlight** — requiere Apple Developer Program (USD 99/año). `eas build --platform ios` + `eas submit`; testers **internos** (hasta 100, sin revisión de Apple) instalan vía app TestFlight con su email. Ruta ad-hoc (UDIDs) NO recomendada.
3. Estrategia válida: **demo v1 solo-Android + iOS validado en simulador**; activar TestFlight cuando haya tester iOS concreto.

## 9. Ejecución pre-#20 (2026-07-03, tareas #34–#38)

### Hecho y verificado
- **#35** — tap de my-listings → `/property/[id]` (PR #9).
- **#34** — invitaciones del owner (PR #10): EF `create-invitation` (TDD, 24 tests Deno; deriva agencia del JWT — cero IDOR) + `useCreateInvitation` (11 tests jest) + pantalla `(protected)/agency/invitations.tsx` + botón "Invitar agentes" (solo owner). Suites: Deno 427/427 · jest 478/478.
- **#37** — remoto `urbea-app` sembrado y verificado E2E por API: password grant OK, `mint-video-url` firma y el video responde HTTP 200, `validate-invitation` acepta `DEMO2026`, login admin OK. 3 agencias / 7 miembros / 10 propiedades activas nuevas / 10 videos `ready` en Storage / 3 leads. `mobile/.env.local` → apunta al REMOTO (bloque local queda comentado).

### ⏳ Pendiente que requiere acción del usuario

**1. Deploys de EF al remoto** (bloqueados por permisos de esta sesión — correr a mano o aprobar):
```bash
supabase functions deploy create-invitation --import-map supabase/functions/deno.json
supabase functions deploy admin-create-agency --import-map supabase/functions/deno.json
supabase functions deploy update-property-status --import-map supabase/functions/deno.json
```
Sin `create-invitation` desplegada, la pantalla del owner da error de red. Sin `update-property-status`, pausar/cerrar/eliminar en my-listings falla contra remoto. Sin `admin-create-agency`, el panel admin no crea agencias.

**2. Google keys (#36) — receta exacta.** Hallazgo: `GOOGLE_MAPS_API_KEY` y `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` son **LA MISMA key** (`AIzaSy…Lh7Y`). Restringirla a "Android apps" rompería Places (el fetch de RN no manda `X-Android-Package`/`X-Android-Cert`). Plan en [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials):
1. **Crear key nueva "urbea-android-maps":** Application restrictions → *Android apps* → package `com.urbea.app` + SHA-1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` (debug keystore de Expo — público/débil; al hacer el build EAS de la #20, añadir el SHA-1 del keystore EAS: `eas credentials -p android`). API restrictions → *Maps SDK for Android* únicamente. → pegar en `GOOGLE_MAPS_API_KEY` de `.env.local` y **rebuild del dev client** (`pnpm emu` lo rehace; es config nativa).
2. **Key existente (`…Lh7Y`) queda solo-Places:** API restrictions → *Places API (New)* únicamente. Sin app-restriction (techo conocido: para app-restringirla habría que mandar headers Android en `AddressAutocomplete.tsx`).
3. **iOS:** el mapa usa el provider default (Apple Maps) — hoy NO necesita key de Google en iOS.

**3. Pase manual (#38) — todo listo:**
```bash
cd mobile && pnpm emu   # emulador + Metro; la app ya apunta al remoto sembrado
```
Checklist §5 con las cuentas de arriba. Sugerencia de pase: buscador1 (feed/like/save/filtros/mapa/contacto) → agente1.gdl (publicar/my-listings/CRM/perfil) → owner.oeste (CRM equipo + Invitar agentes*) → admin (panel). *Requiere el deploy de `create-invitation`.
