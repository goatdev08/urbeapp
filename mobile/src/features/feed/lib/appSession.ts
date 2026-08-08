/**
 * appSession.ts — identificador de sesión de app: uno por apertura de la app,
 * estable mientras el proceso vive.
 *
 * Subtarea Taskmaster: 112.2 — el dedupe de video_view/video_completed
 * necesita distinguir "revisit dentro de la MISMA sesión" (no cuenta de
 * nuevo) de "sesión nueva" (sí cuenta — insumo de "veces que volvió a ver").
 * No puede vivir en el estado de VideoFeedItem: FlashList recicla los ítems
 * del feed (unmount/remount), y un remount perdería la marca.
 *
 * ponytail: un UUID generado UNA vez al cargar el módulo (los módulos ES se
 * evalúan una sola vez por proceso) es lo más simple que cumple "uno por
 * apertura de la app" — sin AsyncStorage (no necesita sobrevivir un cierre
 * de la app), sin contexto de React, sin dependencia nueva (expo-crypto ya
 * está instalado).
 */
import * as Crypto from 'expo-crypto';

const app_session_id = Crypto.randomUUID();

/** UUID estable durante toda la vida del proceso (una apertura de la app). */
export function get_app_session_id(): string {
  return app_session_id;
}
