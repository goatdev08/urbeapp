# 📱 Cómo correr Urbea y ver tus cambios

Guía práctica para levantar el servidor de desarrollo, ver la app en tu celular e iterar.
**Regla de oro:** PNPM siempre · todo lo de la app corre **dentro de `mobile/`**.

> Versión "de bolsillo". El detalle vive en el vault: `wiki/codebase/comandos.md`.

---

## 🧠 Lo que tienes que entender primero (2 modos)

La app en tu celular es un **"development build"** (un `.apk` instalado una vez). Ese `.apk`
es un **cascarón nativo**; tu código JavaScript se lo sirve **Metro** (el servidor de dev) por wifi.

| Tipo de cambio | ¿Qué hago? |
|----------------|------------|
| **Solo JavaScript/TypeScript** (pantallas, lógica, estilos) | Basta `pnpm expo start --dev-client`. **Hot reload** instantáneo. NO necesitas rebuild. |
| **Dependencias nativas o `app.config.js`** (instalar un paquete con código nativo, permisos, plugins) | Necesitas un **build nuevo de EAS** (en la nube) e instalar el `.apk` otra vez. |

⚠️ **Ahora mismo estás en el segundo caso** (ver más abajo, "Estado actual").

---

## 🚀 Día a día — ver cambios de JS al instante

```bash
cd mobile
pnpm install                      # solo la 1ª vez o si cambió package.json
pnpm expo start --dev-client      # levanta Metro + muestra un QR
```

1. Abre la **app Urbea** ya instalada en tu celular (no Expo Go).
2. Escanea el **QR** desde dentro de la app (o se conecta sola si ya lo hiciste antes).
3. Edita código → se recarga solo (**hot reload**).

**Teclas útiles en la terminal de Metro:**

| Tecla | Acción |
|-------|--------|
| `r` | Recargar la app manualmente |
| `j` | Abrir el debugger |
| `m` | Menú de desarrollo |
| `Ctrl+C` | Apagar Metro |

```bash
pnpm expo start --dev-client -c   # igual, pero LIMPIA la caché de Metro
                                  # (úsalo si ves errores raros de bundle)
```

> 📌 El servidor lee `mobile/.env.local` (credenciales de Supabase). Si cambias ese archivo, **reinicia Metro**.
> Tu celular y tu compu deben estar en la **misma red wifi**.

### 🔑 Variables en `mobile/.env.local` (gitignored — las pones tú)

Copia los nombres de `mobile/.env.example` y rellena los valores:

| Variable | ¿Para qué? | ¿Obligatoria? |
|----------|-----------|----------------|
| `EXPO_PUBLIC_SUPABASE_URL` | Conexión a Supabase | **Sí** (sin esto no hay login) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Conexión a Supabase | **Sí** |
| `GOOGLE_MAPS_API_KEY` | Que **renderice el mapa** del wizard (paso 2, react-native-maps) | **Sí** para ver el mapa |
| `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` | Autocompletado de **dirección** (paso 2) | Opcional (sin ella el campo es texto libre) |

- Supabase: dashboard → **Settings → API** (URL + anon/public key).
- Google: [console.cloud.google.com](https://console.cloud.google.com/) → habilita **Maps SDK for Android**, **Maps SDK for iOS** y **Places API (New)** → crea una API key. Puede ser **la misma key** para Maps y Places.
- ⚠️ `GOOGLE_MAPS_API_KEY` va a la config nativa (`app.config.js`) → si la cambias, **necesitas rebuild de EAS** (no basta reiniciar Metro).

---

## ☁️ Build nativo nuevo (EAS) — cuando cambian deps nativas

```bash
cd mobile
npx eas-cli login                                                  # ⚠️ npx, NUNCA pnpm-global
npx eas-cli build --profile development --platform android         # ~10–20 min en la nube
```

Al terminar te da un **link**: ábrelo desde el celular y **instala el `.apk`**.
Después de eso, vuelves al flujo normal (`pnpm expo start --dev-client`).

```bash
npx eas-cli build:list                          # historial de builds + links de instalación
npx eas-cli build --profile preview --platform android   # .apk autónomo (sin Metro) para compartir beta
```

---

## ✅ Verificar antes de dar por bueno un cambio

```bash
cd mobile
pnpm tsc --noEmit     # chequeo de tipos (TS strict)
pnpm test             # tests (jest) — hoy 101/101 en verde
```

---

## 🩺 Problemas comunes

| Síntoma | Causa probable / arreglo |
|---------|--------------------------|
| `Cannot find native module 'ExpoBlur'` (o ImagePicker / ImageManipulator) | El `.apk` instalado es viejo y no trae esa dep nativa → **haz un build de EAS nuevo**. |
| El QR no conecta / "Network response timed out" | Celular y compu en **distinta wifi**, o firewall. Misma red; reinicia Metro. |
| Cambios que no aparecen | `pnpm expo start --dev-client -c` (limpia caché) y tecla `r`. |
| Errores raros tras instalar un paquete | `cd mobile && pnpm install`; si toca algo nativo → rebuild EAS. |

---

## 🗺️ Estado actual de lo que verás (26-jun-2026)

- **Backend (Supabase remoto `urbea`):** migraciones `0001`–`0016` aplicadas. Auth, Storage de video, canje de invitación, foto de perfil y alta de inmobiliarias (RPC `admin_create_agency_atomic`) listos en BD.
- **App:** tareas **#1–#8 cerradas** (código + tests). Pantallas vivas: **login**, **registro por invitación**, **home** (placeholder "Urbea"), **onboarding** (#6), **panel admin** (#7) y **wizard de publicación de 3 pasos** (#8).
- **Para entrar:** abre la app → **login** con una cuenta sembrada → caes en el **home** ("Urbea").

### ⚠️ Para ver el wizard de publicación de la #8 hace falta:

1. **Build nativo nuevo (obligatorio):** la #8 añadió `react-native-maps` (módulo **nativo**) que tu `.apk` actual **no trae** → el paso 2 (mapa) crashea sin rebuild. Corre **`npx eas-cli build --profile development --platform android`** e instala el nuevo `.apk`.
2. **Variables Google** en `.env.local` (ver tabla arriba): `GOOGLE_MAPS_API_KEY` (mapa) y, opcional, `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` (autocomplete).
3. **Punto de entrada al wizard:** hoy **nada navega a `/publish`** (igual que pasó con `/onboarding`). Para llegar: o se cablea un botón temporal en el home, o se abre por deep-link `urbea://publish/step1`. → pendiente pequeño.
4. **Backend de publicación (para que el botón "Publicar" funcione de verdad):** falta **aplicar al remoto** la migración `publish_property_rpc` (RPC `publish_property_atomic`) y **desplegar** la Edge Function `publish-property`. (Lo mismo aplica a `admin-create-agency` de la #7, que tampoco está desplegada aún.)

> Mientras tanto, el home, login, registro, onboarding y admin **sí** corren con tu build actual + `pnpm expo start --dev-client`. El wizard de #8 requiere el rebuild por el mapa.

### 🛠️ Despliegue del backend (lo hace el dev / IA con acceso a Supabase)
- **Migraciones y Edge Functions** se aplican al remoto vía el **MCP de Supabase** (Claude ya tiene acceso al proyecto `urbea`) o con el **CLI de Supabase**:
  ```bash
  # CLI local (opcional, si lo quieres correr tú):
  brew install supabase/tap/supabase        # macOS
  supabase link --project-ref mvpvqmyhrrkwbnpctpuq
  supabase db push                           # aplica migraciones pendientes
  supabase functions deploy publish-property # despliega la Edge Function
  ```
- El `project-ref` del remoto es **`mvpvqmyhrrkwbnpctpuq`** (proyecto `urbea`, región us-west-2).
