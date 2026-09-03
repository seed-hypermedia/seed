/**
 * sync-hypermedia.ts — the hypermedia/ schema library ⇄ its Hypermedia site.
 *
 *   cd frontend/apps/cli
 *   bun run src/sync-hypermedia.ts push [--dry-run] [--server <url>] [--key <name>]
 *   bun run src/sync-hypermedia.ts pull [--server <url>] [--space <uid>]
 *   bun run src/sync-hypermedia.ts dev  [--api <url>] [--daemon <url>] [--interval <ms>] [--no-push]
 *
 * This is `seed-cli space import / export / dev` (utils/space-sync.ts) with the
 * library's own layout on top:
 *
 *   <basename>.md + <basename>.schema.json  → hm://<space>/<publicName>
 *       publicName strips `onyx-` from primitives/meta (onyx-string → /string)
 *   site/home.md                            → hm://<space>            (root)
 *   site/<name>.md                          → hm://<space>/<name>
 *   top-level .md without a schema file     → not published (README.md, …)
 *
 * Schema files are handled by the generic import: a type file becomes the
 * document's `schemaDefinition` blob, a `{$type, value}` file makes the
 * document conform to `$type`. On top of that, push and dev verify every
 * schema CID against schemas.lock.json first, and a pull that changed a schema
 * refreshes the lockfile and the bundled registry.
 *
 * push: publish the schema blobs, then import hypermedia/ as documents.
 *       Existing documents are updated by block id on their own history;
 *       unchanged documents publish nothing.
 * pull: export every document of the space back into hypermedia/.
 * dev:  the local editing loop against the desktop dev app (see `space dev`).
 */

import {spawnSync} from 'node:child_process'
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import {createSeedClient, type HMSigner, type SeedClient} from '@seed-hypermedia/client'
import {runDevLoop} from './utils/dev-loop'
import {resolveSigningKey} from './utils/keys'
import {createSignerFromKey} from './utils/signer'
import {encodeSchemaBlob, exportSpace, importSpace, type SpaceLayout} from './utils/space-sync'

// ── Paths ─────────────────────────────────────────────────────────────────────

const DIR = dirname(fileURLToPath(import.meta.url)) // frontend/apps/cli/src
const REPO_ROOT = resolve(DIR, '../../../..')
const SCHEMAS_DIR = resolve(REPO_ROOT, 'hypermedia')
const LOCK_PATH = resolve(SCHEMAS_DIR, 'schemas.lock.json')

// ── Naming ────────────────────────────────────────────────────────────────────

/** The space the library is published under. */
const SITE = 'z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb'

/** Public doc name for a schema file basename: strip `onyx-` from primitives/meta. */
function publicName(basename: string): string {
  return basename.startsWith('onyx-') ? basename.slice(5) : basename
}

/** Inverse of publicName against the files on disk. */
function basenameForPublicName(name: string): string {
  if (existsSync(resolve(SCHEMAS_DIR, `onyx-${name}.schema.json`))) return `onyx-${name}`
  return name
}

function hasSchemaFile(basename: string): boolean {
  return existsSync(resolve(SCHEMAS_DIR, `${basename}.schema.json`))
}

/** How documents of the space map onto hypermedia/. */
export const layout: SpaceLayout = {
  pathForFile(file) {
    if (file.startsWith('site/')) {
      const name = file.slice('site/'.length).replace(/\.md$/, '')
      return name === 'home' ? '' : `/${name}`
    }
    if (file.includes('/')) return null
    const basename = file.replace(/\.md$/, '')
    // Only schema-backed top-level docs are published (README.md etc. are not).
    return hasSchemaFile(basename) ? `/${publicName(basename)}` : null
  },
  fileForPath(path, doc) {
    if (path === '') return 'site/home.md'
    const name = path.replace(/^\//, '')
    if (name.includes('/')) return `site/${name}.md`
    const basename = basenameForPublicName(name)
    const meta = (doc.metadata || {}) as Record<string, unknown>
    if (hasSchemaFile(basename) || meta.schemaDefinition) return `${basename}.md`
    return `site/${name}.md`
  },
  schemaFileFor(mdFile) {
    return mdFile.startsWith('site/') ? null : mdFile.replace(/\.md$/, '.schema.json')
  },
  fileForLinkPath(path) {
    if (path === '') return 'site/home.md'
    const name = path.replace(/^\//, '')
    if (name.includes('/')) return `site/${name}.md`
    const basename = basenameForPublicName(name)
    return hasSchemaFile(basename) ? `${basename}.md` : `site/${name}.md`
  },
}

// ── Schema blobs ──────────────────────────────────────────────────────────────

/** Encode every schema file and verify it against the lockfile; the blobs to publish. */
async function loadSchemaBlobs(): Promise<Array<{data: Uint8Array; cid: string}>> {
  const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as {schemas: Record<string, string>}
  const files = readdirSync(SCHEMAS_DIR)
    .filter((f) => f.endsWith('.schema.json'))
    .sort()
  const blobs: Array<{data: Uint8Array; cid: string}> = []
  let mismatches = 0
  for (const file of files) {
    const basename = file.replace(/\.schema\.json$/, '')
    const obj = JSON.parse(readFileSync(resolve(SCHEMAS_DIR, file), 'utf8'))
    const {data, cid} = await encodeSchemaBlob(obj)
    const lockUrl = `hm://${SITE}/${publicName(basename)}`
    const expected = lock.schemas[lockUrl]
    if (!expected) {
      console.error(`  ! ${file}: no lockfile entry for ${lockUrl}`)
      mismatches++
    } else if (expected !== cid) {
      console.error(`  ! ${file}: CID mismatch\n      computed ${cid}\n      lockfile ${expected}`)
      mismatches++
    }
    blobs.push({data, cid})
  }
  if (mismatches > 0) {
    console.error(`\nFAILED: ${mismatches} schema CID mismatch(es). Run \`node hypermedia/publish.mjs\` and retry.`)
    process.exit(1)
  }
  return blobs
}

/** Refresh the lockfile and the bundled registry after schema files changed. */
function refreshSchemaArtifacts() {
  for (const script of ['hypermedia/publish.mjs', 'scripts/gen-onyx.mjs']) {
    const run = spawnSync('node', [script], {cwd: REPO_ROOT, stdio: 'inherit'})
    if (run.status !== 0) throw new Error(`${script} failed`)
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

function argValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  return idx >= 0 ? args[idx + 1] : undefined
}

/** Publish the schema blobs, then import hypermedia/ into `account` on `client`. */
async function pushTo(client: SeedClient, signer: HMSigner, account: string, dryRun: boolean) {
  const blobs = await loadSchemaBlobs()
  console.log(`Schema blobs: ${blobs.length} encoded, all CIDs match the lockfile.`)
  if (!dryRun) {
    console.log(`Publishing ${blobs.length} schema blobs...`)
    await client.publish({blobs})
    console.log('  done.\n')
  }
  const result = await importSpace({
    client,
    signer,
    account,
    dir: SCHEMAS_DIR,
    layout,
    dryRun,
    log: (line) => console.log('  ' + line),
  })
  console.log(
    `\n${dryRun ? 'DRY RUN' : 'DONE'}: ${result.created.length} created, ${result.moved.length} moved, ${
      result.updated.length
    } updated, ${result.unchanged.length} unchanged.`,
  )
  return result
}

function noSigner(): HMSigner {
  const fail = () => {
    throw new Error('no signing key (dry run)')
  }
  return {getPublicKey: fail, sign: fail}
}

async function push(args: string[]) {
  const dryRun = args.includes('--dry-run')
  const serverUrl = argValue(args, '--server') ?? 'https://hyper.media'
  const keyName = argValue(args, '--key') ?? 'main'

  // A dry run needs no signer: it only diffs against the server.
  const key = dryRun
    ? await resolveSigningKey(keyName, {dev: false}).catch(() => null)
    : await resolveSigningKey(keyName, {dev: false})
  const account = key?.accountId ?? argValue(args, '--space') ?? SITE
  const signer = key ? createSignerFromKey(key) : noSigner()
  console.log(
    `Account: ${account}${account === SITE ? ' (the site)' : '  ! not the site account'}${key ? '' : '  (no key)'}`,
  )
  console.log(`Server:  ${serverUrl}`)
  console.log(`Mode:    ${dryRun ? 'DRY RUN' : 'PUBLISH'}\n`)

  await pushTo(createSeedClient(serverUrl), signer, account, dryRun)
  console.log(`Root: hm://${account}`)
}

async function pull(args: string[]) {
  const serverUrl = argValue(args, '--server') ?? 'https://hyper.media'
  const uid = argValue(args, '--space') ?? SITE
  console.log(`Space:  hm://${uid}`)
  console.log(`Server: ${serverUrl}\n`)

  const client = createSeedClient(serverUrl)
  const result = await exportSpace({client, uid, dir: SCHEMAS_DIR, layout, log: (line) => console.log('  ' + line)})
  console.log(`\nPulled: ${result.written.length} written, ${result.unchanged.length} unchanged.`)
  if (result.written.some((f) => f.endsWith('.schema.json'))) refreshSchemaArtifacts()
}

/** `space dev` on hypermedia/ with its layout; schema blobs go up before the documents. */
async function dev(args: string[]) {
  await runDevLoop({
    dir: SCHEMAS_DIR,
    apiUrl: argValue(args, '--api') ?? 'http://localhost:58004',
    daemonUrl: argValue(args, '--daemon') ?? 'http://localhost:58001',
    intervalMs: Number(argValue(args, '--interval') ?? 2000),
    push: !args.includes('--no-push'),
    layout,
    beforePush: async ({client}) => {
      const blobs = await loadSchemaBlobs()
      console.log(`Schema blobs: ${blobs.length} encoded, all CIDs match the lockfile. Publishing...`)
      await client.publish({blobs})
    },
    onWritten: (files) => {
      if (files.some((f) => f.endsWith('.schema.json'))) refreshSchemaArtifacts()
    },
  })
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'push') return push(args)
  if (command === 'pull') return pull(args)
  if (command === 'dev') return dev(args)
  console.error(
    [
      'usage: sync-hypermedia.ts push [--dry-run] [--server <url>] [--key <name>]',
      '       sync-hypermedia.ts pull [--server <url>] [--space <uid>]',
      '       sync-hypermedia.ts dev  [--api <url>] [--daemon <url>] [--interval <ms>] [--no-push]',
    ].join('\n'),
  )
  process.exit(2)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
