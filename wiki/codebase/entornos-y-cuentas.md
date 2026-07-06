---
tipo: codebase
actualizado: 2026-07-04
---

# Entornos y cuentas — Urbea

Urbea corre contra **dos entornos Supabase** intercambiables desde `mobile/.env.local`. Este documento es la referencia de qué cuentas existen en cada uno y cómo saltar entre ellos.

## Cómo cambiar de entorno

`mobile/.env.local` trae ambos bloques; solo uno debe estar descomentado a la vez. Tras editar, **reinicia Metro con `-c`** (limpia caché):

```
# ── LOCAL (stack `supabase start`; emulador Android → host = 10.0.2.2) ──
EXPO_PUBLIC_SUPABASE_URL=http://10.0.2.2:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key del stack local>

# ── REMOTO (urbea-app; demo real) ──
EXPO_PUBLIC_SUPABASE_URL=https://mvpvqmyhrrkwbnpctpuq.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<publishable key del remoto>
```

- **LOCAL** requiere Docker + `supabase start` (aplica migraciones + corre `supabase/seed.sql`) y, si tocas Edge Functions, `supabase functions serve --import-map supabase/functions/deno.json`.
- **REMOTO** = proyecto `urbea-app` (ref `mvpvqmyhrrkwbnpctpuq`), es la demo real para el cliente — **no resetear**.
- Estado al 2026-07-04: `.env.local` apunta al **REMOTO** (bloque LOCAL comentado).

Todas las cuentas de ambos entornos comparten password **`urbea2026`**.

## Cuentas — LOCAL (`supabase start` + `seed.sql`)

`supabase/seed.sql` es idempotente (`if exists ... return`) y se corre solo, o vía `mobile/.maestro/run-e2e.sh` que resetea la BD. **No tiene cuenta admin.** 11 usuarios, 3 inmobiliarias:

| Rol | Email | Nombre | Inmobiliaria |
|-----|-------|--------|--------------|
| owner | `owner.gdl@urbea.demo` | Carlos Mendoza Ruiz | Inmobiliaria GDL Premium |
| agente | `agente1.gdl@urbea.demo` | Ana Flores García | Inmobiliaria GDL Premium |
| owner | `owner.oeste@urbea.demo` | Roberto Pérez Torres | Casas y Terrenos del Oeste |
| agente | `agente2.oeste@urbea.demo` | Valentina López Sánchez | Casas y Terrenos del Oeste |
| agente | `agente3.oeste@urbea.demo` | Miguel Herrera Jiménez | Casas y Terrenos del Oeste |
| owner | `owner.providencia@urbea.demo` | Patricia Gutiérrez Morales | Grupo Inmobiliario Providencia |
| agente | `agente4.providencia@urbea.demo` | Diego Ramírez Castro | Grupo Inmobiliario Providencia |
| buscador | `buscador1@urbea.demo` | Sofía Vargas León | — |
| buscador | `buscador2@urbea.demo` | Andrés Morales Díaz | — |
| buscador | `buscador3@urbea.demo` | Laura Jiménez Reyes | — |
| buscador | `buscador4@urbea.demo` | Fernando Castillo Núñez | — |

- **Código de invitación:** `DEMO2026` (agencia GDL Premium, usos ilimitados, sin expiración) — lo consume la suite Maestro (`registro.yaml`).
- 10 propiedades (3 inmobiliarias) con `created_at` escalonado (más nueva primero en el feed).
- Diseñado para la suite E2E Maestro (ver [[maestro_e2e_runner]] en memoria de sesión) — determinista y reseteable, no para explorar manualmente.

## Cuentas — REMOTO (`urbea-app`, proyecto `mvpvqmyhrrkwbnpctpuq`)

Sembrado completo el 2026-07-03 (tarea #37): mismo set de 11 cuentas que LOCAL (mismos emails `*@urbea.demo`) **más**:

- **`admin@urbea.demo`** — `role='admin'`, único admin del remoto. Para el panel `/admin`.
- **Código de invitación vigente:** `DEMO2026` (mismo plano que local, hash distinto en BD).
- 10 propiedades activas con **video real `ready`** en Storage (samples W3C).

Cuentas históricas previas al seed completo (siguen vivas, precedieron a la tarea #37):

- **`demo.agente@urbea.app`** — agente principal, dueño de las 2 propiedades activas originales.
- **`demo.agente2@urbea.app`** — "Mariana Solís", dueño de una propiedad en renta (Providencia GDL); sembrada para el E2E happy-path de `contact-agent`.

> Nota de dominio: las cuentas del seed completo usan `@urbea.demo`; las 2 históricas usan `@urbea.app`. Ambas conviven en el remoto.

## Ver también

- [[comandos]] — cómo levantar Metro, emulador, EAS.
- [[mapa-codebase]] §E2E — gotchas de la suite Maestro que consume las cuentas LOCAL.
- [[rls-seguridad]] — por qué el password de todas las cuentas es el mismo hash bcrypt sembrado a mano.
