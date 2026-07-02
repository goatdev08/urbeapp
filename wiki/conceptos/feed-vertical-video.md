---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §9, docs/PRD-MVP-demo.md, .taskmaster (tarea #9)]
codigo: [supabase/migrations/20260604000006_engagement_crm.sql, supabase/migrations/20260701000001_engagement_count_triggers.sql, supabase/functions/mint-video-url/, mobile/src/features/feed/, mobile/src/features/saved/, mobile/src/components/LikeButton.tsx, mobile/src/components/SaveButton.tsx]
actualizado: 2026-07-02
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

## Detalle exhaustivo
- `docs/PRD.md` §9 (feed, radio, anti-clustering) · migración `0006` (`likes`) · [[db-schema-map]]

## Relacionados
[[propiedades-y-video]] · [[busqueda-y-filtros]] · [[mapa-y-ubicacion]] · [[crm-leads]]
