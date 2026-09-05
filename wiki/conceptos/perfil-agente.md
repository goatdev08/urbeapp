---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md, .taskmaster (tareas #16, #22, #23)]
codigo: [supabase/migrations/20260905300002_whatsapp_phone_for_profile.sql, supabase/tests/99_whatsapp_phone_for_profile_test.sql, mobile/src/features/profile/, mobile/src/features/profile/components/ProfileActions.tsx, mobile/src/features/profile/hooks/useAgentStats.ts, mobile/src/features/profile/components/ProfessionalStats.tsx, mobile/src/components/IsotipoMark.tsx, mobile/app/(protected)/(tabs)/profile.tsx, mobile/app/(protected)/profile/[id].tsx, mobile/app/(protected)/profile/edit.tsx, mobile/src/components/PropertyGridCard.tsx]
actualizado: 2026-08-16
---

# Perfil de agente

> Pantalla de perfil de un agente: header (foto, nombre, agencia, "miembro desde", bio, estadísticas) + grid **3 columnas** de portadas de sus propiedades publicadas. Primera pantalla con identidad Urbea ([[design-system]]). **Vivo, tareas #16, #22, #23, #179.**

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
Query: `properties` WHERE `owner_user_id=<id>` AND `status IN ('active','paused')` AND `deleted_at IS NULL` ORDER BY `published_at DESC`, con embedded select `property_videos(thumbnail_url, storage_path, position)` (primer video por `position` mín en cliente). Interface `GridProperty`. Render: `FlatList numColumns={layout.grid_cols}` (**3 desde #179**), `scrollEnabled={false}` (el padre `ScrollView` scrollea), celdas = [[design-system]] `PropertyGridCard`. ponytail demo: `thumbnail_url` llega null (publish #8 no lo puebla) → placeholder; sin virtualización; embedded select no filtra `deleted_at` del sub-video.

## Rediseño estilo Instagram (#179, 2026-08-16)
Abraham comparó el perfil con uno de Instagram y pidió tres cosas: 3 columnas, bio completa y header reacomodado. Lo que cambió y **por qué**:
- **Grid 3 columnas borde a borde.** Tokens en `theme.ts`: `layout.grid_cols: 3`, `layout.grid_tile_gap: 2` y el helper **`grid_tile_width(screen_width)`**. ⚠️ **El ancho de celda se calcula y se pasa por prop (`width`), NO con `flex:1`**: con `columnWrapperStyle` + `gap`, un `flex:1` **estira las celdas de la última fila parcial** (una sola propiedad ocupaba el ancho completo). `floor()` deja ≤2px sin usar al borde derecho — imperceptible, y evita que una fracción haga saltar la fila.
- **`PropertyGridCard` pasó de card a TILE** (portada 3/4 a sangre, sin sombra ni radio): badge de operación arriba-izq y precio abajo-izq en blanco con `textShadow`. Desapareció el body (título, zona, precio héroe con tick) porque en ~115px no cabe. Respaldo canónico: el `.gcell` del mockup 10 de `urbea-identidad-visual.html` ya definía así la celda del perfil. Sin degradado bajo el precio: exigiría `expo-linear-gradient` (módulo nativo ausente del dev build).
- **`GridSkeleton` replica el layout real** (3 col, tile 3/4, gap 2, sin líneas de texto). Si diverge vuelve el salto de layout que ese componente existe para evitar.
- **Guardados usa la misma grilla** (`SavedScreen`, `SavedGridItem` reenvía `width`); se quitó su `ItemSeparatorComponent` porque el `marginBottom` del `columnWrapper` ya separa filas.
- **Header en dos bloques:** fila avatar (80px, antes 96) + estadísticas a la derecha; debajo, identidad alineada a la izquierda. **La bio ya no se corta**: admitía 280 caracteres (tope de `profile/edit.tsx`) pero se pintaba con `numberOfLines={3}` — ahora crece con el contenido y respeta los saltos de línea.
- **Tercer stat: "Cerrados" salió.** Ver la sección de stats abajo.

### Ajuste #180 (mismo día, tras verlo en el dispositivo)
- **Las acciones salen del menú "⋯":** `components/ProfileActions.tsx` (nuevo) pinta una fila entre la bio y la grilla — perfil propio: **Editar perfil · Guardados**; perfil **ajeno**: **Contactar por WhatsApp** del mismo alto y forma, y se **omite** si el agente no tiene teléfono. Texto a la izquierda e ícono Phosphor a la derecha (`PencilSimple`, `BookmarkSimple` — el mismo de `SaveButton` y de la pantalla Guardados —, `WhatsappLogo`). Las dos entradas movidas se quitaron del `ProfileMenu`: dos caminos al mismo destino no aportan.
- **WhatsApp del perfil NO pasa por el CRM.** Se extrajo `open_whatsapp_text(phone, texto)` de `open_whatsapp` (que ahora la llama) en `features/property-detail/utils/whatsapp.ts`. No se usa `open_whatsapp_ef` porque su Alert "✓ Contacto enviado" mentiría: contactar a un agente **desde su perfil** no nace de una propiedad y el lead exige `property_id`. **#255 (2026-09-05):** `useAgentProfile` ya NO trae `users.phone` (RLS lo ocultaba para un publicador admin → sin botón). Expone `has_phone` (vista `agent_public_profiles`) y el número se resuelve al pulsar con la RPC `whatsapp_phone_for_profile` (`security definer`, solo `authenticated`, solo publicadores vivos con teléfono; migración `20260905300002`). El crudo sale por una sola puerta y solo cuando alguien pulsa.
- **"Leads" salió del header por completo** (ver stats abajo) y el perfil ajeno tampoco muestra "Guardados": hacia afuera la señal pública es cuánto gusta el catálogo.
- ⚠️ **La cabecera reserva la banda de los botones flotantes.** `container.paddingTop` = `s_8 + 40 + s_8` (margen + alto del botón "⋯"/atrás), no un `s_40` estético: en Android, con el inset superior chico, el "⋯" caía justo encima de la tercera columna de estadísticas.

## Componentes y acciones
- **`ProfileHeader.tsx`** (#16.3, +#23, reacomodado en #179.3) — avatar **80px** (placeholder iniciales si null), nombre display, badge agencia (`primary_tint`), "Miembro desde {mes año}" es-MX, bio si existe. Cero hex hardcodeado (todo de theme.ts). **#23:** acepta props `stats?`/`loading?` y renderiza `ProfessionalStats` (**desde #179 en la fila del avatar, no tras la bio**; recibe además `is_own_profile`); **badge de isotipo** (`IsotipoMark` blanco sobre círculo `colors.primary`+`shadows.sm`) posicionado `absolute` en la esquina del avatar — solo con foto (no en iniciales), vía `avatar_wrapper` sin `overflow:hidden` para que no se recorte.
- **`EmptyState.tsx`** (#16.6) — `ListEmptyComponent` del grid; copy varía por `is_own_profile` ("Publica tu primera propiedad" / "Este agente aún no tiene publicaciones").
- **Acciones (solo perfil propio):** ya NO son botones inline — viven en el botón flotante "⋯" (arriba-derecha) que abre `ProfileMenu` (bottom-sheet): Guardados, Mis publicaciones, [Invitar agentes / Miembros según rol], [Convertirme en agente / Registrar mi inmobiliaria si `role==='user'`], Editar perfil y Cerrar sesión. En la ruta empujada `/profile/[id]` se muestra además un `BackButton` flotante (#147).
- **`onPressProperty`** → `router.push('/property/[id]')` (la ruta de detalle **sí existe**).

## Editar perfil — `app/(protected)/profile/edit.tsx` + `hooks/useEditProfile.ts` (#22)
Pantalla de edición (form gestión-claro): `AvatarPicker` (reusado de onboarding #6), nombre, bio multiline con char counter (`{n}/280`, `maxLength=280`). Validación nombre (reusa `is_valid_full_name` de onboarding + max 100); error dirty (solo tras blur/intento de guardar); botón `disabled={isSaving || !is_form_valid}`. Pre-fill en mount: 1 query a `user_preferences` (bio ya viene en memoria de `useAuth().user`, no requiere 2ª query — ponytail).
**Save híbrido (Opción A, decisión cliente — sin migración):** hook `useEditProfile.save({fullName,imageUri,bio,removePhoto})` hace **dual-write con manejo de error INDEPENDIENTE**: (A) `profileService.saveProfile({fullName,imageUri,userId})` → foto Storage + UPSERT `user_preferences`; (B) `supabase.from('users').update({bio}).eq('id',userId)` → `users.bio`. B se intenta aunque A falle; cualquier fallo queda expuesto. `save()` **devuelve `{ok,error}`** → `edit.tsx` muestra Alert en fallo (no navega) o `router.back()` en éxito. **Quitar foto:** `removePhoto=true` → `imageUri=null` → `profileService` UPSERT `profile_photo_url=null` (ya lo soportaba). TDD: `useEditProfile.test.tsx` (15 tests). ⚠️ Guardian capturó 2 bugs reales (test verde/prod roto): `isSaving` no llegaba al botón (faltaba re-render al inicio) y `error` leído de snapshot obsoleto de closure → corregidos.

## Stats profesionales + isotipo (#23)
El mockup #10 de `urbea-identidad-visual.html` tenía dos componentes de firma que #16 no implementó; #23 los cierra.
- **`hooks/useAgentStats.ts` (#23.1, CRÍTICA TDD · reescrito en #179.1)** — queries en `Promise.all`: **publicaciones** (`properties` owner_user_id + status in active/paused + deleted_at null, `count:'exact', head:true`, mismo filtro que `usePropertiesGrid`), **sumas** (misma tabla y filtros pero `select('save_count, like_count')` — única query que trae filas, se suman con un `reduce` en cliente) (la tabla `leads` ya **no** se consulta, #180.1). Firma `useAgentStats(agent_id)→{loading, stats:{publications,saves,likes}|null}`; patrón `useEffect`+flag `ignore`; error handling **degrada a ceros sin throw**. Tipo `AgentStats` exportado.
  - ⚠️ **`closed` salió del tipo y su query desapareció (#179.1):** nadie más lo consumía y el CRM tiene su propio RPC `get_lead_stats` (migración `20260808000002`). Se pagaba una query por cada apertura de perfil para un número que ya no se pinta.
  - ⚠️ **`leads` salió del hook en #180.1** (con él, la opción `include_leads` que 179.1 había añadido). Primero fue un tema de privacidad — la RLS solo deja ver los propios, así que en un perfil **ajeno** la query devolvía 0 y el header pintaba "0 Leads" como si el agente no tuviera ninguno ([[privacidad-datos]]) — y luego, decisión de producto: el conteo de leads **se consulta en el CRM y solo el dueño de la cuenta**, no en el perfil.
  - **ponytail:** la suma se hace en cliente sobre las MISMAS pocas filas que ya cuenta la primera query, en vez de un RPC de agregación — cero backend nuevo; los contadores los mantiene el trigger de `20260701000001`. Techo: si un agente llega a cientos de publicaciones conviene un RPC.
  - ⚠️ **El guardian atrapó un bug green-pero-roto:** el test RED codificaba el orden de cadena ficticio `.eq().in().is().select()` y el SUT lo implementó con un cast (`CountChain`) que lo ocultaba — habría dado `TypeError: .eq is not a function` contra Supabase real (el `PostgrestQueryBuilder` solo expone `.select()`; `.eq/.in/.is` viven en el `PostgrestFilterBuilder` que devuelve `.select()`). Fix: test **y** SUT al orden real `.select().eq().in().is()` (patrón de `usePropertiesGrid`), sin cast. 5 tests, guardian PASS.
- **`components/ProfessionalStats.tsx` (#23.2 · rehecho en #179.3)** — 3 columnas inline a la derecha del avatar (ya **no** es un sheet con sombra ni dividers): número en `fonts.display` 19, label en `fonts.sans` 12 **capitalizado** (en MAYÚSCULAS "Publicaciones" no cabe en ~80px), con `adjustsFontSizeToFit` como red en pantallas de 360dp. Loading/`stats===null` → `'—'`.
  - **Dos juegos de columnas según `is_own_profile` (#180):** propio = Publicaciones · Guardados · Me gusta; ajeno = Publicaciones · Me gusta.
  - **Ya no se oculta cuando todo está en 0** (antes `return null`): con la fila desaparecida el avatar quedaba solo en una fila a medias. Instagram también muestra ceros.
- **`src/components/IsotipoMark.tsx` (#23.3, no crítico)** — isotipo de firma reutilizable `{size?,color?}`. **ponytail — cambio de enfoque:** el plan preveía PNG@2x/3x + `<Image tintColor>`, pero se implementó con **primitivas RN puras** (View bucket-shape por bordes para la U + triángulo por bordes para el play, geometría del symbol `#iso` viewBox 24×24). Motivo: la máquina no tiene convertidor SVG→PNG y `react-native-svg` exigiría rebuild del dev build nativo — ambos bloqueaban sin aportar fidelidad que un badge de 13px necesite. CERO assets/deps nativas, teñible vía `color`, escalable vía `size`. **Techo:** migrar a `react-native-svg` cuando ≥2 consumers pidan fidelidad vectorial fina. Reuso futuro documentado en JSDoc: map pins, loaders, empty states, overlay de play del feed. Se usa como badge del avatar en `ProfileHeader` (ver arriba). → [[design-system]]

## Pendientes derivados
- **Vistas como stat:** se descartó en #179 — `properties.view_count` nunca se puebla y las vistas viven en `events_raw` con RLS privada; exigiría un RPC security-definer + revisión de privacidad ([[privacidad-datos]]).
- **#24** — configurar ESLint + script `pnpm lint` (gate del workflow asume lint pero el repo no lo tiene cableado; hoy solo `tsc`). Detectado en #22.5 por guardian.
- Verificación E2E en device del flujo editar (smoke con simulador) — pendiente de sesión con build.
- Deuda: regenerar `database.types.ts` (post-0015) para quitar casts `as never`.

## Relacionados
[[design-system]] · [[onboarding-y-preferencias]] · [[propiedades-y-video]] · [[inmobiliarias-y-agentes]]
