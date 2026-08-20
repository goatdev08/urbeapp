-- Rollback: 20260820000005_create_ad_campaign_atomic.sql (tarea #191)
--
-- ⚠️ El `drop column created_by_user_id` es DESTRUCTIVO: borra quién creó cada
-- campaña self-service, y ese dato no está en ninguna otra parte (a propósito:
-- admin_actions no lo registra porque su admin_id NOT NULL solo admite
-- admins). Si esto se revierte con campañas ya creadas, el rastro se pierde.
--
-- El OTA del cliente va PRIMERO si se revierte: el wizard llama a la RPC y sin
-- ella recibiría 42883.
--
-- Re-ejecutable (if exists).

drop function if exists public.create_ad_campaign_atomic(uuid, text, ad_cta_type, text, jsonb, text, integer);

alter table public.ads
  drop column if exists created_by_user_id;
