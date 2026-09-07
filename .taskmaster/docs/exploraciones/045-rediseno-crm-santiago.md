---
tipo: proyecto
nivel: XL
fecha: 2026-09-05
estado: aprobado
tarea_id: 266, 267, 268, 269, 270, 271, 272, 273, 274
motivo_descarte:
---

# Rediseño visual y de datos del CRM (diseño externo de Santiago)

> Documento de exploración/planeación de `/tm-explore`. **2ª pasada**: Abraham respondió las 15
> preguntas abiertas; todas están resueltas en §18 "Decisiones del intake" y propagadas al resto del
> doc. No queda ningún `{? pregunta abierta}`.
> Fase de PROPUESTA — ponytail NO aplica (CLAUDE.md §0). Vuelve a aplicar al `/tm-plan` de cada tarea.
> NO edita los PRD maestros.

## Idea original

> Rediseño visual y de datos del CRM según el diseño externo de Santiago (`Pantallas del CRM de
> Urbea.html`, raíz del repo: 6 pantallas — Embudo, Bandas de urgencia, Ficha del lead, Vista de
> agencia, Estados vacíos, Sistema).
>
> Requisitos del dueño: **(1)** quedar lo más similar posible al diseño; **(2)** considerar el
> backend existente para mostrar o calcular cada dato; **(3)** calidad y eficiencia de los datos
> mostrados — es ventaja competitiva frente a otras apps inmobiliarias (nada de agregados en
> cliente sobre listas completas, nada de N+1, datos frescos y correctos).

Insumo previo: `.taskmaster/docs/exploraciones/_insumo-crm-inventario-2026-09-05.md`.

---

## 0. Qué dibuja el diseño (extracción literal, 6 frames de 393×852)

**Tokens del diseño** (`<style>` + bloque `.note`): fondo `#F5F2EC` · superficie `#FFFFFF` ·
campo `#EDE7DD` · bordes `#E4DED2`/`#D3CABA` · verde `#1A5E44` · chip verde `#DEE8E1` ·
tinta `#1D1A15`/`#55524B`/`#6F6A61` · WhatsApp `#A8EDC1` sobre `#123A2C`.
Tipografía **Outfit** (300–800) para interfaz y titulares, **DM Mono** (400/500) para *todo número y
etiqueta de dato*. La nota del propio diseño dice: *"La escala de temperatura (#A8401A, #8A6A1E,
#1A5E44, #5F6D67) es lo único nuevo"* y *"los pesos por señal y el decaimiento son un punto de
partida — hay que ajustarlos con datos reales de la beta 2.0"*.

**Frame 0 · Embudo** — H1 `CRM` + sub `Leads de tu equipo` + icono ☰ · segmentado **Míos / Equipo** ·
**respuesta narrativa** (23.5 px/700): *"**3 personas** están listas para que les hables."* + *"Y **2
se están enfriando** — Ramos pierde 5° al día desde su visita agendada."* · **tarjeta de embudo**
(`Tu embudo · 30 días`, `1.6% agenda`) con SVG de 5 tramos y gradiente gris→verde→arena→terracota,
5 KPIs en DM Mono (**312** Vieron tu contenido · **96** Volvieron · **34** Guardaron · **12** Te
escribieron · **5** Agendaron) y 4 caídas (−69 / −65 / −65 / −58 %) · cabecera de banda · fila de
lead · tab bar de 5 slots (Feed · Mapa · [+] · **Leads** · Perfil).

**Frame 1 · Bandas de urgencia** — 3 bandas: **Háblales hoy** (`#A8401A`, 3, *"Señal fuerte en las
últimas 24 h"*) · **Se están enfriando** (`#8A6A1E`, 2, *"Estuvieron listos y nadie los alcanzó"*) ·
**Calentando** (`#1A5E44`, 3, *"Suben, pero aún no levantan la mano"*). El frame 5 define una 4ª,
**En silencio** (`#5F6D67`), que ninguna pantalla dibuja.

**Fila de lead** (grid `3px 46px 1fr auto`) — riel de 3 px del color de banda · **avatar 46 px con
anillo cónico al % de temperatura** e iniciales · nombre + *"hace 12 min"* · **frase narrativa** ·
**5 iconos de señal** (`opacity 1` presente / `.26` ausente) con contador en el primero ·
**sparkline de 14 barras diarias** (68×18) · **grados** (19 px DM Mono, `94°`) y **delta**
(`+22 hoy` / `−5 al día` / `+11 en 3 d`).

**Frame 2 · Ficha del lead** — *"se abre en el mismo renglón, sin cambiar de pantalla"*: tarjeta de
propiedad de origen (thumb 38 px, dirección, precio, `Ver`) · *"También sigue **2** propiedades tuyas
más"* · **`LO QUE HIZO`** (timeline con bullets: `Hoy 11:42 Abrió tu WhatsApp sin escribir` /
`Hoy 11:38 Vio Bugambilias — 4ª vez, 92%`) · **`ESTADO`** = barra de **4 tramos** + *"Siguiente:
marcar como **Contactado**"* · caja verde **`MENSAJE SUGERIDO`** · 3 botones (**WhatsApp** · **Llamar**
· **Agendar**) · `+ Agregar nota interna`.

**Frame 3 · Vista de agencia** — *"**10 leads calientes** llevan horas sin que los toquen. 3 de ellos
**no tienen agente asignado**."* · banda **Sin dueño** con filas `avatar · nombre · ENTRÓ hace 18 min ·
TEMP 91° · frase` + botón **`ASIGNAR`** · banda **Tus agentes** con `SIN TOCAR 4 · RESPONDE 3h 20m ·
SUS LEADS 44°` + badge **`PIERDE LEADS`** / **`ACUMULA`**.

**Frame 4 · Estados vacíos** — *"Aún no hay señal que leer"* (+ CTA `Subir una propiedad`) y
*"Nadie pendiente por hoy"*.

**Frame 5 · Sistema** — el spec: 4 colores de estado · escala 0–29 frío / 30–59 tibio / 60–79 caliente
/ 80–100 muy caliente · *"la banda la decide la tendencia, no solo el número"* · pesos (video completo
**×10 máx 5** · like **×5** · guardó **×18** · abrió WhatsApp **×30** · buscó la zona **×8**) ·
*"la suma se normaliza a 0–100"* · decaimiento **8 % del acumulado por día**.

⚠️ **Incoherencia interna del diseño — RESUELTA por decisión (§18/D5):** su escala de 4 colores asigna
color por número (55° = tibio = verde) pero sus filas pintan a Mariana con 55° en arena (banda
"enfriando"). Decisión: **el color de la FILA lo manda la banda (tendencia); la escala de grados solo
colorea el NÚMERO.**

---

## 1. Lluvia de ideas — direcciones consideradas y elegidas

Se exploraron tres divergencias. Las elegidas están marcadas ✅; las descartadas se conservan con el
motivo, que es el valor durable del documento.

### 1.A — Capa de datos · **elegida: D1 + D3**

| # | Dirección | Veredicto |
|---|---|---|
| **D1** ✅ | **RPC agregada por agente/agencia, paginada por banda** (cursor por banda), calculada on-the-fly desde `events_raw` + `likes` + `saves` + `leads` + `lead_status_history` | **elegida.** Frescura en tiempo real, que es lo que el copy promete ("hace 12 min", "últimas 24 h"). Molde exacto: `ad_metrics_for_agency` |
| **D3** ✅ | **Snapshot diario `lead_temperature_daily`** por `pg_cron`; el valor de HOY se calcula en vivo | **elegida como complemento.** Da gratis el sparkline de 14 días y el delta sin recorrer eventos 14 veces por fila. Molde: `rollup_ad_impressions_monthly` + `check_rollup_health` |
| **D2** | Vistas materializadas + `REFRESH` por cron | **descartada.** Su latencia contradice el producto; además las MV **no respetan RLS** y obligarían a envolverlas igual en una RPC |
| **D4** | Denormalizar `temperature`/`last_activity_at` en `leads` por trigger | **descartada.** Sin histórico no hay sparkline ni tendencia — y la tendencia es el eje del diseño. Además hereda #108 y #110(a) |

### 1.B — Modelo de temperatura · **elegida: T1**

| # | Alternativa | Veredicto |
|---|---|---|
| **T1** ✅ | **Decaimiento continuo calculado en LECTURA**: cada señal pesa `wᵢ · (1 − decay)^(días desde su timestamp)`; `temp = min(100, Σ)` | **elegida.** Sin estado nuevo que escribir → **#108 deja de bloquear** (no hay columna que un agente pueda inflar por REST). Recalibrar pesos **reescribe la historia entera** porque es una función pura. Hace literalmente cierto el copy *"pierde 5° al día"* |
| **T2** | Snapshot diario acumulativo (`temp = temp_ayer·0.92 + señales_del_día`) | **descartada como modelo** (sí se usa como *caché* en D3): recalibrar los pesos no reescribe el pasado y quedaría una historia con dos físicas |
| **T3** | Ventana móvil de 7 días sin decaimiento | **descartada.** La más explicable, pero pierde la metáfora del enfriamiento continuo que el copy usa en 3 lugares |

### 1.C — Alcance del radar · **elegida: R2 (radar anónimo)**

El diseño muestra, con nombre y foto, a personas que **no han contactado** al agente (banda
*Calentando*, banda *Sin dueño*, estado vacío del radar). Eso choca de frente con PRD §19.1/§19.2
*"registrar ≠ exponer"*, con la fuga que se cerró en 75.3 (medida en producción con JWT real) y con
el aviso de privacidad que personas reales ya aceptaron.

| # | Dirección | Veredicto |
|---|---|---|
| **R2** ✅ | **Radar anónimo**: las personas sin lead aparecen solo como **filas sin identidad** en *Calentando* y agregadas en el embudo | **elegida.** Es "registrar ≠ exponer" aplicado con precisión: se publica la **señal**, no la persona |
| **R1** | Puertas cerradas: bandas solo sobre leads | **descartada** — entregaba menos de lo posible sin ganar seguridad real frente a R2 |
| **R3** | Cambiar la promesa y exponer identidad de prospectos | **descartada.** Exige aviso nuevo, re-consentimiento de todos y revertir 75.3. No es una decisión de ingeniería |

---

## 2. Problema / Motivación

El CRM de hoy es **una lista ordenada por un puntaje que no se pinta**. Sabe *qué estado* tiene cada
lead, no *a quién hay que hablarle ahora*:

1. **No prioriza.** Ordena por `score` (sin índice que lo sirva: `leads_agent_crm_idx` es
   `(agent_id, status, last_contact_at desc)`) y agrupa por *estatus*, que es taxonomía
   administrativa, no urgencia.
2. **No mide el embudo.** Nadie ve cuánta gente vio, volvió, guardó y contactó.
3. **Los datos se calculan en el cliente.** Conteo por tab, búsqueda, "En seguimiento", "hace X" y
   los agregados del perfil se computan en JS **sobre la lista entera sin paginar**
   (`useAgentLeads.ts:249-288`, `CRMScreen.tsx:126-132,177-180,186-200`,
   `useAgentStats.ts:105-111`). Contradice de frente el requisito (3) del dueño.
4. **La temperatura existe pero está apagada.** `leads.score`/`level` viven en la base desde #75.2 y
   se **retiraron de la UI en #112** por decisión del dueño (*"no lo clasifiques como tibio/caliente,
   hay que separarlo en estadísticas tangibles"*). Este rediseño la reintroduce **resolviendo la
   objeción original**: ya no es un índice opaco, es un número con **tendencia, sparkline y la frase
   que lo explica**.

Encaje con el hito: la demo cerrada de 3 semanas quedó atrás; hoy hay **producción viva** desde
2026-08-10 con personas reales conectadas ([[0009-produccion-viva]]). Todo aquí se piensa para
producción, no para la demo.

## 3. Resultado esperado

El agente abre **Leads** y lo primero que lee es una **frase**, no una tabla: *"3 personas están
listas para que les hables"*. Debajo, su embudo de 30 días con números calculados en el servidor.
Debajo, sus leads agrupados por **lo que hay que hacer**, cada uno con grados, tendencia, sparkline y
la frase que explica por qué. Toca uno y la ficha **se abre en el mismo renglón**: qué hizo, en qué
punto del embudo está, mensaje sugerido y tres botones. En *Calentando* aparecen además **filas
anónimas**: señal sin persona. El owner cambia a **Equipo** y ve qué se está escapando.

Y todo se sirve con **≤2 llamadas paginadas por pantalla**, cero agregados en cliente y cero N+1.

## 4. Alcance

- **SÍ entra:** capa de datos agregada y paginada (RPC nuevas) · modelo de temperatura T1 con
  decaimiento, tendencia y bandas · **radar anónimo (R2)** · las 4 pantallas del agente (embudo,
  bandas, ficha inline, vacíos) · captura de `%` de reproducción y `zone_search` · vista de agencia
  con "sin gestor", asignación y métricas de agente · saldar la deuda de eficiencia 1–7 y 11 del
  insumo (es *el mismo código* que se reescribe) · índices, snapshot diario y **retención de
  `events_raw`**.
- **NO entra:** tocar el enum `lead_status` (proyección 8→4 solo en lectura) · exponer identidad de
  prospectos (R3) · el aviso de privacidad completo ([[legal-consentimientos]]) · agenda real de
  visitas (derivada F) · #116 (fuga de `users_select`, va por su cuenta) · export CSV y retención de
  leads (derivada de 75.7).

## 5. Roles afectados

- **Comprador (buscador):** no ve nada nuevo en su app, pero **cambia lo que se registra de él**
  (`%` de reproducción, `zone_search`) y aparece —**sin identidad**— en el radar de los agentes cuyas
  propiedades mira. La identidad solo se revela cuando él contacta.
- **Agente:** destinatario principal; cambia su pantalla más usada de arriba abajo.
- **Owner / admin de inmobiliaria:** gana la vista de agencia (fase E) con dos capacidades nuevas:
  **asignar** un lead y **medir a sus agentes**. ⚠️ Hoy es **solo lectura** sobre leads ajenos
  (`update-lead-status` filtra `.eq('agent_id', caller)` → 403; 2 asserts pgTAP custodian que #75.5
  solo amplió SELECT). Extender la escritura es **#31, diferida**, y la fase E la reabre.
- **Admin de plataforma:** sin cambios. **No reabrir #226** (el admin sin relación con la agencia veía
  todo el pipeline; sellado en `20260901000001` + `scope` explícito).

---

## 6. Tabla maestra: dato → pantalla → fuente hoy → veredicto → dónde se calcula → fase

Veredicto: **EXISTE** · **AGREGA** (materia prima disponible, falta agregar en backend) ·
**CAPTURA** (señal nueva) · **DECIDIDO** (resuelto en §18, con la forma final anotada).

### 6.1 Cabecera y navegación

| Dato | Pantalla | Fuente hoy | Veredicto | Dónde se calcula | Fase |
|---|---|---|---|---|---|
| H1 `CRM` + sub | 0–4 | `CRMScreen.tsx:256` ya dice `CRM` | EXISTE | — | D |
| Tab `Leads` | todas | **ya dice `Leads`** (`AndroidTabsLayout.tsx:121`, `IosNativeTabsLayout.tsx:219`) | EXISTE — **nada que renombrar** | — | — |
| Segmentado **Míos / Equipo** | todas | `useAgencyRole.canViewTeam` + `AgentSelector` (rail de chips) | EXISTE, cambia de forma | cliente | D (Míos) / E (Equipo) |
| Icono ☰ | 0–4 | — | **DECIDIDO**: en la 1ª entrega abre una **hoja mínima** con buscador por nombre **server-side** (`p_query` en la RPC). La hoja completa de filtros = derivada `producto()` | RPC + cliente | D |

### 6.2 Embudo de 30 días (frame 0)

| Dato | Fuente hoy | Veredicto | Dónde se calcula | Fase |
|---|---|---|---|---|
| **312** Vieron tu contenido | `events_raw.video_view` ⨝ `properties.owner_user_id` | AGREGA — `count(distinct user_id)`, 30 d. ⚠️ `events_raw.agent_id` **nunca se escribe** (`useVideoEngagementEvents.ts` inserta solo `event_type,user_id,property_id,property_video_id,session_id`) → el join va por `properties` | `crm_funnel()` | A |
| **96** Volvieron | mismo, con ≥2 `session_id` distintos | AGREGA — el `session_id` por apertura de app existe y es exactamente esto | `crm_funnel()` | A |
| **34** Guardaron | `saves` ⨝ `properties` del agente | AGREGA | `crm_funnel()` | A |
| **12** ~~Te escribieron~~ → **`Te contactaron`** | `leads` creados en 30 d | **DECIDIDO** (§18/D6): Urbea no puede saber si *escribió* (el deep link sale de la app); el KPI se llama **"Te contactaron"** | `crm_funnel()` | A |
| **5** Agendaron | `lead_status_history` con `new_status='visit_scheduled'` en 30 d | AGREGA — append-only por trigger, con timestamps | `crm_funnel()` | A |
| Caídas y `1.6% agenda` | derivadas de los 5 escalares | EXISTE — 5 divisiones sobre datos ya agregados: **esto sí es presentación** | cliente | D |

### 6.3 Fila de lead (frames 0, 1, 2)

| Dato | Fuente hoy | Veredicto | Dónde se calcula | Fase |
|---|---|---|---|---|
| Nombre, avatar, iniciales | embed `users!leads_user_id_fkey` (RLS `can_view_user_as_lead_searcher`, #30) | EXISTE | `crm_leads_page()` | A |
| `hace 12 min` | `get_lead_stats.ultima_actividad` (hoy la card usa `updated_at`) | EXISTE, mal cableado | backend da el timestamp; `format_relative_time` formatea | A/D |
| Riel + color de banda | — | AGREGA (§7.3) | `crm_leads_page()` | A |
| Anillo cónico al % | — | AGREGA | RPC + SVG | A/D |
| **`94°`** | `leads.score` (10+4·saves+1·likes, sin decaimiento ni normalización, retirado en #112) | AGREGA — modelo T1 nuevo; **el viejo se conserva** (apps 1.0.3 lo leen) | `crm_leads_page()` | A |
| **Delta** | — | **DECIDIDO** (§18/D5): **una sola ventana**, `temp(hoy) − temp(hoy − crm_trend_window_days)`; la redacción (`+22 hoy` / `−5 al día` / `+11 en 3 d`) la elige el cliente por signo y magnitud | RPC (número) + cliente (copy) | A/D |
| **Sparkline de 14 barras** | — | AGREGA — `lead_temperature_daily` (D3) | RPC | A |
| Frase narrativa | `get_lead_stats` da `veces_visto`/`guardo`/`vio_completo`; dirección vía `lead_origin_properties→properties` | **DECIDIDO** (§18/D7): **hechos del RPC + plantilla en cliente** (probada con Jest) | hechos: RPC · copy: cliente | A/D |
| Señal 1 · vio N veces | `events_raw.video_view` | EXISTE | RPC | A |
| Señal 2 · vio completo | `events_raw.video_completed` (≥0.95 por `timeUpdate`) | EXISTE | RPC | A |
| Señal 3 · guardó | `saves` | EXISTE | RPC | A |
| Señal 4 · contacto | la existencia del lead lo implica | **DECIDIDO** (§18/D4): **piso de entrada + repeticiones** — el icono se enciende siempre (es un lead), pero el **peso** solo lo suman los contactos repetidos o sobre otra propiedad (§7.2) | RPC | A (+ C para `contact_repeat`) |
| Señal 5 · buscó la zona | ninguna | **CAPTURA** — evento `zone_search`; `events_raw.event_type` es **`text` libre** (`20260604000007:9`) → cero migración de enum | cliente escribe · RPC agrega | **C** (2º) |

### 6.4 Ficha del lead (frame 2)

| Dato | Fuente hoy | Veredicto | Dónde se calcula | Fase |
|---|---|---|---|---|
| Tarjeta de propiedad de origen | `lead_origin_properties→properties→property_videos`; `LeadCard` ya pinta thumbnail | EXISTE ⚠️ el **precio** es nuevo aquí: es propiedad del propio agente, así que `price_visible` no aplica — **verificarlo, no asumirlo** (precedente: se filtró un precio oculto por el template §19.3) | RPC | A/D |
| *"También sigue **2** propiedades tuyas más"* | `likes`/`saves`/`events_raw` ⨝ `properties` del agente | AGREGA ⚠️ `get_lead_stats` **solo mira la propiedad de ORIGEN** (`distinct on (lead_id) … order by contacted_at asc`) | `crm_lead_detail()` | A |
| Timeline `LO QUE HIZO` | `events_raw` + `likes` + `saves` + `lead_status_history`, todos con `created_at` | AGREGA — unión ordenada y paginada | `lead_activity()` | A |
| `— 4ª vez, **92%**` | solo hay booleano ≥0.95 | **CAPTURA** — `payload:{progress}` en `video_completed` (`payload jsonb default '{}'`, aditivo) | cliente escribe | **C** (1º) |
| Barra de **4 estados** | enum de 11 valores (8 vigentes + 3 legacy) | **DECIDIDO** (§18/D11): **proyección 8→4 en LECTURA** (§7.4). No se toca el enum ni la EF | mapa compartido | D |
| *"Siguiente: marcar como…"* | transiciones **LIBRES** desde #75.1 | **DECIDIDO** (§7.4): regla explícita por estado proyectado | cliente → EF existente | D |
| Desplegable fino de los 8 | ✅ **YA EXISTE** — #117 **done**: `LeadExpandedView.tsx:387-482`, accesible (`accessibilityState.expanded`) | EXISTE — **reuso directo** | cliente | D |
| **`MENSAJE SUGERIDO`** | — | **DECIDIDO** (§18/D7): **armado en el SERVIDOR** (EF), precedente duro §19.3 *"el template no es editable por el agente"* — y ahí se filtró un precio por armarlo mal | EF | D |
| Botón **WhatsApp** | `open_whatsapp()` en `LeadExpandedView` | EXISTE | cliente | D |
| Botón **Llamar** | `users.phone` ya viaja al CRM | EXISTE — `Linking.openURL('tel:')`; ⚠️ agente **suspendido** pierde el teléfono (`phone === null`, #202) → mismo `disabled` que WhatsApp | cliente | D |
| Botón **Agendar** | — | **DECIDIDO** (§18/D8): **fase 1 = marca `visit_scheduled`** con la EF existente; agenda real = derivada F | cliente → EF existente | D |
| `+ Agregar nota interna` | EF `update-lead-note` | EXISTE | EF | D |

### 6.5 Radar anónimo (banda *Calentando*) — **nuevo, decisión R2**

| Dato | Fuente | Veredicto | Dónde se calcula | Fase |
|---|---|---|---|---|
| Frase *"Alguien repitió 4 veces tu video de Providencia y lo guardó"* | `events_raw` + `saves` + `likes` ⨝ `properties` del agente, **de personas SIN lead con ese agente** | AGREGA — **agregado antes de salir de la base** | `crm_radar_anon()` | A |
| Grados + tendencia | mismo modelo T1 | AGREGA | `crm_radar_anon()` | A |
| Identidad | 🔒 **NO EXISTE en el payload** — sin `user_id`, sin nombre, sin avatar, sin ningún identificador estable (§7.5) | DECIDIDO | — | A |
| Acción de contacto | 🔒 **no hay** — no hay a quién escribirle | DECIDIDO | — | D |

### 6.6 Vista de agencia (frame 3) — fase E

| Dato | Fuente hoy | Veredicto | Fase |
|---|---|---|---|
| Narrativa *"10 leads calientes sin tocar"* | leads de la agencia (`leads.agency_id`, `20260807000006`) sin cambio de estado desde su alta | AGREGA | E |
| Banda ~~Sin dueño~~ → **"Sin gestor"** | 🔴 `leads.agent_id` es `not null` y sale de `properties.owner_user_id`: **todo lead tiene dueño**. **DECIDIDO** (§18/D9): se reinterpreta con el mecanismo de **#203** (agente `suspended`, notificación `lead_unmanaged`, `set_lead_agency_id` cae a la membresía suspendida) | AGREGA | E |
| `ENTRÓ hace 18 min` | `leads.first_contact_at` | EXISTE | E |
| Botón **`ASIGNAR`** | existe `reassign_member_properties_atomic` **para propiedades**, cuyo comment dice explícito *"los leads EXISTENTES no cambian de interlocutor (fase 2 con aviso al buscador)"* | **DECIDIDO** (§18/D10): RPC `reassign_lead_atomic` **con aviso al buscador**, reabriendo **#31** dentro de E. **En la 1ª entrega el botón no aparece** | E |
| `SIN TOCAR 4` | leads sin fila en `lead_status_history` posterior a la de creación | AGREGA | E |
| `RESPONDE 3h 20m` | ✅ **más barato de lo esperado**: `lead_status_history.changed_at` de la primera transición a `contacted` menos el alta. Que `changed_by` sea NULL (#108) **no importa**: el lead tiene un solo agente. ⚠️ mide *"cuánto tarda en marcarlo contactado"* → etiquetar honesto | AGREGA | E |
| `SUS LEADS 44°` | promedio de temperatura | AGREGA | E |
| Badge **`PIERDE LEADS`/`ACUMULA`** | — | **DECIDIDO** (§18/D11-bis): **sí**, con umbrales en `app_config` | E |

### 6.7 Estados vacíos (frame 4)

| Dato | Veredicto | Fase |
|---|---|---|
| *"Aún no hay señal que leer"* + CTA `Subir una propiedad` | EXISTE — reusar `features/profile/components/EmptyState.tsx` + `router.push('/publish')` | D |
| *"Nadie pendiente por hoy"* | EXISTE — 0 leads en bandas accionables | D |
| ~~*"Te avisamos en cuanto alguien vuelva a moverse"*~~ | **DECIDIDO** (§18/D12): **copy sin promesa** en la 1ª entrega + **derivada `producto()`** para la notificación real | D + derivada |

### 6.8 Señales nuevas — resumen y orden (fase C)

| Orden | Señal | Para qué | Cómo | ¿Rompe algo? |
|---|---|---|---|---|
| **1º** | **% de reproducción** | `— 4ª vez, 92%` | `payload:{progress}` en `video_completed` | no — `payload jsonb default '{}'`, aditivo |
| **2º** | **`zone_search`** | señal ×8 del sistema | evento nuevo desde el mapa ("Buscar en esta zona" ya existe, exploración 030) con `neighborhood_id`/`municipality_id` | no — `event_type` es `text` libre |
| **2º-bis** | **`contact_repeat`** | peso ×30 de contacto repetido (§7.2) | `contact-agent` escribe el evento cuando `inserted === false` | no — aditivo, `service_role` |
| **3º** (derivada) | **`app_open` / `last_seen_at`** | *"No ha vuelto a abrir la app en 6 días"* | evento `app_open` (1 por sesión; `lib/appSession.ts` ya genera el UUID) | **DECIDIDO** (§18/D4-bis): **después, y solo bajo la puerta del lead**. ⚠️ [[privacidad-datos]] ya lo lista en su inventario **como si existiera** — corregir el vault (§21) |
| — | **`last_contact_at` real** | orden alternativo y "responde en" | la columna **existe** (`20260604000006:43`), el índice la usa, `useAgentLeads` la ordena… y **nadie la escribe**. Escribirla en `update-lead-status` al marcar `contacted` | no — aditivo | 

---

## 7. Especificación del modelo (lo que antes eran preguntas abiertas)

### 7.1 Temperatura — T1, calculada en lectura

```
señal_i aporta:  w_i · (1 − decay)^(días_desde(timestamp_i))
temperatura   =  min(100, round( greatest(piso_activo, Σ aportes) ))
```

- **Pesos, máximos, decaimiento, ventana y umbrales viven en `app_config`** — precedente vivo
  `lead_score_threshold_tibio`/`_caliente` (`20260807000004`), que ya demostró que se recalibra
  **sin publicar app**. Claves propuestas (todas con `COALESCE(…, default)` en la función):

| Clave | Default | Qué es |
|---|---|---|
| `crm_weight_video_completed` | `10` | por video completo |
| `crm_max_video_completed` | `5` | tope de completados que cuentan (el *"máx 5"* del diseño) |
| `crm_weight_like` | `5` | por like |
| `crm_weight_save` | `18` | por guardado |
| `crm_weight_contact_first` | `30` | **piso de entrada** — el primer contacto (§7.2) |
| `crm_weight_contact_repeat` | `30` | por contacto repetido / sobre otra propiedad |
| `crm_weight_zone_search` | `8` | por búsqueda de la zona (fase C) |
| `crm_decay_daily` | `0.08` | el 8 % diario del diseño |
| `crm_temp_floor_active_lead` | `0` | piso duro mientras el lead esté activo; `0` = desactivado |
| `crm_trend_window_days` | `3` | **única** ventana de tendencia |
| `crm_band_hot_threshold` | `80` | "estuvo listo" para la banda *Se enfrían* |
| `crm_band_strong_signal_hours` | `24` | *"señal fuerte en las últimas 24 h"* |
| `crm_anon_min_viewers` | `3` | k-anonimato del radar (§7.5) |

⚠️ **Gotcha vivo:** las filas de umbral de #75.2 **no se sembraron a propósito** — el RED de
`29_lead_scoring_test.sql` hace INSERT crudo de esas claves (chocaría con la PK) y
`12_stream_schema_test.sql` fija en duro `count(*)=3` en `app_config`. **Las claves nuevas no se
siembran**: se resuelven con `COALESCE` y el pgTAP nuevo las inserta él mismo.

### 7.2 La señal de contacto — piso de entrada + repeticiones

El diseño le da ×30 a *"abrió tu WhatsApp"*, pero en Urbea **el lead NACE de ahí**: la señal estaría
encendida en el 100 % de los leads y no discriminaría nada — es exactamente la razón por la que #112
excluyó "Contactó" de la barra de acciones (*"estaría siempre lleno y no informaría nada"*).

**Modelo decidido:**
- **Primer contacto** → `crm_weight_contact_first` (30). Un lead recién nacido sin ninguna otra señal
  cae en **30–59 = tibio**, que es "entra tibio". Decae como todo lo demás, de modo que un lead
  abandonado **sí** se enfría (si no, la banda *Se están enfriando* sería inalcanzable). Si Abraham
  quiere un piso duro que no baje mientras el lead esté activo, es `crm_temp_floor_active_lead > 0` —
  un número en `app_config`, sin código nuevo.
- **Contacto repetido o sobre otra propiedad** → `crm_weight_contact_repeat` (30), con decaimiento.

**Cómo se detecta hoy, medido en el código:**
- **Sobre OTRA propiedad → detectable ya.** `contact-agent` hace
  `upsert(..., { onConflict: "lead_id,property_id", ignoreDuplicates: true })` (`index.ts:72`): un
  contacto desde otra propiedad **inserta una fila nueva** en `lead_origin_properties` con su propio
  `contacted_at`. O sea: `count(*) > 1` y cada timestamp es un re-contacto fechado. **Costo: 0** — el
  dato ya está en la base desde el día 1.
- **Sobre la MISMA propiedad → invisible hoy.** El `ignoreDuplicates: true` no deja rastro:
  `contacted_at` se queda en el primer contacto y `increment_contact_count` tampoco corre
  (`inserted === false`). **Propuesta: evento `contact_repeat` en `events_raw`**, escrito por
  `contact-agent` justo en la rama `inserted === false` (ya la distingue explícitamente,
  `index.ts:78-82`). Aditivo, `event_type` es texto libre, lo escribe `service_role`.
  **Costo: S** (una rama en la EF + tests Deno + índice). Va en la **fase C**.
- Mientras `contact_repeat` no exista, el modelo usa solo las filas de `lead_origin_properties` — la
  fórmula **no cambia**, solo suma menos señales. Es aditivo por diseño.

### 7.3 Bandas — la banda manda por tendencia

Evaluación **ordenada, primera que casa gana**. `Δ = temp(hoy) − temp(hoy − crm_trend_window_days)`.

| Orden | Banda | Color | Condición |
|---|---|---|---|
| 1 | **Háblales hoy** | `temp_hot` `#A8401A` | **es lead** ∧ existe señal fuerte (`contact_repeat` \| `save` \| `video_completed` \| `zone_search`) con `created_at > now() − crm_band_strong_signal_hours` ∧ **no hay cambio de estado del lead posterior a esa señal** |
| 2 | **Se están enfriando** | `temp_cooling` `#8A6A1E` | **es lead** ∧ `max(temp de los últimos 14 d) ≥ crm_band_hot_threshold` ∧ `Δ < 0` |
| 3 | **Calentando** | `temp_warming` `#1A5E44` | `Δ > 0` ∧ sin contacto reciente (sin cambio de estado en `crm_band_strong_signal_hours`). **Incluye las filas anónimas** |
| 4 | **En silencio** | `temp_silent` `#5F6D67` | el resto |

- 🔒 *Háblales hoy* y *Se están enfriando* son **solo leads** — nunca anónimos: son bandas que piden
  una acción de contacto y no hay a quién contactar.
- **Color de la fila = banda.** La escala de 4 tramos (0–29 / 30–59 / 60–79 / 80–100) colorea **solo
  el número de grados**. Esto resuelve la incoherencia del frame 5 (§0).

### 7.4 Estados — 4 visibles, 8 por debajo

**Sin tocar el enum ni la EF.** Proyección en lectura (reusa el agrupamiento que #75.1 ya definió
para los tabs, partiendo *Visita* de "En progreso"):

| Proyectado | Estados reales (incluye legacy) |
|---|---|
| **Nuevo** | `whatsapp_opened`, `new`*(legacy)* |
| **Contactado** | `contacted`, `interested`, `in_progress`*(legacy)* |
| **Visita** | `visit_scheduled` |
| **Cerrado** | `closed_won_rent`, `closed_won_sale`, `closed_lost`, `discarded`, `closed_won`*(legacy)* |

**Botón "Siguiente: marcar como…"** (transiciones libres desde #75.1, así que esto es sugerencia, no
máquina de estados):

| Estado proyectado actual | Qué hace el botón |
|---|---|
| Nuevo | envía `contacted` |
| Contactado | envía `visit_scheduled` |
| **Visita** | **abre el desplegable fino** en vez de enviar — cerrar exige elegir renta / venta / perdido, y adivinarlo es peor (mismo criterio que #75.1 tomó con los `closed_won` legacy) |
| Cerrado | no hay "Siguiente"; ofrece **Reabrir** (abre el desplegable) |

El **desplegable fino de los 8 vigentes ya existe y es accesible** — #117 **done**,
`LeadExpandedView.tsx:387-482` con `accessibilityState.expanded`. Se reusa tal cual.

### 7.5 Radar anónimo — diseño y su custodia

**Qué devuelve `crm_radar_anon(p_agent_id, p_limit)`:**

```
row_n            int      -- ordinal DENTRO de esta respuesta; NO es un id, cambia entre llamadas
property_label   text     -- etiqueta de la propiedad DEL AGENTE (es suya: no expone a nadie)
temperature      int
delta            int
sparkline        int[14]
signals          jsonb    -- solo banderas y conteos: {views:4, completed:true, saved:true, ...}
last_activity_at timestamptz
```

🔒 **Invariantes de privacidad (lo que el pgTAP debe matar):**

1. **El tipo de retorno NO tiene columna capaz de portar identidad.** No hay `user_id`, ni nombre, ni
   avatar, ni email, ni teléfono, ni ningún hash/pseudónimo estable. Assert **estructural** sobre
   `information_schema.parameters` / `pg_get_function_result` — si alguien añade una columna al
   `returns table`, el test truena.
2. **`row_n` no es un identificador.** Es la posición en *esta* respuesta; dos llamadas seguidas
   pueden devolver ordinales distintos para la misma persona. Un agente no puede seguir a "el
   anónimo #2" entre sesiones.
3. **k-anonimato.** Una fila anónima solo aparece si la propiedad tuvo **≥ `crm_anon_min_viewers`
   (default 3)** espectadores distintos en la ventana. Con un solo espectador, *"alguien"* es
   identificable por deducción — y ese es justo el modo de falla que 75.3 cerró.
4. **Quien ya es lead NO aparece en el radar** (se ve con nombre en su banda); y quien es anónimo
   **no tiene botón de contacto**.
5. **La autorización vive en el cuerpo, no en RLS.** La RPC es `security definer` porque tiene que
   leer `events_raw` de gente que **no** es lead del agente — cosa que `events_raw_select` le prohíbe
   con razón. **Esta es la pieza de mayor riesgo de toda la épica**: es exactamente la forma que
   tenía la fuga de 75.3. Mitigación: agregar **antes** de salir de la base, nunca devolver una fila
   que mapee 1:1 a una persona identificable, y anclar los 4 invariantes de arriba con pgTAP.

### 7.6 Tipografía y color

- **Fidelidad total al diseño en el CRM:** **Outfit** (interfaz/titulares) + **DM Mono** (números y
  etiquetas de dato). ✅ **`@expo-google-fonts/outfit` ya es dependencia** (`mobile/package.json:8`,
  se usa para el wordmark, #43.2) → solo hay que cargar más pesos. **Falta `@expo-google-fonts/dm-mono`.**
- **Tokens nuevos en `theme.ts`:** `temp_hot: '#A8401A'` · `temp_cooling: '#8A6A1E'` ·
  `temp_warming: '#1A5E44'` (= `primary`, coinciden) · `temp_silent: '#5F6D67'` · `fonts.mono`.
- ✅ **El resto de la paleta ya coincide**, medido contra `mobile/src/theme/theme.ts`:
  `primary '#1A5E44'` = verde del diseño · `primary_deep '#123A2C'` idéntico ·
  `primary_tint '#DCE8E1'` ≈ chip `#DEE8E1` · `paper '#F6F2EB'` ≈ fondo `#F5F2EC`.
  ⚠️ `CLAUDE.md` §8 sigue diciendo "Salvia `#5A8A5E`", pero `theme.ts:22` documenta el flash del dueño
  del 2026-07-06: *"el acento de TODA la interfaz es el verde del logo, no la salvia del kit"*.
  Corregir §8 al ingerir (§21).
- 🔴 **Riesgo de OTA a verificar, no asumir:** una fuente de `@expo-google-fonts` es un asset JS que
  resuelve Metro, así que *debería* viajar por OTA sin cambiar la huella nativa. Pero el precedente
  `assets_nativos_gotchas` dice que **hay assets que sí entran en el fingerprint**. **Procedimiento
  obligatorio antes de publicar:** generar la huella **antes** y **después** de añadir `dm-mono`, y
  comparar. Si cambia → **rebuild, no OTA** (regla #67: EAS decide por `fingerprint`). Tras publicar,
  verificar entrega real (runtime del update vs. `eas build:list`, no NO-OP) —
  `ota_fingerprint_verify_delivery`.

---

## 8. Impacto en datos

**Todo aditivo, idempotente, con rollback 1:1 y pgTAP** (CLAUDE.md §0.5.1). **Nunca** resets,
TRUNCATE ni seeds al remoto.

**Fase A**

1. **RPC de lectura** — `security definer` · `stable` · `set search_path = ''` · autorización
   **fail-closed en el cuerpo** (`return` vacío si no autoriza, nunca una excepción que distinga "no
   existe" de "no es tuyo") · `revoke execute … from public, anon` + `grant … to authenticated`.
   Molde exacto: `ad_metrics_for_agency` (`20260821000001`).
   - `crm_leads_page(p_agent_id, p_band, p_cursor, p_limit, p_query)` — paginada por banda, con
     búsqueda por nombre **server-side**.
   - `crm_funnel(p_agent_id, p_days)` — los 5 KPIs.
   - `crm_lead_detail(p_lead_id)` — origen, cross-propiedad ("sigue N propiedades tuyas más").
   - `lead_activity(p_lead_id, p_limit)` — timeline unificado y paginado.
   - `crm_radar_anon(p_agent_id, p_limit)` — §7.5.
2. **`lead_temperature_daily`** (`lead_id`, `day`, `temperature`, `signals`) + job `pg_cron`
   idempotente por `jobname` + entrada en `check_rollup_health()` + purga.
   🔒 **Append-only con dientes**: `revoke all … from anon, authenticated` **antes** de re-otorgar
   `grant select`, porque Supabase concede DML de fábrica a toda tabla nueva de `public` (patrón
   `user_consents` → `lead_status_history`).
3. **Índices** — medidos con `EXPLAIN` antes de crearlos, no por corazonada. Candidatos:
   `events_raw (property_id, user_id, event_type)`, `lead_status_history (lead_id, changed_at)`,
   `leads (agency_id, …)`. Hoy **ningún índice sirve `order by score desc`** (deuda 11).
4. **Retención de `events_raw`: 90 días de crudo** (deuda 12) — la tabla no tiene rollup ni purga y
   esta épica la convierte en la fuente caliente del CRM. Molde `ad_impressions`: `purge_events_raw()`
   + job diario + monitor en `check_rollup_health()`. El snapshot diario conserva el histórico
   agregado cuando el crudo se purgue.
5. **`app_config`**: claves de §7.1 (**no se siembran**, `COALESCE` con default).

**Fase C** — nada de schema: `payload:{progress}` (columna `jsonb` existente) y `event_type` nuevos
(`text` libre). Solo índices y la rama de `contact-agent`.

**Fase E** — `reassign_lead_atomic(p_lead_id, p_to_agent)` con auditoría en `admin_actions` y aviso;
ampliación de escritura de **#31**; claves de umbral del badge en `app_config`.

**Lo que NO se toca:** el enum `lead_status` · `get_lead_stats` (apps 1.0.3 la llaman: se **añade** al
lado, no se muta) · `leads.score`/`leads.level` (se conservan) · `update-lead-status` /
`update-lead-note` / `contact-agent` salvo adiciones opcionales.

**RLS:** las RPC reusan `private.can_view_lead` · `private.can_view_user_events` ·
`private.can_view_user_as_lead_searcher` · `private.agency_role_of` · `private.is_agency_admin_of`.
🔒 **Ampliar SELECT nunca implica ampliar escritura** (2 asserts pgTAP de #75.5 lo custodian).
🔒 **"Mis X" filtra explícito**; RLS es 2ª capa, no el alcance (lección #226).

## 9. Impacto en UI

Archivos previstos: `mobile/app/(protected)/(tabs)/crm.tsx` ·
`mobile/src/features/leads/screens/CRMScreen.tsx` (575 L) · `components/LeadCard.tsx` ·
`components/LeadExpandedView.tsx` (1025 L) · `components/AgentSelector.tsx` ·
`hooks/{useAgentLeads,useLeadStats,useLeadStatusHistory,useAgencyRole,useAgencyAgents}.ts` ·
`lead_status_meta.ts` · `types.ts` · `mobile/src/theme/theme.ts` · `mobile/app/_layout.tsx` (fuentes).
Colateral: `features/profile/hooks/useAgentStats.ts` (mismo `reduce` en cliente, deuda 4).

**Cambio de patrón de navegación:** hoy la ficha es un **Modal bottom-sheet nativo**; el diseño la
abre **inline en el renglón**. No es un restyle: es reescribir 1025 líneas y su relación con la lista
(alturas variables en la lista virtualizada, scroll-to-item, teclado para las notas).
⚠️ Gotchas vivos aplicables: **overlay absoluto sobre ScrollView = zona muerta al tacto en Android**
(#231) → render **inline**, no overlay · **los tests RNTL no ven layout** (`flex:1` en padre sin
altura da altura 0 con la suite en verde — es literalmente el bug #113 de este mismo sheet).

**Componentes de FIRMA — 5 previews HTML aprobables antes de RN** (§8), **con datos de NUESTRO
modelo**, no con los del diseño: `Te contactaron` (no "Te escribieron"), bandas por tendencia, 4
estados proyectados, filas anónimas sin identidad.

1. **Tarjeta de lead** — anillo cónico al %, 5 iconos de señal, sparkline de 14 barras, grados +
   delta. ⚠️ RN no tiene `conic-gradient` → recrear con `react-native-svg` (ya instalado); y si anima,
   **`Animated` clásico, no Reanimated sobre props de SVG** (#244: animaba en ambos emuladores y se
   quedó clavado en el teléfono real) → **validar en dispositivo físico**.
2. **Embudo de 30 días** — SVG de 5 tramos, KPIs y caídas. Ojo: el "Componente 03 · Embudo de leads"
   de `urbea-identidad-visual.html` es **otra cosa** (barra segmentada de estados ≈ la barra de 4
   estados del frame 2). Convergen, no colisionan.
3. **Respuesta narrativa** — *"3 personas están listas para que les hables"*.
4. **Ficha inline expandible** — el patrón, no solo el estilo.
5. **Fila anónima del radar** — la pieza nueva de R2: comunicar *"hay señal, no hay persona"* sin que
   parezca un error ni invite a contactar.

*(La fila de agente con badge `Pierde leads`/`Acumula` es el 6º componente de firma, pero pertenece a
la fase E y su preview se aprueba en esa tarea.)*

**No es de firma** (mini-spec escrito basta): estados vacíos (reusar `EmptyState.tsx`), segmentado
Míos/Equipo, cabeceras de banda, hoja mínima de búsqueda.

## 10. UI/interacción fuera del mockup

Referencias canónicas abiertas: `urbea-identidad-visual.html` (lenguaje visual; su mockup de CRM es
*"Mis leads"* + chips de estado + filas + hoja de embudo) y `Urbea Prototipo (standalone).html`
(layout). El diseño de Santiago es una **tercera referencia que Abraham pidió explícitamente como
objetivo**, así que su contenido no cuenta como UI fuera del mockup. Lo de abajo es lo que **ninguna**
de las tres dibuja y la pantalla necesita.

1. **`UI_FUERA_DEL_MOCKUP: paginación por banda y fin de lista · el diseño no dibuja el término de
   ninguna banda y un agente real puede tener cientos de leads · costo S`**
   → **RESUELTO — opción 1 (en conjunto)**: entra en las fases **A + D**. `crm_leads_page` nace con
   `(p_band, p_cursor, p_limit)` y la UI añade `Ver los N restantes` al pie de cada banda +
   `onEndReached`. Orden estable dentro de la banda: `temperature DESC`, desempate `updated_at DESC`.
2. **`UI_FUERA_DEL_MOCKUP: destino del icono ☰ y la búsqueda por nombre que el diseño elimina · hoy
   CRMScreen tiene buscador funcional (CRMScreen.tsx:177-180) y el diseño lo sustituye por un icono
   sin panel dibujado · costo S`**
   → **RESUELTO — mixto**: en la 1ª entrega el ☰ abre una **hoja mínima** con el buscador por nombre
   **server-side** (`p_query` en la RPC, nunca `useMemo` en cliente) — así no hay regresión ni UI
   muerta. La **hoja completa** (filtro por los 4 estados, orden, seguimiento) sale como **derivada
   `producto()`** (tarea G, §19).

**Solo nombradas** (cupo §8 agotado con las 2 de arriba): (a) el diseño no dibuja el estado **solo
lectura** del owner/admin sobre un lead ajeno (hoy `readOnly`, #28) · (b) no dibuja el chip
**"(suspendido)"** ni el aviso de **lead sin gestor** (#203) · (c) no dibuja el toggle **"En
seguimiento"** (`is_follow_up`), que hoy tiene sección fija propia (`CRMScreen.tsx:352-371`) — se
conserva como filtro dentro de la hoja de la derivada G · (d) no dibuja el pull-to-refresh (existe,
con el gotcha `bounces` de iOS).

## 11. Reglas no obvias aplicables

- 🔒 **Registrar ≠ exponer.** El agente ve la interacción **solo** si esa persona lo contactó; borrar
  el lead revoca el acceso retroactivo — [[privacidad-datos]] · PRD §19.1/§19.2 ·
  `20260809000001_events_raw_lead_gate.sql` · pgTAP `35_lead_privacy_test.sql` (plan 15).
  **Es la regla que el radar anónimo debe honrar sin excepción.**
- 🔒 **Ampliar visibilidad = ampliar SELECT, NUNCA escritura** — [[rls-seguridad]] (#75.5) · pgTAP
  `30_leads_admin_visibility_test.sql` (2 asserts). La fase E la cruza a propósito, vía #31.
- 🔒 **"Mis X" filtra explícito; RLS es 2ª capa, no el alcance** — #226 · `20260901000001` · pgTAP `77`.
- 🔒 **La clave de unificación del lead es (agente, usuario), NO la propiedad** — §19.5, [[crm-leads]];
  4 tests de #75.4 mueren si alguien le mete `property_id`. Consecuencia: la temperatura es **por par
  agente-usuario**, agregando **todas** las propiedades del agente.
- 🔒 **Lógica de negocio en Edge Functions; RLS 2ª capa; triggers solo atómicos** —
  `docs/lineamientos-desarrollo.md`. Agregación de **lectura** → RPC `security definer`; escritura
  (asignar, mensaje sugerido) → EF/RPC atómica.
- 🔒 **Append-only con dientes**: `revoke all` **antes** de `grant select` — Supabase concede DML de
  fábrica a toda tabla nueva de `public`.
- 🔒 **`EXISTS`, nunca `JOIN`, en el gate del like** — un usuario puede likear 2 videos de la misma
  propiedad y el JOIN duplica `veces_visto` (medido: 4 donde eran 2). Hay un assert que lo fija.
- 🔒 **`ALTER TYPE … ADD VALUE` exige migración SOLA** — gotcha de `20260807000002`. **No aplica aquí**
  porque no se toca el enum, y esa es justamente la razón de la proyección 8→4.
- 🔴 **`p.timeUpdateEventInterval` > 0 o la captura de compleción está MUERTA** — el default `0` hace
  que expo-video no emita `timeUpdate`. Lo cazó el guardian borrando la línea con la suite en verde.
  La fase C toca esa captura: **ese assert es intocable**.
- 🔴 **Dedupe de eventos a nivel de MÓDULO, no de componente** (FlashList recicla) y deps del listener
  por `property.id`, no por `player` (estable por instancia): un error ahí da falsos positivos **y**
  negativos, silenciosos.
- 🔴 **Ver video en pruebas quema cuota real de Cloudflare Stream** (§0.5.5): verificar que reproduce
  y **PARAR**; los E2E terminan en `stopApp`.
- 🔴 **`eas update` truena bajo pnpm** — OTA por `cd mobile && pnpm ota "<msg>"`, desde `main`
  mergeado; hornea el backend desde `.env.local` (guard ya en `ota.sh`); verificar entrega real.
- 🔴 **Tests bomba de fecha**: fijar el reloj en **todos** los casos y verificar en **4 zonas
  horarias** — una fórmula con `now()` y decaimiento diario es el caso de manual (#262/#263).
- 🔴 **`renderHook` async + `await act`** (RNTL 14) · **`unmount()` dentro de `act`** ·
  **dependencia de array-prop por contenido**, no por referencia (loop infinito / OOM) ·
  **nunca desprender `client.rpc`** de supabase-js (pierde el `this`; los mocks de objeto plano dejan
  la suite verde sobre una feature muerta).
- ⚠️ **`pg_cron` ya está instalado** (`20260817000002`); `cron.schedule` es idempotente por `jobname`;
  **no** se hace `create extension` otra vez.
- ⚠️ **Deploy**: EF con `--import-map` (+ `--use-api` sin Docker); migraciones al remoto por
  `apply_migration`, **nunca** `db push`; CLI de Supabase la **global de brew**, no `npx`.
- ⚠️ **pgTAP**: el `EXECUTE` se comprueba al planificar y plpgsql cachea el plan por sesión — el caso
  `anon` va en su **propio** helper `pg_temp.*_anon()` o es la primera invocación del archivo (203.1).

## 12. Arquitectura / enfoque técnico

**Contratos nuevos (aditivos; ninguno muta algo publicado):**

```
crm_leads_page(p_agent_id uuid, p_band text, p_cursor jsonb, p_limit int, p_query text)
  → lead_id, user_id, full_name, avatar_url, temperature int, delta int, band text,
    signals jsonb, sparkline int[14], last_activity_at, origin_property jsonb,
    status_projected text, next_cursor jsonb, remaining int
crm_funnel(p_agent_id uuid, p_days int)
  → vieron, volvieron, guardaron, contactaron, agendaron
crm_lead_detail(p_lead_id uuid)
  → origin_property jsonb, other_properties int, suggested_next_status text
lead_activity(p_lead_id uuid, p_limit int, p_cursor timestamptz)
  → occurred_at, kind, detail jsonb          -- events_raw ∪ likes ∪ saves ∪ status_history
crm_radar_anon(p_agent_id uuid, p_limit int)
  → row_n, property_label, temperature, delta, sparkline, signals, last_activity_at   (§7.5)
crm_agency_overview(p_agency_id uuid)                                       -- fase E
  → por agente: sin_tocar, tiempo_respuesta, temp_promedio, flag; + leads sin gestor
reassign_lead_atomic(p_lead_id uuid, p_to_agent uuid) returns void          -- fase E
```

**Se reusa** (rutas reales de `wiki/codebase/mapa-codebase.md`): `private.can_view_lead` ·
`private.can_view_user_events` · `private.can_view_user_as_lead_searcher` · `private.agency_role_of` ·
`private.is_agency_admin_of` · `leads.agency_id` denormalizado (`20260807000006`) ·
`lead_status_history` (append-only, ya tiene los timestamps del "tiempo de respuesta") · la captura
viva de `events_raw` (`useVideoEngagementEvents.ts`) · `format_relative_time` · `FilterTabs` ·
`EmptyState.tsx` · `lead_error_messages.ts` + `extract_error_code` · **el desplegable de estados de
#117** · el patrón `rollup + purge + check_rollup_health` · `@expo-google-fonts/outfit` (ya
instalada).

**Se sustituye** (y con ello se salda deuda 1–7 y 11): `useAgentLeads` → hook sobre `crm_leads_page` ·
los `useMemo` de conteo/búsqueda/seguimiento de `CRMScreen` → la RPC · `useAgentStats` (`reduce` en
cliente) → `crm_funnel` · `useLeadStatusHistory` (`select('*')`, query por lead sin caché) →
`lead_activity`.

**REUSO_CON_RESERVA: `get_lead_stats` · su alcance se le quedó chico (mira solo la propiedad de origen
y exige un like como puerta, mientras el diseño necesita cross-propiedad y señales sin like) · NO
CABE** — la llaman las apps **1.0.3 instaladas** (§0.5.2), así que **no se refactoriza**: se añade la
RPC nueva al lado y `get_lead_stats` se deprecia cuando la adopción del OTA lo permita. El código en
sí es bueno (batch, `EXISTS` en vez de JOIN, autorización en el cuerpo); lo que caducó es su alcance.

## 13. Fases / épicas

| Fase | Qué | Depende de | Crítica TDD (§5) | ¿OTA? |
|---|---|---|---|---|
| **A+B** | RPCs agregadas y paginadas · temperatura T1 · bandas · radar anónimo · snapshot diario · índices · retención de `events_raw` · hooks nuevos | — | **sí** (`supabase/migrations/**`, `mobile/**/hooks/**`) | migraciones/RPC al remoto (invisibles: todo aditivo); **el OTA se publica al cerrar D** |
| **D** | UI del agente: embudo, bandas, tarjeta de firma, ficha inline, radar anónimo, vacíos, hoja mínima de búsqueda, fuentes y tokens | A+B (+ 5 previews aprobados) | no — verificación ligera (`components/**`, pantallas) | **sí** — es el OTA de la 1ª entrega |
| **C** | `%` de reproducción (1º) · `zone_search` (2º) · `contact_repeat` · escribir `last_contact_at` | A+B (los alimenta; no bloquea D) | **sí** (`lib/`, EF) | captura sí por OTA; **el histórico empieza el día que se publica** |
| **E** | Vista de agencia: sin gestor · métricas de agente · badge · `reassign_lead_atomic` + **#31** con aviso al buscador | A+B, D | **sí** | RPC no; UI sí |
| **F** *(derivada)* | Agenda real de visitas | D | **sí** | depende |
| **G** *(derivada)* | Hoja completa de filtros del CRM | D | no | sí |
| **H** *(derivada)* | Notificación *"un lead se está calentando"* | A+B | **sí** (trigger/job) | no |
| **I** *(derivada)* | Señal de inactividad (`app_open` / `last_seen`) bajo la puerta del lead | C | **sí** | sí |
| **J** *(derivada)* | Export CSV + retención de leads (ex-75.7) | — | **sí** | no |

**1ª entrega decidida: A+B + D** (leads existentes + radar anónimo). C, E, F, G, H, I, J son tareas
dependientes.

**Orden sugerido:** A+B → D *(1ª entrega, OTA)* → C → E → derivadas. Con una excepción práctica: si
Abraham quiere el sparkline con datos densos cuanto antes, **C puede arrancar en paralelo a D** — el
histórico necesita 14 días de calendario, no de desarrollo.

## 14. Criterios de aceptación por tarea (verificables)

### T-A — Capa de datos + temperatura (fases A+B)

- [ ] `psql -c "explain (analyze,buffers) select * from crm_leads_page(...)"` **no muestra Seq Scan**
      sobre `events_raw` ni sobre `leads`.
- [ ] Abrir el CRM hace **≤2 llamadas de red** y **0** agregados en cliente sobre la lista completa
      (verificado por el log de PostgREST + ausencia de `reduce`/`filter` sobre `leads` en el diff).
- [ ] `crm_leads_page` con 500 leads sembrados en local devuelve la 1ª página en **< 300 ms**
      (`\timing on`), y el cursor recorre el conjunto completo sin repetir ni omitir filas
      (assert: unión de páginas = `count(*)` esperado, sin duplicados).
- [ ] **Reproducibilidad de T1**: con eventos fijos y reloj fijado, `temperature` es idéntica en 2
      ejecuciones; cambiar `crm_weight_save` en `app_config` **cambia el número sin publicar app**
      (assert pgTAP: update de `app_config` → nuevo valor esperado).
- [ ] **Decaimiento**: un lead sin señal nueva baja `crm_decay_daily` del acumulado por día (assert
      con reloj movido +1 d, +3 d, +14 d) y **cambia de banda solo**.
- [ ] **Bomba de fecha**: la suite de la fórmula pasa con el reloj fijado en **4 zonas horarias**
      (`TZ=UTC`, `America/Mexico_City`, `Pacific/Kiritimati`, `Pacific/Niue`).
- [ ] **Bandas**: los 4 casos de §7.3 tienen su assert, incluido que *Háblales hoy* y *Se están
      enfriando* **no admiten filas anónimas**.
- [ ] **Radar anónimo — los 4 invariantes de §7.5**, cada uno con su assert:
      (1) estructural sobre `pg_get_function_result('crm_radar_anon')` — **ninguna columna de
      identidad**; (2) `row_n` no estable entre llamadas; (3) k-anonimato: con
      `crm_anon_min_viewers=3` y 2 espectadores la fila **no aparece**; (4) quien ya es lead **no**
      sale en el radar.
- [ ] **Privacidad heredada**: un agente **no** obtiene temperatura, señales ni actividad de una
      persona que no es su lead activo; **borrar el lead revoca** (extensión de
      `35_lead_privacy_test.sql`).
- [ ] **No se amplió ninguna escritura**: los 2 asserts de `30_leads_admin_visibility_test.sql` siguen
      verdes y `leads_update` sigue acotada.
- [ ] **No se reabre #226**: un `users.role='admin'` sin relación con la agencia obtiene **0 filas** de
      **cada** RPC nueva (5 asserts, uno por RPC).
- [ ] `anon` no puede ejecutar ninguna RPC nueva (cada caso en su **propio** helper `pg_temp.*_anon()`,
      gotcha 203.1).
- [ ] **Job diario**: `lead_temperature_daily` se puebla, es idempotente (correrlo 2 veces no duplica),
      `check_rollup_health()` lo vigila y hay `rollback` probado con round-trip.
- [ ] **Retención**: `purge_events_raw()` borra > 90 d y **no** toca el snapshot; job registrado.
- [ ] **Contratos publicados intactos** (§0.5.2): smoke contra el remoto de `get_lead_stats`,
      `update-lead-status`, `update-lead-note` y `contact-agent` → respuestas idénticas a hoy.
- [ ] `pnpm tsc --noEmit` y `pnpm lint` en verde; suite pgTAP y Jest completas verdes.

### T-D — UI del agente (fase D)

- [ ] **5 previews HTML aprobados por Abraham** (con datos de nuestro modelo) **antes** de escribir RN.
- [ ] La pantalla pinta embudo, 3 bandas, tarjeta con grados + delta + sparkline + 5 señales, ficha
      **inline** (no Modal), radar anónimo y los 2 estados vacíos.
- [ ] **Ninguna fila anónima ofrece contacto** ni muestra nombre/avatar (test de render).
- [ ] Proyección 8→4 exacta de §7.4 cubierta por Jest, **incluidos los 3 estados legacy**; el
      desplegable fino sigue ofreciendo los 8 vigentes (#117 intacto).
- [ ] "Siguiente: marcar como…" envía el estado correcto por estado proyectado, y en **Visita** y
      **Cerrado** abre el desplegable en vez de enviar.
- [ ] `Ver los N restantes` por banda pagina server-side; el buscador del ☰ manda `p_query` a la RPC
      (assert: **no** hay filtrado en cliente).
- [ ] **Huella nativa**: fingerprint generado antes y después de añadir `dm-mono` — **si cambia, es
      rebuild, no OTA** (se documenta el valor de ambas huellas en la bitácora).
- [ ] Smoke en **emulador con Abraham** (regla #222) + validación de la animación del anillo en
      **dispositivo físico** (#244).
- [ ] `pnpm tsc --noEmit` + `pnpm lint` verdes; sin regresión de la suite `features/leads`.

### T-C — Señales nuevas

- [ ] `video_completed` incluye `payload.progress` y el valor es el real (assert con `timeUpdate`
      simulado); **`timeUpdateEventInterval > 0` sigue anclado** por su assert.
- [ ] `zone_search` se escribe una vez por búsqueda (dedupe por sesión+zona), con
      `neighborhood_id`/`municipality_id`.
- [ ] `contact_repeat` se escribe **solo** en la rama `inserted === false` de `contact-agent` (tests
      Deno: 1er contacto → no evento; 2º sobre la misma propiedad → 1 evento; sobre otra propiedad →
      fila en `lead_origin_properties`, **no** `contact_repeat`).
- [ ] `last_contact_at` se escribe al marcar `contacted` y el modo de orden `last_contact` deja de ser
      flexibilidad muerta (#110-f).
- [ ] La temperatura **sube** con las señales nuevas sin cambiar la fórmula (assert de que es aditivo).
- [ ] Cuota: la verificación en emulador reproduce y **PARA** (§0.5.5).

### T-E — Vista de agencia

- [ ] Preview del componente de firma (fila de agente con badge) aprobado.
- [ ] `crm_agency_overview` devuelve `sin_tocar`, `tiempo_respuesta`, `temp_promedio` y `flag` con
      asserts por caso; **0 filas** para quien no sea owner/admin **activo** de esa agencia.
- [ ] `reassign_lead_atomic`: cambia `agent_id`, deja fila en `admin_actions`, **avisa al buscador**,
      es idempotente y rechaza `SAME_USER` y destinos no activos.
- [ ] **#31 cerrada dentro de E**: el owner puede editar leads del equipo, con pgTAP que fija hasta
      dónde llega esa escritura (y que un agente raso **no** la hereda).
- [ ] Un lead con agente `suspended` aparece en "Sin gestor" (reusa #203, no lo reimplementa).

### T-F / G / H / I / J *(derivadas)*

Criterios en su propia tarea al planearlas; cada una nace con su `dependencies` y su backlink.

## 15. Dependencias

- **Taskmaster:** **#75** → se cierra `done` (§18/D13) · **#80** → `cancelled` con nota · **#31** →
  se reabre **dentro de la fase E** · **#108** → **no bloquea** (§18/D14) · **#110** (a/b/f: score
  inflado al borrar propiedad, default `new`, `sortBy` muerto) queda vivo y parcialmente absorbido
  por C · **#116** independiente · **#117** ✅ done, se reusa.
- **Código a reusar:** `supabase/migrations/20260821000001_ad_metrics_for_agency.sql` (molde de RPC) ·
  `…20260823000004_rollup_ad_impressions_monthly.sql` + `…20260904300001_rollup_monitor.sql` (job +
  monitor) · `…20260808000002_get_lead_stats_rpc.sql` (agregación con autorización en el cuerpo) ·
  `…20260904200001_leads_sin_gestor.sql` (#203) · `mobile/src/features/feed/hooks/useVideoEngagementEvents.ts` ·
  `mobile/src/theme/theme.ts` · `mobile/src/features/profile/components/EmptyState.tsx` ·
  `mobile/src/features/leads/components/LeadExpandedView.tsx:387-482` (#117).
- **Externas:** `@expo-google-fonts/dm-mono` (nueva) · `@expo-google-fonts/outfit` ✅ ya instalada ·
  `pg_cron` ✅ ya instalado.

## 16. Edge cases / riesgos residuales

1. 🔴 **El radar anónimo lee `events_raw` de no-leads con `security definer`** — es exactamente la
   forma que tenía la fuga de 75.3. Mitigación: agregar antes de salir de la base + los 4 invariantes
   pgTAP de §7.5 + revisión explícita en el PR. **Es el punto de mayor riesgo de la épica.**
2. 🔴 **k-anonimato débil en agentes con poco tráfico.** Con 3 espectadores y un agente que conoce a
   sus prospectos, *"alguien"* puede ser deducible por contexto externo. `crm_anon_min_viewers` es
   subible sin publicar app; si Abraham lo prefiere, se puede desactivar el radar por debajo de N
   propiedades activas.
3. 🔴 **El sparkline de 14 días no tendrá 14 días de datos** hasta 2 semanas después de publicar la
   captura. Mitigación: ocultar el sparkline bajo un mínimo de historia en vez de pintar una línea
   plana que parezca "sin actividad".
4. **`events_raw` es ahora la fuente caliente de la pantalla más usada del agente.** Sin la retención
   de 90 d de la fase A, crece sin techo y degrada la pantalla justo cuando el producto funciona.
5. **La temperatura ya se retiró una vez** (#112). Si por cualquier razón se entrega el número sin la
   tendencia o sin la frase que lo explica, se repite el error que motivó su retirada.
6. **Badge "Pierde leads"** es un juicio publicado sobre una persona ante su jefe: umbral mal
   calibrado = consecuencia laboral real. Por eso vive en `app_config` y en su propia fase.
7. **"Responde en 3h 20m" mide otra cosa**: el tiempo hasta que el agente *marca* el lead como
   contactado. Un agente que contesta en 5 min pero no usa el CRM sale mal. Etiquetar honesto.
8. **Ficha inline en lista virtualizada**: alturas variables + reciclado + teclado. Riesgo de
   regresión de scroll; y el overlay absoluto sobre scroll es zona muerta en Android (#231).
9. **La fuente nueva podría cambiar la huella nativa** → OTA silenciosamente NO-OP. Procedimiento de
   verificación obligatorio en §7.6.
10. **`app_config` sin filas sembradas a propósito**: sembrar rompe `12_stream_schema_test.sql`
    (`count(*)=3`) y el RED de `29_lead_scoring_test.sql`. Usar `COALESCE` con default.
11. **Cuota de Stream** al verificar el feed en la fase C (§0.5.5).

## 17. Plan de pruebas (alto nivel) y rollout

**Pruebas**

- **pgTAP (CRÍTICO, TDD estricto)** — por cada RPC: DELTA de comportamiento + INVARIANTES de
  privacidad **por impersonación con JWT real**. Gotcha 203.1: el caso `anon` en su propio helper.
  Los 4 invariantes del radar (§7.5) son el corazón de la suite.
- **pgTAP de la fórmula** — reloj fijado en **todos** los casos, verificado en **4 zonas horarias**.
- **Deno (CRÍTICO)** — `contact-agent` (rama `contact_repeat`), EF del mensaje sugerido,
  `update-lead-status` (`last_contact_at`).
- **Jest (CRÍTICO en `hooks/`/`lib/`)** — hooks nuevos, proyección 8→4, plantillas de la frase
  narrativa. Gotchas: `renderHook` async + `await act`, `unmount` dentro de `act`, deps por contenido,
  no desprender `client.rpc`, y **los tests no ven layout**.
- **Verificación ligera** en `components/**` y pantallas: `pnpm tsc --noEmit` + `pnpm lint` + smoke.
- **Smoke en producción** — patrón `DO block + RAISE` (la excepción fuerza rollback total y el reporte
  viaja en el mensaje); verificar los conteos después.
- **Manual con Abraham** (#222): emulador y Maestro **juntos**; pgTAP/Deno/Jest/sondas SQL los corro
  yo. Componente animado → **dispositivo físico** (#244).
- **Seed local con volumen** (≥300 leads, ≥5 000 eventos, 14 días de historia) para que los criterios
  de eficiencia sean medibles. **Local, nunca al remoto** (§0.5.1).

**Rollout (orden de merges, deploy y verificación)**

1. **T-A merge → `main`.** Deploy de migraciones al remoto por `apply_migration` (**nunca** `db push`).
   Todo es aditivo: los builds instalados **no ven nada** y siguen llamando sus contratos viejos.
   **No se publica OTA todavía** — la UI aún no consume las RPC, y publicar dejaría código muerto.
2. **Verificación post-deploy de T-A:** sonda SQL con `DO block + RAISE` (rollback total) que ejecute
   cada RPC con un JWT real de agente, de owner y de admin-sin-relación, y compare conteos;
   `check_rollup_health()` en verde tras la primera corrida del job.
3. **T-D merge → `main`** (previews aprobados antes de codear). **Fingerprint antes/después** por la
   fuente nueva. Si la huella **no** cambia → **OTA** con `cd mobile && pnpm ota "…"` desde `main`
   mergeado. Si cambia → **rebuild**, no OTA.
4. **Verificación post-OTA:** runtime del update vs. `eas build:list` (que no sea NO-OP) + `strings`
   sobre el `.hbc` para confirmar que el backend horneado es el correcto (guard ya en `ota.sh`) +
   smoke del CRM en emulador **con Abraham**.
5. **T-C** después, con su propio OTA (solo captura; sin cambio visible).
6. **T-E** al final: es la única que **amplía escritura** (#31) y por eso viaja sola, con su propia
   verificación por impersonación.
7. Derivadas F/G/H/I/J según prioridad.

**Gate de producción viva antes de cada PR** (§0.5): sin migraciones destructivas · sin contratos
rotos para builds instalados · rollback probado con round-trip · orden OTA-primero si algún día hay
contract (no lo hay en esta épica, porque todo es aditivo).

## 18. Decisiones del intake

Respuestas de Abraham (2026-09-05). Cada una con dónde quedó plasmada.

| # | Pregunta | Decisión | Dónde vive |
|---|---|---|---|
| **D1** | Tipografía | **Fidelidad total: Outfit + DM Mono en el CRM.** Verificar que las fuentes viajan por OTA y **no** cambian la huella nativa; documentar el riesgo y cómo verificarlo | §7.6, §14 (T-D), §17 rollout |
| **D2** | Escala de temperatura | **Tokens semánticos nuevos en `theme.ts`**: `temp_hot #A8401A`, `temp_cooling #8A6A1E`, `temp_warming #1A5E44`, `temp_silent #5F6D67` | §7.6 |
| **D3** | Privacidad / radar | **R2 radar anónimo.** Sin lead → solo filas **anónimas** en *Calentando* (sin nombre, sin avatar, sin botón de contacto) + agregado en el embudo. *Háblales hoy* y *Se están enfriando* = solo leads. La identidad aparece cuando la persona contacta. RPC `security definer` que agrega **sin exponer `user_id`**, con pgTAP que lo custodia | §1.C, §6.5, **§7.5**, §14 (T-A) |
| **D3-bis** | Capa de datos | **D1 + D3**: RPC agregada por agente/agencia **paginada por banda** (cursor + "Ver los N restantes") + **snapshot diario por (lead, día)** para el histórico. Molde: `ad_metrics_for_agency` + rollup de `ad_impressions` con `pg_cron` | §1.A, §8, §12 |
| **D4** | Temperatura | **T1**: decaimiento continuo en lectura, `min(100, Σ)`. Pesos, máximos, decaimiento (8 %), umbrales y ventana en **`app_config`** | **§7.1** |
| **D4-señal** | Señal WhatsApp | **Piso de entrada + repeticiones**: el primer contacto fija el piso (entra tibio); solo repetidos o sobre otra propiedad suman ×30 con decaimiento. Detección medida en el código; `contact_repeat` propuesto con costo | **§7.2**, §6.8 |
| **D4-bis** | `app_open`/`last_seen` | **Después**, y **solo bajo la puerta del lead** → derivada I | §6.8, §19 (tarea I) |
| **D5** | Bandas | **La banda manda por tendencia**; **una sola ventana** (hoy vs. hace N días, N en `app_config`). Color de fila = banda; la escala de grados colorea **solo el número** | **§7.3**, §0 |
| **D6** | KPI 4 del embudo | **"Te contactaron"** (Urbea no puede saber si escribió) | §6.2 |
| **D7** | Narrativa y mensaje sugerido | Narrativa = **hechos del RPC + plantilla en cliente** (probada con Jest). Mensaje sugerido = **servidor (EF)**, §19.3 | §6.3, §6.4 |
| **D8** | Agendar | **Fase 1 = marca `visit_scheduled`** con la EF existente; agenda real = derivada F | §6.4, §19 (tarea F) |
| **D9** | "Sin dueño" | → **"Sin gestor"**, mecanismo de **#203** | §6.6 |
| **D10** | Asignar | **Derivada/fase E** con **aviso al buscador**; reabre **#31** dentro de E; **en la 1ª entrega el botón no aparece** | §6.6, §13, §19 (tarea E) |
| **D11** | Estados | **4 visibles, 8 por debajo**; mapeo exacto y regla del botón "Siguiente"; desplegable fino accesible (**ya existe, #117**); **sin tocar EF ni enum** | **§7.4** |
| **D11-bis** | Badge de agente | **Sí**, umbrales en `app_config`, fase E | §6.6, §19 (tarea E) |
| **D10-bis** (2026-09-07, /tm-plan 269) | Aviso al reasignar | **Solo al agente destino**; el buscador **no** recibe aviso (sustituye la parte de "aviso al buscador" de D10). Frontera #31 = owner **y admin** activos. Badge: umbrales absolutos en `app_config` (`crm_agent_flag_*`). | §6.6, tarea 269 |
| **D12** | Estado vacío | **Copy sin promesa** + **derivada `producto()`** para la notificación "lead se calienta" | §6.7, §19 (tarea H) |
| **D13** | #75 / #80 | La épica **absorbe #80** (`cancelled`, nota "absorbida por exploración 045") y **cierra #75** (`done`); **75.7 → derivada J** | §19, §20 |
| **D14** | #108 | **No bloquea**: con T1 no hay columna nueva que escribir, así que un agente no puede inflar la temperatura por REST. #108 queda vivo solo por el `score` legacy y por `changed_by` | §1.B, §15 |
| **D15** | 1ª entrega | **A+B+D** sobre leads existentes + radar anónimo. C, E, F como dependientes | §13 |
| **D16** | Fase C, orden | **1º `%` de reproducción, 2º `zone_search`**; `app_open`/`last_seen` después y bajo la puerta del lead | §6.8, §19 (tarea C) |
| **D17** | `events_raw` | La fase A incluye **índices + snapshot diario + retención del crudo (90 d)** con el molde de `ad_impressions` (purge + `check_rollup_health`) | §8 |
| **D18** | Paginación por banda | **En conjunto** (fases A y D) | §10.1 |
| **D19** | Búsqueda / ☰ | **Derivada `producto()`** para la hoja completa; en la 1ª entrega el ☰ abre una **hoja mínima** con buscador **server-side** (`p_query`) | §10.2, §19 (tarea G) |
| **D20** | Previews | **Un preview HTML por componente de firma (5)**, con datos de **nuestro** modelo; cada preview es **subtarea de D**, aprobable antes de RN | §9, §19 (tarea D) |

## 19. Tareas a promover

⚠️ `add-task` y `expand` están **rotos** (CLAUDE.md §4) → se escriben **directo en
`.taskmaster/tasks/tasks.json`** (respaldo `.bak`, `id` de task = **string**, `dependencies` = lista
de **strings**, subtask `id` = **int**; validar con `task-master list` y `validate-dependencies`).

**Recomendación sobre A y B: UNA sola tarea.** La temperatura (B) es una función que vive **dentro**
de las RPC de A. Partirlas significa publicar `crm_leads_page` sin `temperature`/`band`/`sparkline` y
**mutar su firma una tarea después** — justo lo que §0.5.2 prohíbe para contratos ya publicados. Se
entrega como una tarea con subtareas internas.

### T-A · `feat: CRM — capa de datos agregada, temperatura y radar anónimo (exploración 045, fases A+B)`
- **priority:** `high` · **dependencies:** `[]`
- **description:** Sustituir la capa de datos del CRM por RPC agregadas y paginadas en backend
  (`crm_leads_page`, `crm_funnel`, `crm_lead_detail`, `lead_activity`, `crm_radar_anon`), implementar
  el modelo de temperatura T1 con decaimiento continuo calculado en lectura, derivar las 4 bandas por
  tendencia, y crear el snapshot diario, los índices y la retención de `events_raw`. Salda la deuda de
  eficiencia 1–7 y 11 del insumo `_insumo-crm-inventario-2026-09-05.md`.
- **details:** Diseño completo en `.taskmaster/docs/exploraciones/045-rediseno-crm-santiago.md`
  §7 (modelo), §8 (datos), §12 (contratos), §14 (criterios).
  **Archivos previstos:** `supabase/migrations/` (RPC, `lead_temperature_daily`, índices,
  `purge_events_raw`, job `pg_cron`, claves de `app_config`) + `supabase/migrations/rollbacks/` 1:1 +
  `supabase/tests/` (pgTAP nuevos) + `mobile/src/features/leads/hooks/` (hooks nuevos) +
  `mobile/src/features/leads/types.ts`.
  **Reuso:** molde `20260821000001_ad_metrics_for_agency.sql` · rollup/monitor
  `20260823000004` + `20260904300001` · autorización en el cuerpo de `20260808000002_get_lead_stats_rpc.sql` ·
  helpers `private.can_view_lead`/`can_view_user_events`/`agency_role_of`/`is_agency_admin_of`.
  **REUSO_CON_RESERVA:** `get_lead_stats` (alcance caducado: solo propiedad de origen + gate de like)
  · **no cabe** (contrato publicado, apps 1.0.3) → se añade RPC nueva al lado, se deprecia después.
  **Reglas no obvias:** registrar ≠ exponer (§19.1/19.2, pgTAP 35) · ampliar SELECT nunca amplía
  escritura (pgTAP 30) · "mis X" filtra explícito (#226, pgTAP 77) · `EXISTS` no `JOIN` en el gate del
  like · append-only con dientes (`revoke all` antes del `grant select`) · `app_config` **no se
  siembra** (rompe `12_stream_schema_test.sql` y el RED de 29) · pgTAP 203.1 (el caso `anon` en su
  propio helper) · `pg_cron` ya instalado, `cron.schedule` idempotente por `jobname`.
  **Checklist §0.5 producción viva:** todo aditivo · rollback probado con round-trip · sin
  TRUNCATE/reset/seed al remoto · `get_lead_stats`/`update-lead-status`/`update-lead-note`/
  `contact-agent` **intactos** · deploy por `apply_migration`, **nunca** `db push` · **no** se publica
  OTA en esta tarea (la UI llega en T-D) · verificación post-deploy por sonda `DO block + RAISE`.
- **testStrategy:** TDD estricto (RED→GREEN→guardian) — es `supabase/migrations/**` y
  `mobile/**/hooks/**`. pgTAP por RPC (DELTA + invariantes por impersonación con JWT real), los **4
  invariantes del radar anónimo** de §7.5, la fórmula T1 con reloj fijado en **4 zonas horarias**, el
  job idempotente y la purga. Jest para los hooks (`await act`, deps por contenido, no desprender
  `client.rpc`). `EXPLAIN (analyze, buffers)` como evidencia de ausencia de Seq Scan. Seed local de
  volumen (≥300 leads / ≥5 000 eventos / 14 días).
- **Criterios:** §14 · T-A (17 asserts verificables).

### T-D · `feat: CRM — UI del agente con embudo, bandas, tarjeta de firma y ficha inline (exploración 045, fase D)`
- **priority:** `high` · **dependencies:** `["<T-A>"]`
- **description:** Reconstruir la pantalla de Leads según el diseño de Santiago: respuesta narrativa,
  embudo de 30 días, 3 bandas por urgencia, tarjeta de lead con grados/tendencia/sparkline/señales,
  ficha **inline** (sustituye el Modal bottom-sheet), radar anónimo, estados vacíos, hoja mínima de
  búsqueda y los tokens/fuentes nuevos. **Primera entrega visible.**
- **details:** §9 (UI), §7.4 (proyección 8→4), §7.6 (tipografía y tokens), §10 (UI fuera del mockup).
  **Subtareas obligatorias primero — 5 previews HTML aprobables** (tarjeta de lead · embudo ·
  respuesta narrativa · ficha inline · fila anónima del radar), **con datos de nuestro modelo**
  (`Te contactaron`, bandas por tendencia, 4 estados, filas sin identidad). §8 de CLAUDE.md: no se
  porta a RN nada sin la aprobación de Abraham.
  **Archivos previstos:** `mobile/src/features/leads/screens/CRMScreen.tsx` ·
  `components/{LeadCard,LeadExpandedView,AgentSelector}.tsx` (+ componentes nuevos de firma) ·
  `lead_status_meta.ts` · `mobile/src/theme/theme.ts` (tokens `temp_*` + `fonts.mono`) ·
  `mobile/app/_layout.tsx` (carga de fuentes) · `mobile/package.json` (`@expo-google-fonts/dm-mono`).
  **Reuso:** desplegable de estados **#117 done** (`LeadExpandedView.tsx:387-482`, accesible) ·
  `EmptyState.tsx` · `FilterTabs` · `format_relative_time` · `@expo-google-fonts/outfit` ya instalada.
  **Reglas no obvias:** RN no tiene `conic-gradient` → SVG · **Reanimated sobre props de SVG muere en
  el build de producción** (#244) → `Animated` clásico + validar en teléfono real · overlay absoluto
  sobre scroll = zona muerta en Android (#231) → render inline · los tests RNTL **no ven layout**
  (`flex:1` sin altura = altura 0 en verde, bug #113 de este mismo sheet) · `SafeAreaView` de
  safe-area-context, no la de RN.
  **Checklist §0.5:** solo JS/UI → **sí sale por OTA**, pero **fingerprint antes/después** por la
  fuente nueva; si la huella cambia = **rebuild, no OTA** (#67). Verificar entrega real del OTA
  (runtime vs `eas build:list`, `strings` sobre el `.hbc`).
- **testStrategy:** verificación ligera (`pnpm tsc --noEmit`, `pnpm lint`, smoke) — es
  `components/**` y pantallas. Jest **sí** para la proyección 8→4, las plantillas de la frase
  narrativa y el invariante "una fila anónima no ofrece contacto ni identidad". Preview HTML aprobado
  por pantalla **antes** de RN. Smoke en emulador **con Abraham** (#222) + animación en dispositivo
  físico.
- **Criterios:** §14 · T-D (9 asserts).

### T-C · `feat: CRM — captura de señales nuevas (% de reproducción, zone_search, contact_repeat) (exploración 045, fase C)`
- **priority:** `medium` · **dependencies:** `["<T-A>"]`
- **description:** Empezar a registrar las señales que el modelo de temperatura necesita y hoy no
  existen, en el orden decidido: **1º** `%` de reproducción en `video_completed`, **2º** `zone_search`
  desde el mapa, más `contact_repeat` en `contact-agent` y la escritura real de `leads.last_contact_at`.
- **details:** §6.8 y §7.2. `events_raw.event_type` es **`text` libre** y `payload` es `jsonb` con
  default → **cero migración de enum**; solo índices.
  **Archivos previstos:** `mobile/src/features/feed/hooks/useVideoEngagementEvents.ts` ·
  `mobile/src/features/feed/lib/videoEngagementDedupe.ts` · `mobile/src/features/map/` (zone_search) ·
  `supabase/functions/contact-agent/index.ts` (rama `inserted === false`, `index.ts:78-82`) ·
  `supabase/functions/update-lead-status/` (`last_contact_at`) · migración de índices.
  **Reglas no obvias:** 🔴 **`p.timeUpdateEventInterval` > 0 o la feature está MUERTA** — el assert que
  lo ancla es **intocable** · dedupe a nivel de **módulo** (FlashList recicla) y deps por
  `property.id`, no por `player` · fail-closed sin `session_id` · fire-and-forget que **nunca**
  rompe la reproducción · 🔴 **ver video en pruebas quema cuota de Stream: verificar y PARAR**.
  **Checklist §0.5:** aditivo · `contact-agent` conserva su contrato (solo añade un INSERT interno) ·
  captura sale por OTA · **el histórico empieza el día que se publica**.
- **testStrategy:** TDD estricto (`lib/`, `hooks/`, `supabase/functions/**`). Jest para el dedupe y el
  `payload.progress`; Deno para `contact-agent` (1er contacto → sin evento; 2º misma propiedad → 1
  evento; otra propiedad → fila en `lead_origin_properties` y **no** `contact_repeat`). pgTAP para el
  índice y para que la fórmula siga siendo aditiva.
- **Criterios:** §14 · T-C (6 asserts).

### T-E · `feat: CRM — vista de agencia: sin gestor, métricas de agente y asignación de leads (exploración 045, fase E)`
- **priority:** `medium` · **dependencies:** `["<T-A>", "<T-D>"]`
- **description:** Pantalla "Equipo": narrativa de lo que se escapa, banda **Sin gestor** (mecanismo
  #203), fila de agente con `sin tocar` / `responde en` / `sus leads` y badge `Pierde leads`/`Acumula`,
  y **asignación de leads** (`reassign_lead_atomic`) con aviso al buscador. **Cierra #31** dentro.
- **details:** §6.6, §12. `crm_agency_overview` + `reassign_lead_atomic` con auditoría en
  `admin_actions`. Umbrales del badge en `app_config`.
  **Archivos previstos:** migración (RPC + claves) + rollback + pgTAP ·
  `mobile/src/features/leads/` (pantalla de equipo, hooks) · `supabase/functions/update-lead-status/`
  si #31 exige tocar la EF.
  **Reuso:** `20260904200001_leads_sin_gestor.sql` (#203) · `reassign_member_properties_atomic` como
  molde (auditoría + aviso) · `private.agency_role_of`.
  **Reglas no obvias:** 🔒 **es la ÚNICA fase que amplía escritura** — hoy 2 asserts pgTAP custodian
  que #75.5 no la amplió; al abrirla hay que **reescribir esos asserts con la nueva frontera**, no
  borrarlos · el comment de `reassign_member_properties_atomic` dice explícito que los leads
  existentes **no** cambiaban de interlocutor: esta tarea es esa "fase 2 con aviso al buscador" ·
  acotar al dueño / membresía vigente (#202) · **no reabrir #226**.
  **Checklist §0.5:** RPC nueva aditiva; la ampliación de escritura de #31 **sí** cambia una frontera
  de autorización → PR con revisión explícita, pgTAP de frontera y verificación por impersonación en
  el remoto antes del OTA. Preview del componente de firma (fila de agente) aprobado antes de RN.
- **testStrategy:** TDD estricto. pgTAP: 0 filas para quien no sea owner/admin **activo**;
  `reassign_lead_atomic` idempotente, con `SAME_USER` y destino inactivo rechazados, auditoría y aviso;
  frontera de escritura de #31 fijada por assert (un agente raso **no** la hereda). Jest para los hooks.
- **Criterios:** §14 · T-E (5 asserts).

### Derivadas (§5: 4 marcas — título, `Origen:` al abrir la descripción, `dependencies`, backlink en el origen)

| Tarea | Título | Deps | Prio |
|---|---|---|---|
| **F** | `producto(<T-D>): agenda real de visitas (fecha, recordatorio y aviso)` | `[<T-D>]` | `medium` |
| **G** | `producto(<T-D>): hoja completa de filtros del CRM (estado, orden, en seguimiento)` | `[<T-D>]` | `medium` |
| **H** | `producto(<T-D>): notificación "un lead se está calentando"` | `[<T-A>]` | `low` |
| **I** | `producto(<T-C>): señal de inactividad (app_open / last_seen) bajo la puerta del lead` | `[<T-C>]` | `low` |
| **J** | `producto(75.7): export CSV de leads + retención (§19.10)` | `[]` | `medium` |

- **F** — *Origen: subtarea `<T-D>.<n>` · Detectado por: /tm-explore 045.* El botón "Agendar" del
  diseño no tiene backend: no hay tabla de citas, ni fecha, ni recordatorio. La 1ª entrega solo marca
  `visit_scheduled` con la EF existente. Aquí va la agenda real. ⚠️ si se usa el calendario nativo
  (`expo-calendar`) es **módulo nativo nuevo → rebuild, no OTA**.
- **G** — *Origen: subtarea `<T-D>.<n>` · Detectado por: /tm-explore 045 (UI fuera del mockup).* El
  rediseño sustituye el buscador y los tabs de estado por un icono ☰ sin panel dibujado. La 1ª entrega
  deja una hoja mínima con búsqueda **server-side**; aquí van filtro por los 4 estados proyectados,
  orden y el filtro "En seguimiento" (`is_follow_up`), que hoy tiene sección fija en
  `CRMScreen.tsx:352-371` y el diseño no dibuja.
- **H** — *Origen: subtarea `<T-D>.<n>` · Detectado por: /tm-explore 045.* El estado vacío del diseño
  promete *"Te avisamos en cuanto alguien vuelva a moverse"*; la 1ª entrega cambia el copy para no
  prometer lo que no existe. Aquí se construye la notificación (patrón `lead_unmanaged`: trigger +
  `notifications` + ancla de idempotencia parcial por `type`).
- **I** — *Origen: subtarea `<T-C>.<n>` · Detectado por: /tm-explore 045.* Señal *"no ha vuelto a abrir
  la app en N días"*. Se registra `app_open` (1 por sesión; `lib/appSession.ts` ya genera el UUID) y
  **solo se expone bajo la puerta del lead**. ⚠️ [[privacidad-datos]] ya lo lista en su inventario como
  si existiera: corregir el vault (§21).
- **J** — *Origen: subtarea 75.7 · Detectado por: /tm-explore 045 al cerrar #75.* EF
  `export-leads-csv` (datos §19.4) + `pg_cron` de retención (purga de leads soft-deleted > 30 d; baja
  de agente → sus leads a soft delete, conservados 1 mes con export por inmobiliaria). **CRÍTICA** en
  el job de retención.

### Movimientos de estado al promover

1. `task-master set-status --id=75.7 --status=cancelled` *(su alcance vive en la derivada J)* y
   `--id=75.8 --status=done` *(el ingest de #75 ya está hecho: `wiki/conceptos/crm-leads.md` está
   `estado: vivo` con todas las rutas y `mapa-codebase` actualizado)* → luego
   `task-master set-status --id=75 --status=done` y **verificar con `task-master show 75`** (§5.5:
   una tarea terminada sin `done` rompe `next`).
2. `task-master set-status --id=80 --status=cancelled` + nota en sus `details`: *"absorbida por
   `.taskmaster/docs/exploraciones/045-rediseno-crm-santiago.md` — el alcance de §26.5-26.8 (events_raw,
   métricas agregadas, dashboards) vive en las tareas T-A y T-C de esa épica"*.
3. Backlinks `DERIVADAS:` en los `details` de las tareas origen (T-D, T-C y #75 para la J).
4. `task-master validate-dependencies` y `task-master list` para confirmar que nada quedó colgando.

## 20. Impacto en PRD (solo referencia — NO se edita)

Tocaría `docs/PRD.md` **§19.6** (fórmula de scoring: pesos, normalización 0–100, decaimiento y el
piso de contacto), **§19.8** (proyección 8→4 en la UI, sin tocar el enum), **§19.9** (CRM visual:
bandas por urgencia en vez de tabs por estatus + radar anónimo), **§19.10** (retención, vía la
derivada J), **§26.5–26.8** (eventos nuevos y métricas agregadas, hoy asignados a #80 que se absorbe)
y **§19.1/§19.2** con una precisión: *el radar anónimo publica la señal, nunca la persona*. Decisión
de promoción del dueño, fuera de esta exploración.

## 21. Ingest al vault (al cerrar la épica)

- 🔴 **Corrección pendiente y ya detectada:** `wiki/conceptos/privacidad-datos.md` lista
  **`app_open`** en la fila de "Comportamiento de video" de su inventario **como si existiera** —
  verificado: `events_raw` solo tiene escritores de `video_view` y `video_completed`
  (`useVideoEngagementEvents.ts`), `app_open` **no tiene ni un escritor**. Corregir al ingerir (y
  volver a añadirlo cuando la derivada I lo implemente de verdad).
- `CLAUDE.md` §8 dice "Salvia `#5A8A5E`" pero `theme.ts:22` documenta el flash del dueño del
  2026-07-06 que hizo del verde del logo (`#1A5E44`) el acento de toda la interfaz — que es,
  literalmente, el verde del diseño de Santiago. Alinear §8.
- `wiki/conceptos/crm-leads.md`: sección nueva del modelo de temperatura T1, las bandas, el radar
  anónimo y la proyección 8→4; marcar `get_lead_stats` como **alcance caducado, en depreciación**.
- `wiki/conceptos/privacidad-datos.md`: entrada del **radar anónimo** con sus 4 invariantes y el
  pgTAP que los custodia — es doctrina nueva ("se publica la señal, no la persona").
- `wiki/codebase/mapa-codebase.md` y `db-schema-map.md`: RPC nuevas, `lead_temperature_daily`, índices,
  jobs y claves de `app_config`.
- `wiki/conceptos/design-system.md`: tokens `temp_*` y `fonts.mono`.
- `wiki/log.md`: una línea por tarea cerrada.

## 22. Promoción / descarte

**Al aprobar:** promover las **4 tareas principales** (T-A, T-D, T-C, T-E) + **5 derivadas**
(F, G, H, I, J) por escritura directa en `.taskmaster/tasks/tasks.json` (§4 — `add-task` roto), con
los movimientos de estado de §19. Comando siguiente sugerido: **`/tm-plan <id de T-A>`**.

**Al descartar:** el inventario de §6, la especificación de §7 y las direcciones de §1 siguen siendo
válidos para cualquier retoma del CRM; y la deuda de eficiencia 1–7 y 11 del insumo sigue viva
independientemente del rediseño visual.

**Aprobada el 2026-09-05 por Abraham** (todas las opciones recomendadas salvo tipografía = fidelidad total).
Promovida escribiendo directo en `tasks.json` (`add-task` roto, §4):
- **#266** T-A capa de datos + temperatura + radar anónimo (high, sin deps)
- **#267** T-D UI del agente (high, dep 266) — 1ª entrega = 266 + 267
- **#268** T-C señales nuevas (medium, dep 266) · **#269** T-E vista de agencia (medium, deps 266, 267)
- Derivadas: **#270** agenda (dep 267) · **#271** filtros (dep 267) · **#272** notificación (dep 266) · **#273** inactividad (dep 268) · **#274** export CSV ex-75.7 (dep 75)
- Movimientos: 75.7 cancelled → #274 · 75.8 done · **#75 done** · **#80 cancelled** (absorbida, nota en details) · `validate-dependencies` OK (881 dependencias).
- `analyze-complexity` no se corrió: usa `generateObject`, roto en este entorno (§4).
