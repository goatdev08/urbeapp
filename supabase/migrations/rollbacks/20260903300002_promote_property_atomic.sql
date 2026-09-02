-- Rollback: 20260903300002_promote_property_atomic.sql (tarea #213, subtarea 213.2)
--
-- No destructivo: solo elimina la función. Las promociones YA creadas siguen
-- en `ads` como filas normales (el resto de la épica —moderación, métricas,
-- rollup, expiración— opera por ad_id/agency_id y no las distingue); lo único
-- que se pierde es la capacidad de crear promociones NUEVAS.
--
-- 🔴 ORDEN respecto al cliente: el OTA que quita el botón «Promocionar» va
-- PRIMERO. Un cliente que llame esta RPC tras revertirla recibe 42883.
--
-- Re-ejecutable (if exists).

drop function if exists public.promote_property_atomic(uuid);
