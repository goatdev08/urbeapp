/**
 * Tests fase RED — saveProfile (profileService.ts)
 * Subtarea Taskmaster: 69.3 — Cliente: avatar de usuario vía R2 presigned
 *
 * SUT: saveProfile({ fullName, imageUri, userId }): Promise<{ profilePhotoUrl: string | null }>
 *
 * MIGRACIÓN (supersede el contrato de streaming a Supabase Storage de la
 * subtarea 52.4): el avatar YA NO sube a `profile-photos` (Supabase Storage) —
 * sube a Cloudflare R2 (bucket privado) vía la Edge Function `mint-r2-url`
 * (69.2, desplegada). Contrato NUEVO:
 *   1. `supabase.functions.invoke('mint-r2-url', { body: { kind: 'avatar', op: 'put' } })`
 *      → `{ data: { url, key, expires }, error }`. El body NO incluye `key`:
 *      el handler lo DERIVA del uid del JWT (`avatars/<uid>/<uuid>`) — el
 *      cliente jamás decide el key de su propio avatar (69.2, handler.ts:108-118).
 *   2. `new File(imageUri).createUploadTask(mint_data.url, { httpMethod: 'PUT',
 *      uploadType: UploadType.BINARY_CONTENT, headers: {'Content-Type': 'image/jpeg'} })`
 *      → UploadTask (misma API que useVideoUpload / 52.4).
 *   3. `task.uploadAsync()` → `{ status, body, headers }`; 2xx = éxito.
 *   4. UPSERT `user_preferences` con `profile_photo_url` = el **KEY** devuelto
 *      por el mint (NO la url presigned, NO una url pública — bucket privado,
 *      la lectura resuelve el key a URL en el momento de mostrarlo vía el
 *      resolver `resolve_r2_urls`, fuera de alcance de este archivo).
 *   5. `supabase.storage` YA NO SE USA para nada en este flujo (ni
 *      `createSignedUploadUrl` ni `getPublicUrl`) — la migración a R2 lo
 *      reemplaza por completo.
 *
 * EDGE CASES CUBIERTOS (RED):
 *
 * ### Happy path
 * - (a) happy_path_con_foto_mintea_sube_y_guarda_key: invoke mint-r2-url con
 *   {kind:avatar,op:put} + upload 2xx + upsert con el KEY (no url) → retorna
 *   {profilePhotoUrl: key}.
 * - (b) happy_path_sin_foto: imageUri null → NO invoca mint-r2-url, NO crea
 *   File, upsert con profile_photo_url null, retorna null.
 *
 * ### Ramas de la migración a R2 (no obvias)
 * - (c) invoke_body_no_incluye_key: el body de la invocación NO trae `key` —
 *   el cliente nunca manda el key de su propio avatar (lo deriva el servidor).
 * - (d) invoke_exacto_kind_avatar_op_put: el body es exactamente
 *   {kind:'avatar', op:'put'}, sin campos extra.
 * - (e) upload_task_usa_url_del_mint: createUploadTask recibe la url devuelta
 *   por mint-r2-url (NO una signed url de Supabase Storage).
 * - (f) guarda_key_no_url_en_upsert: profile_photo_url en el upsert es el KEY
 *   (formato "avatars/<uid>/<uuid>"), distinto de la url presigned de subida.
 * - (g) upload_task_opciones_correctas: httpMethod PUT + uploadType
 *   BINARY_CONTENT + Content-Type image/jpeg.
 * - (h) no_usa_supabase_storage: el mock de supabase NO expone `.storage` —
 *   si el SUT todavía llamara `.storage.from(...)` (patrón viejo, Storage-based)
 *   explotaría con TypeError, confirmando que sigue el patrón legado.
 * - (i) no_usa_fetch_para_leer_el_archivo: streaming puro, sin fetch() global
 *   (mismo invariante que 52.4 — evita el pico de RAM).
 *
 * ### Invariantes de negocio preservadas (sin cambios respecto al contrato previo)
 * - (j) tabla_correcta_user_preferences.
 * - (k) onConflict_user_id.
 * - (l) upsert_incluye_full_name.
 *
 * ### Boundary / error
 * - (m) error_de_mint_rechaza: mint-r2-url devuelve error → saveProfile lanza,
 *   NO llama createUploadTask, NO hace upsert.
 * - (n) mint_sin_url_rechaza: mint-r2-url resuelve sin error pero sin `url` en
 *   data (forma inesperada) → saveProfile lanza, NO sube, NO hace upsert.
 * - (o) error_de_upload_status_no_2xx_rechaza: uploadAsync status=500 → lanza,
 *   NO hace upsert.
 * - (p) error_de_upsert_rechaza: upsert error → saveProfile lanza, no swallow.
 *
 * ---------------------------------------------------------------------------
 * AÑADIDO — Subtarea 69.6: fix del flujo editar-perfil post-R2 (KEEP)
 * ---------------------------------------------------------------------------
 * Bug motivador: `edit.tsx` pre-puebla `avatar_uri` con el KEY R2 guardado
 * (`avatars/<uid>/<uuid>`) y lo reenvía tal cual como `imageUri` si el usuario
 * NO cambia la foto → saveProfile intentaba `new File(key)` y subir un
 * "archivo" que no existe en el filesystem del device → explota.
 *
 * Contrato NUEVO — `imageUri` pasa a `string | null | undefined` (3 estados):
 *   - `undefined` → **KEEP**: NO invoca mint-r2-url, NO crea File, el upsert
 *     OMITE la clave `profile_photo_url` por completo (ON CONFLICT conserva
 *     el valor existente en DB — nunca se pisa con null). `full_name` SÍ se
 *     actualiza igual que siempre.
 *   - `null` → REMOVE (sin cambios — cubierto por (b) arriba).
 *   - `string` → REPLACE (sin cambios — cubierto por (a),(c)-(p) arriba).
 * NOTA: la lógica de "removePhoto → forzar null" y "avatar sin cambios →
 * undefined" vive en `useEditProfile` (fuera de alcance de este archivo);
 * aquí solo se especifica cómo reacciona `saveProfile` al recibir `undefined`.
 *
 * ### Ramas nuevas (KEEP, 69.6)
 * - (q) keep_undefined_no_invoca_mint_ni_sube: imageUri undefined → NO invoca
 *   mint-r2-url, NO crea File.
 * - (r) keep_undefined_upsert_omite_columna_profile_photo_url: el objeto que
 *   se manda a `.upsert()` NO tiene la clave `profile_photo_url` (ni siquiera
 *   en null) — así ON CONFLICT no la pisa.
 * - (s) keep_undefined_upsert_incluye_full_name: el upsert SÍ trae
 *   `user_id`/`full_name` correctos aunque KEEP omita la foto.
 * - (t) keep_undefined_retorna_profilePhotoUrl_undefined: el resultado es
 *   `{ profilePhotoUrl: undefined }` — distinto de `null` (removido) y de un
 *   key (reemplazado): "sin dato nuevo".
 */

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks (mocks definidos dentro del factory)
// ---------------------------------------------------------------------------

import { saveProfile } from '../profileService';
import * as FileSystem from 'expo-file-system';

const mock_invoke = jest.fn();
const mock_upsert = jest.fn();
const mock_from_db = jest.fn();

// El cliente supabase exportado desde @/lib/supabase/client se sustituye por
// un objeto con la forma mínima necesaria para profileService en su NUEVO
// contrato R2: `functions.invoke` (mint-r2-url) + `from` (upsert). NOTA:
// esta forma **NO expone `.storage`** — si el SUT aún llama
// `supabase.storage.from(...)` (patrón viejo, Supabase Storage), explota con
// TypeError (falla por comportamiento, confirma que sigue en el patrón legado).
jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: mock_invoke,
    },
    from: mock_from_db,
  },
}));

// API NUEVA v56 — solo se exporta la clase File + el enum UploadType.
jest.mock('expo-file-system', () => ({
  File: jest.fn(),
  UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
}));

const MockFile = FileSystem.File as unknown as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers de fábrica
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'user-abc-123';
const TEST_FULL_NAME = 'María García López';
const TEST_IMAGE_URI = 'file:///processed/avatar_q0.8.jpg';
const TEST_R2_KEY = 'avatars/user-abc-123/8f14e45f-ceea-4d3a-9f1c-2e34ab567890';
const TEST_R2_PUT_URL =
  'https://abc123.r2.cloudflarestorage.com/urbea-assets/avatars/user-abc-123/8f14e45f-ceea-4d3a-9f1c-2e34ab567890?X-Amz-Signature=deadbeef';

interface MockUploadTask {
  uploadAsync: jest.Mock<Promise<{ status: number; body?: string }>, []>;
}

function make_mock_upload_task(status = 200): MockUploadTask {
  return { uploadAsync: jest.fn().mockResolvedValue({ status, body: '' }) };
}

function make_mock_file(upload_task: MockUploadTask = make_mock_upload_task()) {
  return {
    createUploadTask: jest.fn().mockReturnValue(upload_task),
    _upload_task: upload_task,
  };
}

/** Configura mock_invoke para un mint exitoso (op:put, kind:avatar). */
function setup_mint_ok() {
  mock_invoke.mockResolvedValue({
    data: { url: TEST_R2_PUT_URL, key: TEST_R2_KEY, expires: 900 },
    error: null,
  });
  MockFile.mockImplementation(() => make_mock_file() as never);
}

/** Configura el mock de la tabla user_preferences para un upsert exitoso. */
function setup_db_upsert_ok() {
  mock_upsert.mockResolvedValue({ data: null, error: null });
  mock_from_db.mockReturnValue({
    upsert: mock_upsert,
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('saveProfile — avatar vía R2 presigned (mint-r2-url)', () => {
  // ── (a) happy path con foto ──────────────────────────────────────────────

  it('(a) happy_path_con_foto_mintea_sube_y_guarda_key: mintea put, sube por streaming, guarda el KEY y lo retorna', async () => {
    setup_mint_ok();
    setup_db_upsert_ok();

    const result = await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    expect(result.profilePhotoUrl).toBe(TEST_R2_KEY);
    expect(mock_invoke).toHaveBeenCalledTimes(1);
    expect(mock_upsert).toHaveBeenCalledTimes(1);
  });

  // ── (b) happy path SIN foto ──────────────────────────────────────────────

  it('(b) happy_path_sin_foto: imageUri null → NO invoca mint-r2-url ni crea File, upsert con null, retorna null', async () => {
    setup_db_upsert_ok();

    const result = await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: null,
      userId: TEST_USER_ID,
    });

    expect(result.profilePhotoUrl).toBeNull();
    expect(mock_invoke).not.toHaveBeenCalled();
    expect(MockFile).not.toHaveBeenCalled();
    expect(mock_upsert).toHaveBeenCalledTimes(1);
  });

  // ── (c) el body NO incluye key ───────────────────────────────────────────

  it('(c) invoke_body_no_incluye_key: el body de mint-r2-url NO trae `key` — el servidor lo deriva del uid', async () => {
    setup_mint_ok();
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    const [, options] = mock_invoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body).not.toHaveProperty('key');
  });

  // ── (d) invoke exacto kind avatar op put ─────────────────────────────────

  it('(d) invoke_exacto_kind_avatar_op_put: invoca mint-r2-url con {kind:"avatar", op:"put"} exactamente', async () => {
    setup_mint_ok();
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    expect(mock_invoke).toHaveBeenCalledWith('mint-r2-url', {
      body: { kind: 'avatar', op: 'put' },
    });
  });

  // ── (e) upload task usa la url del mint ──────────────────────────────────

  it('(e) upload_task_usa_url_del_mint: createUploadTask recibe la url devuelta por mint-r2-url', async () => {
    setup_mint_ok();
    setup_db_upsert_ok();
    const file_instance = make_mock_file();
    MockFile.mockImplementation(() => file_instance as never);

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    expect(file_instance.createUploadTask).toHaveBeenCalledTimes(1);
    const [url_arg] = file_instance.createUploadTask.mock.calls[0] as [string, unknown];
    expect(url_arg).toBe(TEST_R2_PUT_URL);
  });

  // ── (f) guarda el KEY, no la url, en el upsert ───────────────────────────

  it('(f) guarda_key_no_url_en_upsert: profile_photo_url en el upsert es el KEY, no la url presigned', async () => {
    setup_mint_ok();
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    const upsert_call = mock_upsert.mock.calls[0];
    expect(upsert_call).toBeDefined();
    const upsert_data = upsert_call![0] as Record<string, unknown>;
    expect(upsert_data.profile_photo_url).toBe(TEST_R2_KEY);
    expect(upsert_data.profile_photo_url).not.toBe(TEST_R2_PUT_URL);
  });

  // ── (g) opciones de createUploadTask ──────────────────────────────────────

  it('(g) upload_task_opciones_correctas: createUploadTask recibe httpMethod PUT + uploadType BINARY_CONTENT + Content-Type image/jpeg', async () => {
    setup_mint_ok();
    setup_db_upsert_ok();
    const file_instance = make_mock_file();
    MockFile.mockImplementation(() => file_instance as never);

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    const [, options_arg] = file_instance.createUploadTask.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(options_arg).toMatchObject({
      httpMethod: 'PUT',
      uploadType: FileSystem.UploadType.BINARY_CONTENT,
      headers: { 'Content-Type': 'image/jpeg' },
    });
  });

  // ── (h) ya no usa supabase.storage ───────────────────────────────────────

  it('(h) no_usa_supabase_storage: el flujo NO depende de supabase.storage (mock sin `.storage`, sin TypeError)', async () => {
    setup_mint_ok();
    setup_db_upsert_ok();

    await expect(
      saveProfile({
        fullName: TEST_FULL_NAME,
        imageUri: TEST_IMAGE_URI,
        userId: TEST_USER_ID,
      }),
    ).resolves.toEqual({ profilePhotoUrl: TEST_R2_KEY });
  });

  // ── (i) no usa fetch() para leer el archivo ──────────────────────────────

  it('(i) no_usa_fetch_para_leer_el_archivo: el flujo streaming NO llama a fetch() global', async () => {
    setup_mint_ok();
    setup_db_upsert_ok();

    const original_fetch = global.fetch;
    const mock_fetch = jest.fn();
    global.fetch = mock_fetch as unknown as typeof global.fetch;

    try {
      await saveProfile({
        fullName: TEST_FULL_NAME,
        imageUri: TEST_IMAGE_URI,
        userId: TEST_USER_ID,
      });

      expect(mock_fetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = original_fetch;
    }
  });

  // ── (j) tabla correcta: user_preferences ─────────────────────────────────

  it('(j) tabla_correcta_user_preferences: upsert usa tabla user_preferences, NOT users', async () => {
    setup_mint_ok();
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    expect(mock_from_db).toHaveBeenCalledWith('user_preferences');
    expect(mock_from_db).not.toHaveBeenCalledWith('users');
  });

  // ── (k) onConflict: user_id ───────────────────────────────────────────────

  it('(k) onConflict_user_id: el upsert incluye onConflict: "user_id"', async () => {
    setup_mint_ok();
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    const upsert_call = mock_upsert.mock.calls[0];
    expect(upsert_call).toBeDefined();
    const upsert_options = upsert_call![1] as Record<string, unknown>;
    expect(upsert_options).toEqual(expect.objectContaining({ onConflict: 'user_id' }));
  });

  // ── (l) upsert incluye full_name ──────────────────────────────────────────

  it('(l) upsert_incluye_full_name: el upsert contiene user_id y full_name correctos', async () => {
    setup_mint_ok();
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: TEST_IMAGE_URI,
      userId: TEST_USER_ID,
    });

    const upsert_call = mock_upsert.mock.calls[0];
    expect(upsert_call).toBeDefined();
    const upsert_data = upsert_call![0] as Record<string, unknown>;
    expect(upsert_data).toEqual(
      expect.objectContaining({
        user_id: TEST_USER_ID,
        full_name: TEST_FULL_NAME,
      }),
    );
  });

  // ── (m) error de mint → rechaza ───────────────────────────────────────────

  it('(m) error_de_mint_rechaza: mint-r2-url devuelve error → saveProfile lanza, NO sube, NO hace upsert', async () => {
    mock_invoke.mockResolvedValue({
      data: null,
      error: { message: 'mint-r2-url: FORBIDDEN' },
    });
    setup_db_upsert_ok();

    await expect(
      saveProfile({
        fullName: TEST_FULL_NAME,
        imageUri: TEST_IMAGE_URI,
        userId: TEST_USER_ID,
      }),
    ).rejects.toThrow(/mint|r2|FORBIDDEN/i);

    expect(mock_invoke).toHaveBeenCalledTimes(1);
    expect(MockFile).not.toHaveBeenCalled();
    expect(mock_upsert).not.toHaveBeenCalled();
  });

  // ── (n) mint sin url en la respuesta → rechaza ───────────────────────────

  it('(n) mint_sin_url_rechaza: mint-r2-url resuelve sin error pero sin `url` en data → saveProfile lanza, NO sube, NO hace upsert', async () => {
    mock_invoke.mockResolvedValue({
      data: { key: TEST_R2_KEY, expires: 900 },
      error: null,
    });
    setup_db_upsert_ok();

    await expect(
      saveProfile({
        fullName: TEST_FULL_NAME,
        imageUri: TEST_IMAGE_URI,
        userId: TEST_USER_ID,
      }),
    ).rejects.toThrow();

    // El rechazo debe originarse DESPUÉS de invocar mint-r2-url y detectar la
    // forma inválida — no de un stub que lanza antes de intentar nada.
    expect(mock_invoke).toHaveBeenCalledTimes(1);
    expect(MockFile).not.toHaveBeenCalled();
    expect(mock_upsert).not.toHaveBeenCalled();
  });

  // ── (o) uploadAsync status no-2xx → rechaza ──────────────────────────────

  it('(o) error_de_upload_status_no_2xx_rechaza: uploadAsync status=500 → saveProfile lanza, NO hace upsert', async () => {
    setup_mint_ok();
    const failing_upload_task = make_mock_upload_task(500);
    const file_instance = make_mock_file(failing_upload_task);
    MockFile.mockImplementation(() => file_instance as never);
    setup_db_upsert_ok();

    await expect(
      saveProfile({
        fullName: TEST_FULL_NAME,
        imageUri: TEST_IMAGE_URI,
        userId: TEST_USER_ID,
      }),
    ).rejects.toThrow(/upload|r2|storage/i);

    expect(failing_upload_task.uploadAsync).toHaveBeenCalledTimes(1);
    expect(mock_upsert).not.toHaveBeenCalled();
  });

  // ── (p) error de upsert → rechaza ─────────────────────────────────────────

  it('(p) error_de_upsert_rechaza: user_preferences.upsert error → saveProfile lanza con mensaje de DB', async () => {
    setup_mint_ok();

    mock_upsert.mockResolvedValue({ data: null, error: { message: 'DB error: duplicate key' } });
    mock_from_db.mockReturnValue({
      upsert: mock_upsert,
    });

    await expect(
      saveProfile({
        fullName: TEST_FULL_NAME,
        imageUri: TEST_IMAGE_URI,
        userId: TEST_USER_ID,
      }),
    ).rejects.toThrow(/upsert|preferences|DB|database/i);
  });

  // ── (q)-(t) KEEP: imageUri undefined (69.6) ──────────────────────────────

  it('(q) keep_undefined_no_invoca_mint_ni_sube: imageUri undefined (KEEP) → NO invoca mint-r2-url ni crea File', async () => {
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: undefined,
      userId: TEST_USER_ID,
    });

    expect(mock_invoke).not.toHaveBeenCalled();
    expect(MockFile).not.toHaveBeenCalled();
  });

  it('(r) keep_undefined_upsert_omite_columna_profile_photo_url: el upsert NO incluye la clave profile_photo_url (KEEP no debe pisar el valor existente)', async () => {
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: undefined,
      userId: TEST_USER_ID,
    });

    const upsert_call = mock_upsert.mock.calls[0];
    expect(upsert_call).toBeDefined();
    const upsert_data = upsert_call![0] as Record<string, unknown>;
    expect(upsert_data).not.toHaveProperty('profile_photo_url');
  });

  it('(s) keep_undefined_upsert_incluye_full_name: aunque KEEP omite la foto, el upsert sigue mandando user_id y full_name correctos', async () => {
    setup_db_upsert_ok();

    await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: undefined,
      userId: TEST_USER_ID,
    });

    const upsert_call = mock_upsert.mock.calls[0];
    expect(upsert_call).toBeDefined();
    const upsert_data = upsert_call![0] as Record<string, unknown>;
    expect(upsert_data).toEqual(
      expect.objectContaining({ user_id: TEST_USER_ID, full_name: TEST_FULL_NAME }),
    );
  });

  it('(t) keep_undefined_retorna_profilePhotoUrl_undefined: KEEP retorna profilePhotoUrl undefined — distinto de null (removido)', async () => {
    setup_db_upsert_ok();

    const result = await saveProfile({
      fullName: TEST_FULL_NAME,
      imageUri: undefined,
      userId: TEST_USER_ID,
    });

    expect(result.profilePhotoUrl).toBeUndefined();
  });
});
