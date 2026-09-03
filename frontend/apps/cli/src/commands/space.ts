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
 */
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import type {Command} from 'commander'
import {resolve} from 'node:path'
import {getClient} from '../index'
import {printError, printInfo, printSuccess} from '../output'
import {runDevLoop} from '../utils/dev-loop'
import {keyOptions, resolveSigningKey} from '../utils/keys'
import {createSignerFromKey} from '../utils/signer'
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
    .option('--no-watch', 'Do not push files changed on disk while the loop runs')
    .action(async (options) => {
      try {
        await runDevLoop({
          dir: resolve(options.dir),
          apiUrl: options.api,
          daemonUrl: options.daemon,
          intervalMs: Number(options.interval),
          push: options.push !== false,
          watchFiles: options.watch !== false,
        })
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}
