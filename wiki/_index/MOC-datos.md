---
tipo: moc
dominio: datos
---

# 🧭 MOC Datos

La base de datos de Urbea. Detalle completo en [[db-schema-map]].

> 20 tablas · ~20 enums · ~65 políticas RLS · migraciones `0001`–`0010` (aplicadas a `urbea-app`).

## Por dominio
- **Identidad/Legal:** users, user_preferences, terms_versions, user_consents, account_deletion_requests → [[roles-y-permisos]], [[legal-consentimientos]]
- **Inmobiliarias/Agentes:** agencies, agency_members, agency_invitation_tokens, agent_applications, agent_interest_submissions → [[inmobiliarias-y-agentes]]
- **Propiedades/Video:** properties, property_videos → [[propiedades-y-video]]
- **Engagement/CRM:** likes, saves, leads, lead_origin_properties → [[feed-vertical-video]], [[crm-leads]]
- **Analítica/Moderación/Auditoría:** events_raw, property_reports, notifications, admin_actions → [[moderacion]], [[notificaciones]], [[rls-seguridad]]

## Seguridad
- [[rls-seguridad]] — helpers en schema `private`, grants column-level.

Ver también: [[MOC-arquitectura]] · [[MOC-producto]]
