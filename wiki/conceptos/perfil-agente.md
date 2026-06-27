---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md, .taskmaster (tarea #16)]
codigo: [mobile/src/features/profile/, mobile/app/(protected)/(tabs)/profile.tsx, mobile/app/(protected)/profile/[id].tsx, mobile/src/components/PropertyGridCard.tsx]
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
- `bio` ← `users.bio` (**ningún flujo lo escribe aún** → null; lo resolverá #22).
- `member_since` ← `users.created_at`. `agency_name` ← `agencies.name` vía `users.agency_id` FK.
- Estrategia: 2 queries en `Promise.all`. Interface `AgentProfile` en `features/profile/types.ts`.

## Grid de propiedades — `hooks/usePropertiesGrid.ts` + `components/PropertiesGrid.tsx` (#16.4)
Query: `properties` WHERE `owner_user_id=<id>` AND `status IN ('active','paused')` AND `deleted_at IS NULL` ORDER BY `published_at DESC`, con embedded select `property_videos(thumbnail_url, storage_path, position)` (primer video por `position` mín en cliente). Interface `GridProperty`. Render: `FlatList numColumns={2}`, `scrollEnabled={false}` (el padre `ScrollView` scrollea), celdas = [[design-system]] `PropertyGridCard`. ponytail demo: `thumbnail_url` llega null (publish #8 no lo puebla) → placeholder; sin virtualización; embedded select no filtra `deleted_at` del sub-video.

## Componentes y acciones
- **`ProfileHeader.tsx`** (#16.3) — avatar 96px (placeholder iniciales si null), nombre display, badge agencia (`primary_tint`), "Miembro desde {mes año}" es-MX, bio si existe. Cero hex hardcodeado (todo de theme.ts).
- **`EmptyState.tsx`** (#16.6) — `ListEmptyComponent` del grid; copy varía por `is_own_profile` ("Publica tu primera propiedad" / "Este agente aún no tiene publicaciones").
- **Botones (solo perfil propio):** "Editar perfil" (`PrimaryButton` ghost → Alert "Próximamente (tarea #22)", **stub**) · "Cerrar sesión" (→ Alert confirmación → `signOut()`, el guard redirige solo).
- **`onPressProperty`** → Alert placeholder; **la ruta de detalle `/property/[id]` no existe aún** (otra tarea).

## Pendientes derivados
- **#22** — pantalla de editar perfil (avatar/nombre/bio). Debe decidir el modelo: bio a `users.bio` vs consolidar identidad del agente en una tabla. Reusa `profileService` + `AvatarPicker`.
- Detalle de propiedad (`/property/[id]`) — no existe; `onPressProperty` es stub.
- Deuda: regenerar `database.types.ts` (post-0015) para quitar casts `as never`.

## Relacionados
[[design-system]] · [[onboarding-y-preferencias]] · [[propiedades-y-video]] · [[inmobiliarias-y-agentes]]
