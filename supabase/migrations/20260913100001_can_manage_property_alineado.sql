-- Alinea private.can_manage_property() con la forma VIVA de properties_update (#202)
-- (subtarea 292.1, tarea #292, hardening(289.2)).
--
-- ORIGEN: 289.2 detectó (REUSO_CON_RESERVA) que private.can_manage_property() -- creada en
-- 20260604000010 -- diverge de properties_update desde 20260904100001 (#202): no exige
-- membresía VIGENTE al dueño (un agente SUSPENDIDO o REMOVED conserva el poder de gestor
-- sobre su propia propiedad, al revés de la regla de producto) y nunca contempla al ADMIN
-- de agencia (solo al owner, vía private.is_agency_owner_of). 289.2 no lo tocó por no caber
-- en su footprint (creó private.is_property_comment_manager con la expresión viva en su
-- lugar, dejando DOS verdades). Esta migración cierra esa brecha: can_manage_property pasa a
-- tener la MISMA forma que properties_update, e is_property_comment_manager delega en ella
-- (una sola verdad, sin duplicar la expresión en 2+ funciones -- Duplicated Code, CLAUDE.md §0).
--
-- CONSUMIDORES VIVOS de can_manage_property (grep 2026-09-13, supabase/migrations/*.sql sin
-- rollbacks): SOLO property_videos.videos_select y property_videos.videos_update
-- (20260604000010:284-296). events_raw_select ya NO lo usa (sustituido por
-- private.can_view_user_events en 20260809000001) -- fuera del footprint.
--
-- 🔴 PRODUCCIÓN VIVA (§0.5): endurece/amplía una autorización que clientes vivos usan
-- (mismos dos consumidores que ya sirven video a agentes reales).
--   · No destructivo: create-or-replace de función, sin DROP/ALTER que pierda datos.
--   · Cambio de contrato OBSERVABLE (2 policies ya publicadas): un dueño suspendido/removed
--     pierde la lectura/escritura de SU video en vuelo; un admin de agencia la gana. Mismo
--     cambio de comportamiento que #202 ya aplicó a properties_update (20260904100001) --
--     esta migración solo hace que property_videos dependa de la MISMA regla, ya OTA-da.
--   · Sonda remota previa (2026-09-12, urbea-app): 0 miembros suspendidos, 1 removed sin
--     propiedades propias, 3 propiedades draft sin agency_id de dueños ÚNICOS que además son
--     admins de plataforma (is_admin() ya los cubre), 0 admins de agencia con propiedades
--     ajenas en su cartera → nadie vivo cambia de comportamiento observable al desplegar.
--   · Idempotente (create or replace) y con rollback 1:1 en
--     supabase/migrations/rollbacks/20260913100001_can_manage_property_alineado.sql.
--
-- Tests: supabase/tests/116_can_manage_property_parity_test.sql (25 asserts).
-- ════════════════════════════════════════════════════════════════════════════

-- can_manage_property pasa a ser la fuente de verdad: misma forma que properties_update
-- (20260904100001_suspension_congela_escritura.sql:58-63) / is_property_comment_manager
-- (20260910100001_comments.sql:164-172). Firma, lenguaje y atributos sin cambio.
create or replace function private.can_manage_property(p_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.properties p
    where p.id = p_property_id
      and (
        (p.owner_user_id = (select auth.uid())
         and (p.agency_id is null or private.agency_role_of(p.agency_id) is not null))
        or private.agency_role_of(p.agency_id) in ('owner', 'admin')
        or private.is_admin()
      )
  );
$$;

comment on function private.can_manage_property(uuid) is
  'RLS: true si el usuario autenticado es GESTOR de p_property_id -- dueño CON membresía '
  'vigente en la agencia de la fila (si tiene agencia), o owner/admin de esa agencia, o '
  'admin de plataforma. Forma VIVA de properties_update tras #202 (20260904100001): un '
  'dueño SUSPENDIDO o REMOVED pierde el poder de gestor sobre SU propia propiedad, pero el '
  'owner/admin de la agencia lo conserva. Consumidores vivos (2026-09-13): '
  'property_videos.videos_select y videos_update. Única fuente de verdad -- '
  'private.is_property_comment_manager delega en esta función (292.1, hardening(289.2)); '
  'antes (289.2) eran dos expresiones idénticas mantenidas por separado.';

-- is_property_comment_manager deja de duplicar la expresión: delega en can_manage_property
-- (misma firma/atributos/grant -- una sola verdad, CLAUDE.md §0 Duplicated Code).
create or replace function private.is_property_comment_manager(p_property_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select private.can_manage_property(p_property_id);
$$;

comment on function private.is_property_comment_manager(uuid) is
  'RLS (comments, #289.2): true si el usuario autenticado es GESTOR de comentarios de '
  'p_property_id. Delega en private.can_manage_property (292.1, hardening(289.2)): ambas '
  'funciones comparten la misma regla (forma VIVA de properties_update tras #202) desde que '
  'can_manage_property se alineó -- ya no hay dos expresiones idénticas mantenidas por '
  'separado.';
