-- Tests pgTAP — Trigger de contadores denormalizados: like_count + save_count
-- SUT: migración futura 20260701000001_engagement_count_triggers.sql (aún no existe)
-- Subtareas 13.2 (like_count) + 13.4 (save_count) — FASE RED
-- Ejecutar con: supabase test db
-- Corre como superusuario dentro de una transacción revertida (no persiste).
--
-- Invariantes verificados:
--   like INSERT        → like_count +1
--   like en 2º video   → like_count = 2 (granularidad fila, no video/usuario)
--   like DELETE        → like_count −1
--   borrar hasta 0     → like_count = 0 (guard GREATEST; no viola CHECK like_count >= 0)
--   cascade video      → DELETE property_video → CASCADE likes → like_count −1
--   save INSERT        → save_count +1
--   save DELETE        → save_count −1
--   cascade usuario    → DELETE auth.users → CASCADE likes+saves → ambos counts −1
--   consistencia global (backfill): 0 propiedades con desajuste en like_count / save_count

begin;
select plan(14);

-- ── UUIDs de fixtures (prefijo 07, hex válido, sin colisión con tests 01–06) ──
--   U1 buscador-1 : 000...7001
--   U2 buscador-2 : 000...7002
--   U3 buscador-3 : 000...7003
--   G1 agente     : 000...7004
--   P1 propiedad-1: 000...70a1   P2 propiedad-2: 000...70a2
--   V1 video-1/P1 : 000...70b1   V2 video-2/P1 : 000...70b2

-- ── Fixtures herméticos ───────────────────────────────────────────────────────
-- El trigger handle_new_user crea public.users al insertar en auth.users.

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000007001', 'u1.counts@test.local'),
  ('00000000-0000-0000-0000-000000007002', 'u2.counts@test.local'),
  ('00000000-0000-0000-0000-000000007003', 'u3.counts@test.local'),
  ('00000000-0000-0000-0000-000000007004', 'g1.counts@test.local');

update public.users set role = 'agent', is_verified_agent = true
  where id = '00000000-0000-0000-0000-000000007004';

-- Propiedades con like_count = 0 y save_count = 0 (default)
insert into public.properties (id, owner_user_id, property_type, operation_type, address, location, price, status)
values
  ('00000000-0000-0000-0000-0000000070a1',
   '00000000-0000-0000-0000-000000007004',
   'departamento', 'rent',
   'Av. Test Contadores 100',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.35, 20.67), 4326)::extensions.geography,
   12000, 'active'),
  ('00000000-0000-0000-0000-0000000070a2',
   '00000000-0000-0000-0000-000000007004',
   'casa', 'sale',
   'Av. Test Contadores 200',
   extensions.ST_SetSRID(extensions.ST_MakePoint(-103.36, 20.68), 4326)::extensions.geography,
   2500000, 'active');

-- Dos videos de P1 en estado uploading (no requieren storage_path ni cloudflare_uid)
insert into public.property_videos (id, property_id, status, position) values
  ('00000000-0000-0000-0000-0000000070b1', '00000000-0000-0000-0000-0000000070a1', 'uploading', 1),
  ('00000000-0000-0000-0000-0000000070b2', '00000000-0000-0000-0000-0000000070a1', 'uploading', 2);

-- ══ 13.2: trigger AFTER INSERT OR DELETE ON likes → properties.like_count ══════

-- ── 1. like INSERT → like_count sube +1 ──────────────────────────────────────
-- RED: falla porque el trigger no existe y like_count permanece en 0.
insert into public.likes (user_id, property_video_id, property_id)
  values (
    '00000000-0000-0000-0000-000000007001',
    '00000000-0000-0000-0000-0000000070b1',
    '00000000-0000-0000-0000-0000000070a1'
  );
select is(
  (select like_count from public.properties
   where id = '00000000-0000-0000-0000-0000000070a1'),
  1,
  'like_count_incrementa_tras_insert_like'
);

-- ── 2. like en 2º video de la MISMA propiedad → like_count = 2 ───────────────
-- El trigger cuenta FILAS en likes, no videos únicos ni usuarios únicos.
-- RED: falla porque like_count sigue en 0.
insert into public.likes (user_id, property_video_id, property_id)
  values (
    '00000000-0000-0000-0000-000000007002',
    '00000000-0000-0000-0000-0000000070b2',
    '00000000-0000-0000-0000-0000000070a1'
  );
select is(
  (select like_count from public.properties
   where id = '00000000-0000-0000-0000-0000000070a1'),
  2,
  'like_count_segundo_video_misma_propiedad_cuenta_filas_no_videos'
);

-- ── 3. like DELETE → like_count baja −1 ──────────────────────────────────────
-- RED: falla porque like_count sigue en 0 (en lugar de haber llegado a 2 y bajar a 1).
delete from public.likes
  where user_id          = '00000000-0000-0000-0000-000000007002'
    and property_video_id = '00000000-0000-0000-0000-0000000070b2';
select is(
  (select like_count from public.properties
   where id = '00000000-0000-0000-0000-0000000070a1'),
  1,
  'like_count_decrementa_tras_delete_like'
);

-- ── 4. Borrar último like → like_count = 0 (guard GREATEST, no viola CHECK) ──
-- RED: pasa por razón incorrecta (count nunca se modificó desde 0).
-- GREEN: verifica que el trigger no produce un valor negativo que violaría el CHECK.
delete from public.likes
  where user_id          = '00000000-0000-0000-0000-000000007001'
    and property_video_id = '00000000-0000-0000-0000-0000000070b1';
select is(
  (select like_count from public.properties
   where id = '00000000-0000-0000-0000-0000000070a1'),
  0,
  'like_count_cero_al_borrar_ultimo_like_no_negativo'
);

-- ── 5. Cascade property_video: DELETE video → CASCADE en likes → like_count −1
-- 5a: el INSERT debe haber subido el contador (falla en RED porque no hay trigger).
insert into public.likes (user_id, property_video_id, property_id)
  values (
    '00000000-0000-0000-0000-000000007001',
    '00000000-0000-0000-0000-0000000070b1',
    '00000000-0000-0000-0000-0000000070a1'
  );
select is(
  (select like_count from public.properties
   where id = '00000000-0000-0000-0000-0000000070a1'),
  1,
  'like_count_incrementa_pre_cascade_delete_video'
);

-- 5b: borrar V1 → ON DELETE CASCADE borra el like → trigger decrementa like_count.
-- RED: pasa por razón incorrecta (like_count nunca subió; sigue en 0).
-- GREEN: verifica que el trigger AFTER DELETE dispara también en deletes en cascada.
delete from public.property_videos
  where id = '00000000-0000-0000-0000-0000000070b1';
select is(
  (select like_count from public.properties
   where id = '00000000-0000-0000-0000-0000000070a1'),
  0,
  'like_count_decrementa_cascade_delete_property_video'
);

-- ══ 13.4: trigger AFTER INSERT OR DELETE ON saves → properties.save_count ═════

-- ── 6. save INSERT → save_count +1 ───────────────────────────────────────────
-- saves tiene granularidad PROPIEDAD (un save por par user-property).
-- RED: falla porque save_count permanece en 0.
insert into public.saves (user_id, property_id)
  values (
    '00000000-0000-0000-0000-000000007001',
    '00000000-0000-0000-0000-0000000070a1'
  );
select is(
  (select save_count from public.properties
   where id = '00000000-0000-0000-0000-0000000070a1'),
  1,
  'save_count_incrementa_tras_insert_save'
);

-- ── 7. save DELETE (hard DELETE, sin deleted_at) → save_count −1 ─────────────
-- saves no tiene deleted_at: la granularidad es fila real, no soft-delete.
-- RED: pasa por razón incorrecta (save_count nunca subió a 1).
delete from public.saves
  where user_id     = '00000000-0000-0000-0000-000000007001'
    and property_id = '00000000-0000-0000-0000-0000000070a1';
select is(
  (select save_count from public.properties
   where id = '00000000-0000-0000-0000-0000000070a1'),
  0,
  'save_count_decrementa_tras_delete_save'
);

-- ══ Cascade usuario: DELETE auth.users → cascade public.users → likes + saves ═
-- U2 likea V2 (único video restante de P1 tras borrar V1) y guarda P1.
-- Luego se elimina auth.users(U2) → cascade a public.users → cascade a likes y saves.
-- El trigger AFTER DELETE debe decrementar like_count y save_count de P1.

insert into public.likes (user_id, property_video_id, property_id)
  values (
    '00000000-0000-0000-0000-000000007002',
    '00000000-0000-0000-0000-0000000070b2',
    '00000000-0000-0000-0000-0000000070a1'
  );

-- ── 8. like_count debe haber subido antes del cascade de usuario ──────────────
-- RED: falla porque like_count sigue en 0.
select is(
  (select like_count from public.properties
   where id = '00000000-0000-0000-0000-0000000070a1'),
  1,
  'like_count_incrementa_pre_cascade_delete_usuario'
);

insert into public.saves (user_id, property_id)
  values (
    '00000000-0000-0000-0000-000000007002',
    '00000000-0000-0000-0000-0000000070a1'
  );

-- ── 9. save_count debe haber subido antes del cascade de usuario ──────────────
-- RED: falla porque save_count sigue en 0.
select is(
  (select save_count from public.properties
   where id = '00000000-0000-0000-0000-0000000070a1'),
  1,
  'save_count_incrementa_pre_cascade_delete_usuario'
);

-- DELETE auth.users(U2):
--   → CASCADE → DELETE public.users(U2)
--   → CASCADE → DELETE likes WHERE user_id=U2 (dispara trigger → like_count −1)
--   → CASCADE → DELETE saves WHERE user_id=U2 (dispara trigger → save_count −1)
delete from auth.users
  where id = '00000000-0000-0000-0000-000000007002';

-- ── 10. like_count decrementó tras cascade delete de usuario ─────────────────
-- RED: pasa por razón incorrecta (like_count nunca subió desde 0).
select is(
  (select like_count from public.properties
   where id = '00000000-0000-0000-0000-0000000070a1'),
  0,
  'like_count_decrementa_cascade_delete_usuario'
);

-- ── 11. save_count decrementó tras cascade delete de usuario ─────────────────
-- RED: pasa por razón incorrecta.
select is(
  (select save_count from public.properties
   where id = '00000000-0000-0000-0000-0000000070a1'),
  0,
  'save_count_decrementa_cascade_delete_usuario'
);

-- ══ Consistencia global: backfill + trigger (§PRD: contadores exactos) ═════════
-- Insertar likes y saves adicionales sin aserción individual para garantizar
-- que los contadores estén desincronizados en RED (like_count/save_count = 0,
-- pero hay filas reales en likes/saves).
-- El query de desajuste debe devolver 0 propiedades con mismatch → falla en RED.

-- U1→V2 y U3→V2 son pares únicos no usados previamente.
insert into public.likes (user_id, property_video_id, property_id) values
  ('00000000-0000-0000-0000-000000007001',
   '00000000-0000-0000-0000-0000000070b2',
   '00000000-0000-0000-0000-0000000070a1'),
  ('00000000-0000-0000-0000-000000007003',
   '00000000-0000-0000-0000-0000000070b2',
   '00000000-0000-0000-0000-0000000070a1');

-- ── 12. Consistencia global: like_count = count real de likes por propiedad ───
-- RED: P1 tiene like_count=0 pero 2 filas en likes → mismatch → falla (desajuste = 1).
-- GREEN: el trigger + backfill garantizan que ninguna propiedad tenga desajuste.
select is(
  (select count(*)::int
     from public.properties p
    where p.id in (
      '00000000-0000-0000-0000-0000000070a1',
      '00000000-0000-0000-0000-0000000070a2'
    )
      and p.like_count <>
          (select count(*)::int
             from public.likes l
            where l.property_id = p.id)),
  0,
  'consistencia_global_like_count_sin_desajuste'
);

-- U1→P1 y U3→P1 son pares únicos no usados (S1 de U1 fue borrado en test 7).
insert into public.saves (user_id, property_id) values
  ('00000000-0000-0000-0000-000000007001',
   '00000000-0000-0000-0000-0000000070a1'),
  ('00000000-0000-0000-0000-000000007003',
   '00000000-0000-0000-0000-0000000070a1');

-- ── 13. Consistencia global: save_count = count real de saves por propiedad ───
-- RED: P1 tiene save_count=0 pero 2 filas en saves → mismatch → falla.
select is(
  (select count(*)::int
     from public.properties p
    where p.id in (
      '00000000-0000-0000-0000-0000000070a1',
      '00000000-0000-0000-0000-0000000070a2'
    )
      and p.save_count <>
          (select count(*)::int
             from public.saves s
            where s.property_id = p.id)),
  0,
  'consistencia_global_save_count_sin_desajuste'
);

select * from finish();
rollback;
