-- Rollback: 20260807000004_lead_scoring.sql
-- Deshace los triggers/funciones de scoring y las columnas leads.score/leads.level.
-- Nota: el enum lead_temperature NO se elimina (un tipo con columnas que lo referenciaban
-- puede quedar huérfano de forma segura al hacer DROP COLUMN primero; igual se deja el DROP
-- TYPE explícito al final, solo tiene efecto si ninguna otra columna lo usa). Mismo criterio
-- que 20260701000001: no se resetean datos derivados a 0 solo por revertir el mecanismo.

drop trigger if exists trg_recompute_lead_levels on public.app_config;
drop function if exists private.recompute_lead_levels();

drop trigger if exists trg_lead_score_likes on public.likes;
drop trigger if exists trg_lead_score_saves on public.saves;
drop function if exists private.adjust_lead_score();

drop trigger if exists trg_init_lead_score on public.leads;
drop function if exists private.init_lead_score();

drop function if exists private.compute_lead_level(integer);

alter table public.leads
  drop column if exists score,
  drop column if exists level;

drop type if exists lead_temperature;
