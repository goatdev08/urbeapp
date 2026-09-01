/**
 * useAdUpload — ciclo de subida del creativo de un anuncio (subtarea 169.7).
 *
 * REUSO deliberado (CLAUDE.md §0) del pipeline de
 * mobile/src/features/publish/hooks/useVideoUpload.ts: mismo patrón de
 * File(local_uri) (expo-file-system v56, getters síncronos .exists/.size),
 * mismo techo MAX_STREAM_UPLOAD_BYTES=500MB (#228, = MAX_VIDEO_SIZE_BYTES),
 * file.createUploadTask(uploadUrl, {onProgress, signal}).uploadAsync(), y el
 * mismo extract_error_code sobre FunctionsHttpError. Este hook NO depende de
 * ningún wizard/contexto (169.8/169.9 no existen todavía): expone
 * `cloudflare_uid` directo en vez de escribir a un form ajeno.
 *
 * DIFERENCIAS DE CONTRATO frente al hermano (ver header del test para el
 * detalle caso por caso, D1-D5):
 *   D1. Tras el binario (2xx O no-2xx/excepción) el ciclo NO termina — sigue
 *       con un POLL de `ad_creatives.status` (checker inyectado) hasta
 *       'ready'|'failed'. progress se queda en 0.99 durante el poll; solo
 *       llega a 1 en 'ready'. Esto incluye "verificar antes de fallar"
 *       (#103, lección heredada del hermano): uploadAsync() puede lanzar o
 *       resolver no-2xx aunque el binario SÍ haya llegado completo a Stream
 *       (falso negativo leyendo la respuesta HTTP) — el 2xx feliz y el
 *       no-2xx/excepción CONFLUYEN en el mismo poll, nunca declaran 'failed'
 *       sin antes consultar el estado real del creativo.
 *   D2. La duración (169.6, validate_ad_duration_ms) se valida ANTES de
 *       construir `File` o tocar la red. Desde #189 es FAIL-OPEN ante
 *       duración ausente: un picker que no la reporta ya no bloquea; sube y
 *       el servidor decide con la duración real de Stream.
 *   D3. mint-ad-upload-url (169.4) tiene errores propios: FORBIDDEN (403) y
 *       AD_UPLOAD_IN_PROGRESS (409, scoped por agencia) — el 409 se traduce
 *       a un mensaje entendible y DISTINTO del genérico (es un estado
 *       esperado, no una falla).
 *   D4. `ad_creatives.failure_reason` (#189) guarda POR QUÉ falló un creativo,
 *       así que el poll LEE la razón en vez de inferirla. Antes la columna no
 *       existía —el adapter recibía el reason_code y lo descartaba— y este
 *       hook adivinaba "por eliminación, esto es transcodificación",
 *       mostrando ese mensaje incluso cuando el rechazo había sido por
 *       duración (caso real desde que D2 es fail-open: cliente y servidor
 *       miden la duración por separado, y el picker puede no reportarla).
 *       Hoy: failure_reason = AD_DURATION_INVALID ⇒ mensaje de duración;
 *       cualquier otra cosa, incluido NULL ⇒ mensaje de transcodificación.
 *   D5. El hook cancela automáticamente al desmontar (cleanup de efecto) —
 *       el hermano no lo hace; aquí se pide explícito que no queden timers
 *       vivos ni setState sobre un componente desmontado (por eso el cleanup
 *       NO notifica on_status_change/on_progress, solo aborta en silencio).
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { File, UploadType } from 'expo-file-system';

import {
  AD_DURATION_INVALID,
  AD_MAX_DURATION_SECONDS,
  AD_MIN_DURATION_SECONDS,
  validate_ad_duration_ms,
} from '../lib/validation';
import { MAX_VIDEO_SIZE_BYTES } from '@/features/publish/validation';
import {
  make_expo_chunk_sink,
  make_file_chunk_source,
  tus_upload,
  type TusUploadResult,
} from '@/features/publish/lib/tusUpload';
import { extract_error_code } from '@/lib/supabase/edge-errors';
import type { Database } from '@/types/database';

/**
 * 🔴 El genérico <Database> NO es decorativo: sin él, supabase-js deja de
 * chequear el esquema POR COMPLETO — cualquier `.from('lo_que_sea')` compila
 * y `data` llega como `any`. Así fue como el `select('status')` sobre
 * `ad_creatives` de aquí abajo pasó tsc mientras los tipos generados llevaban
 * 10 migraciones de retraso (#190).
 */
type AdsSupabaseClient = SupabaseClient<Database>;

// #228: mismo techo que el hermano (useVideoUpload) POR CONSTRUCCIÓN —
// MAX_VIDEO_SIZE_BYTES (500 MB, publish/validation). El camino >200 MB va por
// TUS resumable (protocol:'tus' del mint, calco de 192.2); el POST básico
// queda para la respuesta sin protocol (EF vieja).
export const MAX_STREAM_UPLOAD_BYTES = MAX_VIDEO_SIZE_BYTES;

const SESSION_ERROR_MESSAGE = 'No hay sesión activa. Inicia sesión para publicar.';
const FORBIDDEN_MESSAGE = 'No tienes permiso para publicar anuncios de esta organización.';
const AD_UPLOAD_IN_PROGRESS_MESSAGE =
  'Ya tienes un anuncio subiéndose. Espera a que termine para subir otro.';
const NEUTRAL_ERROR_MESSAGE = 'Error al subir el anuncio. Verifica tu conexión e intenta de nuevo.';
// #228: mensajes espejo del wizard de propiedades — mismos límites, misma voz.
const AD_DURATION_INVALID_MESSAGE =
  `El video debe durar entre ${AD_MIN_DURATION_SECONDS} y ${AD_MAX_DURATION_SECONDS} segundos (máx 2 min). Recórtalo o elige otro.`;
const TRANSCODING_FAILED_MESSAGE = 'El anuncio no se pudo procesar. Intenta subir el video de nuevo.';
const SIZE_ERROR_MESSAGE = `El video supera el máximo permitido (${Math.round(MAX_STREAM_UPLOAD_BYTES / (1024 * 1024))} MB). Intenta con un video más ligero.`;

// Defaults del poll (D1) — acotado, mismo criterio que verify_attempts/
// verify_interval_ms del hermano (#103.2). #229: 10→40 intentos (~2 min):
// con #228 el creativo puede durar 2 min / pesar 500 MB y la transcodificación
// real de Stream ya no cabía en los ~30 s originales — el poll se agotaba con
// el video sano y reportaba un error falso.
const DEFAULT_POLL_ATTEMPTS = 40;
const DEFAULT_POLL_INTERVAL_MS = 3000;

/** Estado observable del hook. 'polling' cubre el tramo entre el 2xx del binario y el desenlace del creativo. */
export type AdUploadStatus = 'idle' | 'uploading' | 'polling' | 'ready' | 'failed';

/**
 * DESENLACE de consultar el creativo, según lo reporta el checker.
 *
 * No es un espejo 1:1 de `ad_creatives.status`: 'missing' (sin fila para ese
 * uid) nunca existió en la tabla, y #189 añade 'failed_duration' con el mismo
 * criterio — es un 'failed' cuya `failure_reason` es AD_DURATION_INVALID.
 * Colapsar la razón en el status aquí, en vez de devolver un objeto
 * {status, failure_reason}, mantiene el contrato del colaborador inyectable
 * en un solo valor.
 *
 * ponytail: un miembro más del union en vez de cambiar la firma del checker
 * y sus ~30 usos. Techo conocido: si aparece una tercera razón que el usuario
 * deba distinguir, esto pasa a ser un objeto.
 */
export type AdCreativeCheckStatus =
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'failed_duration'
  | 'missing';

export interface UseAdUploadDeps {
  /** Cliente Supabase — inyectable para tests. Por defecto el singleton del módulo. */
  supabase?: AdsSupabaseClient;
  /** Consulta el estado real del creativo por su cloudflare_uid — colaborador inyectable para tests. */
  check_ad_creative_status?: (cloudflare_uid: string) => Promise<AdCreativeCheckStatus>;
  /**
   * #228 — subida TUS (rama `protocol:'tus'` de mint-ad-upload-url, calco de
   * 192.2). Inyectable para tests; por defecto `tus_upload` real sobre
   * expo-file-system (publish/lib/tusUpload — REUSO, CLAUDE.md §0).
   */
  tus_uploader?: (args: {
    url: string;
    file: File;
    signal: AbortSignal;
    on_progress: (fraction: number) => void;
  }) => Promise<TusUploadResult>;
  /** Intentos máximos de poll antes de rendirse con un mensaje neutro. */
  poll_attempts?: number;
  /** Espera entre intentos de poll, en ms (nunca antes del primer intento). */
  poll_interval_ms?: number;
  /** Notificado en cada transición de status durante upload() — ver gotcha O2 del hermano. */
  on_status_change?: (status: AdUploadStatus) => void;
  /** Notificado con cada avance de progreso 0..1. */
  on_progress?: (progress: number) => void;
}

export interface UseAdUploadParams {
  /** URI local del video elegido (expo-image-picker). null = nada elegido. */
  local_uri: string | null;
  /** Duración del video en milisegundos, tal como la reporta el picker. Fail-closed si falta. */
  duration_ms: number | null;
}

export interface UseAdUploadResult {
  /** Inicia la subida del creativo. Si hay otra en vuelo, la reemplaza (supersede). */
  upload: (params: UseAdUploadParams) => Promise<void>;
  /** Cancela la subida/poll en vuelo (si la hay): aborta y vuelve a 'idle' sin error. */
  cancel: () => void;
  status: AdUploadStatus;
  /** Progreso 0..1. Se mantiene en 0.99 durante el poll — solo llega a 1 cuando status='ready'. */
  progress: number;
  /** Mensaje de error si status==='failed'; null en caso contrario. */
  error: string | null;
  /** uid de Cloudflare Stream del creativo, solo una vez status==='ready'; null en cualquier otro caso. */
  cloudflare_uid: string | null;
}

// ponytail: import lazy — el cliente real solo se carga cuando no se inyecta
// uno externo (los tests siempre inyectan su propio mock).
function get_default_supabase(): AdsSupabaseClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@/lib/supabase/client') as { supabase: AdsSupabaseClient }).supabase;
}

/** Mapea el error_code de mint-ad-upload-url a un mensaje en español (D3). */
function map_mint_error_code(code: string | undefined): string {
  if (code === 'UNAUTHENTICATED') return SESSION_ERROR_MESSAGE;
  if (code === 'FORBIDDEN') return FORBIDDEN_MESSAGE;
  if (code === 'AD_UPLOAD_IN_PROGRESS') return AD_UPLOAD_IN_PROGRESS_MESSAGE;
  return NEUTRAL_ERROR_MESSAGE;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** #228 — default real de la rama TUS: fuente por FileHandle + sink por createUploadTask (PATCH). Mismo default que el hermano. */
function default_tus_uploader(args: {
  url: string;
  file: File;
  signal: AbortSignal;
  on_progress: (fraction: number) => void;
}): Promise<TusUploadResult> {
  return tus_upload({
    url: args.url,
    source: make_file_chunk_source(args.file),
    sink: make_expo_chunk_sink(),
    signal: args.signal,
    on_progress: args.on_progress,
  });
}

/**
 * Checker por defecto — consulta `ad_creatives` por cloudflare_uid. Sin fila →
 * 'missing'. #189: pide TAMBIÉN `failure_reason` y traduce un 'failed' por
 * duración a 'failed_duration', para que el hook no tenga que adivinar.
 */
async function default_check_ad_creative_status(
  supabase_client: AdsSupabaseClient,
  cloudflare_uid: string,
): Promise<AdCreativeCheckStatus> {
  const { data, error } = await supabase_client
    .from('ad_creatives')
    .select('status, failure_reason')
    .eq('cloudflare_uid', cloudflare_uid)
    .maybeSingle();

  if (error) throw error;
  if (!data) return 'missing';
  if (data.status === 'failed' && data.failure_reason === AD_DURATION_INVALID) {
    return 'failed_duration';
  }
  return data.status;
}

/**
 * Poll de `ad_creatives.status` hasta 'ready'|'failed' (D1/D4). Duerme ENTRE
 * intentos (nunca antes del primero). `is_current` corta el loop de
 * inmediato tras cualquier await (sleep o checker) si el upload fue
 * cancelado/superado/desmontado mientras tanto — sin eso, un checker que
 * resuelve tarde dispararía una llamada de más (EC25/EC27).
 */
async function poll_until_resolved(params: {
  cloudflare_uid: string;
  checker: (cloudflare_uid: string) => Promise<AdCreativeCheckStatus>;
  attempts: number;
  interval_ms: number;
  is_current: () => boolean;
  set_status: (status: AdUploadStatus) => void;
  set_progress: (progress: number) => void;
  set_error: (message: string | null) => void;
  set_cloudflare_uid: (uid: string | null) => void;
}): Promise<void> {
  const {
    cloudflare_uid,
    checker,
    attempts,
    interval_ms,
    is_current,
    set_status,
    set_progress,
    set_error,
    set_cloudflare_uid,
  } = params;

  set_status('polling');
  set_progress(0.99);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await sleep(interval_ms);
    }
    if (!is_current()) return; // cancelado/superado/desmontado mientras dormía

    // #229: una excepción del checker es un intento fallido que se REINTENTA,
    // no un desenlace — cambiar de red wifi durante el poll produce exactamente
    // ese blip, y antes mataba el ciclo con el video sano (incidente
    // 2026-09-01). Terminal solo al agotar los intentos.
    let check_status: AdCreativeCheckStatus;
    try {
      check_status = await checker(cloudflare_uid);
    } catch (err) {
      if (!is_current()) return;
      console.warn('[useAdUpload] check_ad_creative_status falló (reintentable):', err);
      continue;
    }
    if (!is_current()) return; // cancelado/superado/desmontado mientras el checker resolvía

    if (check_status === 'ready') {
      set_cloudflare_uid(cloudflare_uid);
      set_status('ready');
      set_progress(1);
      set_error(null);
      return;
    }

    if (check_status === 'failed_duration') {
      // #189: el servidor rechazó por DURACIÓN. Ya no se adivina — la razón
      // viene de ad_creatives.failure_reason. Mismo mensaje que el
      // pre-flight, porque es el mismo problema.
      set_status('failed');
      set_error(AD_DURATION_INVALID_MESSAGE);
      return;
    }

    if (check_status === 'failed') {
      // Falló sin razón registrada, o con una que no es de duración
      // (errorReasonCode de Cloudflare): el mensaje genérico es el correcto.
      set_status('failed');
      set_error(TRANSCODING_FAILED_MESSAGE);
      return;
    }

    // 'processing' | 'uploading' | 'missing' → sigue en curso, reintentar.
  }

  if (!is_current()) return;
  // Intentos agotados sin 'ready'/'failed'.
  set_status('failed');
  set_error(NEUTRAL_ERROR_MESSAGE);
}

/** Hook que encapsula el ciclo de subida del creativo de un anuncio (mint → binario → poll). */
export function useAdUpload(deps?: UseAdUploadDeps): UseAdUploadResult {
  const supabase_client = deps?.supabase ?? get_default_supabase();
  const check_ad_creative_status = deps?.check_ad_creative_status;
  const poll_attempts = deps?.poll_attempts ?? DEFAULT_POLL_ATTEMPTS;
  const poll_interval_ms = deps?.poll_interval_ms ?? DEFAULT_POLL_INTERVAL_MS;
  const on_status_change = deps?.on_status_change;
  const on_progress = deps?.on_progress;
  const tus_uploader = deps?.tus_uploader ?? default_tus_uploader;

  const status_ref = useRef<AdUploadStatus>('idle');
  const progress_ref = useRef<number>(0);
  const error_ref = useRef<string | null>(null);
  const cloudflare_uid_ref = useRef<string | null>(null);
  // Generación del upload vigente + su AbortController. Un upload cuyo seq ya
  // no es el actual fue cancelado/superado/desmontado: no escribe nada más.
  const upload_seq_ref = useRef(0);
  const abort_ref = useRef<AbortController | null>(null);

  const cancel = useCallback((): void => {
    upload_seq_ref.current += 1;
    abort_ref.current?.abort();
    abort_ref.current = null;
    status_ref.current = 'idle';
    progress_ref.current = 0;
    error_ref.current = null;
    cloudflare_uid_ref.current = null;
    on_status_change?.('idle');
    on_progress?.(0);
  }, [on_status_change, on_progress]);

  // D5: cancela automáticamente al desmontar (mismo patrón de efecto de
  // limpieza que el hermano podría tener, pero no tiene — aquí es contrato
  // explícito). NO notifica on_status_change/on_progress (el componente ya
  // se está desmontando; llamarlos arriesgaría un setState sobre un padre
  // desmontado) — solo aborta el binario/poll en vuelo e invalida el seq
  // para que ningún await pendiente escriba después.
  useEffect(() => {
    return () => {
      upload_seq_ref.current += 1;
      abort_ref.current?.abort();
      abort_ref.current = null;
    };
  }, []);

  const upload = useCallback(
    async (params: UseAdUploadParams): Promise<void> => {
      const { local_uri, duration_ms } = params;

      // Supersede: si hay otro upload en vuelo, este lo reemplaza.
      if (abort_ref.current) abort_ref.current.abort();
      upload_seq_ref.current += 1;
      const my_seq = upload_seq_ref.current;
      const controller = new AbortController();
      abort_ref.current = controller;
      const is_current = (): boolean => upload_seq_ref.current === my_seq;

      const set_status = (next: AdUploadStatus): void => {
        if (!is_current()) return;
        status_ref.current = next;
        on_status_change?.(next);
      };
      const set_progress = (next: number): void => {
        if (!is_current()) return;
        progress_ref.current = next;
        on_progress?.(next);
      };
      const set_error = (message: string | null): void => {
        if (!is_current()) return;
        error_ref.current = message;
      };
      const set_cloudflare_uid = (uid: string | null): void => {
        if (!is_current()) return;
        cloudflare_uid_ref.current = uid;
      };

      // Guard: no URI seleccionado.
      if (!local_uri) {
        set_status('failed');
        set_error('No se seleccionó ningún video');
        set_progress(0);
        return;
      }

      // D2: la duración se valida ANTES de tocar el archivo o la red — mint
      // NUNCA se invoca con una duración inválida.
      const duration_check = validate_ad_duration_ms(duration_ms);
      if (!duration_check.valid) {
        set_status('failed');
        set_error(AD_DURATION_INVALID_MESSAGE);
        set_progress(0);
        return;
      }

      // Marcar como uploading ANTES del primer await — sincrónico, visible
      // vía getter en sync act().
      set_status('uploading');
      set_error(null);
      set_progress(0);

      // Validación local: existencia + techo de tamaño — SÍNCRONA vía la API
      // de File (v56): .exists/.size son getters síncronos, sin I/O extra.
      const file = new File(local_uri);
      if (!file.exists) {
        set_status('failed');
        set_error('El archivo de video no existe');
        return;
      }
      if (file.size > MAX_STREAM_UPLOAD_BYTES) {
        set_status('failed');
        set_error(SIZE_ERROR_MESSAGE);
        return;
      }

      // Paso 1 — mint-ad-upload-url: crea el upload slot en Cloudflare Stream
      // scoped por organización (169.4) y devuelve { uploadUrl, uid, protocol }.
      // #228: `size_bytes` → la EF crea el upload por TUS (Upload-Length
      // exacto) y responde protocol:'tus'. Una EF vieja lo ignora y responde
      // sin protocol → rama básica (orden de deploy EF/OTA independiente,
      // mismo criterio que 192.2 en el hermano).
      // #229: `replace: true` → la EF cancela el creativo pendiente de la
      // ORGANIZACIÓN antes del 409 (espejo del hermano) — sin esto, una fila
      // 'uploading' atorada por un cambio de wifi bloqueaba 15 min sin escape.
      let upload_url: string;
      let stream_uid: string;
      let protocol: 'tus' | 'basic';
      try {
        const { data, error: mint_error } = await supabase_client.functions.invoke<{
          uploadUrl: string;
          uid: string;
          protocol?: 'tus' | 'basic';
        }>('mint-ad-upload-url', { body: { replace: true, size_bytes: file.size } });
        if (!is_current()) return; // cancelado/superado mientras minteaba

        if (mint_error || !data?.uploadUrl || !data?.uid) {
          const code = await extract_error_code(mint_error);
          set_status('failed');
          set_error(map_mint_error_code(code));
          return;
        }
        upload_url = data.uploadUrl;
        stream_uid = data.uid;
        protocol = data.protocol === 'tus' ? 'tus' : 'basic';
      } catch {
        if (!is_current()) return;
        set_status('failed');
        set_error(NEUTRAL_ERROR_MESSAGE);
        return;
      }

      // Paso 2 — subida del binario a Stream. Dos ramas según `protocol`
      // (#228, calco de 192.2):
      //   'tus'   → PATCH resumable en chunks de 16 MiB (publish/lib/tusUpload):
      //             único camino >200 MB; el progreso llega por chunk acumulado.
      //   'basic' → POST multipart/form-data de siempre (EF vieja o fallback).
      //
      // #103 (lección heredada del hermano, tarea #103 + subtarea 103.2):
      // el binario puede LANZAR o resolver no-2xx aunque SÍ haya llegado
      // completo a Stream (falso negativo leyendo la respuesta HTTP). Copiar
      // el pipeline sin copiar el arreglo hereda el bug — y aquí es peor:
      // mint-ad-upload-url NO tiene ventana de expiración para 'processing'
      // (types.ts — solo 'uploading' tiene stale_before), así que un falso
      // negativo tratado como fallo real dejaría al creativo huérfano y
      // bloquearía a la organización con 409 AD_UPLOAD_IN_PROGRESS hasta
      // liberar la fila a mano. Por eso `stream_upload_ok` NO decide un
      // 'failed' aquí — solo se usa para decidir si hace falta el warning; el
      // éxito Y el no-2xx/excepción CONFLUYEN en el MISMO poll_until_resolved
      // de abajo (D1): verifica el estado real del creativo antes de declarar
      // 'failed'. DIFERENCIA deliberada con el hermano: allí el éxito TUS
      // declara 'processing' directo; aquí AMBAS ramas pasan por el poll.
      let stream_upload_ok: boolean;
      if (protocol === 'tus') {
        let tus_result: TusUploadResult;
        try {
          tus_result = await tus_uploader({
            url: upload_url,
            file,
            signal: controller.signal,
            on_progress: (fraction) => set_progress(Math.min(fraction, 0.99)),
          });
        } catch (err) {
          if (!is_current()) return; // abortado por cancel()/supersede/unmount — silencio
          console.warn('[useAdUpload] tus_upload lanzó, verificando estado real antes de fallar (#103):', err);
          tus_result = { ok: false, reason: 'failed' };
        }
        if (!is_current()) return; // cancelado/superado mientras subía
        if (!tus_result.ok && tus_result.reason === 'aborted') return; // silencio (cancel)
        stream_upload_ok = tus_result.ok;
      } else {
        const task = file.createUploadTask(upload_url, {
          httpMethod: 'POST',
          uploadType: UploadType.MULTIPART,
          fieldName: 'file',
          signal: controller.signal,
          onProgress: ({ bytesSent, totalBytes }) => {
            set_progress(totalBytes > 0 ? Math.min(bytesSent / totalBytes, 0.99) : 0);
          },
        });
        try {
          const { status } = await task.uploadAsync();
          stream_upload_ok = status >= 200 && status < 300;
        } catch (err) {
          if (!is_current()) return; // abortado por cancel()/supersede/unmount — silencio
          console.warn('[useAdUpload] uploadAsync failed, verificando estado real antes de fallar (#103):', err);
          stream_upload_ok = false;
        }
        if (!is_current()) return; // cancelado/superado mientras subía
      }

      if (!stream_upload_ok) {
        console.warn('[useAdUpload] binario no confirmó 2xx, verificando estado real antes de fallar (#103)');
      }

      await poll_until_resolved({
        cloudflare_uid: stream_uid,
        checker: check_ad_creative_status ?? ((uid) => default_check_ad_creative_status(supabase_client, uid)),
        attempts: poll_attempts,
        interval_ms: poll_interval_ms,
        is_current,
        set_status,
        set_progress,
        set_error,
        set_cloudflare_uid,
      });
      if (is_current()) abort_ref.current = null;
    },

    [supabase_client, check_ad_creative_status, poll_attempts, poll_interval_ms, on_status_change, on_progress, tus_uploader],
  );

  return useMemo(
    () => ({
      upload,
      cancel,
      get status(): AdUploadStatus {
        return status_ref.current;
      },
      get progress(): number {
        return progress_ref.current;
      },
      get error(): string | null {
        return error_ref.current;
      },
      get cloudflare_uid(): string | null {
        return cloudflare_uid_ref.current;
      },
    }),

    [upload, cancel],
  );
}
