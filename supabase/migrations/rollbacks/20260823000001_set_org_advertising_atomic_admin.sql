-- Rollback de 20260823000001_set_org_advertising_atomic_admin.sql (subtarea #209.1).
--
-- La migración es puramente aditiva: crea UN overload nuevo de 4 argumentos y
-- no toca la RPC de 3 argumentos existente (20260815000002/20260816000003) ni
-- ninguna fila, columna, constraint o trigger. Revertirla es simétrico --
-- basta con eliminar el overload nuevo, dejando intacta la RPC de 3
-- argumentos que Studio/CLI sigue usando.
--
-- ⚠️ Efecto de correr esto en un entorno donde la Edge Function
-- set-org-advertising ya esté desplegada: la EF empezará a devolver 500
-- DB_ERROR en cada llamada (PGRST202, función no encontrada con esa firma).
-- NO se pierde ningún dato ni se revierte ningún cambio de can_advertise ya
-- aplicado -- las agencias que ya tienen el modo comercial encendido/apagado
-- siguen así, y su rastro en admin_actions queda intacto (lo escribe la RPC
-- de 3 argumentos, no este overload). El orden seguro para revertir de
-- verdad es: primero volver la EF a su versión anterior (o desplegar la app
-- sin la pantalla), después correr esto.

drop function if exists public.set_org_advertising_atomic(uuid, boolean, public.advertiser_category, uuid);
