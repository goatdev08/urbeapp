-- Migración 20260709000001 — Set: teléfonos REALES de los owners demo
-- Propósito: los owners de "Tu Casa con Vlad" (Ramos y Vlad) fueron sembrados
-- vía seed-clientes.sql y quedaron con el placeholder +523312345678 (de la
-- migración 20260630000001). El CTA "Contactar por WhatsApp" del detalle abre
-- un número que no recibe mensajes. Esta migración pone el número REAL de cada
-- owner (confirmado por el cliente 2026-07-07) para habilitar el contacto real
-- en la demo. Implementa P1 de .taskmaster/docs/exploraciones/029-*.
--
-- Alcance: SOLO public.users.phone de los dos IDs de owner. NO toca
-- auth.users.phone (el login es email/password; no hay phone-auth/OTP → un
-- UPDATE aquí no dispara ningún flujo de GoTrue). NO toca otras columnas ni
-- otras cuentas.
-- Idempotente: la guarda `phone IS DISTINCT FROM <real>` hace que una segunda
-- ejecución matchee 0 filas (no-op). `IS DISTINCT FROM` trata NULL como valor
-- distinto, así que también cubre la transición desde NULL o placeholder.

UPDATE public.users
  SET phone = '+523315637152'
WHERE id = '1a000000-0000-0000-0000-0000000000a1'  -- Ramos (s.ramos2308@gmail.com)
  AND phone IS DISTINCT FROM '+523315637152';

UPDATE public.users
  SET phone = '+523335785799'
WHERE id = '1a000000-0000-0000-0000-0000000000a2'  -- Vlad (vladimiryeh@gmail.com)
  AND phone IS DISTINCT FROM '+523335785799';
