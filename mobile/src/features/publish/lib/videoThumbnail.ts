/**
 * videoThumbnail.ts — genera y persiste la portada (thumbnail) de un video.
 *
 * Toma un frame a la MITAD del video (fallback 1s si no hay duración fiable),
 * lo sube a un bucket público y escribe property_videos.thumbnail_url.
 *
 * ponytail: reusa el bucket PÚBLICO `profile-photos` (SELECT público, INSERT del
 * dueño por path auth.uid()) para servir la portada como URL directa sin firmar —
 * evita crear un bucket/migración nuevos para la demo. El video sigue en el bucket
 * privado `property-videos`. Un bucket `property-thumbnails` dedicado es trabajo futuro.
 *
 * fail-soft: la portada es opcional; ningún fallo aquí bloquea la publicación.
 * Sin selección manual de frame (decisión: frame medio automático).
 *
 * Migración 52.4 — streaming vía signed URL (mismo patrón que useVideoUpload
 * post-52.1 y profileService post-52.4): ya no lee el thumbnail completo con
 * fetch().arrayBuffer() — sube con File(uri).createUploadTask(...).uploadAsync().
 */
import * as VideoThumbnails from 'expo-video-thumbnails';
import { File, UploadType } from 'expo-file-system';

import { supabase } from '@/lib/supabase/client';

const THUMB_BUCKET = 'profile-photos';

/**
 * Genera la portada del video local y la asocia a property_videos.thumbnail_url.
 *
 * @param video_id         id del property_videos (== video_id del cliente).
 * @param local_uri        URI local del video recién subido (file://…).
 * @param duration_seconds duración del video en segundos (del player) o null.
 */
export async function generate_and_store_thumbnail(
  video_id: string,
  local_uri: string,
  duration_seconds: number | null,
): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user_id = session?.user?.id;
    if (!user_id) return;

    // Frame a la mitad; si no hay duración fiable → 1s (evita frame negro inicial).
    const time_ms =
      duration_seconds && Number.isFinite(duration_seconds) && duration_seconds > 0
        ? Math.floor((duration_seconds * 1000) / 2)
        : 1000;

    const { uri: thumb_uri } = await VideoThumbnails.getThumbnailAsync(local_uri, {
      time: time_ms,
      quality: 0.7,
    });

    const path = `${user_id}/thumb_${video_id}.jpg`;

    // Streaming: signed upload URL + File.createUploadTask — sin cargar el
    // archivo completo en RAM (elimina el fetch().arrayBuffer() previo).
    const { data: signed_data, error: signed_error } = await supabase.storage
      .from(THUMB_BUCKET)
      .createSignedUploadUrl(path, { upsert: true });
    if (signed_error || !signed_data?.signedUrl) return;

    const file = new File(thumb_uri);
    const task = file.createUploadTask(signed_data.signedUrl, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      headers: { 'Content-Type': 'image/jpeg' },
    });

    const { status } = await task.uploadAsync();
    if (status < 200 || status >= 300) return;

    const { data: pub } = supabase.storage.from(THUMB_BUCKET).getPublicUrl(path);
    const public_url = pub?.publicUrl;
    if (!public_url) return;

    await supabase
      .from('property_videos')
      .update({ thumbnail_url: public_url })
      .eq('id', video_id);
  } catch {
    // fail-soft — la portada es opcional; no rompe el flujo de publicación.
  }
}
