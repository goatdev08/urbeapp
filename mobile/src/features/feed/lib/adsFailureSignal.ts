/**
 * adsFailureSignal — rastro lateral cuando el feed degrada a "sin anuncios".
 *
 * Tarea #196 (origen: guardián del GREEN de 170.4). El fail-soft de
 * useFeedProperties es CORRECTO y no se toca: ante cualquier fallo de
 * `ads_feed_config` o `ads_for_zone` el feed se compone solo de propiedades,
 * sin error visible ni skeleton colgado. Lo que faltaba es que dejara rastro.
 *
 * 🔴 Degradar en silencio hacia el USUARIO y degradar en silencio hacia el
 * OPERADOR son dos decisiones distintas, y en 170.4 se tomaron juntas sin
 * querer. Desde el negocio, "la RPC lleva tres días fallando" se veía
 * EXACTAMENTE IGUAL que "no hay inventario contratado en esa zona" — y con
 * facturación por impresión eso cuesta dinero durante días sin que nadie se
 * entere.
 *
 * DECISIÓN (Abraham, 2026-08-20): un evento en `events_raw`, la única
 * infraestructura de telemetría que existe en la app (no hay Sentry ni
 * analytics). `event_type` es texto libre y `payload` es jsonb, así que no
 * hace falta ninguna migración.
 *
 * ponytail: se reusa tal cual el patrón de #112 (escritura directa bajo RLS +
 * store de dedupe a nivel de módulo). Sin dependencia nueva, sin Edge
 * Function, sin tabla nueva. Techo conocido: el dedupe vive en memoria y
 * muere con el proceso — a propósito, ver DEDUPE abajo.
 *
 * 🔒 PRIVACIDAD (fijado por el EC-2 del test): la fila lleva EXACTAMENTE
 * cuatro claves y ninguna describe a la persona más allá de a quién le falló:
 * sin property_id, sin coordenadas, sin ad_id, sin zona. El user_id no es
 * opcional — la policy `events_raw_insert` exige `user_id = auth.uid()`, así
 * que sin usuario no hay fila posible y simplemente no se escribe.
 *
 * DEDUPE por (session_id, stage): el feed pagina, así que sin esto una caída
 * generaría una fila por scroll. Una fila por sesión y tramo es justo lo que
 * el operador necesita — "cuántas sesiones se vieron afectadas" — y acota la
 * escritura. Una nueva apertura de la app es una sesión nueva y vuelve a
 * contar.
 */

/**
 * ponytail: única fuente del literal. Cualquier consulta de operador filtra
 * `events_raw.event_type` por este MISMO string; un typo de un lado daría 0
 * filas sin ningún síntoma (misma lección que VIDEO_VIEW_EVENT_TYPE en #112).
 */
export const ADS_FETCH_FAILED_EVENT_TYPE = 'ads_fetch_failed';

/**
 * Qué tramo del pipeline de anuncios falló.
 * 'mint' (170.8) = no se pudieron firmar las URLs de reproducción, así que no
 * se sirvió ningún anuncio aunque sí hubiera inventario elegible — un fallo
 * especialmente engañoso desde fuera, porque `ads_for_zone` respondió bien.
 */
export type AdsFailureStage = 'config' | 'zone' | 'mint';

export interface AdsFailureStore {
  has_seen: (session_id: string, stage: AdsFailureStage) => boolean;
  mark_seen: (session_id: string, stage: AdsFailureStage) => void;
}

/** Store de dedupe en memoria. Debe vivir a nivel de módulo para sobrevivir los remounts del feed. */
export function create_ads_failure_store(): AdsFailureStore {
  const seen = new Set<string>();
  const make_key = (session_id: string, stage: AdsFailureStage): string => `${session_id}::${stage}`;
  return {
    has_seen: (session_id, stage) => seen.has(make_key(session_id, stage)),
    mark_seen: (session_id, stage) => {
      seen.add(make_key(session_id, stage));
    },
  };
}

/** Singleton de la app — el feed se remonta, la sesión no. */
export const ads_failure_store: AdsFailureStore = create_ads_failure_store();

/**
 * Forma mínima del cliente que esta señal necesita. `auth` es OPCIONAL a
 * propósito: los mocks legados del feed no lo exponen y su ausencia no puede
 * romper nada (EC-7).
 */
export interface AdsFailureClient {
  auth?: { getSession: () => Promise<unknown> };
  from: (table: string) => { insert: (row: unknown) => Promise<unknown> };
}

function extract_user_id(session_result: unknown): string | null {
  const user_id = (session_result as { data?: { session?: { user?: { id?: unknown } } } })?.data?.session
    ?.user?.id;
  return typeof user_id === 'string' && user_id.length > 0 ? user_id : null;
}

/**
 * Registra que el pipeline de anuncios falló en `stage`. FIRE-AND-FORGET
 * ABSOLUTO: nunca lanza, nunca rechaza, nunca propaga. La telemetría de un
 * fallo no puede tener el mismo modo de fallo que aquello que reporta —
 * llamarla no puede tumbar el feed bajo ninguna circunstancia.
 *
 * 🔴 El dedupe se marca DESPUÉS de un insert exitoso, nunca antes (EC-10): si
 * se marcara al intentar, un error transitorio de red silenciaría la señal
 * por el resto de la sesión, que es exactamente el silencio que esta tarea
 * existe para eliminar.
 */
export async function report_ads_failure(params: {
  client: AdsFailureClient;
  session_id: string;
  stage: AdsFailureStage;
  store: AdsFailureStore;
}): Promise<void> {
  const { client, session_id, stage, store } = params;

  try {
    if (!session_id || store.has_seen(session_id, stage)) return;
    if (typeof client?.auth?.getSession !== 'function' || typeof client?.from !== 'function') return;

    const user_id = extract_user_id(await client.auth.getSession());
    if (!user_id) return;

    await client.from('events_raw').insert({
      event_type: ADS_FETCH_FAILED_EVENT_TYPE,
      user_id,
      session_id,
      payload: { stage },
    });

    store.mark_seen(session_id, stage);
  } catch (err) {
    // Se loggea pero JAMÁS propaga (misma regla que useVideoEngagementEvents).
    console.warn('[adsFailureSignal] no se pudo registrar el fallo de anuncios:', err);
  }
}
