const path = require('path')

/**
 * Rewrites a bare `import.meta` to `undefined` for the CommonJS Jest build.
 *
 * `babel-plugin-transform-import-meta` only handles `import.meta.url`, so shared in-repo packages
 * that probe for a Vite runtime — `@shm/shared/constants` does, behind a `typeof` guard — still
 * emit a MetaProperty that Node rejects outright as a syntax error in CJS. Those probes are all
 * written with a `process.env` fallback, so reporting "no import.meta here" is the honest answer
 * under Jest and lands on exactly the branch a non-Vite runtime is meant to take.
 *
 * Native bundles never reach this: Metro's babel-preset-expo transform (`unstable_transformImportMeta`)
 * rewrites `import.meta` to Expo's registry instead.
 */
function stripImportMetaPlugin({types: t}) {
  return {
    name: 'strip-import-meta-for-cjs',
    visitor: {
      MetaProperty(nodePath) {
        if (nodePath.node.meta.name === 'import' && nodePath.node.property.name === 'meta') {
          nodePath.replaceWith(t.identifier('undefined'))
        }
      },
    },
  }
}

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
      plugins: [importMetaPlugin, stripImportMetaPlugin],
    }
  }

  // For Expo/Metro, use babel-preset-expo with unstable_transformImportMeta enabled
  // This transforms import.meta to globalThis.__ExpoImportMetaRegistry for Hermes compatibility
  const expoPreset = path.resolve(__dirname, 'node_modules/expo/node_modules/babel-preset-expo')
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
