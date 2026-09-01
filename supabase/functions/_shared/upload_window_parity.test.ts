// supabase/functions/_shared/upload_window_parity.test.ts
// Tareas #183 y #188 — las ventanas del reaper de los DOS dominios.
//
// ════════════════════════════════════════════════════════════════════════════
// #183 — LA ASIMETRÍA. STALE_UPLOAD_MS y el fragmento de query del `.or()`
// están duplicados entre mint-upload-url (propiedades) y mint-ad-upload-url
// (anuncios), y tras 169.4 quedaron fijados de UN SOLO LADO: el checker de
// anuncios tenía cobertura, el de propiedades no. Evidencia del guardián:
// aplicar la MISMA mutación de ventana al checker viejo sobrevivía las 1102
// pruebas Deno; la versión de anuncios moría.
//
// Consecuencia concreta: el día que alguien ajuste el umbral de propiedades,
// nada rompe ahí y el test que falla es el de ANUNCIOS — señalando el archivo
// equivocado. Un test que apunta al lugar erróneo es peor que ninguno para
// diagnosticar.
//
// 🔴 LO QUE SE UNIFICA ES LA VENTANA, NO EL SCOPE. La separación
// ad_creatives/agency_id vs property_videos/agent_id es legítima y deliberada:
// un helper que la parametrizara reacoplaría dos invariantes que el test
// `ausencia_de_409_cruzado` existe para probar INDEPENDIENTES. Por eso este
// archivo COMPARA los dos umbrales en vez de fusionarlos, y cada checker
// conserva su propio archivo de tests.
//
// #188 — LA VENTANA QUE FALTABA. 'processing' no tenía expiración en NINGUNO
// de los dos dominios: el reaper solo cubría 'uploading'. Un creativo (o un
// video) atorado en 'processing' bloqueaba a su organización PARA SIEMPRE vía
// el 409 de concurrencia. 169.5 decidió que el webhook propagara el error para
// que Cloudflare reintentara, pero el reintento de Stream es una ventana
// FINITA con backoff: compra tiempo, no durabilidad.
// ════════════════════════════════════════════════════════════════════════════

import { assertEquals } from "@std/assert";
import {
  STALE_PROCESSING_MS as PROPERTY_STALE_PROCESSING_MS,
  STALE_UPLOAD_MS as PROPERTY_STALE_UPLOAD_MS,
} from "../mint-upload-url/types.ts";
import {
  STALE_PROCESSING_MS as AD_STALE_PROCESSING_MS,
  STALE_UPLOAD_MS as AD_STALE_UPLOAD_MS,
} from "../mint-ad-upload-url/types.ts";

Deno.test("183_los_dos_dominios_usan_la_MISMA_ventana_de_uploading", () => {
  assertEquals(
    AD_STALE_UPLOAD_MS,
    PROPERTY_STALE_UPLOAD_MS,
    "STALE_UPLOAD_MS divergió entre mint-upload-url y mint-ad-upload-url. " +
      "Son literales independientes a propósito (scope separado), pero la VENTANA " +
      "debe ser la misma: si se cambia una, cámbiese la otra o justifíquese aquí.",
  );
});

Deno.test("183_los_dos_dominios_usan_la_MISMA_ventana_de_processing", () => {
  assertEquals(
    AD_STALE_PROCESSING_MS,
    PROPERTY_STALE_PROCESSING_MS,
    "STALE_PROCESSING_MS divergió entre los dos dominios.",
  );
});

Deno.test("188_la_ventana_de_processing_es_MAS_LARGA_que_la_de_uploading", () => {
  // No es el mismo número y no puede serlo: 'uploading' expira rápido porque
  // una fila colgada ahí es un upload que nunca llegó a Stream. 'processing'
  // necesita margen porque Stream puede tardar legítimamente en transcodificar
  // — una ventana corta mataría transcodificaciones válidas.
  assertEquals(
    AD_STALE_PROCESSING_MS > AD_STALE_UPLOAD_MS,
    true,
    "la ventana de processing debe ser estrictamente mayor que la de uploading",
  );
});

Deno.test("188_la_ventana_de_processing_es_FINITA_nunca_infinita", () => {
  // El defecto original era la ausencia de ventana. Un Infinity o un 0 aquí
  // reintroduciría el 409 permanente (o expiraría todo al instante).
  assertEquals(
    Number.isFinite(AD_STALE_PROCESSING_MS) && AD_STALE_PROCESSING_MS > 0,
    true,
    "processing debe tener una ventana finita y positiva",
  );
});

// ════════════════════════════════════════════════════════════════════════════
// #228 — PARIDAD DE LÍMITES DE VIDEO (decisión de producto 2026-08-31): el
// video de un anuncio acepta EXACTAMENTE los mismos parámetros que el de una
// propiedad — mismo tope de duración en el mint (Cloudflare rechaza al
// ingerir) y mismo techo de bytes por TUS. Mismo patrón que las ventanas de
// arriba: literales independientes por EF (scope separado), paridad anclada
// AQUÍ. La "diferencia 1" de 169.4 (30 vs 120) quedó eliminada.
// ════════════════════════════════════════════════════════════════════════════

import {
  MAX_UPLOAD_SIZE_BYTES as PROPERTY_MAX_UPLOAD_SIZE_BYTES,
  STREAM_MAX_DURATION_SECONDS as PROPERTY_STREAM_MAX_DURATION_SECONDS,
} from "../mint-upload-url/types.ts";
import {
  MAX_UPLOAD_SIZE_BYTES as AD_MAX_UPLOAD_SIZE_BYTES,
  STREAM_MAX_DURATION_SECONDS as AD_STREAM_MAX_DURATION_SECONDS,
} from "../mint-ad-upload-url/types.ts";

Deno.test("228_los_dos_dominios_usan_el_MISMO_tope_de_duracion_en_el_mint", () => {
  assertEquals(
    AD_STREAM_MAX_DURATION_SECONDS,
    PROPERTY_STREAM_MAX_DURATION_SECONDS,
    "STREAM_MAX_DURATION_SECONDS divergió entre mint-upload-url y mint-ad-upload-url. " +
      "Desde #228 el tope es el MISMO por decisión de producto: si se cambia uno, " +
      "cámbiese el otro o justifíquese aquí.",
  );
});

Deno.test("228_los_dos_dominios_usan_el_MISMO_techo_de_bytes", () => {
  assertEquals(
    AD_MAX_UPLOAD_SIZE_BYTES,
    PROPERTY_MAX_UPLOAD_SIZE_BYTES,
    "MAX_UPLOAD_SIZE_BYTES divergió entre los dos dominios (#228: 500 MB en ambos).",
  );
});
