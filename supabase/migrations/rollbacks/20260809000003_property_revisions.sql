-- Rollback: 20260809000003_property_revisions.sql
-- Elimina la tabla property_revisions (cascade sobre sus índices/policies/trigger) y el
-- enum property_revision_status. Reversible por completo: la tabla es nueva, no hay data-fix
-- de por medio y ningún otro objeto del esquema depende del enum.

drop table if exists public.property_revisions;
drop type if exists property_revision_status;
