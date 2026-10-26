/**
 * The Repo HM sync dev loop behind `seed-cli space dev` (and sync-hypermedia.ts
 * dev): publish a directory of markdown into the daemon behind a running
 * desktop dev app under a throwaway key, then keep the two in step both ways:
 * every document published in the app is written back into the directory, and
 * every .md or .schema.json changed on disk is pushed into the daemon.
 *
 * The app is the editor; git is where you commit. The dev daemon is a peer
 * like any other, so the site does propagate to whatever network it is on;
 * only the dev daemon is watched, though.
 */
import {createGrpcWebTransport} from '@connectrpc/connect-web'
import {createSeedClient, type HMSigner, type SeedClient} from '@seed-hypermedia/client'
import {createGRPCClient} from '@shm/shared/grpc-client'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {spawn} from 'node:child_process'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {basename, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {printInfo, printSuccess, printWarning} from '../output'
import {deriveKeyPairFromMnemonic, generateMnemonic, type KeyPair} from './key-derivation'
import {createSignerFromKey} from './signer'
import {DevDirectorySync} from './dev-sync'
import {grantWriters, listSpaceVersions, type ImportOptions, type SpaceLayout} from './space-sync'

/** The unencrypted dev key: a mnemonic in `<dir>/.dev/` (self-ignored), created on first use. */
function loadOrCreateDevKey(dir: string): {keyPair: KeyPair; words: string[]; created: boolean} {
  const devDir = resolve(dir, '.dev')
  const file = resolve(devDir, 'dev-key.mnemonic')
  let words: string[]
  let created = false
  if (existsSync(file)) {
    words = readFileSync(file, 'utf8').trim().split(/\s+/)
  } else {
    words = generateMnemonic(12).split(' ')
    mkdirSync(devDir, {recursive: true})
    writeFileSync(resolve(devDir, '.gitignore'), '*\n')
    writeFileSync(file, words.join(' ') + '\n', {mode: 0o600})
    created = true
  }
  return {keyPair: deriveKeyPairFromMnemonic(words), words, created}
}

/**
 * Every account this directory has used as its dev key, kept in `<dir>/.dev/accounts.json` (ignored with the rest
 * of `.dev/`). It is the only proof a dev key is this directory's own: a key's name cannot tell this machine's
 * stale key from another machine's live one, and a daemon whose keys sync through a remote vault holds both.
 */
export function recordDevAccount(dir: string, accountId: string): Set<string> {
  const devDir = resolve(dir, '.dev')
  const file = resolve(devDir, 'accounts.json')
  let accounts: string[] = []
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (Array.isArray(parsed)) accounts = parsed.filter((a): a is string => typeof a === 'string')
  } catch {
    // No record yet (or an unreadable one): start from this account.
  }
  if (!accounts.includes(accountId)) {
    accounts.push(accountId)
    mkdirSync(devDir, {recursive: true})
    writeFileSync(file, JSON.stringify(accounts, null, 2) + '\n')
  }
  return new Set(accounts)
}

/**
 * The daemon key name for a directory's dev site: `hm-sync-<dir name>-<account suffix>`.
 *
 * The daemon addresses keys by name and a name belongs to one key, but every machine makes its own dev key. When
 * the daemon's keys sync through a remote vault it sees every machine's dev key, so a name without the account
 * in it lets one machine's key hold another's name, and registering then fails with "already exists". Key names
 * are [a-zA-Z0-9_-]; the suffix is the account id's tail, which is base58.
 */
export const devKeyName = (dir: string, accountId: string) =>
  `hm-sync-${basename(dir).replace(/[^a-zA-Z0-9_-]/g, '_')}-${accountId.slice(-8)}`
/** A dev-site key by its name, from this machine or another. Never enough on its own to delete one. */
const isDevSiteKey = (name: string) => name.startsWith('hm-sync-') || /^dev-[A-Za-z0-9]{6}$/.test(name)

/**
 * The dev keys to retire: this directory's earlier dev keys, known by account from its record. Keys another
 * machine made are left alone, even when they are named like dev keys.
 */
export function staleDevKeys<K extends {name: string; publicKey: string}>(
  keys: K[],
  current: string,
  ownAccounts: ReadonlySet<string>,
): K[] {
  return keys.filter((key) => key.publicKey !== current && ownAccounts.has(key.publicKey))
}

/**
 * Make sure the daemon holds the dev key under this directory's name, so the
 * app can edit as that account. Returns every key the daemon holds.
 */
async function ensureDaemonKey(
  daemonUrl: string,
  dir: string,
  words: string[],
  accountId: string,
): Promise<Array<{name: string; publicKey: string}>> {
  const grpc = createGRPCClient(createGrpcWebTransport({baseUrl: daemonUrl}))
  const name = devKeyName(dir, accountId)
  const existing = await grpc.daemon.listKeys({})
  const ours = existing.keys.find((k) => k.publicKey === accountId)
  if (!ours) {
    await grpc.daemon.registerKey({mnemonic: words, name})
    printInfo(`Registered key "${name}" in the daemon.`)
  } else if (ours.name !== name && !existing.keys.some((k) => k.name === name)) {
    await grpc.daemon.updateKey({currentName: ours.name, newName: name})
  }
  const keys = await grpc.daemon.listKeys({})
  return keys.keys.map((k) => ({name: k.name, publicKey: k.publicKey}))
}

/**
 * Retire the dev sites of this directory's earlier dev keys (a regenerated key, a renamed directory) that are
 * still in the daemon, known by account from the directory's record. Their documents are tombstoned so they stop
 * turning up in search and links, and the key is removed. The home document cannot be tombstoned (the daemon
 * refuses), so an empty home remains.
 *
 * Only recorded accounts are retired. Retiring by name alone deleted the live dev key of another machine whose
 * keys sync through the same vault, and marked that machine's dev site deleted.
 */
async function retireStaleDevSites(
  daemonUrl: string,
  client: SeedClient,
  keys: Array<{name: string; publicKey: string}>,
  current: string,
  ownAccounts: ReadonlySet<string>,
) {
  const grpc = createGRPCClient(createGrpcWebTransport({baseUrl: daemonUrl}))
  const foreign = keys.filter(
    (key) => key.publicKey !== current && isDevSiteKey(key.name) && !ownAccounts.has(key.publicKey),
  )
  if (foreign.length) {
    printInfo(
      `Leaving ${foreign.length} dev key(s) this directory did not create untouched (another machine's, or older).`,
    )
  }
  for (const key of staleDevKeys(keys, current, ownAccounts)) {
    try {
      const versions = await listSpaceVersions(client, key.publicKey)
      let removed = 0
      for (const path of versions.keys()) {
        if (path === '') continue
        try {
          await grpc.documents.createRef({
            account: key.publicKey,
            path: hmIdPathToEntityQueryPath(path.replace(/^\//, '').split('/')),
            signingKeyName: key.name,
            target: {target: {case: 'tombstone', value: {}}},
          })
          removed++
        } catch (err) {
          printWarning(`  could not remove ${key.publicKey.slice(-6)}${path}: ${(err as Error).message}`)
        }
      }
      await grpc.daemon.deleteKey({name: key.name})
      printInfo(`Retired the stale dev site of key "${key.name}" (${key.publicKey}): ${removed} documents removed.`)
    } catch (err) {
      printWarning(`Could not retire dev site ${key.publicKey}: ${(err as Error).message}`)
    }
  }
}

/**
 * Open a URL in the running desktop dev app. `open hm://…` would hand the URL
 * to whichever app the OS has registered for the scheme, usually the
 * production Seed app, whose daemon is not the one this loop watches. The dev
 * app holds Electron's single-instance lock, so launching a second dev
 * instance with the URL as an argument forwards it to the running one
 * (`second-instance` in the desktop main process) and exits.
 * Returns false when the dev checkout or its Electron binary cannot be found.
 */
function openInDevApp(url: string): boolean {
  const repoRoot = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)))
  const desktopDir = resolve(repoRoot, 'frontend/apps/desktop')
  const candidates =
    process.platform === 'darwin'
      ? ['node_modules/electron/dist/Electron.app/Contents/MacOS/Electron']
      : process.platform === 'win32'
        ? ['node_modules/electron/dist/electron.exe']
        : ['node_modules/electron/dist/electron']
  const electron = candidates.map((c) => resolve(repoRoot, c)).find((c) => existsSync(c))
  if (!electron || !existsSync(resolve(desktopDir, '.vite/build/main.js'))) return false
  try {
    const child = spawn(electron, ['.', url], {cwd: desktopDir, stdio: 'ignore', detached: true})
    child.unref()
    return true
  } catch {
    return false
  }
}

/** Block until the daemon (gRPC-web) and the desktop app's HTTP API both answer. */
async function waitForDevApp(daemonUrl: string, apiUrl: string): Promise<void> {
  const grpc = createGRPCClient(createGrpcWebTransport({baseUrl: daemonUrl}))
  const daemonUp = () =>
    grpc.daemon.listKeys({}).then(
      () => true,
      () => false,
    )
  // Any HTTP answer means the app's API server is listening (404 included).
  const apiUp = () =>
    fetch(`${apiUrl}/api/`).then(
      () => true,
      () => false,
    )
  let announced = false
  for (;;) {
    const [daemon, api] = await Promise.all([daemonUp(), apiUp()])
    if (daemon && api) {
      if (announced) printInfo('Desktop dev app is up.')
      return
    }
    if (!announced) {
      printInfo(
        `Waiting for the desktop dev app (daemon ${daemonUrl}${daemon ? ' ok' : ''}, API ${apiUrl}${
          api ? ' ok' : ''
        })...`,
      )
      announced = true
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

export type DevLoopOptions = {
  dir: string
  apiUrl: string
  daemonUrl: string
  intervalMs: number
  /** Publish the directory into the daemon first (default true). */
  push: boolean
  /** How documents map onto files; the default layout unless the directory has its own. */
  layout?: SpaceLayout
  metadataFor?: ImportOptions['metadataFor']
  /** Runs before the directory is pushed, e.g. to publish blobs the documents reference. */
  beforePush?: (ctx: {client: SeedClient; signer: HMSigner; account: string}) => Promise<void>
  /** Called after each tick that wrote files, with the files written. */
  onWritten?: (files: string[]) => void
  /** Watch the files too and push a changed .md / .schema.json (default true). */
  watchFiles?: boolean
  /** Called after a file change was pushed, with the files pushed. */
  onPushed?: (files: string[]) => void
  /** Tombstone the documents of earlier dev sites in this daemon and drop their keys (default true). */
  retireStale?: boolean
  /** Runs once the loop is watching, e.g. to report whether the canonical site is behind. */
  afterStart?: (ctx: {client: SeedClient; account: string}) => void | Promise<void>
}

/** The dev loop behind `space dev`, reusable by directories with their own layout (see sync-hypermedia.ts). */
export async function runDevLoop(opts: DevLoopOptions) {
  const {keyPair, words, created} = loadOrCreateDevKey(opts.dir)
  const account = keyPair.accountId
  const ownAccounts = recordDevAccount(opts.dir, account)
  // The account this directory publishes as right now. A local agents server reads it to resolve hm://hyper.media
  // to the dev site (SEED_AGENTS_DOCS_ACCOUNT_FILE in .env.vars).
  writeFileSync(resolve(opts.dir, '.dev', 'account'), account + '\n')
  printInfo(`Dev key: ${account}${created ? ' (new; saved under .dev/ in the directory)' : ''}`)
  printInfo(`Daemon:  ${opts.daemonUrl}`)
  printInfo(`API:     ${opts.apiUrl}`)

  // Under `./dev up` this pane starts while the desktop pane is still building
  // the app and its daemon, so wait for both rather than fail.
  await waitForDevApp(opts.daemonUrl, opts.apiUrl)
  const localKeys = await ensureDaemonKey(opts.daemonUrl, opts.dir, words, account)

  const client = createSeedClient(opts.apiUrl)
  const signer = createSignerFromKey(keyPair)

  if (opts.retireStale !== false) await retireStaleDevSites(opts.daemonUrl, client, localKeys, account, ownAccounts)

  // Every account in the app can edit the dev site, not just the dev key.
  await grantWriters(
    {client, signer, account, log: printInfo},
    localKeys.filter((k) => k.publicKey === account || !isDevSiteKey(k.name)),
  )

  const sync = new DevDirectorySync(opts, client, signer, account, printInfo)
  let lastError = ''
  // Startup uses the same recoverable pass as later checkouts. A Git operation
  // or a temporary publish failure leaves the launcher alive and retries.
  for (;;) {
    try {
      await sync.tick()
      break
    } catch (error) {
      const message = (error as Error).message
      if (message !== lastError) printWarning(message)
      lastError = message
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs))
  }

  const url = `hm://${account}`
  printSuccess(`Site: ${url}`)
  const openSite = () => {
    if (openInDevApp(url)) printInfo('Opened in the desktop DEV app. Edit and publish there; files update here.')
    else printInfo('Paste the URL into the omnibar of the desktop DEV app. Edit and publish there; files update here.')
  }
  // The first run of a folder opens its new site; later runs open on request,
  // so a restart does not steal focus (o in the pane; Ctrl-C still quits).
  if (created) openSite()
  if (process.stdin.isTTY) {
    printInfo(created ? 'Press o to open the site again.' : 'Press o to open the site in the dev app.')
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (key: string) => {
      if (key === 'o' || key === 'O') openSite()
      else if (key === '\u0003') process.exit(0)
    })
  } else if (!created) {
    printInfo('Open it in the dev app when you like; the loop does not open it on a restart.')
  }
  printWarning(
    'Only the dev app (the one behind ' +
      opts.daemonUrl +
      ') is watched. The production Seed app registers the same hm:// scheme, so do not open the site from a link: edits made there never reach this directory.',
  )

  printInfo(`Checking the checkout and dev site every ${opts.intervalMs}ms. Ctrl-C to stop.`)
  if (opts.afterStart) {
    void Promise.resolve(opts.afterStart({client, account})).catch((err) =>
      printWarning(`after-start check failed: ${(err as Error).message}`),
    )
  }
  for (;;) {
    await new Promise((r) => setTimeout(r, opts.intervalMs))
    try {
      await sync.tick()
      if (lastError) printInfo('Sync resumed.')
      lastError = ''
    } catch (error) {
      const message = (error as Error).message
      if (message !== lastError) printWarning(message)
      lastError = message
    }
  }
}
