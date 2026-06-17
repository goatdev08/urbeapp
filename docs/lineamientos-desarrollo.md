# Lineamientos de Desarrollo — Urbea

| Campo | Valor |
|-------|-------|
| Documento | Lineamientos técnicos de desarrollo |
| Versión | 1.0 |
| Fecha | 2026-05-14 |
| Estado | Activo — lectura obligatoria antes de desarrollar |
| Audiencia | Equipo de desarrollo, tech lead, QA |

---

## Índice

1. [Propósito](#1-propósito)
2. [Filosofía de arquitectura](#2-filosofía-de-arquitectura)
3. [Reglas de oro](#3-reglas-de-oro)
4. [Distribución de responsabilidades por capa](#4-distribución-de-responsabilidades-por-capa)
5. [Antipatrones a evitar](#5-antipatrones-a-evitar)
6. [Patrones recomendados](#6-patrones-recomendados)
7. [Convenciones de Edge Functions](#7-convenciones-de-edge-functions)
8. [Convenciones de RLS](#8-convenciones-de-rls)
9. [Convenciones de triggers SQL](#9-convenciones-de-triggers-sql)
10. [Workers externos](#10-workers-externos)
11. [Webhooks externos](#11-webhooks-externos)
12. [Migraciones de base de datos](#12-migraciones-de-base-de-datos)
13. [Testing](#13-testing)
14. [Observabilidad y logging](#14-observabilidad-y-logging)
15. [Seguridad](#15-seguridad)
16. [Convenciones de código](#16-convenciones-de-código)
17. [Flujos críticos del MVP](#17-flujos-críticos-del-mvp)

---

## 1. Propósito

Este documento define las reglas técnicas que el equipo debe seguir para desarrollar Urbea sobre el stack definido en el PRD (Supabase + React Native + Expo + Cloudflare Stream + Stripe + FCM).

El stack basado en Supabase ofrece velocidad de desarrollo y bajo costo inicial, pero requiere **disciplina específica** para evitar antipatrones que generan deuda técnica oculta y bugs difíciles de detectar. Este documento es la única fuente de verdad para esas reglas.

**Este documento es de lectura obligatoria antes de comenzar el desarrollo.** Cualquier excepción a las reglas debe ser justificada y aprobada por el tech lead.

---

## 2. Filosofía de arquitectura

### 2.1 Principios guía

1. **La lógica de negocio vive en un solo lugar.** Nunca repartida entre cliente, RLS y triggers.
2. **El cliente confía en el backend, no decide.** Validaciones de UX son agradables; la fuente de verdad siempre es el backend.
3. **Los triggers SQL hacen cosas atómicas, no orquestación.** Cualquier flujo con side effects vive en código (Edge Functions o workers).
4. **RLS es la segunda red de seguridad, no la primera.** La autorización principal se valida explícitamente en el código del backend.
5. **Lo que se puede ver tipado, debe estar tipado.** TypeScript en cliente y Edge Functions; Pydantic-style validations en workers.
6. **Si dudas, hazlo explícito.** Un trigger oculto siempre es peor que una función explícita.

### 2.2 Heurística rápida para decisiones técnicas

- Si te encuentras escribiendo más de **30 líneas de PL/pgSQL** para resolver algo, **detente**: probablemente debería ser una Edge Function.
- Si encadenas **2 o más triggers** para implementar un flujo, **detente**: probablemente debería ser un solo endpoint que ejecute el flujo explícitamente.
- Si dependes de RLS para autorización en una operación crítica (pagos, leads, datos personales), **detente**: debería haber una Edge Function que valide explícitamente y RLS solo como red.
- Si el cliente puede llamar directamente a una tabla en una operación crítica, **detente**: debería pasar por una Edge Function.

---

## 3. Reglas de oro

Estas tres reglas resumen la disciplina mínima para que el stack funcione:

### Regla 1: Disciplina con RLS

- Cada política RLS se revisa por al menos dos personas antes de ir a producción.
- Cada tabla con datos sensibles tiene **tests automáticos de RLS** que verifican que un usuario X no pueda acceder a datos que no le corresponden.
- Si una política tiene más de 3 cláusulas anidadas, refactorizarla o mover la lógica a una Edge Function.

### Regla 2: Edge Functions limitadas a lógica simple

- Cualquier proceso que pueda tomar más de **30 segundos** debe encolar trabajo a un worker externo.
- Las Edge Functions tienen **timeout duro de 150 segundos** en Supabase; nunca diseñar al límite.
- Pipeline de video, recálculo de scores masivos, jobs periódicos: van en worker externo, no en Edge Functions.

### Regla 3: Postgres limpio, sin "todo en triggers"

- Los triggers SQL solo manejan operaciones atómicas: `updated_at`, denormalizaciones triviales, validaciones estructurales simples (check constraints).
- Cualquier flujo con side effects (notificaciones, recálculos cruzados, llamadas externas) vive en código, no en triggers.

---

## 4. Distribución de responsabilidades por capa

| Capa | Qué vive aquí | Qué NO debe vivir aquí |
|------|---------------|------------------------|
| Cliente (React Native) | UI, navegación, validaciones de UX, llamadas a la API | Lógica de negocio que pueda saltarse, decisiones de autorización |
| Edge Functions | Toda la lógica de negocio, validaciones canónicas, orquestación de flujos | Loops largos, jobs pesados de >30 segundos |
| Postgres (queries normales) | CRUD simple, JOINs, queries de lectura | Lógica encadenada vía triggers |
| Triggers SQL | Cosas atómicas: `updated_at`, audit trail simple, integridad referencial | Notificaciones, recálculos, side effects, llamadas externas |
| RLS | Defensa secundaria de autorización | Autorización principal sin Edge Function de service layer |
| Realtime | Notificaciones in-app del usuario actual | Feed, mapa, métricas, CRM |
| Worker externo (Railway / Fly.io) | Procesamiento de video post-upload, jobs periódicos, recálculos pesados, webhooks asíncronos | Lógica que debería ser síncrona desde el cliente |

---

## 5. Antipatrones a evitar

### 5.1 Lógica de negocio dentro de triggers de PostgreSQL

**Lo que NO hacer:**

```sql
CREATE TRIGGER on_interaction_inserted
AFTER INSERT ON interactions
FOR EACH ROW EXECUTE FUNCTION recalculate_lead_score_and_notify();
```

Donde `recalculate_lead_score_and_notify` hace 5 cosas: actualiza el score del lead, cambia el estado si supera umbral, inserta notificación, actualiza la métrica de la publicación y manda push.

**Por qué es problemático:**

- Es invisible: nadie que revise el código del backend va a saber que existe esta cascada.
- Es imposible de testear unitariamente sin levantar una BD real.
- Si algo falla, el stack trace te muestra "ERROR en trigger" y no qué falló específicamente.
- Cuando quieras cambiar el algoritmo del score, tienes que tocar SQL en producción.

**Qué hacer en su lugar:**

- El cliente llama a una Edge Function como `POST /interactions`.
- La Edge Function ejecuta el flujo en TypeScript explícito: inserta la interacción, recalcula score, decide notificaciones, hace inserts en una transacción.
- Si quieres asincronía, encola un mensaje en una tabla `task_queue` y un worker externo lo procesa.

---

### 5.2 Auth y autorización confiando solo en RLS

**Lo que NO hacer:**

Dejar que el cliente haga `supabase.from('properties').select()` y confiar en que RLS filtre por dueño automáticamente.

**Por qué es problemático en Urbea:**

- Un agente necesita ver sus propias publicaciones (`WHERE owner_id = auth.uid()`).
- Un admin necesita ver TODAS las publicaciones para moderar.
- La inmobiliaria necesita ver las publicaciones de TODOS sus agentes.
- El público necesita ver solo `status = 'active'`.

Si todo esto vive solo en RLS, terminas con políticas RLS gigantes con cláusulas anidadas que nadie entiende. Y un bug en una sola política expone datos privados de los usuarios.

**Qué hacer en su lugar:**

- Usar RLS como **segunda capa de seguridad** (defensa en profundidad).
- La autorización principal vive en Edge Functions de "service layer":
  - `GET /my-properties` → Edge Function que filtra por `auth.uid()` y RLS también lo refuerza.
  - `GET /admin/properties` → Edge Function que verifica que el caller es admin antes de quitar el filtro.
- RLS queda como red: si la Edge Function se equivoca y olvida filtrar, RLS bloquea.
- **Nunca** exponer tablas directamente al cliente con queries libres en operaciones sensibles. Solo en lecturas públicas controladas (`active_properties_view`).

---

### 5.3 Stored procedures gigantes en PL/pgSQL

**Lo que NO hacer:**

```sql
CREATE FUNCTION submit_property_for_review(p_property_id uuid)
RETURNS json AS $$
BEGIN
  -- 200 líneas de SQL/PL/pgSQL aquí
  -- Validaciones, inserts en 5 tablas, llamadas a otras funciones...
END;
$$ LANGUAGE plpgsql;
```

**Por qué es problemático:**

- PL/pgSQL no tiene un buen ecosistema de testing.
- Los errores de runtime son difíciles de capturar.
- Refactorizar 200 líneas de PL/pgSQL es un infierno.
- El equipo termina con miedo de tocarlo.

**Qué hacer en su lugar:**

- La función SQL solo hace el INSERT/UPDATE puro.
- La orquestación (validar, insertar varias cosas, mandar notificaciones) vive en una Edge Function de TypeScript que llama a varios queries simples dentro de una transacción.

---

### 5.4 Pipeline de procesamiento de video orquestado en triggers

**Lo que NO hacer:**

- Trigger en `property_videos` que detecta cambio de estado a `uploading_media`.
- Trigger detecta `media_failed` y dispara otra Edge Function.
- Trigger detecta `approved` y manda notificación.

Terminas con 4-5 triggers encadenados que se llaman entre sí. Cualquier bug en uno rompe todo y nadie sabe dónde está el problema.

**Qué hacer en su lugar:**

- Una sola Edge Function que recibe el webhook de Cloudflare Stream.
- Esa Edge Function actualiza el estado del video, inserta en `notifications`, y termina.
- Lineal, una sola pieza de código, una sola responsabilidad.

---

### 5.5 Recalcular el score del lead en cada SELECT

**Lo que NO hacer:**

Cada vez que el agente abre su CRM, hacer una query como:

```sql
SELECT 
  l.*,
  (SELECT COUNT(*) * 1 FROM likes WHERE user_id = l.user_id AND video_id IN (...)) +
  (SELECT COUNT(*) * 4 FROM saves WHERE user_id = l.user_id AND property_id IN (...)) +
  AS calculated_score
FROM leads l
WHERE agent_id = $1
ORDER BY calculated_score DESC;
```

**Por qué es problemático:**

- Cada apertura del CRM dispara una query carísima.
- No escala: con 100 leads y 50 publicaciones por agente, la query se vuelve lenta.
- El cliente espera más tiempo, la experiencia se degrada.

**Qué hacer en su lugar:**

- El campo `score` vive **denormalizado** en la tabla `leads`.
- Se actualiza en **write-time**: cuando un usuario interactúa con una publicación del agente, la Edge Function que procesa la interacción suma el delta al score del lead correspondiente.
- El SELECT del CRM es trivial: `SELECT * FROM leads WHERE agent_id = $1 ORDER BY score DESC`.

---

### 5.6 Búsqueda con `ILIKE %query%` en lugar de índices apropiados

**Lo que NO hacer:**

Para el buscador de propiedades (por colonia, agente, código), usar:

```sql
SELECT * FROM properties WHERE address ILIKE '%' || $1 || '%';
```

**Por qué es problemático:**

- `ILIKE` con `%` al inicio no usa índices. Hace full scan de la tabla.
- A 10,000 propiedades, cada búsqueda toma segundos.

**Qué hacer en su lugar:**

- Activar la extensión `pg_trgm` en Postgres.
- Crear índices `GIN` o `GIST` sobre los campos buscables (`address`, `colony`, `agent_name`).
- Usar el operador `%` de pg_trgm: `WHERE address % $1` (similitud) o `address ILIKE '%' || $1 || '%'` ahora sí con índice GIN.

---

### 5.7 Realtime de Supabase para feeds, mapas o métricas

**Lo que NO hacer:**

Suscribirse vía realtime a la tabla `properties` para que cuando un admin apruebe una publicación, todos los usuarios la vean aparecer en el feed automáticamente.

**Por qué es problemático:**

- Realtime de Supabase mantiene conexiones websocket abiertas.
- Cuando creces a miles de usuarios, los costos suben y la latencia se degrada.
- No vale la pena el costo para algo que el usuario verá la próxima vez que abra el feed.

**Qué hacer en su lugar:**

- Realtime SOLO para casos genuinamente "vivos":
  - Notificación in-app del usuario actual (suscripción solo a `notifications` con filtro por `user_id`).
- Todo lo demás (feed, mapa, CRM, métricas): refresh manual o pull periódico.

---

### 5.8 Generar notificaciones desde múltiples triggers y endpoints

**Lo que NO hacer:**

- Trigger A inserta en `notifications` cuando se aprueba una publicación.
- Edge Function B inserta en `notifications` cuando termina el procesamiento del video.
- Cliente C también inserta directamente cuando detecta cierto evento local.

**Por qué es problemático:**

- Notificaciones duplicadas (a veces).
- Inconsistencia en el formato del payload.
- Difícil cambiar el contenido de las notificaciones porque hay 5 lugares que generan cada tipo.

**Qué hacer en su lugar:**

- Un solo módulo "notification service" como un conjunto de Edge Functions: `createNotification(userId, type, payload)`.
- Todos los demás flujos lo llaman, no insertan directo.
- El formato y la lógica de canal (push/in-app/email) vive en un solo lugar.

---

### 5.9 Migraciones desde el dashboard de Supabase

**Lo que NO hacer:**

Abrir el dashboard de Supabase, agregar columnas o crear tablas directamente desde la UI.

**Por qué es problemático:**

- No queda en git. Los demás miembros del equipo no saben qué cambió.
- En staging y producción terminan con esquemas distintos.
- Volver atrás es imposible.

**Qué hacer en su lugar:**

- Usar **Supabase CLI** con migraciones en archivos `.sql` versionadas en git.
- Cada cambio es un archivo `20260514_add_lead_score.sql`.
- Las migraciones se aplican vía CI/CD a staging y producción.

---

### 5.10 Webhooks de Stripe procesados en un trigger

**Lo que NO hacer:**

Recibir el webhook de Stripe en una Edge Function que escribe en una tabla, y tener un trigger que actualice `purchase`, genere `video_slot`, mande email, etc.

**Por qué es problemático:**

- Si el trigger falla, el webhook regresa OK a Stripe y nunca se reintenta.
- Stripe espera respuesta en <5 segundos; un trigger pesado puede excederlo.
- No hay observabilidad de qué se hizo y qué no.

**Qué hacer en su lugar:**

- Edge Function que recibe el webhook valida la firma, escribe en `stripe_events_received` (idempotente con event_id de Stripe), responde OK a Stripe.
- Un worker procesa los eventos pendientes de forma asíncrona con reintentos y dead letter queue.

---

### 5.11 Validaciones de negocio repartidas en 3 capas

**Lo que NO hacer:**

- Validar en el cliente React Native que el video tenga 60-120 segundos.
- Validar de nuevo en Edge Function.
- Tener trigger SQL que también valide y rechace.

**Por qué es problemático:**

- Cuando cambies a "30-180 segundos" tienes que tocar 3 lugares.
- Un día se olvida uno y aparecen bugs.

**Qué hacer en su lugar:**

- Validación canónica en el backend (Edge Function).
- El cliente confía en lo que el backend devuelve; muestra UX agradable pero no es la fuente de verdad.
- RLS o triggers solo validan estructura básica (tipos, no-nulls, foreign keys).

---

### 5.12 Almacenar archivos grandes en Supabase Storage

**Lo que NO hacer:**

Subir los videos directamente a Supabase Storage.

**Por qué es problemático:**

- Supabase Storage no está optimizado para video streaming. No tiene transcoding, no tiene HLS adaptativo, no tiene CDN tan agresivo.
- El KPI principal de Urbea es scroll de video sin latencia. Esto se rompe con Supabase Storage.

**Qué hacer en su lugar:**

- Videos → **Cloudflare Stream** (decisión ya tomada en el PRD).
- Solo thumbnails y avatares chicos → Supabase Storage o Cloudflare R2.

---

### 5.13 Hacer queries N+1 desde el cliente

**Lo que NO hacer:**

```typescript
const properties = await supabase.from('properties').select('*');
for (const property of properties.data) {
  property.videos = await supabase.from('property_videos').select('*').eq('property_id', property.id);
}
```

**Qué hacer en su lugar:**

```typescript
const { data } = await supabase
  .from('properties')
  .select(`
    *,
    property_videos (*)
  `);
```

Supabase soporta nested selects con sintaxis PostgREST. Usar siempre que sea posible.

---

### 5.14 No paginar listados grandes

**Lo que NO hacer:**

`SELECT * FROM properties` en endpoints públicos sin paginación.

**Qué hacer en su lugar:**

Toda lectura de listas paginada con `LIMIT` y cursor (`created_at`, `id` o `score`). Limitar a 20-50 elementos por página por defecto. El cliente solicita siguiente página con cursor del último elemento.

---

## 6. Patrones recomendados

### 6.1 Service Layer en Edge Functions

Cada dominio del PRD tiene una carpeta de Edge Functions que actúa como service layer:

```
/supabase/functions/
  /auth/
  /properties/
  /videos/
  /leads/
  /comments/
  /notifications/
  /admin/
  /payments/
```

Cada endpoint:

1. Valida autenticación.
2. Valida autorización explícita.
3. Valida payload con un schema (Zod o equivalente).
4. Ejecuta la lógica de negocio.
5. Persiste cambios en una transacción si aplica.
6. Devuelve respuesta tipada.

### 6.2 Idempotencia en operaciones críticas

Webhooks de Stripe, eventos de Cloudflare Stream y cualquier acción disparada por evento externo debe ser **idempotente**: si llega dos veces, no debe causar doble efecto.

Patrón: tabla `external_events_received` con event_id único. Antes de procesar, verificar si ya existe. Si existe, devolver OK sin reprocesar.

### 6.3 Soft delete con campo `deleted_at`

- Todas las tablas críticas tienen campo `deleted_at TIMESTAMPTZ NULL`.
- Vistas filtran automáticamente `WHERE deleted_at IS NULL` para los queries públicos.
- Cron job (`pg_cron` o worker externo) limpia registros con `deleted_at + retention_days < now()`.

### 6.4 Denormalización selectiva

Cuando un cálculo es caro y se consulta muchas veces, denormalizar y mantener actualizado en write-time. Ejemplos:

- `leads.score` se calcula al insertar interacción.
- `properties.like_count`, `properties.view_count` se incrementan vía función SQL atómica.
- `agents.followers_count` se mantiene vía trigger simple (es excepción válida porque es atómico y sin side effects).

### 6.5 Audit trail inmutable

La tabla `admin_actions` es append-only. Solo se permite INSERT (vía RLS). Cualquier acción del admin que cambie estado en otras entidades primero inserta en `admin_actions` y luego ejecuta el cambio dentro de la misma transacción.

---

## 7. Convenciones de Edge Functions

### 7.1 Estructura mínima de una Edge Function

```typescript
import { serve } from 'std/server';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const inputSchema = z.object({
  property_id: z.string().uuid(),
  reason: z.string().min(10).max(500),
});

serve(async (req) => {
  // 1. Verificar autenticación
  const supabase = createClient(/* ... */);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return new Response('Unauthorized', { status: 401 });

  // 2. Validar payload
  const body = await req.json();
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return new Response('Bad Request', { status: 400 });

  // 3. Autorización explícita
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single();
  if (profile?.role !== 'admin') return new Response('Forbidden', { status: 403 });

  // 4. Ejecutar lógica
  // ...

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
```

### 7.2 Reglas para Edge Functions

- Máximo 30 segundos de tiempo de ejecución como objetivo (nunca acercarse al límite duro de 150 s).
- Logs estructurados en JSON con `correlation_id`, `user_id`, `endpoint`.
- Errores manejados explícitamente; nunca dejar throw sin catch.
- Devolver siempre status code apropiado.
- Idempotencia donde aplique.
- Tests automáticos del happy path y de errores comunes.

---

## 8. Convenciones de RLS

### 8.1 Reglas generales

- Toda tabla tiene RLS habilitado por defecto (`ENABLE ROW LEVEL SECURITY`).
- Las políticas se nombran descriptivamente: `users_can_select_own_leads`, `admins_can_update_any_property`, etc.
- Cada política se acompaña de un comentario que explica el porqué.

### 8.2 Patrón de políticas mínimas

Para cada tabla, definir las políticas mínimas necesarias:

- `SELECT`: ¿quién puede leer este registro?
- `INSERT`: ¿quién puede crear?
- `UPDATE`: ¿quién puede modificar?
- `DELETE`: ¿quién puede eliminar?

### 8.3 RLS para tablas de uso interno

Tablas como `admin_actions`, `events_raw`, `task_queue` solo deben permitir acceso a la `service_role` de Supabase (que solo se usa desde Edge Functions y workers, nunca desde el cliente).

### 8.4 Tests automáticos de RLS

Para cada tabla con datos sensibles, escribir tests automáticos con `pgtap` o equivalente que verifiquen:

- Un usuario X NO puede leer datos de un usuario Y.
- Un usuario X NO puede modificar datos de otro.
- Un admin SÍ puede leer/modificar todo.
- Los tests corren en CI antes de cada deploy.

---

## 9. Convenciones de triggers SQL

### 9.1 Triggers permitidos

- `updated_at` automático.
- Mantener integridad referencial (cascada de soft deletes simples).
- Audit log simple (inserción en `admin_actions` sin lógica compleja).
- Increments atómicos de contadores trivials (followers_count, like_count).

### 9.2 Triggers prohibidos

- Llamadas a otras funciones que tengan side effects.
- Notificaciones (push, email, in-app).
- Recálculos de scores complejos.
- Validaciones de negocio complejas.
- Triggers en cascada (un trigger que dispara otro trigger).

### 9.3 Si necesitas algo más complejo

Mueve la lógica a una Edge Function o a un worker externo. El trigger solo escribe en una tabla `task_queue` para que el worker la procese.

---

## 10. Workers externos

### 10.1 Cuándo usar workers

- Procesamiento de video post-upload (webhooks de Cloudflare Stream con reintentos).
- Jobs programados (expiración de slots, expiración de créditos, purga de soft deletes).
- Recálculos masivos (recalibrar scores si se cambia la ponderación).
- Envío masivo de notificaciones (resumen semanal).
- Webhooks de Stripe con procesamiento idempotente.

### 10.2 Stack recomendado

- **Lenguaje:** TypeScript (Node.js) o Python.
- **Hosting:** Railway, Fly.io o Render.
- **Cola:** tabla `task_queue` en Supabase (Postgres). Suficiente para el volumen del MVP. Migrar a Redis + BullMQ si crece.
- **Cron:** `pg_cron` integrado en Supabase para jobs programados, o cron del worker externo.

### 10.3 Patrón de trabajador

- Worker hace polling cada 10-30 segundos a la tabla `task_queue`.
- Marca la tarea como `processing` con timestamp.
- Ejecuta el trabajo con reintentos exponenciales.
- En éxito: marca como `done`.
- En fallo: marca como `failed` con error y conteo de reintentos. Si reintentos > N, mueve a `dead_letter`.

---

## 11. Webhooks externos

### 11.1 Patrón de recepción

Todo webhook externo (Cloudflare Stream, Stripe, Twilio) debe seguir el patrón:

1. Validar firma o secreto compartido (rechazar si no es válido).
2. Verificar idempotencia: si el `event_id` ya está en `external_events_received`, devolver OK sin procesar.
3. Insertar en `external_events_received` con `event_id`, `provider`, `payload`, `received_at`.
4. Encolar en `task_queue` para procesamiento asíncrono.
5. Responder OK al proveedor inmediatamente (<5 segundos).

### 11.2 Provider-specific

- **Stripe:** validar `Stripe-Signature` con webhook secret.
- **Cloudflare Stream:** validar webhook secret.
- **Twilio:** validar `X-Twilio-Signature`.

---

## 12. Migraciones de base de datos

### 12.1 Reglas obligatorias

- Todas las migraciones se escriben como archivos `.sql` en `/supabase/migrations/`.
- Nombre: `YYYYMMDDHHMMSS_descripcion.sql`.
- Cada migración debe ser **idempotente** cuando sea posible (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).
- Cada migración tiene un commit dedicado en git con mensaje descriptivo.
- Cambios destructivos (drops) requieren aprobación del tech lead y comunicado explícito al equipo.

### 12.2 Aplicación

- En desarrollo local: `supabase db reset` o `supabase migration up`.
- En staging y producción: vía GitHub Actions con `supabase db push` o equivalente.
- Nunca aplicar migraciones manualmente desde el dashboard.

### 12.3 Rollback

- Cada migración debe tener un script de rollback escrito antes del deploy a producción.
- El rollback se guarda en `/supabase/migrations/rollbacks/`.

---

## 13. Testing

### 13.1 Niveles de testing

- **Unit tests:** funciones puras y lógica de Edge Functions. Cobertura objetivo: 70%.
- **Integration tests:** flujos completos contra una BD de prueba. Casos críticos del PRD.
- **RLS tests:** automáticos para cada tabla con datos sensibles.
- **E2E tests:** los flujos críticos del MVP (registro, publicación, contacto, pago) con Maestro o Detox.

### 13.2 Pipeline de CI

- En cada PR: lint, type check, unit tests, integration tests, RLS tests.
- Bloqueo de merge si alguno falla.
- Despliegue automático a staging tras merge a `develop`.
- Despliegue a producción tras merge a `main` con aprobación manual.

### 13.3 Flujos críticos a testear

- Registro completo (incluyendo OTP, OAuth Google, OAuth Apple, código de invitación).
- Wizard de publicación con autoguardado de borrador.
- Procesamiento de video con webhooks de Cloudflare.
- Creación de lead al tocar "Contactar agente" + cálculo de score.
- Aprobación de publicación por admin con notificación.
- Eliminación de cuenta con cascada de soft deletes.
- Webhooks de Stripe con idempotencia.

---

## 14. Observabilidad y logging

### 14.1 Herramientas

- **Sentry:** errores del cliente (React Native) y del servidor (Edge Functions).
- **Supabase Logs:** logs nativos de la plataforma.
- **Logflare** (opcional): agregación y búsqueda avanzada de logs.

### 14.2 Reglas de logging

- Todo log estructurado en JSON.
- Cada request tiene un `correlation_id` que se propaga del cliente al backend.
- Logs incluyen: `correlation_id`, `user_id` (si aplica), `endpoint`, `duration_ms`, `status`.
- Errores incluyen stack trace completo.
- Nunca loguear datos sensibles: contraseñas, OTPs, tokens, números de tarjeta.

### 14.3 Métricas a monitorear

- Tasa de error por endpoint.
- P50, P95, P99 de latencia por endpoint.
- Cola de `task_queue`: tamaño, edad del más viejo, tasa de fallos.
- Procesamiento de video: éxito, fallo, tiempo promedio.
- Webhooks de Stripe: recibidos, procesados, fallidos.

---

## 15. Seguridad

### 15.1 Reglas básicas

- Nunca commitear secretos al repo. Usar variables de entorno vía Supabase Vault o GitHub Secrets.
- Rotar tokens y secretos al menos cada 90 días.
- Todo endpoint requiere autenticación a menos que sea explícitamente público.
- Rate limiting en endpoints públicos (registro, login, formulario de interesados a agente, webhooks).
- Validación estricta de inputs con schemas (Zod en TypeScript).
- Sanitización de strings antes de mostrarlos en notificaciones, comentarios, mensajes prellenados.

### 15.2 Datos sensibles

- Contraseñas: hash con bcrypt o argon2 (gestionado por Supabase Auth).
- Tokens de push: nunca exponer al cliente.
- Datos de tarjetas: nunca tocar; Stripe los maneja directamente vía iframe.
- Datos personales (correo, teléfono, dirección): solo visibles según las reglas del PRD (ej. teléfono del usuario solo visible al agente tras contacto).

### 15.3 GDPR / LFPDPPP

- Eliminación de cuenta con plazo de 15 días de gracia y eliminación definitiva posterior.
- Exportación de datos personales bajo solicitud (post-MVP, pero arquitectura debe permitirlo).
- Auditoría de accesos a datos sensibles (admin viendo datos de usuarios queda en `admin_actions`).

---

## 16. Convenciones de código

### 16.1 General

- TypeScript con `strict: true` en cliente y Edge Functions.
- Linter: ESLint con configuración consistente.
- Formatter: Prettier.
- Convención de nombres: `camelCase` para variables y funciones, `PascalCase` para componentes y tipos, `snake_case` para campos de BD.

### 16.2 Cliente React Native

- Estructura por feature: `/src/features/feed/`, `/src/features/auth/`, etc.
- Componentes presentacionales separados de lógica de negocio.
- Estado global mínimo (Zustand o React Query); preferir estado local.
- Navegación con React Navigation con tipado completo de params.

### 16.3 Edge Functions

- Una carpeta por dominio.
- Un archivo por endpoint.
- Helpers compartidos en `/supabase/functions/_shared/`.

### 16.4 Base de datos

- Nombres de tablas en `snake_case`, plural (`users`, `properties`, `leads`).
- Nombres de campos en `snake_case`.
- Foreign keys nombradas como `<entidad>_id` (`agent_id`, `property_id`).
- Timestamps siempre `TIMESTAMPTZ` con default `now()`.

### 16.5 Documentación inline

- Funciones complejas con docstring en formato JSDoc (TypeScript) o Google style (Python).
- Comentarios solo donde aportan valor: explican "por qué" no "qué".
- Migraciones con comentario de propósito al inicio del archivo.

---

## 17. Flujos críticos del MVP

Esta sección lista los flujos cuya implementación debe ser revisada explícitamente por el tech lead antes de pasar a QA.

### 17.1 Registro completo

- Captura de datos + OTP teléfono + verificación email + validación de código de invitación + aceptación de términos.
- Crear `user` con rol `registered`.
- Crear `user_consent` para versión de términos vigente.

### 17.2 Upgrade a premium implícito al publicar

- Wizard completo del paso 1 al 5.
- Al tocar "Publicar":
  - Si beta: cambiar rol a `premium`, crear `property`, crear `video_slot` ficticio, video a `pending_review`.
  - Si post-beta: redirigir a Stripe Checkout. Tras pago confirmado vía webhook, ejecutar lo anterior.

### 17.3 Upgrade a agente bajo inmobiliaria

- Wizard de upgrade.
- Validación de token contra `agency_invitation_tokens` (no expirado, no usado).
- Cambio de rol a `agent` + asociación con `agency`.
- Marcar token como `used`.
- Habilitar drawer del CRM en cliente.

### 17.4 Upgrade a agente independiente

- Wizard de upgrade con datos.
- Insertar en `agent_applications` con estado `pending`.
- Admin revisa en panel y aprueba/rechaza.
- Al aprobar: cambio de rol + notificación push e in-app.

### 17.5 Procesamiento de video

- Cliente sube a Cloudflare Stream con TUS upload o equivalente resumible.
- Webhook de Cloudflare al backend con `video_id` y estado.
- Edge Function actualiza `property_videos.status` + genera 3 thumbnails sugeridos + envía notificación.

### 17.6 Creación de lead

- Usuario toca "Contactar agente".
- Edge Function `POST /contact`:
  - Verifica si ya existe lead para el par agent-user.
  - Si no existe: crea `lead` en estado `whatsapp_opened`, agrega propiedad a `lead_origin_properties`, calcula score inicial sumando todas las interacciones retroactivas del usuario con publicaciones del agente.
  - Si existe: agrega propiedad a `lead_origin_properties` si no estaba.
  - Suma 10 puntos al score.
- Envía notificación al agente.
- Devuelve al cliente el deep link de WhatsApp con mensaje prellenado.

### 17.7 Actualización de score en interacciones

- Cada vez que un usuario realiza una interacción (like, save, share, comment, video_completed) en una publicación de un agente con quien tiene lead activo, la Edge Function incrementa `leads.score` con el delta correspondiente.

### 17.8 Aprobación de publicación por admin

- Admin toca "Aprobar" en panel.
- Edge Function valida que es admin.
- Inserta en `admin_actions` el log de la acción.
- Cambia estado de `property` a `active`.
- Envía notificación al publicador (push, in-app, email).

### 17.9 Expiración de video

- Cron diario (worker externo o `pg_cron`):
  - Busca videos con vigencia próxima a expirar.
  - Envía notificaciones correspondientes (7 días, 1 día antes).
  - Al cumplirse la fecha, cambia estado a `expired`.

### 17.10 Eliminación de cuenta

- Usuario confirma con OTP.
- Edge Function ejecuta en transacción:
  - Cambio de `users.status` a `pending_deletion`.
  - Soft delete de `properties` propias.
  - Soft delete de `leads` propios (si agente).
  - Invalidar sesiones del usuario.
- Cron diario marca eliminación definitiva tras 15 días.

---

## Glosario rápido

| Término | Significado |
|---------|-------------|
| RLS | Row Level Security de PostgreSQL. |
| Edge Function | Función serverless de Supabase, ejecutada en Deno con timeout máximo de 150 s. |
| Worker externo | Proceso de larga duración en Railway/Fly.io que procesa tareas asíncronas. |
| Idempotencia | Propiedad de una operación que produce el mismo resultado si se ejecuta una o varias veces. |
| `service_role` | Rol especial de Supabase con permisos elevados; solo se usa en backend, nunca en cliente. |
| `auth.uid()` | Función SQL que devuelve el ID del usuario autenticado en el contexto de la query. |
| Webhook | Llamada HTTP que un servicio externo hace a nuestro backend cuando ocurre un evento. |
| Soft delete | Marcado lógico de un registro como eliminado sin borrarlo físicamente. |
| Dead letter queue | Lista de tareas que fallaron después de varios reintentos y requieren revisión manual. |
