const {getDefaultConfig} = require('expo/metro-config')
const path = require('path')

// Find the project and workspace directories
const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../../..')

const config = getDefaultConfig(projectRoot)

// 1. Watch all files within the monorepo (include expo's defaults)
config.watchFolders = [...(config.watchFolders || []), monorepoRoot]

// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
]

// 3. Enable package exports support for ESM packages like multiformats
config.resolver.unstable_enablePackageExports = true

// 4. Force React 19 from vendor folder (monorepo root forces React 18 via resolutions)
// Also add explicit paths for multiformats submodules
const multiformatsPath = path.resolve(projectRoot, 'node_modules/multiformats')
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  react: path.resolve(projectRoot, 'vendor/react'),
  'react-dom': path.resolve(projectRoot, 'vendor/react-dom'),
  'multiformats/bases/base58': path.resolve(
    multiformatsPath,
    'dist/src/bases/base58.js',
  ),
  multiformats: multiformatsPath,
}

module.exports = config
