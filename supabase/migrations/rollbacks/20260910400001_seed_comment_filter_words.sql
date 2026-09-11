-- Rollback de 20260910400001_seed_comment_filter_words.sql (subtarea 289.5)
-- DELETE explícito (a diferencia de otros seeds de app_config como ads_enabled,
-- que nunca se borran): comment_filter_words es una lista de calibración pura, sin
-- semántica de kill-switch ni de flag que otro proceso ya haya leído para tomar una
-- decisión irreversible — borrarla dejar simplemente a post-comment sin lista
-- (fail-open ya documentado en post-comment/types.ts, el filtro base sigue vivo).

delete from public.app_config where key = 'comment_filter_words';
