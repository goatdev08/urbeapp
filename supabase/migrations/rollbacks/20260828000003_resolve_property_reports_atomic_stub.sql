-- Rollback: 20260828000003_resolve_property_reports_atomic_stub.sql (subtarea #220.3)
-- Quita la función resolve_property_reports_atomic (STUB o GREEN, misma firma).
-- No toca ninguna tabla -- esta migración solo creó la función. 100% reversible.

drop function if exists public.resolve_property_reports_atomic(uuid, uuid, text, text);
