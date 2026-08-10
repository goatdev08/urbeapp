-- Migración 20260809000008 — properties_insert: solo status='draft' (#127, hallazgo 7)
--
-- Origen: subtarea 73.2 · Detectado por: code review PR #56. La policy
-- properties_insert (última versión: 20260805000009) exigía owner =
-- auth.uid() + rol agent|admin + membresía de agencia, pero NO restringía la
-- columna `status`: el literal 'draft' que manda el cliente (useDraftAutosave)
-- era lo ÚNICO que hacía que la fila naciera como borrador. Cualquier caller
-- con la anon key y un JWT de agente podía crear propiedades 'active' públicas
-- por PostgREST, sin pasar por moderación — rompiendo la invariante central
-- del PRD §14.2 ("toda publicación pasa por revisión antes de aparecer").
--
-- El ÚNICO INSERT legítimo de cliente sobre `properties` es el autosave de
-- borradores (§14.1). El flujo de publicación entra por la EF publish-property
-- → RPC publish_property_atomic (SECURITY DEFINER con service_role, no evalúa
-- esta policy) — restringir a 'draft' no lo toca.
--
-- Idempotente: drop policy if exists + create policy.
-- Rollback: supabase/migrations/rollbacks/20260809000008_properties_insert_draft_only.sql
-- Tests: supabase/tests/40_properties_insert_draft_only_test.sql

drop policy if exists properties_insert on public.properties;
create policy properties_insert on public.properties for insert to authenticated
  with check (
    owner_user_id = (select auth.uid())
    and private.current_user_role() in ('agent', 'admin')
    and (agency_id is null or private.agency_role_of(agency_id) is not null)
    -- #127: el cliente solo puede crear BORRADORES — publicar pasa por la
    -- RPC (service_role) y la moderación decide cuándo algo se vuelve visible.
    and status = 'draft'
  );

comment on policy properties_insert on public.properties is
  '#127: agrega status=''draft'' al WITH CHECK — el único INSERT de cliente '
  'legítimo es el autosave de borradores (§14.1); sin esta cláusula cualquier '
  'caller con anon key + JWT de agente creaba propiedades active sin moderación. '
  'El flujo de publicación entra por publish_property_atomic (SECURITY DEFINER), '
  'que no evalúa esta policy.';
