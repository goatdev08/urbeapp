// supabase/functions/_shared/property_field_whitelist.ts
// GREEN — subtarea 218.4 (adopta #124, redefinido 2026-08-24). Fuente única
// (TS) — espejo de solo lectura — del whitelist de columnas de `properties`
// que un editor puede tocar vía edit-property.
//
// CONTRATO (léase antes de tocar cualquiera de los dos lados):
//   La APLICACIÓN real del whitelist vive en SQL, dentro de la RPC
//   `moderate_property_atomic` (`CASE WHEN p_changed_fields ? '<col>' ...`,
//   última definición vigente: migración 20260815000005 — un
//   `create or replace function` REEMPLAZA el cuerpo completo de
//   20260809000007, no lo extiende). Esta lista TS es su ESPEJO, no la
//   fuente de la aplicación: existe para que edit-property y cualquier otro
//   consumidor TS tengan un solo lugar de dónde leer "qué campos son
//   editables", y para que property_field_whitelist.test.ts pueda comparar
//   AMBOS lados (más el comportamiento real de edit-property/handler.ts) y
//   tronar con un diff legible si divergen.
//
//   Si agregas/quitas un campo editable: toca AMBOS —
//     1. la migración con `create or replace function moderate_property_atomic`
//        (nuevo `create or replace`, nunca editar una migración ya aplicada).
//     2. esta lista, EDITABLE_PROPERTY_FIELDS.
//   El test de guardia (property_field_whitelist.test.ts, EC-1/EC-2) te lo
//   recuerda: falla con el diff exacto de columnas si solo tocas un lado.
//
// 16 columnas, verificadas contra la ÚLTIMA definición real de la RPC
// (20260815000005) vía `p_changed_fields ? '<col>'`.
export const EDITABLE_PROPERTY_FIELDS: readonly string[] = [
  "operation_type",
  "property_type",
  "price",
  "bedrooms",
  "bathrooms",
  "square_meters",
  "built_square_meters",
  "half_bathrooms",
  "currency",
  "address",
  "location",
  "price_visible",
  "pet_friendly",
  "allows_no_guarantor",
  "student_friendly",
  "description",
];
