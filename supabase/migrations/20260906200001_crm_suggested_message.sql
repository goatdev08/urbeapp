-- Migración 20260906200001 — public.crm_suggested_message (subtarea 267.4, tarea #267 "CRM UI
-- agente"). Decisión de Abraham (plan 2026-09-06) que cierra el hueco de §18/D7: el MENSAJE
-- SUGERIDO de WhatsApp se arma en el SERVIDOR, no en el cliente — el cliente nunca ve
-- properties.price ni users.phone para componerlo (precedente de fuga inversa: PRD §19.3).
-- Aditiva pura: 1 función nueva en `public`, ninguna tabla tocada, ningún contrato publicado
-- roto (§0.5 producción viva).
-- Rollback: supabase/migrations/rollbacks/20260906200001_crm_suggested_message.sql
-- Tests: supabase/tests/105_crm_suggested_message_test.sql (pgTAP, plan 23) — el contrato
-- completo (SEAMS, decisiones D-PLANTILLA/D-NOMBRE/D-ORIGEN/D-PRIVACIDAD/D-AUTZ-SHARED, edge
-- cases) está en la cabecera de ese archivo; no se repite aquí para no duplicar la fuente de
-- verdad.
--
-- ════════════════════════════════════════════════════════════════════════════
-- QUÉ: public.crm_suggested_message(p_lead_id uuid) returns text — plantilla determinista en
-- español, por estado proyectado 8→4 (misma proyección que crm_lead_detail/crm_leads_page,
-- 20260906100004/266.4), con el nombre de pila del lead y la dirección de la propiedad de
-- origen. NUNCA precio, teléfono ni hora de visita (la agenda es tarea #270).
--
-- ── D-AUTZ-SHARED — se REUSA private.can_view_lead tal cual, sin helper nuevo (idéntico a
--    crm_lead_detail, 266.5) ───────────────────────────────────────────────────────────────
-- D-DELETED: private.can_view_lead NO filtra deleted_at (hallazgo del RED en 266.5,
-- reconfirmado aquí) — el cuerpo agrega el filtro explícito `deleted_at is null` AL LEER la
-- fila del lead, ADEMÁS de can_view_lead.
--
-- ── D-PLANTILLA — 4 plantillas fijas por estado proyectado (8→4, idéntica agrupación que
--    crm_lead_detail pero aplicada al estado ACTUAL, no al "siguiente sugerido") ────────────
--   nuevo (whatsapp_opened, new) · contactado (contacted, interested, in_progress) ·
--   visita (visit_scheduled) · cerrado (closed_won_rent, closed_won_sale, closed_lost,
--   discarded, closed_won) → NULL.
--
-- ── D-NOMBRE — `users.first_name` del lead. Sin nombre, "Hola <Nombre>, " colapsa a "Hola, "
--    (NO deja un espacio extra antes de la coma: "Hola , " sería el resultado de un coalesce
--    ingenuo a cadena vacía concatenada tal cual) ────────────────────────────────────────────
--
-- ── D-ORIGEN — dirección = `properties.address` de la propiedad con MENOR `contacted_at` en
--    `lead_origin_properties` (mismo criterio D-ORIGIN-KEYS que crm_lead_detail). Sin fila de
--    origen, cada plantilla usa una cláusula genérica ("una de mis propiedades" / "alguna de
--    mis propiedades" / "la visita programada") en vez de fallar o emitir NULL en el texto —
--    extensión directa del patrón NOORIGIN1 (probado solo para "nuevo") a los otros 2 grupos
--    con propiedad, necesaria para que la función nunca produzca un texto con un hueco literal
--    ("de ." ), no una feature nueva.
--
-- ── D-PRIVACIDAD — la plantilla NUNCA expone `properties.price` ni `users.phone`: son campos
--    operativos internos del CRM, no insumo del mensaje dirigido al prospecto ──────────────
--
-- Idempotente: create or replace function + revoke/grant repetibles.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.crm_suggested_message(p_lead_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status     public.lead_status;
  v_first_name text;
  v_address    text;
  v_greeting   text;
begin
  -- D-AUTZ-SHARED fail-closed: sin can_view_lead, NULL sin tocar la fila (anti-IDOR). coalesce
  -- a false: can_view_lead nunca debería devolver NULL, pero la defensa en profundidad es
  -- barata y ya es el patrón de crm_lead_detail/crm_leads_page/crm_funnel.
  if not coalesce(private.can_view_lead(p_lead_id), false) then
    return null;
  end if;

  -- D-DELETED: can_view_lead NO filtra deleted_at (hallazgo del RED, reconfirmado aquí) — se
  -- agrega explícito. El join a users trae el nombre de pila del lead (users.id = leads.user_id).
  select l.status, u.first_name
    into v_status, v_first_name
  from public.leads l
  join public.users u on u.id = l.user_id
  where l.id = p_lead_id
    and l.deleted_at is null;

  if not found then
    return null;
  end if;

  -- Estado cerrado (5 de los 11 valores del enum): sin plantilla, sin construir nada más.
  if v_status in ('closed_won_rent', 'closed_won_sale', 'closed_lost', 'discarded', 'closed_won') then
    return null;
  end if;

  -- D-ORIGEN: la fila con MENOR contacted_at (mismo criterio que crm_lead_detail). NULL si el
  -- lead no tiene ninguna fila en lead_origin_properties.
  select p.address
    into v_address
  from public.lead_origin_properties lop
  join public.properties p on p.id = lop.property_id
  where lop.lead_id = p_lead_id
  order by lop.contacted_at asc
  limit 1;

  -- D-NOMBRE: "Hola Karla, " o, sin nombre, "Hola, " (nunca "Hola , ").
  v_greeting := 'Hola' || case when v_first_name is not null then ' ' || v_first_name else '' end || ', ';

  if v_status in ('whatsapp_opened', 'new') then
    return v_greeting || case
      when v_address is not null then 'vi que te interesó la propiedad de ' || v_address || '.'
      else 'vi que te interesó una de mis propiedades.'
    end || ' ¿Te gustaría agendar una visita?';
  elsif v_status in ('contacted', 'interested', 'in_progress') then
    return v_greeting || case
      when v_address is not null then '¿pudiste ver la propiedad de ' || v_address || '?'
      else '¿pudiste ver alguna de mis propiedades?'
    end || ' Cuéntame qué te pareció y si quieres que te comparta más opciones.';
  elsif v_status = 'visit_scheduled' then
    return v_greeting || case
      when v_address is not null then 'te escribo para confirmar la visita a ' || v_address || '.'
      else 'te escribo para confirmar tu visita.'
    end || ' ¿Sigue en pie?';
  end if;

  -- Inalcanzable con los 11 valores reales del enum (los 5 cerrados ya retornaron arriba),
  -- pero fail-closed explícito en vez de dejar la función caer al final sin RETURN.
  return null;
end;
$$;

comment on function public.crm_suggested_message(uuid) is
  'Mensaje sugerido de WhatsApp para un lead del CRM (subtarea 267.4, decisión de Abraham '
  '2026-09-06, cierra §18/D7): plantilla determinista en español por estado proyectado 8→4 '
  '(nuevo/contactado/visita/cerrado→NULL), con nombre de pila y dirección de origen. NUNCA '
  'precio ni teléfono (D-PRIVACIDAD, PRD §19.3). D-AUTZ-SHARED: reusa private.can_view_lead + '
  'deleted_at explícito — fail-closed, NULL, nunca excepción.';

revoke execute on function public.crm_suggested_message(uuid) from public, anon;
grant execute on function public.crm_suggested_message(uuid) to authenticated;
