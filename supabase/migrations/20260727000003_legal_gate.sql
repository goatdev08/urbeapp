-- Migración 0034 — Gate de consentimiento legal versionado (#72.6, PRD §5.5)
--
-- Propósito: responder, del lado del SERVIDOR, a "¿este usuario ya aceptó la versión
--   VIGENTE de cada documento legal?". Sin esta respuesta el cliente tendría que
--   reimplementar la comparación versión-aceptada vs versión-vigente, y un bug ahí
--   significa operar la plataforma bajo términos que nadie aceptó — justo lo que la
--   LFPDPPP exige poder demostrar.
--
-- ALCANCE REAL: el schema pesado YA EXISTE desde 0004. `terms_versions` ya garantiza
--   una sola versión vigente por doc_type (índice único parcial
--   terms_versions_one_current_per_doctype) y `user_consents` ya es un historial
--   append-only. Aquí NO se crean tablas: solo la lógica del gate y el cierre del
--   candado de inmutabilidad.

-- ── 1) La pregunta del gate ─────────────────────────────────────────────────
-- ⚠️ `doc_type` y `consent_type` son enums DISTINTOS que comparten las etiquetas
-- 'terms' y 'privacy'. Postgres no los compara entre sí: hay que castear a text.
-- Sin el cast esto no compila, y con un cast mal puesto compararía siempre falso y
-- el gate pediría re-aceptar para siempre.
--
-- `security invoker` (el default) a propósito, NO definer: la RLS de user_consents ya
-- restringe a las filas del propio usuario, así que ejecutar con los privilegios del
-- llamante es MENOS privilegio para el mismo resultado. Un DEFINER aquí solo agregaría
-- superficie. El `where uc.user_id = auth.uid()` es explícito de todos modos: si algún
-- día alguien cambia la política, la función no empieza a filtrar en silencio.
create or replace function public.pending_legal_consents()
returns table (doc_type text, version text, terms_version_id uuid)
language sql
stable
set search_path = public
as $$
  select tv.doc_type::text, tv.version, tv.id
  from public.terms_versions tv
  where tv.is_current
    and not exists (
      select 1
      from public.user_consents uc
      where uc.user_id = auth.uid()
        and uc.terms_version_id = tv.id
        and uc.consent_type::text = tv.doc_type::text
    )
  order by tv.doc_type::text;
$$;

comment on function public.pending_legal_consents() is
  'Documentos legales vigentes que el usuario actual NO ha aceptado en su versión vigente. Vacío = al día (#72.6, PRD §5.5).';

-- Defensa en profundidad, igual que properties_within_radius (0021): la función no
-- tiene por qué ser invocable por un cliente sin sesión.
revoke execute on function public.pending_legal_consents() from public, anon;
grant execute on function public.pending_legal_consents() to authenticated;

-- ── 2) Inmutabilidad real del historial de consentimientos ──────────────────
-- Hoy `user_consents` es append-only SOLO por ausencia de políticas RLS de UPDATE y
-- DELETE — pero `authenticated` sí tiene los GRANTS. O sea: el candado depende de que
-- nadie agregue nunca una política permisiva por descuido. Para un registro de
-- auditoría LFPDPPP eso es demasiado frágil; se revoca el privilegio de tabla para que
-- haya dos candados independientes.
revoke update, delete on public.user_consents from authenticated;

-- 🔒 Y el tercer agujero, que no tapa ninguno de los dos anteriores: TRUNCATE NO pasa
-- por RLS, y Supabase lo concede de fábrica (pg_default_acl da el bit D a anon y
-- authenticated en toda tabla nueva de public). Sin este revoke, cualquiera con la anon
-- key podía vaciar el historial COMPLETO de consentimientos de todos los usuarios —
-- justo el registro que esta migración dice estar blindando. Lo encontró el guardián
-- al auditar el GREEN. El barrido de las otras tablas de public sigue en la tarea #92.
revoke truncate on public.user_consents from anon, authenticated;
