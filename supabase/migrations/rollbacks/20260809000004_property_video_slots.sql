-- Rollback: 20260809000004_property_video_slots.sql
-- Elimina la tabla property_video_slots (cascade sobre su índice/policy). Reversible
-- por completo: la tabla es nueva, ningún otro objeto del esquema depende de ella
-- salvo la RPC publish_property_atomic (20260809000005), que debe revertirse ANTES
-- (o en el mismo cambio) para que el INSERT que referencia esta tabla no quede huérfano.

drop table if exists public.property_video_slots;
