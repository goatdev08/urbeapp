---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [.taskmaster/docs/exploraciones/048-follow-comentarios-reportes.md, .taskmaster (tarea #289, derivadas #290 #291), mobile/design-previews/289-comentarios.html]
codigo:
  - supabase/migrations/20260910100001_comments.sql
  - supabase/migrations/20260910200001_comment_reports.sql
  - supabase/migrations/20260910300001_notify_social_comments.sql
  - supabase/migrations/20260910400001_seed_comment_filter_words.sql
  - supabase/functions/post-comment/{index,handler,classify,types}.ts
  - supabase/functions/moderate-comment/{index,handler,types}.ts
  - supabase/tests/112_comments_test.sql
  - supabase/tests/113_comment_reports_test.sql
  - supabase/tests/114_comment_filter_words_seed_test.sql
  - supabase/tests/115_notify_social_comments_test.sql
  - mobile/src/features/comments/{types.ts,hooks/useComments.ts,hooks/usePostComment.ts,hooks/useHideComment.ts,hooks/useReportComment.ts,components/CommentsSheet.tsx}
  - mobile/src/features/admin/hooks/{useAdminReports,useResolveReport}.ts
  - mobile/app/admin/reports/index.tsx
actualizado: 2026-09-11
---

# Comentarios por publicación y su moderación (#289, C1+C2+R1)

> Un comentario es texto plano (≤500) de un usuario autenticado sobre una propiedad `active`. Nace `visible` o `held_for_review` (filtro determinista), lo oculta el gestor de la propiedad o 3 reportantes distintos en 24 h, y lo resuelve un admin de plataforma desde la misma cola `/admin/reports` que las propiedades. Sin likes, sin hilos, sin edición (exploración 048).

## Modelo (`20260910100001`, `20260910200001`)
- `comments(id, property_id→properties cascade, user_id→public.users cascade, body, status comment_status, created_at, updated_at)`; CHECK `body ~ '\S' and length ≤ 500` (sin `trim`: recorta solo ASCII); enum `comment_status = visible|held_for_review|hidden|deleted`, creado y usado en la misma migración (el gotcha `ADD VALUE` es solo para `ALTER TYPE`).
- `properties.comment_count` **al final** de la tabla (los `select('*')` de builds instalados no se desordenan) mantenido por `update_comment_count()` — `AFTER INSERT OR DELETE OR UPDATE OF status`, SECURITY DEFINER `search_path=''`, cuenta **solo `visible`**, `GREATEST(0,…)`, backfill idempotente. Sin `set_updated_at` en `comments` (no es SECDEF y el test exige que todo trigger de la tabla lo sea).
- `comment_reports(comment_id, reported_by_user_id, reason property_report_reason, reason_text, status text new|resolved)`; índice único `(comment_id, reported_by_user_id)` (23505 = «ya reportaste»); CHECK «`other` exige texto» calcado de `property_reports`. Sin `reviewed_by/resolution`: el rastro vive en `admin_actions`.

## Quién ve y quién escribe (🔒 RLS, tests 112/113)
- **Gestor** = `private.is_property_comment_manager(property_id)` con la expresión **viva** de `properties_update` tras #202: dueño con membresía vigente en su agencia ∨ `agency_role_of ∈ (owner, admin)` ∨ `is_admin()`. Un dueño **suspendido** pierde el poder de gestor sobre los comentarios de su propia propiedad; owner/admin de agencia lo conservan. 🔴 NO reusa `private.can_manage_property()` — está desactualizado (sin rama admin de agencia ni regla #202); derivada `hardening(289.2)`.
- `comments_select`: `visible` ∨ autor ∨ gestor. `anon`: nada.
- `comments_update`: **status-only** por grant a nivel de columna (`GRANT UPDATE(status)`); gestor → cualquier status; autor → solo `deleted` (`WITH CHECK` lanza 42501 si intenta otro). **Sin policy de INSERT** para `authenticated` (escribe la EF con service_role) y **sin DELETE** para nadie (borrar = `status='deleted'`).
- `comment_reports_insert`: `reported_by_user_id = auth.uid()` **y no autor del comentario** (WITH CHECK → 42501). `comment_reports_select`: propio ∨ admin. El gestor NO ve los reportes.

## Filtro mínimo (EF `post-comment`, `classify_comment`)
Función pura: teléfono ≥8 dígitos con separadores (`depa 5B`, `$2,500,000`, `2026`, `CP 44100` **no** matchean), email, URL/dominio (`http`, `www.`, TLD de lista mínima `com|mx|net|org|io|co|info`; `p. ej.`, `ok.`, `5.5 m2` no), y **lista de palabras** en `app_config.comment_filter_words` (jsonb `[]`, palabra completa, case-insensitive) — se calibra **sin publicar app**. Matchea → `held_for_review` (visible solo para el autor, chip «En revisión»); si no → `visible`. `configReader` fail-open (`[]`) para que un fallo de config nunca frene el comentario. Orden de la EF: OPTIONS → método → **JWT antes que el body** → parse → validación (sin `trim`) → propiedad `active` y **`deleted_at is null`** (el soft-delete de moderación no cambia `status`) → clasificar → INSERT service_role → 201 con el comentario. `user_id` siempre del JWT.

## Auto-ocultar y resolución (`check_comment_reports_autohide`, `resolve_comment_reports_atomic`)
- Trigger `AFTER INSERT` en `comment_reports`, sin `EXCEPTION`: `count(distinct reported_by_user_id)` en 24 h ≥ 3 → `comments.status='hidden'` en la misma transacción; ya `hidden`/`deleted` → no-op. `count(*)` sería equivalente por el índice único (mutante equivalente documentado en 289.3).
- RPC `resolve_comment_reports_atomic(p_comment_id, p_action restore|keep_hidden|delete_comment, p_reason)`: actor = `auth.uid()` (por eso la EF `moderate-comment` llama con **`user_client(jwt del admin)`**, no con service_role: con service_role `auth.uid()` es null → `ADMIN_REQUIRED` siempre). Guards en orden admin → acción → existe → **origen `hidden`** (si no, no-op total); cierra reportes `new→resolved`; 1 fila en `admin_actions` (`comment_restore|comment_keep_hidden|comment_delete`); `revoke execute from public, anon`.
- Cola admin: `useAdminReports` devuelve `reports: ({kind:'property'} | {kind:'comment'})[]` **mezclados por fecha** desde dos queries con fail-soft cruzado (si una fuente falla, `error` seteado y la otra se muestra); `useResolveReport({kind:'comment'})` → EF `moderate-comment`.

## Avisos (`20260910300001`, ver [[notificaciones]])
`comment_on_my_property` (al publicador; insert `visible` o liberación `held→visible`; nunca si el autor es el publicador; un aviso por comentario en toda su vida vía índice parcial `(user_id, related_entity_id, type)`) · `comment_hidden` (al autor; por transición `→hidden`, cada ciclo avisa; `data.reason='oculto_por_moderacion'` porque el trigger no distingue gestor de auto-hide) · `admin_comment_report` (a admins vivos al abrir un ciclo de reportes `new`; dedupe en el cuerpo, se reabre tras resolver; nunca al actor). Nada para `held_for_review`.

## Cliente (`mobile/src/features/comments/`)
`useComments` keyset `(created_at desc, id desc)` con `LIMIT+1` para `has_more`, `.eq('property_id')` + `.neq('status','deleted')` explícitos (la RLS decide el resto), identidad vía `agent_public_profiles` (`full_name`/`profile_photo_url`; null → «Usuario eliminado»); `usePostComment` **sin optimismo** (el status lo decide el servidor; el llamador hace `prepend`); `useHideComment.set_status` cubre ocultar/restaurar/borrado propio; `useReportComment` calco de `useReportProperty` sin guard de autor en cliente (lo dice el 42501). Hoja = dirección **A** del preview (compacta, 60 %, input anclado, `Modal` + `KeyboardAvoidingView` + safe-area-context); entrada = 4.º botón de `ActionButtons` con `comment_count`. Fuera: rail del feed (#290) y toast tras ocultar (#291).

## Privacidad
Comentar es un **acto público** que da al agente identidad + timestamp de un no-lead: decisión Q10 registrada en [[privacidad-datos]].

## Relacionados
[[moderacion]] · [[notificaciones]] · [[privacidad-datos]] · [[rls-seguridad]] · [[design-system]]
