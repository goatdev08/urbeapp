---
tipo: concepto
dominio: producto
estado: vivo
fuentes: [docs/PRD.md §7, docs/PRD-MVP-demo.md]
codigo: [supabase/migrations/0004_user_profile_legal.sql]
actualizado: 2026-06-17
---

# Onboarding y preferencias

> Lo mínimo para que el perfil y las publicaciones tengan sentido.

## Modelo de datos (migración 0004)
- **`user_preferences`** — 1:1 con `users`. Onboarding del buscador: `location` (PostGIS) + `radius` + filtros (tipo, precio, recámaras…). Pensado para personalizar el feed.

## Flujo (demo)
Onboarding **mínimo** del agente: **nombre + foto**. La inmobiliaria queda **fijada por el token** que canjea ([[inmobiliarias-y-agentes]]). Las preferencias de feed del buscador (ubicación + filtros) → **diferido** (el feed de la demo usa filtros básicos, ver [[busqueda-y-filtros]]).

## Reglas / gotchas
- En la demo no se captura ubicación de buscador en onboarding; el radio progresivo del PRD queda para después.
- Consentimientos legales se aceptan en el registro → [[legal-consentimientos]].

## Detalle exhaustivo
- `docs/PRD.md` §7 (onboarding completo: ubicación obligatoria + personalización) · migración `0004` · [[db-schema-map]]

## Relacionados
[[roles-y-permisos]] · [[inmobiliarias-y-agentes]] · [[legal-consentimientos]] · [[feed-vertical-video]]
