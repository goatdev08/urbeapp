-- Tests pgTAP — el CHECK de duración de ad_creatives espeja el rango de
-- producto [10,120] (#230; el hueco que #228 dejó y reventó el webhook en
-- producción 2026-09-01: la suite Deno mockea el updater y jamás toca el
-- CHECK real — ESTE archivo es el ancla que faltaba entre la 4ª capa y las
-- otras tres).
-- Ejecutar con: supabase test db

begin;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000023001', 'ox.230@test.local');
insert into public.agencies (id, name, slug, status, created_by_user_id) values
  ('00000000-0000-0000-0000-000000023010', 'Inmobiliaria Check 230', 'inmo-check-230',
   'active', '00000000-0000-0000-0000-000000023001');

-- Fila base en 'uploading' con duration NULL (el estado real pre-webhook).
insert into public.ad_creatives (id, agency_id, status, cloudflare_uid) values
  ('00000000-0000-0000-0000-000000023060', '00000000-0000-0000-0000-000000023010',
   'uploading', 'fixture-230-uid');

select lives_ok(
  $$update public.ad_creatives set duration_seconds = 10
      where id = '00000000-0000-0000-0000-000000023060'$$,
  'D1_el_minimo_del_rango_de_producto_10s_pasa_el_CHECK (con 6–30 también pasaba — el ancla real son D2/D3)'
);

select lives_ok(
  $$update public.ad_creatives set duration_seconds = 120
      where id = '00000000-0000-0000-0000-000000023060'$$,
  'D2_el_maximo_del_rango_de_producto_120s_pasa_el_CHECK — exactamente el UPDATE de mark_ready que el CHECK viejo (6–30) reventaba con 500'
);

select lives_ok(
  $$update public.ad_creatives set duration_seconds = 31
      where id = '00000000-0000-0000-0000-000000023060'$$,
  'D3_31s_pasa_el_CHECK — el primer segundo fuera del rango viejo, el caso del incidente'
);

select throws_ok(
  $$update public.ad_creatives set duration_seconds = 9
      where id = '00000000-0000-0000-0000-000000023060'$$,
  '23514', null,
  'I1_9s_viola_el_CHECK (debajo del mínimo de producto)'
);

select throws_ok(
  $$update public.ad_creatives set duration_seconds = 121
      where id = '00000000-0000-0000-0000-000000023060'$$,
  '23514', null,
  'I2_121s_viola_el_CHECK (arriba del máximo de producto)'
);

select lives_ok(
  $$update public.ad_creatives set duration_seconds = null
      where id = '00000000-0000-0000-0000-000000023060'$$,
  'I3_null_sigue_permitido (creativo que aún no llega a ready)'
);

select * from finish();
rollback;
