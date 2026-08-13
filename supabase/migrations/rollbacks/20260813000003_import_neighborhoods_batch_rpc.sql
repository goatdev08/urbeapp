-- Rollback de 20260813000003_import_neighborhoods_batch_rpc.sql (tarea #157.4)
drop function if exists public.import_neighborhoods_batch(jsonb);
