-- Rollback 20260905300002 — WhatsApp del perfil público resuelto por RPC (#255)
--
-- 🔴 ORDEN (§0.5): revertir el CLIENTE (OTA) ANTES de correr este rollback.
-- ProfileActions.tsx llama esta RPC al pulsar el botón; si la función
-- desaparece primero, el tap falla con 42883 (function does not exist) y el
-- usuario ve un botón que nunca abre WhatsApp en vez de un contact exitoso.
--
-- No destructivo: no hay datos que perder, solo la función se va. Ninguna
-- otra tabla/vista/RPC depende de ella.
drop function if exists public.whatsapp_phone_for_profile(uuid);
