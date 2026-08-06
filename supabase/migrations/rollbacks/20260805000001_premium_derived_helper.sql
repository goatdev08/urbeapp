-- Rollback: 20260805000001_premium_derived_helper.sql
-- Elimina el helper private.is_premium (revoca implícitamente el grant a authenticated
-- al dropear la función).

drop function if exists private.is_premium(uuid);
