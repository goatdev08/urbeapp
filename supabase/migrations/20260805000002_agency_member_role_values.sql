-- Migración 20260805000002 — agency_member_role: agrega 'admin' y 'viewer' (subtarea 71.2)
-- PRD §4.10 (matriz de permisos de agencia): el enum pasa de {owner,agent} a
-- {owner,admin,agent,viewer}. Esta migración SOLO extiende el enum -- NINGÚN código en
-- este archivo compara, castea ni referencia los valores nuevos.
--
-- 🔒 GOTCHA: `ALTER TYPE ... ADD VALUE` no puede convivir en la misma transacción con
-- código que USE el valor nuevo (comparaciones, casts, políticas RLS). Supabase corre
-- cada archivo de migración en su propia transacción, así que esta migración va SOLA;
-- el helper private.agency_role_of y las políticas RLS que referencian 'admin'/'viewer'
-- viven en la migración siguiente (20260805000003_agency_role_matrix.sql), que corre
-- después y por lo tanto ve el enum ya committeado con los 4 valores.
--
-- Idempotente: ADD VALUE IF NOT EXISTS (precedente: 20260720000001_stream_schema.sql
-- línea 20, `alter type property_video_status add value if not exists 'archived'`).
-- Rollback: supabase/migrations/rollbacks/20260805000002_agency_member_role_values.sql
--   (nota: un valor de enum NO se puede eliminar en Postgres; rollback documentado
--   como no-op, mismo criterio que el rollback de 20260720000001).

alter type agency_member_role add value if not exists 'admin';
alter type agency_member_role add value if not exists 'viewer';
