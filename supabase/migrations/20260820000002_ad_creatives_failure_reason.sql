-- Migración 20260820000002 — ad_creatives.failure_reason (tarea #189).
--
-- POR QUÉ. El adapter make_ad_creative_status_updater RECIBÍA un `reason_code`
-- y escribía solo `{ status: 'failed' }`: lo descartaba, porque no había dónde
-- ponerlo. Su hermano de property_videos persiste `failure_reason` desde
-- siempre (clients.ts, make_video_status_updater) — la asimetría era el
-- defecto, no una decisión.
--
-- Esa pérdida es lo que forzó al cliente a ADIVINAR: useAdUpload infería "por
-- eliminación, este 'failed' es un fallo de transcodificación" y mostraba ese
-- mensaje SIEMPRE. La inferencia solo se sostenía mientras el pre-flight fuera
-- fail-closed ante duración ausente — así que el mensaje equivocado y el
-- bloqueo del anunciante con picker Android viejo eran el MISMO defecto, y se
-- arreglan juntos o no se arreglan.
--
-- 🔒 NULLABLE y sin default, a propósito: hay creativos ya escritos en
-- producción viva y NULL debe significar "no sabemos", no un literal
-- inventado. Una columna NOT NULL habría exigido backfill sobre datos reales.
--
-- Sin CHECK de vocabulario: el servidor emite tanto AD_DURATION_INVALID
-- (nuestro) como los `errorReasonCode` que reporta Cloudflare, que no
-- controlamos y pueden cambiar sin avisarnos.
--
-- ADITIVA: `add column if not exists` sobre una tabla existente. No rompe
-- ningún contrato publicado — un `select('*')` de un build instalado
-- simplemente recibe una columna más, y los escritores viejos que no la
-- mandan la dejan en NULL.
-- Idempotente: if not exists.
-- Rollback: supabase/migrations/rollbacks/20260820000002_ad_creatives_failure_reason.sql

alter table public.ad_creatives
  add column if not exists failure_reason text;

comment on column public.ad_creatives.failure_reason is
  'Razón del último fallo del creativo (#189). NULL = no sabemos (creativos '
  'previos a la columna, o fallos sin razón reportada). Vocabulario ABIERTO a '
  'propósito: AD_DURATION_INVALID lo emite stream-webhook, y los errorReasonCode '
  'los emite Cloudflare Stream. El cliente (useAdUpload) la lee para dejar de '
  'inferir la causa por eliminación y dar el mensaje correcto.';
