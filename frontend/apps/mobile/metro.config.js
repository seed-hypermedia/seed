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

// 4. Resolve the in-repo client package by path. The mobile app installs with
// npm outside the pnpm workspace (React 19 vs the root's React 18 override),
// so @seed-hypermedia/client is aliased instead of declared as a dependency.
// Also force a single copy of react/react-dom (the app's own React 19) for
// modules that live outside this package.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  '@seed-hypermedia/client': path.resolve(monorepoRoot, 'frontend/packages/client'),
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-dom': path.resolve(projectRoot, 'node_modules/react-dom'),
}

// 5. Redirect expo/AppEntry to our index.ts to fix monorepo resolution
const originalResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'expo/AppEntry' || moduleName.endsWith('expo/AppEntry.js')) {
    return {
      filePath: path.resolve(projectRoot, 'index.ts'),
      type: 'sourceFile',
    }
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform)
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
