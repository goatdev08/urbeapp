-- Rollback de 20260823000003_suspend_agency_admin.sql (subtarea #211.1).
--
-- La migración es puramente aditiva: crea UNA función nueva y no toca ninguna
-- fila, columna, constraint ni trigger existente. Revertirla es simétrico —
-- basta con eliminar la función.
--
-- ⚠️ Efecto de correr esto en un entorno donde la Edge Function suspend-agency
-- ya esté desplegada: la EF empezará a devolver 500 DB_ERROR en cada
-- suspensión/reactivación (PGRST202, función no encontrada). NO se pierde
-- ningún dato ni se revierte ninguna suspensión ya aplicada — las
-- organizaciones ya suspendidas siguen suspendidas y su rastro en
-- admin_actions queda intacto, porque lo escribió el trigger, no esta
-- función. El orden seguro para revertir de verdad es: primero volver la EF a
-- su versión anterior (o desplegar la app sin la pantalla), después correr
-- esto.

drop function if exists public.set_agency_status_atomic(uuid, text, uuid);
