-- Migración 20260818000001 — descripción opcional del anuncio + democión
-- automática a revisión (tarea #192, derivada de 170.8, decisiones de Abraham
-- 2026-08-18). Bloque BACKEND.
--
-- ── Alcance ──────────────────────────────────────────────────────────────────
-- 1) public.ads gana description text null (aditiva) + CHECK
--    ads_description_length (<= 500 caracteres). NULL permitido -- la
--    descripción es opcional. Deliberadamente SIN CHECK de esquemas de URL:
--    la allowlist http/https vive en UN SOLO lugar (el linkificador del
--    cliente + validate_ad_cta, #169) -- una segunda copia en la base,
--    forzosamente más débil (un CHECK no puede parsear/tokenizar URLs dentro
--    de texto libre con la misma fidelidad que el cliente), sería peor que
--    una sola defensa fuerte: dos filtros divergentes es más superficie de
--    ataque, no menos.
-- 2) Trigger BEFORE UPDATE ads_description_review
--    (public.handle_ad_description_edit()) sobre public.ads: si la
--    descripción de un ad 'active' cambia (y el UPDATE no está cambiando
--    status a propósito), lo devuelve a 'pending_review'. Cierra el hueco de
--    aprobar una descripción limpia y sustituirla después sin pasar por
--    moderación otra vez.
--    🔴 El nombre del trigger decide si la MÁQUINA DE ESTADOS llega a
--    opinar sobre la democión. Los triggers BEFORE ROW de una tabla corren en
--    orden ALFABÉTICO, y 'ads_description_review' < 'ads_status_change'
--    (169.2): con este nombre la democión ocurre PRIMERO, así que cuando
--    'ads_status_change' evalúa su WHEN ya ve status distinto y se dispara --
--    y por eso la pieza (3) de abajo es OBLIGATORIA, o la máquina rechazaría
--    la transición con INVALID_AD_STATUS_TRANSITION.
--    MEDIDO por el guardián (2026-08-18, probe diferencial de 8 formas de
--    UPDATE): renombrarlo para que ordene DESPUÉS produce el MISMO resultado
--    observable, porque 'ads_status_change' nunca asigna new.status y su WHEN
--    quedaría en falso -- la democión seguiría ocurriendo, solo que sin pasar
--    por la matriz. No es "roto en silencio": es la máquina de estados
--    dejando de validar una transición que hoy sí valida. Se conserva este
--    nombre a propósito para que la democión siga sujeta a la matriz.
-- 3) create or replace public.handle_ad_status_change() (169.2, NO se edita
--    20260816000006_ads_state_machine.sql -- create or replace es el patrón
--    del repo): la matriz gana active->pending_review, pero ÚNICAMENTE como
--    transición de SISTEMA -- el discriminador es que la descripción cambió
--    en el MISMO UPDATE (old.description IS DISTINCT FROM new.description).
--    Si cambió: no exige admin (private.resolve_admin_actor() no se llama) y
--    no inserta en admin_actions (esa tabla audita decisiones de ADMIN,
--    admin_id es NOT NULL -- aquí nadie identificado decidió nada). Si NO
--    cambió: sigue siendo INVALID_AD_STATUS_TRANSITION (P0001) -- un admin no
--    puede regresar un ad a revisión a mano por esta vía; eso no está en
--    alcance de esta tarea.
--
-- Contrato completo y los 41 asserts pgTAP:
-- supabase/tests/52_ads_description_test.sql (archivo propio, no se agregan
-- asserts a 47_ads_schema_test.sql/48_ads_state_machine_test.sql).
--
-- Idempotente: alter table add column if not exists, drop constraint/trigger
-- if exists + create constraint/trigger, create or replace function.
-- No hay siembra de datos ni backfill -- la columna nace NULL para todo ad
-- existente (no hay pérdida de datos ni ruptura de contrato para builds
-- instalados: select('*') sobre ads simplemente ve una columna más).
-- Rollback: supabase/migrations/rollbacks/20260818000001_ads_description.sql

-- ════════════════════════════════════════════════════════════════════════════
-- 1) public.ads.description — texto plano opcional, autolinkificado en el
--    cliente.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.ads add column if not exists description text null;

alter table public.ads
  drop constraint if exists ads_description_length;
alter table public.ads
  add constraint ads_description_length
    check (description is null or char_length(description) <= 500);

comment on column public.ads.description is
  'Texto plano opcional del anunciante (tarea #192). El cliente lo '
  'autolinkifica: detecta URLs dentro del texto y las vuelve tocables -- se '
  'descartó markdown tipo [texto](url) porque permite que el texto visible '
  'MIENTA sobre el destino (la mecánica exacta del phishing). La allowlist de '
  'esquemas http/https vive DELIBERADAMENTE en un solo lugar: el '
  'linkificador del cliente y validate_ad_cta (#169) -- NO duplicada aquí '
  'como un blocklist de base, porque una segunda copia de una defensa, casi '
  'siempre más débil que el original, es peor que una sola defensa fuerte. '
  'CHECK ads_description_length limita a 500 caracteres; NULL permitido, la '
  'descripción es opcional. Editar la descripción de un ad active lo regresa '
  'a pending_review (ver trigger ads_description_review).';

comment on constraint ads_description_length on public.ads is
  'Tope de 500 caracteres (tarea #192) para la descripción libre del '
  'anunciante -- frontera inclusiva (500 aceptado, 501 rechazado).';

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Trigger: democión automática a pending_review al editar la descripción
--    de un ad active.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.handle_ad_description_edit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Democión de SISTEMA (tarea #192): sin admin, sin auditoría -- solo marca
  -- el ad para que vuelva a pasar por moderación humana. La cláusula WHEN del
  -- CREATE TRIGGER (abajo) ya garantizó old.status='active' y
  -- new.status=old.status (nadie está cambiando el status a propósito en
  -- este mismo UPDATE) antes de que esta función se ejecute.
  new.status := 'pending_review';
  return new;
end;
$$;

comment on function public.handle_ad_description_edit() is
  'Trigger BEFORE UPDATE en ads (tarea #192): si la descripción de un ad '
  '''active'' cambia (y el UPDATE no está cambiando status a propósito en el '
  'mismo statement), lo regresa a ''pending_review'' -- cierra el hueco de '
  'aprobar una descripción limpia y sustituirla después sin nueva revisión. '
  'Democión de SISTEMA: no exige admin ni audita en admin_actions. Solo se '
  'dispara si la cláusula WHEN del trigger se cumple.';

-- 🔴 El nombre importa por el ORDEN: los triggers BEFORE ROW corren en orden
-- ALFABÉTICO y 'ads_description_review' < 'ads_status_change' (169.2), así
-- que esta democión corre ANTES y la máquina de estados alcanza a validarla
-- (por eso existe la rama de sistema en handle_ad_status_change). Renombrarlo
-- para que ordene después NO rompe el resultado observable -- está medido --
-- pero saca la democión del control de la matriz. Ver la cabecera.
drop trigger if exists ads_description_review on public.ads;
create trigger ads_description_review
  before update on public.ads
  for each row
  when (
    old.description is distinct from new.description
    and old.status = 'active'
    and new.status = old.status
  )
  execute function public.handle_ad_description_edit();

-- ════════════════════════════════════════════════════════════════════════════
-- 3) create or replace public.handle_ad_status_change() (169.2) -- += matriz
--    active->pending_review, gateada a transición de SISTEMA (la descripción
--    cambió en el mismo UPDATE). Todo lo demás IDÉNTICO a 20260816000006:
--    admin obligatorio, ORGANIZATION_SUSPENDED, D2 pausar el reloj, auditoría
--    en la misma transacción.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.handle_ad_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin_id uuid;
begin
  -- Matriz de transiciones válidas (D2, 169.2 + tarea #192).
  -- draft->active DIRECTO queda deliberadamente fuera: "jamás se sirve sin
  -- moderación". rejected/expired son TERMINALES (ninguna transición de
  -- salida). active->pending_review se agrega (192) pero solo es una
  -- transición válida como democión de SISTEMA -- ver el bloque siguiente.
  if not (
    (old.status = 'draft' and new.status = 'pending_review')
    or (old.status = 'pending_review' and new.status = 'active')
    or (old.status = 'active' and new.status in ('paused', 'expired', 'rejected', 'pending_review'))
    or (old.status = 'paused' and new.status = 'active')
  ) then
    raise exception 'INVALID_AD_STATUS_TRANSITION' using errcode = 'P0001';
  end if;

  -- Tarea #192: active->pending_review SOLO es válida como democión de
  -- SISTEMA -- el discriminador es que la descripción cambió en el MISMO
  -- UPDATE (el trigger ads_description_review, que corre ANTES por orden
  -- alfabético, ya dejó new.status en 'pending_review' cuando eso pasa). Si
  -- llegamos aquí con esta combinación pero la descripción NO cambió, es un
  -- intento de mover el status a mano por esta vía -- sigue inválido. Nunca
  -- se llama a private.resolve_admin_actor() ni se audita en este caso: no
  -- hay una decisión de admin que registrar.
  if old.status = 'active' and new.status = 'pending_review' then
    if old.description is distinct from new.description then
      return new;
    else
      raise exception 'INVALID_AD_STATUS_TRANSITION' using errcode = 'P0001';
    end if;
  end if;

  -- Defensa en profundidad: exige un admin identificado ANTES de aplicar
  -- cualquier efecto, aunque el caller ya tenga GRANT de tabla (service_role).
  v_admin_id := private.resolve_admin_actor();

  -- Bloquea activar bajo una organización YA suspendida EN ESE MOMENTO (no
  -- reactivo a una suspensión futura -- decisión de Abraham, hueco que
  -- detectó el analista sobre el plan original).
  if old.status = 'pending_review' and new.status = 'active' then
    if exists (
      select 1 from public.agencies where id = new.agency_id and status = 'suspended'
    ) then
      raise exception 'ORGANIZATION_SUSPENDED' using errcode = 'P0001';
    end if;
  end if;

  -- D2 "pausar el reloj": conserva los días restantes en vez de perderlos.
  if old.status = 'active' and new.status = 'paused' then
    new.paused_at := now();
  elsif old.status = 'paused' and new.status = 'active' then
    -- El CHECK ads_paused_at_matches_status garantiza que un ad en 'paused'
    -- SIEMPRE trae paused_at no nulo (el único camino a 'paused' es
    -- active->paused, arriba, que lo estampa) -- sin coalesce: si paused_at
    -- llegara NULL aquí sería un bug real, no un estado legítimo a tolerar
    -- en silencio (D2: jamás perder días pagados sin que reviente).
    new.ends_at := old.ends_at + (now() - old.paused_at);
    new.paused_at := null;
    new.paused_by_suspension := false;
  end if;

  -- Auditoría SIEMPRE, en la MISMA transacción. Si este INSERT falla, TODO lo
  -- anterior se revierte (patrón moderate_property_atomic, 20260809000007).
  -- Sin bloque EXCEPTION a propósito -- cualquier fallo debe propagar.
  insert into public.admin_actions (admin_id, action_type, entity_type, entity_id, old_values, new_values)
  values (
    v_admin_id, 'change_ad_status', 'ad', new.id,
    jsonb_build_object('status', old.status::text),
    jsonb_build_object('status', new.status::text)
  );

  return new;
end;
$$;

comment on function public.handle_ad_status_change() is
  'Trigger BEFORE UPDATE en ads (169.2 + tarea #192): ÚNICA autoridad de la '
  'máquina de estados {draft->pending_review, pending_review->active, '
  'active->{paused,expired,rejected}, paused->active}, más '
  'active->pending_review SOLO como democión de SISTEMA (la descripción '
  'cambió en el mismo UPDATE -- sin admin, sin auditoría). Para las demás '
  'transiciones exige un admin identificado (private.resolve_admin_actor), '
  'bloquea activar bajo una organización suspendida (ORGANIZATION_SUSPENDED), '
  'aplica D2 "pausar el reloj" y registra SIEMPRE en admin_actions en la '
  'misma transacción. Solo se dispara si status realmente cambia (WHEN '
  'clause del CREATE TRIGGER).';
