---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §7, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/0004_user_profile_legal.sql, supabase/migrations/20260604000015_profile_photos_storage.sql, mobile/app/onboarding.tsx, mobile/src/features/onboarding/, mobile/src/lib/profileService.ts, mobile/src/lib/imageUtils.ts, mobile/src/components/PrimaryButton.tsx]
actualizado: 2026-06-24
---

# Onboarding y preferencias

> Lo mínimo para que el perfil y las publicaciones tengan sentido.

## Modelo de datos
- **`user_preferences`** (migración 0004) — 1:1 con `users`. Onboarding del buscador: `location` (PostGIS) + `radius` + filtros. Pensado para personalizar el feed.
- **`user_preferences.full_name` + `profile_photo_url`** (migración **0015**, #6) — columnas `TEXT` nullable para el onboarding del agente. `full_name` no-nulo funciona como proxy de "onboarding hecho" (guard de re-show).
- **Bucket Storage `profile-photos`** (0015) — **público de lectura**, escritura solo del dueño. RLS en `storage.objects`: SELECT público; INSERT/UPDATE/DELETE exigen `(storage.foldername(name))[1] = auth.uid()::text`. Path: `{user_id}/avatar.jpg`. Mismo patrón que `property-videos` (0011) pero público y sin gate de rol. → [[rls-seguridad]]

## Flujo (demo · #6 vivo)
Onboarding **mínimo** del agente: **nombre + foto**. La inmobiliaria queda **fijada por el token** que canjea ([[inmobiliarias-y-agentes]]). Pantalla `mobile/app/onboarding.tsx` → `OnboardingScreen`:
1. Input de **nombre** (validación `is_valid_full_name`: trim ≥ 2) + `AvatarPicker` (preview).
2. Foto vía `useImagePicker` (cámara/galería, permisos ES con manejo de denegación) → `processProfileImage` (`imageUtils.ts`: resize 512px + compresión iterativa JPEG 0.8→0.6→0.4 hasta ≤1MB).
3. `saveProfile` (`profileService.ts`): sube a `profile-photos/{userId}/avatar.jpg` (`upsert:true`, `image/jpeg`, body = `fetch(uri).arrayBuffer()`) → `getPublicUrl` → **upsert** en `user_preferences` (`onConflict:'user_id'`) con `full_name` + `profile_photo_url`.
4. **"Saltar foto"** (PrimaryButton `ghost`): guarda nombre con `profile_photo_url` null. **Progreso**: `uploading` → PrimaryButton `loading`. **Navegación**: `router.replace('/(protected)')`. **Guard** en mount: si `full_name` ya existe → redirige a home (fail-open).

Las preferencias de feed del buscador (ubicación + filtros) → **diferido** ([[busqueda-y-filtros]]).

## PrimaryButton (liquid-glass salvia)
`mobile/src/components/PrimaryButton.tsx` — componente reutilizable de CTA. Adapta el liquid-glass del kit (no hay `backdrop-filter` en RN) con **3 capas**: `BlurView` (expo-blur) + overlay salvia `#5A8A5E` cuya **opacidad varía por superficie** (`surface:'light'`=0.82 / `'dark'`=0.48, decisión del cliente) + borde `rgba(255,255,255,.28)`. Variantes `primary`/`ghost`, props `loading`/`disabled`/`icon`. Pensado para CTAs de toda la app (agregar video, login, switch mapa/feed); por ahora solo lo consume onboarding.

## Reglas / gotchas
- En la demo no se captura ubicación de buscador en onboarding; el radio progresivo del PRD queda para después.
- Consentimientos legales se aceptan en el registro → [[legal-consentimientos]].
- **Deuda de tipos:** `profileService`/guard usan cast (`as never` / `as {...}`) porque `database.types.ts` es pre-0015. Regenerar tipos para limpiar el cast.
- **Gotcha tests (mobile):** `profileService` usa `require()` perezoso del cliente supabase dentro de la función para sortear el hoisting de `jest.mock` (las vars `mock_*` aún no existen si el import es estático).
- Tests: `imageUtils.test.ts` (compresión), `profileService.test.ts` (10, upload+upsert), `onboarding/__tests__/validation.test.ts` (8). pgTAP: `supabase/tests/04_profile_photos_test.sql` (17, bucket+RLS+columnas).

## Detalle exhaustivo
- `docs/PRD.md` §7 (onboarding completo: ubicación obligatoria + personalización) · migración `0004` · [[db-schema-map]]

## Relacionados
[[roles-y-permisos]] · [[inmobiliarias-y-agentes]] · [[legal-consentimientos]] · [[feed-vertical-video]]
