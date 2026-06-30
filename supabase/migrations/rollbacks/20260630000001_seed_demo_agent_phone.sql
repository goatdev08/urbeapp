-- Rollback 20260630000001 — revierte el seed de phone en agentes demo.
-- Ejecutar ANTES de borrar la migración 20260630000001 del historial.
-- Solo afecta las filas que esta migración pobló: agentes cuyo phone sea
-- exactamente el número de prueba sembrado. No toca teléfonos que puedan
-- haber sido actualizados posteriormente por el usuario.

UPDATE public.users
  SET phone = NULL
WHERE role = 'agent'
  AND phone = '+523312345678';
