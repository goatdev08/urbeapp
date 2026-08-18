/**
 * tusUpload.ts — subida RESUMABLE por TUS a Cloudflare Stream, en chunks (192.2).
 *
 * POR QUÉ EXISTE: el direct upload BÁSICO de Stream (un POST multipart) tiene un
 * techo duro de 200 MB. El producto exige 500 MB (`MAX_VIDEO_SIZE_BYTES`), y
 * lo único que lo aguanta en Stream es TUS: la EF `mint-upload-url` crea el
 * upload con `Upload-Length` y devuelve la URL de PATCH; aquí subimos el
 * binario a pedazos con `Upload-Offset`, y ante un tropiezo preguntamos al
 * servidor (HEAD) hasta dónde llegó y seguimos desde ahí — la subida de un
 * video de 500 MB en red móvil se vuelve tolerante a cortes en vez de
 * empezar de cero.
 *
 * Reglas de Cloudflare codificadas aquí:
 *   - chunk múltiplo de 256 KiB, ≥ 5 MiB, ≤ 200 MiB → TUS_CHUNK_BYTES = 16 MiB
 *     (30 requests para 500 MB; el pedazo vive ~16 MiB en RAM entre leer y
 *     escribir el temporal — Hermes aguanta eso sin drama, no un video entero).
 *   - PATCH `Tus-Resumable: 1.0.0`, `Upload-Offset`, `Content-Type:
 *     application/offset+octet-stream` → 204 con `Upload-Offset` nuevo.
 *   - HEAD → `Upload-Offset` actual.
 *
 * Diseño: `tus_upload` es lógica PURA con dos colaboradores inyectados
 * (`TusChunkSource` lee bytes por rango, `TusChunkSink` hace PATCH/HEAD) —
 * así se prueba el protocolo sin expo-file-system ni red. Los adaptadores
 * reales (`make_file_chunk_source`, `make_expo_chunk_sink`) viven abajo y solo
 * los cubre el smoke E2E: son frontera nativa.
 *
 * ponytail: sin tus-js-client — su lector para RN mete el archivo entero en
 * un Blob de RN (bytes en RAM del lado nativo, 500 MB = OOM en Android). El
 * protocolo que necesitamos son 3 headers y un loop; el nativo de expo
 * (`createUploadTask`) streamea cada pedazo desde disco con progreso real.
 * Techo conocido: sin paralelismo entre chunks (Stream tampoco lo admite).
 */

import { File, Paths, UploadType } from 'expo-file-system';

/** 16 MiB — múltiplo de 256 KiB, dentro del [5 MiB, 200 MiB] que exige Stream. */
export const TUS_CHUNK_BYTES = 16 * 1024 * 1024;
/** Fallos CONSECUTIVOS tolerados (PATCH o HEAD) antes de rendirse. */
export const TUS_MAX_RETRIES = 5;

export interface TusChunkSource {
  /** Tamaño total del binario en bytes. */
  size: number;
  /** Lee hasta `length` bytes desde `offset` (menos si el archivo se acaba). */
  read(offset: number, length: number): Uint8Array;
  /** Libera el handle. Se llama SIEMPRE al terminar (éxito, fallo o abort). */
  close(): void;
}

export interface TusChunkSink {
  /**
   * PATCH de `bytes` en `offset`. Resuelve con el status HTTP y el
   * `Upload-Offset` que devolvió el servidor (null si no vino). Rechaza en
   * fallo de red; con `AbortError` cuando `signal` se abortó.
   */
  patch(
    url: string,
    offset: number,
    bytes: Uint8Array,
    opts: { signal: AbortSignal | undefined; on_progress: (sent: number) => void },
  ): Promise<{ status: number; upload_offset: number | null }>;
  /** HEAD → `Upload-Offset` actual del servidor. Rechaza si no lo trae. */
  head(url: string, signal: AbortSignal | undefined): Promise<number>;
}

export type TusUploadResult = { ok: true } | { ok: false; reason: 'aborted' | 'failed' };

export interface TusUploadOptions {
  url: string;
  source: TusChunkSource;
  sink: TusChunkSink;
  /** Default TUS_CHUNK_BYTES. Inyectable para tests. */
  chunk_bytes?: number;
  /** Default TUS_MAX_RETRIES. */
  max_retries?: number;
  signal?: AbortSignal | undefined;
  /** Fracción 0..1 acumulada del binario completo, en vivo. */
  on_progress?: ((fraction: number) => void) | undefined;
}

function is_abort(err: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (err instanceof Error && err.name === 'AbortError');
}

export async function tus_upload(opts: TusUploadOptions): Promise<TusUploadResult> {
  const {
    url,
    source,
    sink,
    chunk_bytes = TUS_CHUNK_BYTES,
    max_retries = TUS_MAX_RETRIES,
    signal,
    on_progress,
  } = opts;
  const size = source.size;
  const report = (sent_total: number): void => {
    if (!on_progress) return;
    on_progress(size > 0 ? Math.min(sent_total / size, 1) : 1);
  };

  let offset = 0;
  let consecutive_failures = 0;

  try {
    while (offset < size) {
      if (signal?.aborted) return { ok: false, reason: 'aborted' };

      const length = Math.min(chunk_bytes, size - offset);
      const bytes = source.read(offset, length);
      const chunk_start = offset;

      let failed = false;
      try {
        const res = await sink.patch(url, chunk_start, bytes, {
          signal,
          on_progress: (sent) => report(chunk_start + sent),
        });
        if (res.status >= 200 && res.status < 300) {
          const server_offset = res.upload_offset;
          offset = server_offset !== null && Number.isFinite(server_offset) && server_offset >= 0
            ? server_offset
            : chunk_start + bytes.byteLength;
          consecutive_failures = 0;
          continue;
        }
        failed = true;
      } catch (err) {
        if (is_abort(err, signal)) return { ok: false, reason: 'aborted' };
        failed = true;
      }

      if (failed) {
        consecutive_failures += 1;
        if (consecutive_failures > max_retries) return { ok: false, reason: 'failed' };
        if (signal?.aborted) return { ok: false, reason: 'aborted' };
        // Resincronizar con el servidor: el chunk pudo haber llegado aunque la
        // respuesta se perdiera. Si el HEAD también falla, conservamos el
        // offset local y volvemos a intentar el mismo pedazo.
        try {
          const server_offset = await sink.head(url, signal);
          if (Number.isFinite(server_offset) && server_offset >= 0 && server_offset <= size) {
            offset = server_offset;
          }
        } catch (err) {
          if (is_abort(err, signal)) return { ok: false, reason: 'aborted' };
        }
      }
    }
    report(size);
    return { ok: true };
  } finally {
    source.close();
  }
}

// ── Adaptadores reales sobre expo-file-system (frontera nativa, sin tests) ──

/** Lee el video por rangos con un FileHandle (offset + readBytes), sin cargar el archivo entero. */
export function make_file_chunk_source(file: File): TusChunkSource {
  const handle = file.open();
  return {
    size: file.size,
    read(offset, length) {
      handle.offset = offset;
      return handle.readBytes(length);
    },
    close() {
      try {
        handle.close();
      } catch {
        // ya cerrado — irrelevante
      }
    },
  };
}

/**
 * PATCH por chunk vía `createUploadTask` (el nativo streamea desde disco y
 * reporta progreso): el pedazo se escribe a un temporal en `Paths.cache`, se
 * sube como BINARY_CONTENT y se borra SIEMPRE. HEAD con fetch plano.
 */
export function make_expo_chunk_sink(): TusChunkSink {
  return {
    async patch(url, offset, bytes, { signal, on_progress }) {
      const tmp = new File(Paths.cache, `urbea-tus-chunk-${offset}.bin`);
      try {
        tmp.create({ overwrite: true });
        tmp.write(bytes);
        const task = tmp.createUploadTask(url, {
          httpMethod: 'PATCH',
          uploadType: UploadType.BINARY_CONTENT,
          headers: {
            'Tus-Resumable': '1.0.0',
            'Upload-Offset': String(offset),
            'Content-Type': 'application/offset+octet-stream',
          },
          ...(signal ? { signal } : {}),
          onProgress: ({ bytesSent }) => on_progress(bytesSent),
        });
        const res = await task.uploadAsync();
        const headers = res.headers ?? {};
        const raw = headers['Upload-Offset'] ?? headers['upload-offset'];
        const parsed = raw !== undefined ? Number(raw) : NaN;
        return { status: res.status, upload_offset: Number.isFinite(parsed) ? parsed : null };
      } finally {
        try {
          tmp.delete();
        } catch {
          // ya no existe — irrelevante
        }
      }
    },
    async head(url, signal) {
      const res = await fetch(url, {
        method: 'HEAD',
        headers: { 'Tus-Resumable': '1.0.0' },
        ...(signal ? { signal } : {}),
      });
      const parsed = Number(res.headers.get('Upload-Offset'));
      if (!res.ok || !Number.isFinite(parsed)) {
        throw new Error(`HEAD tus sin Upload-Offset (status ${res.status})`);
      }
      return parsed;
    },
  };
}
