-- Rollback: 20260828000002_property_reports_autosuspend.sql (subtarea #220.2)
-- Quita el trigger AFTER INSERT sobre public.property_reports y su función.
-- NO se toca public.property_reports (20260604000007, preexistente), NO se
-- toca public.notifications ni public.properties -- esta migración solo
-- agregó el trigger/función, nunca creó ni alteró tablas. 100% reversible.

drop trigger if exists property_reports_notify_and_autosuspend on public.property_reports;
drop function if exists public.notify_property_report_and_autosuspend();
