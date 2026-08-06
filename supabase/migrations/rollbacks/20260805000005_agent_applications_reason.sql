-- Rollback — elimina la columna reason de public.agent_applications.
alter table public.agent_applications drop column if exists reason;
