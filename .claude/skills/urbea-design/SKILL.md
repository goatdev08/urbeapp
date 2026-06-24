---
name: urbea-design
description: Sistema de diseño de Urbea — branding, design tokens, componentes base y pantallas clave en Figma → código. Estética híbrida (feed oscuro inmersivo, gestión clara). Usar al definir identidad visual, tokens, componentes o pantallas. Cubre el flujo con el MCP de Figma y el naming. Disparar ante "branding", "diseño", "design system", "tokens", "componente", "figma", "tema", "paleta".
---

# urbea-design — sistema de diseño

⚠️ **Branding en pausa** hasta luz verde del cliente (`CLAUDE.md` §8). No definir identidad sin aprobación.

## Estética (decidida)
- **Híbrida**: feed de video **oscuro** e inmersivo (tipo TikTok/Reels); pantallas de gestión (publicar, CRM, perfil, admin) **claras**.
- **Claude propone** identidad (logo, paleta, tipografía); **el cliente aprueba** antes de propagarla.

## Flujo diseño → código
1. **Tokens primero**: color, tipografía, espaciado, radios → `mobile/src/theme/`.
2. **Componentes base** (botones, inputs, cards) → `mobile/src/components/`.
3. **Pantallas clave a fondo en Figma**: feed, detalle, publicación. El resto se arma en código con esos componentes.
4. **MCP de Figma** para acelerar diseño→código: busca las tools con ToolSearch ("figma"); sigue el skill `/figma-use` **antes** de escribir en Figma.

## Naming
- Tokens y utilidades: **snake_case** (`color_bg_feed`, `space_md`, `radius_lg`).
- Componentes: **PascalCase** (`PrimaryButton`, `PropertyCard`).

## Principios
- Mobile-first, claridad sobre adornos. Copy en **español**.
- Reusa tokens/componentes; no hardcodees colores/medidas en las pantallas.

## Verificación
`pnpm tsc --noEmit`, `pnpm lint`, montaje de componentes, revisión visual con el cliente.
