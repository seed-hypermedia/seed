/**
 * Account commands — get, list, contacts, capabilities.
 */

import type {Command} from 'commander'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {getClient, getOutputFormat, isPretty} from '../index'
import {formatOutput, printError} from '../output'

export function registerAccountCommands(program: Command) {
  const account = program.command('account').description('Manage accounts (get, list, contacts, capabilities)')

  // ── get ──────────────────────────────────────────────────────────────────

  account
    .command('get <uid>')
    .description('Get account information')
    .option('-q, --quiet', 'Output ID only')
    .action(async (uid: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      try {
        const result = await client.request('Account', uid)

        if (globalOpts.quiet) {
          if (result.type === 'account') {
            console.log(result.metadata?.name || result.id.uid)
          } else {
            console.log('not-found')
          }
        } else {
          console.log(formatOutput(result, format, pretty))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── list ─────────────────────────────────────────────────────────────────

  account
    .command('list')
    .description('List all known accounts')
    .option('-q, --quiet', 'Output IDs and names only')
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      try {
        const result = await client.request('ListAccounts', {})

        if (globalOpts.quiet) {
          result.accounts.forEach((a) => {
            const name = a.metadata?.name || ''
            console.log(`${a.id.id}\t${name}`)
          })
        } else {
          console.log(formatOutput(result, format, pretty))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── contacts ─────────────────────────────────────────────────────────────

  account
    .command('contacts <uid>')
    .description('List contacts for an account')
    .option('-q, --quiet', 'Output names only')
    .action(async (uid: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      try {
        const result = await client.request('AccountContacts', uid)

        if (globalOpts.quiet) {
          result.forEach((c) => {
            console.log(c.name || c.account)
          })
        } else {
          console.log(formatOutput(result, format, pretty))
        }
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })

  // ── capabilities ─────────────────────────────────────────────────────────

  account
    .command('capabilities <id>')
    .description('List access control capabilities')
    .action(async (id: string, _options, cmd) => {
      const globalOpts = cmd.optsWithGlobals()
      const client = getClient(globalOpts)
      const format = getOutputFormat(globalOpts)
      const pretty = isPretty(globalOpts)

      try {
        const unpacked = unpackHmId(id)
        if (!unpacked) {
          printError(`Invalid Hypermedia ID: ${id}`)
          process.exit(1)
        }
        const result = await client.request('ListCapabilities', {targetId: unpacked})
        console.log(formatOutput(result, format, pretty))
      } catch (error) {
        printError((error as Error).message)
        process.exit(1)
      }
    })
}
