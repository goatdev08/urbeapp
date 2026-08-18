// stub RED 192.2 — implementación real en GREEN
export const TUS_CHUNK_BYTES = 0;
export const TUS_MAX_RETRIES = 0;

export interface TusChunkSource {
  size: number;
  read(offset: number, length: number): Uint8Array;
  close(): void;
}

export interface TusChunkSink {
  patch(
    url: string,
    offset: number,
    bytes: Uint8Array,
    opts: { signal?: AbortSignal; on_progress: (sent: number) => void },
  ): Promise<{ status: number; upload_offset: number | null }>;
  head(url: string, signal?: AbortSignal): Promise<number>;
}

export type TusUploadResult = { ok: true } | { ok: false; reason: 'aborted' | 'failed' };

export interface TusUploadOptions {
  url: string;
  source: TusChunkSource;
  sink: TusChunkSink;
  chunk_bytes?: number;
  max_retries?: number;
  signal?: AbortSignal;
  on_progress?: (fraction: number) => void;
}

export async function tus_upload(_opts: TusUploadOptions): Promise<TusUploadResult> {
  return { ok: false, reason: 'failed' };
}
