---
tipo: concepto
dominio: legal
estado: vivo
fuentes: [docs/PRD.md, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/0004_user_profile_legal.sql, supabase/migrations/0009_seed_terms.sql]
actualizado: 2026-06-17
---

# Legal y consentimientos

> Términos, aviso de privacidad y consentimientos (LFPDPPP, México). En la demo, lo mínimo.

## Modelo de datos (migraciones 0004 + 0009)
- **`terms_versions`** — versionado legal inmutable. `doc_type` (terms | privacy); **1 versión vigente por tipo**. Seed v1 (placeholder) en migración `0009`.
- **`user_consents`** — auditoría **inmutable** de consentimientos. `consent_type` (**terms, privacy, age, whatsapp**).
- **`account_deletion_requests`** — baja con gracia. `status` (pending, confirmed, completed, cancelled); 15 días de gracia (soft→hard delete).

## Flujo (demo)
En el registro/canje de código se aceptan **terms + privacy + whatsapp** (consentimiento de contacto) → filas en `user_consents`. La **baja de cuenta** (15 días) → **diferido**.

## Reglas / gotchas
- `user_consents` es append-only (auditoría); si cambia una versión de términos, se requiere re-aceptación.
- Consentimiento WhatsApp es obligatorio porque el contacto sale por ahí → [[crm-leads]].

## Detalle exhaustivo
- `docs/PRD.md` (cumplimiento LFPDPPP, retención, anonimización) · migraciones `0004` / `0009` · [[db-schema-map]]

## Relacionados
[[onboarding-y-preferencias]] · [[roles-y-permisos]] · [[crm-leads]]
