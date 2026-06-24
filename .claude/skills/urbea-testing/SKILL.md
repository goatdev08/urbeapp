---
name: urbea-testing
description: Convenciones de testing de Urbea — qué y cómo testear según criticidad. Usar al escribir o verificar tests. Cubre Vitest/Deno para Edge Functions, pgTAP para RLS/constraints, testing-library/react-native + smoke para UI, las reglas anti-cheat, dónde viven los tests y cómo correrlos con pnpm. Disparar ante "test", "pgtap", "vitest", "cobertura", "tdd", "verificar".
---

# urbea-testing — testing por criticidad

TDD **pragmático**: estricto en lógica crítica, ligero en UI. Fuente: `docs/lineamientos-desarrollo.md`, `wiki/conceptos/rls-seguridad.md`.

## Qué es crítico (TDD estricto: RED → GREEN → guardian)
- **Edge Functions** (`supabase/functions/**`): canje de token, creación de lead, validación de publicación.
- **RLS / constraints / triggers** (`supabase/migrations/**`).
- Cualquier lógica de negocio con invariantes (🔒 del vault).

## Qué es no-crítico (verificación ligera)
- UI React Native, navegación, estilos, scaffolding/config → `pnpm tsc --noEmit` + `pnpm lint` + smoke (monta/compila).

## Framework por tipo
| Tipo | Framework | Ubicación |
|------|-----------|-----------|
| Edge Function / lógica TS | Vitest o Deno test | `supabase/functions/<dominio>/*.test.ts` |
| RLS / constraints / triggers | **pgTAP** | `supabase/tests/*.sql` (patrón `01_constraints_test.sql`, `02_rls_test.sql`) |
| Componente con interacción | `@testing-library/react-native` (en Vitest) | junto al componente |

## Reglas anti-cheat (las verifica el `guardian`)
- Un `it`/assert por caso enumerado; nombre con keyword única.
- Aserciones **fuertes** (`toBe`, `toEqual`, `toThrow`; pgTAP `is`, `throws_ok`). Nada de `toBeDefined`/`toBeTruthy` por defecto.
- **Nunca** `it.skip`/`xit`/`it.todo`. **Nunca** mock del SUT (solo de dependencias externas).
- No bajar el conteo de tests entre RED y GREEN. No `catch {}` silencioso en el código.

## Edge cases en la subtarea (no journal)
El `test-author` enumera los casos en la subtarea de Taskmaster (`update-subtask` → `EDGE CASES (RED):`). El `guardian` los lee con `task-master show <id>.<n>`. Mantén esa sección como fuente de cobertura.

## Correr
- `pnpm test --run` / `pnpm test <archivo>` · `pnpm tsc --noEmit` · `pnpm lint`.
- pgTAP local: `supabase test db`. No aplicar al remoto sin indicación.

## Naming
`snake_case` en helpers/factories de test; nombres de casos en español si describen negocio.
