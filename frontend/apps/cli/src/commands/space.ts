/**
 * `space export` / `space import`: mirror a whole space to a directory of
 * markdown files and back. See utils/space-sync.ts for the mapping and the
 * update semantics.
 */
import type {Command} from 'commander'
import {resolve} from 'path'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {getClient} from '../index'
import {printError, printInfo, printSuccess} from '../output'
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
  const space = program.command('space').description('Mirror a whole space to a directory of markdown files and back')

  space
    .command('export <space>')
    .description('Write every document of a space to <dir> as lossless markdown (plus defined schemas)')
    .requiredOption('-d, --dir <path>', 'Target directory')
    .action(async (id: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      try {
        const uid = spaceUid(id)
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
    .description('Publish the markdown files in <dir> into a space, updating existing documents by block id')
    .requiredOption('-d, --dir <path>', 'Source directory')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .option('--dry-run', 'Report what would change without publishing')
    .action(async (id: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      try {
        const account = spaceUid(id)
        const client = getClient(globalOpts)
        const key = await resolveSigningKey(options.key, keyOptions(globalOpts))
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
              result.updated.length
            } updated, ${result.unchanged.length} unchanged, ${result.skipped.length} skipped`,
          )
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}
