-- Rollback de 20260902100001_advertising_requests.sql (subtarea #221.1).
--
-- DROPEA los 3 objetos NUEVOS que creó esa migración (tabla + 2 funciones).
-- Se dropea la tabla COMPLETA y no se "vacía" ni se deja a medias: una tabla
-- con RLS pero sin policies queda en deny-total (o, peor, sin RLS quedaría
-- expuesta), y unas RPCs con cuerpo vacío devolverían éxito sin hacer nada —
-- fallar en silencio es peor que no existir (mismo criterio que el rollback de
-- 20260828000004/20260828000005).
--
-- ⚠️ LO QUE ESTE ROLLBACK **NO** DESHACE, a propósito:
--   - agencies.can_advertise / advertiser_category ya encendidos por una
--     aprobación: son estado de negocio legítimo de la organización, escrito
--     por public.set_org_advertising_atomic (que esta migración solo REUSA y
--     no toca). Apagarlos aquí le quitaría la capacidad comercial a un
--     anunciante vivo. Si hace falta revertir uno, se hace caso por caso con
--     set_org_advertising_atomic(<agency>, false, null).
--   - Las filas ya escritas en public.admin_actions (auditoría append-only,
--     20260604000007) ni en public.notifications: son historia, no esquema.
--     Quedan apuntando a solicitudes que ya no existen (entity_id /
--     related_entity_id huérfanos, sin FK — es el diseño de ambas tablas).
--
-- No revoca ningún grant preexistente: los únicos grants/revokes de la
-- migración son sobre objetos que este archivo dropea.

drop function if exists public.resolve_advertising_request(uuid, boolean, text);
drop function if exists public.create_advertising_request(text);

-- cascade: se lleva el índice único parcial y la policy de la propia tabla
-- (no hay ninguna vista ni FK apuntando a advertising_requests).
drop table if exists public.advertising_requests cascade;
