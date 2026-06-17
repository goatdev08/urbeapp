-- Rollback 0003
alter table public.users drop constraint if exists users_agency_id_fkey;
drop table if exists public.agent_interest_submissions cascade;
drop table if exists public.agent_applications cascade;
drop table if exists public.agency_members cascade;
drop table if exists public.agency_invitation_tokens cascade;
drop table if exists public.agencies cascade;
