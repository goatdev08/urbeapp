-- Migración — Constraint: property_reports_other_requires_text
-- Propósito: garantiza que un reporte con reason='other' traiga un reason_text con contenido real
--   (no NULL, no vacío, no solo espacios). Los otros 6 reasons del enum aceptan reason_text libre
--   (NULL o cualquier texto, incluido vacío) — el CHECK no aplica fuera de 'other'.
-- Subtarea #220.1. Espeja el patrón de property_closed_requires_reason (migración 0005) /
-- property_videos_ready_requires_storage (migración 0012).
-- Enum property_report_reason = ('not_exist_fraud','misleading','false_price','wrong_address',
--   'inappropriate','duplicate','other').
-- Invariante: reason <> 'other' OR (reason_text IS NOT NULL AND reason_text ~ '\S').
-- ⚠️ Se usa la clase regex \S y NO trim(): trim() en Postgres recorta SOLO el espacio ASCII,
--   así que un reason_text de puros tabuladores/saltos de línea satisfacía el CHECK y dejaba
--   el invariante sin dientes (hallazgo del guardian, 220.1). \S exige al menos un carácter
--   que no sea whitespace de ninguna clase. El `is not null` explícito es obligatorio: sin él
--   el OR daría NULL para reason_text NULL y un CHECK con resultado NULL se considera cumplido.
-- Tabla vacía en producción (§0.5) → CHECK aditivo sin NOT VALID, sin riesgo de romper filas existentes.

-- Idempotente: eliminar primero si ya existe, luego recrear (patrón 20260604000012).
alter table public.property_reports
  drop constraint if exists property_reports_other_requires_text;

-- reason='other' exige reason_text con al menos un carácter no-whitespace; el resto de los
-- reasons acepta reason_text NULL o vacío indistintamente.
alter table public.property_reports
  add constraint property_reports_other_requires_text
    check (reason <> 'other' or (reason_text is not null and reason_text ~ '\S'));
