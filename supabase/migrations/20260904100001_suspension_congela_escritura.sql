-- ════════════════════════════════════════════════════════════════════════════
-- #202 — La suspensión congela la ACTUACIÓN (2ª capa: RLS)
--
-- Definición de producto (Abraham, 2026-08-21):
--   «Suspender congela la capacidad de ACTUAR en nombre de la agencia.
--    Conserva la lectura de lo propio. Y lo que quedó vivo pasa al control
--    de la agencia.»
--
-- HUECO QUE CIERRA: `owner_user_id = auth.uid()` como PRIMERA cláusula de
-- properties_update (20260805000011:255) y `l.agent_id = auth.uid()` en
-- private.can_view_user_as_lead_searcher (20260807000006:153) CORTOCIRCUITAN
-- sin mirar la membresía. Un agente suspendido no puede publicar
-- (AGENCY_MEMBERSHIP_SUSPENDED, 20260805000011:122) pero SÍ podía editar
-- precio/dirección de lo ya publicado — que sigue en el escaparate bajo la
-- marca de la agencia (properties.agency_id denormalizado por esa misma
-- migración) — pausarlo, cerrarlo, y seguir viendo el teléfono/WhatsApp del
-- buscador de sus leads.
--
-- FORMA DE LA REGLA (una sola, en los dos sitios): al dueño se le exige
-- membresía VIGENTE en la organización DE LA FILA:
--     (es mío) and (la fila no tiene organización or mi membresía está activa)
-- private.agency_role_of (20260805000003) es el único punto de estrangulamiento
-- de «membresía vigente» (devuelve el rol ACTIVO o NULL) y así se queda: no se
-- añade ningún helper nuevo. `agency_id is null` conserva intacto al agente
-- INDEPENDIENTE — no se puede castigar al que nunca tuvo inmobiliaria (su eje
-- es #204). Es la misma forma que ya usa properties_insert desde 20260805000009.
--
-- 🔴 PRODUCCIÓN VIVA (§0.5): endurece una autorización que clientes vivos usan.
--   · No es destructivo (ni DROP de columna, ni pérdida de datos, ni revoke).
--   · Cambio de contrato OBSERVABLE → orden OTA-primero: el cliente aprende a
--     traducir AGENCY_MEMBERSHIP_SUSPENDED (202.3) ANTES de aplicar esto.
--   · Sonda previa (2026-09-02, remoto): 0 miembros suspendidos, 0 propiedades
--     activas de suspendidos, 0 leads de suspendidos → nadie vivo cambia de
--     comportamiento al desplegar.
--   · Idempotente (drop policy if exists + create or replace function) y con
--     rollback en supabase/migrations/rollbacks/ (mismo nombre).
--
-- ALCANCE: reglas 1 y 2 de la definición. La regla 3 (ruteo de leads nuevos e
-- inventario sin gestor) es #203. La 1ª capa (EFs edit-property y
-- update-property-status, que corren con service_role y BYPASEAN esta RLS) es
-- 202.2 — las dos capas se mueven juntas o la defensa queda a medias.
-- Tests: supabase/tests/90_suspension_congela_escritura_test.sql (26 asserts).
-- ════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────
-- REGLA 1 — Toda ESCRITURA de properties se bloquea, sin la excepción «es mío».
-- ────────────────────────────────────────────────────────────────────────────
-- USING y WITH CHECK idénticos (misma forma que la policy que reemplaza): la
-- fila vieja y la nueva pasan por el mismo filtro, así el suspendido tampoco
-- puede sacar la propiedad de la agencia poniendo agency_id = null.
drop policy if exists properties_update on public.properties;
create policy properties_update on public.properties for update to authenticated
  using (
    (owner_user_id = (select auth.uid())
     and (agency_id is null or private.agency_role_of(agency_id) is not null))
    or private.agency_role_of(agency_id) in ('owner', 'admin')
    or private.is_admin()
  )
  with check (
    (owner_user_id = (select auth.uid())
     and (agency_id is null or private.agency_role_of(agency_id) is not null))
    or private.agency_role_of(agency_id) in ('owner', 'admin')
    or private.is_admin()
  );

comment on policy properties_update on public.properties is
  'Fix 100: reemplaza private.is_agency_owner_of(owner_user_id) (membresía '
  'compartida HOY, ignoraba la agency_id real de la property -- tras un switch '
  'dejaba al owner de la agencia NUEVA editar properties VIEJAS de otra agencia, '
  'y simultáneamente bloqueaba al owner REAL de esas properties) por '
  'agency_role_of(agency_id) in (owner,admin) -- siempre escapada a la agencia '
  'real de la fila. private.is_agency_owner_of sigue vigente para leads (sin tocar). '
  '#202: la rama del DUEÑO deja de cortocircuitar -- exige membresía VIGENTE en la '
  'agencia de la fila (agency_role_of is not null, misma forma que properties_insert '
  'desde 20260805000009). Suspender congela la capacidad de ACTUAR en nombre de la '
  'agencia: editar el precio de algo que sigue en el escaparate bajo su marca es el '
  'mismo acto comercial que publicarlo, e incluye pausar y cerrar (si no, un agente '
  'molesto vacia el inventario en dos minutos). Un miembro removed cuya property '
  'quedo bajo agency_id tambien queda fuera: la fila sigue bajo la marca de la '
  'agencia, asi que la controla la agencia -- que owner_user_id sea suyo no la saca '
  'del escaparate. agency_id is null preserva al agente INDEPENDIENTE intacto '
  '(su eje es #204). La 1a capa (EFs edit-property / update-property-status, que '
  'corren con service_role y bypasean esta RLS) se mueve en 202.2.';

-- ────────────────────────────────────────────────────────────────────────────
-- REGLA 2 — La LECTURA de lo suyo se conserva; el CONTACTO del buscador no.
-- ────────────────────────────────────────────────────────────────────────────
-- Misma firma, atributos y grant que 20260807000006 (create or replace: el
-- grant a authenticated y las policies que la usan sobreviven). Solo cambia el
-- cuerpo: la rama del agente dueño del lead gana la exigencia de membresía
-- vigente en la agencia donde el lead NACIÓ.
--
-- Lo que el suspendido SIGUE viendo (deliberado): la fila del lead
-- (leads_select, 20260901000001) y su histórico (lead_status_history_select →
-- private.can_view_lead, que NO pasa por este helper). Congelar es una medida
-- cautelar; una cautelar que borra el acceso a tu propio trabajo es una sanción
-- disfrazada y vuelve traumática la reactivación.
-- Lo que deja de ver: la fila public.users del buscador → sin teléfono, sin
-- WhatsApp. [[privacidad-registrar-no-es-exponer]]: la condición para exponer a
-- una persona es RELACIÓN VIGENTE, no «soy dueño del objeto», y una membresía
-- en pausa no es una relación vigente. La máscara vive en la BD, no en la UI:
-- el embed users!leads_user_id_fkey devuelve null y LeadExpandedView ya
-- deshabilita WhatsApp con phone === null (fail-soft ya existente).
create or replace function private.can_view_user_as_lead_searcher(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.leads l
    where l.user_id = p_user_id
      and l.deleted_at is null
      and (
        (l.agent_id = (select auth.uid())
         and (l.agency_id is null or private.agency_role_of(l.agency_id) is not null))
        or private.agency_role_of(l.agency_id) in ('owner', 'admin')
      )
  );
$$;

comment on function private.can_view_user_as_lead_searcher(uuid) is
  'RLS: true si p_user_id es el buscador (leads.user_id) de un lead ACTIVO cuyo agente '
  'dueño (leads.agent_id) es el usuario autenticado CON MEMBRESÍA VIGENTE en la agencia '
  'donde ese lead nació (#202 -- antes bastaba ser el agente dueño), o el owner/admin de '
  'esa misma agencia (leads.agency_id vía agency_role_of -- fix 75.5-bis, reemplaza la '
  'membresía compartida HOY del agente). Usado por users_select para exponer la identidad '
  'de contacto del buscador (first_name, last_name, phone, avatar_url). El agente '
  'INDEPENDIENTE (leads.agency_id null) queda intacto. El suspendido conserva la LECTURA '
  'de lo suyo -- leads_select y lead_status_history (private.can_view_lead) no dependen de '
  'este helper -- y pierde solo el CONTACTO del buscador.';
