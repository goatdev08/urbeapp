-- Rollback: 20260809000008_properties_insert_draft_only.sql
--
-- Restaura la policy properties_insert EXACTA de 20260805000009 (sin la
-- cláusula status='draft') — reabre el hueco documentado en #127 hallazgo 7:
-- un cliente con anon key + JWT de agente vuelve a poder crear propiedades
-- con cualquier status por PostgREST.

drop policy if exists properties_insert on public.properties;
create policy properties_insert on public.properties for insert to authenticated
  with check (
    owner_user_id = (select auth.uid())
    and private.current_user_role() in ('agent', 'admin')
    and (agency_id is null or private.agency_role_of(agency_id) is not null)
  );
