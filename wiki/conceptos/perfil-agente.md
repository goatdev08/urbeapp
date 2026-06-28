---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md, .taskmaster (tareas #16, #22)]
codigo: [mobile/src/features/profile/, mobile/app/(protected)/(tabs)/profile.tsx, mobile/app/(protected)/profile/[id].tsx, mobile/app/(protected)/profile/edit.tsx, mobile/src/components/PropertyGridCard.tsx]
actualizado: 2026-06-27
---

# Perfil de agente

> Pantalla de perfil de un agente: header (foto, nombre, agencia, "miembro desde", bio) + grid 2 columnas de sus propiedades publicadas. Primera pantalla con identidad Urbea ([[design-system]]). **Vivo, tarea #16.**

## Rutas
- **Perfil propio** — `mobile/app/(protected)/(tabs)/profile.tsx` (tab "Perfil", URL `/profile`). Llama al ensamblaje con `agent_id = user.id`, `is_own_profile = true`.
- **Perfil ajeno** — `mobile/app/(protected)/profile/[id].tsx` (Stack **bajo `(protected)`** → requiere auth; movida ahí en #16.6, antes estaba fuera del guard). `is_own_profile = user?.id === id`. No colisiona con el tab `/profile` (segmento extra).
- Ambas delegan en **`mobile/src/features/profile/ProfileScreen.tsx`** (compartido, props `{ agent_id, is_own_profile }`) — reusar > duplicar.

## Datos — `hooks/useAgentProfile.ts` (#16.2)
⚠️ **Fuente de identidad del agente = `user_preferences`, NO `users`.** El onboarding del agente (#6) escribe nombre+foto a `user_preferences.full_name`/`profile_photo_url` (cols de migración 0015, ver [[onboarding-y-preferencias]]). Por eso el hook lee:
- `full_name`, `profile_photo_url` ← `user_preferences` (cast `as never` + `as PrefsRow|null`, mismo patrón que `profileService` por tipos 0015 sin regenerar).
- `bio` ← `users.bio` (lo escribe **edit profile #22**, modelo híbrido Opción A; ver abajo).
- `member_since` ← `users.created_at`. `agency_name` ← `agencies.name` vía `users.agency_id` FK.
- Estrategia: 2 queries en `Promise.all`. Interface `AgentProfile` en `features/profile/types.ts`.
- **Re-fetch on focus (#22.5):** el hook usa `useFocusEffect(useCallback(…, [agent_id]))` (no `useEffect`) → re-fetcha al recuperar foco la pantalla, así tras editar y volver con `router.back()` el perfil muestra datos frescos (anti-stale). Patrón `ignore` para no setear estado tras blur/unmount; el re-fetch es silencioso (sin spinner full-screen, evita parpadeo).

## Grid de propiedades — `hooks/usePropertiesGrid.ts` + `components/PropertiesGrid.tsx` (#16.4)
Query: `properties` WHERE `owner_user_id=<id>` AND `status IN ('active','paused')` AND `deleted_at IS NULL` ORDER BY `published_at DESC`, con embedded select `property_videos(thumbnail_url, storage_path, position)` (primer video por `position` mín en cliente). Interface `GridProperty`. Render: `FlatList numColumns={2}`, `scrollEnabled={false}` (el padre `ScrollView` scrollea), celdas = [[design-system]] `PropertyGridCard`. ponytail demo: `thumbnail_url` llega null (publish #8 no lo puebla) → placeholder; sin virtualización; embedded select no filtra `deleted_at` del sub-video.

## Componentes y acciones
- **`ProfileHeader.tsx`** (#16.3) — avatar 96px (placeholder iniciales si null), nombre display, badge agencia (`primary_tint`), "Miembro desde {mes año}" es-MX, bio si existe. Cero hex hardcodeado (todo de theme.ts).
- **`EmptyState.tsx`** (#16.6) — `ListEmptyComponent` del grid; copy varía por `is_own_profile` ("Publica tu primera propiedad" / "Este agente aún no tiene publicaciones").
- **Botones (solo perfil propio):** "Editar perfil" (`PrimaryButton` → `router.push('/profile/edit')`, **vivo #22**) · "Cerrar sesión" (→ Alert confirmación → `signOut()`, el guard redirige solo).
- **`onPressProperty`** → Alert placeholder; **la ruta de detalle `/property/[id]` no existe aún** (otra tarea).

## Editar perfil — `app/(protected)/profile/edit.tsx` + `hooks/useEditProfile.ts` (#22)
Pantalla de edición (form gestión-claro): `AvatarPicker` (reusado de onboarding #6), nombre, bio multiline con char counter (`{n}/280`, `maxLength=280`). Validación nombre (reusa `is_valid_full_name` de onboarding + max 100); error dirty (solo tras blur/intento de guardar); botón `disabled={isSaving || !is_form_valid}`. Pre-fill en mount: 1 query a `user_preferences` (bio ya viene en memoria de `useAuth().user`, no requiere 2ª query — ponytail).
**Save híbrido (Opción A, decisión cliente — sin migración):** hook `useEditProfile.save({fullName,imageUri,bio,removePhoto})` hace **dual-write con manejo de error INDEPENDIENTE**: (A) `profileService.saveProfile({fullName,imageUri,userId})` → foto Storage + UPSERT `user_preferences`; (B) `supabase.from('users').update({bio}).eq('id',userId)` → `users.bio`. B se intenta aunque A falle; cualquier fallo queda expuesto. `save()` **devuelve `{ok,error}`** → `edit.tsx` muestra Alert en fallo (no navega) o `router.back()` en éxito. **Quitar foto:** `removePhoto=true` → `imageUri=null` → `profileService` UPSERT `profile_photo_url=null` (ya lo soportaba). TDD: `useEditProfile.test.tsx` (15 tests). ⚠️ Guardian capturó 2 bugs reales (test verde/prod roto): `isSaving` no llegaba al botón (faltaba re-render al inicio) y `error` leído de snapshot obsoleto de closure → corregidos.

## Pendientes derivados
- Detalle de propiedad (`/property/[id]`) — no existe; `onPressProperty` es stub.
- **#23** — fila de estadísticas profesionales + IsotipoMark en el perfil (dep #11).
- **#24** — configurar ESLint + script `pnpm lint` (gate del workflow asume lint pero el repo no lo tiene cableado; hoy solo `tsc`). Detectado en #22.5 por guardian.
- Verificación E2E en device del flujo editar (smoke con simulador) — pendiente de sesión con build.
- Deuda: regenerar `database.types.ts` (post-0015) para quitar casts `as never`.

## Relacionados
[[design-system]] · [[onboarding-y-preferencias]] · [[propiedades-y-video]] · [[inmobiliarias-y-agentes]]
