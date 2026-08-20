/**
 * adImpressionQueue — cola de impresiones de anuncios del feed (subtarea 170.7).
 *
 * REUSO del pipeline de telemetría de #112 (no se reescribe): dedupe por
 * (sesión, entidad) en un store a nivel de MÓDULO, escritura fire-and-forget,
 * `session_id` de lib/appSession.ts. Lo que cambia es el destino: aquí no se
 * escribe a `events_raw` bajo RLS sino que se llama a la EF
 * `record-ad-impressions` (170.6), que corre con service_role porque
 * `ad_impressions` es base de FACTURACIÓN y no puede escribirla el cliente.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * 🔴 REQUISITO 1 — UNA exposición se emite UNA SOLA VEZ.
 *
 * El writer de la EF hace `ON CONFLICT DO NOTHING`, así que el contrato real
 * es «GANA LA PRIMERA ESCRITURA» — lo contrario de lo que sugiere la palabra
 * *upsert*. Un (session_id, ad_id) emitido dos veces pierde el segundo valor
 * EN SILENCIO: sin error y sin contador de descartes. Si ese segundo valor era
 * el `watched_ms` final, la fila queda con el parcial y `viewed` puede quedar
 * en false para una exposición que sí superó los 3 s. Subcontar invisible.
 *
 * Por eso `emitted` GATEA LA EMISIÓN, no solo la identidad de la fila: se
 * marca al ENCOLAR, y un segundo encolado del mismo par es un no-op. Como la
 * emisión ocurre únicamente al TERMINAR la exposición, la cola nunca llega a
 * contener un `watched_ms` parcial — con lo que el flush por tamaño deja de
 * ser peligroso. (Esa era la ambigüedad exacta que el guardián marcó: "flush
 * por tamaño N o al salir de la pantalla" admitía una lectura en la que un
 * valor parcial salía primero y el final se perdía.)
 *
 * 🔴 CONTRATO PARA EL LLAMADOR, que se deriva de lo anterior: llamar a
 * `enqueue_impression` UNA vez, cuando `watched_ms` ya es DEFINITIVO. Llamar
 * antes no produce un error — produce una fila con el tiempo equivocado y
 * ninguna forma de notarlo.
 *
 * 🔴 REQUISITO 2 — el tap al CTA NUNCA viaja en un POST anterior al de su
 * impresión. `record_cta_tap` es un UPDATE (no un upsert): si llega antes que
 * la fila, no matchea nada y se pierde sin rastro — y el CTA es lo que se
 * factura por clic. El handler procesa `upsert_impressions` ANTES que
 * `record_cta_tap`, así que en el MISMO POST el orden es correcto.
 * LA DEFENSA CONCRETA, para que nadie la busque en el lugar equivocado: el
 * guard dentro de `flush` — un tap solo entra al cuerpo si su par ya se envió
 * antes o va en ESE mismo cuerpo; si no, se queda parqueado. No es "que
 * report_cta_tap no dispare flush"; eso es una optimización, no la defensa
 * (comprobado por mutación, ver el comentario en report_cta_tap). El caso que lo hace necesario es
 * real: la persona toca el CTA mientras el anuncio sigue reproduciéndose, o
 * sea ANTES de que su exposición termine y se encole.
 * La disciplina del cliente no basta sola —controla el orden en que EMITE, no
 * en que los POST LLEGAN—; la otra mitad es el contador `cta_taps_orphaned`
 * de la EF (#198).
 * ════════════════════════════════════════════════════════════════════════════
 *
 * CONTRATO DE #193 que esta cola consume: el cliente NO manda `id` ni
 * `user_id` (el servidor deriva `id = uuid_v5(ns, "user:ad:session")` con el
 * `sub` del JWT), NO declara zona (manda coordenadas y el servidor resuelve) y
 * NO declara `viewed` (lo deriva el servidor con umbral de 3 s). Mandar esos
 * campos no rompe nada —la EF los ignora— pero no se mandan: lo que no viaja
 * no puede desincronizarse.
 *
 * OFFLINE: el batch se PIERDE sin romper la reproducción. Sin cola
 * persistente, sin reintentos. Subcontar es el error correcto; duplicar una
 * impresión facturable no lo es. El batch fallido tampoco se reencola.
 *
 * ponytail: arrays y un Set a nivel de módulo, sin dependencia nueva ni
 * almacenamiento. Techo conocido: si alguna vez se quiere no perder el batch
 * offline, esto necesita persistencia (AsyncStorage) y una política de
 * reintento — que hoy sería más superficie de la que el problema justifica.
 */

// Elegido por simplicidad, no por medición: 10 exposiciones es más de lo que
// alguien ve en una sesión corta de feed, así que en la práctica el flush que
// manda es el de salir de la pantalla. Anotado en la bitácora de 170.7 para
// recalibrar con datos reales cuando existan.
export const AD_IMPRESSION_BATCH_SIZE = 10;

/** Una exposición TERMINADA. `watched_ms` debe ser el valor definitivo. */
export interface AdExposure {
  ad_id: string;
  session_id: string;
  /** ISO. Informativo — la elegibilidad la evalúa el servidor con su reloj. */
  shown_at: string;
  watched_ms: number;
  completed: boolean;
  lat: number;
  lng: number;
  device?: string | null;
}

export interface AdCtaTap {
  ad_id: string;
  session_id: string;
  cta_tapped_at: string;
}

interface FunctionsClient {
  functions: { invoke: (name: string, opts: unknown) => Promise<unknown> };
}

export interface AdImpressionQueueDeps {
  supabase?: FunctionsClient;
}

export interface AdImpressionQueue {
  /** Encola una exposición TERMINADA. Idempotente por (session_id, ad_id). */
  enqueue_impression: (exposure: AdExposure) => void;
  /** Registra un tap al CTA. No fuerza flush — ver REQUISITO 2. */
  report_cta_tap: (tap: AdCtaTap) => void;
  /** Envía lo pendiente. Nunca lanza. Llamar al salir de la pantalla. */
  flush: () => Promise<void>;
}

const make_key = (session_id: string, ad_id: string): string => `${session_id}::${ad_id}`;

function get_default_supabase(): FunctionsClient | undefined {
  try {
    // ponytail: lazy require, mismo motivo que en useFeedProperties —
    // '@/lib/supabase/client' lanza en import time sin las env vars.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@/lib/supabase/client') as { supabase: FunctionsClient }).supabase;
  } catch {
    return undefined;
  }
}

export function create_ad_impression_queue(deps?: AdImpressionQueueDeps): AdImpressionQueue {
  // Estas tres viven en el CLOSURE, no en el componente: FlashList recicla las
  // tarjetas del feed, así que un store por componente perdería la marca al
  // reciclar (bug ya vivido con property_id en #112).
  const emitted = new Set<string>();   // pares cuya impresión YA se emitió
  const queue: AdExposure[] = [];      // exposiciones pendientes de enviar
  const parked_taps: AdCtaTap[] = [];  // taps esperando a que su par se emita
  const tapped = new Set<string>();    // pares que ya registraron un tap

  const has_supabase = 'supabase' in (deps ?? {});
  const client = has_supabase ? deps?.supabase : get_default_supabase();

  async function send(impressions: AdExposure[], cta_taps: AdCtaTap[]): Promise<void> {
    if (!client?.functions?.invoke) return;
    const result = await client.functions.invoke('record-ad-impressions', {
      body: { impressions, cta_taps },
    });
    const error = (result as { error?: unknown } | null | undefined)?.error;
    if (error) throw error;
  }

  const flush = async (): Promise<void> => {
    // Se vacía la cola ANTES de mandar: si el envío falla, el batch se pierde
    // (decisión, no descuido). Reencolarlo abriría la puerta a duplicar una
    // impresión facturable, que es peor que subcontar.
    const impressions = queue.splice(0, queue.length);

    // REQUISITO 2: solo viajan los taps cuyo par ya se emitió antes o va en
    // ESTE mismo cuerpo. El handler procesa impresiones antes que taps, así
    // que ir juntos es seguro; ir antes no lo es.
    const in_this_batch = new Set(impressions.map((i) => make_key(i.session_id, i.ad_id)));
    const ready: AdCtaTap[] = [];
    const still_parked: AdCtaTap[] = [];
    for (const tap of parked_taps) {
      const key = make_key(tap.session_id, tap.ad_id);
      if (in_this_batch.has(key) || emitted.has(key)) ready.push(tap);
      else still_parked.push(tap);
    }
    parked_taps.length = 0;
    parked_taps.push(...still_parked);

    if (impressions.length === 0 && ready.length === 0) return;

    // `emitted` ya se marcó al encolar (REQUISITO 1): marcarlo aquí dejaría
    // pasar un segundo encolado del mismo par mientras el primero espera.
    try {
      await send(impressions, ready);
    } catch (err) {
      // Fire-and-forget: la reproducción del feed nunca se rompe por esto.
      console.warn('[adImpressionQueue] no se pudo enviar el batch (se pierde):', err);
    }
  };

  return {
    enqueue_impression(exposure: AdExposure): void {
      const key = make_key(exposure.session_id, exposure.ad_id);
      if (emitted.has(key)) return; // el loop del feed llega aquí, y aquí muere
      emitted.add(key);
      queue.push({
        ad_id: exposure.ad_id,
        session_id: exposure.session_id,
        shown_at: exposure.shown_at,
        watched_ms: exposure.watched_ms,
        completed: exposure.completed,
        lat: exposure.lat,
        lng: exposure.lng,
        device: exposure.device ?? null,
      });
      if (queue.length >= AD_IMPRESSION_BATCH_SIZE) {
        void flush();
      }
    },

    report_cta_tap(tap: AdCtaTap): void {
      const key = make_key(tap.session_id, tap.ad_id);
      if (tapped.has(key)) return; // doble tap = un solo evento
      tapped.add(key);
      // No se dispara un flush aquí — pero conviene ser exacto sobre POR QUÉ,
      // porque la razón obvia es falsa. Un flush disparado desde aquí NO
      // rompería el REQUISITO 2: el guard de `flush` (abajo) es lo que impide
      // que un tap adelante a su impresión, y ese guard aplica venga el flush
      // de donde venga. Verificado por mutación: agregar `void flush()` aquí
      // deja los 17 tests en verde (mutante equivalente); relajar el guard de
      // `flush` mata EC-10 y EC-11 al instante.
      // Lo que sí se gana no disparándolo es no fabricar POSTs de un solo
      // evento cada vez que alguien toca un CTA.
      parked_taps.push(tap);
    },

    flush,
  };
}

/** Singleton de la app — el feed se remonta y FlashList recicla; la sesión no. */
export const ad_impression_queue: AdImpressionQueue = create_ad_impression_queue();
