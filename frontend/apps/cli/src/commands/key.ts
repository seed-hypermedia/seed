/**
 * Key management commands
 */

import type {Command} from 'commander'
import {formatOutput, printError, printSuccess, printInfo, printWarning} from '../output'
import {
  generateMnemonic,
  validateMnemonic,
  deriveKeyPairFromMnemonic,
} from '../utils/key-derivation'
import {
  addKey,
  getKey,
  listKeys,
  removeKey,
  getDefaultKey,
  setConfigValue,
} from '../config'
import {getOutputFormat} from '../index'

export function registerKeyCommands(program: Command) {
  const key = program
    .command('key')
    .description('Manage signing keys')

  // Generate new key
  key
    .command('generate')
    .description('Generate a new signing key from mnemonic')
    .option('-n, --name <name>', 'Name for the key', 'default')
    .option('-w, --words <count>', 'Mnemonic word count (12 or 24)', '12')
    .option('--passphrase <pass>', 'Optional passphrase', '')
    .option('--show-mnemonic', 'Display the mnemonic (DANGER: write it down securely)')
    .action(async (options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()

      try {
        const wordCount = parseInt(options.words) as 12 | 24
        if (wordCount !== 12 && wordCount !== 24) {
          throw new Error('Word count must be 12 or 24')
        }

        const mnemonic = generateMnemonic(wordCount)
        const keyPair = deriveKeyPairFromMnemonic(mnemonic, options.passphrase)

        const stored = addKey({
          name: options.name,
          accountId: keyPair.accountId,
          mnemonic,
          passphrase: options.passphrase,
        })

        if (options.showMnemonic) {
          printWarning('SAVE THIS MNEMONIC SECURELY - it cannot be recovered!')
          console.log()
          console.log(mnemonic)
          console.log()
        }

        printSuccess(`Key "${stored.name}" created`)
        printInfo(`Account ID: ${stored.accountId}`)

        if (!options.showMnemonic) {
          printInfo('Use --show-mnemonic to display the recovery phrase')
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // Import key from mnemonic
  key
    .command('import')
    .description('Import a key from existing mnemonic')
    .option('-n, --name <name>', 'Name for the key', 'imported')
    .option('--passphrase <pass>', 'Optional passphrase', '')
    .argument('<mnemonic>', 'BIP-39 mnemonic words (quoted)')
    .action(async (mnemonic: string, options, cmd) => {
      try {
        if (!validateMnemonic(mnemonic)) {
          throw new Error('Invalid mnemonic')
        }

        const keyPair = deriveKeyPairFromMnemonic(mnemonic, options.passphrase)

        const stored = addKey({
          name: options.name,
          accountId: keyPair.accountId,
          mnemonic,
          passphrase: options.passphrase,
        })

        printSuccess(`Key "${stored.name}" imported`)
        printInfo(`Account ID: ${stored.accountId}`)
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // List keys
  key
    .command('list')
    .description('List stored signing keys')
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const format = getOutputFormat(globalOpts)

      const keys = listKeys()

      if (keys.length === 0) {
        printInfo('No keys stored. Use "seed key generate" to create one.')
        return
      }

      if (globalOpts.quiet) {
        keys.forEach((k) => console.log(k.name))
      } else {
        const output = keys.map((k) => ({
          name: k.name,
          accountId: k.accountId,
          createdAt: k.createdAt,
        }))
        console.log(formatOutput(output, format))
      }
    })

  // Show key info
  key
    .command('show [nameOrId]')
    .description('Show key information')
    .option('--show-mnemonic', 'Display the mnemonic (DANGER)')
    .action(async (nameOrId: string | undefined, options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const format = getOutputFormat(globalOpts)

      const stored = nameOrId ? getKey(nameOrId) : getDefaultKey()

      if (!stored) {
        printError(nameOrId ? `Key "${nameOrId}" not found` : 'No keys stored')
        process.exit(1)
      }

      const output: Record<string, unknown> = {
        name: stored.name,
        accountId: stored.accountId,
        createdAt: stored.createdAt,
      }

      if (options.showMnemonic) {
        output.mnemonic = stored.mnemonic
        if (stored.passphrase) {
          output.passphrase = stored.passphrase
        }
      }

      console.log(formatOutput(output, format))
    })

  // Remove key
  key
    .command('remove <nameOrId>')
    .description('Remove a stored key')
    .option('-f, --force', 'Skip confirmation')
    .action(async (nameOrId: string, options) => {
      const stored = getKey(nameOrId)

      if (!stored) {
        printError(`Key "${nameOrId}" not found`)
        process.exit(1)
      }

      if (!options.force) {
        printWarning(`This will permanently delete key "${stored.name}" (${stored.accountId})`)
        printInfo('Use --force to confirm')
        process.exit(1)
      }

      removeKey(nameOrId)
      printSuccess(`Key "${stored.name}" removed`)
    })

  // Set default key
  key
    .command('default [nameOrId]')
    .description('Set or show default signing key')
    .action(async (nameOrId: string | undefined, cmd) => {
      if (!nameOrId) {
        const defaultKey = getDefaultKey()
        if (defaultKey) {
          printInfo(`Default key: ${defaultKey.name} (${defaultKey.accountId})`)
        } else {
          printInfo('No default key set')
        }
        return
      }

      const stored = getKey(nameOrId)
      if (!stored) {
        printError(`Key "${nameOrId}" not found`)
        process.exit(1)
      }

      setConfigValue('defaultAccount', stored.accountId)
      printSuccess(`Default key set to "${stored.name}"`)
    })

  // Derive account ID (utility)
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
