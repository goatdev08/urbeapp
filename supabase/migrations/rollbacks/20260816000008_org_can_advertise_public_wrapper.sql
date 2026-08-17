-- Rollback de 20260816000008_org_can_advertise_public_wrapper.sql
-- (fix del guardián sobre 169.4). Sin dependientes fuera de
-- make_advertiser_authorizer (código de aplicación, no SQL) -- drop directo.

drop function if exists public.org_can_advertise(uuid);
