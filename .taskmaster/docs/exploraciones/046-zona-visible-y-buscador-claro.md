---
tipo: feature
nivel: M
fecha: 2026-09-08
estado: aprobado
tarea_id: 281, 282
motivo_descarte:
---

# Zona visible en el mapa + buscador de lugares claro

> Documento de exploración/planeación de `/tm-explore`. Un archivo por idea.
> Análisis visual (mockups por dirección, geometría y tabla real de "provi"):
> https://claude.ai/code/artifact/b9907136-f5e6-4196-956b-9b4b5ac30cf6

## Idea original
Abraham, 2026-09-08 (requerimiento del cliente): "agreguemos feedback visual a la
zona en donde se realizará la búsqueda al presionar el botón de 'buscar en esta
área' que sea un círculo translúcido verde, además de mejoras en la UX del mapa.
Y en las búsquedas los íconos que aparecen deben ser más claros o poder activar y
desactivar la búsqueda por colonia o por dirección, o identificarlas más claramente."

## Lluvia de ideas
**Círculo de zona** (hoy: la píldora "Buscar en esta zona" manda un círculo que
nunca se dibuja; el radio es la media diagonal del viewport = círculo
circunscrito ≈ 1.8× el rectángulo visible en 9:19.5, nunca cabe en pantalla).
- **A** Círculo persistente tras aplicar (`filters.area` → `<Circle>`). XS. No cambia resultados; el feedback llega después de pulsar.
- **B** Visor circular ANTES de pulsar, junto con la píldora, círculo inscrito (radio = min(media altura, media anchura)). S. Cambia la fórmula: las esquinas y franjas superior/inferior dejan de entrar (WYSIWYG). Revierte el trade-off de la decisión 1 de la exploración 030, tomada cuando la zona era invisible.
- **C** Radio ajustable sobre el mapa (slider reusando `RadiusSelector` o borde arrastrable). M; exige calibrar el gesto en dispositivo físico.
- **D** Dibujar también el radio "cerca de mí" (`filters.radius_m` alrededor del usuario) con borde punteado. XS. Hoy tampoco se ve nunca.

**Buscador** (hoy: `search_places` ordena prefijo → similitud → distancia; con
"provi" desde Guadalajara, Providencia (GDL) sale en el lugar 9 y el dropdown
muestra ~6 filas: seis pins verdes idénticos de colonias lejanas).
- **E** Cercanía primero en la RPC (migración v3, misma firma publicada; solo cambia el orden). Crítica: pgTAP + rollback, deploy antes del OTA. Cuidado: la colonia base ("Providencia") debe ir antes que sus secciones ("Providencia Sur", "2ª Sección"…).
- **F** Encabezados por tipo (Colonias / Municipios / Direcciones), ícono distinto por tipo y etiqueta de texto por fila. S. También mejora `ads/new/step4` (reusa `PlaceSearch`).
- **G** Chips Todo · Colonias · Municipios · Direcciones para apagar tipos. Solo si el cliente lo pide después de ver E+F.

**Elegido (Abraham, "dale", 2026-09-08):** B + A + D → tarea #281 · E + F → tarea #282.
C y G quedan en reserva (derivadas si el cliente las pide).

## Problema / Motivación
El cliente quiere ver la zona que se va a buscar. Hoy la píldora asume "lo que se
ve en pantalla" pero en realidad busca un círculo mayor que la pantalla, y al
volver al mapa solo queda un chip sin radio. En el buscador, el orden de la RPC
esconde la colonia obvia debajo de homónimas lejanas y el dropdown no distingue
tipos: el síntoma son "íconos poco claros", la causa es el ranking.

## Resultado esperado
1. Al terminar de panear/zoomear aparece la píldora y, con ella, un círculo verde
   translúcido inscrito en el viewport. Al pulsar, se busca exactamente ese círculo.
2. Al volver al mapa con zona activa el círculo sigue dibujado y el chip dice
   "Zona activa · 2.4 km · Quitar".
3. Sin zona activa y con radio "cerca de mí" finito, un círculo punteado alrededor
   de la ubicación del usuario muestra el radio que el feed está usando.
4. "provi" desde Guadalajara pone Providencia (Guadalajara) arriba; el dropdown
   agrupa Colonias / Municipios / Direcciones con ícono y etiqueta por tipo.

## Alcance
- **SÍ entra:** B, A, D (cliente, OTA) · E (migración v3 + pgTAP + rollback + deploy) · F (PlaceSearch).
- **NO entra:** C (radio ajustable), G (chips de tipo), cambios al feed, cambios a `properties_within_radius`.

## Roles afectados
Comprador (mapa y buscador). Inmobiliaria/agente: el paso 4 del wizard de
anuncios reusa `PlaceSearch` (hereda F). Admin: n/a.

## Impacto en datos
Ninguno en tablas. Reemplazo de función `search_places` (misma firma, mismo
shape de fila): aditivo, idempotente, con rollback que restaura la v2.

## Impacto en UI
`MapScreen` (`<Circle>` ×3 estados), `ZoneActiveChip` (label con radio),
`PlaceSearch` (encabezados, íconos, etiquetas).

## UI/interacción fuera del mockup
El mockup 6·MAPA no dibuja círculo ni dropdown. Aplica el techo con propuesta
(§8): Abraham lo pidió explícito → entra en conjunto. Mini-spec en cada
componente (tokens existentes, cero tokens nuevos).

## Reglas no obvias aplicables
- 🔒 A1: `filters.area` nunca viaja por `build_filter_query`; solo parámetro del RPC.
- D9: colonia / municipio / área mutuamente excluyentes → un solo círculo o polígono a la vez.
- §0.5.2: `search_places` es contrato publicado (builds llaman `{p_query, p_limit}`); la v3 mantiene la firma y, sin coordenadas, devuelve lo mismo que la v2.
- `react-native-maps` 1.27.2 ya exporta `Circle` → sin dependencia nueva, OTA-safe.

## Criterios de aceptación
- `viewport_to_area` devuelve radio inscrito (min de media altura/media anchura por Haversine), clamp intacto; tests actualizados.
- Círculo visible en los tres estados; nunca coexiste con el polígono de colonia.
- Chip con radio formateado ("800 m" / "2.4 km").
- pgTAP: con coords GDL, "provi" → Providencia (Guadalajara) en el top 3 y antes que Provima; sin coords → mismo orden que v2; firma y grants intactos.
- Dropdown con encabezados por tipo; suite de `PlaceSearch` verde; step4 sin regresión.

## Dependencias
#56 (píldora), #157/#159/#232 (buscador y RPC).

## Edge cases / riesgos
- Zoom extremo: clamp 100 m / 50 km sigue aplicando; el círculo puede exceder la pantalla a 50 km (aceptado).
- Pantallas anchas (tablet): inscrito = media altura; laterales fuera (aceptado).
- Región inicial antes del primer pan: el visor solo se muestra con la píldora, así `region` ya viene de `onRegionChangeComplete`.
- Ranking: bucket de distancia demasiado fino esconde otra vez la colonia base; demasiado grueso vuelve a la v2.

## Plan de pruebas (alto nivel)
Jest (`viewportToArea`, `formatRadius`, `PlaceSearch`), pgTAP 83 nueva, tsc +
lint, smoke por adb en el emulador (círculo + "provi"), deploy remoto de la
migración antes del OTA único.

## Impacto en PRD (solo referencia — NO se edita)
n/a.

## Decisiones del intake
- 2026-09-08 · Círculo inscrito (WYSIWYG) en vez de circunscrito: Abraham confirmó el cambio de fórmula sabiendo que altera qué propiedades entran.
- 2026-09-08 · Dos tareas y dos PRs, un solo OTA al final junto con #277.
- 2026-09-08 · C y G en reserva.

## Promoción / descarte
Aprobado → #281 `feat(56/157): zona visible…` · #282 `feat(159/232): buscador claro…`.
Escritas directo en `tasks.json` (`add-task` roto, CLAUDE.md §4).
