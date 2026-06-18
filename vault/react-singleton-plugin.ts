import type {BunPlugin} from 'bun'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'

const vaultRoot = path.dirname(fileURLToPath(import.meta.url))

/**
 * Forces every `react` / `react-dom` (and their subpaths) import to resolve to
 * vault's single installed copy.
 *
 * `@shm/ui` is consumed as a `file:` dependency, which Bun resolves to its real
 * source location inside the repo's React 18 pnpm tree. Without this plugin,
 * `Bun.build` bundles a second copy of React (from `../node_modules/react`)
 * alongside vault's own, doubling React's weight and breaking any shared
 * component that relies on hooks or context across the boundary.
 *
 * This only applies to `Bun.build` — Bun's runtime module loader does not honor
 * `onResolve` for bare specifiers, so dev/test rely on React version alignment
 * instead.
 */
export const reactSingletonPlugin: BunPlugin = {
  name: 'react-singleton',
  setup(build) {
    build.onResolve({filter: /^react(-dom)?(\/.*)?$/}, (args) => {
      return {path: Bun.resolveSync(args.path, vaultRoot)}
    })
  },
}

export default reactSingletonPlugin
