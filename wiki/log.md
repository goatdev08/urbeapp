# Bitácora del proyecto

Append-only. Prefijo: `## [YYYY-MM-DD] tipo | título`.
Tipos: `fundacion`, `decision`, `ingest`, `query`, `lint`, `tarea`, `explore`.
Tip: `grep "^## \[" log.md | tail -5` → últimas 5 entradas.

## [2026-06-28] tarea | #17 Mis publicaciones (gestión de propiedades del agente)
- Pantalla `app/(protected)/profile/my-listings.tsx` (Stack bajo profile, NO tab — mockup #9 tab activo=Perfil; entrada desde `ProfileScreen`). 8 subtareas en serie.
- **EF `update-property-status`** (crítica, TDD): patrón DI + `make_property_status_updater` extraído a módulo testeable (transiciones/ownership/closed_reason); 54 Deno tests. Guardian dio FAIL en ciclo 1 (lógica de dominio solo en `index.ts`, sin tests = trampa mock-vs-prod del #8) → se extrajo y se añadieron 10 tests sobre la lógica real; PASS verificado **por mutación**.
- **UI**: `useMyProperties` (todos los status + video_count + contadores) · `PropertyListItem` (badge/stats) · `FilterTabs` · `PropertyActionMenu` (Modal nativo, sin dep nueva).
- **Acciones** (crítica, TDD): `usePropertyActions` (22 tests) — guard cliente close-sin-reason NO invoca EF; soft-delete por RLS; diálogos Close (motivo obligatorio)/Delete. Guardian PASS.
- **Editar** (crítica, TDD): `useLoadProperty` pre-llena el wizard; `usePublish` ramifica create(EF)/edit(**UPDATE directo con RLS**, decisión cliente); video opcional en edit; 17 tests + guardias de regresión del create. Guardian PASS (create intacto).
- Verificación final: mobile **193/193**, EF deno **54/54**, `tsc` 0. Follow-up creado: cablear `isWorking` en my-listings (UX, low). Commits locales en `tarea/17-mis-publicaciones`.

## [2026-06-27] decision | referencia visual canónica = urbea-identidad-visual.html
- Cliente: usar `urbea-identidad-visual.html` (raíz) como guía de diseño + plan de la demo. Enshrined en CLAUDE.md §8, [[design-system]] (mapeo pantalla→tarea + divergencias #16 vs mockup #10 + firmas pendientes: isotipo U+play, iconos a medida) y memoria branding-working-method.
- Regla durable: cada pantalla del mockup = techo de alcance de su tarea (UI ausente = trabajo nuevo, no scope-creep).
- Gotcha grabado: `expo-linear-gradient`/`react-native-svg` no están en el dev build → crashean; PropertyGridCard pasó a placeholder sólido.

## [2026-06-17] fundacion | vault inicializado
- Estructura del vault creada (MOCs, conceptos, codebase, decisiones, estado).
- Sembrado desde `docs/` y `supabase/` (DB migrada 0001–0010).

## [2026-06-17] decision | alcance del primer hito = demo cerrada de 3 semanas
- Sesión de preguntas (7 rondas) con el cliente. Ver [[0005-demo-cerrada-3-semanas]].
- PRD destilado en `docs/PRD-MVP-demo.md`.
- Demo: inmobiliaria+agentes, código de invitación, email+contraseña, wizard 3 pasos, video real a Supabase Storage (sin transcoding), feed vertical, filtros básicos, mapa con clustering, CRM lista+estados, contacto WhatsApp+lead. Dev build (expo-dev-client). Backend = Supabase remoto. Sin pagos.

## [2026-06-17] decision | ADRs 0001–0004 aceptadas
- [[0001-alcance-mvp-recomendado]], [[0002-monetizacion-pago-por-video]], [[0003-vault-obsidian-como-memoria]], [[0004-taskmaster-motor-de-ejecucion]].

## [2026-06-17] ingest | vault densificado a síntesis densa
- Los 13 conceptos reescritos con modelo de datos, invariantes, flujos y reglas + punteros precisos a las fuentes.
- Añadido [[MOC-fuentes]] (catálogo de docs/ y supabase/) — la capa que dice "a dónde ir por el detalle".
- Decisión del nivel de profundidad: síntesis densa (Karpathy), no espejo de los docs.

## [2026-06-17] fundacion | Taskmaster inicializado + backlog generado
- `task-master init` en la raíz; provider **claude-code/sonnet** (sin API key, $0). Canal: **CLI** (no MCP).
- `parse-prd` sobre `docs/PRD-MVP-demo.md` → **20 tareas** (tag `master`).
- `analyze-complexity` → 6 alta / 11 media / 3 baja. Reporte en `.taskmaster/reports/task-complexity-report.json`.
- Next: **#1** init Expo + dev build. Branding (#19) en pausa por decisión del cliente.

## [2026-06-17] decision | CLAUDE.md + workflow de ejecución (ADR 0006)
- Creado `CLAUDE.md` (schema operativo): principio rector, inicio de sesión, stack, Taskmaster CLI, workflow de ejecución, cierre, mantenimiento del vault.
- **PNPM siempre** como gestor de paquetes y dev server (nunca npm/yarn).
- Workflow: Taskmaster como bitácora viva vía `update-subtask`; verificación con `pnpm`; ingest al vault al cerrar. Ver [[0006-workflow-ejecucion-tareas]].

## [2026-06-17] fundacion | tareas expandidas a subtareas (Opus)
- `task-master expand --all` con provider claude-code/**opus** → 20 tareas, **144 subtareas** (0 fallos, $0).
- Modelo devuelto a `sonnet` para la operación diaria.
- Backlog listo para ejecución fina con el workflow ([[0006-workflow-ejecucion-tareas]]). Next: **#1**.

## [2026-06-17] fundacion | workflow multi-agente construido (ADR 0007)
- `.claude/agents/`: analista-subtareas, mobile, supabase, design, test-author, guardian.
- `.claude/skills/`: urbea-context, urbea-expo, urbea-supabase, urbea-design, urbea-testing.
- `.claude/commands/`: tm-plan, tm-tarea (modo auto), tm-status. Hooks: tdd-guard.sh (pragmático), close-reminder.sh. settings.json con permisos + hooks.
- TDD pragmático por criticidad, serie con checkpoints, manejo de bloqueantes, convención de nombres snake_case. graphify contemplado a futuro. Ver [[0007-workflow-multiagente]].

## [2026-06-21] explore | aprobado tarea 19 — Branding + Design System de Urbea

## [2026-06-23] tarea | #1 init Expo + dev build — app móvil inicializada
- `mobile/` scaffold Expo SDK 56 (blank-typescript, standalone, `.npmrc` hoisted), Expo Router, TS strict.
- EAS configurado: `app.config.ts` (`com.urbea.app`, owner `deabratech`), `eas.json` (development/preview/production); proyecto `@deabratech/urbea` registrado (projectId 85c7157a-…).
- Deps nativas: expo-dev-client, expo-router, react-native-maps@1.27.2 (sin fricción en SDK 56), expo-video, screens, safe-area-context.
- Cliente Supabase tipado `src/lib/supabase/client.ts` (createClient<Database> + AsyncStorage); smoke test **200 OK** contra remoto `mvpvqmyhrrkwbnpctpuq`. Credenciales en `.env.local` (gitignored).
- Mapa-codebase actualizado (sección móvil → archivos reales). Rama `tarea/1-init-expo-mobile` (commits locales). Pendiente humano: primer `eas build` para ver la app en device.

## [2026-06-23] hito | #1 dev build instalado en device
- Primer `eas build` (development, Android) exitoso tras resolver cascada: `npx eas-cli` (no pnpm-global), `app.config.js` (no `.ts`), y `mobile/` self-contained (sin `pnpm-workspace.yaml` raíz que hoisteaba deps nativas fuera de EAS).
- `.apk` instalado; Urbea corriendo nativo en device vía `pnpm expo start --dev-client` (Supabase activo).
- Nuevo: `wiki/codebase/comandos.md` (referencia de comandos dev/EAS/verificación/Taskmaster).

## [2026-06-24] tarea | #2 Auth Supabase email/password en mobile
- BD verificada para la demo: tabla public.users + trigger handle_new_user + RLS + column-grants YA cubren el flujo (sin migración nueva). Hueco menor: last_login_at no se auto-actualiza (cosmético).
- AuthContext (src/features/auth/context.tsx): useAuth {session,user(perfil public.users),isLoading,signIn,signOut} + onAuthStateChange. Login solo (cuentas sembradas; signup/invitación → #3).
- Pantalla login (app/login.tsx) + validación pura (validation.ts) + mapeo de errores ES (auth-errors.ts) + guard de rutas (protected-layout.tsx → app/(protected)/) + AuthProvider en root.
- Persistencia AsyncStorage ya estaba en client.ts (tarea #1); añadido listener AppState para start/stopAutoRefresh.
- Harness de tests jest-expo + testing-library (nuevo). TDD en críticas (2.1, 2.4, 2.5) con guardian (3 mutantes verificados por subtarea). Total: 60 tests verdes, tsc strict limpio.
- Estructura feature-based confirmada (src/features/auth/). Rama tarea/2-auth-supabase (commits locales).

## [2026-06-24] tarea | #3 Supabase Storage — bucket property-videos + RLS
- Migración 0011 (`supabase/migrations/20260604000011_storage_property_videos.sql`, +rollback): bucket `property-videos` (privado, 100 MB, mp4/quicktime/webm), columna `property_videos.storage_path` (único parcial), y 2 políticas RLS en `storage.objects`.
- RLS INSERT (`property_videos_storage_insert`): agente/admin sube solo a su propio path (`foldername[1]=auth.uid()` + rol). Gate dueño+rol como `properties_insert`; no hay admin-anywhere.
- RLS SELECT (`property_videos_storage_select`): lectura pública si `private.property_is_public(foldername[2])` (helper SECURITY DEFINER 0010, sin JOIN inline → evita colisión RLS anon) o si eres el dueño.
- Convención de path: `{user_id}/{property_id}/{video_id}.mp4`. Ver [[propiedades-y-video]] §Storage.
- CORS: hallazgo — Supabase no tiene CORS por bucket (gateway permisivo; subidas nativas Expo/RN no aplican CORS). Nada que configurar para la demo.
- TDD contra remoto vía MCP (sin stack local): RED→GREEN en tx con rollback, `apply_migration` al final. Tests `supabase/tests/03_storage_test.sql` (pgTAP, 16 asserts). Guardian PASS en 3.1/3.2/3.3. Aplicada a `urbea-app` (migración 20260604000011 en historial). Rama `tarea/3-storage-videos`.
- ⚠️ Gotcha: `task-master update-task --id=3` (provider AI) **regeneró las subtareas** (pasaron de split por-feature a split por-fase). Trabajo idéntico y completo, pero los títulos quedaron reescritos. Usar `update-subtask` para notas, no `update-task`.

## [2026-06-24] tarea | #4 property_videos — CHECK ready_requires_storage (0012) + regen tipos
- **Reencuadre de alcance**: la tarea #4 se redactó antes de la #3; su meta principal (añadir col `storage_path`) **ya la hizo 0011** (tarea #3). Subtarea 4.1 cerrada como cubierta por 0011 (no se recreó la columna). Nombre de archivo del enunciado (`20260617000011_demo_video_storage.sql`) obsoleto.
- Migración **0012** (`supabase/migrations/20260604000012_property_videos_ready_requires_storage.sql`, +rollback): CHECK `property_videos_ready_requires_storage` = `status <> 'ready' OR storage_path IS NOT NULL OR cloudflare_uid IS NOT NULL`. Idempotente (drop if exists + add).
- **Decisión de diseño**: constraint **condicional al status** (no plana), espejando `property_closed_requires_reason`. Motivo: `status` default `'uploading'` y el `storage_path` (`{user_id}/{property_id}/{video_id}.mp4`) depende del `id` de la fila → la fila existe antes de tener referencia; una CHECK plana rompería el INSERT de subida y los fixtures pgTAP existentes (que tenían videos `ready` sin referencia → ajustados con `cloudflare_uid`/`storage_path`).
- TDD contra remoto vía MCP (sin stack local): RED (asserts 14-18 en `01_constraints_test.sql`, plan(13)→plan(18)) → GREEN (`apply_migration`) → probe focalizado 5/5 ok. Guardian PASS.
- ⚠️ Gotcha MCP: el archivo `01_constraints_test.sql` **completo no corre por `execute_sql`** — su assert #11 (pre-existente) usa un CTE data-modifying anidado que Postgres rechaza fuera de top-level. Para verificar por MCP se usa un probe focalizado (subset de asserts) recogiendo el TAP en una temp table (execute_sql solo devuelve el último result set).
- 4.3: regenerados tipos TS vía MCP (`property_videos.storage_path` ya aparece en Row/Insert/Update; antes faltaba), `pnpm tsc --noEmit` rc=0; `supabase/README.md` documenta 0011 y 0012 (demo, no billing). Rama `tarea/3-storage-videos`.
## [2026-06-24] tarea | #5 Canje de invitación + registro de agente
- Edge Functions (Deno, patrón DI handler.ts puro / index.ts entry): `validate-invitation` (POST {invitationCode}→200 {agency_name}) y `redeem-invitation` (orquesta validar token→auth.admin.createUser→RPC canje→200; compensa deleteUser si falla). `_shared/` con cors/response/crypto(sha256)/validation/invitation/auth_user/redeem/clients (clients.ts = único import de supabase-js). Import map en deno.json; correr deno DESDE supabase/functions/.
- Atomicidad: migración 0013 RPC `redeem_invitation_atomic` (SECURITY DEFINER): consumo token + agency_members + denorm users + 4 user_consents; errores P0001→HTTP. user_preferences NO (es onboarding de buyer).
- Mobile: `app/register.tsx` en 2 fases (valida código→muestra agencia→datos+canje→auto-login signInWithPassword) + `src/features/registration/` (validation, registration-errors, api). 17 tests Jest.
- **Bug sistémico hallado en despliegue real:** `service_role` sin grants DML en `public` (0008 solo otorgó a authenticated/anon) → supabase-js service_role recibía 403 de PostgREST. Las RPC SECURITY DEFINER no se veían afectadas (corren como postgres). Fix: **migración 0014_service_role_grants**. Documentado en [[rls-seguridad]].
- Otros 2 fixes de integración: filtro embebido PostgREST `.is("agencies.deleted_at",null)` descartaba la fila padre (→ validar en JS); `x-forwarded-for` lista CSV rompía el param `inet` (→ 1ª IP).
- Verificación: smoke E2E contra remoto (validate 200/404/400; redeem 200 con efectos atómicos + compensación verificados; datos limpiados). deno fmt/lint/test: 65 verdes. Advisors security sin WARN/ERROR nuevos. Migraciones 0011–0014 aplicadas en `urbea-app`.
- Pendiente (cliente): consolidar ramas #1→#2→#3→#5 a main.

## [2026-06-24] tarea | #6 onboarding del agente (nombre + foto) — vivo
- **Flujo completo (mobile):** `app/onboarding.tsx` → `OnboardingScreen` con nombre (validación `is_valid_full_name` ≥2 trim), `AvatarPicker` (`useImagePicker`: cámara/galería, permisos ES con manejo de denegación), compresión (`imageUtils.processProfileImage`: resize 512 + JPEG iterativo 0.8→0.6→0.4 hasta ≤1MB), guardado (`profileService.saveProfile`: upload a Storage + upsert `user_preferences`), "Saltar foto", progreso (`loading`), nav `router.replace('/(protected)')`, guard de re-show (full_name proxy).
- **Backend (migración 0015, aplicada a `urbea-app`):** bucket **público** `profile-photos` + RLS por path `(storage.foldername(name))[1] = auth.uid()::text` (INSERT/UPDATE/DELETE dueño, SELECT público) + cols `full_name`/`profile_photo_url` en `user_preferences`. TDD: pgTAP `04_profile_photos_test.sql` (17 asserts, verde en tx contra remoto). Guardian PASS en 6.3 y 6.5.
- **Componente de firma:** `PrimaryButton` liquid-glass salvia (BlurView + overlay salvia con **opacidad por superficie** light 0.82 / dark 0.48 — decisión del cliente; adapta el kit `003-kit` sin `backdrop-filter`). Variantes primary/ghost, reutilizable en CTAs de la app.
- **Decisiones:** fuentes del sistema (Fraunces/Hanken diferidas a #19 branding); liquid-glass real con `expo-blur` variando opacidad por superficie.
- **Deuda:** regenerar `database.types.ts` (post-0015) para quitar casts `as never`/`as {...}` en profileService y guard.
- Tests: 101/101 (mobile) + 17 pgTAP. tsc limpio. Migración 0015 en historial remoto. Rama `tarea/6-onboarding`.

## [2026-06-25] tarea | #7 Panel admin: alta de inmobiliarias + owner
Edge Function `admin-create-agency` (patrón DI handler/index) + RPC **`admin_create_agency_atomic`** (migración **0016**, una sola firma 9 params SECURITY DEFINER): verifica `role=admin` del caller (JWT→users.role, 403 si no), crea owner por **invitación** (`generateLink type=invite`, sin password → action_link), y atómicamente INSERT agency(active)+agency_member(owner)+UPDATE users(role=agent)+token **hasheado**+admin_actions. Compensación `deleteUser` si la RPC falla. Token inicial 8-char alfanumérico, plano retornado 1 vez. Panel mobile `app/admin/` (guard `role=admin` en `src/features/admin/admin-layout.tsx`, lista, form que invoca la función, detalle `[id].tsx` con token/invite-link copiables un-solo-uso + miembros). TDD en backend (7.4–7.6 críticas, guardian PASS; capturó y revirtió un `ON CONFLICT DO NOTHING` que silenciaba ALREADY_ACTIVE_MEMBER). +`expo-clipboard ~56.0.4`. Tests: deno **112/112**, pgTAP 05 plan(20) vs remoto `urbea-app`, mobile tsc 0 + admin 8/8. Decisiones (atomicidad RPC / owner por email-invite / token 8-char) confirmadas con el cliente. Ingest: [[inmobiliarias-y-agentes]], [[mapa-codebase]], [[db-schema-map]].

## [2026-06-26] tarea | #8 Wizard de publicación 3 pasos + EF publish-property
Wizard `mobile/app/(protected)/publish/` (estado compartido `PublishFormContext` — React Context, no Zustand): step1 (operación rent/sale/both + tipo casa/departamento/local/oficina/terreno), step2 (precio/recámaras/baños via `NumericStepper`/m²/descripción + `AddressAutocomplete` [Google **Places API New** REST+fetch, key `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY`, degrada sin key] + `MapPicker` [react-native-maps, marker draggable, no escribe coords falsas] + toggles nicho + `validate_step2`), step3 (video via expo-image-picker → preview expo-video → upload → Publicar). Backend: Edge Function **`publish-property`** (handler DI + impls `CallerVerifier`[agent/admin, 401/403]+`PropertyPublisher`) + RPC **`publish_property_atomic`** (migración **20260625000001**, SECURITY DEFINER search_path fijo, INSERT properties(active)+property_videos(ready) en 1 tx atómica sin EXCEPTION, `location=ST_Point(lng,lat,4326)`). **Upload "Opción C"**: cliente genera `video_id` UUID y sube a `{user_id}/{video_id}.mp4` **antes** de la EF → la propiedad solo se crea si el upload tuvo éxito (sin huérfanos). TDD en críticas (8.9 EF, 8.8 useVideoUpload, 8.10 usePublish): guardian PASS en las 3 con mutation testing; en 8.8 validó que el patch de infra de RNTL `act.js` no enmascara fallos. Tests: deno **43/43** (EF) + pgTAP 06 plan(8) + mobile **24/24** (publish) + tsc 0. Decisiones (Opción C upload / Places REST / expo-image-picker / navegar al feed) confirmadas con el cliente. ⚠️ **Hallazgo en ingest**: el path de 2 segmentos rompe la **RLS SELECT pública** (`property_is_public(foldername[2]::uuid)` espera property_id) → terceros no leen el video; **diferido a tarea #21** (feed minta signed URLs vía EF con `service_role`, dep de #9). Rama `tarea/8-publish-wizard`. Ingest: [[propiedades-y-video]], [[mapa-codebase]].

## [2026-06-27] tarea | #16 Perfil de agente + design system sembrado
Primera pantalla con identidad Urbea tras **levantarse el gate de branding** (cliente 2026-06-26). 6 subtareas, ninguna crítica (pantalla de lectura). **#16.1** Tabs navigator `app/(protected)/(tabs)/` (Inicio+Perfil; admin/publish siguen Stack). **#16.2** `useAgentProfile` — ⚠️ corrección de fuente: la identidad del agente (nombre+foto) vive en `user_preferences` (la escribe el onboarding #6), NO en `users`; bio de `users.bio` (sin writer → null). **#16.3** **siembra `mobile/src/theme/theme.ts`** (tokens del kit 003: colors/radii/shadows/fonts/type_scale/spacing, gestión-claro, dual-mode pendiente #9) + carga fuentes (`@expo-google-fonts` space-grotesk+hanken via `useFonts` en root `_layout`) + `ProfileHeader`. ⚠️ **Tipografía canónica = Space Grotesk (kit), NO Fraunces (doc 003)** — confirmado cliente. **#16.4** `PropertiesGrid` (`FlatList numColumns=2`). **#16.5** `PropertyGridCard` (firma, global, lo reusa feed #9) — **preview HTML aprobado** (`003-kit/property-grid-card-preview.html`) → portado: thumbnail 4:5, precio héroe + tick Salvia, badges operación/Pausada, placeholder café. **#16.6** ensamblaje `ProfileScreen` compartido + botones (Editar=stub→**#22**, Logout=signOut) + `EmptyState`; `[id].tsx` movido a `(protected)`. Deps: `@expo-google-fonts/{space-grotesk,hanken-grotesk}`, `expo-font`, `expo-linear-gradient`. tsc 0 errores. Tareas nuevas: **#22** (editar perfil). Pendientes: detalle `/property/[id]` (stub), regenerar database.types post-0015. Rama `tarea/16-perfil-agente`. Ingest: [[perfil-agente]], [[design-system]], [[onboarding-y-preferencias]], [[mapa-codebase]].

## [2026-06-27] tarea | #22 Editar perfil de agente (avatar/nombre/bio)
Pantalla `app/(protected)/profile/edit.tsx` + hook `useEditProfile` (mobile, 5 subtareas, 22.3/22.5 críticas TDD). **Modelo bio = Opción A híbrido (decisión cliente, SIN migración):** `save({fullName,imageUri,bio,removePhoto})` hace **dual-write con manejo de error INDEPENDIENTE** — (A) `profileService.saveProfile` → foto Storage + UPSERT `user_preferences`; (B) `supabase.from('users').update({bio}).eq('id',userId)`. B se intenta aunque A falle; cualquier fallo expuesto; `save()` devuelve `{ok,error}` → Alert en fallo / `router.back()` en éxito. **Quitar foto:** `removePhoto=true` → `imageUri=null` → UPSERT `profile_photo_url=null` (profileService ya lo soportaba, 0 cambios). Pre-fill: 1 query a user_preferences (bio ya en memoria vía `useAuth().user` — ponytail). Validación nombre (reusa `is_valid_full_name`) + char counter bio `{n}/280`. **#22.5 anti-stale:** `useAgentProfile` migrado de `useEffect` a `useFocusEffect(useCallback(…,[agent_id]))` → re-fetch al recuperar foco. ⚠️ **Guardian capturó 3 bugs reales test-verde/prod-roto:** (1) `isSaving` no llegaba al botón (faltaba re-render al inicio del save), (2) `error` leído de snapshot obsoleto de closure en edit.tsx, (3) ref-guard `is_fetching` calibrado a un mock defectuoso que en prod tragaba el 1er re-fetch-on-focus (el escenario editar→volver) → mock corregido a semántica commit-once + guard eliminado. Los 3 corregidos, guardian PASS. Tests: `useEditProfile.test.tsx` 15 + `useAgentProfile.test.tsx` 6, suite **154/154**, tsc 0. Tareas nuevas: **#24** (configurar ESLint — el repo no tiene `pnpm lint` que el workflow asume). Rama `tarea/22-editar-perfil`. Ingest: [[perfil-agente]], [[mapa-codebase]].
