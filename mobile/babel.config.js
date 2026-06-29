module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // react-native-reanimated/plugin MUST be last.
    // In reanimated v4 this re-exports react-native-worklets/plugin.
    plugins: ['react-native-reanimated/plugin'],
  };
};
