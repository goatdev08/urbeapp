-- Rollback de 20260822000002_moderate_ad_atomic.sql (subtarea #208.1).
--
-- La migración es puramente aditiva: crea UNA función nueva y no toca ninguna
-- fila, columna, constraint ni trigger existente. Revertirla es simétrico —
-- basta con eliminar la función.
--
-- ⚠️ Efecto de correr esto en un entorno donde la Edge Function moderate-ad ya
-- esté desplegada: la EF empezará a devolver 500 DB_ERROR en cada moderación
-- (PGRST202, función no encontrada). NO se pierde ningún dato ni se revierte
-- ninguna moderación ya aplicada — los anuncios ya aprobados siguen activos y
-- su rastro en admin_actions queda intacto, porque lo escribió el trigger, no
-- esta función. El orden seguro para revertir de verdad es: primero volver la
-- EF a su versión anterior (o desplegar la app sin la pantalla), después
-- correr esto.

drop function if exists public.moderate_ad_atomic(uuid, text, text, uuid);
