-- Rollback de 20260901000002 — restaura el CHECK original de 20260816000005
-- (6–30). ⚠️ Solo si se revierte TAMBIÉN el rango en cliente/mint/webhook:
-- con el rango nuevo vivo, este rollback re-introduce el webhook 500.

alter table public.ad_creatives
  drop constraint if exists ad_creatives_duration_seconds_check;

alter table public.ad_creatives
  add constraint ad_creatives_duration_seconds_check
  check (duration_seconds is null or duration_seconds between 6 and 30);
