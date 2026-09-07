-- Rollback: 20260906400002_reassign_lead_atomic.sql (subtarea 269.2)
--
-- No destructivo. Lo que YA ocurrió es un HECHO de negocio y se queda:
--   · Los leads ya reasignados conservan agent_id nuevo (revertirlos borraría a
--     quién le pertenece hoy la conversación, que es un hecho de negocio, no un
--     efecto secundario de la migración).
--   · Las filas de admin_actions (action_type='lead_reassigned') y las
--     notificaciones ya entregadas (type='lead_reassigned') siguen en su tabla:
--     son filas normales, ningún componente las borra al perder la RPC.
-- Lo que sí desaparece: la capacidad de reasignar leads nuevos.
--
-- 🔴 ORDEN respecto al cliente (§0.5): si algún build ya llama esta RPC, el OTA
-- que quita esa acción del CRM va PRIMERO. Tras revertir, la llamada recibe
-- 42883 (function does not exist).
--
-- Re-ejecutable (if exists).

drop function if exists public.reassign_lead_atomic(uuid, uuid);

drop index if exists public.notifications_lead_reassigned_anchor_idx;
