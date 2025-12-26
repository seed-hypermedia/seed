const path = require('path')

module.exports = function (api) {
  api.cache(true)

  // For Jest tests, use standard babel presets
  if (process.env.NODE_ENV === 'test') {
    return {
      presets: [
        ['@babel/preset-env', { targets: { node: 'current' } }],
        '@babel/preset-typescript',
        ['@babel/preset-react', { runtime: 'automatic' }],
      ],
    }
  }

  // For Expo/Metro, use babel-preset-expo from the workspace's node_modules
  const expoPreset = path.resolve(
    __dirname,
    'node_modules/expo/node_modules/babel-preset-expo'
  )
  try {
    require.resolve(expoPreset)
    return { presets: [expoPreset] }
  } catch {
    // Fall back to regular babel-preset-expo
    return { presets: ['babel-preset-expo'] }
  }
}
