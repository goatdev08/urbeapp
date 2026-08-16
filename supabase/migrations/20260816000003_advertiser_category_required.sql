-- Migración 20260816000003 — CHECK: encender can_advertise exige advertiser_category
-- (subtarea #168.7). Aditiva e idempotente.
-- Rollback: rollbacks/20260816000003_advertiser_category_required.sql
-- Tests: supabase/tests/46_org_advertising_test.sql, sección 10 (asserts 64-70)
--
-- Propósito: cierra el hueco que encontró el guardian de 168.2 --
--   `advertiser_category = p_category` es INCONDICIONAL en
--   20260815000002_set_org_advertising_rpc.sql:71-73, así que
--   set_org_advertising_atomic(id, true) SIN p_category deja can_advertise=true
--   con categoría NULL, un estado que 169-171 no pueden servir (leen la
--   categoría para elegir el anuncio). Decisión de Abraham (2026-08-16):
--   hacerlo imposible en la base -- un CHECK, no confiar en que quien llame
--   la RPC se acuerde de pasar p_category.
--
-- 🔴 Producción viva (§0.5): puramente ADITIVA. Verificado en vivo contra la
--   base local ANTES de escribir esta migración:
--     select count(*) from public.agencies
--      where can_advertise = true and advertiser_category is null;
--   -> 0 filas. Hoy NADIE tiene can_advertise=true todavía (168.2 es la única
--   RPC que puede encenderlo y aún no tiene consumidores en producción), y el
--   estado por defecto de TODA fila preexistente es (can_advertise=false,
--   advertiser_category=null) -- exactamente el estado que el CHECK deja
--   pasar (CATREQ3 lo protege).

-- ── (a) CHECK: can_advertise=true exige advertiser_category no nulo ────────
-- Nombrado explícito -- mismo estilo/mensaje que agencies_al_menos_una_capacidad
-- (20260815000001): el mensaje de Postgres para violación de CHECK incluye el
-- nombre del constraint, así se distingue de cualquier otro CHECK de la tabla.
-- Solo restringe la combinación (true, null); (false, null), (false, no-null)
-- y (true, no-null) quedan todos permitidos.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agencies_categoria_requerida_para_anunciar'
      and conrelid = 'public.agencies'::regclass
  ) then
    alter table public.agencies
      add constraint agencies_categoria_requerida_para_anunciar
      check (not (can_advertise and advertiser_category is null));
  end if;
end $$;

-- ── (b) La RPC valida ANTES de tocar la fila, en vez de dejar que salga un
--        23514 crudo del constraint ────────────────────────────────────────
-- create or replace: parte del cuerpo vigente de 20260815000002 (FOR UPDATE,
-- AGENCY_NOT_FOUND, resolve_admin_actor, auditoría en la misma transacción,
-- revoke/grant, security definer con search_path fijo) -- solo se agrega el
-- guard nuevo, nada más se toca.
create or replace function public.set_org_advertising_atomic(
  p_agency_id uuid,
  p_enabled   boolean,
  p_category  public.advertiser_category default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id             uuid;
  v_old_can_advertise    boolean;
  v_old_advertiser_category public.advertiser_category;
begin
  -- Organización inexistente o borrada -> error explícito, nunca no-op silencioso.
  -- FOR UPDATE: toma el lock de fila antes de mutar (evita carreras entre dos
  -- llamadas concurrentes sobre la misma agencia).
  select can_advertise, advertiser_category
    into v_old_can_advertise, v_old_advertiser_category
    from public.agencies
   where id = p_agency_id
     and deleted_at is null
   for update;

  if not found then
    raise exception 'AGENCY_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 🔴 168.7: encender can_advertise sin categoría es el hueco que este CHECK
  -- cierra a nivel de base -- pero un 23514 crudo del constraint no es
  -- accionable para el caller. Se valida ANTES de tocar la fila, con el mismo
  -- criterio que AGENCY_NOT_FOUND arriba, para que el error sea explícito y
  -- no queden efectos parciales (ni UPDATE ni auditoría).
  if p_enabled and p_category is null then
    raise exception 'ADVERTISER_CATEGORY_REQUIRED' using errcode = 'P0001';
  end if;

  -- Admin actor identificado (Studio/CLI vía service_role, sin JWT de usuario
  -- normal) -- mismo helper que ya resuelve el flujo de aprobación por Studio.
  v_admin_id := private.resolve_admin_actor();

  update public.agencies
     set can_advertise       = p_enabled,
         advertiser_category = p_category
   where id = p_agency_id;

  -- Auditoría en la MISMA transacción/statement: si esto falla, el UPDATE de
  -- arriba se revierte también (atomicidad real, no un rollback manual).
  insert into public.admin_actions (
    admin_id, action_type, entity_type, entity_id, old_values, new_values
  )
  values (
    v_admin_id,
    case when p_enabled then 'enable_org_advertising' else 'disable_org_advertising' end,
    'agency',
    p_agency_id,
    jsonb_build_object(
      'can_advertise', v_old_can_advertise,
      'advertiser_category', v_old_advertiser_category
    ),
    jsonb_build_object(
      'can_advertise', p_enabled,
      'advertiser_category', p_category
    )
  );
end;
$$;

comment on function public.set_org_advertising_atomic(uuid, boolean, public.advertiser_category) is
  'Enciende/apaga agencies.can_advertise (+ advertiser_category) y audita en '
  'admin_actions en la MISMA transacción -- rollback total si la auditoría falla. '
  'Organización inexistente o con deleted_at -> P0001 AGENCY_NOT_FOUND. Encender '
  'sin categoría -> P0001 ADVERTISER_CATEGORY_REQUIRED (168.7, mismo hueco que '
  'cierra el CHECK agencies_categoria_requerida_para_anunciar). SOLO service_role '
  '(Studio/CLI del admin de Urbea, subtarea #168.2). admin_id vía '
  'private.resolve_admin_actor().';

-- Los grants (revoke de public/anon/authenticated, grant a service_role) ya
-- quedaron fijados por 20260815000002 y create-or-replace no los toca -- no
-- hace falta repetirlos.
