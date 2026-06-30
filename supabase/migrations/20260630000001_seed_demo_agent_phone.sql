-- Migración 20260630000001 — Seed: poblar phone en agentes demo
-- Propósito: la EF contact-agent devuelve 400 AGENT_PHONE_MISSING cuando
-- public.users.phone IS NULL. El flujo de invitación nunca captura teléfono,
-- así que los agentes demo quedan con phone NULL. Esta migración siembra un
-- número MX de prueba (+52 33 = Guadalajara) para habilitar el flujo
-- WhatsApp E2E en la demo.
--
-- Alcance: solo usuarios con role='agent' y phone IS NULL.
-- Idempotente: el WHERE phone IS NULL garantiza que una segunda ejecución no
-- sobreescribe un teléfono ya registrado.

UPDATE public.users
  SET phone = '+523312345678'
WHERE phone IS NULL
  AND role = 'agent';
