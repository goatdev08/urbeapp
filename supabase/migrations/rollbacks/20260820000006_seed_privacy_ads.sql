-- Rollback: 20260820000006_seed_privacy_ads.sql (subtarea #170.9)
--
-- ⚠️ SOLO borra la fila si NO es la vigente. Si el flip ya se disparó, borrarla
-- dejaría a la app sin aviso de privacidad vigente y el muro legal sin nada
-- que mostrar. El `and not is_current` es la defensa, no una cortesía.
--
-- Si hace falta revertir DESPUÉS del flip, el orden es: primero volver a
-- encender la 1.0 y apagar la 2.0 en la MISMA transacción (ver el bloque de
-- abajo), y recién entonces correr el delete.
--
-- Re-ejecutable.

delete from public.terms_versions
 where doc_type = 'privacy' and version = '2.0' and not is_current;

-- ── REVERTIR EL FLIP (solo si ya se disparó) ────────────────────────────────
-- Comentado a propósito: descomentarlo es una decisión, no un efecto del
-- rollback. Los dos UPDATE van en la MISMA transacción o el índice único
-- parcial los rechaza.
--
-- begin;
--   update public.terms_versions set is_current = false
--    where doc_type = 'privacy' and is_current;
--   update public.terms_versions set is_current = true
--    where doc_type = 'privacy' and version = '1.0';
-- commit;
