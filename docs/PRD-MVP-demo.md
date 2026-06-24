# PRD — Urbea MVP-Demo (beta cerrada · 3 semanas)

> **Versión:** 1.0 · **Fecha:** 2026-06-17 · **Estado:** en revisión
> **Objetivo de fecha:** demo lista ~2026-07-08 (3 semanas)
> Este documento define el alcance del **primer hito de desarrollo**: una demo/beta cerrada.
> Es un subconjunto reducido del [PRD oficial](./PRD.md) (35 secciones), que queda como roadmap.
> Decisiones tomadas en sesión de preguntas con el cliente (7 rondas). Ver [[0005-demo-cerrada-3-semanas]] en el vault.

---

## 1. Resumen ejecutivo

Urbea es una plataforma inmobiliaria móvil con feed vertical de video tipo TikTok. Esta **demo** busca **validar el producto con inmobiliarias reales**: que entren, publiquen propiedades con video y naveguen el feed, end-to-end y con datos reales en la nube.

- **Audiencia:** inmobiliarias y sus agentes (beta cerrada, por invitación).
- **NO incluye pagos** — la app es gratuita en la demo; la monetización queda latente.
- **Meta de validación:** que una inmobiliaria real pueda, sin asistencia, dar de alta a sus agentes, publicar propiedades con video, y ver el feed + sus leads.

## 2. Contexto y punto de partida

- **Base de datos:** Supabase ya migrada y endurecida (20 tablas, RLS, tests pgTAP; migraciones `0001`–`0010` aplicadas al proyecto live `urbea-app`, ref `mvpvqmyhrrkwbnpctpuq`). Ver `supabase/README.md`.
- **Documentación:** `docs/` maduro (PRD completo, propuesta-cliente, lineamientos de desarrollo).
- **Código de app:** no existe aún — la demo arranca el scaffolding de `mobile/`.
- **Lineamientos técnicos:** se respeta `docs/lineamientos-desarrollo.md` (TS strict, lógica de negocio en Edge Functions, RLS como 2ª capa, triggers solo atómicos).

## 3. Stack y plataforma

| Componente | Decisión | Notas |
|------------|----------|-------|
| App móvil | React Native + Expo, **development build** (`expo-dev-client`) | Permite Google Maps nativo y mejor reproducción de video; mantiene la agilidad (hot reload, QR). Build vía EAS. |
| Navegación | Expo Router | Estructura por feature. |
| Lenguaje | TypeScript **strict** | Según lineamientos. |
| Backend | **Supabase remoto existente** (`urbea-app`) | Migraciones 0001–0010 ya aplicadas. Desarrollo con Supabase local/branch; deploy al remoto para la validación. |
| Video | Subida real → **Supabase Storage** → reproducción directa (`expo-video`) | **Sin transcoding ni Cloudflare Stream** en la demo. Requiere bucket + políticas de Storage. |
| Mapas | `react-native-maps` + Google Maps (nativo, vía dev build) | Pines + clustering. |
| Auth | Supabase Auth, **email + contraseña** | Sin Google/Apple. |
| Pagos | **Ninguno** | Monetización latente; migración `0011` de billing NO se diseña ni aplica en este hito. |

## 4. Alcance

### 4.1 Incluido en la demo

**Identidad y acceso**
- Login con email + contraseña (Supabase Auth).
- Registro de agente por **canje de código de invitación** (generado por el owner de su inmobiliaria).
- Onboarding **mínimo**: nombre + foto de perfil (la inmobiliaria queda fijada por el código).
- **Sin** verificación de identidad (INE+selfie).

**Modelo inmobiliaria + agentes**
- Entidad **inmobiliaria** que agrupa agentes (owner + agentes).
- **Panel admin mínimo dentro de la app** (rol `admin`): dar de alta inmobiliarias y sus owners.
- El **owner** genera códigos de invitación para sus agentes (tabla `agency_invitation_tokens`).
- Vista de equipo del owner (sus agentes).

**Publicación (lado oferta)**
- Wizard de **3 pasos**:
  1. Operación (renta/venta) + tipo de propiedad.
  2. Detalles: precio, recámaras, baños, m², dirección exacta + ubicación en mapa.
  3. Video (subida real) + publicar.
- **Auto-aprobación**: la propiedad queda `active` al publicar (sin cola de moderación).
- Gestión: ver mis publicaciones, editar, pausar, cerrar (rentada/vendida).

**Descubrimiento (lado consumo)**
- **Feed vertical tipo TikTok**: video a pantalla completa, swipe vertical, reproducción automática.
- **Filtros básicos**: operación, tipo de propiedad, zona/ciudad, rango de precio.
- **Mapa global** con pines + clustering (dirección exacta visible).
- **Detalle completo** de propiedad: video, datos (precio, tipo, recámaras, baños, m²), ubicación, datos del agente, botón de contacto.

**Interacción y CRM**
- **Like** (a videos) + **guardar** (propiedades) + pantalla de guardados.
- **Contacto**: botón que abre **WhatsApp** con mensaje prellenado **y crea un lead** automáticamente (con su propiedad de origen).
- **CRM** para el agente: **lista de leads + estados** (embudo de 7 estados de `lead_status`).
- **Perfil** del agente: foto, nombre, inmobiliaria y lista de sus publicaciones.

**Datos**
- **Datos semilla**: 3–5 inmobiliarias + 10–20 propiedades con video, para que feed/mapa/CRM no arranquen vacíos.

### 4.2 Fuera de alcance (explícito)

Pagos/créditos · verificación INE+selfie · notificaciones push · comentarios · follows · reportes y moderación de contenido · scoring automático de leads · login con Google/Apple · panel admin web separado · re-revisión por cambios · auditoría extensiva · versionado de publicaciones.

## 5. Roles

| Rol | Quién | Puede |
|-----|-------|-------|
| `admin` | Equipo Urbea | Dar de alta inmobiliarias + owners; ver todo. (Panel admin en la app.) |
| Owner (agency_member rol `owner`) | Responsable de la inmobiliaria | Generar códigos de invitación; ver su equipo de agentes; publicar y gestionar como agente. |
| Agente (agency_member rol `agent`) | Asesor inmobiliario | Publicar y gestionar propiedades; ver feed/mapa; gestionar sus leads; perfil. |

> Nota: en la demo no hay rol "buscador/usuario final" público — el lado de consumo lo usan los propios agentes (publican **y** ven el feed).

## 6. Pantallas (~13)

1. **Login** (email + contraseña).
2. **Canje de código** / alta de agente.
3. **Onboarding** (perfil básico).
4. **Feed vertical** (home).
5. **Detalle de propiedad**.
6. **Mapa global** (pines + clustering).
7. **Búsqueda / filtros**.
8. **Wizard de publicación** (3 pasos).
9. **Mis publicaciones** (gestión).
10. **Perfil del agente** (con publicaciones).
11. **CRM / leads** (lista + estados).
12. **Guardados / favoritos**.
13. **Panel admin** (alta de inmobiliarias + owners; invitaciones).

## 7. Modelo de datos

### 7.1 Tablas existentes que se usan (sin cambios)
`users`, `agencies`, `agency_members`, `agency_invitation_tokens`, `user_preferences` (onboarding), `properties`, `property_videos`, `likes`, `saves`, `leads`, `lead_origin_properties`, `admin_actions`, `terms_versions` / `user_consents` (consentimiento mínimo en registro).

### 7.2 Ajustes necesarios para la demo (a confirmar al revisar el esquema)
- **Supabase Storage**: crear bucket de videos + políticas RLS de Storage (subida por agente dueño, lectura pública de propiedades activas).
- **`property_videos`**: revisar si requiere un campo para la ruta de Storage (hoy referencia Cloudflare Stream vía `cloudflare_uid`). Posible **migración menor** (`0011_demo_video_storage` u otra numeración) — *solo si el esquema actual no lo soporta*.
- **NO** se diseña ni aplica la migración de billing (`0011` original del plan de monetización) en este hito.

### 7.3 Lógica en Edge Functions (según lineamientos)
- **Canje de código de invitación** (consumo atómico del token → alta de `agency_member`).
- **Publicación de propiedad** (validación canónica + estado `active`).
- **Contacto → creación de lead** (lead + `lead_origin_properties`, idempotente por par agente-usuario).
- (Resto de lecturas: queries directas con RLS.)

## 8. Diseño

- **Branding desde cero**: logo, paleta y tipografía (Claude propone, cliente aprueba). **No se arranca hasta indicación expresa del cliente.**
- **Flujo**: design tokens + componentes base en Figma; pantallas "wow" (feed, detalle, publicación) diseñadas a fondo; el resto se arma en código con esos componentes. Se usa el **MCP de Figma** para acelerar diseño→código.
- **Estética**: **híbrida** — feed de video oscuro e inmersivo (tipo TikTok/Reels); pantallas de gestión (publicar, CRM, perfil, admin) claras.
- **Dirección**: Claude propone, cliente aprueba.

## 9. Plan de 3 semanas

> El cliente eligió **"todo el alcance, parejo"**. Se ataca en paralelo respetando dependencias.

**Semana 1 — Fundación + identidad**
Scaffolding `mobile/` (dev build, Expo Router, TS strict, cliente Supabase tipado) · auth (email+contraseña) · canje de código · onboarding · modelo inmobiliaria/agentes + panel admin · bucket de Storage para video.

**Semana 2 — Publicación + feed + datos**
Wizard de publicación (3 pasos) + subida de video a Storage · feed vertical (`expo-video`) + filtros básicos · detalle completo · datos semilla.

**Semana 3 — Mapa + CRM + interacción + pulido**
Mapa global con clustering · like/guardar/guardados · contacto WhatsApp + creación de lead · CRM lista + estados · perfil con publicaciones · pulido visual + pruebas con datos reales + deploy al remoto.

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| "Todo parejo" en 3 semanas es ambicioso | Seguimiento semanal en Taskmaster; candidatos a simplificar si aprieta (ver abajo). |
| Feed de video fluido (reproducción al swipe, precarga) | Priorizar temprano (semana 2); usar `expo-video` + lista paginada probada. |
| Mapa con clustering | Fallback: mini-mapa solo en el detalle. |
| Cadena inmobiliaria→invitación→agente | Fallback: sembrar agencias/owners por SQL; reducir panel admin. |
| Video sin transcoding (tamaños/formatos variados) | Límite de tamaño/duración en subida; validar formato vertical. |

**Orden de recorte si se agota el tiempo:** mapa global → mini-mapa · CRM con estados → lista simple · panel admin → seed por SQL.

## 11. Criterios de aceptación (demo lista)

- [ ] Una inmobiliaria de prueba puede ser dada de alta (admin) y su owner puede invitar a un agente con un código.
- [ ] Un agente canjea el código, entra (email+contraseña) y completa el onboarding mínimo.
- [ ] El agente publica una propiedad con video real (3 pasos) y queda visible en el feed.
- [ ] El feed vertical reproduce videos con swipe; los filtros básicos funcionan.
- [ ] El mapa muestra las propiedades con pines/clustering y ubicación exacta.
- [ ] El detalle muestra video, datos, ubicación, agente y contacto.
- [ ] El contacto abre WhatsApp y registra un lead; el agente lo ve en su CRM y puede cambiarle el estado.
- [ ] Like/guardar funcionan; el perfil del agente lista sus publicaciones.
- [ ] La demo arranca con datos semilla (no vacía) y corre contra el Supabase remoto.

---

## Anexo — Decisiones de la sesión de preguntas (trazabilidad)

| # | Tema | Decisión |
|---|------|----------|
| R1 | Objetivo | Validación con inmobiliarias reales |
| R1 | Lados | Publicar + ver el feed |
| R1 | Plataforma | Expo (→ dev build, ver R7) |
| R1 | Video | Híbrido: subida real, sin transcoding |
| R2 | Modelo cuentas | Inmobiliaria con agentes |
| R2 | Acceso | Código de invitación |
| R2 | Login | Email + contraseña |
| R2 | Onboarding | Mínimo (perfil básico) |
| R3 | Alta inmobiliaria | Panel admin mínimo en la app |
| R3 | Wizard | 3 pasos |
| R3 | Storage video | Supabase Storage |
| R3 | Moderación | Auto-aprobar |
| R4 | Feed | Vertical tipo TikTok |
| R4 | Filtros | Básicos |
| R4 | Mapa | Global con pines/clustering |
| R4 | Detalle | Completo |
| R5 | Interacciones | Like + guardar |
| R5 | Contacto | WhatsApp + registra lead |
| R5 | CRM | Lista + estados |
| R5 | Perfil | Con publicaciones |
| R6 | Branding | Desde cero (Claude propone) |
| R6 | Flujo diseño | Componentes base + pantallas clave en Figma |
| R6 | Estética | Híbrida (feed oscuro, resto claro) |
| R6 | Dirección | Claude propone, cliente aprueba |
| R7 | Runtime | Development build (`expo-dev-client`) |
| R7 | Backend | Supabase remoto existente |
| R7 | Datos semilla | Sí (3–5 inmobiliarias, 10–20 propiedades) |
| R7 | Prioridad | Todo el alcance, parejo |
