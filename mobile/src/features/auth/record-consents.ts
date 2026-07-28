/**
 * record_signup_consents — graba los consentimientos del registro libre.
 * Subtareas 72.6 (terms + privacy, §5.5) y 72.7 (whatsapp, §5.4).
 *
 * ⚠️ Se llama DESPUÉS de que `signUp` devuelva sesión, nunca antes: la policy RLS
 * `consents_insert` exige `user_id = auth.uid()`, así que sin sesión el INSERT se
 * rechaza con 42501.
 *
 * Reglas del schema (migración 0004) que esta función respeta y que NO son obvias:
 *   · `terms` y `privacy` EXIGEN `terms_version_id` (constraint consent_version_presence).
 *   · `whatsapp` y `age` lo exigen en NULL — el mismo constraint los rechaza si trae valor.
 *     Tiene sentido: el consentimiento de WhatsApp no versiona ningún documento.
 */
import { supabase } from '@/lib/supabase/client';

export interface RecordConsentsResult {
  error: string | null;
}

/**
 * Inserta terms + privacy (contra la versión VIGENTE de cada uno) y whatsapp.
 *
 * Las versiones vigentes se leen aquí y no se reciben por parámetro para que no haya
 * forma de grabar el consentimiento contra una versión que ya dejó de estarlo entre que
 * se pintó el formulario y se envió.
 */
export async function record_signup_consents(user_id: string): Promise<RecordConsentsResult> {
  const { data: versions, error: versions_error } = await supabase
    .from('terms_versions')
    .select('id, doc_type')
    .eq('is_current', true);

  if (versions_error) return { error: versions_error.message };
  if (versions === null || versions.length === 0) {
    return { error: 'No hay documentos legales vigentes.' };
  }

  const rows = [
    ...versions.map((v) => ({
      user_id,
      consent_type: v.doc_type,
      terms_version_id: v.id,
    })),
    // terms_version_id ausente a propósito (ver constraint arriba).
    { user_id, consent_type: 'whatsapp' as const, terms_version_id: null },
  ];

  const { error: insert_error } = await supabase.from('user_consents').insert(rows);
  return { error: insert_error?.message ?? null };
}
