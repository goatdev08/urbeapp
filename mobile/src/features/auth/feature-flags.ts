/**
 * Feature flags de login social — subtarea 72.4.
 *
 * Ambos apagados: el proyecto NO tiene credenciales de proveedor todavía
 * (Google Cloud OAuth client) ni el módulo de OAuth instalado. Los botones en
 * app/login.tsx se renderizan condicionados a estos flags — hoy no se ven.
 *
 * Al llegar las credenciales de Google: cambiar GOOGLE_OAUTH_ENABLED a true,
 * instalar expo-auth-session, e implementar el handler real (ver el stub en
 * app/login.tsx). Apple queda oculto más tiempo — ver el comentario
 * `// ponytail:` junto a APPLE_OAUTH_ENABLED.
 */

export const GOOGLE_OAUTH_ENABLED = false;

// ponytail: Apple no es solo "falta la cuenta" — es un GATE DE RELEASE de
// iOS. La guía 4.8 de App Store Review obliga a ofrecer "Sign in with Apple"
// si la app ofrece login social de terceros (aquí, Google) en iOS. No se
// puede habilitar Google en el build de iOS sin habilitar también Apple sin
// arriesgar el rechazo de review. Techo: se destraba junto con 72.4 cuando
// haya credenciales de ambos proveedores, no antes.
export const APPLE_OAUTH_ENABLED = false;
