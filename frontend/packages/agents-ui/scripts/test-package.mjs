// Checks the built package the way an outside app sees it: packs dist/, installs the tarball into a
// fresh directory (offline: links the workspace's React; `--install`: a clean npm install), imports
// it under Node, and type-checks a consumer against the shipped declarations with NodeNext and
// bundler resolution.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const temporary = await mkdtemp(path.join(tmpdir(), 'seed-agents-ui-package-'))
const npmEnv = {...process.env, npm_config_cache: path.join(temporary, '.npm')}
try {
  const packed = JSON.parse(
    execFileSync(
      'npm',
      ['pack', path.join(root, 'dist'), '--json', '--ignore-scripts', '--pack-destination', temporary],
      {encoding: 'utf8', env: npmEnv},
    ),
  )[0]
  const install = path.join(temporary, 'node_modules/@seed-hypermedia/agents-ui')
  await mkdir(install, {recursive: true})
  execFileSync('tar', ['-xzf', path.join(temporary, packed.filename), '--strip-components=1', '-C', install])
  const manifest = JSON.parse(await readFile(path.join(install, 'package.json'), 'utf8'))
  assert.equal(manifest.private, undefined)
  assert.equal(manifest.type, 'module')
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}), [], 'Everything but React is bundled')
  assert(!JSON.stringify(manifest).includes('workspace:'))
  assert(
    packed.files.some(({path: file}) => file.startsWith('assets/')),
    'Fonts ship as files',
  )
  assert(packed.files.every(({path: file}) => !file.startsWith('src/') && !file.startsWith('scripts/')))
  for (const file of await readdir(install, {recursive: true})) {
    if (!file.endsWith('.d.ts')) continue
    const declarations = await readFile(path.join(install, file), 'utf8')
    const imports =
      /^(?:import|export)\b[^'";]*?\bfrom\s*['"]@(?:shm|seed-hypermedia)\/|\bimport\(\s*['"]@(?:shm|seed-hypermedia)\//m
    assert(!imports.test(declarations), `${file} refers to a workspace package`)
  }

  await writeFile(path.join(temporary, 'package.json'), JSON.stringify({private: true, type: 'module'}))
  // jsdom: the package is browser code (a bundled markdown parser reaches for `document` on import).
  const peers = ['react', 'react-dom', '@types/react', '@types/react-dom', 'jsdom']
  const cleanInstall = process.argv.includes('--install')
  if (cleanInstall) {
    const pinned = peers.map((name) => `${name}@${require(`${name}/package.json`).version}`)
    execFileSync(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', path.join(temporary, packed.filename), ...pinned],
      {cwd: temporary, stdio: 'inherit', env: npmEnv},
    )
  } else {
    for (const dependency of peers) {
      const target = path.dirname(require.resolve(`${dependency}/package.json`))
      const destination = path.join(temporary, 'node_modules', dependency)
      await mkdir(path.dirname(destination), {recursive: true})
      await symlink(target, destination, 'dir')
    }
  }

  await writeFile(
    path.join(temporary, 'smoke.mjs'),
    `
import assert from 'node:assert/strict'
import {JSDOM} from 'jsdom'
const {window} = new JSDOM('<!doctype html><html><body></body></html>', {url: 'https://host.example/'})
for (const key of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Node', 'getComputedStyle']) {
  Object.defineProperty(globalThis, key, {value: key === 'window' ? window : window[key], configurable: true})
}
const kit = await import('@seed-hypermedia/agents-ui')
for (const name of ['SeedAgentsProvider', 'SeedAgentsView', 'SeedAgentsAssistant', 'createSeedAgentsClient', 'seedAgentsRouteFromPath', 'AgentServerError']) {
  assert.equal(typeof kit[name], 'function', name)
}
assert.deepEqual(kit.seedAgentsRouteFromPath('session/s1?agent=a1'), {key: 'agent-session', sessionId: 's1', serverUrl: undefined, agentId: 'a1'})
assert(Number.isInteger(kit.AGENTS_PROTOCOL_VERSION) && kit.AGENTS_PROTOCOL_VERSION >= 3)
`,
  )
  execFileSync(process.execPath, [path.join(temporary, 'smoke.mjs')], {stdio: 'inherit'})

  await writeFile(
    path.join(temporary, 'consumer.tsx'),
    `
import {
  AgentServerError,
  SeedAgentsAssistant,
  SeedAgentsProvider,
  SeedAgentsView,
  createSeedAgentsClient,
  seedAgentsRouteFromPath,
  seedAgentsRouteToPath,
  type AgentsProtocol,
  type SeedAgentsHost,
  type SeedAgentsRoute,
} from '@seed-hypermedia/agents-ui'

const signer = {accountUid: 'z6Mk', sign: async (bytes: Uint8Array) => bytes}
const host: SeedAgentsHost = {serverUrl: 'https://agents.example', hmApiUrl: 'https://hyper.media', signer}
const client = createSeedAgentsClient({serverUrl: host.serverUrl, signer})

export async function read(sessionId: string) {
  try {
    const response = await client.send({_: 'GetSession', sessionId})
    const status: AgentsProtocol.SessionInfo['status'] = response.session.status
    const events: AgentsProtocol.SessionEvent[] = response.events
    return {status, events}
  } catch (error) {
    if (error instanceof AgentServerError) return {status: error.status}
    throw error
  }
}
// @ts-expect-error not an agents action
void client.send({_: 'DropDatabase'})

const route: SeedAgentsRoute = seedAgentsRouteFromPath(seedAgentsRouteToPath({key: 'agent', agentId: 'a1', tab: 'prompt'}))
export const app = (
  <SeedAgentsProvider host={host} route={route} onRouteChange={(next, mode: 'push' | 'replace') => void [next, mode]}>
    <SeedAgentsView className="h-full" />
    <SeedAgentsAssistant onClose={() => {}} />
  </SeedAgentsProvider>
)
`,
  )
  for (const resolution of [
    ['--module', 'NodeNext', '--moduleResolution', 'NodeNext'],
    ['--module', 'ESNext', '--moduleResolution', 'Bundler'],
  ]) {
    execFileSync(
      process.execPath,
      [
        require.resolve('typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        ...resolution,
        '--target',
        'ES2022',
        '--jsx',
        'react-jsx',
        '--types',
        'react,react-dom',
        'consumer.tsx',
      ],
      {cwd: temporary, stdio: 'inherit'},
    )
  }

  const stylesheet = await readFile(path.join(install, 'styles.css'), 'utf8')
  assert(!/@(?:tailwind|theme|apply|custom-variant|import)\b/.test(stylesheet), 'Published CSS must be compiled')
  assert(!/url\((['"]?)data:font/.test(stylesheet), 'Fonts are files, not data URIs')
  assert(stylesheet.includes('--background:'), 'Seed palette is included')
  // The host keeps its look: rules that select the whole page (html, body, *) may only set custom
  // properties (Tailwind's --tw-* fallbacks) or KaTeX's equation counters.
  for (const [, selectors, body] of stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const global = selectors
      .split(',')
      .every((selector) => /^\s*(?:html|body|\*|:root|::?before|::?after|::backdrop)\s*$/.test(selector))
    if (!global) continue
    for (const declaration of body
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)) {
      assert(/^--|^counter-reset\s*:/.test(declaration), `Global rule "${selectors.trim()}" sets ${declaration}`)
    }
  }
  if (process.env.AGENTS_UI_PACKAGE_ARTIFACT_DIR) {
    const artifactDirectory = path.resolve(process.env.AGENTS_UI_PACKAGE_ARTIFACT_DIR)
    await mkdir(artifactDirectory, {recursive: true})
    await cp(path.join(temporary, packed.filename), path.join(artifactDirectory, packed.filename))
  }
  console.log(
    `Verified packed ${manifest.name}@${manifest.version}: ${packed.files.length} files, ${
      cleanInstall ? 'clean npm install' : 'offline React reuse'
    }, Node ESM import, NodeNext and bundler declarations, compiled CSS`,
  )
} finally {
  await rm(temporary, {recursive: true, force: true})
}
