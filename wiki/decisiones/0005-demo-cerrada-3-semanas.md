---
tipo: decision
estado: aceptada
fecha: 2026-06-17
---

# 0005 — Primer hito: demo cerrada de 3 semanas

## Contexto
Antes de construir el MVP recomendado completo ([[0001-alcance-mvp-recomendado]]), se necesita una **demo/beta cerrada en ~3 semanas** para **validar con inmobiliarias reales**. Definida en sesión de preguntas (7 rondas) el 2026-06-17.

## Decisión (alcance de la demo)
**Objetivo:** validación con inmobiliarias reales (end-to-end, datos reales).
**Audiencia:** inmobiliarias + agentes (cerrada, por invitación). **Sin pagos.**

| Área | Decisión |
|------|----------|
| Plataforma | Expo + **development build** (`expo-dev-client`) |
| Backend | **Supabase remoto** existente (`urbea-app`) |
| Video | Subida real → **Supabase Storage** → reproducción directa (sin transcoding) |
| Cuentas | **Inmobiliaria con agentes**; alta de inmobiliarias por **panel admin en la app** |
| Acceso | **Código de invitación** (owner → agentes) |
| Login | **Email + contraseña** |
| Onboarding | **Mínimo** (perfil básico) |
| Publicación | Wizard **3 pasos**; **auto-aprobar** |
| Feed | **Vertical tipo TikTok** |
| Búsqueda | **Filtros básicos** (operación, tipo, zona, precio) |
| Mapa | **Global con pines/clustering** |
| Detalle | **Completo** |
| Interacción | **Like + guardar** |
| Contacto | **WhatsApp + crea lead** |
| CRM | **Lista + estados** (embudo) |
| Perfil | **Con publicaciones** |
| Datos | **Semilla**: 3-5 inmobiliarias, 10-20 propiedades con video |
| Diseño | **Branding desde cero**; tokens+componentes+pantallas clave en Figma; estética híbrida (feed oscuro, resto claro); Claude propone, cliente aprueba |
| Prioridad | **Todo el alcance, parejo** |

## Fuera de alcance
Pagos · INE+selfie · push · comentarios · follows · reportes/moderación · scoring · Google/Apple login · panel admin web.

## Riesgo
"Todo parejo" en 3 semanas es ambicioso. Orden de recorte si aprieta: mapa global → mini-mapa; CRM con estados → lista simple; panel admin → seed SQL.

## Enlaces
- Conceptos: [[feed-vertical-video]], [[inmobiliarias-y-agentes]], [[propiedades-y-video]], [[crm-leads]], [[mapa-y-ubicacion]], [[busqueda-y-filtros]], [[onboarding-y-preferencias]]
- Fuente: **docs/PRD-MVP-demo.md**
