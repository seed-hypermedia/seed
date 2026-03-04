/**
 * Capability commands — create.
 */

import type {Command} from 'commander'
import * as ed25519 from '@noble/ed25519'
import {createCapability} from '@seed-hypermedia/client'
import type {CapabilityRole} from '@seed-hypermedia/client'
import type {HMSigner} from '@shm/shared/hm-types'
import {getClient} from '../index'
import {printError, printSuccess, printInfo} from '../output'
import {resolveKey} from '../utils/keyring'

export function registerCapabilityCommands(program: Command) {
  const capability = program
    .command('capability')
    .description('Manage capabilities (delegate access)')
    .addHelpText(
      'after',
      `
Examples:
  $ seed capability create --delegate z6Mkr... --role WRITER
  $ seed capability create --delegate z6Mkr... --role AGENT --path /docs`,
    )

  // ── create ───────────────────────────────────────────────────────────────

  capability
    .command('create')
    .description('Create a capability (delegate access to another account)')
    .requiredOption('--delegate <accountId>', 'Account ID of the delegate receiving access')
    .requiredOption('--role <role>', 'Role to grant: WRITER or AGENT')
    .option('--path <path>', 'Path scope for the capability')
    .option('--label <label>', 'Human-readable label')
    .option('-k, --key <name>', 'Signing key name or account ID')
    .action(async (options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev
      const client = getClient(globalOpts)

      try {
        const role = options.role.toUpperCase() as CapabilityRole
        if (role !== 'WRITER' && role !== 'AGENT') {
          throw new Error(`Invalid role "${options.role}". Must be WRITER or AGENT.`)
        }

        const key = resolveKey(options.key, dev)

        const signer: HMSigner = {
          getPublicKey: async () => key.publicKeyWithPrefix,
          sign: async (data: Uint8Array) => ed25519.signAsync(data, key.privateKey),
        }

        const result = await createCapability(
          {
            delegateUid: options.delegate,
            role,
            path: options.path,
            label: options.label,
          },
          signer,
        )
        await client.publish(result)

        printSuccess('Capability created')
        if (!globalOpts.quiet) {
          printInfo(`Delegated ${role} to ${options.delegate}`)
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}
