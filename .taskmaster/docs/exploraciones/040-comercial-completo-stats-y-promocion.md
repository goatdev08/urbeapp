---
tipo: proyecto      # feature | fix | refactor | chore | proyecto
nivel: L            # 4 bloques: 209 (ya existía) → 210+211 → 201+212 → 213
fecha: 2026-08-23
estado: aprobado    # decisiones tomadas por Abraham en entrevista /grilling, 2026-08-23
tarea_id: 209, 210, 211, 201, 212, 213   # 209 y 201 ya existían; 210-213 nacen de este doc
motivo_descarte:
---

# Cierre del circuito comercial: upgrade con UI, controles de emergencia, dashboard estilo Meta y "promocionar propiedad"

> Documento de exploración/planeación. Origen: sesión de planeación con `/grilling`
> (2026-08-23), 9 decisiones de Abraham registradas abajo como restricciones fijas.
> Continúa la exploración 039 (cuenta comercial / anunciantes).

## Idea original

Abraham (2026-08-23, verbatim condensado): «dejar completa la cuenta comercial y la
integración con el panel de admin — lo más seguro es que aún no haya webhooks para
conectar todas las acciones a nivel base de datos»; «ver estadísticas de cada
publicación en un dashboard, tipo Meta Ads» (con 2 screenshots de Meta Ads Manager
como referencia: card con 3 métricas por campaña, detalle con selector de periodo
Hoy/30 días/Máximo y gráficos); «documentar las funciones que realmente están
listas para usarse por una interfaz»; y en la entrevista pivoteó a explorar
«promocionar la publicación, permitido a todos los usuarios para sus publicaciones,
y que el panel sea accesible si pagaste por anunciar algo».

## Hallazgo central de la investigación

**No faltan webhooks — el patrón del repo es EF + RPC atómica, y casi todo el
backend existe.** Lo que falta es *cableado de interfaz* sobre máquinas de estado
ya probadas, y dos RPCs de lectura nuevas (por anuncio / por día). Ver inventario.

## Inventario: qué backend está listo para una interfaz (2026-08-23)

### Ya cableado (backend + UI funcionando)
| Función | Llamador | Tarea |
|---|---|---|
| `create_ad_campaign_atomic` (RPC) | wizard 5 pasos `(protected)/ads/new` | #191 |
| EF `moderate-ad` (approve/reject desde pending_review) + `moderate_ad_atomic` | `/admin/ads` + `useModerateAd` | #208 ✅ desplegado |
| EF `record-ad-impressions` (impresión, vista completa, tap CTA) | feed | #207 |
| `ad_metrics_for_agency` (RPC, zonas k≥5) | `useAdMetrics` → `(protected)/ads/index` | #171 |
| EF `mint-ad-urls` (incl. rama admin) | feed + `/admin/ads` | #170/#208 |
| EF `admin-create-agency` (acepta `can_advertise`/`advertiser_category`) | `/admin/agencies/create` — **pero el formulario NO manda esos campos** | #168 (hueco → 209.2) |

### Listo a nivel DB, SIN ningún llamador (el cableado es este plan)
| Capacidad DB (probada con tests) | Hueco | Tarea |
|---|---|---|
| `set_org_advertising_atomic` (enciende/apaga `can_advertise` + audita) | sin EF ni UI | **#209** |
| Máquina ads `active → {paused, rejected}` (takedown; pausar congela el reloj D2) | EF `moderate-ad` solo expone pending_review | **#210** |
| Máquina agencies `active ↔ suspended` + cascada (pausa/revive sus anuncios, 169.2) | sin EF ni botón en `/admin/agencies/[id]` | **#211** |
| `ad_impressions_monthly` (llave UNIQUE NULLS NOT DISTINCT lista para upsert) | 0 escritores; la purga a 90 días YA corre en prod | **#201** |
| `ad_cta_type = external_url \| whatsapp \| phone` | ya soportados por wizard y feed — los "tipos" que pedía Abraham **ya existen** | n/a |

## Decisiones de la entrevista (restricciones fijas, 2026-08-23)

1. **Panel admin = in-app móvil** (extender `mobile/app/admin/`). #81 (web Next.js) sigue diferido.
2. **Self-serve pagado = norte de fase 2**, PERO se adelanta YA el producto
   **"promocionar propiedad" gratis** (gate = moderación, no pago). El cobro
   (#172 + Stripe #84) desbloqueará en fase 2 el self-serve completo.
3. **Gate de la promo: abierta a toda organización publicadora.** Cualquier
   miembro con permiso de publicar promociona una propiedad YA publicada de su
   org. `can_advertise` queda como gate SOLO de anuncios display (creative
   propio + CTA) — dos productos, dos gates, modelo Meta (boost vs Ads Manager).
4. **Forma de la promo: propiedad normal + badge "Anuncio".** Mismo video de la
   propiedad, fuera de ranking; al tocar → detalle/contacto/flujo de leads
   normal. Sin CTA nuevo ni creative nuevo. El tap de contacto cuenta como
   `cta_tap` en métricas.
5. **Configuración de la promo: ninguna.** Municipio heredado de la propiedad +
   30 días fijos, flujo de UN paso (elegir → confirmar → pending_review). El
   selector de alcance llega con el cobro (fase 2).
6. **Privacidad de la serie diaria: regla limpia "zona ⇒ k≥5; sin zona ⇒ libre".**
   Totales diarios por anuncio SIN dimensión geográfica van sin umbral; CUALQUIER
   desglose por zona mantiene k≥5 + bucket "otras zonas" (garantía de #171 intacta).
7. **Gráficos v1 del detalle: línea diaria (3 métricas, selector) + barras por
   zona (k≥5)** + selector de periodo Hoy / 30 días / Máximo. Sin pie/dona.
   Dibujados con `react-native-svg` (ya instalada) — **cero dependencia nueva**.
8. **Alcance admin del plan: #209 + takedown de anuncio activo + suspender
   organización.** Stats globales para admin: diferido (en beta se ve por SQL).
9. **#201 entra en este plan** (rollup antes de que haya tráfico real). En el
   dashboard, granularidad diaria ≤90 días y mensual más atrás, sin doble contar.
10. **Orden de ejecución: #209 → (#210+#211) → (#201→#212) → #213.** Los botones
    de emergencia existen ANTES de encender `ads_enabled`; el dashboard existe
    antes de que la promo genere tráfico.

Decisiones menores anotadas (tomadas por Virgilio, revisables): la entrada al
panel del anunciante se vuelve visible si `can_advertise` **o** la org tiene ≥1
anuncio (hoy exige `can_advertise`); los cards de la lista calcan los 3 números
del screenshot de Meta (impresiones / vistas completas / taps de contacto-CTA).

## Bloques → tareas

- **Bloque 1 — #209** (ya planeada, 4 subtareas): EF `set-org-advertising` + campos
  en alta + toggle en detalle de la org. Sin cambios por esta exploración.
- **Bloque 2 — #210 takedown + #211 suspensión org**: cableado de emergencia sobre
  máquinas existentes. Dos tareas = dos ramas/PRs enfocados.
- **Bloque 3 — #201 rollup → #212 dashboard**: RPCs por anuncio (totales para
  cards, serie diaria sin zona, zonas k≥5), diseño aprobable (preview HTML,
  referencia Meta + identidad Urbea), componentes SVG, pantallas.
- **Bloque 4 — #213 promocionar propiedad**: `ads.property_id` (aditiva:
  columna nueva + `creative_id` nullable + CHECK exactamente-uno),
  `promote_property_atomic`, feed resuelve video desde `property_videos`,
  botón "Promocionar" + confirmación, misma cola de moderación.

## Fase 2 (norte documentado, NO entra ahora)

Pagar desbloquea: self-serve para cualquier usuario, selector de alcance
(colonia/municipio/nacional, `ad_prices` ya sembrada), panel accesible por haber
pagado, CPM/CPC/subasta/pacing/antifraude (#172), Stripe (#84). Nada de este plan
se retrabaja: la promo gratis se convierte en la promo pagada cambiando el gate.

## Riesgos / producción viva (§0.5)

- Todo aditivo; `ads_enabled=false` sigue siendo el interruptor global.
- #213 relaja `creative_id` a nullable: migración expand (columna + CHECK), sin
  romper `select('*')` de builds instalados.
- Las RPCs nuevas de lectura calcan el patrón anti-IDOR fail-closed de
  `ad_metrics_for_agency` (0 filas, nunca excepción; sin PII en la respuesta).
- #201 corre ANTES de tráfico real: recompute idempotente de mes completo,
  programado ANTES de la purga de las 9 UTC.
