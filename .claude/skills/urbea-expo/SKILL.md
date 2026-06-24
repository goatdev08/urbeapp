---
name: urbea-expo
description: Best practices del cliente móvil de Urbea (React Native + Expo). Usar al construir pantallas, navegación, el feed de video, formularios o integrar Supabase en mobile/. Cubre Expo development build, Expo Router, expo-video, pnpm (con .npmrc hoisted), TypeScript strict, estructura por feature y naming snake_case. Disparar ante "expo", "react native", "pantalla", "navegación", "feed", "componente móvil", "expo-video".
---

# urbea-expo — cliente móvil

Convenciones para `mobile/`. Fuentes: `docs/lineamientos-desarrollo.md`, `wiki/conceptos/feed-vertical-video.md`.

## Setup base (no negociable)
- **PNPM siempre.** Crea `.npmrc` con `node-linker=hoisted` (Metro no resuelve bien el `node_modules` simbólico de pnpm). Nunca npm/yarn.
- **Development build** (`expo-dev-client`), NO Expo Go — usamos Google Maps nativo (`react-native-maps`) y mejor video. Build vía EAS.
- **Expo Router** (file-based en `mobile/app/`). **TypeScript strict** (`strict: true`).
- Cliente Supabase tipado desde `supabase/types/database.types.ts` → `mobile/src/lib/supabase/`.

## Estructura por feature
```
mobile/
  app/                     # rutas (Expo Router)
  src/features/<dominio>/  # feed, auth, search, map, publish, leads, profile, admin, onboarding
  src/components/          # componentes compartidos
  src/lib/supabase/        # cliente tipado
  src/theme/               # tokens de diseño
```
Validaciones de forma/UX en el cliente; **lógica de negocio canónica en Edge Functions** (ver `urbea-supabase`).

## Naming (invariante del proyecto)
- Funciones, handlers, helpers, stores: **snake_case** claro tipo inglés natural — `load_feed_page`, `handle_contact_press`, `format_price`. NO camelCase.
- **Componentes React: PascalCase** (`FeedCard`, `PropertyDetail`) — obligatorio por JSX.
- Hooks: `use_*` (ej. `use_feed`), salvo que `eslint-plugin-react-hooks` exija `useX`; entonces respeta el linter.
- Archivos: kebab-case (`feed-card.tsx`). Sé consistente dentro de cada feature.

## Feed vertical (el diferenciador)
- `expo-video` para reproducción; lista paginada (FlashList) vertical con snap por ítem.
- Reproduce el video en foco; **pausa/libera** los fuera de pantalla (memoria); precarga el siguiente.
- Datos: `likes` (`user_id`, `property_video_id`). Ver `wiki/conceptos/feed-vertical-video.md`.

## Verificación
`pnpm tsc --noEmit` + `pnpm lint` + smoke (la pantalla monta). Cero errores de tipos.
