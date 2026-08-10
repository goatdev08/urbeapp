/**
 * splash-gate — liberación única del splash nativo (#143.4).
 *
 * Antes el splash se soltaba al cargar las FUENTES: el usuario veía el
 * ActivityIndicator del auth gate, la espera de ubicación y el skeleton del
 * feed a pantalla pelada. Ahora el splash nativo (que CUBRE todo lo que se
 * renderiza debajo) aguanta hasta que la primera pantalla real está lista:
 *
 *   - login (sin sesión)                    → al montar
 *   - LocationWall (permiso/GPS)            → al montar
 *   - LegalWall / verify-email              → al montar
 *   - feed (sesión + ubicación + datos)     → cuando el skeleton se resuelve
 *   - timeout de seguridad (root layout)    → SPLASH_SAFETY_TIMEOUT_MS
 *
 * Mientras tanto, auth restore + evaluación de ubicación + primer fetch del
 * feed corren DEBAJO del splash — los servicios cargan durante la pantalla
 * del logo, no después de ella.
 *
 * Idempotente: el primer release gana; los demás son no-op (hideAsync además
 * ya tolera llamadas repetidas, esto solo ahorra los await).
 */
import * as SplashScreen from 'expo-splash-screen';

// Techo duro: ninguna ruta (deep links, pantallas sin release explícito) deja
// el splash pegado para siempre. 7 s > restore de sesión + GPS típicos.
export const SPLASH_SAFETY_TIMEOUT_MS = 7_000;

let released = false;

/** Suelta el splash nativo (una sola vez). Llamar cuando la pantalla ya es útil. */
export function release_splash(): void {
  if (released) return;
  released = true;
  void SplashScreen.hideAsync();
}

/** Solo para tests: regresa el gate a su estado inicial. */
export function reset_splash_gate_for_tests(): void {
  released = false;
}
