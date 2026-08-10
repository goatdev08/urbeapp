/**
 * LegalWall — muro BLOQUEANTE de re-aceptación de documentos legales (#72.6, PRD §5.5).
 *
 * Cuándo aparece: `useLegalGate` reporta documentos vigentes que el usuario no ha
 * aceptado en su versión actual. `ProtectedLayout` lo renderiza EN LUGAR del contenido
 * protegido.
 *
 * ⚠️ Es un MURO, no una ruta — mismo patrón que `LocationWall` (#41). La diferencia
 * importa: una ruta se puede esquivar con un `router.replace`, un deep link o el botón
 * de atrás; un componente que se renderiza en vez del contenido, no. Si el gate fuera
 * evitable dejaría de ser un gate, y volveríamos a tener gente operando la plataforma
 * bajo términos que no aceptó — justo lo que la LFPDPPP exige poder demostrar que no
 * pasa. La única salida es cerrar sesión.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/features/auth/context';
import { release_splash } from '@/lib/splash-gate';
import type { PendingLegalDocument } from '@/features/auth/hooks/useLegalGate';
import { ConsentCheckbox } from '@/features/auth/components/consent-checkbox';
import { brand, colors, fonts, layout, radii, spacing } from '@/theme/theme';

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

const DOC_LABEL: Record<string, string> = {
  terms: 'Términos y Condiciones',
  privacy: 'Aviso de Privacidad',
};

function doc_label(doc_type: string): string {
  return DOC_LABEL[doc_type] ?? doc_type;
}

// ---------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------

export interface LegalWallProps {
  pending: PendingLegalDocument[];
  error: string | null;
  accept: () => Promise<void>;
}

/**
 * El estado del gate lo POSEE ProtectedLayout y baja por props. Si el muro llamara a
 * `useLegalGate()` por su cuenta habría dos instancias del hook: dos consultas a la RPC
 * y, peor, un `accept()` que actualizaría el estado del muro pero no el del layout —
 * el usuario aceptaría y el muro seguiría ahí.
 */
export function LegalWall({ pending, error, accept }: LegalWallProps): React.JSX.Element {
  // #143.4: primera pantalla útil — soltar el splash nativo
  useEffect(() => { release_splash(); }, []);

  const { signOut } = useAuth();

  // Una palomita por documento: aceptar en bloque sin marcar cada uno no sería
  // consentimiento informado, que es el punto de §5.5.
  const [checked, set_checked] = useState<Record<string, boolean>>({});
  const [contents, set_contents] = useState<Record<string, string>>({});
  const [contents_error, set_contents_error] = useState<string | null>(null);
  const [is_submitting, set_is_submitting] = useState(false);
  const [content_tick, set_content_tick] = useState(0);

  // Texto de cada documento. Va aparte de la RPC porque `content` puede ser largo y
  // el gate se consulta en cada arranque: no tiene sentido arrastrarlo siempre.
  useEffect(() => {
    if (pending.length === 0) return;
    let cancelled = false;

    async function fetch_contents(): Promise<void> {
      const { data, error: fetch_error } = await supabase
        .from('terms_versions')
        .select('id, content')
        .in(
          'id',
          pending.map((doc) => doc.terms_version_id)
        );
      if (cancelled) return;
      if (fetch_error !== null || data === null) {
        // 🔒 El error NO se descarta. Si el texto no se pudo traer, marcar la palomita
        // sería "aceptar" un documento que nunca se mostró — lo contrario del
        // consentimiento informado que §5.5 exige poder demostrar. Se expone y se
        // ofrece reintentar; `contents` queda vacío y eso bloquea los checkboxes.
        console.warn('[LegalWall] No se pudo cargar el texto legal:', fetch_error?.message);
        set_contents_error(fetch_error?.message ?? 'sin datos');
        return;
      }
      const next: Record<string, string> = {};
      for (const row of data) next[row.id] = row.content;
      set_contents_error(null);
      set_contents(next);
    }

    void fetch_contents();

    return () => {
      cancelled = true;
    };
  }, [pending, content_tick]);

  /** ¿Se puede marcar este documento? Solo si su texto está en pantalla. */
  const is_readable = (doc: PendingLegalDocument): boolean =>
    typeof contents[doc.terms_version_id] === 'string';

  const all_readable = pending.length > 0 && pending.every(is_readable);
  const all_checked =
    all_readable && pending.every((doc) => checked[doc.terms_version_id] === true);

  const toggle = (doc: PendingLegalDocument): void => {
    // Guard redundante con el `disabled` del checkbox, a propósito: es la invariante
    // legal del componente y no debe depender de que la prop se cablee bien.
    if (!is_readable(doc)) return;
    set_checked((prev) => ({
      ...prev,
      [doc.terms_version_id]: prev[doc.terms_version_id] !== true,
    }));
  };

  const handle_accept = async (): Promise<void> => {
    if (!all_checked || is_submitting) return;
    set_is_submitting(true);
    // accept() del hook inserta TODOS los pendientes y refresca; al quedar `pending`
    // vacío, el ProtectedLayout deja pasar solo.
    await accept();
    set_is_submitting(false);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Actualizamos nuestros documentos</Text>
        <Text style={styles.subtitle}>
          Para seguir usando Urbea necesitamos que revises y aceptes la versión más reciente.
        </Text>

        {error !== null && (
          <Text style={styles.error_banner} accessibilityRole="alert">
            No pudimos guardar tu aceptación. Revisa tu conexión e inténtalo de nuevo.
          </Text>
        )}

        {contents_error !== null && (
          <View style={styles.contents_error_block}>
            <Text
              testID="legal-wall-contents-error"
              style={styles.error_banner}
              accessibilityRole="alert"
            >
              No pudimos cargar el texto de los documentos. No puedes aceptarlos sin leerlos.
            </Text>
            <Pressable
              testID="legal-wall-contents-retry"
              onPress={() => set_content_tick((t) => t + 1)}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={styles.secondary_button_text}>Reintentar</Text>
            </Pressable>
          </View>
        )}

        {pending.map((doc) => (
          <View key={doc.terms_version_id} style={styles.doc_card}>
            <Text style={styles.doc_title}>
              {doc_label(doc.doc_type)} <Text style={styles.doc_version}>v{doc.version}</Text>
            </Text>
            <ScrollView style={styles.doc_body} nestedScrollEnabled>
              <Text style={styles.doc_text}>
                {contents[doc.terms_version_id] ??
                  (contents_error !== null
                    ? 'No se pudo cargar el documento.'
                    : 'Cargando el documento…')}
              </Text>
            </ScrollView>
            <ConsentCheckbox
              testID={`accept-${doc.doc_type}`}
              checked={checked[doc.terms_version_id] === true}
              onToggle={() => toggle(doc)}
              // Sin el texto en pantalla no hay consentimiento informado que valga.
              disabled={!is_readable(doc) || is_submitting}
              label={`He leído y acepto el ${doc_label(doc.doc_type)}`}
            />
          </View>
        ))}

        <Pressable
          testID="accept-terms-submit"
          onPress={() => void handle_accept()}
          disabled={!all_checked || is_submitting}
          accessibilityRole="button"
          style={[styles.primary_button, (!all_checked || is_submitting) && styles.button_disabled]}
        >
          <Text style={styles.primary_button_text}>
            {is_submitting ? 'Guardando…' : 'Aceptar y continuar'}
          </Text>
        </Pressable>

        {/* Única salida de la pantalla. */}
        <Pressable
          testID="accept-terms-signout"
          onPress={() => void signOut()}
          accessibilityRole="button"
          hitSlop={8}
          style={styles.secondary_button}
        >
          <Text style={styles.secondary_button_text}>Cerrar sesión</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: {
    paddingHorizontal: layout.screen_inset,
    paddingTop: spacing.s_32,
    paddingBottom: spacing.s_40,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 26,
    lineHeight: 32,
    color: colors.ink,
    marginBottom: spacing.s_8,
  },
  subtitle: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.silver_dk,
    marginBottom: spacing.s_24,
  },
  error_banner: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.danger,
    marginBottom: spacing.s_16,
  },
  contents_error_block: { marginBottom: spacing.s_16, gap: spacing.s_8 },
  doc_card: {
    backgroundColor: colors.surface,
    borderRadius: radii.r_16,
    borderWidth: 1,
    borderColor: colors.paper_3,
    padding: spacing.s_16,
    marginBottom: spacing.s_16,
  },
  doc_title: {
    fontFamily: fonts.display,
    fontSize: 17,
    color: colors.ink,
    marginBottom: spacing.s_8,
  },
  doc_version: { fontFamily: fonts.sans, fontSize: 13, color: colors.silver_dk },
  doc_body: { maxHeight: 180, marginBottom: spacing.s_12 },
  doc_text: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 19,
    color: colors.ink,
  },
  primary_button: {
    backgroundColor: brand.green,
    borderRadius: radii.r_16,
    paddingVertical: spacing.s_16,
    alignItems: 'center',
    marginTop: spacing.s_8,
  },
  button_disabled: { opacity: 0.45 },
  primary_button_text: {
    fontFamily: fonts.sans,
    fontSize: 15,
    fontWeight: '600',
    color: brand.carnita,
  },
  secondary_button: { alignItems: 'center', paddingVertical: spacing.s_16 },
  secondary_button_text: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.silver_dk,
    textDecorationLine: 'underline',
  },
});
