-- Migración 0009 — Seed mínimo: versión vigente inicial de Términos y Aviso de Privacidad
-- Propósito: dejar una versión 1.0 vigente de cada documento legal para que el flujo de
-- consentimiento (user_consents) tenga a qué apuntar desde el día 1. Idempotente.
-- NO se siembran usuarios admin reales (se crean por seed directo a auth o invitación, PRD §29).

insert into public.terms_versions (doc_type, version, content, is_current, effective_from)
select 'terms', '1.0',
       'Términos y Condiciones de Urbea — versión inicial (placeholder, reemplazar por el texto legal definitivo).',
       true, now()
where not exists (
  select 1 from public.terms_versions where doc_type = 'terms' and version = '1.0'
);

insert into public.terms_versions (doc_type, version, content, is_current, effective_from)
select 'privacy', '1.0',
       'Aviso de Privacidad de Urbea (LFPDPPP) — versión inicial (placeholder, reemplazar por el texto legal definitivo).',
       true, now()
where not exists (
  select 1 from public.terms_versions where doc_type = 'privacy' and version = '1.0'
);
