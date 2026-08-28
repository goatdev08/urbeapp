-- Rollback — Constraint: property_reports_other_requires_text

alter table public.property_reports
  drop constraint if exists property_reports_other_requires_text;
