---
tipo: moc
dominio: fuentes
---

# 🧭 MOC Fuentes (raw sources)

Mapa de las **fuentes de verdad** (inmutables). El vault las destila y conecta; aquí está el catálogo para ir al **detalle exhaustivo**.

## Producto / negocio — `docs/`
| Documento | De qué trata | Ir aquí para… |
|-----------|--------------|---------------|
| `docs/PRD.md` | PRD oficial, 35 secciones (producto completo) | redacción exacta de un requisito; §4 roles, §7 onboarding, §9 feed, §12-13 propiedades/video, §15 estados, §17 monetización, §19 CRM |
| `docs/PRD-MVP-demo.md` | **Alcance de la demo** (lo que se construye ahora) | qué entra/sale de la demo; criterios de aceptación; plan 3 semanas |
| `docs/lineamientos-desarrollo.md` | Convenciones técnicas, capas, antipatrones | cómo se escribe código (Edge Functions, RLS, triggers, testing, seguridad) |
| `docs/propuesta-cliente/03-mvp-recomendado.md` | El MVP recomendado | el norte de producto ([[0001-alcance-mvp-recomendado]]) |
| `docs/propuesta-cliente/02-analisis-de-mercado-y-modelo-de-negocio.md` | Competencia y modelos de negocio | por qué se eligió pago-por-video ([[0002-monetizacion-pago-por-video]]) |
| `docs/propuesta-cliente/01-comparativa-de-alcance.md` | Evolución del alcance (idea→PRD) | contexto histórico del proyecto |
| `docs/propuesta-cliente/propuesta-desarrollo-mvp.md` | Propuesta formal (stack, cronograma, costos) | cifras y cronograma originales |
| `docs/analisis-alcance.md`, `docs/por-definir.md`, `docs/Alineacion.md` | Análisis de viabilidad / preguntas abiertas / visión inicial | decisiones de producto aún abiertas |

> `urbeapp-plan/` contiene material legacy/duplicado (propuestas en HTML/PDF). No es fuente primaria.

## Backend — `supabase/`
| Fuente | De qué trata | Ir aquí para… |
|--------|--------------|---------------|
| `supabase/README.md` | Estado de la DB, alcance e exclusiones | qué incluye/excluye el esquema |
| `supabase/migrations/0001`–`0010` | Esquema completo (20 tablas, enums, RLS) | el SQL exacto. Índice en [[db-schema-map]] |
| `supabase/tests/01_constraints_test.sql` | 13 asserts de constraints/triggers | qué invariantes están probadas |
| `supabase/tests/02_rls_test.sql` | 15 asserts de RLS por rol | qué visibilidad está probada |

## Cómo se usa
1. Consulta → [[index]] → concepto(s) (síntesis densa).
2. ¿Necesitas el detalle literal? → el concepto te da el puntero (sección/migración) → vienes aquí.

Ver también: [[00-MOC-home]] · [[db-schema-map]] · [[mapa-codebase]]
