---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §9, docs/PRD-MVP-demo.md, .taskmaster (tarea #9)]
codigo: [supabase/migrations/20260604000006_engagement_crm.sql, supabase/migrations/20260701000001_engagement_count_triggers.sql, supabase/functions/mint-video-url/, mobile/src/features/feed/, mobile/src/features/saved/, mobile/src/components/LikeButton.tsx, mobile/src/components/SaveButton.tsx]
actualizado: 2026-07-10
---

# Feed vertical de video

> El diferenciador central de Urbea: descubrir propiedades como en TikTok — video a pantalla completa, swipe vertical.

## Cómo funciona
- Feed inmersivo de videos verticales de propiedades activas; reproducción automática al entrar en pantalla.
- **Reglas del PRD §9:**
  - **Radio progresivo:** 2 → 5 → 10 → 20 km (se expande si no hay resultados).
  - 🔒 **Anti-clustering:** mínimo **5 videos de otras propiedades** entre dos videos de la misma propiedad.
  - Métricas: "video visto" (criterio definido) y "video completado" (100% reproducido) alimentan el scoring (diferido en demo).

## En la demo
- **vivo (tarea #9, código en `mobile/src/features/feed/`).** Feed vertical con `expo-video` (FlashList v2 paginada), swipe, autoplay por viewability (70%, pausa en background/al salir del tab). Lo consumen los propios agentes. Interacción **persistida de verdad**: like (doble-tap estilo TikTok = `likeOnly` idempotente, + botón overlay = toggle) en `likes` por video; guardar en `saves` por propiedad — optimista + rollback + conflicto único 23505.
- **Alcance #9 (decisión cliente):** feed **simple** — query `active`+video `ready`, `ORDER BY created_at DESC`, cursor + scroll infinito. El **radio progresivo y el anti-clustering NO se implementaron** (PRD los marca diferibles; pocas semillas en la demo) → trabajo futuro si se necesita. Filtros básicos pendientes ([[busqueda-y-filtros]]).
- ⚠️ **Requiere nuevo dev build** antes de correr en device: #9 añadió módulos nativos (`@shopify/flash-list`, `react-native-reanimated` v4 + `react-native-worklets`, `react-native-gesture-handler`, `expo-haptics`). Ver [[comandos]].

## Like/Save, contadores reales y pantalla Guardados — vivo (#13)
- **Contadores reales (13.2/13.4, desplegado a `urbea-app` 2026-07-01).** La persistencia de like/save (hooks `useLikeProperty`/`useSaveProperty`, #9) es **direct-client**; NO se hicieron Edge Functions toggle-like/toggle-save (habrían duplicado esa lógica sin ganar seguridad — RLS ya es la 2ª capa). En su lugar, migración `20260701000001` con **triggers atómicos** `AFTER INSERT OR DELETE` en `likes`→`like_count` y `saves`→`save_count`, **+ backfill** que reconcilia las propiedades ya publicadas. Así `properties.like_count`/`save_count` (que se muestran en el perfil, `PropertyListItem`) reflejan la **interacción real entre cuentas** desde el arranque de la demo.
  - 🔒 **`SECURITY DEFINER` + `search_path=''` obligatorio:** el trigger hace `UPDATE properties` pero la policy `properties_update` (0008) sólo deja al dueño; quien da like/save es un `authenticated` no-dueño → sin SECURITY DEFINER el INSERT fallaría en prod. ⚠️ **El pgTAP NO detecta esto** (corre como superusuario) — regla de seguridad que se garantiza por revisión, no por el test.
  - `GREATEST(0, count-1)` en el decremento respeta el `CHECK (count >= 0)`. Los triggers se disparan también en borrados por CASCADE (video/usuario). TDD pgTAP `supabase/tests/07_engagement_counts_test.sql` (14 asserts) verde contra remoto en tx revertida. Rollback en `supabase/migrations/rollbacks/`.
- **Botones animados (13.1/13.3):** `LikeButton`/`SaveButton` (globales, Reanimated bounce) reemplazan el Pressable+Ionicons inline de `ActionButtons` (detalle). Presentacionales puros; el estado/toggle lo maneja el consumidor. Ver [[mapa-codebase]].
- **Pantalla "Guardados" (13.6/13.7):** tab `🔖 Guardados` (orden `Inicio·Guardados·Mapa·Perfil`, per mockup p12). `useSavedProperties` (hook **crítico**, TDD): query `from('saves')` con embed `properties(+property_videos)`, RLS filtra al usuario, orden `created_at` DESC, transform → `GridProperty` (reusa `PropertyGridCard` en grilla 2-col). ⚠️ **`saves` es DELETE duro (sin `deleted_at`)** — el spec original decía `deleted_at IS NULL`, era un bug. **Quitar** = long-press en la card → `Alert` confirmar → unsave reusando `useSaveProperty` (quitado optimista con `hidden_ids` + rollback si el DELETE falla). Una propiedad guardada que pase a `paused`/`closed` desaparece de la lista (la RLS `properties_select` la filtra) — comportamiento aceptado para la demo.

## Datos / técnico
- `likes` (`user_id`, `property_video_id`, único). Videos de [[propiedades-y-video]] (`status='ready'`).
- 🔑 **URLs de reproducción:** el bucket `property-videos` es privado y la RLS SELECT pública está rota por el path 2-seg (#8). El feed NO lee el video directo: tras su query de propiedades, llama la EF **`mint-video-url`** (#21, vivo) con el batch de `property_ids` → recibe `{property_id,video_id,signed_url}` (signed URLs `service_role`, exp **1h**). Solo propiedades `active` con video `ready`. ⚠️ URLs expiran a la hora → si la sesión es larga, re-mintar. Ver [[propiedades-y-video]].
- ⚠️ **Lo más delicado del front:** reproducción fluida al swipe → precargar el siguiente, pausar/liberar los fuera de pantalla; lista paginada (FlashList) + `expo-video`. Requiere **dev build** ([[0005-demo-cerrada-3-semanas]]).
- 🔒 **Memoria Android / OOM (tarea #57, fix vivo por OTA 2026-07-10):** el heap Java de Android está capado a **192 MB** (sin `largeHeap`); cada `useVideoPlayer` crea un ExoPlayer cuyo buffer por default es ilimitado en bytes (`maxBufferBytes: 0` = decide el player) y bufferea **video crudo sin transcodificar** (demo, Supabase Storage) vía okhttp → con ~4 players vivos los segmentos okio llenaban el heap y crasheaba en scroll normal (el stack okhttp del crash es la *víctima*, no la causa). Fix en los **3** `useVideoPlayer` de la app (`VideoFeedItem`, `PropertyVideoPlayer`, preview `step3`): `bufferOptions = { preferredForwardBufferDuration: 10, maxBufferBytes: 25MB }` + `drawDistance` del feed a 1 pantalla (~3 players). ⚠️ Gotcha: el default Android de `preferredForwardBufferDuration` es **20 s** (el tipo instalado lo documenta), no ~50 s. `largeHeap` se **descartó** (ocultaría la causa + exige rebuild nativo). Verificado: 25 swipes → heap plano 107–117 MB. Si reaparece en devices con poca RAM → reabrir 57.5. Solución de fondo: Cloudflare Stream/HLS en beta ([[estrategia-releases]]). Trade-off aceptado: posible spinner breve en redes lentas y póster un instante más en swipes rápidos.

- 🔒 **Player estable por instancia (tarea #61, fix 2026-07-10):** `useVideoPlayer` recrea el player (release + new, `useReleasingSharedObject` de expo-modules-core) cada vez que cambia la fuente — y con FlashList **reciclando** ítems + `mint-video-url` re-firmando URLs en cada refetch (filtros/pull-to-refresh), el `VideoView` nativo alcanzaba a recibir el player viejo ya liberado → error intermitente Android *"Cannot set prop 'player'… shared object already released"* (aparecía al togglear "Sin límite" de #58). Fix en `VideoFeedItem`: el player nace **una sola vez** con la fuente inicial de la instancia y los cambios de fuente entran por **`player.replaceAsync()`** (+ reset de `has_error`/`is_paused` heredados del ítem reciclado + resume si el ítem está activo) — el player ya solo se libera al desmontar. expo-video 56.1.4 es la última de SDK 56 (sin parche de lib); fix 100% JS → OTA-safe. ⚠️ Regla general: en listas recicladas NUNCA dejar que `useVideoPlayer` recree por cambio de fuente; reemplazar el medio dentro del player vivo.

## Detalle exhaustivo
- `docs/PRD.md` §9 (feed, radio, anti-clustering) · migración `0006` (`likes`) · [[db-schema-map]]

## Relacionados
[[propiedades-y-video]] · [[busqueda-y-filtros]] · [[mapa-y-ubicacion]] · [[crm-leads]]
