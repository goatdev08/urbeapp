-- Rollback de 20260727000001_mx_catalog.sql (#72.1)
--
-- Orden: municipios primero (tienen la FK), luego estados.
-- `restrict` en la FK haría fallar el drop de mx_states si quedaran municipios vivos,
-- así que el orden no es cosmético.
--
-- ⚠️ Si ya corrió 72.2, public.users tiene FKs a estas tablas: este rollback fallará
-- hasta que se revierta también 20260727000002_registro_constraints.sql. Es intencional
-- — es la señal de que estás revirtiendo en el orden equivocado, no un bug.

drop policy if exists mx_municipalities_select on public.mx_municipalities;
drop policy if exists mx_states_select         on public.mx_states;

drop index if exists public.mx_municipalities_state_name_idx;

drop table if exists public.mx_municipalities;
drop table if exists public.mx_states;
