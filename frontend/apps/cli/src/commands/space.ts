/**
 * Repo HM sync — `space export` / `space import` / `space dev`: mirror a whole
 * space to a directory of markdown files in a repository and back, and edit
 * that directory in the Seed app. See utils/space-sync.ts for the file mapping and the update semantics.
 *
 *   seed-cli space export hm://<uid> --dir ./docs
 *   seed-cli space import hm://<uid> --dir ./docs [--dry-run]
 *   seed-cli space import self --dir ./docs        # the signing key's own space
 *   seed-cli space dev --dir ./docs                # local editing loop (desktop dev app)
 */
import {createGrpcWebTransport} from '@connectrpc/connect-web'
import {createSeedClient} from '@seed-hypermedia/client'
import {createGRPCClient} from '@shm/shared/grpc-client'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import type {Command} from 'commander'
import {spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {getClient} from '../index'
import {printError, printInfo, printSuccess, printWarning} from '../output'
import {deriveKeyPairFromMnemonic, generateMnemonic, type KeyPair} from '../utils/key-derivation'
import {keyOptions, resolveSigningKey} from '../utils/keys'
import {createSignerFromKey} from '../utils/signer'
import {exportPath, exportSpace, grantWriters, importSpace, listSpaceVersions} from '../utils/space-sync'
import {unlinkSync} from 'node:fs'

function spaceUid(id: string): string {
  const unpacked = unpackHmId(id.startsWith('hm://') ? id : `hm://${id}`)
  if (!unpacked) throw new Error(`Invalid space id: ${id}`)
  if (unpacked.path && unpacked.path.length) throw new Error(`Expected a space id, got a document path: ${id}`)
  return unpacked.uid
}

export function registerSpaceCommands(program: Command) {
  const space = program
    .command('space')
    .description('Mirror a whole space to a directory of markdown files and back, or edit it in the app')

  space
    .command('export <space>')
    .description('Write every document of a space to <dir> as lossless markdown (plus defined schemas)')
    .requiredOption('-d, --dir <path>', 'Target directory')
    .option('-k, --key <name>', 'Signing key name or account ID (only used when <space> is "self")')
    .action(async (id: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      try {
        const uid =
          id === 'self' ? (await resolveSigningKey(options.key, keyOptions(globalOpts))).accountId : spaceUid(id)
        const client = getClient(globalOpts)
        const dir = resolve(options.dir)
        const result = await exportSpace({client, uid, dir, log: globalOpts.quiet ? undefined : printInfo})
        if (!globalOpts.quiet) {
          printSuccess(
            `Exported hm://${uid} to ${dir}: ${result.written.length} written, ${result.unchanged.length} unchanged, ${result.skipped.length} skipped`,
          )
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  space
    .command('import <space>')
    .description(
      'Publish the markdown files in <dir> into a space, updating existing documents by block id ("self" = the signing key\'s own space)',
    )
    .requiredOption('-d, --dir <path>', 'Source directory')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .option('--dry-run', 'Report what would change without publishing')
    .action(async (id: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      try {
        const client = getClient(globalOpts)
        const key = await resolveSigningKey(options.key, keyOptions(globalOpts))
        const account = id === 'self' ? key.accountId : spaceUid(id)
        if (key.accountId !== account) {
          throw new Error(
            `Key ${key.accountId} does not own space ${account}. Importing with a delegated key is not supported yet.`,
          )
        }
        const dir = resolve(options.dir)
        const result = await importSpace({
          client,
          signer: createSignerFromKey(key),
          account,
          dir,
          dryRun: !!options.dryRun,
          log: globalOpts.quiet ? undefined : printInfo,
        })
        if (!globalOpts.quiet) {
          printSuccess(
            `${options.dryRun ? 'Would publish' : 'Published'} to hm://${account}: ${result.created.length} created, ${
              result.moved.length
            } moved, ${result.updated.length} updated, ${result.unchanged.length} unchanged, ${
              result.skipped.length
            } skipped`,
          )
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  space
    .command('dev')
    .description(
      "Edit <dir> in the desktop dev app: publish it into the app's daemon under a throwaway key, then write every document you publish there back to <dir>",
    )
    .requiredOption('-d, --dir <path>', 'Directory of markdown files')
    .option('--api <url>', 'Desktop app HTTP API', 'http://localhost:58004')
    .option('--daemon <url>', 'Daemon gRPC-web endpoint', 'http://localhost:58001')
    .option('--interval <ms>', 'Poll interval', '2000')
    .option('--no-push', 'Do not publish the directory into the daemon first')
    .action(async (options) => {
      try {
        await runDevLoop({
          dir: resolve(options.dir),
          apiUrl: options.api,
          daemonUrl: options.daemon,
          intervalMs: Number(options.interval),
          push: options.push !== false,
        })
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}

// ── dev: the local editing loop ───────────────────────────────────────────────
//
// The app is the editor; git is where you commit. The directory is published
// into the daemon behind a running desktop dev app under a throwaway key, and
// every document published in the app is written straight back. Nothing
// reaches the network.

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
 * Make sure the daemon holds the dev key, so the app can edit as that account.
 * Returns every key the daemon holds (name + account id).
 */
async function ensureDaemonKey(
  daemonUrl: string,
  words: string[],
  accountId: string,
): Promise<Array<{name: string; publicKey: string}>> {
  const grpc = createGRPCClient(createGrpcWebTransport({baseUrl: daemonUrl}))
  const existing = await grpc.daemon.listKeys({})
  if (!existing.keys.some((k) => k.publicKey === accountId)) {
    const name = `dev-${accountId.slice(-6)}`
    await grpc.daemon.registerKey({mnemonic: words, name})
    printInfo(`Registered key "${name}" in the daemon.`)
  }
  const keys = await grpc.daemon.listKeys({})
  return keys.keys.map((k) => ({name: k.name, publicKey: k.publicKey}))
}

async function runDevLoop(opts: {dir: string; apiUrl: string; daemonUrl: string; intervalMs: number; push: boolean}) {
  const {keyPair, words, created} = loadOrCreateDevKey(opts.dir)
  const account = keyPair.accountId
  printInfo(`Dev key: ${account}${created ? ' (new; saved under .dev/ in the directory)' : ''}`)
  printInfo(`Daemon:  ${opts.daemonUrl}`)
  printInfo(`API:     ${opts.apiUrl}`)

  let localKeys: Array<{name: string; publicKey: string}>
  try {
    localKeys = await ensureDaemonKey(opts.daemonUrl, words, account)
  } catch (err) {
    throw new Error(
      `Cannot reach the daemon at ${opts.daemonUrl} (${(err as Error).message}). Start the desktop dev app first.`,
    )
  }

  const client = createSeedClient(opts.apiUrl)
  const signer = createSignerFromKey(keyPair)

  // Every account in the app can edit the dev site, not just the dev key.
  await grantWriters({client, signer, account, log: printInfo}, localKeys)

  if (opts.push) {
    printInfo('Publishing the directory into the local daemon...')
    const result = await importSpace({client, signer, account, dir: opts.dir, log: printInfo})
    printInfo(
      `${result.created.length} created, ${result.moved.length} moved, ${result.updated.length} updated, ${result.unchanged.length} unchanged.`,
    )
  }

  const url = `hm://${account}`
  printSuccess(`Site: ${url}`)
  printInfo('Open it in the desktop app (paste the URL in the omnibar). Edit and publish; files update here.')
  spawnSync('open', [url], {stdio: 'ignore'})

  let versions = await listSpaceVersions(client, account)
  // Which file each document lives in, so a document moved in the app takes
  // its file along (the old one is removed).
  const files = (await exportSpace({client, uid: account, dir: opts.dir})).files
  printInfo(`Watching ${versions.size} documents every ${opts.intervalMs}ms. Ctrl-C to stop.`)
  for (;;) {
    await new Promise((r) => setTimeout(r, opts.intervalMs))
    let next: Map<string, string>
    try {
      next = await listSpaceVersions(client, account)
    } catch (err) {
      printWarning(`poll failed: ${(err as Error).message}`)
      continue
    }
    const stamp = () => new Date().toLocaleTimeString()
    for (const [path, version] of next) {
      if (versions.get(path) === version) continue
      try {
        const res = await exportPath({client, uid: account, dir: opts.dir}, path)
        for (const file of res.written) printInfo(`${stamp()}  wrote ${file}`)
        if (res.written.length === 0) printInfo(`${stamp()}  ${path || '(home)'} republished, no file change`)
        if (res.file) files.set(path, res.file)
      } catch (err) {
        printWarning(`${path || '(home)'}: ${(err as Error).message}`)
      }
    }
    // A path that vanished was moved away (or deleted): drop its file.
    for (const [path] of versions) {
      if (next.has(path)) continue
      const file = files.get(path)
      if (!file) continue
      try {
        unlinkSync(resolve(opts.dir, file))
        printInfo(`${stamp()}  removed ${file}`)
      } catch {
        // already gone
      }
      files.delete(path)
    }
    versions = next
  }
}
