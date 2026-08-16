-- Rollback: 20260815000003_wizard_step3_columns.sql
--
-- Elimina las 3 columnas nuevas. Seguro mientras ninguna migración posterior
-- (000004, 000005) siga viva — revertir en orden inverso.

alter table public.properties
  drop column if exists built_square_meters,
  drop column if exists half_bathrooms,
  drop column if exists currency;
