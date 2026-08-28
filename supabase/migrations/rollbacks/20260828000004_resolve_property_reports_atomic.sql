-- Rollback: 20260828000004_resolve_property_reports_atomic.sql (subtarea #220.3).
-- Elimina la función por completo. 20260828000004 es la ÚNICA migración que la
-- crea (el stub no-op del RED, 20260828000003, se eliminó del árbol antes de
-- integrar: era andamio de test, no un artefacto que deba viajar a producción).
--
-- 🔴 POR QUÉ UN DROP Y NO UN CUERPO NO-OP: un rollback que dejara la función
-- existiendo pero vacía haría que la EF moderate-property llamara la RPC,
-- recibiera ÉXITO y no pasara nada — los reportes quedarían sin resolver en
-- silencio y el admin vería la acción como aplicada. Con el drop, la llamada
-- falla ruidoso (42883 → DB_ERROR en la EF), que es el comportamiento correcto
-- ante un rollback: visible, no silencioso.
--
-- Idempotente: `if exists`. No toca moderate_property_atomic (función hermana,
-- #218) ni ningún otro objeto.

drop function if exists public.resolve_property_reports_atomic(uuid, uuid, text, text);
