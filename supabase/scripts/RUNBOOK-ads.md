# Runbook — pruebas de la épica de publicidad (#168–#172)

Probar **primero en local, después en el remoto**. Este documento cubre el local.
Todo lo que se siembra aquí es reversible con `teardown-ads-demo.sql`.

> ⚠️ El stack local lo comparte el worktree `urbea-perfil2`. Nada de `supabase db reset`.

---

## 0. Levantar el entorno

```bash
# 1. Stack (si no está arriba)
supabase start

# 2. Catálogo de colonias — SOLO la primera vez (Jalisco; el ZIP ya está en caché)
cd supabase/scripts
SUPABASE_DB_URL='postgresql://postgres:postgres@127.0.0.1:5432/postgres' ./import-neighborhoods.sh state 14
SUPABASE_DB_URL='postgresql://postgres:postgres@127.0.0.1:5432/postgres' ./import-neighborhoods.sh bboxes

# 3. Datos de prueba (los uids son los 2 videos ya subidos a Stream)
docker exec -i supabase_db_urbea-app psql -U postgres -d postgres \
  -v uid1=f17eb117c4dd7a827101f57035c92cbf \
  -v uid2=a9cc6551e1dd11db10c86c3e9c78c668 \
  -f - < seed-ads-demo.sql

# 4. Edge Functions (déjalo corriendo en su propia terminal)
cd /Users/fru/Dev/urbea
supabase functions serve --env-file supabase/functions/.env --import-map supabase/functions/deno.json

# 5. App contra el stack local (mobile/.env.local YA quedó apuntando a 10.0.2.2)
cd mobile && pnpm emu
```

**Cuentas** (password `urbea2026` en todas):

| Cuenta | Rol | Para qué |
|---|---|---|
| `anunciante@urbea.demo` | owner de "Hipotecaria Demo" | el panel del anunciante |
| `admin.ads@urbea.demo` | admin | aprobar/rechazar anuncios |
| `buscador1@urbea.demo` … `buscador4@` | buscadores | ver el feed y generar impresiones |
| `owner.gdl@urbea.demo` | owner de una agencia SIN `can_advertise` | prueba negativa |

**Qué se sembró:** 6 anuncios (3 activos, 1 pausado, 1 en revisión, 1 rechazado),
3 tipos de inventario (colonia · municipio · nacional) y 34 impresiones repartidas
para que el k-anonimato quede a la vista.

---

## 0.b Emuladores contra la rama `preview-ads` (lo más parecido a producción)

`mobile/.env.local` YA apunta a la rama. **Las variables NO se ponen en el
emulador**: Metro lee `mobile/.env.local` y hornea los `EXPO_PUBLIC_*` dentro del
bundle. Por eso el único requisito es **reiniciar Metro con `-c`** después de
tocar ese archivo — el emulador no guarda ninguna config de backend.

Ambos builds instalados son **dev-client** (sin JS embebido), así que toman lo
que Metro sirva. `mobile/package.json` no cambió desde que se compilaron
(2026-08-08 iOS · 2026-08-15 Android) y la épica es 100% JS ⇒ **no hace falta
recompilar**.

```bash
# Metro (deja la terminal abierta)
cd mobile && pnpm expo start --dev-client -c

# ── Android ──────────────────────────────────────────────────────────────
export ANDROID_SDK_ROOT=/opt/homebrew/share/android-commandlinetools
export PATH="$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$PATH"
emulator -avd urbea -gpu auto &                    # si no está corriendo
adb reverse tcp:8081 tcp:8081
adb shell pm clear com.urbea.app                   # ← borra la sesión de OTRO proyecto Supabase
adb shell pm grant com.urbea.app android.permission.ACCESS_FINE_LOCATION
adb shell pm grant com.urbea.app android.permission.ACCESS_COARSE_LOCATION
adb emu geo fix -103.38059 20.70266                # Providencia (¡lng primero!)
adb shell am start -a android.intent.action.VIEW \
  -d "urbea://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"

# ── iOS ──────────────────────────────────────────────────────────────────
D=$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1)
xcrun simctl privacy  "$D" grant location com.urbea.app
xcrun simctl location "$D" set 20.70266,-103.38059
xcrun simctl openurl  "$D" "urbea://expo-development-client/?url=http://127.0.0.1:8081"
```

🔴 **`pm clear` / `pm grant` matan el proceso de la app** — relanza con el deep
link *después* de correrlos, no antes.

🔴 **`adb shell input keyevent 4` (BACK) saca de la app** cuando el teclado no
está abierto. `adb shell input text` no abre el teclado suave: para enviar el
formulario usa `input keyevent 66` (ENTER/IME action), nunca BACK.

### Gate de consentimiento — pasa ANTES de cualquier prueba
La rama trae `terms_versions` sembrada, así que **cada cuenta, en el primer
login, cae en "Actualizamos nuestros documentos"**: hay que marcar las dos
casillas y "Aceptar y continuar". No es un bug — es el gate real. Si lo
confundes con una pantalla rota, vas a reportar un falso positivo.

### Ensayo del flip del aviso de privacidad (v2.0)
La rama tiene **`privacy` v1.0 `is_current=true` y v2.0 `is_current=false`** —
v2.0 (7,023 caracteres) es el aviso real de la épica, el que menciona la
publicidad. Encenderlo en producción obliga a **todos** los usuarios a re-aceptar,
así que es exactamente el tipo de cambio que conviene ensayar aquí primero:

```sql
-- en la rama, NO en producción
update public.terms_versions set is_current = (version = '2.0')
where doc_type::text = 'privacy';
```

### SQL contra la rama (no hay `psql` en este host)

Varios pasos de este runbook (§3 moderación, §4 aviso de expiración, §5 pruebas
negativas) son SQL y están escritos contra el Postgres **local** vía Docker.
Contra la rama, la vía sin instalar nada es el **SQL editor del dashboard**:

```
https://supabase.com/dashboard/project/ydhnhyagszopwhyoeela/sql/new
```

**Aprobar un anuncio** (§3) — no existe pantalla de admin, así que este es HOY el
único camino. El editor corre como `postgres`, sin `auth.uid()`, así que hay que
declarar el actor por GUC o el trigger aborta:

```sql
-- Aprobar "Notaría pública 42" (nace en pending_review)
select set_config('urbea.admin_actor_id',
                  '10000000-0000-0000-0000-0000000000a0', true);   -- admin.ads@urbea.demo
update public.ads set status = 'active'
where id = '40000000-0000-0000-0000-0000000000a5' and status = 'pending_review';
```

🔴 **El `set_config` y el `update` van en la MISMA ejecución.** El tercer
argumento `true` lo hace local a la transacción: en dos "Run" separados el GUC ya
no existe y el trigger tira `STATUS_CHANGE_REQUIRES_ADMIN`. Ese error, por cierto,
es una prueba negativa que vale la pena ver: corre el `update` solo y confirma que
**nadie sin actor admin puede cambiar el estado de un anuncio**.

**Aviso de expiración** (§4): `select public.notify_ads_expiring_soon();` —
1ª corrida devuelve `1`, la 2ª devuelve `0` (idempotente).

### Diferencias deliberadas con producción
| Ajuste | Rama | Producción | Por qué |
|---|---|---|---|
| `ads_enabled` | `true` | `false` | sin esto no hay nada que probar |
| `ad_frequency_n` | `3` | `8` | ver un anuncio cada 3 propiedades, no cada 8 |
| Webhook de Cloudflare | apunta a producción | — | un creativo nuevo se queda en `uploading` hasta correr `fake-stream-webhook.sh` (§8) |

Para probar la frecuencia real de producción: `update public.app_config set
value='8'::jsonb where key='ad_frequency_n';`
---

## 1. Panel del anunciante (`/ads`) — tarea #171

Entra con **`anunciante@urbea.demo`** → Perfil → **Mis anuncios**.

### Debe funcionar
- **La entrada existe.** Si no aparece "Mis anuncios", el problema es `useCanAdvertise`.
- **Métricas por zona, exactamente estos números:**

  | Zona | Impresiones | Vistas | CTA |
  |---|---|---|---|
  | Providencia | 12 | 8 | 2 |
  | Guadalajara | 5 | 3 | 1 |
  | Otras zonas | 17 | 10 | 2 |
  | **Total** | **34** | **21** | **5** |

- 🔒 **Chapalita NO debe aparecer como fila.** Tiene 9 impresiones pero solo
  **3 usuarios distintos**, por debajo del umbral de 5. Si la ves, el k-anonimato
  está roto y es un incidente de privacidad, no un bug cosmético.
- 🔒 **"Guadalajara" sí aparece con 5 usuarios** — está justo en el borde del umbral.
  Es la fila que detecta si alguien mueve el umbral sin querer.
- **Suma conservada:** 12 + 5 + 17 = 34. Si el total no cuadra con las filas,
  se están perdiendo impresiones facturables.
- **Los 6 anuncios** listados con su etiqueta de estado (Activo / Pausado /
  En revisión / Rechazado), el rechazado mostrando su motivo.
- **Aviso de expiración** en *"Seguro de casa habitación"* (vence en 4 días).

### Cómo verificarlo sin la app
```bash
docker exec -i supabase_db_urbea-app psql -U postgres -d postgres <<'SQL'
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','10000000-0000-0000-0000-0000000000a1','role','authenticated')::text, true);
select coalesce(n.name, m.name, '⟨OTRAS ZONAS⟩') as zona, r.impressions, r.views, r.cta_taps
from public.ad_metrics_for_agency('20000000-0000-0000-0000-0000000000a1') r
left join public.mx_municipalities m on m.id = r.municipality_id
left join public.mx_neighborhoods  n on n.id = r.neighborhood_id
order by r.impressions desc;
rollback;
SQL
```
> 🔴 La impersonación no es opcional: la RPC es fail-closed y sin JWT devuelve
> **cero filas, nunca un error**. Corrida como `postgres` a secas parece que el
> seed falló, cuando en realidad la defensa anti-IDOR está funcionando.

---

## 2. Feed con anuncios — tarea #170

Entra con **`buscador1@urbea.demo`** y baja por el feed.

### Debe funcionar
- Un anuncio **cada 3 propiedades** (`ad_frequency_n=3`, bajado a propósito para
  no scrollear de más; el default de producción es 8).
- El anuncio **reproduce video** y muestra el nombre "Hipotecaria Demo".
- Los 3 CTA: **WhatsApp**, **enlace externo** y **teléfono**.
- **Segmentación por zona** — el feed usa el GPS del emulador:

  | Ubicación | Anuncios que debe servir |
  |---|---|
  | Providencia (20.70266, −103.38059) | los 3 (colonia + municipio + nacional) |
  | Chapalita (20.66384, −103.39789) | los 3 |
  | Monterrey (25.6866, −100.3161) | **solo 1** (el nacional) |

  Para mover el GPS del emulador: `adb emu geo fix <lng> <lat>` (¡lng primero!).

- **Las impresiones se registran.** Tras ver anuncios, vuelve al panel como
  anunciante: los números deben haber **subido**. Ése es el circuito completo
  cerrándose (feed → EF → DB → panel).

> ⏹️ **Cuota real:** el video se sirve desde Cloudflare Stream de verdad.
> Verifica que reproduce y **para**. No dejes el feed en loop.

---

## 3. Wizard de alta de anuncio — tarea #169

Como **`anunciante@urbea.demo`**: Mis anuncios → crear (5 pasos: video → título →
CTA → zonas → resumen).

**Antes de empezar**, en otra terminal:
```bash
./supabase/scripts/fake-stream-webhook.sh 180
```
Sin eso el paso 1 se cuelga y se rinde a los ~30 s: Cloudflare no puede alcanzar
tu `localhost`, así que el webhook que marca el video como listo nunca llega.
El script pregunta a Stream y le entrega al EF local **el mismo payload firmado**
que mandaría Cloudflare — camino real, no un `UPDATE` a mano.

Usa `supabase/demo-assets/sample-5.mp4` (13 s, 1.3 MB) — el tercero de los tres
videos acordados.

### Debe funcionar
- El video sube, se procesa y el paso 1 avanza solo al quedar `ready`.
- El selector de zonas reusa el buscador de lugares de #157.
- El anuncio nace en **`pending_review`**, nunca activo.

---

## 4. Aviso de expiración — tarea #171.4

```bash
docker exec -i supabase_db_urbea-app psql -U postgres -d postgres \
  -c "select public.notify_ads_expiring_soon();"
```
- **1ª corrida → 1**. **2ª corrida → 0** (idempotente: no vuelve a avisar).
- La notificación le llega al **owner** de la agencia, no a cualquier miembro.

---

## 5. Pruebas negativas (las que más importan)

| Prueba | Resultado esperado |
|---|---|
| Entrar como `owner.gdl@urbea.demo` | **NO** aparece "Mis anuncios" (su agencia no tiene `can_advertise`) |
| Pedir métricas de otra agencia | **0 filas**, nunca un error (un error distinguible confirmaría que existe) |
| Activar un anuncio sin admin | `STATUS_CHANGE_REQUIRES_ADMIN` |
| Activar el anuncio "Notaría pública 42" | Se activa… pero **NO** aparece en el feed: su creativo no está `ready` |

Activar un anuncio (no hay pantalla de admin — ver §6):
```bash
docker exec -i supabase_db_urbea-app psql -U postgres -d postgres <<'SQL'
begin;
select set_config('urbea.admin_actor_id','10000000-0000-0000-0000-0000000000a0', true);
update public.ads set status='active' where id='40000000-0000-0000-0000-0000000000a5';
commit;
SQL
```

---

## 6. Qué NO va a funcionar — y por qué

### Huecos reales del producto (no del entorno)
1. **No hay pantalla de admin para aprobar anuncios.** El wizard deja el anuncio
   en `pending_review` y `step5.tsx` dice "activarlo es del admin", pero esa
   pantalla no existe: hoy solo se activa por SQL. Es el hueco más grande que
   queda abierto en la épica.
2. **No hay cobro.** CPM/CPC es la tarea #172, sin empezar. Las impresiones ya se
   registran como base facturable, pero nada las convierte en dinero.
3. **Métricas solo de los últimos 90 días.** `ad_impressions_monthly` no tiene
   quién la escriba y el crudo se purga a los 90 días (derivada #201).
4. **El panel no tiene selector de fechas.** La RPC acepta rango; la pantalla no
   lo usa. Fue deliberado.
5. **Agente suspendido:** #202/#203/#204 siguen abiertas — un agente suspendido
   todavía puede actuar sobre lo que ya existe.

### Limitaciones del entorno local (en el remoto no pasan)
6. **Colonias: solo Jalisco.** Importé el estado 14. Fuera de Jalisco no hay
   polígonos ni bboxes, así que cualquier coordenada cae a inventario nacional.
   Es exactamente por eso que la prueba de Monterrey devuelve 1 anuncio.
7. **El webhook de Stream no llega solo** → `fake-stream-webhook.sh` (§3).
8. **pg_cron no va a disparar durante la prueba.** Los dos jobs están
   registrados (`notify_ads_expiring_soon_daily` a las 9:00 CDMX,
   `purge_ad_impressions_daily`), pero hay que invocarlos a mano.
9. **`ads_enabled` quedó en `true` solo en local.** En el remoto sigue apagado, y
   encenderlo es la última decisión, después del smoke.

---

## 7. Cuando termines

```bash
# Revertir los datos de prueba (deja el catálogo de colonias, es público)
docker exec -i supabase_db_urbea-app psql -U postgres -d postgres -f - < supabase/scripts/teardown-ads-demo.sql

# Volver la app al remoto
mv mobile/.env.local.remoto.bak mobile/.env.local
```

Los videos en Cloudflare Stream **no** se borran solos. Los 2 creativos de
anuncios que subí para esto:
`f17eb117c4dd7a827101f57035c92cbf` y `a9cc6551e1dd11db10c86c3e9c78c668`.

---

## 8. Rama preview `preview-ads` (ensayo del despliegue)

Proyecto **efímero** de Supabase, hermano de producción: base propia, cuentas
propias, cero contacto con los usuarios reales. Cuesta **$0.01344/hora**
(≈32¢ al día) mientras exista.

```
ref:  ydhnhyagszopwhyoeela
url:  https://ydhnhyagszopwhyoeela.supabase.co
```
`mobile/.env.local` YA apunta ahí. Las credenciales de la DB salen de
`supabase branches get preview-ads`.

### Estado actual de la rama
- Las **78 migraciones** aplicadas desde cero, incluidas las 22 que le faltan a producción.
- Las **28 Edge Functions** desplegadas, con los secrets de Stream puestos.
- Sembrada igual que local: 11 usuarios, 3 inmobiliarias, 10 propiedades con
  video reproducible, 7,928 colonias de Jalisco y el stack de anuncios completo.
- Las métricas dan **exactamente los mismos números que en local** (17/12/5).

### Lo que este ensayo YA demostró
| Sonda | Resultado |
|---|---|
| Las 78 migraciones en orden, en un Supabase real | ✅ sin un solo error |
| Superficie de cambio del esquema | **6 tablas nuevas, 1 modificada (`agencies`), 27 idénticas** |
| `can_publish_properties` para agencias existentes | ✅ default `true` — nadie deja de publicar |
| `can_advertise` | ✅ default `false` — fail-closed |
| `mint-video-url` (EF existente, con el `_shared/clients.ts` nuevo) | ✅ 3 de 3 URLs firmadas |
| `publish-property` (EF modificada de mayor riesgo) | ✅ error tipado 400, no un 500 |
| `stream-webhook` (EF modificada) | ✅ HTTP 200 × 10 |
| `mint-ad-urls`, `record-ad-impressions`, `ads_for_zone` (nuevas) | ✅ |

### Simulador de webhook contra la rama
```bash
set -a && . supabase/functions/.env && set +a
BRANCH=ydhnhyagszopwhyoeela
DBURL=$(supabase branches get preview-ads | python3 -c "import sys,json;print(json.load(sys.stdin)['POSTGRES_URL'])" | sed 's/:6543/:5432/')
WEBHOOK_URL="https://$BRANCH.supabase.co/functions/v1/stream-webhook" PSQL_CMD="docker exec -i supabase_db_urbea-app psql $DBURL -tAc" ./supabase/scripts/fake-stream-webhook.sh 180
```

### Cuando termine
```bash
supabase branches delete preview-ads     # deja de cobrar
mv mobile/.env.local.remoto.bak mobile/.env.local
```

---

## 9. Después: el remoto

El local **no** prueba dos cosas, y ninguna se puede adelantar:
- que las migraciones apliquen limpio sobre el estado real de producción;
- el comportamiento con los datos reales que ya hay ahí.

Orden obligatorio (§0.5 producción viva): **desplegar schema + EFs → smoke →
OTA → recién entonces `ads_enabled=true`.** El kill-switch se lee en runtime, así
que encenderlo no requiere publicar app.
