-- Rollback 0009 — elimina el seed legal inicial.
delete from public.terms_versions where doc_type in ('terms', 'privacy') and version = '1.0';
