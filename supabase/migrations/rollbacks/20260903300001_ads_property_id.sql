-- Rollback: 20260903300001_ads_property_id.sql (tarea #213, subtarea 213.1)
--
-- ⚠️ DESTRUCTIVO SI YA HAY PROMOCIONES. `drop column property_id` borraría el
-- vínculo anuncio↔publicación de cada promoción viva, y ese dato no está en
-- ninguna otra parte. Por eso el paso 1 ABORTA con un mensaje explícito si
-- existe aunque sea una fila con property_id, en vez de destruirla en silencio:
-- revertir esta migración con promociones creadas exige primero decidir qué
-- pasa con ellas (borrarlas es una decisión de producto, no de migración).
--
-- Restaurar los NOT NULL (creative_id, cta_type, cta_value) tiene el MISMO
-- prerrequisito y por la misma razón: toda promo tiene esas tres columnas en
-- NULL, así que el ALTER fallaría con 23502 — el guard lo convierte en un
-- mensaje que dice qué hacer.
--
-- 🔴 ORDEN respecto al cliente: el OTA que devuelve el cliente a la versión sin
-- promociones va PRIMERO. Un cliente nuevo contra esta base revertida pediría
-- `property_id` a ads_for_zone y recibiría 42703.
--
-- Re-ejecutable (if exists / do block).

-- ── 1) Guard: no se revierte sobre promociones vivas ────────────────────────
do $$
declare v_promos bigint;
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'ads' and column_name = 'property_id'
  ) then
    execute 'select count(*) from public.ads where property_id is not null' into v_promos;
    if v_promos > 0 then
      raise exception
        'ROLLBACK ABORTADO: hay % anuncio(s) con property_id (promociones de #213). Revertir borraria el vinculo anuncio-publicacion. Decide primero que pasa con esas filas y vuelve a correr este rollback.', v_promos
        using errcode = 'P0001';
    end if;
  end if;
end $$;

-- ── 2) Índices y CHECKs nuevos ──────────────────────────────────────────────
drop index if exists public.ads_one_open_promo_per_property;
drop index if exists public.ads_property_id_idx;

alter table public.ads drop constraint if exists ads_cta_required_for_display;
alter table public.ads drop constraint if exists ads_exactly_one_source;

-- ── 3) Restaurar los NOT NULL originales (20260816000005) ───────────────────
-- Seguro por el guard del paso 1: sin promociones, toda fila de ads es display
-- y tiene las tres columnas pobladas.
alter table public.ads alter column creative_id set not null;
alter table public.ads alter column cta_type    set not null;
alter table public.ads alter column cta_value   set not null;

-- ── 4) La columna ───────────────────────────────────────────────────────────
alter table public.ads drop column if exists property_id;
