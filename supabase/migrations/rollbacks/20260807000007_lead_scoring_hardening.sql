-- Rollback: 20260807000007_lead_scoring_hardening.sql
-- Restaura private.compute_lead_level, private.recompute_lead_levels (+ su trigger) y el
-- trigger set_updated_at de public.leads a sus definiciones de 20260807000004 (sin la
-- guarda jsonb_typeof, fallback 15/30, trigger solo "after update", set_updated_at sin
-- lista de columnas).

create or replace function private.compute_lead_level(p_score integer)
returns lead_temperature
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tibio    numeric;
  v_caliente numeric;
begin
  select (value::text)::numeric into v_tibio
    from public.app_config where key = 'lead_score_threshold_tibio';
  select (value::text)::numeric into v_caliente
    from public.app_config where key = 'lead_score_threshold_caliente';

  v_tibio    := coalesce(v_tibio, 15);
  v_caliente := coalesce(v_caliente, 30);

  if p_score >= v_caliente then
    return 'caliente';
  elsif p_score >= v_tibio then
    return 'tibio';
  else
    return 'frio';
  end if;
end;
$$;

create or replace function private.recompute_lead_levels()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.value is not distinct from old.value then
    return new;
  end if;

  update public.leads
     set level = private.compute_lead_level(score)
   where deleted_at is null;

  return new;
end;
$$;

drop trigger if exists trg_recompute_lead_levels on public.app_config;
create trigger trg_recompute_lead_levels
  after update on public.app_config
  for each row
  when (new.key in ('lead_score_threshold_tibio', 'lead_score_threshold_caliente'))
  execute function private.recompute_lead_levels();

drop trigger if exists set_updated_at on public.leads;
create trigger set_updated_at before update on public.leads
  for each row execute function public.set_updated_at();
