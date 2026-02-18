/**
 * Key management commands.
 *
 * Keys are stored in the OS keyring, shared with the Go daemon.
 */

import type {Command} from 'commander'
import {
  formatOutput,
  printError,
  printSuccess,
  printInfo,
  printWarning,
} from '../output'
import {
  generateMnemonic,
  validateMnemonic,
  deriveKeyPairFromMnemonic,
} from '../utils/key-derivation'
import {
  listKeys as keyringListKeys,
  getKey as keyringGetKey,
  getDefaultKey as keyringGetDefaultKey,
  storeKey as keyringStoreKey,
  removeKey as keyringRemoveKey,
} from '../utils/keyring'
import {setConfigValue} from '../config'
import {getOutputFormat} from '../index'

export function registerKeyCommands(program: Command) {
  const key = program.command('key').description('Manage signing keys')

  key
    .command('generate')
    .description('Generate a new signing key from mnemonic')
    .option('-n, --name <name>', 'Name for the key', 'main')
    .option('-w, --words <count>', 'Mnemonic word count (12 or 24)', '12')
    .option('--passphrase <pass>', 'Optional passphrase', '')
    .option(
      '--show-mnemonic',
      'Display the mnemonic (DANGER: write it down securely)',
    )
    .action(async (options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev

      try {
        const wordCount = parseInt(options.words) as 12 | 24
        if (wordCount !== 12 && wordCount !== 24) {
          throw new Error('Word count must be 12 or 24')
        }

        const mnemonic = generateMnemonic(wordCount)
        const keyPair = deriveKeyPairFromMnemonic(mnemonic, options.passphrase)

        const stored = keyringStoreKey(options.name, keyPair.privateKey, dev)

        if (options.showMnemonic) {
          printWarning('SAVE THIS MNEMONIC SECURELY - it cannot be recovered!')
          console.log()
          console.log(mnemonic)
          console.log()
        }

        printSuccess(`Key "${options.name}" created`)
        printInfo(`Account ID: ${stored.accountId}`)

        if (!options.showMnemonic) {
          printInfo('Use --show-mnemonic to display the recovery phrase')
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  key
    .command('import')
    .description('Import a key from existing mnemonic')
    .option('-n, --name <name>', 'Name for the key', 'imported')
    .option('--passphrase <pass>', 'Optional passphrase', '')
    .argument('<mnemonic>', 'BIP-39 mnemonic words (quoted)')
    .action(async (mnemonic: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev

      try {
        if (!validateMnemonic(mnemonic)) {
          throw new Error('Invalid mnemonic')
        }

        const keyPair = deriveKeyPairFromMnemonic(mnemonic, options.passphrase)

        const stored = keyringStoreKey(options.name, keyPair.privateKey, dev)

        printSuccess(`Key "${options.name}" imported`)
        printInfo(`Account ID: ${stored.accountId}`)
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  key
    .command('list')
    .description('List stored signing keys')
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev
      const format = getOutputFormat(globalOpts)

      try {
        const keys = keyringListKeys(dev)

        if (keys.length === 0) {
          printInfo(
            'No keys stored. Use "seed-cli key generate" to create one.',
          )
          return
        }

        if (globalOpts.quiet) {
          keys.forEach((k) => console.log(`${k.name}\t${k.accountId}`))
        } else {
          console.log(formatOutput(keys, format))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  key
    .command('show [nameOrId]')
    .description('Show key information')
    .action(async (nameOrId: string | undefined, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev
      const format = getOutputFormat(globalOpts)

      try {
        const stored = nameOrId
          ? keyringGetKey(nameOrId, dev)
          : keyringGetDefaultKey(dev)

        if (!stored) {
          printError(
            nameOrId ? `Key "${nameOrId}" not found` : 'No keys stored',
          )
          process.exit(1)
        }

        console.log(
          formatOutput(
            {name: stored.name, accountId: stored.accountId},
            format,
          ),
        )
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  key
    .command('remove <nameOrId>')
    .description('Remove a stored key')
    .option('-f, --force', 'Skip confirmation')
    .action(async (nameOrId: string, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev

      try {
        const stored = keyringGetKey(nameOrId, dev)

        if (!stored) {
          printError(`Key "${nameOrId}" not found`)
          process.exit(1)
        }

        if (!options.force) {
          printWarning(
            `This will permanently delete key "${stored.name}" (${stored.accountId})`,
          )
          printInfo('Use --force to confirm')
          process.exit(1)
        }

        const removed = keyringRemoveKey(nameOrId, dev)
        if (removed) {
          printSuccess(`Key "${stored.name}" removed`)
        } else {
          printError(`Failed to remove key "${nameOrId}"`)
          process.exit(1)
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  key
    .command('default [nameOrId]')
    .description('Set or show default signing key')
    .action(async (nameOrId: string | undefined, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const dev = !!globalOpts.dev

      try {
        if (!nameOrId) {
          const defaultKey = keyringGetDefaultKey(dev)
          if (defaultKey) {
            printInfo(
              `Default key: ${defaultKey.name} (${defaultKey.accountId})`,
            )
          } else {
            printInfo('No keys stored')
          }
          return
        }

        const stored = keyringGetKey(nameOrId, dev)
        if (!stored) {
          printError(`Key "${nameOrId}" not found`)
          process.exit(1)
        }

        setConfigValue('defaultAccount', stored.accountId)
        printSuccess(`Default key set to "${stored.name}"`)
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  key
    .command('derive')
    .description('Derive account ID from mnemonic (without storing)')
    .option('--passphrase <pass>', 'Optional passphrase', '')
    .argument('<mnemonic>', 'BIP-39 mnemonic words (quoted)')
    .action(async (mnemonic: string, options) => {
      try {
        if (!validateMnemonic(mnemonic)) {
          throw new Error('Invalid mnemonic')
        }

        const keyPair = deriveKeyPairFromMnemonic(mnemonic, options.passphrase)
        console.log(keyPair.accountId)
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}
