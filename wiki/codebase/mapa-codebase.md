---
tipo: codebase
actualizado: 2026-06-28
---

# Mapa del codebase

**Pieza clave del vault:** dominio/concepto → archivos exactos. Consultar ANTES de escribir código (¿ya existe algo reutilizable?). Reemplaza `grep`.

## Backend — Supabase (existe)
Detalle de tablas/migraciones en [[db-schema-map]].

| Dominio | Archivos | Concepto |
|---------|----------|----------|
| Identidad | `supabase/migrations/..._identity_users.sql` | [[roles-y-permisos]] |
| Inmobiliarias/Agentes | `..._agencies_and_agents.sql` | [[inmobiliarias-y-agentes]] |
| Propiedades/Video | `..._properties_and_videos.sql` | [[propiedades-y-video]] |
| Storage (video) | `..._storage_property_videos.sql` (0011: bucket `property-videos` + col `storage_path` + RLS INSERT/SELECT en `storage.objects`) · `..._property_videos_ready_requires_storage.sql` (0012: CHECK `ready` exige `storage_path` o `cloudflare_uid`) | [[propiedades-y-video]] |
| Storage (foto perfil) | `..._profile_photos_storage.sql` (0015, #6: bucket **público** `profile-photos` + RLS por path `auth.uid()` en `storage.objects` + cols `full_name`/`profile_photo_url` en `user_preferences`) | [[onboarding-y-preferencias]] |
| Publicación (RPC) | `20260625000001_publish_property_rpc.sql` (#8: RPC `publish_property_atomic` SECURITY DEFINER search_path fijo — inserta `properties` status=active + `property_videos` status=ready en 1 tx atómica sin EXCEPTION; `location=ST_Point(lng,lat,4326)`) + rollback | [[propiedades-y-video]] |
| Edge Functions | `supabase/functions/publish-property/` (#8: handler DI + `index.ts` impls reales `CallerVerifier`[agent/admin]+`PropertyPublisher`; valida payload, 401/403, llama RPC) · `update-property-status/` (#17.5: handler DI + `make_property_status_updater(client)` testeable — transiciones/ownership/closed_reason; 54 Deno tests) · `admin-create-agency/` (#7) · `_shared/` (cors/response/auth/validation/clients) | [[propiedades-y-video]], [[inmobiliarias-y-agentes]] |
| Engagement/CRM | `..._engagement_crm.sql` | [[crm-leads]], [[feed-vertical-video]] |
| Moderación/Analítica | `..._analytics_moderation_audit.sql` | [[moderacion]], [[notificaciones]] |
| RLS/Seguridad | `..._rls_helpers_and_policies.sql`, `..._security_perf_hardening.sql` | [[rls-seguridad]] |
| Legal | `..._user_profile_legal.sql` | [[legal-consentimientos]] |
| Tests | `supabase/tests/01_constraints_test.sql`, `02_rls_test.sql`, `03_storage_test.sql`, `03_redeem_invitation_test.sql`, `04_profile_photos_test.sql` (#6: 17 asserts bucket+RLS+cols), `05_admin_create_agency_test.sql` (#7: RPC 0016, plan 20), `06_publish_property_rpc_test.sql` (#8: RPC publish_property_atomic, plan 8) | [[rls-seguridad]] |
| Tests EF/hooks (mobile+deno) | `supabase/functions/publish-property/handler.test.ts` (#8: 43 Deno tests, DI) · `supabase/functions/update-property-status/{handler,property_status_updater}.test.ts` (#17.5: 44+10 Deno tests) · `mobile/src/features/publish/__tests__/{useVideoUpload,usePublish,usePublish.edit,useLoadProperty}.test.tsx` (#8+#17.8: 14+10+9+8 Jest) · `mobile/src/features/profile/__tests__/usePropertyActions.test.tsx` (#17.7: 22 Jest) | [[propiedades-y-video]] |

## Documentación de producto
| Concepto | Fuente |
|----------|--------|
| [[feed-vertical-video]] | `docs/PRD.md` §9 |
| [[propiedades-y-video]] | `docs/PRD.md` §12-13 |
| [[roles-y-permisos]] | `docs/PRD.md` §4 |
| [[crm-leads]] | `docs/PRD.md` §19 |
| [[monetizacion-pago-por-video]] | `docs/PRD.md` §17 |
| Alcance demo | `docs/PRD-MVP-demo.md` |
| Lineamientos | `docs/lineamientos-desarrollo.md` |

## App móvil — `mobile/` (inicializada · tareas #1, #2)
Base **existe** (Expo SDK 56, dev build, Expo Router, TS strict, standalone). Lo ya construido:
- `mobile/app.config.ts` — config dinámica: `com.urbea.app` (iOS+Android), slug/scheme `urbea`, owner EAS `deabratech`, Google Maps vía `process.env.GOOGLE_MAPS_API_KEY`, plugins (expo-dev-client/router/video). projectId EAS `85c7157a-…`.
- `mobile/eas.json` — perfiles `development`/`preview`/`production`. Proyecto EAS: `@deabratech/urbea`.
- `mobile/.npmrc` — `node-linker=hoisted` (gotcha Metro+pnpm). `mobile/.env.local` (gitignored) con credenciales Supabase; `.env.example` con nombres.
- `mobile/app/_layout.tsx` — root: `SafeAreaProvider > AuthProvider > Stack` (headerShown:false). `mobile/app/login.tsx` — pantalla de login (fuera del grupo protegido).
- `mobile/app/(protected)/_layout.tsx` — guard de rutas (thin wrapper de `ProtectedLayout`) · `mobile/app/(protected)/index.tsx` — home protegida (placeholder "Urbea"; `/` resuelve aquí, el grupo es transparente a la URL).
- `mobile/src/lib/supabase/client.ts` — **cliente Supabase tipado** `createClient<Database>` + AsyncStorage (persistSession, autoRefreshToken) + listener `AppState` start/stopAutoRefresh (hotspot global; smoke test 200 OK contra remoto) → [[rls-seguridad]].
- `mobile/src/types/database.ts` — re-export de `supabase/types/database.types.ts`.
- `mobile/tsconfig.json` — strict (+ noUncheckedIndexedAccess, exactOptionalPropertyTypes), alias `@/*`→`src/*`.
- **Tests** (tarea #2): `jest-expo` + `@testing-library/react-native`; `mobile/jest.config.js` (preset, `moduleNameMapper @/`, `transformIgnorePatterns` con fix `.pnpm`), `mobile/jest.setup.js` (mock AsyncStorage). Correr: `pnpm test`. Ver [[comandos]].

Estructura prevista por feature (carpetas `src/{features,components,theme,hooks}` ya creadas, vacías):
- `src/features/auth/` — **Auth email/password (tarea #2, vivo)**: `context.tsx` (AuthProvider + `useAuth()` → {session,user(perfil public.users),isLoading,signIn,signOut}; carga perfil por `id=auth.uid()`, listener onAuthStateChange), `validation.ts` (validación pura de form), `auth-errors.ts` (`map_auth_error` → mensajes ES), `protected-layout.tsx` (guard: loading→Redirect→Slot), `components/form-field.tsx`. **Solo login** (cuentas sembradas, sin signup); canje de código de invitación → tarea #3. → [[roles-y-permisos]], [[inmobiliarias-y-agentes]]
- `src/features/onboarding/` — **Onboarding agente (tarea #6, vivo)**: ruta `mobile/app/onboarding.tsx` → `OnboardingScreen.tsx` (nombre + foto, validación, skip foto, progreso, nav a `/(protected)`, guard re-show), `validation.ts` (`is_valid_full_name`), `components/AvatarPicker.tsx`, `hooks/useImagePicker.ts` (cámara/galería, permisos ES). Servicios en `src/lib/`: `profileService.ts` (`saveProfile`: upload Storage + upsert `user_preferences`), `imageUtils.ts` (`processProfileImage`: resize 512 + compresión ≤1MB). → [[onboarding-y-preferencias]]
- `src/features/feed/` — feed vertical → [[feed-vertical-video]]
- `src/features/search/` — filtros → [[busqueda-y-filtros]]
- `src/features/map/` — mapa → [[mapa-y-ubicacion]]
- `src/features/publish/` — **wizard 3 pasos + subida video (tarea #8, vivo)**: rutas `app/(protected)/publish/_layout.tsx` (`PublishFormProvider` envuelve Stack + `WizardHeader` con `useSegments()`→StepIndicator), `step1.tsx` (operación rent/sale/both + tipo casa/departamento/local/oficina/terreno), `step2.tsx` (price/recámaras/baños/m²/descripción + `AddressAutocomplete` + `MapPicker` + toggles nicho + `validate_step2`), `step3.tsx` (expo-image-picker video → preview expo-video → upload → botón Publicar). `store/PublishFormContext.tsx` (`usePublishForm`→{state,update,reset}), `store/types.ts` (`PublishFormState`/`PublishFormPayload`), `validation.ts` (`validate_step1/2/3`, `get_property_payload`). Componentes: `SelectionCard`, `NumericStepper`, `AddressAutocomplete` (Places API New REST+fetch, key `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY`, degrada sin key), `MapPicker` (react-native-maps, marker draggable, no escribe coords falsas). Hooks (críticos, TDD): `hooks/useVideoUpload.ts` (genera video_id UUID → sube a `{user_id}/{video_id}.mp4` bucket property-videos, escribe storage_path solo en éxito), `hooks/usePublish.ts` (**#17.8**: ramifica create/edit — create invoca EF `publish-property`; **editMode+propertyId → `from('properties').update({...}).eq('id')` UPDATE directo con RLS**, sin EF), `hooks/useLoadProperty.ts` (**#17.8**: carga propiedad+videos por id → mapea a `PublishFormState` para pre-fill; `FormPrefiller` en `_layout.tsx`). Componente reutilizado fuera del feature: `src/components/StepIndicator.tsx`. → [[propiedades-y-video]]
- `src/features/profile/` (gestión, **tarea #17, vivo**) — **Mis publicaciones**: ruta `app/(protected)/profile/my-listings.tsx` (Stack bajo profile, NO tab; entrada desde `ProfileScreen`). `hooks/useMyProperties.ts` (todos los status del agente + video_count + contadores, `refetch`), `hooks/usePropertyActions.ts` (changeStatus/pause/close[guard closed_reason]/delete[soft-delete], invoca EF `update-property-status`; 22 tests TDD), `components/{PropertyListItem,PropertyActionMenu,FilterTabs,ClosePropertyDialog,DeletePropertyDialog}.tsx`, tipo `MyProperty` en `types.ts`. Token nuevo `colors.danger`. → [[propiedades-y-video]], [[perfil-agente]]
- `src/features/leads/` — CRM → [[crm-leads]]
- `src/features/profile/` — **perfil de agente (tareas #16 vivo, #22 vivo)**: `ProfileScreen.tsx` (ensamblaje compartido `{agent_id, is_own_profile}`), `hooks/useAgentProfile.ts` (identidad del agente: nombre+foto de `user_preferences`, bio/created_at de `users`, agencia de `agencies` — 2 queries `Promise.all`; **#22.5: re-fetch on focus vía `useFocusEffect`** para anti-stale tras editar), `hooks/useEditProfile.ts` (**#22, vivo**: `save({fullName,imageUri,bio,removePhoto})` dual-write híbrido → `profileService` user_preferences + `users.bio`; error independiente; devuelve `{ok,error}`), `hooks/usePropertiesGrid.ts` (propiedades active/paused del agente + primer video), `components/ProfileHeader.tsx` (avatar/nombre display/badge agencia/miembro-desde/bio), `components/PropertiesGrid.tsx` (`FlatList numColumns=2`, celdas `PropertyGridCard`), `components/EmptyState.tsx` (`ListEmptyComponent`, copy por is_own_profile), `types.ts` (`AgentProfile`/`GridProperty`), `__tests__/{useEditProfile,useAgentProfile}.test.tsx` (#22, TDD). Rutas: `app/(protected)/(tabs)/profile.tsx` (propio) + `app/(protected)/profile/[id].tsx` (ajeno, bajo guard) + **`app/(protected)/profile/edit.tsx` (#22: editar avatar/nombre/bio, validación + char counter)**. → [[perfil-agente]], [[design-system]]
- `app/admin/` — **panel admin (#7, vivo)**: `_layout.tsx` (guard, re-exporta `src/features/admin/admin-layout.tsx`), `index.tsx` (lista de inmobiliarias, SELECT directo RLS admin), `agencies/create.tsx` (form → invoca `admin-create-agency`), `agencies/[id].tsx` (detalle: token+invite-link de un solo uso vía params + lista de miembros) → [[inmobiliarias-y-agentes]]
- `src/features/admin/` — **`admin-layout.tsx` (#7, vivo)**: guard `role=admin` (isLoading→spinner, sin sesión→/login, no-admin→/(protected), admin→Slot) → [[inmobiliarias-y-agentes]]
- `src/lib/supabase/` — cliente tipado · `src/components/` — **`PrimaryButton.tsx` (#6, vivo)**: CTA liquid-glass salvia (variantes primary/ghost) · **`PropertyGridCard.tsx` (#16, vivo)**: card de firma (thumbnail 4:5, precio héroe Space Grotesk + tick Salvia, badges operación/Pausada; lo reusa el feed #9) · `StepIndicator.tsx` · **`src/theme/theme.ts` (#16, vivo; +#26)**: design system sembrado (tokens del kit 003: colors/radii/shadows/fonts/type_scale/spacing s_4…s_40; **+grupo `layout` #26**: `screen_inset:20`/`grid_gutter:14`/`grid_cols:2`, extraído del prototipo de layout; gestión-claro; dual-mode oscuro pendiente #9) · **`Urbea Prototipo (standalone).html` (raíz, #26)**: referencia canónica de **layout** (acomodo/grid/espaciado), complementa a `urbea-identidad-visual.html` (lenguaje visual); solo layout, nunca color/fuente → [[design-system]]

## Edge Functions — `supabase/functions/` (Deno; correr `deno test/lint/fmt` DESDE este dir)
**Patrón DI (tarea #5, vivo):** cada función = `handler.ts` (lógica PURA con deps inyectables; lo que importan los tests, offline, sin supabase-js) + `index.ts` (entry de prod: construye deps reales con `Deno.serve`) + `*.test.ts`. Deps externas en `deno.json` (import map: `@supabase/supabase-js`, `@std/assert`). Errores siempre `{error:{code,message}}`. → [[inmobiliarias-y-agentes]], [[rls-seguridad]]
- `validate-invitation/` — **vivo**: POST `{invitationCode}` → 200 `{agency_name}` (preview del código antes de registrarse) | 404/422/400.
- `redeem-invitation/` — **vivo**: POST `{invitationCode,email,password,firstName,lastName}` → orquesta: validar token → `auth.admin.createUser` (email_confirm:true) → RPC `redeem_invitation_atomic` (canje atómico) → 200 `{user_id,agency_id,agency_name,agency_member_id}`. **Compensación** `deleteUser` si la RPC falla (no hay tx distribuida auth↔public). `x-forwarded-for` → 1ª IP (param `inet`).
- `admin-create-agency/` — **vivo (#7)**: POST (requiere JWT admin) `{name,slug,contact_*,owner_email,owner_first_name,owner_last_name}` → verifica `role=admin` (`AdminVerifier`: JWT→`auth.getUser`→`users.role`, 403 si no) → owner por **invitación** (`auth.admin.generateLink({type:'invite'})`, sin password) → RPC **`admin_create_agency_atomic`** (0016: agency+member owner+UPDATE users+token hasheado+admin_actions, atómico) → 201 `{agency_id,owner_user_id,invite_action_link,plain_token,token_id}`. Token plano **solo en la respuesta**; persiste el hash. **Compensación** `deleteUser` si la RPC falla.
- `_shared/` — `cors.ts`, `response.ts` (`json_response`/`error_response`), `crypto.ts` (`sha256_hex`; el token se guarda hasheado; **`generate_invitation_code(8)`** alfanumérico, #7), `validation.ts` (`parse_redeem_invitation_input`, **`parse_create_agency_input`** #7), `invitation.ts` (`validate_invitation_token`: NOT_FOUND→REVOKED→EXPIRED→MAX_USES→AGENCY_INACTIVE), `auth_user.ts` (`create_agent_auth_user`, **`create_owner_invite`** + `generateInviteLink` en `AuthAdminClient`, #7), `redeem.ts` (contrato + mapeo P0001→HTTP), **`admin_auth.ts`** (`AdminVerifier`, #7), **`agency.ts`** (`AgencyCreator` + mapeo error→HTTP, #7), **`clients.ts`** (adaptadores reales supabase-js `service_role`; ÚNICO sitio que importa supabase-js; `make_admin_verifier`/`make_agency_creator`/`make_auth_admin`).
- ⚠️ **`service_role` necesita grants DML explícitos** en `public` (migración 0014); sin ellos PostgREST devuelve 403 a la capa de servicio. → [[rls-seguridad]]
- _Pendientes_: `properties/` (publicación) → [[propiedades-y-video]] · `leads/` (contacto) → [[crm-leads]].
