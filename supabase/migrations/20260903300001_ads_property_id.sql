-- Migración 20260903300001 — `ads.property_id`: promocionar una propiedad
-- (tarea #213, subtarea 213.1). EXPAND puramente ADITIVA.
--
-- ── Qué producto habilita ────────────────────────────────────────────────────
-- Hasta hoy un anuncio SIEMPRE era "display": un video propio (`ad_creatives`)
-- más un CTA. La decisión 4 de la exploración 040 (Abraham, 2026-08-23) suma un
-- segundo producto: **la promoción ES la propiedad**. Mismo video de la
-- publicación, badge «Anuncio», sin CTA propio — al tocarlo se abre el detalle
-- y sigue el flujo normal de leads. Dos productos, dos gates (modelo Meta:
-- boost vs Ads Manager): `can_advertise` sigue siendo el gate SOLO del display;
-- la promo la abre el permiso de PUBLICAR de la organización.
--
-- Por eso `ads` deja de tener una sola fuente de video y pasa a tener dos,
-- mutuamente excluyentes.
--
-- ── 🔴 Producción viva (CLAUDE.md §0.5) — por qué esto no rompe nada ─────────
-- 1. `add column` nullable + `drop not null` son operaciones que NO invalidan
--    ninguna fila existente. Todo anuncio vivo es display: tiene creative_id,
--    cta_type y cta_value poblados y property_id NULL, así que satisface los
--    dos CHECK nuevos POR CONSTRUCCIÓN. Los CHECK se agregan VALIDADOS (sin
--    `not valid`) precisamente para que Postgres lo verifique contra los datos
--    reales en vez de que lo demos por hecho.
-- 2. Los builds instalados no hacen `select('*')` sobre `ads` (verificado por
--    el analista): leen columnas nombradas y el feed va por `ads_for_zone`.
--    Una columna nueva es invisible para ellos.
-- 3. Relajar un NOT NULL es aditivo para el LECTOR (sigue recibiendo el mismo
--    valor) y solo amplía lo que el ESCRITOR puede mandar; el único escritor de
--    `ads` desde el cliente es `create_ad_campaign_atomic`, que sigue mandando
--    las tres columnas. El CHECK `ads_cta_required_for_display` conserva la
--    garantía que el NOT NULL daba, exactamente donde importa (display).
--
-- Idempotente: `add column if not exists`, `drop not null` repetible,
-- `drop constraint if exists` + `add constraint`, `create index if not exists`.
-- Rollback: supabase/migrations/rollbacks/20260903300001_ads_property_id.sql
-- Tests: supabase/tests/87_ads_property_id_test.sql

-- ════════════════════════════════════════════════════════════════════════════
-- 1) La segunda fuente de video: la propiedad.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.ads
  add column if not exists property_id uuid references public.properties (id) on delete cascade;

comment on column public.ads.property_id is
  'La publicación que se promociona (#213). Excluyente con creative_id (CHECK '
  'ads_exactly_one_source): un anuncio o trae su propio creativo (display) o ES '
  'una propiedad (promo). ON DELETE CASCADE: si la propiedad desaparece, su '
  'promoción no puede quedar apuntando al vacío — el feed serviría un video que '
  'ya no existe.';

create index if not exists ads_property_id_idx
  on public.ads (property_id) where property_id is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Relajar los NOT NULL que solo tienen sentido para un anuncio display.
--    `drop not null` es idempotente por naturaleza (re-ejecutar es no-op).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.ads alter column creative_id drop not null;
alter table public.ads alter column cta_type    drop not null;
alter table public.ads alter column cta_value   drop not null;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Los dos CHECK que sustituyen a esos NOT NULL. Se agregan VALIDADOS: si
--    alguna fila real no cumpliera, la migración falla aquí y no en producción
--    seis semanas después.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.ads drop constraint if exists ads_exactly_one_source;
alter table public.ads add constraint ads_exactly_one_source
  check (num_nonnulls(creative_id, property_id) = 1);

comment on constraint ads_exactly_one_source on public.ads is
  'Un anuncio tiene EXACTAMENTE una fuente de video: creative_id (display) o '
  'property_id (promoción). Ni las dos (¿cuál se reproduce?) ni ninguna (un '
  'anuncio sin video no existe en un feed de video).';

-- 🔒 El CTA sigue siendo OBLIGATORIO para el display — es su razón de ser: un
-- anuncio display sin a dónde llevar es inventario quemado. La promo no tiene
-- CTA a propósito (decisión 4): el tap abre el detalle de la propiedad y el
-- contacto ocurre ahí, con el flujo de leads que ya existe.
alter table public.ads drop constraint if exists ads_cta_required_for_display;
alter table public.ads add constraint ads_cta_required_for_display
  check (property_id is not null or (cta_type is not null and cta_value is not null));

comment on constraint ads_cta_required_for_display on public.ads is
  'Conserva la garantía que daban los NOT NULL de cta_type/cta_value, acotada '
  'al anuncio display. Una promoción (property_id) no lleva CTA: el tap abre el '
  'detalle de la publicación y el contacto sigue el flujo normal de leads.';

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Una sola promoción ABIERTA por propiedad.
-- ════════════════════════════════════════════════════════════════════════════
-- Sin esto, tocar «Promocionar» dos veces (doble tap, reintento tras un
-- timeout, dos dispositivos) crearía dos anuncios de la MISMA propiedad, que
-- competirían entre sí en el mismo municipio y duplicarían las impresiones —
-- métricas facturables corrompidas de raíz. La atomicidad la da el índice, no
-- un `select ... if not exists` en la RPC: entre el SELECT y el INSERT de dos
-- transacciones concurrentes no hay nada que las ordene.
--
-- El predicado enumera los estados NO TERMINALES:
--   · 'pending_review' — esperando moderación, el cupo está tomado.
--   · 'active'         — corriendo.
--   · 'paused'         — el reloj está CONGELADO, no cerrado (#210: pausar
--                        conserva los días); permitir otra promo aquí
--                        significaría que reanudar la primera crea el
--                        duplicado que este índice existe para impedir.
-- Quedan fuera, a propósito:
--   · 'draft'    — una promo nunca nace en draft (promote_property_atomic
--                  inserta directo en 'pending_review', 213.2).
--   · 'expired' / 'rejected' — TERMINALES: liberan la propiedad para volver a
--                  promocionarla, que es el comportamiento que el producto
--                  quiere (una promo que venció se puede repetir).
create unique index if not exists ads_one_open_promo_per_property
  on public.ads (property_id)
  where property_id is not null
    and status in ('pending_review', 'active', 'paused');

comment on index public.ads_one_open_promo_per_property is
  'Una sola promoción ABIERTA (pending_review/active/paused) por propiedad. '
  'PARCIAL en las dos dimensiones: solo filas con property_id (los display no '
  'se tocan) y solo estados no terminales (expired/rejected liberan el cupo). '
  'Es el candado de concurrencia del doble tap en «Promocionar» — la RPC '
  'traduce su unique_violation a ALREADY_PROMOTED (213.2).';
