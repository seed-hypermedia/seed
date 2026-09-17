/**
 * Repo HM sync — `space export` / `space import` / `space dev`: mirror a whole
 * space to a directory of markdown files in a repository and back, and edit
 * that directory in the Seed app. See utils/space-sync.ts for the file mapping and the update
 * semantics, utils/dev-loop.ts for the editing loop.
 *
 *   seed-cli space export hm://<uid> --dir ./docs
 *   seed-cli space import hm://<uid> --dir ./docs [--dry-run]
 *   seed-cli space import self --dir ./docs        # the signing key's own space
 *   seed-cli space dev --dir ./docs                # local editing loop (desktop dev app)
 *   seed-cli space archive hm://<uid> -o site.zip  # markdown + assets in a zip (--format blobs: signed blobs)
 *   seed-cli space restore site.zip [--into self]  # publish a blob archive, or import a markdown one
 */
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import type {Command} from 'commander'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {getClient} from '../index'
import {printError, printInfo, printSuccess, printWarning} from '../output'
import {runDevLoop} from '../utils/dev-loop'
import {keyOptions, resolveSigningKey} from '../utils/keys'
import {createSignerFromKey} from '../utils/signer'
import {AssetDownloader, archiveSpace, extractMarkdownArchive, readArchive, restoreBlobs} from '../utils/space-archive'
import {exportSpace, importSpace} from '../utils/space-sync'

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
    .option('--assets', 'Download the files documents link into <dir>/assets and link them relatively')
    .action(async (id: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      try {
        const uid =
          id === 'self' ? (await resolveSigningKey(options.key, keyOptions(globalOpts))).accountId : spaceUid(id)
        const client = getClient(globalOpts)
        const dir = resolve(options.dir)
        const log = globalOpts.quiet ? undefined : printInfo
        const assets = options.assets ? new AssetDownloader(client, dir, 'assets', log) : undefined
        const result = await exportSpace({client, uid, dir, log, assets})
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
    .option('--check', 'Validate every document against its schema first; publish nothing on a violation')
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
          check: !!options.check,
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
    .command('archive <space>')
    .description(
      'Save a whole space to a zip file: markdown with its assets (default), or the signed blobs themselves (--format blobs)',
    )
    .requiredOption('-o, --out <file>', 'The zip file to write')
    .option(
      '-f, --format <format>',
      'markdown (readable, re-importable) or blobs (exact, restorable anywhere)',
      'markdown',
    )
    .option('--no-comments', 'Blob archives: leave out comments on the documents')
    .option('-k, --key <name>', 'Signing key name or account ID (only used when <space> is "self")')
    .action(async (id: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const kind = options.format
      if (kind !== 'markdown' && kind !== 'blobs') {
        printError(`--format must be markdown or blobs, got ${kind}`)
        process.exit(1)
      }
      const workDir = mkdtempSync(join(tmpdir(), 'seed-archive-'))
      try {
        const uid =
          id === 'self' ? (await resolveSigningKey(options.key, keyOptions(globalOpts))).accountId : spaceUid(id)
        const out = resolve(options.out)
        const {manifest, bytes} = await archiveSpace({
          client: getClient(globalOpts),
          uid,
          kind,
          out,
          comments: options.comments !== false,
          workDir,
          log: globalOpts.quiet ? undefined : printInfo,
        })
        const missing = manifest.missing?.length ?? 0
        if (missing) {
          printWarning(
            `${missing} linked item${
              missing === 1 ? '' : 's'
            } could not be fetched (listed under "missing" in manifest.json)`,
          )
        }
        if (globalOpts.quiet) console.log(out)
        else {
          const contents =
            kind === 'blobs'
              ? `${manifest.blobs!.length} blobs`
              : `${manifest.assets!.length} asset${manifest.assets!.length === 1 ? '' : 's'}`
          printSuccess(
            `Archived hm://${uid} to ${out}: ${manifest.documents.length} documents, ${contents}, ${formatBytes(
              bytes,
            )}`,
          )
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      } finally {
        rmSync(workDir, {recursive: true, force: true})
      }
    })

  space
    .command('restore <file>')
    .description(
      'Restore a space archive: publish a blob archive as is, or import a markdown archive into a space ("self" by default)',
    )
    .option(
      '--into <space>',
      'Markdown archives: the space to import into ("self" = the signing key\'s own space)',
      'self',
    )
    .option('-k, --key <name>', 'Markdown archives: signing key name or account ID')
    .option('-d, --dir <path>', 'Markdown archives: extract here and keep the files (default: a temporary directory)')
    .option('--dry-run', 'Check the archive and report what would be published')
    .action(async (file: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const log = globalOpts.quiet ? undefined : printInfo
      let tempDir: string | undefined
      try {
        const client = getClient(globalOpts)
        const {manifest, files} = readArchive(resolve(file))
        if (manifest.kind === 'blobs') {
          const {published, bytes} = await restoreBlobs({client, manifest, files, dryRun: !!options.dryRun, log})
          if (!globalOpts.quiet) {
            printSuccess(
              options.dryRun
                ? `${manifest.blobs!.length} blobs (${formatBytes(bytes)}) verified; would publish hm://${
                    manifest.space
                  } to ${client.baseUrl}`
                : `Published ${published} blobs (${formatBytes(bytes)}) of hm://${manifest.space} to ${client.baseUrl}`,
            )
          }
          return
        }
        const key = await resolveSigningKey(options.key, keyOptions(globalOpts))
        const account = options.into === 'self' ? key.accountId : spaceUid(options.into)
        if (key.accountId !== account) {
          throw new Error(
            `Key ${key.accountId} does not own space ${account}. Importing with a delegated key is not supported yet.`,
          )
        }
        const dir = options.dir ? resolve(options.dir) : (tempDir = mkdtempSync(join(tmpdir(), 'seed-restore-')))
        extractMarkdownArchive(files, dir)
        const result = await importSpace({
          client,
          signer: createSignerFromKey(key),
          account,
          dir,
          dryRun: !!options.dryRun,
          log,
        })
        if (!globalOpts.quiet) {
          printSuccess(
            `${options.dryRun ? 'Would publish' : 'Published'} hm://${manifest.space} into hm://${account}: ${
              result.created.length
            } created, ${result.moved.length} moved, ${result.updated.length} updated, ${
              result.unchanged.length
            } unchanged`,
          )
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      } finally {
        if (tempDir) rmSync(tempDir, {recursive: true, force: true})
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
    .option('--no-watch', 'Do not push files changed on disk while the loop runs')
    .option('--keep-stale', 'Leave the dev sites of earlier loops in the daemon instead of retiring them')
    .action(async (options) => {
      try {
        await runDevLoop({
          dir: resolve(options.dir),
          apiUrl: options.api,
          daemonUrl: options.daemon,
          intervalMs: Number(options.interval),
          push: options.push !== false,
          watchFiles: options.watch !== false,
          retireStale: !options.keepStale,
        })
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
