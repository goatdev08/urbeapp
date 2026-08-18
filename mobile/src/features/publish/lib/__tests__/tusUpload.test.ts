/**
 * Tests RED — 192.2: `tus_upload` (lib/tusUpload.ts)
 *
 * Subida resumable por TUS a Cloudflare Stream en chunks (PATCH + Upload-Offset),
 * lógica PURA con dos colaboradores inyectados:
 *   - TusChunkSource: { size, read(offset, length) → Uint8Array, close() }
 *   - TusChunkSink:   { patch(url, offset, bytes, {signal, on_progress}) →
 *                        {status, upload_offset|null}; head(url, signal) → offset }
 * (los adaptadores reales sobre expo-file-system viven en el mismo archivo pero
 * NO se prueban aquí — frontera nativa; el smoke E2E los cubre).
 *
 * Reglas de Cloudflare que codifica el SUT:
 *   - TUS_CHUNK_BYTES = 16 MiB (múltiplo de 256 KiB, ≥ 5 MiB, ≤ 200 MiB).
 *   - PATCH secuenciales; el offset avanza con el `Upload-Offset` que devuelve el
 *     servidor (o offset+len si el sink no lo trae).
 *   - Ante fallo (throw o no-2xx) → HEAD para resincronizar el offset real y
 *     reintentar; techo TUS_MAX_RETRIES (5) de fallos CONSECUTIVOS.
 *   - AbortSignal → { ok:false, reason:'aborted' } sin más PATCH.
 *
 * EDGE CASES (RED):
 * ### Chunking
 * - (C-1) constantes: TUS_CHUNK_BYTES = 16 MiB, TUS_MAX_RETRIES = 5
 * - (C-2) archivo de 40 MiB con chunk 16 MiB → 3 PATCH en offsets 0, 16, 32 MiB con
 *         longitudes 16, 16, 8 MiB (el último parcial) — leídos con esos mismos args
 * - (C-3) archivo menor que un chunk → 1 solo PATCH con la longitud exacta
 * - (C-4) archivo de tamaño 0 → ok sin PATCH
 * - (C-5) chunk_bytes inyectable (tests usan tamaños chicos) — el default es TUS_CHUNK_BYTES
 * ### Progreso
 * - (P-1) on_progress reporta fracción acumulada (offset + sent)/size durante cada
 *         chunk, monótona no decreciente, y 1 al terminar
 * ### Offset del servidor
 * - (O-1) si el sink devuelve upload_offset, el siguiente PATCH arranca ahí (aunque
 *         difiera de offset+len)
 * ### Fallos y reanudación
 * - (F-1) PATCH lanza → HEAD → reanuda desde el offset que dice el servidor (que
 *         puede ser MAYOR: el chunk llegó aunque la respuesta se perdió) → ok
 * - (F-2) PATCH no-2xx (500) → misma ruta de HEAD + reintento
 * - (F-3) más de TUS_MAX_RETRIES fallos consecutivos → { ok:false, reason:'failed' }
 * - (F-4) el contador de reintentos se REINICIA tras un chunk exitoso (5 fallos
 *         repartidos con éxitos en medio NO fallan)
 * - (F-5) HEAD lanza → cuenta como reintento, conserva el offset local y sigue
 * ### Abort
 * - (A-1) signal abortado antes de empezar → aborted, 0 PATCH
 * - (A-2) abort a mitad (el sink rechaza con AbortError) → aborted, sin HEAD ni más PATCH
 * ### Recursos
 * - (R-1) source.close() se llama SIEMPRE (éxito, fallo, abort)
 */

import {
  TUS_CHUNK_BYTES,
  TUS_MAX_RETRIES,
  tus_upload,
  type TusChunkSink,
  type TusChunkSource,
} from '../tusUpload';

const MiB = 1024 * 1024;
const URL = 'https://upload.cloudflarestream.com/tus/uid-test?tusv2=true';

// ── Fakes ─────────────────────────────────────────────────────────────────────

interface FakeSource extends TusChunkSource {
  reads: Array<{ offset: number; length: number }>;
  closed: number;
}

function make_source(size: number): FakeSource {
  return {
    size,
    reads: [],
    closed: 0,
    read(offset, length) {
      this.reads.push({ offset, length });
      const len = Math.min(length, size - offset);
      return new Uint8Array(len);
    },
    close() {
      this.closed += 1;
    },
  };
}

type PatchCall = { offset: number; length: number };
type PatchScript = (call: PatchCall, n: number) => Promise<{ status: number; upload_offset: number | null }>;

interface FakeSink extends TusChunkSink {
  patches: PatchCall[];
  heads: number;
}

function make_sink(opts: {
  patch?: PatchScript;
  head?: (n: number) => Promise<number>;
  emit_progress?: boolean;
} = {}): FakeSink {
  const {
    patch = async (c) => ({ status: 204, upload_offset: c.offset + c.length }),
    head = async () => { throw new Error('head no esperado'); },
    emit_progress = true,
  } = opts;
  return {
    patches: [],
    heads: 0,
    async patch(_url, offset, bytes, { signal, on_progress }) {
      if (signal?.aborted) {
        const e = new Error('Aborted'); e.name = 'AbortError'; throw e;
      }
      const call = { offset, length: bytes.byteLength };
      this.patches.push(call);
      if (emit_progress) {
        on_progress(Math.floor(bytes.byteLength / 2));
        on_progress(bytes.byteLength);
      }
      return patch(call, this.patches.length);
    },
    async head() {
      this.heads += 1;
      return head(this.heads);
    },
  };
}

// ── Chunking ──────────────────────────────────────────────────────────────────

describe('tus_upload — chunking', () => {
  it('(C-1) constantes 16 MiB y 5 reintentos', () => {
    expect(TUS_CHUNK_BYTES).toBe(16 * MiB);
    expect(TUS_CHUNK_BYTES % (256 * 1024)).toBe(0);
    expect(TUS_CHUNK_BYTES).toBeGreaterThanOrEqual(5 * MiB);
    expect(TUS_CHUNK_BYTES).toBeLessThanOrEqual(200 * MiB);
    expect(TUS_MAX_RETRIES).toBe(5);
  });

  it('(C-2) 40 MiB con chunk 16 MiB → PATCH en 0/16/32 MiB con 16/16/8 MiB', async () => {
    const source = make_source(40 * MiB);
    const sink = make_sink();
    const res = await tus_upload({ url: URL, source, sink, chunk_bytes: 16 * MiB });
    expect(res).toEqual({ ok: true });
    expect(sink.patches).toEqual([
      { offset: 0, length: 16 * MiB },
      { offset: 16 * MiB, length: 16 * MiB },
      { offset: 32 * MiB, length: 8 * MiB },
    ]);
    expect(source.reads).toEqual([
      { offset: 0, length: 16 * MiB },
      { offset: 16 * MiB, length: 16 * MiB },
      { offset: 32 * MiB, length: 8 * MiB },
    ]);
  });

  it('(C-3) archivo menor que un chunk → un solo PATCH exacto', async () => {
    const source = make_source(3 * MiB);
    const sink = make_sink();
    const res = await tus_upload({ url: URL, source, sink, chunk_bytes: 16 * MiB });
    expect(res).toEqual({ ok: true });
    expect(sink.patches).toEqual([{ offset: 0, length: 3 * MiB }]);
  });

  it('(C-4) tamaño 0 → ok sin PATCH', async () => {
    const source = make_source(0);
    const sink = make_sink();
    const res = await tus_upload({ url: URL, source, sink });
    expect(res).toEqual({ ok: true });
    expect(sink.patches).toHaveLength(0);
  });

  it('(C-5) chunk_bytes por default = TUS_CHUNK_BYTES', async () => {
    const source = make_source(TUS_CHUNK_BYTES + 1);
    const sink = make_sink();
    await tus_upload({ url: URL, source, sink });
    expect(sink.patches.map((p) => p.length)).toEqual([TUS_CHUNK_BYTES, 1]);
  });
});

// ── Progreso ──────────────────────────────────────────────────────────────────

describe('tus_upload — progreso', () => {
  it('(P-1) fracción acumulada, monótona, termina en 1', async () => {
    const source = make_source(20 * MiB);
    const sink = make_sink();
    const ticks: number[] = [];
    await tus_upload({ url: URL, source, sink, chunk_bytes: 10 * MiB, on_progress: (f) => ticks.push(f) });
    // chunk 1: 5/20, 10/20 · chunk 2: 15/20, 20/20 · final: 1
    expect(ticks).toEqual([0.25, 0.5, 0.75, 1, 1]);
    for (let i = 1; i < ticks.length; i += 1) expect(ticks[i]).toBeGreaterThanOrEqual(ticks[i - 1]);
  });
});

// ── Offset del servidor ───────────────────────────────────────────────────────

describe('tus_upload — offset del servidor', () => {
  it('(O-1) el siguiente PATCH arranca en el Upload-Offset devuelto', async () => {
    const source = make_source(30 * MiB);
    // El servidor dice que solo aceptó 8 MiB del primer chunk de 10.
    const sink = make_sink({
      patch: async (c, n) => ({ status: 204, upload_offset: n === 1 ? 8 * MiB : c.offset + c.length }),
    });
    const res = await tus_upload({ url: URL, source, sink, chunk_bytes: 10 * MiB });
    expect(res).toEqual({ ok: true });
    expect(sink.patches.map((p) => p.offset)).toEqual([0, 8 * MiB, 18 * MiB, 28 * MiB]);
  });
});

// ── Fallos y reanudación ──────────────────────────────────────────────────────

describe('tus_upload — fallos y reanudación', () => {
  it('(F-1) PATCH lanza → HEAD → reanuda desde el offset del servidor (mayor)', async () => {
    const source = make_source(30 * MiB);
    const sink = make_sink({
      patch: async (_c, n) => {
        if (n === 2) throw new Error('network');
        return { status: 204, upload_offset: null };
      },
      // El chunk 2 SÍ llegó (10..20) aunque la respuesta se perdió.
      head: async () => 20 * MiB,
    });
    const res = await tus_upload({ url: URL, source, sink, chunk_bytes: 10 * MiB });
    expect(res).toEqual({ ok: true });
    expect(sink.heads).toBe(1);
    expect(sink.patches.map((p) => p.offset)).toEqual([0, 10 * MiB, 20 * MiB]);
  });

  it('(F-2) PATCH no-2xx → HEAD + reintento del mismo chunk', async () => {
    const source = make_source(20 * MiB);
    const sink = make_sink({
      patch: async (_c, n) => (n === 1 ? { status: 500, upload_offset: null } : { status: 204, upload_offset: null }),
      head: async () => 0,
    });
    const res = await tus_upload({ url: URL, source, sink, chunk_bytes: 10 * MiB });
    expect(res).toEqual({ ok: true });
    expect(sink.heads).toBe(1);
    expect(sink.patches.map((p) => p.offset)).toEqual([0, 0, 10 * MiB]);
  });

  it('(F-3) más de TUS_MAX_RETRIES fallos consecutivos → failed', async () => {
    const source = make_source(20 * MiB);
    const sink = make_sink({
      patch: async () => { throw new Error('network'); },
      head: async () => 0,
    });
    const res = await tus_upload({ url: URL, source, sink, chunk_bytes: 10 * MiB });
    expect(res).toEqual({ ok: false, reason: 'failed' });
    expect(sink.patches).toHaveLength(TUS_MAX_RETRIES + 1);
  });

  it('(F-4) el contador se reinicia tras un chunk exitoso', async () => {
    // 3 chunks; cada uno falla 3 veces antes de pasar (9 fallos totales > 5,
    // pero nunca 6 consecutivos).
    const source = make_source(30 * MiB);
    let fails_this_chunk = 0;
    const sink = make_sink({
      patch: async (c) => {
        if (fails_this_chunk < 3) { fails_this_chunk += 1; throw new Error('flaky'); }
        fails_this_chunk = 0;
        return { status: 204, upload_offset: c.offset + c.length };
      },
      head: async () => {
        // offset local sigue siendo el correcto (el servidor no aceptó nada)
        return -1; // sentinel: el SUT debe IGNORAR valores negativos/inválidos
      },
    });
    const res = await tus_upload({ url: URL, source, sink, chunk_bytes: 10 * MiB });
    expect(res).toEqual({ ok: true });
    expect(sink.patches.filter((p) => p.offset === 20 * MiB).length).toBeGreaterThan(0);
  });

  it('(F-5) HEAD lanza → cuenta reintento, conserva offset local y sigue', async () => {
    const source = make_source(20 * MiB);
    const sink = make_sink({
      patch: async (_c, n) => (n === 1 ? { status: 502, upload_offset: null } : { status: 204, upload_offset: null }),
      head: async () => { throw new Error('head down'); },
    });
    const res = await tus_upload({ url: URL, source, sink, chunk_bytes: 10 * MiB });
    expect(res).toEqual({ ok: true });
    expect(sink.patches.map((p) => p.offset)).toEqual([0, 0, 10 * MiB]);
  });
});

// ── Abort ─────────────────────────────────────────────────────────────────────

describe('tus_upload — abort', () => {
  it('(A-1) signal ya abortado → aborted sin PATCH', async () => {
    const source = make_source(20 * MiB);
    const sink = make_sink();
    const controller = new AbortController();
    controller.abort();
    const res = await tus_upload({ url: URL, source, sink, signal: controller.signal });
    expect(res).toEqual({ ok: false, reason: 'aborted' });
    expect(sink.patches).toHaveLength(0);
  });

  it('(A-2) abort a mitad → aborted, sin HEAD ni más PATCH', async () => {
    const source = make_source(30 * MiB);
    const controller = new AbortController();
    const sink = make_sink({
      patch: async (_c, n) => {
        if (n === 2) {
          controller.abort();
          const e = new Error('Aborted'); e.name = 'AbortError'; throw e;
        }
        return { status: 204, upload_offset: null };
      },
      head: async () => 10 * MiB,
    });
    const res = await tus_upload({ url: URL, source, sink, chunk_bytes: 10 * MiB, signal: controller.signal });
    expect(res).toEqual({ ok: false, reason: 'aborted' });
    expect(sink.heads).toBe(0);
    expect(sink.patches).toHaveLength(2);
  });
});

// ── Recursos ──────────────────────────────────────────────────────────────────

describe('tus_upload — recursos', () => {
  it('(R-1) source.close() siempre: éxito, fallo y abort', async () => {
    const ok_source = make_source(1 * MiB);
    await tus_upload({ url: URL, source: ok_source, sink: make_sink() });
    expect(ok_source.closed).toBe(1);

    const fail_source = make_source(1 * MiB);
    await tus_upload({
      url: URL,
      source: fail_source,
      sink: make_sink({ patch: async () => { throw new Error('x'); }, head: async () => 0 }),
    });
    expect(fail_source.closed).toBe(1);

    const abort_source = make_source(1 * MiB);
    const controller = new AbortController();
    controller.abort();
    await tus_upload({ url: URL, source: abort_source, sink: make_sink(), signal: controller.signal });
    expect(abort_source.closed).toBe(1);
  });
});
