const path = require('path')

module.exports = function (api) {
  api.cache(true)

  // Plugin to transform import.meta.env (used by shared code from Vite)
  const importMetaPlugin = 'babel-plugin-transform-import-meta'

  // For Jest tests, use standard babel presets
  if (process.env.NODE_ENV === 'test') {
    return {
      presets: [
        ['@babel/preset-env', {targets: {node: 'current'}}],
        '@babel/preset-typescript',
        ['@babel/preset-react', {runtime: 'automatic'}],
      ],
      plugins: [importMetaPlugin],
    }
  }

  // For Expo/Metro, use babel-preset-expo with unstable_transformImportMeta enabled
  // This transforms import.meta to globalThis.__ExpoImportMetaRegistry for Hermes compatibility
  const expoPreset = path.resolve(
    __dirname,
    'node_modules/expo/node_modules/babel-preset-expo',
  )
  try {
    require.resolve(expoPreset)
    return {
      presets: [[expoPreset, {unstable_transformImportMeta: true}]],
      plugins: [importMetaPlugin],
    }
  } catch {
    // Fall back to regular babel-preset-expo
    return {
      presets: [['babel-preset-expo', {unstable_transformImportMeta: true}]],
      plugins: [importMetaPlugin],
    }
  }
}
