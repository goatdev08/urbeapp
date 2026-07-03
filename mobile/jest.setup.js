// Mock AsyncStorage — evita que los tests que tocan el cliente Supabase exploten
// Patrón oficial: https://react-native-async-storage.github.io/async-storage/docs/advanced/jest/
import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import { jest, afterEach } from '@jest/globals';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

// Mock react-native-reanimated — Reanimated 4 importa react-native-worklets al nivel
// de módulo (NativeWorklets.native.ts) → intenta inicializar el native module → falla
// en Jest (sin runtime nativo). react-native-reanimated/mock tampoco sirve porque
// TAMBIÉN importa ./index (que trae worklets).
// Solución: factory manual que solo depende de react-native puro (sin worklets).
// Cubre los casos de uso de LikeButton, SaveButton y HeartAnimation.
// Ref: https://docs.swmansion.com/react-native-reanimated/docs/guides/testing/
jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');

  // Componentes animados: delegan al equivalente RN no-animado en tests
  const AnimatedComponents = {
    View: RN.View,
    Text: RN.Text,
    Image: RN.Image,
    ScrollView: RN.ScrollView,
    FlatList: RN.FlatList,
  };

  return {
    __esModule: true,
    default: AnimatedComponents,
    Animated: AnimatedComponents,

    // Shared values — objeto simple con .value mutable
    useSharedValue: (init) => ({ value: init }),

    // Animated style — devuelve objeto vacío; el componente renderiza igual
    useAnimatedStyle: () => ({}),
    useAnimatedProps: () => ({}),
    useDerivedValue: (fn) => ({ value: fn() }),

    // Animation builders — devuelven el valor destino sincrónicamente
    withTiming: (value) => value,
    withSpring: (value) => value,
    withDecay: () => 0,
    withSequence: (...args) => args[args.length - 1] ?? 0,
    withDelay: (_delay, value) => value,
    withRepeat: (value) => value,

    // Otros helpers frecuentes
    cancelAnimation: () => {},
    runOnJS: (fn) => fn,
    runOnUI: (fn) => fn,
    useAnimatedRef: () => ({ current: null }),
    useAnimatedScrollHandler: () => () => {},
    useAnimatedReaction: () => {},

    // Easing stub
    Easing: {
      linear: (t) => t,
      ease: (t) => t,
      out: (fn) => fn,
      in: (fn) => fn,
      inOut: (fn) => fn,
      elastic: () => (t) => t,
      bounce: (t) => t,
      back: () => (t) => t,
    },

    // Enums / constantes usadas en HeartAnimation y otros
    Extrapolation: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
    ReduceMotion: { Always: 'always', Never: 'never', System: 'system' },

    // interpolate stub
    interpolate: (_value, _inRange, outRange) => outRange[0] ?? 0,
    interpolateColor: () => '#000000',
  };
});

/**
 * Patch RNTL act para drenar act scopes filtrados entre tests.
 *
 * RNTL v14 envuelve TODOS los act() en `async () => await callback()`. Cuando
 * un test NO awaita el thenable retornado (EC-12), popActScope() nunca corre →
 * actScopeDepth queda en 1 → renderHook() en tests siguientes no puede drenar
 * efectos → result.current queda null.
 *
 * Fix:
 *  1. Parchamos exports.act del módulo interno `dist/act.js` (plain-assignment,
 *     writable). pure.js y index.js exponen 'act' vía getters que leen _act.act
 *     en call-time → el patch se propaga por toda la cadena incluyendo render.js.
 *  2. Envolvemos cada thenable retornado en un proxy que marca cuándo fue
 *     `.then()`-eado. En afterEach drenamos SOLO los no-awaited: son los que
 *     tienen actScopeDepth colgado (EC-12's T1). Los ya-resueltos se saltan para
 *     evitar "overlapping act()" errors de popActScope.
 *
 * ponytail: solo patch de un export writable + afterEach. Sin tocar internos.
 */

// ponytail: sin eslint-disable aquí — @typescript-eslint/no-require-imports no
// aplica a jest.setup.js (fuera del tsconfig del proyecto TS), la directiva
// quedaba huérfana y ESLint la reportaba como error ("rule not found").
const _rntl_act_module = require('@testing-library/react-native/dist/act');
const _original_act_fn = _rntl_act_module.act;

/**
 * @typedef {{ thenable: object, was_thenned: boolean }} TrackedAct
 * @type {TrackedAct[]}
 */
const _tracked_acts = [];

_rntl_act_module.act = function act_scope_drain_patch(callback) {
  const original_thenable = _original_act_fn(callback);
  const tracked = { thenable: original_thenable, was_thenned: false };
  _tracked_acts.push(tracked);

  // Proxy transparente: registra si alguien llama .then() (el test awaita).
  return {
    then: (resolve, reject) => {
      tracked.was_thenned = true;
      return original_thenable.then(resolve, reject);
    },
  };
};

afterEach(async () => {
  const batch = _tracked_acts.splice(0);
  for (const item of batch) {
    // Solo drenamos los que NUNCA fueron awaited (was_thenned === false).
    // Re-drenar un thenable ya resuelto causa "overlapping act()" en popActScope.
    if (!item.was_thenned) {
      await new Promise((resolve) => {
        try {
          item.thenable.then(resolve, resolve);
        } catch (_e) {
          resolve(undefined);
        }
      });
    }
  }
});
