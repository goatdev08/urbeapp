-- Migración 0001 — Extensiones, enums de dominio y función compartida set_updated_at
-- Propósito: dejar listas las extensiones (PostGIS, pg_trgm, citext) y todos los tipos
-- enumerados estables del dominio. Catálogos amplios (notifications.type, events_raw.event_type,
-- admin_actions.action_type) NO usan enum: se modelan como text para no migrar por cada valor nuevo.
-- Stack: Supabase Postgres 17. Las extensiones viven en el esquema `extensions` (está en search_path).

-- ── Extensiones ───────────────────────────────────────────────────────────────
create extension if not exists postgis  with schema extensions;  -- geografía: mapa/feed por radio
create extension if not exists pg_trgm  with schema extensions;  -- búsqueda de texto (GIN trgm)
create extension if not exists citext   with schema extensions;  -- emails/nombres case-insensitive
-- pgcrypto y uuid-ossp ya están instaladas; gen_random_uuid() es nativo de PG17.

-- ── Enums de dominio ──────────────────────────────────────────────────────────
-- Se crean de forma idempotente para poder re-aplicar la migración sin error.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum ('user', 'agent', 'admin');
  end if;
  if not exists (select 1 from pg_type where typname = 'doc_type') then
    create type doc_type as enum ('terms', 'privacy');
  end if;
  if not exists (select 1 from pg_type where typname = 'consent_type') then
    create type consent_type as enum ('terms', 'privacy', 'age', 'whatsapp');
  end if;
  if not exists (select 1 from pg_type where typname = 'deletion_request_reason') then
    create type deletion_request_reason as enum
      ('not_useful', 'privacy_concern', 'duplicate_account', 'too_many_notifications', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'deletion_request_status') then
    create type deletion_request_status as enum ('pending', 'confirmed', 'completed', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'agency_status') then
    create type agency_status as enum
      ('pending_approval', 'approved', 'active', 'suspended', 'rejected');
  end if;
  if not exists (select 1 from pg_type where typname = 'agency_member_role') then
    create type agency_member_role as enum ('owner', 'agent');
  end if;
  if not exists (select 1 from pg_type where typname = 'agency_member_status') then
    create type agency_member_status as enum ('active', 'removed');
  end if;
  if not exists (select 1 from pg_type where typname = 'agent_application_type') then
    create type agent_application_type as enum ('independent', 'under_agency');
  end if;
  if not exists (select 1 from pg_type where typname = 'agent_application_status') then
    create type agent_application_status as enum ('pending', 'approved', 'rejected');
  end if;
  if not exists (select 1 from pg_type where typname = 'agent_interest_source') then
    create type agent_interest_source as enum ('landing', 'app');
  end if;
  if not exists (select 1 from pg_type where typname = 'agent_interest_status') then
    create type agent_interest_status as enum ('new', 'contacted', 'archived');
  end if;
  if not exists (select 1 from pg_type where typname = 'property_type') then
    create type property_type as enum ('casa', 'departamento', 'local', 'oficina', 'terreno');
  end if;
  if not exists (select 1 from pg_type where typname = 'operation_type') then
    create type operation_type as enum ('rent', 'sale', 'both');
  end if;
  if not exists (select 1 from pg_type where typname = 'property_status') then
    -- 6 estados de ciclo de vida (MVP simplificado de los 16 del PRD) + suspended (moderación)
    create type property_status as enum
      ('draft', 'pending_review', 'needs_changes', 'active', 'paused', 'closed', 'suspended');
  end if;
  if not exists (select 1 from pg_type where typname = 'property_closed_reason') then
    create type property_closed_reason as enum ('rented', 'sold', 'withdrawn', 'expired');
  end if;
  if not exists (select 1 from pg_type where typname = 'property_video_status') then
    create type property_video_status as enum ('uploading', 'processing', 'ready', 'failed');
  end if;
  if not exists (select 1 from pg_type where typname = 'lead_status') then
    create type lead_status as enum
      ('new', 'contacted', 'in_progress', 'visit_scheduled', 'closed_won', 'closed_lost', 'discarded');
  end if;
  if not exists (select 1 from pg_type where typname = 'property_report_reason') then
    create type property_report_reason as enum
      ('not_exist_fraud', 'misleading', 'false_price', 'wrong_address', 'inappropriate', 'duplicate', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'property_report_status') then
    create type property_report_status as enum ('new', 'reviewing', 'resolved', 'dismissed');
  end if;
end$$;

-- ── Función compartida: set_updated_at (trigger atómico permitido por lineamientos §9.1) ──
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger BEFORE UPDATE: mantiene updated_at. Atómico, sin side effects (lineamientos §9.1).';
