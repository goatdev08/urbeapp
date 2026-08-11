-- Rollback 20260810000001 — elimina la vista agent_public_profiles (#145.1)
-- Efecto: el feed/perfil/detalle vuelven al fallback silencioso (inicial
-- placeholder) para lecturas ajenas de nombre/foto; ninguna tabla cambia.

drop view if exists public.agent_public_profiles;
