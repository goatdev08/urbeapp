// supabase/functions/_shared/property_field_whitelist.ts
// STUB — subtarea 218.4 (RED). Fuente única (TS) del whitelist de columnas
// de `properties` que un editor puede tocar vía edit-property. Hoy ese
// mismo whitelist vive DUPLICADO en SQL dentro de la RPC
// moderate_property_atomic (CASE WHEN p_changed_fields ? '<col>',
// migraciones 20260809000007 + 20260815000005) — ver
// property_field_whitelist.test.ts para el test de guardia TS↔SQL.
//
// GREEN (218.4): llenar la lista real (16 columnas, verificadas contra la
// RPC) y hacer que edit-property/handler.ts la importe en vez de construir
// el objeto `changed_fields` con sus propios keys inline.
//
// RED: lista vacía a propósito — compila, pero NINGÚN test de guardia debe
// pasar hasta que el GREEN la llene con el conjunto real.

export const EDITABLE_PROPERTY_FIELDS: readonly string[] = [];
