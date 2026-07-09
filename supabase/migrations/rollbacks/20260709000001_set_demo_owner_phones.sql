-- Rollback 20260709000001 — revierte los teléfonos reales de los owners demo
-- al placeholder previo (+523312345678, el estado tras la migración
-- 20260630000001). Ejecutar ANTES de borrar la migración del historial.
--
-- Solo revierte las filas que ESTA migración modificó: match exacto de id +
-- teléfono real seteado, para no pisar un teléfono que el usuario haya cambiado
-- después por otra vía.

UPDATE public.users
  SET phone = '+523312345678'
WHERE id = '1a000000-0000-0000-0000-0000000000a1'  -- Ramos
  AND phone = '+523315637152';

UPDATE public.users
  SET phone = '+523312345678'
WHERE id = '1a000000-0000-0000-0000-0000000000a2'  -- Vlad
  AND phone = '+523335785799';
