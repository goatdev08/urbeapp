-- Migración 0033 — Campos de registro requeridos + constraints (#72.2, PRD §5.1)
--
-- Propósito: cerrar el hueco entre "lo que el PRD exige al registrarse" y "lo que la
--   tabla users realmente garantiza". Hoy public.users acepta teléfono duplicado,
--   fecha de nacimiento nula o de un menor de edad, y guarda estado/ciudad como texto
--   libre sin relación con el catálogo INEGI de 72.1.
--
-- ESTRATEGIA: aditiva y reversible. Se agregan columnas nuevas, se hace backfill
--   best-effort desde el texto libre, y city/state quedan marcadas como DEPRECADAS
--   para dropearlas en una migración posterior — no aquí, para no romper el código
--   que todavía las lee.
--
-- ⚠️ POR QUÉ NO HAY `not null` en date_of_birth / state_id / municipality_id:
--   Las 11 filas existentes tienen date_of_birth NULL. Un NOT NULL obligaría a
--   inventarles una fecha de nacimiento (dato personal fabricado, en una migración
--   que también corre en producción) o a romper cualquier UPDATE sobre esas filas
--   (p. ej. el `set last_login_at = now()` de cada login). La obligatoriedad vive en
--   la FRONTERA DE REGISTRO — formulario (validation.ts) + handle_new_user — mientras
--   que aquí se garantiza que el VALOR, cuando existe, es válido. El NOT NULL duro
--   queda para cuando no quede ninguna fila legacy incompleta.

-- ── 1) Columnas nuevas: estado y municipio contra el catálogo INEGI ─────────
alter table public.users
  add column if not exists state_id        text references public.mx_states (id),
  add column if not exists municipality_id text references public.mx_municipalities (id);

comment on column public.users.state_id is
  'Entidad federativa (catálogo INEGI mx_states). Sustituye a users.state.';
comment on column public.users.municipality_id is
  'Municipio/demarcación (catálogo INEGI mx_municipalities). Sustituye a users.city.';

-- El grant por columna de 0008 (línea ~405) enumera qué puede editar `authenticated`
-- de su propio perfil, y las columnas nuevas no estaban ahí. Sin esto, una cuenta que
-- quedó sin estado/municipio NO tiene forma de completarlos desde la app: el PATCH a
-- PostgREST devuelve 42501 y el hueco es permanente. `date_of_birth` ya estaba en la
-- lista de 0008; el CHECK de mayoría de edad sigue aplicando a cualquier valor nuevo,
-- así que poder editarla no abre la puerta a un menor.
grant update (state_id, municipality_id) on public.users to authenticated;

-- ── 2) Backfill best-effort desde el texto libre ────────────────────────────
-- Emparejamiento por nombre exacto, ignorando mayúsculas y espacios al borde. Lo que
-- no empareje se queda NULL: es preferible un hueco explícito a una ciudad inventada.
-- ponytail: sin `unaccent` — la extensión NO está instalada en este proyecto y añadirla
--   (más su wrapper IMMUTABLE, porque unaccent() no lo es) para emparejar 11 filas de
--   demo no se paga. Techo conocido: 'Queretaro' no emparejará con 'Querétaro' y quedará
--   NULL. Aceptable — es un backfill best-effort, no la ruta de escritura real, y desde
--   ahora el dato entra por el catálogo, no por texto libre.
-- El municipio se resuelve DENTRO del estado ya emparejado, no globalmente: hay
-- municipios homónimos en distintos estados y un match global elegiría al azar.
update public.users u
set state_id = s.id
from public.mx_states s
where u.state_id is null
  and u.state is not null
  and lower(trim(u.state)) = lower(s.name);

update public.users u
set municipality_id = m.id
from public.mx_municipalities m
where u.municipality_id is null
  and u.state_id is not null
  and m.state_id = u.state_id
  and u.city is not null
  and lower(trim(u.city)) = lower(m.name);

-- ── 3) Marcar el texto libre como deprecado ─────────────────────────────────
comment on column public.users.city is
  'DEPRECADO (#72.2): usar municipality_id (catálogo INEGI). Se elimina en una migración futura.';
comment on column public.users.state is
  'DEPRECADO (#72.2): usar state_id (catálogo INEGI). Se elimina en una migración futura.';

-- ── 4) Coherencia municipio ↔ estado ────────────────────────────────────────
-- El cvegeo INEGI empieza con la clave de su entidad, así que el prefijo ES la
-- verificación. Sin esto se podría guardar Monterrey ('19039') con estado Jalisco
-- ('14'): ambas FK son válidas por separado y la contradicción pasaría desapercibida.
alter table public.users drop constraint if exists users_municipio_del_estado;
alter table public.users add constraint users_municipio_del_estado check (
  municipality_id is null
  or state_id is null
  or left(municipality_id, 2) = state_id
);

-- ── 5) Mayoría de edad, calculada en el servidor ────────────────────────────
-- Reemplaza a users_dob_not_future: "hace 18 años o más" ya implica "no futura",
-- así que mantener las dos sería redundante.
-- Sobre current_date en un CHECK: no es inmutable y Postgres lo evalúa en cada
-- INSERT/UPDATE, no al validar la tabla. Es el MISMO precedente que ya usaba
-- users_dob_not_future (0002); se mantiene por consistencia. Consecuencia conocida:
-- una fila válida hoy lo sigue siendo mañana (la edad solo crece), así que el borde
-- no genera falsos rechazos retroactivos.
alter table public.users drop constraint if exists users_dob_not_future;
alter table public.users drop constraint if exists users_mayoria_de_edad;
alter table public.users add constraint users_mayoria_de_edad check (
  date_of_birth is null
  or date_of_birth <= current_date - interval '18 years'
);

-- ── 6) Teléfono: formato canónico E.164, luego único ────────────────────────
-- El orden importa: normalizar ANTES de de-duplicar, o dos escrituras del mismo
-- número en formatos distintos ('3312345678' y '+523312345678') se verían como
-- filas distintas y el de-dup las dejaría pasar.
--
-- 🔒 Por qué el CHECK y no solo la validación del cliente: `phone` está en el
-- `grant update (...) on public.users to authenticated` de 0008, así que cualquiera
-- con una sesión puede escribirlo por PostgREST saltándose el formulario. Sin este
-- CHECK, un PATCH con '33 1234 5678' persiste literal y convive en el índice único
-- con '+523312345678' — la misma persona con dos cuentas activas, que es justo lo
-- que §5.1 prohíbe. El índice único compara texto crudo: sin forma canónica no
-- garantiza nada.
update public.users
set phone = '+52' || regexp_replace(phone, '[^0-9]', '', 'g')
where phone is not null
  and phone !~ '^\+52[0-9]{10}$'
  and length(regexp_replace(phone, '[^0-9]', '', 'g')) = 10;

-- Lo que no se pudo canonicalizar (lada extranjera, longitud rara) se descarta:
-- dejarlo rompería el CHECK y con él toda la migración.
do $$
declare
  v_descartados int;
begin
  update public.users set phone = null
  where phone is not null and phone !~ '^\+52[0-9]{10}$';
  get diagnostics v_descartados = row_count;
  if v_descartados > 0 then
    raise notice '#72.2: % teléfonos no canonicalizables puestos en NULL.', v_descartados;
  end if;
end $$;

alter table public.users drop constraint if exists users_phone_e164_mx;
alter table public.users add constraint users_phone_e164_mx check (
  phone is null or phone ~ '^\+52[0-9]{10}$'
);

-- De-dup DEFENSIVO antes del índice: el seed local le pone el mismo teléfono a los 7
-- agentes (seed.sql: `update users set phone='+52...' where role='agent' and phone is
-- null`), así que sin esto el `create unique index` falla y la migración no aplica.
-- Criterio: gana la fila más antigua (created_at, id como desempate determinista);
-- las demás quedan con phone NULL. Se pierde un dato de contacto duplicado, que por
-- definición no identificaba a nadie.
do $$
declare
  v_afectadas int;
begin
  with ranked as (
    select id, row_number() over (partition by phone order by created_at, id) as rn
    from public.users
    where deleted_at is null and phone is not null
  )
  update public.users u set phone = null
  from ranked r
  where u.id = r.id and r.rn > 1;

  get diagnostics v_afectadas = row_count;
  if v_afectadas > 0 then
    raise notice '#72.2: % teléfonos duplicados puestos en NULL (gana la fila más antigua).', v_afectadas;
  end if;
end $$;

-- Índice parcial igual que users_email_unique_active (0002): el soft delete debe
-- liberar el teléfono para que otra persona pueda registrarlo tras la baja.
create unique index if not exists users_phone_unique_active
  on public.users (phone) where deleted_at is null and phone is not null;

-- ── 7) handle_new_user persiste los campos nuevos ───────────────────────────
-- Sin esto el formulario puede pedir fecha/estado/municipio y aun así perderlos: el
-- trigger solo copiaba id/email/phone/first_name/last_name, así que todo lo demás que
-- viaje en raw_user_meta_data (options.data de supabase.auth.signUp) se descartaba.
-- Los campos siguen siendo opcionales aquí: los flujos de invitación y los seeds crean
-- usuarios sin esta metadata y no deben romperse.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (
    id, email, phone, first_name, last_name,
    date_of_birth, state_id, municipality_id
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'phone', new.phone),
    coalesce(new.raw_user_meta_data ->> 'first_name', null),
    coalesce(new.raw_user_meta_data ->> 'last_name', null),
    -- ⚠️ El cast NO es tolerante y es a propósito: una fecha que no parsea aborta el
    -- registro con 22007 y GoTrue devuelve 500 sin crear nada. Rechazar es más seguro
    -- que guardar NULL en silencio, porque un NULL esquiva por completo el CHECK de
    -- mayoría de edad. La cadena vacía sí se tolera (nullif) para el caso legítimo de
    -- un flujo que no captura fecha — invitación de agente, seeds.
    nullif(new.raw_user_meta_data ->> 'date_of_birth', '')::date,
    nullif(new.raw_user_meta_data ->> 'state_id', ''),
    nullif(new.raw_user_meta_data ->> 'municipality_id', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'AFTER INSERT en auth.users: crea perfil espejo en public.users con role=user. Idempotente. Persiste date_of_birth/state_id/municipality_id desde raw_user_meta_data (#72.2).';
