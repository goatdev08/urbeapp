-- Rollback: 20260809000007_moderate_property_atomic.sql
--
-- Elimina la RPC. La EF moderate-property que dependía de ella debe
-- redesplegarse en la versión previa (escrituras sueltas vía
-- make_property_updater/make_revision_resolver/make_admin_action_recorder) al
-- aplicar este rollback — RPC y EF viajan juntas en ambos sentidos.

drop function if exists public.moderate_property_atomic(
  uuid, uuid, text, jsonb, jsonb, text, text, jsonb, uuid, text, text
);
