const {getDefaultConfig} = require('expo/metro-config')
const path = require('path')

// Find the project and workspace directories
const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../../..')

const config = getDefaultConfig(projectRoot)

// On EAS the app installs alone with npm, so the monorepo root has no node_modules —
// referencing the missing directory makes Metro's Transformer refuse to start.
const monorepoNodeModules = path.resolve(monorepoRoot, 'node_modules')
const hasMonorepoNodeModules = require('fs').existsSync(monorepoNodeModules)

// 1. Watch the in-repo packages this app resolves from — NOT the monorepo root.
//
// Watching the root means watchman crawls and subscribes to the whole tree: ~1.17M files, most of
// them nested node_modules, plz-out build output, testdata and .git. That is enough to make
// watchman crash on startup, and because Metro immediately respawns it the result is a crash loop
// that can take the whole machine down — observed here on 2026-08-24, at ten-second intervals,
// with a 15-minute load average of 89.
//
// This list is ~146k files instead, and must cover every path resolved outside projectRoot: the
// aliases in `extraNodeModules` below, the scoped @shm/ui/agents alias in `resolveRequest`, and
// the hoisted dependencies reached through `nodeModulesPaths`. Adding a new cross-package import
// means adding its directory here.
config.watchFolders = [
  ...(config.watchFolders || []),
  path.resolve(monorepoRoot, 'frontend/packages/client'),
  path.resolve(monorepoRoot, 'frontend/packages/shared'),
  path.resolve(monorepoRoot, 'frontend/packages/ui/src/agents'),
  path.resolve(monorepoRoot, 'agents/protocol'),
  ...(hasMonorepoNodeModules ? [monorepoNodeModules] : []),
]

// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  ...(hasMonorepoNodeModules ? [monorepoNodeModules] : []),
]

// 3. Enable package exports support for ESM packages like multiformats
config.resolver.unstable_enablePackageExports = true

// 4. Resolve the in-repo client package by path. The mobile app installs with
// npm outside the pnpm workspace (React 19 vs the root's React 18 override),
// so @seed-hypermedia/client is aliased instead of declared as a dependency.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  '@seed-hypermedia/client': path.resolve(monorepoRoot, 'frontend/packages/client'),
  '@shm/shared': path.resolve(monorepoRoot, 'frontend/packages/shared'),
  // The agents protocol package: pure TypeScript types plus the tool registry, with no
  // dependencies at all, so it bundles as-is.
  '@seed-hypermedia/agents-protocol': path.resolve(monorepoRoot, 'agents/protocol'),
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-dom': path.resolve(projectRoot, 'node_modules/react-dom'),
}

// 5. Redirect expo/AppEntry to our index.ts to fix monorepo resolution
// 6. On native platforms, redirect multiformats' node sha2 hasher to its
// browser variant. Metro's native condition set resolves the "import"
// condition of multiformats/hashes/sha2, which does `import crypto from
// 'crypto'` — unresolvable in the native bundle. The browser variant calls
// crypto.subtle.digest, which src/vault/platform.ts polyfills on Hermes.
// 7. Resolve the platform-neutral half of the shared agents UI by path.
// @shm/ui is a web package (Radix, Tailwind, lucide-react), but everything under its `agents/`
// directory that is not a .tsx file is DOM-free — the signed client, the React Query models, the
// chat row model, the tool summaries — and is what mobile shares with desktop and web instead of
// reimplementing. The alias is deliberately scoped to those modules and resolves only extensions
// that cannot be a React component, so an accidental `@shm/ui/button` import fails at bundle time
// rather than dragging the web component library into the native bundle.
// 8. Force ONE copy of react, react-dom and react-query for the whole bundle: this app's.
//
// `extraNodeModules` cannot do this — it is only a *fallback* for requests that fail normal
// resolution, and an import of `react` from frontend/packages/ui or frontend/packages/shared
// resolves on its own by walking up to the monorepo root, which pins React 18. The app renders
// with React 19, so a shared module's hooks would run against a second React whose dispatcher is
// null: "Cannot read properties of null (reading 'useState')" the moment a shared hook is called.
// The same argument applies to react-query, where two copies mean two caches and a UI whose lists
// never refresh after a mutation.
//
// This hook, unlike extraNodeModules, sees every request regardless of which package it came from.
const fs = require('fs')
const SINGLETON_PACKAGES = ['react', 'react-dom', '@tanstack/react-query']
const NODE_ONLY_PACKAGES = ['cheerio', 'pdfjs-dist']
const AGENTS_UI_DIR = path.resolve(monorepoRoot, 'frontend/packages/ui/src/agents')
const multiformatsSha2Pattern = /multiformats[\/\\]dist[\/\\]src[\/\\]hashes[\/\\]sha2\.js$/
const originalResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'expo/AppEntry' || moduleName.endsWith('expo/AppEntry.js')) {
    return {
      filePath: path.resolve(projectRoot, 'index.ts'),
      type: 'sourceFile',
    }
  }
  // Node-only packages reachable through the @seed-hypermedia/client barrel but never
  // invoked on mobile: cheerio (tei/html-to-blocks) needs node:stream, and pdfjs-dist
  // (pdf-to-blocks) uses syntax Hermes cannot parse. Resolve them to a stub that
  // throws at call time.
  const nodeOnly = NODE_ONLY_PACKAGES.find((name) => moduleName === name || moduleName.startsWith(`${name}/`))
  if (platform !== 'web' && nodeOnly) {
    return {
      filePath: path.resolve(projectRoot, 'src/shims/node-only.js'),
      type: 'sourceFile',
    }
  }
  const singleton = SINGLETON_PACKAGES.find((name) => moduleName === name || moduleName.startsWith(`${name}/`))
  if (singleton) {
    const subpath = moduleName.slice(singleton.length)
    const target = path.resolve(projectRoot, 'node_modules', singleton) + subpath
    return context.resolveRequest(context, target, platform)
  }
  if (moduleName.startsWith('@shm/ui/agents/')) {
    const subpath = moduleName.slice('@shm/ui/agents/'.length)
    const filePath = path.join(AGENTS_UI_DIR, `${subpath}.ts`)
    if (!filePath.startsWith(`${AGENTS_UI_DIR}${path.sep}`) || !fs.existsSync(filePath)) {
      throw new Error(
        `Mobile can only import the DOM-free agents modules from @shm/ui/agents; ` +
          `"${moduleName}" is not one of them (looked for ${filePath}).`,
      )
    }
    return {filePath, type: 'sourceFile'}
  }
  const resolved = originalResolveRequest
    ? originalResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform)
  if (
    platform !== 'web' &&
    resolved &&
    resolved.type === 'sourceFile' &&
    multiformatsSha2Pattern.test(resolved.filePath)
  ) {
    const browserVariant = resolved.filePath.replace(/sha2\.js$/, 'sha2-browser.js')
    if (fs.existsSync(browserVariant)) {
      return {filePath: browserVariant, type: 'sourceFile'}
    }
  }
  return resolved
}

module.exports = config
